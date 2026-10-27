const SHELL_CACHE = "paralog-shell-v6";
const RUNTIME_CACHE = "paralog-runtime-v6";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/notification-badge.png"];
const OFFLINE_HEADER = "X-Paralog-Offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PRIVATE") event.waitUntil(caches.delete(RUNTIME_CACHE));
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Fall back to a generic reminder. */ }
  const title = typeof payload.title === "string" ? payload.title : "Time to journal";
  const body = typeof payload.body === "string" ? payload.body : "Add a thought to today’s entry.";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";
  const tag = typeof payload.tag === "string" ? payload.tag : "paralog-reminder";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/notification-badge.png",
    tag,
    renotify: false,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if ("navigate" in client) await client.navigate(url);
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  }));
});

// A cached copy keeps the journal readable offline, but it describes an earlier
// visit rather than what the server holds now. The marker lets the app tell the
// two apart, so a single failed request cannot pass an old entry off as the
// current one and replace newer writing with it.
function offlineFallback(response) {
  if (!response) return null;
  const headers = new Headers(response.headers);
  headers.set(OFFLINE_HEADER, "1");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Attachments larger than this are still served, but not kept for offline use:
// a handful of videos would otherwise fill the device's storage quota.
const MAX_CACHED_FILE_BYTES = 10 * 1024 * 1024;

function cacheable(request, response) {
  // The Cache API only stores complete responses; partial content makes it throw.
  if (response.status !== 200) return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/files") && !url.pathname.startsWith("/attachments/")) return true;
  const length = Number(response.headers.get("Content-Length"));
  return Number.isFinite(length) && length > 0 && length <= MAX_CACHED_FILE_BYTES;
}

async function networkFirst(request, fallback) {
  const cache = await caches.open(RUNTIME_CACHE);
  let response;
  try {
    response = await fetch(request);
  } catch {
    // Media players and PDF viewers ask for byte ranges; a complete cached copy
    // still answers them, as a server without range support would.
    const cached = (await cache.match(request.url)) || (await caches.match(fallback || request.url));
    return offlineFallback(cached) || Response.error();
  }
  // Keeping an offline copy is best-effort. A failure here must not turn a
  // response the network already delivered into an error.
  try {
    if (cacheable(request, response)) {
      await cache.put(request, response.clone());
      if (request.mode === "navigate") {
        await cache.put("/", response.clone());
        await cachePageAssets(response.clone());
      }
    }
  } catch { /* The next request can store it. */ }
  return response;
}

async function cachePageAssets(response) {
  try {
    const html = await response.text();
    const paths = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((match) => match[1])
      .filter((path) => path.startsWith("/_next/") || path.startsWith("/icon-"));
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all([...new Set(paths)].map(async (path) => {
      try {
        const asset = await fetch(path);
        if (asset.ok) await cache.put(path, asset);
      } catch { /* The next navigation can retry this asset. */ }
    }));
  } catch { /* HTML asset warming is best-effort. */ }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  if (url.pathname === "/api/entries/events") {
    event.respondWith(fetch(request));
    return;
  }

  // Byte-range requests come from media players and PDF viewers. Partial
  // responses cannot be cached, so they go to the network, falling back to a
  // complete offline copy when there is one.
  if (request.headers.has("range")) {
    event.respondWith(fetch(request).catch(async () => offlineFallback(await caches.match(request.url)) || Response.error()));
    return;
  }

  if (url.pathname.startsWith("/api/entries") || url.pathname.startsWith("/api/calendar") || url.pathname.startsWith("/api/settings") || url.pathname.startsWith("/api/tags") || url.pathname.startsWith("/api/people") || url.pathname.startsWith("/api/references") || url.pathname.startsWith("/api/activity") || url.pathname.startsWith("/api/random-memory") || url.pathname.startsWith("/api/files") || url.pathname.startsWith("/api/attachments") || url.pathname.startsWith("/attachments/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/icon") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      return response;
    })));
  }
});
