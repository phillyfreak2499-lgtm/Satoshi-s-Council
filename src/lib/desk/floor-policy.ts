/**
 * The active paper policy, made explicit and versioned.
 *
 * WHY THIS EXISTS. The desk's answer on THE FLOOR was an accidental composition:
 * the Chair decided a side, book-floor.ts decided whether 80¢ was payable, and
 * the position was held to settlement because nothing else had been written. None
 * of those three was named as a choice, so none could be competed against, and
 * "improve the exit" had nowhere to put an alternative.
 *
 * A FloorPolicy names all four slots — signal, entry, exit, risk — and pins each
 * to a frozen component version. FLOOR_V1 is exactly what the desk does today, so
 * deploying this changes no behaviour: it only gives the current behaviour a name
 * it can be measured against.
 *
 * THE FREEZE RULE, which is the whole point. A component's parameters are
 * immutable. PROVE180_V1 is "+10¢ within 180 seconds" forever. Changing the
 * target or the horizon does not edit PROVE180_V1; it creates PROVE180_V2, whose
 * prospective count starts at zero and which inherits none of V1's evidence. A
 * test fingerprints every parameter set so a silent edit fails loudly rather than
 * quietly re-labelling old results as evidence for a new rule.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO. It cannot generate candidates. The
 * registry below is a hand-written list, and the evaluation engine may rank and
 * (later) promote from it but never add to it. A system that invents parameter
 * variants until one looks profitable is not doing research, and the way to not
 * do that is to make candidate creation a code change someone has to read.
 *
 * AN EXIT CANDIDATE IS NOT A CHAIR. PROVE180_V1 has no opinion about UP or DOWN.
 * It can win the exit competition and thereby appear in a NEW FloorPolicy version
 * alongside the unchanged Chair — it can never replace the Chair by itself.
 *
 * Pure module: no clock, no state, no database, no imports from the engine.
 */

/** Which slot of the Floor policy a component fills. */
export const SELECTIVE_ENTRY_ID = "ENTRY_SELECTIVE_V1";
export const SELECTIVE_FROZEN_AT = "2026-09-15T14:05:13.000Z";
export const SELECTIVE_PARAMS = Object.freeze({
  floor_cents: 80,
  max_calls_per_day: 3,
  max_losses_per_day: 1,
  min_speaking: 3,
  min_families: 2,
  max_opposing: 0,
  min_seconds_left: 180,
  max_seconds_left: 600,
  min_edge_cents: 3,
  min_index_edge_cents: 0,
  max_spread_cents: 2,
  max_receipt_age_s: 10,
  max_spot_age_s: 15,
  max_index_age_s: 5,
  confirmation_seconds: 8,
  confirmation_frames: 3,
  timezone: "America/Chicago",
});

export type PolicyKind = "signal" | "entry" | "exit" | "risk";

/**
 * Where a candidate stands in the competition.
 *
 *   CHAMPION        the Floor policy the website currently answers from
 *   ACTIVE          a component inside the current Champion
 *   CONTROL         a permanent benchmark, never retired (HOLD)
 *   SHADOW          collecting prospective evidence, no authority
 *   LEADING         research rank #1 — which is NOT promotion eligibility
 *   EARLY_DATA      too little prospective evidence to read
 *   PROMOTION_READY every gate passed, waiting for a clean window boundary
 *   PROBATION       recently promoted, still being compared to its predecessor
 *   ROLLBACK        removed during probation
 *   RETIRED         no longer competing; kept in the archive
 */
export type LabStatus =
  | "CHAMPION"
  | "ACTIVE"
  | "CONTROL"
  | "SHADOW"
  | "LEADING"
  | "EARLY_DATA"
  | "PROMOTION_READY"
  | "PROBATION"
  | "ROLLBACK"
  | "RETIRED";

/** A frozen component. `params` is the definition; changing it needs a new version. */
export type Component = {
  /** Stable id, `FAMILY_Vn`. This is what observations are recorded against. */
  id: string;
  /** The hypothesis, stable across versions. */
  family: string;
  version: number;
  kind: PolicyKind;
  /** Short name for the board. */
  label: string;
  /** The frozen definition. Immutable — see the freeze rule above. */
  params: Readonly<Record<string, number | string | boolean>>;
  /** When this version was defined. */
  frozen_at: string;
  /** The permanent control, which is never retired and never promoted. */
  control?: boolean;
  /** What this component is for, in the terms a later reader will need. */
  why: string;
};

const c = (x: Component): Component => Object.freeze({ ...x, params: Object.freeze({ ...x.params }) });

/** The frozen date this registry was defined. Components added later carry their own. */
const FROZE = "2026-09-11T13:15:00.000Z";

// ---------------------------------------------------------------------------
// SIGNAL — who decides UP, DOWN or WAIT.
// ---------------------------------------------------------------------------

