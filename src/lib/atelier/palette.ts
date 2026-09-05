import type { Stance } from "./calls";

/** Shared climate of the original Stance field: hold red → wait gold → up green. */
const STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 0x7a, 0x14, 0x10],
  [0.16, 0xb0, 0x1c, 0x16],
  [0.3, 0xc4, 0x4a, 0x14],
  [0.46, 0xd8, 0xae, 0x2e],
  [0.58, 0x8a, 0x9a, 0x22],
  [0.74, 0x1f, 0x9a, 0x3a],
  [1.0, 0x0c, 0x4a, 0x22],
];

export type RGB = [number, number, number];

export const CALL_GLOW: Record<Stance, string> = {
  hold: "#c43a2a",
  wait: "#d4a02a",
  up: "#3ad056",
};

const CALL_BAND: Record<Stance, [number, number]> = {
  hold: [0.02, 0.32],
  wait: [0.34, 0.62],
  up: [0.66, 0.98],
};

export function sampleField(t: number): RGB {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i]!;
    if (x <= b[0]) {
      const a = STOPS[i - 1]!;
      const u = (x - a[0]) / (b[0] - a[0] || 1);
      return [
        (a[1] + (b[1] - a[1]) * u) | 0,
        (a[2] + (b[2] - a[2]) * u) | 0,
        (a[3] + (b[3] - a[3]) * u) | 0,
      ];
    }
  }
  return [12, 74, 34];
}

/** Sample the live call's band of the field. */
export function sampleCall(t: number, stance: Stance): RGB {
  const [a, b] = CALL_BAND[stance];
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return sampleField(a + (b - a) * x);
}

export function callPrint(stance: Stance): RGB[] {
  return [0, 0.22, 0.45, 0.7, 1].map((t) => sampleCall(t, stance));
}

export function cssRgb(c: RGB, a?: number) {
  return a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export const PAPER: RGB = [207, 200, 184];
export const INK: RGB = [26, 26, 26];
export const CREAM: RGB = [236, 231, 220];

export const PRINT: RGB[] = [
  [122, 20, 16],
  [196, 74, 20],
  [216, 174, 46],
  [31, 154, 58],
  [207, 200, 184],
  [12, 74, 34],
  [176, 28, 22],
];
