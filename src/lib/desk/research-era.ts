/**
 * Research eras: hard boundaries in the data, not notes in a comment.
 *
 * WHY A MODULE AND NOT A CONSTANT. On 2026-09-11 the local order book was
 * storing levels that had been cancelled down to floating-point residue — sizes
 * around 1e-13 sitting at real prices. 89.4% of every resting size the desk had
 * recorded was that residue. Anything computed from a size was wrong: depth, the
 * best quote when a phantom sat in front, and TAPE 2.0's normalised order-flow
 * imbalance, which divided by dust and reported values around 1e17.
 *
 * The arithmetic was fixed and the bad records were deliberately NOT repaired.
 * That is the honest choice — a retroactive repair invents numbers nobody
 * measured — but it leaves a trap: two stretches of data that look alike, are
 * stored in the same tables, and cannot be added together. A future report that
 * pools them would not fail. It would produce a plausible number built half out
 * of arithmetic residue, and nothing downstream would notice.
 *
 * So the boundary lives here, as the one place that decides which era a
 * timestamp belongs to, and the studies take a SPLIT rather than a flat array —
 * pooling has to be written on purpose, in a caller that says so, instead of
 * being the thing that happens when nobody thinks about it.
 *
 * ADDING AN ERA. A new boundary goes in ERAS with the moment it took effect and
 * what it invalidated. Nothing else should ever hard-code one of these dates.
 *
 * Pure module.
 */

/** The moment the phantom-level fix reached production. Deploy 218c4fb, verified live. */
export const QTY_FIX_AT = "2026-09-11T03:47:17.000Z";
export const QTY_FIX_MS = Date.parse(QTY_FIX_AT);

export type EraId = "pre-qty-fix" | "post-qty-fix";

export type EraInfo = {
  id: EraId;
  since: string | null;
  until: string | null;
  /** Is a measurement that depends on order-book SIZE usable in this era? */
  sizes_usable: boolean;
  why: string;
};

export const ERAS: Record<EraId, EraInfo> = {
  "pre-qty-fix": {
    id: "pre-qty-fix",
    since: null,
    until: QTY_FIX_AT,
    sizes_usable: false,
    why:
      "The book kept levels cancelled to floating-point residue: 89.4% of recorded resting sizes were " +
      "between 1e-18 and 2e-11. Any quantity read in this era — depth, touch size, normalised OFI, the best " +
      "quote when a phantom sat in front of it — is unusable and is not repaired.",
  },
  "post-qty-fix": {
    id: "post-qty-fix",
    since: QTY_FIX_AT,
    until: null,
    sizes_usable: true,
    why: "Levels below 1e-6 are dropped at every read and write, so a size means what it says.",
  },
};

/** Which era a moment belongs to. Accepts ms, an ISO string, or a Date. */
export function eraAt(t: number | string | Date): EraId {
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  if (!Number.isFinite(ms)) return "pre-qty-fix";
  return ms >= QTY_FIX_MS ? "post-qty-fix" : "pre-qty-fix";
}

/** Rows kept apart by era. Studies take one of these so pooling cannot be accidental. */
export type EraSplit<T> = {
  pre: T[];
  post: T[];
  /** Restated on the split itself, because a caller holding one may never see this file. */
  note: string;
};

export function splitByEra<T>(rows: readonly T[], at: (row: T) => number | string | Date): EraSplit<T> {
  const pre: T[] = [];
  const post: T[] = [];
  for (const r of rows) (eraAt(at(r)) === "post-qty-fix" ? post : pre).push(r);
  return {
    pre,
    post,
    note:
      `Split at ${QTY_FIX_AT}. ${pre.length} rows precede it and ${post.length} follow. ` +
      `Any measurement that reads an order-book SIZE is unusable in the earlier set and the two are never ` +
      `added together — see ERAS in research-era.ts for what was wrong and why it was not repaired.`,
  };
}

/**
 * The window where a study can honestly report. For anything that depends on
 * sizes this is the post-fix rows and nothing else; `pre` is carried so its
 * count can be shown rather than silently vanishing.
 */
export function usableFor(split: EraSplit<unknown>, dependsOnSizes: boolean): {
  n: number;
  discarded: number;
  era: EraId | "both";
  why: string;
} {
  if (!dependsOnSizes) {
    return {
      n: split.pre.length + split.post.length,
      discarded: 0,
      era: "both",
      why: "This measurement reads no order-book size, so the quantity fix did not change what it means.",
    };
  }
  return {
    n: split.post.length,
    discarded: split.pre.length,
    era: "post-qty-fix",
    why:
      `Depends on order-book sizes, so only the ${split.post.length} observations recorded after ` +
      `${QTY_FIX_AT} count. The ${split.pre.length} earlier ones are left in place and left out of every ` +
      `number here.`,
  };
}
