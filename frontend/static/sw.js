/* Satoshi's Council — shrine cache.
   Static files stay. HTML and /api/state never do. */
const VERSION = "20260831j";
const STATIC_CACHE = "council-static-" + VERSION;

const PRECACHE = [
  "/offline.html",
  "/seat.js?v=" + VERSION,
  "/roundtable.js?v=" + VERSION,
  "/swap.js?v=" + VERSION,
  "/room.js?v=" + VERSION,
  "/desk-fx.js?v=" + VERSION,
  "/style.css?v=" + VERSION,
  "/static/fonts.css?v=" + VERSION,
  "/static/phone-desk.css?v=" + VERSION,
  "/desk-worker.js?v=" + VERSION,
  "/council-mark.png",
  "/favicon.svg",
];

function isApi(url) {
  const p = url.pathname || "";
  return p.indexOf("/api/") === 0 || p === "/health" || p === "/api";
}

function isProof(url) {
  const p = url.pathname || "";
  return p === "/proof" || p.indexOf("/static/proof") === 0 || /\/proof\.(js|css|html)$/i.test(p);
}

function isDocument(req, url) {
  if (req.mode === "navigate") return true;
  const p = url.pathname || "/";
  if (p === "/" || p === "/index.html" || p === "/offline.html" || p === "/proof" || p === "/workspace") return true;
  if (/\.html$/i.test(p)) return true;
  const accept = req.headers.get("accept") || "";
  return accept.indexOf("text/html") !== -1;
}

function localFontPath(url) {
  const p = (url.pathname || "").toLowerCase();
  if (p.indexOf("orbitron") !== -1) return "/static/fonts/orbitron-700.woff2";
  if (p.indexOf("sharetech") !== -1) return "/static/fonts/share-tech-mono-400.woff2";
  return "";
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return Promise.all(PRECACHE.map(function (u) {
        return cache.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
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
  if (data === "SKIP_WAITING" || data.type === "SKIP_WAITING") self.skipWaiting();
  if (data === "UNPIN" || data.type === "UNPIN") {
    event.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }));
  }
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(fetch("/static/fonts.css?v=" + VERSION, { cache: "reload" }));
    return;
  }
  if (url.hostname === "fonts.gstatic.com") {
    const local = localFontPath(url);
    if (local) {
      event.respondWith(fetch(local, { cache: "reload" }));
      return;
    }
  }

  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  if (isProof(url)) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  if (isDocument(req, url)) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).then(function (res) { return res; }).catch(function () {
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
