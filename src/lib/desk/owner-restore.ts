/**
 * OWNER_RESTORE_E1_PAIR_V1 — an INACTIVE, exact-scope POLICY INTERVENTION.
 *
 * NOT A MECHANICAL REPAIR. The Sep-18 call path is intact: replaying the same
 * fixtures through the 73acc612 (last fill) and 97dfcbb Chair → selective
 * admission → confirmation → noteCall code gives the same booking outcome.
 * The last-fill supporters went quiet because reviewSeats (the 15¢ scalp
 * EDGE_FLOOR review, with AUTO_SKILL_PROMOTION_ENABLED = false) benched their
 * cards and set seat_calib_debt = seat_n on 2026-09-19/20, and no code path
 * returns either. Undoing that is an owner decision about authority and
 * calibration, so it is written here as an explicit, versioned, default-OFF
 * intervention instead of being hidden inside a "fix".
 *
 * EXACT SCOPE. Two cards whose same-frame, same-side paper directions count as
 * two evidence groups under BOTH the production map (EVIDENCE_OF) and the
 * corrected E1 accounting (e1FamilyOf): STRIKE.itm_time (book) and
 * CHAIN.oi_with_price (derivs). STREAK.continue_young is deliberately left
 * out: with STRIKE it is one effective book family (P1).
 *
 * Second, separate owner choice (mode STATUS_AND_STRIKE_CALIBRATION): lower the
 * STRIKE seat's calibration debt by exactly the amount that puts its effective
 * calibration n at WARM_N (20). The Chair row then stops reading UNCALIBRATED,
 * while seatCalib(20) = 0 leaves its listen weight and sit weight exactly where
 * they are today. It refuses if seat_n or the debt moved from the approved
 * values. STATUS_ONLY never touches calibration: STRIKE then re-earns it
 * through the unchanged grading path (seat_n grows only on graded reads).
 *
 * DEFAULT OFF. Nothing happens unless OWNER_RESTORE_E1_PAIR_V1 is set to an
 * exact mode string. Every precondition fails closed, the change is all or
 * nothing, it is applied at most once (marker on the learner, persisted with
 * it), it records the values it replaced, and ROLLBACK restores exactly those
 * values when nothing has moved them since. STATUS_ONLY may later be upgraded
 * with the calibration step alone (same version); nothing else re-applies.
 *
 * UNCHANGED BY DESIGN. Chair (bar, time factor, sit-mass, fold), speak bar,
 * the per-frame authority guard (directionalHoldReason), selective admission
 * (2 supporters / 2 families / 0 opposing, 180–600 s, 80¢ floor, spread, size,
 * model edge ≥ 3¢, index edge, 3 frames over 8 s), team/edge guards, daily
 * risk, huddle bench rules, the frozen seat review, grading and the follower.
 *
 * Pure module: no clock and no I/O beyond reading the switch from the env it
 * is given. The engine passes `now` and the mode.
 */
import { directionalHoldReason } from "./council-authority.ts";
import { WARM_N } from "./math.ts";
import type { Learner, SkillCard, SkillStatus } from "./types";

export const OWNER_RESTORE_E1_PAIR_V1 = "OWNER_RESTORE_E1_PAIR_2026_09_30_V1" as const;
export const OWNER_RESTORE_ENV = "OWNER_RESTORE_E1_PAIR_V1" as const;
export const OWNER_RESTORE_CARDS = Object.freeze(["STRIKE.itm_time", "CHAIN.oi_with_price"] as const);
/** Values the owner approves against: committed DB_VERIFIED snapshot
 *  docs/audit/seat_review_snapshot_2026-09-22.json (STRIKE seat_n 210, debt 210).
 *  The debt must still be exactly 210 and seat_n at least 210 (grading only adds).
 *  The lead re-reads both through the supported minimal projection before
 *  activation; if they moved, the calibration step refuses instead of guessing. */
export const OWNER_RESTORE_STRIKE_CALIBRATION = Object.freeze({ seat: "STRIKE", expect_seat_n: 210, expect_debt: 210 });

export type OwnerRestoreMode = "OFF" | "STATUS_ONLY" | "STATUS_AND_STRIKE_CALIBRATION" | "ROLLBACK";
const ACTIVE_MODES: readonly OwnerRestoreMode[] = ["STATUS_ONLY", "STATUS_AND_STRIKE_CALIBRATION", "ROLLBACK"];

