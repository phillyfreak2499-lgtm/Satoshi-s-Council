import { callOf } from "../calls";
import { num, type Params } from "../catalog";
import { finishPaper, paintWindow } from "../finish";
import { CALL_GLOW, sampleCall } from "../palette";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type Src = { x: number; y: number };

export const createWave: RoomFactory = (iw, ih, seed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let wavelength = num(params, "wave", 28);
  let speed = num(params, "speed", 0.9);
  let contrast = num(params, "contrast", 1);
  let call = callOf(params);
  let remain = 1;
  let clock = "0:03";
  let sources: Src[] = [];
  let lowW = 160;
  let lowH = 200;
  let img: ImageData | null = null;
  let off: HTMLCanvasElement | null = null;
  let octx: CanvasRenderingContext2D | null = null;

  const place = () => {
    const rng = mulberry32(seed);
    sources = [
      { x: 0.22 + rng() * 0.1, y: 0.28 + rng() * 0.1 },
      { x: 0.78 - rng() * 0.1, y: 0.3 + rng() * 0.12 },
      { x: 0.5 + (rng() - 0.5) * 0.2, y: 0.78 },
    ];
  };

  const prep = () => {
    lowW = Math.max(120, Math.round(w * 0.28));
    lowH = Math.max(150, Math.round(h * 0.28));
    if (!off) off = document.createElement("canvas");
    off.width = lowW;
    off.height = lowH;
    octx = off.getContext("2d", { alpha: false });
    img = octx ? octx.createImageData(lowW, lowH) : null;
  };

  place();
  prep();

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
      prep();
    },
    reseed(s) {
      seed = s;
      place();
    },
    setParams(p: Params) {
      wavelength = num(p, "wave", wavelength);
      speed = num(p, "speed", speed);
      contrast = num(p, "contrast", contrast);
      call = callOf(p);
      remain = num(p, "remain", remain);
      clock = typeof p.clock === "string" ? p.clock : clock;
    },
    pointer(x, y, kind) {
      if (kind !== "down") return;
      sources.push({ x: x / w, y: y / h });
      if (sources.length > 6) sources.shift();
    },
    step() {},
    draw(ctx, _w, _h, t) {
      if (!img || !octx || !off) return;
      const data = img.data;
      const freq = (Math.PI * 2) / Math.max(6, wavelength);
      const phase = (t / 1000) * speed * 4;
      const nsrc = sources.length || 1;
      const k = contrast;
      for (let yy = 0; yy < lowH; yy++) {
        for (let xx = 0; xx < lowW; xx++) {
          const u = xx / (lowW - 1);
          const v = yy / (lowH - 1);
          let sum = 0;
          for (const s of sources) {
            const dx = (u - s.x) * 2;
            const dy = (v - s.y) * 2.4;
            const dist = Math.sqrt(dx * dx + dy * dy) * 80;
            sum += Math.sin(dist * freq - phase);
          }
          let n = (sum / nsrc) * k;
          n = (n + 1) * 0.5;
          n = n < 0 ? 0 : n > 1 ? 1 : n;
          const col = sampleCall(n, call);
          const i = (yy * lowW + xx) * 4;
          data[i] = col[0];
          data[i + 1] = col[1];
          data[i + 2] = col[2];
          data[i + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, w, h);
      finishPaper(ctx, w, h, 0.18);
      paintWindow(ctx, w, h, {
        remain,
        label: clock,
        glow: CALL_GLOW[call],
        mode: "colophon",
      });
    },
  };
};
