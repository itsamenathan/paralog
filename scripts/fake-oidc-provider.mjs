// A minimal OpenID Connect provider for tests, shaped like Pocket ID: authorization
// code flow with PKCE, RS256 ID tokens with a published key set, and refresh tokens
// that rotate on every use and stop working once access is revoked.
import crypto from "node:crypto";
import http from "node:http";

export async function startFakeOidcProvider({ clientId, clientSecret }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const impostor = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const kid = "test-key";
  const codes = new Map();
  const refreshTokens = new Map();
  const state = { subject: "owner-id", revoked: false, badSignature: false, refreshes: 0 };
  let issuer = "";

  function idToken(sub, nonce) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", typ: "JWT", kid })}.${encode({ iss: issuer, aud: clientId, sub, iat: now, exp: now + 300, ...(nonce ? { nonce } : {}) })}`;
    const signature = crypto.sign("sha256", Buffer.from(input), state.badSignature ? impostor : privateKey).toString("base64url");
    return `${input}.${signature}`;
  }

  function issueRefreshToken(sub) {
    const token = crypto.randomBytes(24).toString("base64url");
    refreshTokens.set(token, sub);
    return token;
  }

  function send(response, status, body, headers = {}) {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(body));
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return send(response, 200, { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] });
    if (url.pathname === "/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("state", url.searchParams.get("state"));
      if (url.searchParams.get("client_id") !== clientId || url.searchParams.get("code_challenge_method") !== "S256") {
        back.searchParams.set("error", "invalid_request");
      } else {
        const code = crypto.randomBytes(16).toString("base64url");
        codes.set(code, { sub: state.subject, nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"), redirectUri: url.searchParams.get("redirect_uri") });
        back.searchParams.set("code", code);
      }
      response.writeHead(302, { Location: back.toString() });
      return response.end();
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const params = new URLSearchParams(body);
      // RFC 6749 2.3.1: both halves of client_secret_basic are form-encoded, as Pocket ID (fosite) expects.
      const [id, secret] = Buffer.from(request.headers.authorization?.replace(/^Basic /, "") ?? "", "base64").toString().split(":").map((part) => decodeURIComponent(part.replace(/\+/g, " ")));
      if (id !== clientId || secret !== clientSecret) return send(response, 401, { error: "invalid_client" });
      if (params.get("grant_type") === "authorization_code") {
        const grant = codes.get(params.get("code"));
        codes.delete(params.get("code"));
        const verified = grant && grant.redirectUri === params.get("redirect_uri")
          && crypto.createHash("sha256").update(params.get("code_verifier") ?? "").digest("base64url") === grant.challenge;
        if (!verified) return send(response, 400, { error: "invalid_grant" });
        return send(response, 200, { access_token: "access", token_type: "Bearer", expires_in: 3600, id_token: idToken(grant.sub, grant.nonce), refresh_token: issueRefreshToken(grant.sub) });
      }
      if (params.get("grant_type") === "refresh_token") {
        const sub = refreshTokens.get(params.get("refresh_token"));
        refreshTokens.delete(params.get("refresh_token"));
        if (!sub || state.revoked) return send(response, 400, { error: "invalid_grant" });
        state.refreshes += 1;
        return send(response, 200, { access_token: "access", token_type: "Bearer", expires_in: 3600, refresh_token: issueRefreshToken(sub) });
      }
      return send(response, 400, { error: "unsupported_grant_type" });
    }
    send(response, 404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;
  return { issuer, state, close: () => server.close() };
}
