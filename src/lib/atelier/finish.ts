export function makeGrain(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(w, h);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const noise = (Math.random() * 255) | 0;
    data[index] = data[index + 1] = data[index + 2] = noise;
    data[index + 3] = 40;
  }
  context.putImageData(image, 0, 0);
  return canvas;
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
  const vignette = ctx.createRadialGradient(
    w * 0.5,
    h * 0.45,
    w * 0.2,
    w * 0.5,
    h * 0.5,
    w * 0.78,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vignette;
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
  const lineWidth = Math.max(1.2, w * 0.0036);
  const start = -Math.PI / 2;

  ctx.strokeStyle = "rgba(255,248,230,0.14)";
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const tick = Math.max(3, w * 0.01);
  ctx.strokeStyle = "rgba(255,248,230,0.28)";
  ctx.lineWidth = Math.max(1, w * 0.0022);
  for (let index = 0; index < 4; index += 1) {
    const angle = start + (index * Math.PI) / 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cx + cosine * (radius - tick), cy + sine * (radius - tick));
    ctx.lineTo(cx + cosine * (radius + tick * 0.55), cy + sine * (radius + tick * 0.55));
    ctx.stroke();
  }

  if (remain > 0.001) {
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = lineWidth * 1.15;
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
