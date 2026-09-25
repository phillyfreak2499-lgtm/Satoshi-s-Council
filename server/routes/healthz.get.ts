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
  void import("../../src/lib/desk/ask-lead.server")
    .then((m) => m.ensureAskLeadObserver())
    .catch(() => {});
  void import("../../src/lib/desk/openai-shadow.server")
    .then((m) => m.ensureOpenAIShadowObserver())
    .catch(() => {});
  void import("../../src/lib/desk/openai-blind.server")
    .then((m) => m.ensureOpenAIBlindObserver())
    .catch(() => {});
  void import("../../src/lib/desk/openai-luna.server")
    .then((m) => m.ensureOpenAILunaObserver())
    .catch(() => {});
  void import("../../src/lib/desk/chair-ablation.server")
    .then((m) => m.ensureChairAblationObserver())
    .catch(() => {});
  void import("../../src/lib/desk/lab-registry.server")
    .then((m) => m.ensureLabRegistryObserver())
    .catch(() => {});
  void import("../../src/lib/desk/astra-director.server")
    .then((m) => m.ensureAstraDirectorObserver())
    .catch(() => {});
  // The hourly closer: a separate book, its own table, its own timer, no path into the floor.
  void import("../../src/lib/desk/hour-closer.server")
    .then((m) => m.ensureHourCloser())
    .catch(() => {});
  // Hour Research: shadow-only hourly checkpoints. Its own tables, its own
  // timer, authority none, and no path into the 15-minute floor.
  void import("../../src/lib/desk/hour-research.server")
    .then((m) => m.ensureHourResearchObserver())
    .catch(() => {});
  // Shadow lab (E1–E3 receipts): env-gated, default OFF. ensureShadowLabObserver
  // returns "disabled" unless SHADOW_LAB_ENABLED=true; it reads a cloned frame,
  // writes only desk_shadow_receipts / desk_shadow_manifests, and has no path
  // into the Chair, the gate, the paper book or the learner.
  void import("../../src/lib/desk/shadow-lab.server")
    .then((m) => m.ensureShadowLabObserver())
    .catch(() => {});
  // MID_RECOVERY_V1_INACTIVE recorder: env-gated, default OFF
  // (MID_RECOVERY_SHADOW_ENABLED=true). Reads a cloned frame, writes only
  // desk_shadow_receipts under its own experiment id, holds no manifest slot,
  // and has no path into the Chair, the gate, the paper book or the learner.
  void import("../../src/lib/desk/shadow-lab-mid-recovery.server")
    .then((m) => m.ensureMidRecoveryObserver())
    .catch(() => {});
  // Skill-status transition log: drains the engine's in-memory transition
  // buffer into insert-once system events. Telemetry only; kill switch
  // SKILL_STATUS_LOG_DISABLED=true. No path back into the learner.
  void import("../../src/lib/desk/status-transitions.server")
    .then((m) => m.ensureStatusTransitionLog())
    .catch(() => {});
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
