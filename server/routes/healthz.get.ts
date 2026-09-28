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
  // MID_RECOVERY_LOCKS_V1_INACTIVE recorder: env-gated, default OFF
  // (MID_RECOVERY_LOCKS_SHADOW_ENABLED=true), independent of the V1 flag.
  // Same isolation: a cloned frame, desk_shadow_receipts under its own
  // experiment id only, simulated fills, production authority NONE.
  void import("../../src/lib/desk/shadow-lab-mid-recovery-locks.server")
    .then((m) => m.ensureMidRecoveryLocksObserver())
    .catch(() => {});
  // Research factory: env-gated, default OFF (RESEARCH_FACTORY_ENABLED=true).
  // A resource-governed background queue that re-grades settled windows and
  // audits research integrity. Writes only its own desk_research_* tables;
  // production authority NONE; pauses whenever production traffic needs the
  // CPU, memory, event loop or DB pool.
  void import("../../src/lib/desk/research-factory.server")
    .then((m) => m.ensureResearchFactory())
    .catch(() => {});
  // Production decision tape: env-gated, default OFF (RESEARCH_DECISION_TAPE_ENABLED=true).
  // Reads the frame the engine already published; writes only desk_research_decision_tape.
  void import("../../src/lib/desk/research-factory-tape.server")
    .then((m) => m.ensureDecisionTape())
    .catch(() => {});
  // Kalshi order-book depth collector: env-gated, default OFF (RESEARCH_BOOK_DEPTH_ENABLED=true).
  // Reads a copy of the Lab's rebuilt book; writes only desk_research_book_depth; no decision use.
  void import("../../src/lib/desk/book-depth.server")
    .then((m) => m.ensureBookDepth())
    .catch(() => {});
  // Spot/perp signed trade-flow collector: env-gated, default OFF (RESEARCH_TRADE_FLOW_ENABLED=true).
  // Public trade endpoints only; writes only desk_research_flow_minutes and _marks; no decision use.
  void import("../../src/lib/desk/trade-flow.server")
    .then((m) => m.ensureTradeFlow())
    .catch(() => {});
  // Formalized-WICK shadow recorder: env-gated, default OFF (RESEARCH_WICK_SHADOW_ENABLED=true).
  // Reads the published frame; writes only desk_research_wick_shadow; never touches the WICK seat.
  void import("../../src/lib/desk/wick-effort.server")
    .then((m) => m.ensureWickShadow())
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
