const SHELL_CACHE = "paralog-shell-v4";
const RUNTIME_CACHE = "paralog-runtime-v4";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

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
    badge: "/icon-192.png",
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

async function networkFirst(request, fallback) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (request.mode === "navigate") {
        await cache.put("/", response.clone());
        await cachePageAssets(response.clone());
      }
    }
    return response;
  } catch {
    return (await cache.match(request)) || (await caches.match(fallback || request)) || Response.error();
  }
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

  if (url.pathname.startsWith("/api/entries") || url.pathname.startsWith("/api/calendar") || url.pathname.startsWith("/api/settings") || url.pathname.startsWith("/api/tags") || url.pathname.startsWith("/api/people") || url.pathname.startsWith("/api/files")) {
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
