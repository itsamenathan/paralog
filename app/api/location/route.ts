import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  county?: string;
  state?: string;
  state_district?: string;
  region?: string;
  country?: string;
};

function coordinate(value: string | null, minimum: number, maximum: number) {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const latitude = coordinate(request.nextUrl.searchParams.get("latitude"), -90, 90);
  const longitude = coordinate(request.nextUrl.searchParams.get("longitude"), -180, 180);
  if (latitude === null || longitude === null) return NextResponse.json({ error: "Valid coordinates are required." }, { status: 400 });

  try {
    const endpoint = new URL(process.env.PARALOG_GEOCODING_URL || "https://nominatim.openstreetmap.org/reverse");
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("lat", String(latitude));
    endpoint.searchParams.set("lon", String(longitude));
    endpoint.searchParams.set("zoom", "10");
    endpoint.searchParams.set("addressdetails", "1");
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": process.env.PARALOG_GEOCODING_USER_AGENT || "Paralog/0.1 (+https://github.com/itsamenathan/paralog)",
      },
    });
    if (!response.ok) throw new Error(`Location service returned ${response.status}.`);
    const result = await response.json() as { address?: NominatimAddress; error?: string };
    if (result.error) throw new Error(result.error);
    const address = result.address || {};
    const city = address.city || address.town || address.village || address.municipality || address.hamlet || address.county;
    const state = address.state || address.state_district || address.region;
    const country = address.country;
    const parts = [city, state, country].filter((part, index, values): part is string => Boolean(part) && values.indexOf(part) === index);
    if (!country || parts.length < 2) throw new Error("No city-level location was found for these coordinates.");
    return NextResponse.json({ city: city || null, state: state || null, country, label: parts.join(", "), attribution: "© OpenStreetMap contributors" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Location lookup failed." }, { status: 502 });
  }
}
