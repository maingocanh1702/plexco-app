/* Plexco service worker (hand-written; no build step, no dependency).
 *
 * - Precache: the /offline fallback page plus every /_next/static asset it references and the
 *   brand icons, so the fallback renders and hydrates with no network.
 * - Navigations: network-first; on failure serve /offline (never a browser error page).
 * - /_next/static/*: stale-while-revalidate (filenames are content-hashed).
 * - /api/* and every non-GET request: never intercepted, never cached (session, CSRF secret and
 *   tenant data must always come from the network).
 *
 * Bump VERSION whenever app/offline/page.tsx markup or this file's strategy changes: a new
 * version precaches afresh and deletes the old caches on activate.
 */
const VERSION = "v1";
const STATIC_CACHE = "plexco-static-" + VERSION;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  await cache.addAll(PRECACHE);
  // Pull in the hashed JS/CSS the offline page needs so it works with no network at all.
  const html = await (await cache.match(OFFLINE_URL)).text();
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  await Promise.all(
    [...assets].map((url) =>
      cache.add(url).catch(() => {
        /* a single missing asset must not fail the install */
      }),
    ),
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}
