/** Render health check — no SSR, no feeds, no DB. */
export default function healthz() {
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
