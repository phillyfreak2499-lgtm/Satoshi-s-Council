import type { ChairResult, Lean } from "./types";

const TIME_IDS = new Set(["early", "late"]);

/** Spec: ≥12m and ≤2.2m cut aggressiveness. They must not hard-WAIT the window. */
export function softenTimeGates(chair: ChairResult): ChairResult {
  const gates = chair.gates.map((g) => {
    if (!TIME_IDS.has(g.id)) return g;
    return {
      ...g,
      hard: false,
      label:
        g.id === "early"
          ? "Early window — aggressiveness ×0.55 (not a veto)"
          : "Late window — aggressiveness ×0.55 (not a veto)",
    };
  });
  const hardFail = gates.some((g) => g.hard && !g.pass);
  const vsBar = Math.abs(chair.score) * (chair.aggressiveness || 1);
  const gatePass = (id: string, fallback = true) => gates.find((g) => g.id === id)?.pass ?? fallback;
  let lean: Lean = chair.lean;
  if (
    lean === "WAIT" &&
    !hardFail &&
    gatePass("bar", vsBar >= chair.bar) &&
    gatePass("top3") &&
    gatePass("edge") &&
    gatePass("warden") &&
    gatePass("law") &&
    gatePass("chalk") &&
    gatePass("leftover") &&
    vsBar >= chair.bar &&
    chair.score !== 0
  ) {
    lean = chair.score > 0 ? "UP" : "DOWN";
  }
  return {
    ...chair,
    gates,
    hard_fail: hardFail,
    lean,
    decision: lean === chair.lean ? chair.decision : `${lean} · time veto lifted`,
  };
}
