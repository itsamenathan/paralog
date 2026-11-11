import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settingsTable } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { oidcFingerprint, type OidcConfig } from "@/lib/oidc";
import { refreshGrant } from "@/lib/oidc-provider";

// The refresh token from the latest Pocket ID sign-in. Paralog never uses it for
// anything but asking, about once a day, whether the owner may still sign in, so
// that disabling the account in Pocket ID ends Paralog sessions too.

const KEY = "oidcGrant";
export const GRANT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_OUTAGE_MS = 60 * 60 * 1000;

type Grant = { refreshToken: string; fingerprint: string; checkAt: number };

function readGrant(): Grant | null {
  const value = db().select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, KEY)).get()?.value;
  try { return value ? JSON.parse(value) as Grant : null; } catch { return null; }
}

function writeGrant(grant: Grant) {
  const value = JSON.stringify(grant);
  db().insert(settingsTable).values({ key: KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value } }).run();
}

export function clearGrant() {
  db().delete(settingsTable).where(eq(settingsTable.key, KEY)).run();
}

export function storeGrant(config: OidcConfig, refreshToken: string | undefined) {
  if (!refreshToken) {
    clearGrant();
    log.warn("The OIDC provider issued no refresh token, so revoking access there will not end Paralog sessions", undefined, { issuer: config.issuer });
    return;
  }
  writeGrant({ refreshToken, fingerprint: oidcFingerprint(config), checkAt: Date.now() + GRANT_CHECK_INTERVAL_MS });
}

let inFlight: Promise<boolean> | null = null;

// Resolves to false once the provider has refused the grant. Sessions from a
// password sign-in, with no grant stored, are not checked.
export function grantStillValid(config: OidcConfig): Promise<boolean> {
  const grant = readGrant();
  if (!grant) return Promise.resolve(true);
  if (grant.fingerprint !== oidcFingerprint(config)) {
    // Issued under other settings; those sessions already stopped working.
    clearGrant();
    return Promise.resolve(true);
  }
  if (Date.now() < grant.checkAt) return Promise.resolve(true);
  inFlight ??= check(config, grant).finally(() => { inFlight = null; });
  return inFlight;
}

async function check(config: OidcConfig, grant: Grant) {
  try {
    const result = await refreshGrant(config, grant.refreshToken);
    if (!result) {
      log.warn("The OIDC provider refused the owner's grant; signing out every device", undefined, { issuer: config.issuer });
      clearGrant();
      return false;
    }
    // Pocket ID rotates the refresh token on every use, so the old one is now spent.
    writeGrant({ ...grant, refreshToken: result.refreshToken ?? grant.refreshToken, checkAt: Date.now() + GRANT_CHECK_INTERVAL_MS });
    return true;
  } catch (error) {
    // An unreachable provider must not lock the owner out of their journal.
    log.warn("Could not reach the OIDC provider to check the owner's grant", error, { issuer: config.issuer });
    writeGrant({ ...grant, checkAt: Date.now() + RETRY_AFTER_OUTAGE_MS });
    return true;
  }
}
