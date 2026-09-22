/**
 * The four frozen shadow manifests. Hand-written; nothing may append to this
 * at runtime. A parameter change is a new experiment version with zero
 * evidence, never an edit. `prospective_start_at` is null here by design: it
 * is set by an owner-approved activation in the database, at the actual
 * activation instant, and never backdated.
 */
import { SELECTIVE_ENTRY_ID, ENTRY_SELECTIVE_V3, fingerprint } from "./floor-policy.ts";
import { COMPONENT_MIN, ECONOMIC } from "./promotion-gates.ts";
import { E1_ROSTER_CARDS, JUMP_VETO, MIRROR35, NULL_FAV_SCHEDULE_SECS, SETTLE_BASIS_CANDIDATES_BPS, SETTLE_BASIS_ROLE } from "./shadow-arms.ts";
import { SHADOW_FEE_FINGERPRINT, SHADOW_FUTILITY_LOOK_FILLS, SHADOW_HARD_DD_STOP_CENTS, SHADOW_LAB_VERSION, SHADOW_MAX_ACTIVE, SHADOW_MAX_DD_WORSE_THAN_CONTROL_CENTS, SHADOW_OPERATOR_ALERT_DD_CENTS, countsAgainstCap, manifestFingerprint, type ShadowManifest } from "./shadow-lab.ts";

// Evidence timestamps are the commits that actually froze each specimen.
const CORE_FROZEN_AT = "2026-09-22T02:07:19.000Z"; // d1e0d6c… Phase C E1–E3
const MIRROR_FROZEN_AT = "2026-09-22T03:10:57.000Z"; // 6ac907a… MIRROR-35 registration
const SOURCE_SHA = "11fab5b5bc73020941fd05fee04eed2174314d28";
const POLICY = fingerprint(ENTRY_SELECTIVE_V3);

const gates = { min_fills: COMPONENT_MIN.fills, min_days: COMPONENT_MIN.days, min_paired_control_losses: COMPONENT_MIN.paired_control_losses, futility_look_fills: SHADOW_FUTILITY_LOOK_FILLS, min_paired_delta_cents: ECONOMIC.min_paired_delta_cents, confidence: ECONOMIC.confidence } as const;
const risk = { hard_dd_stop_cents: SHADOW_HARD_DD_STOP_CENTS, max_dd_worse_than_control_cents: SHADOW_MAX_DD_WORSE_THAN_CONTROL_CENTS, operator_alert_dd_cents: SHADOW_OPERATOR_ALERT_DD_CENTS } as const;

const freeze = (m: ShadowManifest): ShadowManifest => Object.freeze({ ...m, arms: Object.freeze(m.arms.map((a) => Object.freeze({ ...a, params: Object.freeze({ ...a.params }) }))) });

