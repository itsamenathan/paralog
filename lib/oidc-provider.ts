import * as oauth from "oauth4webapi";
import { redirectUri, type OidcConfig, type OidcPending } from "@/lib/oidc";

// Every call to the provider goes through oauth4webapi, which checks discovery,
// state, PKCE, the ID token's claims, and (below) its signature against the
// provider's published keys.

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const discovered = new Map<string, { server: oauth.AuthorizationServer; at: number }>();
const jwks: oauth.JWKSCacheInput = {};

// Plain HTTP is accepted only for a provider on this machine, which is how the tests run one.
function requestOptions(config: OidcConfig) {
  const { protocol, hostname } = new URL(config.issuer);
  const local = protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  return { [oauth.allowInsecureRequests]: local, signal: AbortSignal.timeout(10_000) };
}

const client = (config: OidcConfig): oauth.Client => ({ client_id: config.clientId });
const clientAuth = (config: OidcConfig) => config.clientSecret ? oauth.ClientSecretBasic(config.clientSecret) : oauth.None();

async function server(config: OidcConfig) {
  const cached = discovered.get(config.issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.server;
  const issuer = new URL(config.issuer);
  const metadata = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, requestOptions(config)));
  discovered.set(config.issuer, { server: metadata, at: Date.now() });
  return metadata;
}

export async function authorizationUrl(config: OidcConfig, pending: OidcPending) {
  const metadata = await server(config);
  if (!metadata.authorization_endpoint) throw new Error("The provider names no authorization endpoint.");
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri(config),
    scope: "openid",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(pending.verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export type OidcSignIn = { subject: string; refreshToken?: string };

// Throws oauth.AuthorizationResponseError when the provider sent the user back with an error.
export async function completeSignIn(config: OidcConfig, pending: OidcPending, callback: URLSearchParams): Promise<OidcSignIn> {
  const metadata = await server(config);
  const params = oauth.validateAuthResponse(metadata, client(config), callback, pending.state);
  const response = await oauth.authorizationCodeGrantRequest(metadata, client(config), clientAuth(config), params, redirectUri(config), pending.verifier, requestOptions(config));
  const result = await oauth.processAuthorizationCodeResponse(metadata, client(config), response, { expectedNonce: pending.nonce, requireIdToken: true });
  await oauth.validateApplicationLevelSignature(metadata, response, { ...requestOptions(config), [oauth.jwksCache]: jwks });
  const claims = oauth.getValidatedIdTokenClaims(result)!;
  return { subject: claims.sub, refreshToken: result.refresh_token };
}

// Asks the provider whether the owner may still sign in. Pocket ID 2.6.0 and later
// refuse the refresh token once the user is disabled, loses access to the client,
// or the client is deleted. Resolves to the rotated refresh token, or to null when
// the provider answered with a refusal. Network trouble rejects instead.
export async function refreshGrant(config: OidcConfig, refreshToken: string): Promise<{ refreshToken?: string } | null> {
  const metadata = await server(config);
  try {
    const response = await oauth.refreshTokenGrantRequest(metadata, client(config), clientAuth(config), refreshToken, requestOptions(config));
    const result = await oauth.processRefreshTokenResponse(metadata, client(config), response);
    const subject = oauth.getValidatedIdTokenClaims(result)?.sub;
    if (subject !== undefined && subject !== config.subject) return null;
    return { refreshToken: result.refresh_token };
  } catch (error) {
    // A 4xx answer is the provider saying no; a 5xx is an outage and proves nothing.
    if ((error instanceof oauth.ResponseBodyError || error instanceof oauth.WWWAuthenticateChallengeError) && error.status < 500) return null;
    throw error;
  }
}

export { AuthorizationResponseError } from "oauth4webapi";
