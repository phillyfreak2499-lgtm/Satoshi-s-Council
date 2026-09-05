import { num, str, type Params } from "../catalog";
import { finishPaper, paintWindow } from "../finish";
import type { RoomFactory, RoomWorld } from "../world";

const STATES: Record<string, { y: number; glow: string; dim: [number, number] }> = {
  hold: { y: 0.18, glow: "#c43a2a", dim: [0.05, 0.32] },
  wait: { y: 0.48, glow: "#d4a02a", dim: [0.36, 0.62] },
  up: { y: 0.82, glow: "#3ad056", dim: [0.68, 0.98] },
};

export const createField: RoomFactory = (iw, ih, _seed, params, _host): RoomWorld => {
  let w = iw;
  let h = ih;
  let stance = str(params, "stance", "up");
  let bloomAmt = num(params, "bloom", 1);
  let grainAmt = num(params, "grain", 0.28);
  let targetY = STATES[stance]?.y ?? 0.82;
  let orbY = targetY;
  let remain = 1;
  let clock = "0:03";

  const apply = (p: Params) => {
    stance = str(p, "stance", stance);
    bloomAmt = num(p, "bloom", bloomAmt);
    grainAmt = num(p, "grain", grainAmt);
    targetY = STATES[stance]?.y ?? targetY;
    remain = num(p, "remain", remain);
    clock = str(p, "clock", clock);
  };

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    reseed() {},
    setParams: apply,
    pointer() {},
    step(dt) {
      orbY += (targetY - orbY) * (1 - Math.exp(-9.5 * dt));
    },
    draw(ctx, w, h, t) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.0, "#7a1410");
      g.addColorStop(0.16, "#b01c16");
      g.addColorStop(0.3, "#c44a14");
      g.addColorStop(0.46, "#d8ae2e");
      g.addColorStop(0.58, "#8a9a22");
      g.addColorStop(0.74, "#1f9a3a");
      g.addColorStop(1.0, "#0c4a22");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const live = STATES[stance]?.dim ?? STATES.up.dim;
      const veil = ctx.createLinearGradient(0, 0, 0, h);
      veil.addColorStop(0, "rgba(0,0,0,0.42)");
      veil.addColorStop(Math.max(0, live[0] - 0.08), "rgba(0,0,0,0.42)");
      veil.addColorStop(live[0], "rgba(0,0,0,0)");
      veil.addColorStop(live[1], "rgba(0,0,0,0)");
      veil.addColorStop(Math.min(1, live[1] + 0.08), "rgba(0,0,0,0.38)");
      veil.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);

      const breathe = 0.5 + 0.5 * Math.sin(t / 900);
      const ox = w * 0.5;
      const oy = orbY * h;
      const r = w * (0.1 + 0.012 * breathe) * bloomAmt;
      const glow = STATES[stance]?.glow ?? "#3ad056";

      const wash = ctx.createRadialGradient(ox, oy, 0, ox, oy, w * 0.72);
      wash.addColorStop(0, glow + "66");
      wash.addColorStop(0.35, glow + "22");
      wash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      const bloom = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 4.2);
      bloom.addColorStop(0, "rgba(255,248,210,0.95)");
      bloom.addColorStop(0.12, "rgba(255,236,160,0.75)");
      bloom.addColorStop(0.28, glow + "aa");
      bloom.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(ox, oy, r * 4.2, 0, Math.PI * 2);
      ctx.fill();

      const core = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      core.addColorStop(0, "#fffdf2");
      core.addColorStop(0.35, "#ffe9a8");
      core.addColorStop(1, glow);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();

      finishPaper(ctx, w, h, grainAmt);
      paintWindow(ctx, w, h, {
        remain,
        label: clock,
        glow,
        cx: ox,
        cy: oy,
        radius: r * 1.62,
        mode: "orbit",
      });
    },
  };
};
