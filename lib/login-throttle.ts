// Limits password guessing. Failed attempts are counted per client over a
// rolling window; once a client runs out, every attempt is refused, even with
// the right password, until its oldest failure ages out.
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type LoginThrottle = Map<string, number[]>;

function recent(throttle: LoginThrottle, client: string, now: number) {
  const failures = (throttle.get(client) ?? []).filter((at) => now - at < LOGIN_WINDOW_MS);
  if (failures.length) throttle.set(client, failures);
  else throttle.delete(client);
  return failures;
}

// Milliseconds until the client may try again, or 0 when it may try now.
export function loginRetryAfter(throttle: LoginThrottle, client: string, now = Date.now()) {
  const failures = recent(throttle, client, now);
  return failures.length < LOGIN_FAILURE_LIMIT ? 0 : failures[failures.length - LOGIN_FAILURE_LIMIT] + LOGIN_WINDOW_MS - now;
}

export function recordLoginFailure(throttle: LoginThrottle, client: string, now = Date.now()) {
  throttle.set(client, [...recent(throttle, client, now), now]);
  // Spread-out guessing from many addresses must not grow the map forever.
  if (throttle.size > 10_000) for (const key of throttle.keys()) recent(throttle, key, now);
}

export function clearLoginFailures(throttle: LoginThrottle, client: string) {
  throttle.delete(client);
}

// Next.js route handlers cannot see the connecting socket, so the client is the
// address a reverse proxy appended: the last X-Forwarded-For entry, which a
// client cannot forge because the proxy adds it after anything the client sent.
// Without a proxy every attempt shares one budget, which still bounds guessing.
export function loginClient(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  return forwarded || headers.get("x-real-ip")?.trim() || "direct";
}