export const SIGNAL_CHAIR_V1 = c({
  id: "CHAIR_V1",
  family: "CHAIR",
  version: 1,
  kind: "signal",
  label: "Council Chair",
  params: { source: "runChair" },
  frozen_at: FROZE,
  why: "the twenty-one-seat vote as it stands today; the incumbent directional signal",
});

// ---------------------------------------------------------------------------
// ENTRY — whether the paper book pays the asking price.
// ---------------------------------------------------------------------------

export const ENTRY_80_V1 = c({
  id: "ENTRY_80_V1",
  family: "ENTRY_80",
  version: 1,
  kind: "entry",
  label: "80¢ floor",
  params: { floor_cents: 80 },
  frozen_at: FROZE,
  why: "the live paper floor as it stands today, mid time-boxed trial against the 70¢ shadow book",
});

export const ENTRY_SELECTIVE_V1 = c({
  id: SELECTIVE_ENTRY_ID,
  family: "ENTRY_SELECTIVE",
  version: 1,
  kind: "entry",
  label: "Selective 80¢ · max 3/day · pause after loss",
  params: SELECTIVE_PARAMS,
  frozen_at: SELECTIVE_FROZEN_AT,
  why: "owner-selected conservative admission: current team, fresh feeds, both price models, confirmation and daily limits; not a statistically proven promotion",
});

// ---------------------------------------------------------------------------
// EXIT — what happens to a position once it exists. The first competition.
// ---------------------------------------------------------------------------

export const EXIT_HOLD_V1 = c({
  id: "HOLD_V1",
  family: "HOLD",
  version: 1,
  kind: "exit",
  label: "HOLD",
  params: {},
  frozen_at: FROZE,
  control: true,
  why:
    "hold through settlement — what the desk does today, and the permanent control. " +
    "Never retired: every other exit's value is the difference from this one.",
});

/**
 * The PROVE family: require the market to confirm the position early, and cut it
 * if it does not.
 *
 * "+10¢ within N seconds" measured on the executable bid for the side actually
 * held. Reaching it marks the position PROVEN and it is then held to settlement.
 * Failing to reach it exits at the first valid sellable bid at or after the
 * deadline — not at the deadline's theoretical price, and never at a price the
 * book did not show.
 */
const prove = (version: number, seconds: number, frozen_at = FROZE): Component =>
  c({
    id: `PROVE${seconds}_V${version}`,
    family: `PROVE${seconds}`,
    version,
    kind: "exit",
    label: `PROVE-${seconds}`,
    params: { target_cents: 10, horizon_s: seconds },
    frozen_at,
    why: `require +10¢ on the held side's sellable bid within ${seconds}s; otherwise cut at the first valid bid after the deadline`,
  });

export const EXIT_PROVE120_V1 = prove(1, 120);
export const EXIT_PROVE180_V1 = prove(1, 180);
export const EXIT_PROVE240_V1 = prove(1, 240);

export const EXIT_TAKE90_V1 = c({
  id: "TAKE90_V1",
  family: "TAKE90",
  version: 1,
  kind: "exit",
  label: "TAKE-90",
  params: { take_cents: 90 },
  frozen_at: FROZE,
  why:
    "sell whenever the held side's bid genuinely reaches 90¢, else hold. A comparator, " +
    "not a favourite: it banks small wins and keeps every full loss.",
});

/** A separate trial: a target crossing must also realize a profit after both fees. */
export const EXIT_TAKE90_V2 = c({
  id: "TAKE90_V2",
  family: "TAKE90",
  version: 2,
  kind: "exit",
  label: "TAKE-90 net profit",
  params: { take_cents: 90, min_net_cents: 0 },
  frozen_at: "2026-09-14T16:44:11.000Z",
  why:
    "sell at the first held-side bid at least 90¢ that also earns a positive net profit after entry and exit fees; " +
    "otherwise hold. A separate paper trial: full settlement losses remain possible.",
});

// ---------------------------------------------------------------------------
// RISK — position sizing and veto. Nothing competes here yet.
// ---------------------------------------------------------------------------

export const RISK_NONE_V1 = c({
  id: "RISK_NONE_V1",
  family: "RISK_NONE",
  version: 1,
  kind: "risk",
  label: "one contract",
  params: { contracts: 1 },
  frozen_at: FROZE,
  why: "one paper contract per window, as today. Named so a risk policy can compete later.",
});

/** Every registered component. Hand-written: nothing may append to this at runtime. */
export const COMPONENTS: readonly Component[] = Object.freeze([
  SIGNAL_CHAIR_V1,
  ENTRY_80_V1,
  ENTRY_SELECTIVE_V1,
  EXIT_HOLD_V1,
  EXIT_PROVE120_V1,
  EXIT_PROVE180_V1,
  EXIT_PROVE240_V1,
  EXIT_TAKE90_V1,
  EXIT_TAKE90_V2,
  RISK_NONE_V1,
]);

/** The exit competition's entrants, control first. */
export const EXIT_CANDIDATES: readonly Component[] = Object.freeze(
  COMPONENTS.filter((x) => x.kind === "exit"),
);

