/** Display-only coverage: retain the market clock and never invent missing prices. */
export function replayRuns(offsets: readonly number[], stepMs: number): number[][] {
  const runs: number[][] = [];
  const gapMs = Math.max(12_000, stepMs * 3);
  offsets.forEach((t, i) => {
    if (!i || (t - offsets[i - 1]) * 1000 > gapMs) runs.push([]);
    runs[runs.length - 1].push(i);
  });
  return runs;
}

export function replayCoverage(
  t0: number,
  offsets: readonly number[],
  closeMs: number,
  stepMs: number,
) {
  const open = closeMs - 900_000;
  const times = offsets
    .map((t) => t0 + t * 1000)
    .filter((t) => Number.isFinite(t) && t >= open && t <= closeMs);
  const gapMs = Math.max(12_000, stepMs * 3);
  const gaps: { from: number; to: number }[] = [];
  let last = open;
  for (const t of times) {
    if (t - last > gapMs) gaps.push({ from: (last - open) / 1000, to: (t - open) / 1000 });
    last = t;
  }
  if (closeMs - last > gapMs) gaps.push({ from: (last - open) / 1000, to: 900 });
  return {
    gaps,
    startSeconds: times.length ? (times[0] - open) / 1000 : null,
    endSeconds: times.length ? (times[times.length - 1] - open) / 1000 : null,
    gapMs,
  };
}
