import { callOf } from "../calls";
import { num, type Params } from "../catalog";
import { finishPaper, paintWindow } from "../finish";
import { createNoise2D } from "../noise";
import { CALL_GLOW, cssRgb, sampleCall } from "../palette";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type Particle = { x: number; y: number; px: number; py: number; hue: number };

export const createFlow: RoomFactory = (iw, ih, seed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let scale = num(params, "scale", 0.004);
  let speed = num(params, "speed", 0.85);
  let curl = num(params, "curl", 0.35);
  let call = callOf(params);
  let remain = 1;
  let clock = "0:03";
  let noise = createNoise2D(mulberry32(seed));
  let parts: Particle[] = [];
  let px = -1;
  let py = -1;
  let dirty = true;

  const spawn = (count: number) => {
    const rng = mulberry32((seed ^ (count * 7919)) >>> 0);
    parts = Array.from({ length: count }, () => {
      const x = rng() * w;
      const y = rng() * h;
      return { x, y, px: x, py: y, hue: rng() };
    });
  };

  const reset = () => {
    noise = createNoise2D(mulberry32(seed));
    spawn(Math.min(1600, Math.max(420, ((w * h) / 380) | 0)));
    dirty = true;
  };
  reset();

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
      reset();
    },
    reseed(s) {
      seed = s;
      reset();
    },
    setParams(p: Params) {
      scale = num(p, "scale", scale);
      speed = num(p, "speed", speed);
      curl = num(p, "curl", curl);
      call = callOf(p);
      remain = num(p, "remain", remain);
      clock = typeof p.clock === "string" ? p.clock : clock;
    },
    pointer(x, y, kind) {
      if (kind === "up") {
        px = -1;
        py = -1;
        return;
      }
      px = x;
      py = y;
    },
    step(dt) {
      const sp = speed * 70 * dt;
      const s = scale;
      for (const p of parts) {
        p.px = p.x;
        p.py = p.y;
        const n = noise(p.x * s, p.y * s);
        let ang = n * Math.PI * 2 + curl * 0.9;
        if (px >= 0) {
          const dx = p.x - px;
          const dy = p.y - py;
          const d = Math.hypot(dx, dy) + 1;
          const pull = Math.exp(-d / (w * 0.22));
          ang += Math.atan2(dy, dx) + Math.PI / 2 * pull * 1.4;
        }
        p.x += Math.cos(ang) * sp;
        p.y += Math.sin(ang) * sp;
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          p.x = Math.random() * w;
          p.y = Math.random() * h;
          p.px = p.x;
          p.py = p.y;
        }
      }
    },
    draw(ctx) {
      if (dirty) {
        ctx.fillStyle = "#0b0b0c";
        ctx.fillRect(0, 0, w, h);
        dirty = false;
      } else {
        ctx.fillStyle = "rgba(11,11,12,0.085)";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.lineWidth = Math.max(1.15, w / 420);
      ctx.lineCap = "round";
      for (const p of parts) {
        const c = sampleCall(p.hue * 0.35 + (p.y / h) * 0.65, call);
        ctx.strokeStyle = cssRgb(c, 0.72);
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      finishPaper(ctx, w, h, 0.14);
      paintWindow(ctx, w, h, {
        remain,
        label: clock,
        glow: CALL_GLOW[call],
        mode: "colophon",
      });
    },
  };
};
