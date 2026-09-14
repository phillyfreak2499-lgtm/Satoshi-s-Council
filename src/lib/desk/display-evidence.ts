/** Stable text for both the server render and the first browser render. */
export function utcStamp(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** A display threshold only; this never grants a strategy any authority. */
export const DISPLAY_SAMPLE_MIN = 20;

export function sampleRate(rate: number | null, n: number): string {
  if (!n || rate == null || !Number.isFinite(rate)) return "No observations";
  if (n < DISPLAY_SAMPLE_MIN) return `Small sample · n=${n}`;
  return `${Math.round(rate * 100)}% · n=${n}`;
}

/** Human positions exclude both the desk benchmark and unranked warm-up rows. */
export function humanRanks<T extends { name: string; warming?: boolean }>(rows: T[]): Map<string, number> {
  return new Map(rows.filter((row) => !row.warming).map((row, index) => [row.name, index + 1]));
}
