/* Satoshi's Council — shrine cache.
   Static files stay. /api/state never does. */
const VERSION = "20260821a";
const STATIC_CACHE = "council-static-" + VERSION;

const PRECACHE = [
  "/",
  "/offline.html",
  "/seat.js?v=" + VERSION,
  "/roundtable.js?v=" + VERSION,
  "/style.css?v=" + VERSION,
  "/campus-tab.js?v=" + VERSION,
  "/campus-tab.css?v=" + VERSION,
  "/desk-worker.js?v=" + VERSION,
  "/council-mark.png",
  "/favicon.svg",
];

function isApi(url) {
  const p = url.pathname || "";
  return p.indexOf("/api/") === 0 || p === "/health" || p === "/api";
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: "reload" }); })).catch(function () {});
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf("council-static-") === 0 && k !== STATIC_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // live Chair — never cache

  if (req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("/offline.html") || caches.match("/");
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (!res || res.status !== 200 || res.type === "opaque") return res;
        const copy = res.clone();
        caches.open(STATIC_CACHE).then(function (cache) { cache.put(req, copy); });
        return res;
      });
    })
  );
});