/** Only entries at or after a candidate's definition can start prospective evidence. */
export function exitCandidatesForEntry(entryT: number): readonly Component[] {
  if (!Number.isFinite(entryT)) return [];
  return EXIT_CANDIDATES.filter((x) => entryT >= Date.parse(x.frozen_at));
}

export function componentById(id: string): Component | null {
  return COMPONENTS.find((x) => x.id === id) ?? null;
}

/** The control for a kind — the thing every candidate of that kind is measured against. */
export function controlFor(kind: PolicyKind): Component | null {
  return COMPONENTS.find((x) => x.kind === kind && x.control) ?? null;
}

// ---------------------------------------------------------------------------
// The composed policy.
// ---------------------------------------------------------------------------

export type FloorPolicyVersion = {
  policy_id: string;
  version: number;
  signal_policy: string;
  entry_policy: string;
  exit_policy: string;
  risk_policy: string;
  created_at: string;
  /** When this policy started being measured prospectively. */
  prospective_start_at: string;
  status: LabStatus;
};

/**
 * The initial Champion: exactly what the desk does today.
 *
 * Deploying this names the current behaviour; it does not alter it. The Chair
 * still decides, the 80¢ floor still gates the fill, and the position is still
 * held to settlement, because HOLD_V1 *is* holding to settlement.
 */
export const FLOOR_V1: FloorPolicyVersion = Object.freeze({
  policy_id: "FLOOR_V1",
  version: 1,
  signal_policy: SIGNAL_CHAIR_V1.id,
  entry_policy: ENTRY_80_V1.id,
  exit_policy: EXIT_HOLD_V1.id,
  risk_policy: RISK_NONE_V1.id,
  created_at: FROZE,
  prospective_start_at: FROZE,
  status: "CHAMPION",
});

/**
 * The fallback the desk must always be able to name.
 *
 * The owner-selected admission policy is also the named fallback. The original
 * FLOOR_V1 remains frozen above so historical fills retain their original meaning.
 */
export const FLOOR_SELECTIVE_V1: FloorPolicyVersion = Object.freeze({
  ...FLOOR_V1,
  policy_id: "FLOOR_SELECTIVE_V1",
  version: 2,
  entry_policy: ENTRY_SELECTIVE_V1.id,
  created_at: SELECTIVE_FROZEN_AT,
  prospective_start_at: SELECTIVE_FROZEN_AT,
});

export const SAFE_FALLBACK_POLICY = FLOOR_SELECTIVE_V1.policy_id;

/**
 * Compose a new policy version by replacing ONE component of an existing one.
 *
 * This is how a component promotion becomes a Champion: PROVE180_V1 winning the
 * exit competition does not make it the Champion, it produces
 * FLOOR_V2 = CHAIR_V1 + ENTRY_80_V1 + PROVE180_V1, and that is what competes.
 *
 * Refuses to swap a component into the wrong slot, and refuses a component that
 * is not in the registry — a policy pointing at an unregistered id would have no
 * frozen definition to reproduce later.
 */
export function composePolicy(
  base: FloorPolicyVersion,
  replacement: Component,
  opts: { policy_id: string; version: number; created_at: string; prospective_start_at: string },
): FloorPolicyVersion {
  if (!componentById(replacement.id)) {
    throw new Error(`composePolicy: ${replacement.id} is not a registered component`);
  }
  const slot: Record<PolicyKind, keyof FloorPolicyVersion> = {
    signal: "signal_policy",
    entry: "entry_policy",
    exit: "exit_policy",
    risk: "risk_policy",
  };
  return Object.freeze({
    ...base,
    ...opts,
    [slot[replacement.kind]]: replacement.id,
    status: "SHADOW" as LabStatus,
  });
}

/** A policy's four slots, resolved to their frozen definitions. */
export function resolvePolicy(p: FloorPolicyVersion): {
  signal: Component | null;
  entry: Component | null;
  exit: Component | null;
  risk: Component | null;
} {
  return {
    signal: componentById(p.signal_policy),
    entry: componentById(p.entry_policy),
    exit: componentById(p.exit_policy),
    risk: componentById(p.risk_policy),
  };
}

/** One line for the Floor's policy indicator: "Chair V1 + 80¢ floor + HOLD". */
export function policyLine(p: FloorPolicyVersion): string {
  const r = resolvePolicy(p);
  return [r.signal?.label, r.entry?.label, r.exit?.label].filter(Boolean).join(" + ");
}

/**
 * The parameter fingerprint a freeze test pins.
 *
 * Sorted so key order cannot change it, and including the id so a renamed family
 * is a different fingerprint. If this string changes for an existing component,
 * evidence recorded under that id no longer describes the rule it names — which
 * is the single most dangerous thing that can happen to this system.
 */
export function fingerprint(x: Component): string {
  const ps = Object.keys(x.params)
    .sort()
    .map((k) => `${k}=${String(x.params[k])}`)
    .join(",");
  return `${x.id}|${x.kind}|${ps}`;
}
