export function makeGrain(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = n;
    d[i + 3] = 40;
  }
  g.putImageData(img, 0, 0);
  return c;
}

let grain: HTMLCanvasElement | null = null;

export function grainCanvas() {
  if (!grain) grain = makeGrain(400, 500);
  return grain;
}

export function finishPaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grainAlpha = 0.28,
) {
  if (grainAlpha > 0) {
    ctx.globalAlpha = grainAlpha;
    ctx.drawImage(grainCanvas(), 0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.2, w * 0.5, h * 0.5, w * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

/** Remaining fraction of the paper window, drawn as part of the work. */
export function paintWindow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    remain: number;
    label: string;
    glow: string;
    cx?: number;
    cy?: number;
    radius?: number;
    mode?: "orbit" | "colophon";
  },
) {
  const remain = Math.min(1, Math.max(0, opts.remain));
  const mode = opts.mode ?? "orbit";
  const glow = opts.glow;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (mode === "colophon") {
    const x = w * 0.5;
    const y = h * 0.935;
    const half = Math.min(w, h) * 0.11;
    ctx.strokeStyle = "rgba(236,231,220,0.18)";
    ctx.lineWidth = Math.max(1, w * 0.0018);
    ctx.beginPath();
    ctx.moveTo(x - half, y);
    ctx.lineTo(x + half, y);
    ctx.stroke();
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x - half, y);
    ctx.lineTo(x - half + half * 2 * remain, y);
    ctx.stroke();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = "rgba(236,231,220,0.72)";
    ctx.font = `${Math.max(9, Math.round(w * 0.026))}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.letterSpacing = "0.22em";
    ctx.fillText(opts.label, x, y - Math.max(6, w * 0.012));
    ctx.restore();
    return;
  }

  const cx = opts.cx ?? w * 0.5;
  const cy = opts.cy ?? h * 0.5;
  const radius = opts.radius ?? Math.min(w, h) * 0.12;
  const lw = Math.max(1.2, w * 0.0036);
  const start = -Math.PI / 2;

  ctx.strokeStyle = "rgba(255,248,230,0.14)";
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const tick = Math.max(3, w * 0.01);
  ctx.strokeStyle = "rgba(255,248,230,0.28)";
  ctx.lineWidth = Math.max(1, w * 0.0022);
  for (let i = 0; i < 4; i++) {
    const a = start + (i * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + c * (radius - tick), cy + s * (radius - tick));
    ctx.lineTo(cx + c * (radius + tick * 0.55), cy + s * (radius + tick * 0.55));
    ctx.stroke();
  }

  if (remain > 0.001) {
    const pulse = remain < 0.18 ? 0.55 + 0.45 * Math.sin(performance.now() / 180) : 1;
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.82 * pulse;
    ctx.lineWidth = lw * 1.15;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + remain * Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "rgba(255,248,230,0.7)";
  ctx.font = `${Math.max(10, Math.round(w * 0.032))}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.letterSpacing = "0.22em";
  ctx.fillText(opts.label, cx, cy + radius + Math.max(8, w * 0.02));
  ctx.restore();
}
