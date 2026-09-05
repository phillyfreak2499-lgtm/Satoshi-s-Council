export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextSeed(seed: number) {
  const r = mulberry32(seed ^ 0x9e3779b9);
  return (r() * 0xffffffff) >>> 0;
}

export function formatSeed(seed: number) {
  return (seed >>> 0).toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
}

export function randRange(rng: () => number, a: number, b: number) {
  return a + rng() * (b - a);
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[(rng() * arr.length) | 0]!;
}
