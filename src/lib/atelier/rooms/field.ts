import { num, str, type Params } from "../catalog";
import { finishPaper, paintWindow } from "../finish";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type Palette = {
  y: number;
  glow: string;
  base: string;
  top: string;
  middle: string;
  bottom: string;
  veil: string;
  pale: string;
  direction: number;
};

type Dust = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  drift: number;
};

const STATES: Record<string, Palette> = {
  hold: {
    y: 0.68,
    glow: "#d15b4a",
    base: "#070606",
    top: "#2a0b09",
    middle: "#7b1d16",
    bottom: "#160807",
    veil: "#ef765f",
    pale: "#f1c09f",
    direction: 1,
  },
  wait: {
    y: 0.5,
    glow: "#d4a02a",
    base: "#080806",
    top: "#171309",
    middle: "#7d5d20",
    bottom: "#151108",
    veil: "#e7b84d",
    pale: "#f4ddb0",
    direction: 0.28,
  },
  up: {
    y: 0.32,
    glow: "#3fae7a",
    base: "#050807",
    top: "#07140e",
    middle: "#145f40",
    bottom: "#082419",
    veil: "#58cf94",
    pale: "#b9edd2",
    direction: -1,
  },
};

function makeDust(seed: number): Dust[] {
  const random = mulberry32(seed ^ 0x9e3779b9);
  return Array.from({ length: 120 }, () => ({
    x: random(),
    y: random(),
    radius: 0.3 + random() * 1.25,
    alpha: 0.04 + random() * 0.13,
    drift: 0.3 + random() * 0.8,
  }));
}

export const createField: RoomFactory = (iw, ih, initialSeed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let seed = initialSeed;
  let stance = str(params, "stance", "wait");
  let bloomAmt = num(params, "bloom", 1);
  let grainAmt = num(params, "grain", 0.22);
  let targetY = STATES[stance]?.y ?? STATES.wait.y;
  let orbY = targetY;
  let remain = 1;
  let clock = "0:03";
  let phase = 0;
  let dust = makeDust(seed);

  const apply = (next: Params) => {
    stance = str(next, "stance", stance);
    bloomAmt = num(next, "bloom", bloomAmt);
    grainAmt = num(next, "grain", grainAmt);
    targetY = STATES[stance]?.y ?? targetY;
    remain = num(next, "remain", remain);
    clock = str(next, "clock", clock);
  };

  return {
    resize(nextWidth, nextHeight) {
      w = nextWidth;
      h = nextHeight;
    },
    reseed(nextSeed) {
      seed = nextSeed;
      dust = makeDust(seed);
    },
    setParams: apply,
    pointer() {},
    step(dt) {
      phase += dt;
      orbY += (targetY - orbY) * (1 - Math.exp(-4.5 * dt));
    },
    draw(ctx) {
      const palette = STATES[stance] ?? STATES.wait;
      const vertical = ctx.createLinearGradient(0, 0, 0, h);
      vertical.addColorStop(0, palette.top);
      vertical.addColorStop(0.48, palette.middle);
      vertical.addColorStop(1, palette.bottom);
      ctx.fillStyle = vertical;
      ctx.fillRect(0, 0, w, h);

      const roomLight = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.78);
      roomLight.addColorStop(0, palette.glow + "24");
      roomLight.addColorStop(0.48, palette.glow + "0a");
      roomLight.addColorStop(1, palette.base + "00");
      ctx.fillStyle = roomLight;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let layer = 0; layer < 7; layer += 1) {
        const points: Array<[number, number]> = [];
        const baseY = h * (0.14 + layer * 0.12);
        const amplitude = h * (0.018 + layer * 0.0035);
        const frequency = 1.2 + layer * 0.19;
        const offset = phase * palette.direction * (0.2 + layer * 0.027) + layer * 1.37;
        const thickness = h * (0.052 + layer * 0.006);

        for (let step = 0; step <= 14; step += 1) {
          const x = (step / 14) * w;
          const y =
            baseY +
            Math.sin((step / 14) * Math.PI * 2 * frequency + offset) * amplitude +
            Math.sin((step / 14) * Math.PI * 4 - offset * 0.56) * amplitude * 0.36;
          points.push([x, y]);
        }

        const ribbon = ctx.createLinearGradient(0, baseY - thickness, w, baseY + thickness);
        ribbon.addColorStop(0, palette.glow + "05");
        ribbon.addColorStop(0.42, palette.veil + "24");
        ribbon.addColorStop(0.72, palette.pale + "16");
        ribbon.addColorStop(1, palette.glow + "04");
        ctx.globalAlpha = 0.28 + layer * 0.035;
        ctx.fillStyle = ribbon;
        ctx.beginPath();
        ctx.moveTo(points[0]![0], points[0]![1] - thickness);
        for (const [x, y] of points) ctx.lineTo(x, y - thickness * 0.5);
        for (let index = points.length - 1; index >= 0; index -= 1) {
          const [x, y] = points[index]!;
          ctx.lineTo(x, y + thickness * 0.5);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      const breathe = 0.5 + 0.5 * Math.sin(phase * 0.72);
      const ox = w * (0.5 + Math.sin(phase * 0.11) * 0.022);
      const oy = orbY * h;
      const shortSide = Math.min(w, h);
      const coreRadius = shortSide * (0.018 + 0.003 * breathe) * bloomAmt;

      const wash = ctx.createRadialGradient(ox, oy, 0, ox, oy, shortSide * 0.44 * bloomAmt);
      wash.addColorStop(0, palette.pale + "8a");
      wash.addColorStop(0.08, palette.glow + "58");
      wash.addColorStop(0.36, palette.glow + "24");
      wash.addColorStop(1, palette.glow + "00");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      const core = ctx.createRadialGradient(ox, oy, 0, ox, oy, coreRadius * 5.2);
      core.addColorStop(0, "rgba(255,253,239,0.98)");
      core.addColorStop(0.11, palette.pale + "ec");
      core.addColorStop(0.34, palette.glow + "a8");
      core.addColorStop(1, palette.glow + "00");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(ox, oy, coreRadius * 5.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const speck of dust) {
        const driftY = (speck.y + phase * 0.0025 * speck.drift * -palette.direction + 1) % 1;
        ctx.globalAlpha = speck.alpha * (0.68 + 0.32 * breathe);
        ctx.fillStyle = palette.pale;
        ctx.beginPath();
        ctx.arc(speck.x * w, driftY * h, speck.radius * Math.max(1, w / 900), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      finishPaper(ctx, w, h, grainAmt);
      paintWindow(ctx, w, h, {
        remain,
        label: clock,
        glow: palette.glow,
        cx: ox,
        cy: oy,
        radius: shortSide * 0.17,
        mode: "orbit",
      });
    },
  };
};
