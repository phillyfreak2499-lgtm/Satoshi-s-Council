/** Render health check. Also the shared brain's heartbeat: Render pings this
 *  from boot, so kicking the engine here keeps the desk ticking with zero
 *  tabs open. Research observers boot BESIDE the engine and have no return path
 *  into it. Every kick is fire-and-forget — health stays instant and cannot be
 *  failed by feeds, research, or the database. */
export default function healthz() {
  void import("../../src/lib/desk/server-engine")
    .then((m) => m.ensureServerEngine())
    .catch(() => {});
  void import("../../src/lib/desk/chair-v3-prospective.server")
    .then((m) => m.ensureChairV3ProspectiveObserver())
    .catch(() => {});
  void import("../../src/lib/desk/call-quality.server")
    .then((m) => m.ensureCallQualityObserver())
    .catch(() => {});
  void import("../../src/lib/desk/forced-v4.server")
    .then((m) => m.ensureForcedV4Observer())
    .catch(() => {});
  void import("../../src/lib/desk/openai-shadow.server")
    .then((m) => m.ensureOpenAIShadowObserver())
    .catch(() => {});
  void import("../../src/lib/desk/openai-blind.server")
    .then((m) => m.ensureOpenAIBlindObserver())
    .catch(() => {});
  void import("../../src/lib/desk/astra-director.server")
    .then((m) => m.ensureAstraDirectorObserver())
    .catch(() => {});
  // The hourly closer: a separate book, its own table, its own timer, no path into the floor.
  void import("../../src/lib/desk/hour-closer.server")
    .then((m) => m.ensureHourCloser())
    .catch(() => {});
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
