/** Render health check. Also the shared brain's heartbeat: Render pings this
 *  from boot, so kicking the engine here keeps the desk ticking with zero
 *  tabs open. The kick is fire-and-forget — health stays instant and cannot
 *  be failed by feeds or the database. */
export default function healthz() {
  void import("../../src/lib/desk/server-engine")
    .then((m) => m.ensureServerEngine())
    .catch(() => {});
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