export const E1_UNMUTE_DEDUP_SHELF_V1: ShadowManifest = freeze({
  version: SHADOW_LAB_VERSION, id: "UNMUTE_DEDUP_SHELF_V1", experiment_version: 1, status: "CANDIDATE", frozen_at: CORE_FROZEN_AT, prospective_start_at: null,
  hypothesis: "A verified reconstruction of the era-B mid-window speaking package, under explicit selective gates with duplicate influence controlled and a valid MID review, adds after-fee net beyond a simple price-favourite benchmark at the same floor.",
  fingerprints: { fee: SHADOW_FEE_FINGERPRINT, policy: POLICY, model: "CHAIR_V1 runChair with E1_UNMUTE twins; no fitted model", roster: `E1_ROSTER_CARDS=${E1_ROSTER_CARDS.join(",")}; family override STREAK->book`, source_sha: SOURCE_SHA },
  arms: [
    { id: "PKG_85", role: "candidate", description: "reconstructed package, 85¢ floor, deployed 2-of-2 quorum with STREAK counted as book, CARRY/CHAIN one derivs group", decision_schedule_secs: [600, 180], params: { floor_cents: 85, min_speaking: 2, min_families: 2, roster: E1_ROSTER_CARDS }, promotable: true },
    { id: "NULL_FAV_85", role: "control", description: "buy the ≥85¢ favourite at T−7:30, T−5 frozen fallback; spread ≤2, size ≥1, fresh feeds; no Council, no model edge", decision_schedule_secs: NULL_FAV_SCHEDULE_SECS, params: { floor_cents: 85 }, promotable: false },
    { id: "PKG_80", role: "secondary", description: "same package at the live 80¢ floor", decision_schedule_secs: [600, 180], params: { floor_cents: 80, min_speaking: 2, min_families: 2, roster: E1_ROSTER_CARDS }, promotable: true },
    { id: "NULL_FAV_80", role: "control", description: "favourite benchmark at 80¢", decision_schedule_secs: NULL_FAV_SCHEDULE_SECS, params: { floor_cents: 80 }, promotable: false },
    { id: "PKG_88", role: "secondary", description: "same package at an 88¢ floor", decision_schedule_secs: [600, 180], params: { floor_cents: 88, min_speaking: 2, min_families: 2, roster: E1_ROSTER_CARDS }, promotable: true },
    { id: "NULL_FAV_88", role: "control", description: "favourite benchmark at 88¢", decision_schedule_secs: NULL_FAV_SCHEDULE_SECS, params: { floor_cents: 88 }, promotable: false },
    { id: "PKG_85_OWNER3", role: "reference", description: "the package under the owner-reference 3-of-2 quorum; labelled, never relabelled as the deployed policy", decision_schedule_secs: [600, 180], params: { floor_cents: 85, min_speaking: 3, min_families: 2, roster: E1_ROSTER_CARDS }, promotable: false },
    { id: "LIVE_MUTED_BOOK", role: "reference", description: "the production paper book as observed (≈0 fills): the second reference, never edited", decision_schedule_secs: [], params: {}, promotable: false },
  ],
  primary_contrast: { candidate: "PKG_85", control: "NULL_FAV_85", metric: "paired_net_per_100_windows_and_per_week" },
  secondary_contrasts: [{ candidate: "PKG_80", control: "NULL_FAV_80", label: "80¢ floor" }, { candidate: "PKG_88", control: "NULL_FAV_88", label: "88¢ floor" }],
  eligible_population: "every KXBTC15M window closing after activation with an official result and research_quality = valid; both arms priced at their own decision ticks",
  training_cutoff: null, pairing: "window",
  latency_assumption: "an intention is a fill only if the ask survives 150 ms in the lag capture; 500 ms reported; missing resolution = UNKNOWN, never a fill",
  size: { contracts: 1 }, risk, gates, multiplicity: { method: "bonferroni", contrasts: 3 },
  kill_criteria: ["futility at 150 qualified fills: mean paired delta ≤ 0 benches the candidate", "candidate drawdown ≤ −258¢ or > 50¢ worse than control invalidates", "> 25 shadow fills per 100 windows triggers investigation, not a quota", "improvement confined to one regime, a cheap shelf or stale quotes is not promotable", "any authority contamination, mid-price fill or broken pairing invalidates the specimen"],
  authority: "none",
});

export const E2_WARDEN_JUMP_VETO_V1: ShadowManifest = freeze({
  version: SHADOW_LAB_VERSION, id: "WARDEN_JUMP_VETO_V1", experiment_version: 1, status: "CANDIDATE", frozen_at: CORE_FROZEN_AT, prospective_start_at: null,
  hypothesis: "A fixed cooldown after a qualifying ask shock improves net on opportunities the frozen base policy would actually book.",
  fingerprints: { fee: SHADOW_FEE_FINGERPRINT, policy: POLICY, model: "none", roster: "base = E1 PKG_85 intention stream", source_sha: SOURCE_SHA },
  arms: [
    { id: "BASE_NO_VETO", role: "control", description: "the frozen base policy (E1 PKG_85) without any cooldown", decision_schedule_secs: [600, 180], params: {}, promotable: false },
    { id: "VETO_8S", role: "candidate", description: `8 s cooldown after |Δask| ≥ ${JUMP_VETO.threshold_cents}¢ on either side; re-entry only through the base schedule with new inputs`, decision_schedule_secs: [600, 180], params: { threshold_cents: JUMP_VETO.threshold_cents, cooldown_ms: JUMP_VETO.primary_cooldown_ms }, promotable: true },
    { id: "VETO_15S", role: "secondary", description: "15 s cooldown sensitivity", decision_schedule_secs: [600, 180], params: { threshold_cents: JUMP_VETO.threshold_cents, cooldown_ms: 15_000 }, promotable: false },
    { id: "VETO_30S", role: "secondary", description: "30 s cooldown sensitivity", decision_schedule_secs: [600, 180], params: { threshold_cents: JUMP_VETO.threshold_cents, cooldown_ms: 30_000 }, promotable: false },
    { id: "CURRENT_CHAIR", role: "reference", description: "the production Chair's qualified entries (≈0): reported separately; no benefit is claimed from the shock population", decision_schedule_secs: [], params: {}, promotable: false },
  ],
  primary_contrast: { candidate: "VETO_8S", control: "BASE_NO_VETO", metric: "paired_net_per_100_windows_and_per_week" },
  secondary_contrasts: [{ candidate: "VETO_15S", control: "BASE_NO_VETO", label: "15 s" }, { candidate: "VETO_30S", control: "BASE_NO_VETO", label: "30 s" }],
  eligible_population: "windows where BASE_NO_VETO had an intention; shocks scored one first-opportunity per window; feed-flap annotations kept apart",
  training_cutoff: null, pairing: "window",
  latency_assumption: "shock time from the lag capture's receipt clock; a veto is never a fill; delayed replacement entries are counted",
  size: { contracts: 1 }, risk, gates, multiplicity: { method: "bonferroni", contrasts: 3 },
  kill_criteria: ["the vetoed subset is economically beneficial", "adjusted strategy net deteriorates", "the only positive slice disappears", "timestamp resolution insufficient for the mechanism", "frozen risk or integrity gates fail"],
  authority: "none",
});

