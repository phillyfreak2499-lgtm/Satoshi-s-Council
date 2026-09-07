/* Satoshi's Council — push alerts only. This worker caches nothing and never
   touches fetches; it exists so the browser can show a notification when the
   chair books a call or a window settles. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : "" };
  }
  const title = d.title || "Satoshi's Council";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: d.icon || "/__grok/icon-180.png",
      badge: d.icon || "/__grok/icon-180.png",
      tag: d.tag || "desk",
      renotify: false,
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }),
  );
});
