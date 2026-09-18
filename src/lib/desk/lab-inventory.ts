/**
 * Canonical inventory of research/measurement work.
 *
 * The Lab used to be discoverable only by knowing route/file names. That makes a
 * stopped recorder look the same as a derived study and lets old shadows run
 * without a stated question. Every item here must say what it is learning, what
 * decision the evidence could inform, and when collection can stop.
 *
 * This registry grants NO authority. It is an observability/lifecycle contract.
 */
export type LabLifecycle = "ACTIVE" | "CONTROL" | "DERIVED" | "ON_DEMAND";
export type LabWriterKind = "continuous" | "per-window" | "event-driven" | "derived" | "on-demand";

export type LabInventoryItem = {
  id: string;
  label: string;
  family: string;
  lifecycle: LabLifecycle;
  writer_kind: LabWriterKind;
  storage: string | null;
  freshness_sla_s: number | null;
  question: string;
  decision_use: string;
  exit_criterion: string;
  reader: string;
  authority: "none";
  note?: string;
};

const x = (v: Omit<LabInventoryItem, "authority">): LabInventoryItem => ({ ...v, authority: "none" });

export const LAB_INVENTORY: readonly LabInventoryItem[] = [
  x({
    id: "raw-recorder", label: "Raw Lab recorder", family: "substrate", lifecycle: "ACTIVE",
    writer_kind: "continuous", storage: null, freshness_sla_s: null,
    question: "Do we retain enough raw BRTI/book/trade evidence to reproduce research questions?",
    decision_use: "Operational evidence retention and post-mortem reproduction.",
    exit_criterion: "Never while the Lab depends on event-level replay; disk guards may shed only documented low-priority deltas.",
    reader: "labSummary / offline replay",
  }),
  x({
    id: "basis-brti", label: "Spot/BRTI basis", family: "feed-integrity", lifecycle: "ACTIVE",
    writer_kind: "continuous", storage: "desk_basis_minutes", freshness_sla_s: 300,
    question: "Are Binance/Coinbase spot feeds systematically displaced from the settlement index?",
    decision_use: "Feed-integrity diagnosis and settlement-model validation; never a vote.",
    exit_criterion: "Keep while spot feeds are inputs; replace only with an equivalent signed basis monitor.",
    reader: "labDigestBits",
  }),
  x({
    id: "stale-quote", label: "Stale-quote / jump survival", family: "microstructure", lifecycle: "ACTIVE",
    writer_kind: "event-driven", storage: "desk_lag_events", freshness_sla_s: null,
    question: "After a fair-value shock, was the old executable quote actually available long enough to hit and did it retain value?",
    decision_use: "Decide whether latency/stale-quote research is economically plausible rather than midpoint fantasy.",
    exit_criterion: "Archive only after a prospective latency policy is accepted/rejected or the feed/book protocol changes.",
    reader: "labDigestBits / recap / books",
  }),
  x({
    id: "replay", label: "Window replay", family: "substrate", lifecycle: "CONTROL",
    writer_kind: "per-window", storage: "desk_replay", freshness_sla_s: 2700,
    question: "What did the desk actually know and say through each completed window?",
    decision_use: "Shared evidence substrate for timing, paths, exits, STRIKE2 and post-mortems.",
    exit_criterion: "Never while downstream replay studies exist.",
    reader: "Replay / STRIKE2 / excursion / seat horizon / null horizon / path studies",
  }),
  x({
    id: "chair-v2", label: "Chair v2 direct learner", family: "direction", lifecycle: "CONTROL",
    writer_kind: "per-window", storage: "desk_samples", freshness_sla_s: 2700,
    question: "Can a direct learned combination of stored Council/market features beat its market baseline?",
    decision_use: "Legacy learned-model comparator; useful as a control against market-prior V3/V4.",
    exit_criterion: "Stop new sampling only when a replacement comparator is frozen and historical attribution is preserved.",
    reader: "server-engine V2 scoreboard",
    note: "Legacy comparator, not the current Chair. Its roster semantics predate the newest V3/V4 design, so do not promote from this stream without a new prospective version.",
  }),
  x({
    id: "taker-v1", label: "TAKER v1", family: "direction", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "desk_taker", freshness_sla_s: 2700,
    question: "Does frozen aggressive Kalshi taker flow add out-of-sample directional/economic information?",
    decision_use: "Keep/retire the frozen taker-flow hypothesis after the readiness sample is met.",
    exit_criterion: "Run the frozen evaluation when /readiness passes; then explicitly RETIRE, REFREEZE a new version, or keep as a named control.",
    reader: "/taker + /readiness",
  }),
  x({
    id: "tape2", label: "TAPE 2.0", family: "microstructure", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "desk_replay", freshness_sla_s: 2700,
    question: "Do depth imbalance, microprice, OFI, cancellations and executed flow add information beyond the book price?",
    decision_use: "Candidate feature evidence only; no automatic promotion.",
    exit_criterion: "Freeze a prospective candidate when a specific feature survives the research board; otherwise retain as replay context.",
    reader: "/research + Replay",
  }),
  x({
    id: "vel2", label: "VEL 2.0", family: "microstructure", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "desk_replay", freshness_sla_s: 2700,
    question: "Does spot-vs-contract residual movement or lead/lag add independent directional information?",
    decision_use: "Candidate feature evidence only.",
    exit_criterion: "Freeze or retire a specific residual/lead rule after prospective evaluation; keep raw replay traces while useful.",
    reader: "/research + Replay",
  }),
  x({
    id: "whale2", label: "WHALE 2.0 absorption", family: "microstructure", lifecycle: "ACTIVE",
    writer_kind: "event-driven", storage: "desk_absorption", freshness_sla_s: null,
    question: "When aggressive size crosses but price does not respond, is the non-response informative relative to market odds?",
    decision_use: "Determine whether an absorption feature merits a frozen prospective rule.",
    exit_criterion: "After enough post-quantity-fix prints support/reject all frozen bands, freeze one candidate or archive the hypothesis.",
    reader: "/absorption + /research",
  }),
  x({
    id: "strike2", label: "STRIKE 2.0", family: "calibration", lifecycle: "DERIVED",
    writer_kind: "derived", storage: "desk_replay", freshness_sla_s: null,
    question: "Does walk-forward strike-distance calibration improve probability quality versus the market?",
    decision_use: "Assess a calibrated STRIKE hypothesis without adding voting authority.",
    exit_criterion: "Re-run from the growing replay ledger; only a separately frozen prospective version can change status.",
    reader: "/strike2",
  }),
  x({
    id: "seat-signal", label: "Seat signal", family: "attribution", lifecycle: "DERIVED",
    writer_kind: "derived", storage: "desk_samples", freshness_sla_s: null,
    question: "When a seat objects to the market, does that objection add information relative to the market's own probability?",
    decision_use: "Identify hypotheses worth prospective isolation; never reweight from the in-sample table.",
    exit_criterion: "Keep as a diagnostic view while seat hypotheses exist.",
    reader: "/seat-signal",
  }),
  x({
    id: "seat-horizon", label: "Seat horizon calibration", family: "timing", lifecycle: "DERIVED",
    writer_kind: "derived", storage: "desk_replay", freshness_sla_s: null,
    question: "At fixed pre-close horizons, when do raw/heard seat directions become informative?",
    decision_use: "Design a later prospective timing rule without cherry-picking a single instant.",
    exit_criterion: "Keep as a descriptive timing view; any chosen horizon must start a new prospective clock.",
    reader: "public Lab",
  }),
  x({
    id: "null-horizon", label: "NULL_HORIZON_V1", family: "timing", lifecycle: "ON_DEMAND",
    writer_kind: "on-demand", storage: "desk_replay", freshness_sla_s: null,
    question: "How do NULL/HEARD/RAW/HORIZON replay arms compare under the frozen economic gates?",
    decision_use: "Manual sensitivity analysis; it is not a continuously running bot.",
    exit_criterion: "Run only when a timing question needs it; do not diagnose it as stale between runs.",
    reader: "npm run lab:null-horizon",
  }),
  x({
    id: "path-parity", label: "Timestamped path parity", family: "data-quality", lifecycle: "ACTIVE",
    writer_kind: "continuous", storage: null, freshness_sla_s: null,
    question: "How far do legacy array-offset d30/d60/d120 reads diverge from timestamp-correct horizons?",
    decision_use: "Make an explicit migrate/keep decision for the affected consumers with a research-era boundary.",
    exit_criterion: "Once the consumer migration decision is made and a new era is frozen, stop the parity recorder after verification.",
    reader: "/path-parity",
    note: "Freshness stays behind the dedicated path-parity admin reader; the central audit deliberately does not consult this protected one-way measurement.",
  }),
  x({
    id: "exit-arena", label: "Exit policy arena", family: "execution-policy", lifecycle: "ACTIVE",
    writer_kind: "event-driven", storage: "desk_policy_observations", freshness_sla_s: null,
    question: "On identical actual paper fills, do frozen exit candidates improve net results versus HOLD?",
    decision_use: "Prospective promotion/retirement of exit policy candidates only after promotion gates.",
    exit_criterion: "Retire losing candidates after their frozen evaluation; HOLD remains the permanent control.",
    reader: "public Lab + /lab/standing",
  }),
  x({
    id: "call-quality", label: "Entry-time call quality", family: "entry-policy", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "desk_call_quality", freshness_sla_s: 1800,
    question: "At 7:30, 5:00 and 3:00, what data/eligibility state existed before the later entry decision?",
    decision_use: "Diagnose whether entry scarcity comes from model quality, data quality or admission rules.",
    exit_criterion: "Close the study after its frozen checkpoint sample is large enough to answer the admission question; start a new version for changed rules.",
    reader: "public Lab",
  }),
  x({
    id: "chair-v3", label: "Chair v3 market-prior correction", family: "direction", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "desk_v3_samples", freshness_sla_s: 2700,
    question: "Can bounded independent Council evidence improve a market-prior probability prospectively?",
    decision_use: "Compare Brier/log loss to the market before considering any authority.",
    exit_criterion: "After a serious prospective sample across regimes, freeze verdict; any changed feature roster becomes a new version.",
    reader: "/research/chair-v3",
  }),
  x({
    id: "cube", label: "Performance cube", family: "diagnostic", lifecycle: "DERIVED",
    writer_kind: "derived", storage: "research_ledger", freshness_sla_s: null,
    question: "Where do current-book results differ by side, price, time, regime and seat agreement?",
    decision_use: "Generate hypotheses only; look-elsewhere protection prevents treating slices as findings.",
    exit_criterion: "Keep as a read-only diagnostic while the ledger exists.",
    reader: "/cube",
  }),
  x({
    id: "excursion", label: "MAE/MFE excursion", family: "execution-policy", lifecycle: "DERIVED",
    writer_kind: "derived", storage: "desk_replay", freshness_sla_s: null,
    question: "How far did held calls move for/against the position after entry?",
    decision_use: "Design explicit prospective exit candidates; hindsight MFE is never itself a rule.",
    exit_criterion: "Keep as a descriptive generator for frozen exit hypotheses.",
    reader: "/excursion",
  }),
  x({
    id: "redundancy", label: "Council redundancy", family: "attribution", lifecycle: "DERIVED",
    writer_kind: "derived", storage: "research_ledger", freshness_sla_s: null,
    question: "Which directional seats overlap, and how would past tallies change without one seat?",
    decision_use: "Nominate a seat for a future prospective mute test; never mute from in-sample leave-one-out.",
    exit_criterion: "Keep as a diagnostic while roster changes are versioned.",
    reader: "/redundancy",
  }),
  x({
    id: "skill-score-audit", label: "Skill score audit", family: "data-quality", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "skill_score_audit", freshness_sla_s: 2700,
    question: "Do the named skill counters increment exactly as the grader claims, and are confidence/economic inputs being interpreted honestly?",
    decision_use: "Prove or falsify scoring integrity before trusting skill rankings.",
    exit_criterion: "Archive after a sustained run of matching receipts or after a proven mismatch is fixed and a new audit version verifies it.",
    reader: "/skill-score-audit",
  }),
  x({
    id: "feature-registry", label: "Feature registry", family: "governance", lifecycle: "CONTROL",
    writer_kind: "derived", storage: null, freshness_sla_s: null,
    question: "Which inputs are live, shadow, measurement-only, missing or retired, and who consumes each?",
    decision_use: "Prevent shadow/measurement features from silently gaining Chair authority.",
    exit_criterion: "Permanent governance control.",
    reader: "/feature-registry",
  }),
  x({
    id: "v4-forced", label: "V4 forced direction", family: "direction", lifecycle: "ACTIVE",
    writer_kind: "continuous", storage: "desk_v4_frames", freshness_sla_s: 300,
    question: "If WAIT is removed, how good is the same market-prior/Council probability stream when it must pick UP or DOWN every observed window?",
    decision_use: "Separate directional skill from abstention policy and learn where in the window directional information is strongest.",
    exit_criterion: "After enough prospective windows to compare confidence/timing buckets and market Brier, freeze the result before changing timing/model logic.",
    reader: "/lab/v4-v5",
  }),
  x({
    id: "v5-profit-hunter", label: "V5 profit hunter", family: "execution-policy", lifecycle: "ACTIVE",
    writer_kind: "per-window", storage: "desk_v5_windows", freshness_sla_s: 1800,
    question: "Can repeated executable enter/exit/flip decisions monetize temporary mispricing better than settlement-only calls?",
    decision_use: "Measure whether the edge is directional forecasting, intrawindow execution, both, or neither.",
    exit_criterion: "After a large prospective sample, compare net after fees/spread by regime and trade count; freeze or retire before changing the policy.",
    reader: "/lab/v4-v5",
  }),
] as const;

export function validateLabInventory(items: readonly LabInventoryItem[] = LAB_INVENTORY): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`duplicate id: ${item.id}`);
    seen.add(item.id);
    if (!item.question.trim()) errors.push(`${item.id}: missing question`);
    if (!item.decision_use.trim()) errors.push(`${item.id}: missing decision_use`);
    if (!item.exit_criterion.trim()) errors.push(`${item.id}: missing exit_criterion`);
    if (!item.reader.trim()) errors.push(`${item.id}: missing reader`);
    if ((item.writer_kind === "continuous" || item.writer_kind === "per-window") && item.storage && item.freshness_sla_s == null)
      errors.push(`${item.id}: active writer has no freshness SLA`);
    if ((item.writer_kind === "derived" || item.writer_kind === "on-demand") && item.freshness_sla_s != null)
      errors.push(`${item.id}: derived/on-demand item must not masquerade as a freshness-checked writer`);
  }
  return errors;
}
