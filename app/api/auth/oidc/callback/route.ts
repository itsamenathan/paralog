import { NextRequest, NextResponse } from "next/server";
import { oidcConfig, sessionSecret, signIn } from "@/lib/auth";
import { log } from "@/lib/log";
import { OIDC_COOKIE_PATH, OIDC_PENDING_COOKIE, openPending, secureCookies } from "@/lib/oidc";
import { storeGrant } from "@/lib/oidc-grant";
import { AuthorizationResponseError, completeSignIn } from "@/lib/oidc-provider";
export const runtime = "nodejs";

// Relative redirects keep the browser on the origin it used.
function redirect(location: string) {
  const response = new NextResponse(null, { status: 303, headers: { Location: location } });
  response.cookies.set(OIDC_PENDING_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: OIDC_COOKIE_PATH });
  return response;
}

export async function GET(request: NextRequest) {
  const config = oidcConfig();
  if (!config) return redirect("/?oidc_error=unavailable");
  // Without this browser's sign-in state the callback did not start here, or took too long.
  const pending = openPending(request.cookies.get(OIDC_PENDING_COOKIE)?.value, sessionSecret());
  if (!pending) return redirect("/?oidc_error=expired");
  try {
    const { subject, refreshToken } = await completeSignIn(config, pending, request.nextUrl.searchParams);
    if (subject !== config.subject) {
      // Logged, not shown, so the owner can find their ID here while setting up.
      log.warn("Someone other than the journal's owner signed in to Pocket ID", undefined, { sub: subject });
      return redirect("/?oidc_error=not_owner");
    }
    storeGrant(config, refreshToken);
    await signIn(secureCookies(config));
    return redirect(pending.returnTo);
  } catch (error) {
    if (error instanceof AuthorizationResponseError) {
      log.warn("Pocket ID refused sign-in", undefined, { error: error.error });
      return redirect(`/?oidc_error=${error.error === "access_denied" ? "denied" : "failed"}`);
    }
    log.error("Pocket ID sign-in failed", error, { issuer: config.issuer });
    return redirect("/?oidc_error=failed");
  }
}