export const E3_SETTLE_BASIS_MEASURED_V1: ShadowManifest = freeze({
  version: SHADOW_LAB_VERSION, id: "SETTLE_BASIS_MEASURED_V1", experiment_version: 1, status: "CANDIDATE", frozen_at: CORE_FROZEN_AT, prospective_start_at: null,
  hypothesis: "The 2 bps settlement-basis allowance (a 1σ term added to σ in quadrature) understates the measured spot-to-index noise and admits marginal negative-net entries near the strike.",
  fingerprints: { fee: SHADOW_FEE_FINGERPRINT, policy: POLICY, model: `fairYesCentsWithBasis; role=${SETTLE_BASIS_ROLE}; live=${SETTLE_BASIS_CANDIDATES_BPS.live}bps`, roster: "base = E1 PKG_85 intention stream", source_sha: SOURCE_SHA },
  arms: [
    { id: "BASIS_LIVE_2BPS", role: "control", description: "the E1 base specimen with the live 2 bps basis", decision_schedule_secs: [600, 180], params: { basis_bps: SETTLE_BASIS_CANDIDATES_BPS.live }, promotable: false },
    { id: "BASIS_7BPS", role: "candidate", description: "7 bps as a conservative 1σ buffer (measured σ ≈ 4.2–4.5 bps from p50/p95 |basis| of 2.8/8.8 bps; 7 ≈ 1.6σ)", decision_schedule_secs: [600, 180], params: { basis_bps: SETTLE_BASIS_CANDIDATES_BPS.primary }, promotable: true },
    { id: "BASIS_5BPS", role: "secondary", description: "5 bps sensitivity", decision_schedule_secs: [600, 180], params: { basis_bps: 5 }, promotable: false },
    { id: "BASIS_9BPS", role: "secondary", description: "9 bps sensitivity", decision_schedule_secs: [600, 180], params: { basis_bps: 9 }, promotable: false },
  ],
  primary_contrast: { candidate: "BASIS_7BPS", control: "BASIS_LIVE_2BPS", metric: "paired_net_per_100_windows_and_per_week" },
  secondary_contrasts: [{ candidate: "BASIS_5BPS", control: "BASIS_LIVE_2BPS", label: "5 bps" }, { candidate: "BASIS_9BPS", control: "BASIS_LIVE_2BPS", label: "9 bps" }],
  eligible_population: "windows where BASIS_LIVE_2BPS had an intention; identical known-at-time spot, strike, ATR, time, asks and fees; the final-minute partial average is collected but never enters an entry",
  training_cutoff: null, pairing: "window",
  latency_assumption: "as E1",
  size: { contracts: 1 }, risk, gates, multiplicity: { method: "bonferroni", contrasts: 3 },
  kill_criteria: ["at the 150-fill look: improvement < +0.5¢/fill or ≥ 30% of control wins blocked, judged with total paired net", "no retuning to rescue a failed arm", "frozen risk or integrity gates fail"],
  authority: "none",
});

/**
 * MIRROR-35 (external hypothesis, 2026-09-22): the fourth hypothesis. The lab
 * caps collection at three, so it is registered CANDIDATE_NOT_COLLECTING and
 * takes a slot only if an owner retires one of E1–E3 with a documented reason.
 * Its historical +2.4¢/fill came from a ~60-cell price/time search and is
 * discovery-biased; the internal replay reproduction flips sign out of sample
 * (train +1.89¢/fill, test −0.60¢/fill; docs/SHADOW_EXPERIMENTS_2026-09-22.md).
 */
