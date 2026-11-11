import { NextRequest, NextResponse } from "next/server";
import { oidcConfig, sessionSecret } from "@/lib/auth";
import { log } from "@/lib/log";
import { newPending, OIDC_COOKIE_PATH, OIDC_PENDING_COOKIE, OIDC_PENDING_MAX_AGE_SECONDS, sealPending, secureCookies } from "@/lib/oidc";
import { authorizationUrl } from "@/lib/oidc-provider";
export const runtime = "nodejs";

const back = (error: string) => new NextResponse(null, { status: 303, headers: { Location: `/?oidc_error=${error}` } });

export async function GET(request: NextRequest) {
  const config = oidcConfig();
  if (!config) return back("unavailable");
  try {
    const pending = newPending(request.nextUrl.searchParams.get("returnTo"));
    const response = NextResponse.redirect(await authorizationUrl(config, pending), 303);
    // Lax still sends the cookie on the provider's top-level redirect back to the callback.
    response.cookies.set(OIDC_PENDING_COOKIE, sealPending(pending, sessionSecret()), { httpOnly: true, sameSite: "lax", secure: secureCookies(config), maxAge: OIDC_PENDING_MAX_AGE_SECONDS, path: OIDC_COOKIE_PATH });
    return response;
  } catch (error) {
    log.error("Pocket ID sign-in could not start", error, { issuer: config.issuer });
    return back("unavailable");
  }
}
