/**
 * Callsign guard — shared by the Arena's write path (the law), its read
 * paths (nothing blocked or hidden is ever printed), and the two client
 * forms (a faster no, never sufficient on its own).
 *
 * The denylist is stored as character codes so this file never carries the
 * words themselves. Matching runs on a compacted form: lower case, common
 * leetspeak folded back to letters, separators stripped, so spaced, dotted,
 * dashed and digit-swapped spellings all land on the same string. Repeated
 * letters are folded for a whole-string comparison only, so a real word that
 * merely contains a folded term is not caught by accident.
 *
 * Pure. No node imports, no logging, nothing here ever echoes a rejected name.
 */

/** The charset the Arena accepts: 2 to 16 letters, digits, spaces, dots, dashes or underscores. */
export const CALLSIGN_RE = /^[A-Za-z0-9 _\-.]{2,16}$/;
/** The one neutral line for a rejected callsign, reused by every surface. */
export const CALLSIGN_REJECT = "that callsign is not allowed — pick another";
/** What a blocked or hidden callsign prints as, wherever a name would have been. */
export const CALLSIGN_PUBLIC_LABEL = "paper";
/** Names the desk keeps for itself: the chair, the seats, the rooms. */
export const RESERVED_CALLSIGNS = ["satoshi", "the chair", "chair", "warden", "wick", "tape", "desk", "arena", "admin", "official"] as const;

const decode = (codes: readonly number[]): string => String.fromCharCode(...codes);

/** Terms blocked wherever they appear inside a callsign. Encoded; see the header. */
const CONTAINS: readonly string[] = [
  [110, 105, 103, 103, 101, 114],
  [110, 105, 103, 103, 97],
  [102, 97, 103, 103, 111, 116],
  [107, 105, 107, 101],
  [119, 101, 116, 98, 97, 99, 107],
  [114, 97, 103, 104, 101, 97, 100],
  [116, 111, 119, 101, 108, 104, 101, 97, 100],
  [98, 101, 97, 110, 101, 114],
  [116, 114, 97, 110, 110, 121],
  [104, 105, 116, 108, 101, 114],
  [99, 104, 105, 110, 107],
  [107, 107, 107],
  [106, 105, 103, 97, 98, 111, 111],
  [119, 104, 105, 116, 101, 112, 111, 119, 101, 114],
  [114, 101, 116, 97, 114, 100]
].map(decode);

/** Terms blocked only when they are the whole callsign, because ordinary words contain them. Encoded. */
const WHOLE: readonly string[] = [
  [102, 97, 103],
  [99, 111, 111, 110],
  [103, 111, 111, 107],
  [115, 112, 105, 99],
  [110, 97, 122, 105],
  [100, 121, 107, 101],
  [112, 97, 107, 105],
  [104, 101, 105, 108],
  [100, 97, 114, 107, 105, 101],
  [115, 112, 111, 111, 107],
  [110, 101, 103, 114, 111]
].map(decode);

const LEET: Record<string, string> = {
  "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "0": "o", "$": "s", "5": "s", "7": "t", "8": "b", "6": "g", "9": "g", "+": "t",
};

/** Trimmed, inner whitespace collapsed, lower case: the form two callsigns are compared in. */
export function normalize(name: unknown): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The normalized name with leetspeak folded to letters and every separator removed. */
export function compact(name: unknown): string {
  return normalize(name)
    .replace(/[1!|34@0$57869+]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9]/g, "");
}

const foldRuns = (s: string): string => s.replace(/(.)\1+/g, "$1");

/** True for the desk's own names, compared after normalization. */
export function isReserved(name: unknown): boolean {
  const c = compact(name);
  return c.length > 0 && RESERVED_CALLSIGNS.some((r) => compact(r) === c);
}

/** True when a callsign is reserved or carries a denylisted term in any spelling this guard folds. */
export function isBlocked(name: unknown): boolean {
  if (isReserved(name)) return true;
  const c = compact(name);
  if (!c) return false;
  if (CONTAINS.some((w) => c.includes(w))) return true;
  if (WHOLE.some((w) => c === w)) return true;
  const folded = foldRuns(c);
  return CONTAINS.some((w) => folded === foldRuns(w)) || WHOLE.some((w) => folded === foldRuns(w));
}

/** The charset check every callsign must pass first. Null when it does not. */
export function cleanCallsign(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return CALLSIGN_RE.test(s) ? s : null;
}

export type CallsignVerdict = { ok: true; name: string | null } | { ok: false; error: string; status: number };

/**
 * The write-path decision for a submitted callsign, made before any engine
 * or database work: an empty name is fine (the caller may already have one),
 * a blocked name is refused with the neutral line, anything else passes the
 * charset check or is handed back as null for the caller's own copy.
 */
export function callsignVerdict(raw: unknown): CallsignVerdict {
  const given = String(raw ?? "").trim();
  if (!given) return { ok: true, name: null };
  if (isBlocked(given)) return { ok: false, error: CALLSIGN_REJECT, status: 400 };
  return { ok: true, name: cleanCallsign(given) };
}

/** The name a public surface may print: the callsign itself, or the neutral label when it is blocked or hidden. */
export function publicLabel(name: unknown, opts: { hidden?: boolean } = {}): string {
  const s = String(name ?? "").trim();
  if (!s || opts.hidden || isBlocked(s)) return CALLSIGN_PUBLIC_LABEL;
  return s;
}
