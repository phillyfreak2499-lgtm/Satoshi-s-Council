import type { PublicLabSpecimen } from "./lab-public";

/** Clamp a saved page after a refresh changes the number of public rows. */
export function pageIndex(total: number, requested: number, size: number): number {
  const last = Math.max(0, Math.ceil(total / size) - 1);
  return Math.max(0, Math.min(last, Number.isFinite(requested) ? Math.trunc(requested) : 0));
}

/** Deterministic on the server and browser, including the long-date fallback. */
export function evidenceAge(value: string, asOf: string): string {
  const then = Date.parse(value);
  const now = Date.parse(asOf);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return value;
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(value));
}

/** Present existing matched evidence; never subtract averages from different populations. */
export function labComparisons(specimens: PublicLabSpecimen[], controlId: string) {
  const control = specimens.find((row) => row.id === controlId) ?? null;
  const candidates = specimens.filter((row) => !row.control && row.id !== controlId);
  const comparisons = candidates.map((row) => ({
    row,
    delta: control && row.paired_n > 0 && row.paired_delta != null && Number.isFinite(row.paired_delta)
      ? row.paired_delta : null,
  }));
  const reached = candidates.filter((row) =>
    row.sample_gate.required > 0 && Number.isFinite(row.sample_gate.current) &&
    row.sample_gate.current >= row.sample_gate.required,
  ).length;
  return { control, candidates, comparisons, reached };
}

/** Keep a visitor's line breaks while retaining the existing 400-character limit. */
export function cleanBoardBody(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split("\n").map((line) => line.replace(/[^\S\n]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, 400);
}

export type PrivateBoardContactKind = "LEGAL" | "TRADEMARK" | "SECURITY";

/** Exact first-line marker for Board posts that must never enter the public feed. */
export function privateBoardContactKind(value: unknown): PrivateBoardContactKind | null {
  const first = String(value ?? "").replace(/\r\n?/g, "\n").split("\n", 1)[0]?.trim();
  return first === "LEGAL" || first === "TRADEMARK" || first === "SECURITY" ? first : null;
}