export const E4_MIRROR_35_V1: ShadowManifest = freeze({
  version: SHADOW_LAB_VERSION, id: "MIRROR_35_V1", experiment_version: 1, status: "CANDIDATE_NOT_COLLECTING", frozen_at: MIRROR_FROZEN_AT, prospective_start_at: null,
  hypothesis: "A first-touch buy of the cheap side at an ask in [30, 45) between T−5 and T−2, held to settlement at the real ask with the applicable fee, has positive after-fee net out of sample.",
  fingerprints: { fee: SHADOW_FEE_FINGERPRINT, policy: POLICY, model: "none (price rule)", roster: "none", source_sha: SOURCE_SHA },
  arms: [
    { id: "MIRROR_35", role: "candidate", description: `cheap side ask in [${MIRROR35.lo_cents}, ${MIRROR35.hi_cents}), first touch only, T−${MIRROR35.hi_secs}s..T−${MIRROR35.lo_secs}s, one fill per window, HOLD`, decision_schedule_secs: [MIRROR35.hi_secs, MIRROR35.lo_secs], params: { lo_cents: MIRROR35.lo_cents, hi_cents: MIRROR35.hi_cents, lo_secs: MIRROR35.lo_secs, hi_secs: MIRROR35.hi_secs, discovery_cells_searched: MIRROR35.discovery_cells_searched }, promotable: true },
    { id: "NO_TRADE", role: "control", description: "sit: net 0 on every window (the cheap side's benchmark is not trading it)", decision_schedule_secs: [], params: {}, promotable: false },
    { id: "MIRROR_35_EXEC", role: "secondary", description: "same signal priced at the hypothetical executable quote (+1 s ask when resting size ≥ 1, else no fill)", decision_schedule_secs: [MIRROR35.hi_secs, MIRROR35.lo_secs], params: { slippage_model: "next_observed_ask" }, promotable: false },
  ],
  primary_contrast: { candidate: "MIRROR_35", control: "NO_TRADE", metric: "paired_net_per_100_windows_and_per_week" },
  secondary_contrasts: [{ candidate: "MIRROR_35_EXEC", control: "NO_TRADE", label: "executable quote" }],
  eligible_population: "every window with an official result after activation; fields: signal timestamp, side, signal ask, bid, size at ask, next observed ask, +1/+2/+5/+60 s asks where available, hypothetical execution price, settlement, fee, pnl, slippage, quote disappearance",
  training_cutoff: null, pairing: "window",
  latency_assumption: "signal quote vs executable quote recorded separately; missing sub-second resolution = UNKNOWN, never a fill",
  size: { contracts: 1 }, risk, gates, multiplicity: { method: "bonferroni", contrasts: 2 },
  kill_criteria: ["futility at 150 qualified fills: mean net ≤ 0 benches", "drawdown ≤ −258¢ invalidates", "positive only at a cell not in the frozen definition", "any production Chair fill authorised by this arm invalidates the specimen"],
  authority: "none",
});

export const SHADOW_MANIFESTS: readonly ShadowManifest[] = Object.freeze([E1_UNMUTE_DEDUP_SHELF_V1, E2_WARDEN_JUMP_VETO_V1, E3_SETTLE_BASIS_MEASURED_V1, E4_MIRROR_35_V1]);

/**
 * The only manifests allowed to begin the first prospective collection epoch.
 * Kept explicit instead of "all CANDIDATE" so adding a future candidate cannot
 * silently start collecting on the next deploy. MIRROR-35 is intentionally absent.
 */
export const INITIAL_SHADOW_COLLECTION_IDS: readonly string[] = Object.freeze([
  E1_UNMUTE_DEDUP_SHELF_V1.id,
  E2_WARDEN_JUMP_VETO_V1.id,
  E3_SETTLE_BASIS_MEASURED_V1.id,
]);

/** The three-active rule, checked over the registry. */
export function activeShadowCount(manifests: readonly ShadowManifest[] = SHADOW_MANIFESTS): number {
  return manifests.filter((m) => countsAgainstCap(m.status)).length;
}
export function capRespected(manifests: readonly ShadowManifest[] = SHADOW_MANIFESTS): boolean {
  return activeShadowCount(manifests) <= SHADOW_MAX_ACTIVE;
}

export function manifestById(id: string): ShadowManifest | null {
  return SHADOW_MANIFESTS.find((m) => m.id === id) ?? null;
}

export const SHADOW_MANIFEST_FINGERPRINTS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(SHADOW_MANIFESTS.map((m) => [m.id, manifestFingerprint(m)])));

export { SELECTIVE_ENTRY_ID as SHADOW_BASE_POLICY_ID };
