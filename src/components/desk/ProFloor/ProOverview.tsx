/**
 * The Pro Floor cockpit.
 *
 * The order is the order a reader needs it in: where the market is, what the
 * desk concludes, how far that is from its own standard, what the price says,
 * what the specialists see, what is blocking, and how far the data can be
 * trusted. FULL density adds the full Council tape and the deeper economics; it
 * adds detail, it never changes a number.
 *
 * Everything on screen comes from one pure transform of the live frame
 * (`proFloorFacts`), memoized so a tick does not rebuild it more than once.
 */
import { useMemo, type ReactNode } from "react";
import { proFloorFacts } from "@/lib/desk/pro-floor";
import type { CallLogRow, ChairResult, SeatId, SeatKnobs, Snapshot, Vote } from "@/lib/desk/types";
import type { FloorDensity } from "../prefs";
import { LastCallPanel } from "../LastCallPanel";
import { ProDecisionStrip } from "./ProDecisionStrip";
import { ProChairCard } from "./ProChairCard";
import { ProScoreBar } from "./ProScoreBar";
import { MarketModelCard } from "./MarketModelCard";
import { EvidenceFamilies } from "./EvidenceFamilies";
import { CouncilEvidenceTape } from "./CouncilEvidenceTape";
import { DecisionGates } from "./DecisionGates";
import { DataHealthCard } from "./DataHealthCard";
import { PaperPositionCard } from "./PaperPositionCard";

export function ProOverview({
  snap,
  chair,
  votes,
  callLog,
  knobs,
  plain,
  density,
  onJump,
  onGatesExpand,
  headline,
}: {
  snap: Snapshot;
  chair: ChairResult;
  votes: Vote[];
  callLog: CallLogRow[];
  knobs?: Record<string, SeatKnobs>;
  /** The Chair's plain-language line, composed by the caller. */
  plain: string;
  density: FloorDensity;
  onJump: (seat: SeatId) => void;
  onGatesExpand?: () => void;
  /**
   * The existing chair stage, rendered between the strip and the reason card.
   * It carries the full-scale verdict, the signal gauge and the call prices, so
   * the cockpit wraps it rather than drawing a second verdict of its own.
   */
  headline?: ReactNode;
}) {
  const facts = useMemo(
    () => proFloorFacts({ snap, chair, votes, callLog, knobs, plain }),
    [snap, chair, votes, callLog, knobs, plain],
  );
  const full = density === "full";

  return (
    <div className="flex flex-col gap-3">
      <LastCallPanel />
      <ProDecisionStrip facts={facts} />
      {headline}
      <ProChairCard facts={facts} plain={plain} />
      <ProScoreBar facts={facts} />
      <MarketModelCard facts={facts} full={full} />
      <EvidenceFamilies facts={facts} onJump={onJump} />
      {full ? <CouncilEvidenceTape facts={facts} onJump={onJump} /> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <DecisionGates facts={facts} onExpand={onGatesExpand} />
        <DataHealthCard facts={facts} />
      </div>
      <PaperPositionCard facts={facts} full={full} />
    </div>
  );
}
