import type { ChairResult, CallLogRow, Snapshot } from "./types";
import { bookState } from "./book-floor";

/** These sentences describe recorded Chair state; they never make a call. */
export function guidedRead(chair: ChairResult, snap: Snapshot, callLog: CallLogRow[]) {
  const book = bookState(snap, chair.lean, callLog);
  const feedBad = snap.health.spot !== "LIVE" || snap.health.kalshi !== "LIVE";
  if (book.kind === "booked") {
    return {
      label: `Paper call: ${book.lean}`,
      why: `The Council recorded a ${book.lean} paper call at ${book.cents.toFixed(0)}¢ for this window. It stays on the books until the official result. The current read can change while that call is held.`,
      note: "Already recorded · awaiting the official result",
      tone: book.lean === "UP" ? "text-up" : "text-down",
    };
  }
  if (feedBad) {
    return {
      label: "WAIT",
      why: "A live price or market quote needs a fresh check. The Council waits when it cannot trust the inputs.",
      note: "Feed check needed",
      tone: "text-wait",
    };
  }
  if (chair.lean === "WAIT") {
    const failed = chair.gates.filter((g) => g.hard && !g.pass);
    const priority = ["warden", "semantic", "seq", "derivs", "quote", "leftover", "chalk", "edge", "spread", "law", "early", "late", "quiet", "top3"];
    const id = priority.find((key) => failed.some((g) => g.id === key)) ?? failed[0]?.id;
    const reason = (() => {
      switch (id) {
        case "warden":
        case "semantic":
        case "seq":
        case "derivs":
          return { note: "Feed check needed", why: "One of the desk's data sources needs a fresh check. The Council waits rather than trusting a doubtful input." };
        case "quote":
          return { note: "Fresh market price needed", why: "The market quote is old. The Council waits for a fresh price." };
        case "leftover":
          return { note: "Market prices do not add up", why: "The two sides of the market are not adding up cleanly. The Council waits rather than trusting that price." };
        case "chalk":
          return { note: "Almost no gain left to buy", why: `One side already costs ${Math.max(snap.yes_ask, snap.no_ask).toFixed(0)}¢. There is almost no room left after the price and fee, so the Council waits.` };
        case "edge":
          return { note: "Price leaves too little room", why: "The current market price leaves too little room after costs. The Council waits for a better opportunity." };
        case "spread":
          return { note: "Price gap is too wide", why: "The gap between buying and selling prices is too wide to pay. The Council waits." };
        case "law":
          return { note: "Safety pause after misses", why: "The desk is in a temporary safety pause after misses. It waits for the pause to end." };
        case "early":
          return { note: "Early in the window", why: "It is early in this 15-minute window. The Council lets more evidence arrive before making a paper call." };
        case "late":
          return { note: "Window almost over", why: "This window is nearly over. The Council waits for the next one instead of rushing a paper call." };
        case "quiet":
          return { note: "Waiting for more movement", why: "The market is too quiet for a clear read. The Council waits for more movement." };
        case "top3":
          return { note: "Leading specialists disagree", why: "The leading specialists disagree. The Council waits for a clearer read." };
        default:
          return { note: "Waiting for a stronger read", why: "The evidence does not clear the Council's bar yet. Waiting is a real decision here." };
      }
    })();
    return { label: "WAIT", ...reason, tone: "text-wait" };
  }
  const side = chair.lean;
  return {
    label: `Council read: ${side}`,
    why: `${side} means the Council currently leans toward Bitcoin finishing ${side === "UP" ? "above" : "below"} the target line. This is a live paper read; check the Pro Floor for whether a call has actually been recorded.`,
    note: "Current read · paper only",
    tone: side === "UP" ? "text-up" : "text-down",
  };
}
