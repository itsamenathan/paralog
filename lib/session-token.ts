import crypto from "node:crypto";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
// Tolerates a server clock that steps backwards a little after a token is issued.
const CLOCK_SKEW_SECONDS = 5 * 60;

export type SessionKeys = {
  secret: string;
  // Binds sessions to the configured password, so changing it signs every device out.
  password: string;
  // Bumped on sign out, which revokes every session issued before it.
  generation: number;
};

function signature(keys: SessionKeys, issuedAt: number) {
  const password = crypto.createHash("sha256").update(keys.password).digest("base64url");
  return crypto.createHmac("sha256", keys.secret)
    .update(`paralog-session.v1.${issuedAt}.${keys.generation}.${password}`)
    .digest("base64url");
}

export function issueSessionToken(keys: SessionKeys, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  return `v1.${issuedAt}.${keys.generation}.${signature(keys, issuedAt)}`;
}

export function verifySessionToken(token: string | undefined, keys: SessionKeys, now = Date.now()) {
  const match = token?.match(/^v1\.(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const age = Math.floor(now / 1000) - issuedAt;
  if (Number(match[2]) !== keys.generation || age > SESSION_MAX_AGE_SECONDS || age < -CLOCK_SKEW_SECONDS) return false;
  const expected = Buffer.from(signature(keys, issuedAt));
  const actual = Buffer.from(match[3]);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