/** Exact-string switch. Anything else, including "true", is OFF. */
export function ownerRestoreMode(env: Record<string, string | undefined> = process.env): OwnerRestoreMode {
  const raw = env[OWNER_RESTORE_ENV];
  return typeof raw === "string" && (ACTIVE_MODES as readonly string[]).includes(raw) ? (raw as OwnerRestoreMode) : "OFF";
}

/** The persisted marker (Learner.owner_restore). */
export type OwnerRestoreState = NonNullable<Learner["owner_restore"]>;
type Values = OwnerRestoreState["prior"];

export type OwnerRestoreReceipt = {
  version: typeof OWNER_RESTORE_E1_PAIR_V1;
  mode: OwnerRestoreMode;
  outcome: "OFF" | "APPLIED" | "ALREADY_DONE" | "REFUSED" | "ROLLED_BACK" | "ROLLBACK_REFUSED";
  changed: boolean;
  reason: string;
  status: { card: string; from: SkillStatus; to: SkillStatus }[];
  debt: { seat: string; from: number | null; to: number | null }[];
};

function receipt(mode: OwnerRestoreMode, outcome: OwnerRestoreReceipt["outcome"], reason: string): OwnerRestoreReceipt {
  return { version: OWNER_RESTORE_E1_PAIR_V1, mode, outcome, changed: false, reason, status: [], debt: [] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Bad numeric data must not slip through the authority guard's comparisons. */
function authorityHold(learner: Learner, id: typeof OWNER_RESTORE_CARDS[number]): string | null {
  const card: SkillCard | undefined = learner.skills?.[id];
  if (!card) return `${id} is missing`;
  if (card.id !== id || card.owner !== id.split(".")[0]) return `${id} has mismatched card identity`;
  if (!isCount(card.n) || !isCount(card.ev_n) ||
      typeof card.wilson !== "number" || !Number.isFinite(card.wilson) || card.wilson < 0 || card.wilson > 1 ||
      typeof card.ev !== "number" || !Number.isFinite(card.ev)) {
    return `${id} has invalid numeric authority inputs`;
  }
  for (const required of [card.min_walkforward_n, card.min_regime_n]) {
    if (required != null && !isCount(required)) return `${id} has invalid numeric authority inputs`;
  }
  if (card.min_regime_n && !isCount(card.pocket?.[""]?.n ?? 0)) {
    return `${id} has invalid numeric authority inputs`;
  }
  const hold = directionalHoldReason(
    { lean: "UP", skill_used: id, skill_status: "LIVE" },
    { skills: { [id]: { ...card, status: "LIVE" } } },
    "",
  );
  return hold ? `${id} fails existing authority: ${hold}` : null;
}

/**
 * STRIKE calibration step, computed without mutating. Approved against debt 210;
 * seat_n may only have grown since (grading is the only writer). Lifts the
 * effective calibration n to exactly WARM_N when it is below it, else no change.
 */
function strikeCalibrationStep(learner: Learner): { ok: true; from: number; to: number } | { ok: false; reason: string } {
  const cal = OWNER_RESTORE_STRIKE_CALIBRATION;
  const n = learner.seat_n?.[cal.seat];
  const debt = learner.seat_calib_debt?.[cal.seat];
  if (!isCount(n) || n < cal.expect_seat_n || !isCount(debt) || debt !== cal.expect_debt) {
    return { ok: false, reason: `STRIKE calibration inputs moved (seat_n ${n ?? "missing"}, debt ${debt ?? "missing"}; approved seat_n >= ${cal.expect_seat_n}, debt ${cal.expect_debt})` };
  }
  return { ok: true, from: debt, to: n - debt >= WARM_N ? debt : n - WARM_N };
}

/** Apply the owner's decision to a freshly restored learner. Mutates only on APPLIED/ROLLED_BACK. */
export function applyOwnerRestore(learner: Learner, mode: OwnerRestoreMode, now: number): OwnerRestoreReceipt {
  if (mode === "OFF") return receipt(mode, "OFF", "default off: no owner restore mode set");
  if (mode === "ROLLBACK") return rollbackOwnerRestore(learner, now);
  if (!(ACTIVE_MODES as readonly string[]).includes(mode)) return receipt(mode, "REFUSED", "unknown owner restore mode");
  if (!isTime(now)) return receipt(mode, "REFUSED", "invalid clock");
  const marker = learner.owner_restore;
  if (marker !== undefined) {
    if (!isRecord(marker) || marker.version !== OWNER_RESTORE_E1_PAIR_V1) return receipt(mode, "REFUSED", "unknown owner restore marker version; left for the lead");
    if (!wellFormed(marker)) return receipt(mode, "REFUSED", "owner restore marker is malformed; left for the lead");
    if (marker.state === "ROLLED_BACK") return receipt(mode, "ALREADY_DONE", "rolled back; a new restoration needs a new owner-approved version");
    if (marker.mode === "STATUS_ONLY" && mode === "STATUS_AND_STRIKE_CALIBRATION") return upgradeWithCalibration(learner, marker, now);
    return receipt(mode, "ALREADY_DONE", marker.mode === mode
      ? "already applied once; nothing re-applied"
      : "calibration already applied; only ROLLBACK can undo it");
  }

  const prior: Values = { status: {}, debt: {} };
  for (const id of OWNER_RESTORE_CARDS) {
    const card = learner.skills?.[id];
    if (!card) return receipt(mode, "REFUSED", `${id} is missing`);
    if (card.status !== "SHADOW") return receipt(mode, "REFUSED", `${id} is ${card.status}, not SHADOW`);
    // The same authority the Chair re-checks, with finite numeric inputs.
    const hold = authorityHold(learner, id);
    if (hold) return receipt(mode, "REFUSED", hold);
    prior.status[id] = card.status;
  }
  let step: { from: number; to: number } | null = null;
  if (mode === "STATUS_AND_STRIKE_CALIBRATION") {
    const c = strikeCalibrationStep(learner);
    if (!c.ok) return receipt(mode, "REFUSED", c.reason);
    step = c;
  }

  // All preconditions passed: apply atomically.
  const out = receipt(mode, "APPLIED", mode === "STATUS_ONLY"
    ? "owner restore applied: status only; STRIKE calibration re-earned by normal grading"
    : "owner restore applied: status + STRIKE effective calibration n lifted to WARM_N");
  const applied: Values = { status: {}, debt: {} };
  for (const id of OWNER_RESTORE_CARDS) {
    learner.skills[id]!.status = "LIVE";
    applied.status[id] = "LIVE";
    out.status.push({ card: id, from: prior.status[id]!, to: "LIVE" });
  }
  if (step) applyStrikeStep(learner, step, prior, applied, out);
  learner.owner_restore = { version: OWNER_RESTORE_E1_PAIR_V1, mode: mode as OwnerRestoreState["mode"], state: "APPLIED", applied_at: now, prior, applied };
  out.changed = true;
  return out;
}

function applyStrikeStep(learner: Learner, step: { from: number; to: number }, prior: Values, applied: Values, out: OwnerRestoreReceipt) {
  const seat = OWNER_RESTORE_STRIKE_CALIBRATION.seat;
  prior.debt[seat] = step.from;
  applied.debt[seat] = step.to;
  if (step.to !== step.from) {
    if (!learner.seat_calib_debt) learner.seat_calib_debt = {};
    learner.seat_calib_debt[seat] = step.to;
  }
  out.debt.push({ seat, from: step.from, to: step.to });
}

/** STATUS_ONLY first, calibration later: add only the calibration step to the same version. */
function upgradeWithCalibration(learner: Learner, marker: OwnerRestoreState, now: number): OwnerRestoreReceipt {
  const mode: OwnerRestoreMode = "STATUS_AND_STRIKE_CALIBRATION";
  if (!wellFormed(marker)) return receipt(mode, "REFUSED", "owner restore marker is malformed; left for the lead");
  if (!isTime(now) || now < (marker.upgraded_at ?? marker.applied_at)) return receipt(mode, "REFUSED", "invalid clock before status restore");
  for (const [id, to] of Object.entries(marker.applied.status)) {
    const current = learner.skills?.[id]?.status;
    if (current !== to) return receipt(mode, "REFUSED", `${id} moved to ${current ?? "missing"} after the status restore; left for the lead`);
  }
  for (const id of OWNER_RESTORE_CARDS) {
    const hold = authorityHold(learner, id);
    if (hold) return receipt(mode, "REFUSED", hold);
  }
  const c = strikeCalibrationStep(learner);
  if (!c.ok) return receipt(mode, "REFUSED", c.reason);
  const out = receipt(mode, "APPLIED", "owner restore upgraded: STRIKE effective calibration n lifted to WARM_N");
  const prior: Values = { status: { ...marker.prior.status }, debt: { ...marker.prior.debt } };
  const applied: Values = { status: { ...marker.applied.status }, debt: { ...marker.applied.debt } };
  applyStrikeStep(learner, c, prior, applied, out);
  learner.owner_restore = { ...marker, mode: "STATUS_AND_STRIKE_CALIBRATION", prior, applied, upgraded_at: now };
  out.changed = true;
  return out;
}

function wellFormed(marker: unknown): marker is OwnerRestoreState {
  if (!isRecord(marker) || marker.version !== OWNER_RESTORE_E1_PAIR_V1 ||
      (marker.mode !== "STATUS_ONLY" && marker.mode !== "STATUS_AND_STRIKE_CALIBRATION") ||
      (marker.state !== "APPLIED" && marker.state !== "ROLLED_BACK") || !isTime(marker.applied_at)) return false;
  if (marker.upgraded_at !== undefined &&
      (marker.mode !== "STATUS_AND_STRIKE_CALIBRATION" || !isTime(marker.upgraded_at) || marker.upgraded_at < marker.applied_at)) return false;
  if (marker.state === "ROLLED_BACK") {
    if (!isTime(marker.rolled_back_at) || marker.rolled_back_at < (marker.upgraded_at ?? marker.applied_at)) return false;
  } else if (marker.rolled_back_at !== undefined) return false;
  if (!isRecord(marker.prior) || !isRecord(marker.applied)) return false;
  const { prior, applied } = marker;
  if (!isRecord(prior.status) || !isRecord(applied.status) || !isRecord(prior.debt) || !isRecord(applied.debt)) return false;
  const hasKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  };
  if (!hasKeys(prior.status, OWNER_RESTORE_CARDS) || !hasKeys(applied.status, OWNER_RESTORE_CARDS)) return false;
  for (const id of OWNER_RESTORE_CARDS) {
    if (prior.status[id] !== "SHADOW" || applied.status[id] !== "LIVE") return false;
  }
  if (marker.mode === "STATUS_ONLY") return hasKeys(prior.debt, []) && hasKeys(applied.debt, []);
  const cal = OWNER_RESTORE_STRIKE_CALIBRATION;
  const appliedDebt = applied.debt[cal.seat];
  return hasKeys(prior.debt, [cal.seat]) && hasKeys(applied.debt, [cal.seat]) &&
    prior.debt[cal.seat] === cal.expect_debt && isCount(appliedDebt) &&
    appliedDebt >= cal.expect_seat_n - WARM_N && appliedDebt <= cal.expect_debt;
}

/** Restore exactly the recorded prior values, but only where nothing else has moved them. */
export function rollbackOwnerRestore(learner: Learner, now: number): OwnerRestoreReceipt {
  if (!isTime(now)) return receipt("ROLLBACK", "ROLLBACK_REFUSED", "invalid clock");
  const marker = learner.owner_restore;
  if (!marker || marker.version !== OWNER_RESTORE_E1_PAIR_V1) return receipt("ROLLBACK", "ROLLBACK_REFUSED", "no applied owner restore to roll back");
  if (!wellFormed(marker)) return receipt("ROLLBACK", "ROLLBACK_REFUSED", "owner restore marker is malformed; left for the lead");
  if (marker.state === "ROLLED_BACK") return receipt("ROLLBACK", "ALREADY_DONE", "already rolled back");
  if (now < (marker.upgraded_at ?? marker.applied_at)) return receipt("ROLLBACK", "ROLLBACK_REFUSED", "invalid clock before restore");
  for (const [id, to] of Object.entries(marker.applied.status)) {
    const card = learner.skills?.[id];
    if (!card) return receipt("ROLLBACK", "ROLLBACK_REFUSED", `${id} is missing`);
    if (card.status !== to) return receipt("ROLLBACK", "ROLLBACK_REFUSED", `${id} moved to ${card.status} after the restore; left for the lead`);
  }
  for (const [seat, to] of Object.entries(marker.applied.debt)) {
    if ((learner.seat_calib_debt?.[seat] ?? null) !== to) {
      return receipt("ROLLBACK", "ROLLBACK_REFUSED", `${seat} calibration debt moved after the restore; left for the lead`);
    }
  }
  const out = receipt("ROLLBACK", "ROLLED_BACK", "owner restore rolled back to the recorded prior values");
  for (const [id, from] of Object.entries(marker.prior.status)) {
    out.status.push({ card: id, from: learner.skills[id]!.status, to: from });
    learner.skills[id]!.status = from;
  }
  for (const [seat, from] of Object.entries(marker.prior.debt)) {
    out.debt.push({ seat, from: learner.seat_calib_debt?.[seat] ?? null, to: from });
    if (!learner.seat_calib_debt) learner.seat_calib_debt = {};
    if (from == null) delete learner.seat_calib_debt[seat];
    else learner.seat_calib_debt[seat] = from;
  }
  learner.owner_restore = { ...marker, state: "ROLLED_BACK", rolled_back_at: now };
  out.changed = true;
  return out;
}
