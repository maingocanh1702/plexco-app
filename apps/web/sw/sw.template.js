/* Plexco service worker (hand-written; no build step, no dependency).
 *
 * - Precache: the /offline fallback page plus every /_next/static asset it references and the
 *   brand icons, so the fallback renders and hydrates with no network.
 * - Navigations: network-first; on failure serve /offline (never a browser error page).
 * - /_next/static/*: stale-while-revalidate (filenames are content-hashed).
 * - /api/* and every non-GET request: never intercepted, never cached (session, CSRF secret and
 *   tenant data must always come from the network).
 *
 * VERSION is stamped at build time (scripts/stamp-sw.mjs writes public/sw.js from this template),
 * so every deploy changes the worker bytes: the browser installs it, precaches the new /offline
 * page and its hashed assets, and activate deletes every cache from earlier versions.
 */
const VERSION = "__SW_VERSION__"; // stamped per build by scripts/stamp-sw.mjs
const STATIC_CACHE = "plexco-static-" + VERSION;
const OFFLINE_URL = "/offline";
// Copied by name from the cached /offline response (never content-encoding / content-length).
const SECURITY_HEADERS = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];
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
    event.respondWith(fetch(request).catch(() => offlineFallback(request)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Serves the precached /offline page for a failed navigation, with the REQUESTED path injected
// as window.__plxReturnTo. The page cannot reliably read it itself: Next rewrites the address bar
// to /offline while hydrating, so recovery ("Try again" / back online) needs it handed over here.
async function offlineFallback(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(OFFLINE_URL);
  if (!hit) return Response.error();
  const url = new URL(request.url);
  // "//host/..." is a protocol-relative URL, not a same-origin path: never hand it to the page.
  const path = url.pathname;
  const target = path === OFFLINE_URL || path.startsWith("//") ? "/" : path + url.search;
  const html = await hit.text();
  // The cached page's CSP may be nonce-based; reuse its nonce so the injected script still runs.
  const nonce = /nonce="([^"]+)"/.exec(html);
  // JSON string literal; "<" escaped so the value can never close the script tag.
  const tag =
    "<script" +
    (nonce ? ' nonce="' + nonce[1] + '"' : "") +
    ">window.__plxReturnTo=" +
    JSON.stringify(target).replace(/</g, "\\u003c") +
    "</script>";
  // Function replacer: a string replacement would expand "$'", "$`", "$&" found inside `target`.
  const headers = { "content-type": "text/html; charset=utf-8" };
  for (const name of SECURITY_HEADERS) {
    const value = hit.headers.get(name);
    if (value) headers[name] = value;
  }
  return new Response(
    html.replace("<head>", () => "<head>" + tag),
    { status: 200, headers },
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      // Only a plain same-origin answer: never opaque/cors, never the result of a redirect.
      if (response.ok && response.type === "basic" && !response.redirected) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}
