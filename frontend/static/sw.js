/* Satoshi's Council — shrine cache.
   Static files stay. HTML and /api/state never do.
   Old workers that cache-first "/" pin the assembler stub on phones.
   This worker does not precache "/", does not cache documents, and
   claims clients as soon as it installs. */
const VERSION = "20260821i";
const STATIC_CACHE = "council-static-" + VERSION;

const PRECACHE = [
  "/offline.html",
  "/seat.js?v=" + VERSION,
  "/roundtable.js?v=" + VERSION,
  "/desk-fx.js?v=" + VERSION,
  "/style.css?v=" + VERSION,
  "/desk-worker.js?v=" + VERSION,
  "/council-mark.png",
  "/favicon.svg",
];

function isApi(url) {
  const p = url.pathname || "";
  return p.indexOf("/api/") === 0 || p === "/health" || p === "/api";
}

function isDocument(req, url) {
  if (req.mode === "navigate") return true;
  const p = url.pathname || "/";
  if (p === "/" || p === "/index.html" || p === "/offline.html") return true;
  if (/\.html$/i.test(p)) return true;
  const accept = req.headers.get("accept") || "";
  return accept.indexOf("text/html") !== -1;
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
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("council-static-") === 0 && k !== STATIC_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data === "SKIP_WAITING" || data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (data === "UNPIN" || data.type === "UNPIN") {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
    );
  }
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // live Chair — never cache

  if (isDocument(req, url)) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).then(function (res) {
        return res;
      }).catch(function () {
        return caches.match("/offline.html");
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
