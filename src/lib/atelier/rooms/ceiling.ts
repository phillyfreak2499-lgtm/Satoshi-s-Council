import { num, str, type Params } from "../catalog";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type TrailPoint = { p: number; value: number };
type CloudCell = {
  x: number;
  y: number;
  size: number;
  depth: number;
  alpha: number;
  lobes: number;
  tone: number;
};
type SkyStar = { x: number; y: number; alpha: number; size: number };

const ORANGE = "#f7931a";
const YES_GREEN = "#52c58b";
const DOWN_RED = "#ca5b50";
const STEEL = "#7890a0";
const WHITE = "#edf2f4";

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function parseTrail(raw: string): TrailPoint[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => {
      const [p, value] = item.split(":").map(Number);
      return { p, value };
    })
    .filter((point) => Number.isFinite(point.p) && Number.isFinite(point.value))
    .map((point) => ({ p: clamp(point.p, 0, 1), value: point.value }))
    .sort((a, b) => a.p - b.p)
    .slice(-48);
}

function makeAtmosphere(seed: number): { clouds: CloudCell[]; stars: SkyStar[] } {
  const random = mulberry32(seed ^ 0x6c8e9cf5);
  const clouds = Array.from({ length: 48 }, () => ({
    x: -0.08 + random() * 1.16,
    y: random() * 2 - 1,
    size: 0.38 + random() * 0.82,
    depth: random(),
    alpha: 0.42 + random() * 0.58,
    lobes: 3 + Math.floor(random() * 3),
    tone: random(),
  })).sort((a, b) => a.depth - b.depth);
  const stars = Array.from({ length: 56 }, () => ({
    x: random(),
    y: random(),
    alpha: 0.16 + random() * 0.54,
    size: 0.35 + random() * 1.25,
  }));
  return { clouds, stars };
}

function money(value: number) {
  const rounded = Math.round(Math.abs(value));
  return `${value >= 0 ? "+" : "−"}$${rounded.toLocaleString("en-US")}`;
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  size: number,
  alpha = 0.82,
) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = `rgba(237,242,244,${alpha})`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function aircraft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
  color: string,
  ghost = false,
  gear = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = ghost ? 0.42 : 1;
  ctx.shadowColor = color;
  ctx.shadowBlur = ghost ? size * 0.65 : size * 0.9;

  const dark = ghost ? "rgba(237,242,244,0.2)" : "#7a3508";
  const mid = ghost ? "rgba(237,242,244,0.48)" : "#d9680b";
  const bright = ghost ? "rgba(255,255,255,0.8)" : "#ffb245";

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(size * 0.44, -size * 0.03);
  ctx.lineTo(-size * 0.44, -size * 0.84);
  ctx.lineTo(-size * 0.7, -size * 0.72);
  ctx.lineTo(-size * 0.31, -size * 0.02);
  ctx.lineTo(-size * 0.88, -size * 0.2);
  ctx.lineTo(-size * 1.02, -size * 0.05);
  ctx.closePath();
  ctx.fill();

  const body = ctx.createLinearGradient(-size, -size * 0.25, size, size * 0.2);
  body.addColorStop(0, dark);
  body.addColorStop(0.52, mid);
  body.addColorStop(1, bright);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(size * 1.18, 0);
  ctx.quadraticCurveTo(size * 0.64, -size * 0.22, -size * 0.58, -size * 0.16);
  ctx.lineTo(-size * 0.98, 0);
  ctx.lineTo(-size * 0.58, size * 0.16);
  ctx.quadraticCurveTo(size * 0.64, size * 0.22, size * 1.18, 0);
  ctx.fill();

  ctx.fillStyle = ghost ? "rgba(255,255,255,0.52)" : ORANGE;
  ctx.beginPath();
  ctx.moveTo(size * 0.38, size * 0.04);
  ctx.lineTo(-size * 0.42, size * 0.9);
  ctx.lineTo(-size * 0.7, size * 0.78);
  ctx.lineTo(-size * 0.3, size * 0.05);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = ghost ? "rgba(255,255,255,0.35)" : "#8fd4df";
  ctx.beginPath();
  ctx.ellipse(size * 0.48, -size * 0.09, size * 0.2, size * 0.085, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bright;
  ctx.beginPath();
  ctx.arc(size * 1.08, 0, Math.max(1, size * 0.055), 0, Math.PI * 2);
  ctx.fill();

  if (gear) {
    ctx.strokeStyle = bright;
    ctx.lineWidth = Math.max(1.2, size * 0.07);
    ctx.beginPath();
    ctx.moveTo(-size * 0.08, size * 0.14);
    ctx.lineTo(-size * 0.14, size * 0.54);
    ctx.moveTo(size * 0.38, size * 0.1);
    ctx.lineTo(size * 0.34, size * 0.46);
    ctx.stroke();
  }
  ctx.restore();
}

function cloudVolume(
  ctx: CanvasRenderingContext2D,
  cloud: CloudCell,
  w: number,
  h: number,
  horizon: number,
  tight: number,
  phase: number,
) {
  const z = 0.16 + cloud.depth * 0.96;
  const spread = 0.4 + z * 1.06;
  const cx =
    w * 0.5 +
    (cloud.x - 0.5) * w * spread +
    Math.sin(phase * (0.018 + cloud.depth * 0.022) + cloud.tone * 9) * w * (0.001 + z * 0.004);
  const cy =
    horizon +
    Math.pow(cloud.depth, 1.45) * h * (0.13 + tight * 0.055) +
    cloud.y * h * (0.012 + z * 0.027);
  const scale = (0.23 + cloud.depth * 1.12) * cloud.size;
  const rx = w * (0.038 + cloud.size * 0.042) * scale;
  const ry = h * (0.035 + cloud.size * 0.038) * scale * (0.8 + tight * 0.32);
  const baseAlpha = cloud.alpha * (0.22 + tight * 0.2) * (0.48 + z * 0.52);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.48)";
  ctx.shadowBlur = ry * 0.75;
  ctx.fillStyle = `rgba(4,10,16,${baseAlpha * 0.8})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.42, rx * 1.08, ry * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  for (let lobe = 0; lobe < cloud.lobes; lobe += 1) {
    const t = cloud.lobes === 1 ? 0.5 : lobe / (cloud.lobes - 1);
    const wobble = Math.sin(cloud.tone * 31 + lobe * 2.7);
    const lx = cx + (t - 0.5) * rx * 1.22 + wobble * rx * 0.13;
    const ly = cy - Math.abs(wobble) * ry * 0.28 - (lobe % 2) * ry * 0.12;
    const radius = Math.max(rx * (0.52 + (lobe % 2) * 0.12), ry * 1.2);
    const glow = ctx.createRadialGradient(lx - rx * 0.16, ly - ry * 0.28, 0, lx, ly, radius);
    const cool = 205 + Math.round(cloud.tone * 22);
    glow.addColorStop(0, `rgba(244,248,249,${baseAlpha})`);
    glow.addColorStop(0.34, `rgba(${cool},${cool + 7},${cool + 10},${baseAlpha * 0.72})`);
    glow.addColorStop(0.72, `rgba(86,105,119,${baseAlpha * 0.34})`);
    glow.addColorStop(1, "rgba(18,29,39,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(lx, ly, rx * (0.7 + (lobe % 2) * 0.12), ry * (0.86 + Math.abs(wobble) * 0.25), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const createCeiling: RoomFactory = (iw, ih, initialSeed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let seed = initialSeed;
  let atmosphere = makeAtmosphere(seed);
  let cloudPlate: HTMLImageElement | null = null;
  if (typeof Image !== "undefined") {
    cloudPlate = new Image();
    cloudPlate.decoding = "async";
    cloudPlate.src = "/atelier/cloud-ceiling-v2.jpg";
  }
  let phase = 0;
  let cloudAmount = 1;
  let trailAmount = 1;
  let spot = 0;
  let strike = 0;
  let yesMid = 50;
  let settleAvg = 0;
  let locked = 0;
  let seconds = 900;
  let clock = "15:00";
  let rawTrail = "";
  let trail: TrailPoint[] = [];
  let previousSpot = 0;
  let velocity = 0;
  let lastSpotAt = 0;
  let crossing = "";
  let crossingUntil = 0;

  const apply = (next: Params) => {
    cloudAmount = num(next, "clouds", cloudAmount);
    trailAmount = num(next, "trail", trailAmount);
    strike = num(next, "strike", strike);
    yesMid = num(next, "yesMid", yesMid);
    settleAvg = num(next, "settleAvg", settleAvg);
    locked = num(next, "locked", locked);
    seconds = num(next, "seconds", seconds);
    clock = str(next, "clock", clock);

    const nextTrail = str(next, "history", rawTrail);
    if (nextTrail !== rawTrail) {
      rawTrail = nextTrail;
      trail = parseTrail(rawTrail);
    }

    const nextSpot = num(next, "spot", spot);
    if (nextSpot > 0 && nextSpot !== spot) {
      const now = performance.now() / 1000;
      if (spot > 0 && lastSpotAt > 0) {
        const elapsed = clamp(now - lastSpotAt, 0.08, 6);
        const instant = (nextSpot - spot) / elapsed;
        velocity = velocity * 0.7 + instant * 0.3;
      }
      previousSpot = spot;
      spot = nextSpot;
      lastSpotAt = now;

      if (strike > 0 && previousSpot > 0) {
        const wasAbove = previousSpot >= strike;
        const isAbove = spot >= strike;
        if (!wasAbove && isAbove) {
          crossing = "CEILING BROKEN";
          crossingUntil = now + 1.8;
        } else if (wasAbove && !isAbove) {
          crossing = "REJECTED";
          crossingUntil = now + 1.8;
        }
      }
    } else {
      spot = nextSpot;
    }
  };

  apply(params);

  return {
    resize(nextWidth, nextHeight) {
      w = nextWidth;
      h = nextHeight;
    },
    reseed(nextSeed) {
      seed = nextSeed;
      atmosphere = makeAtmosphere(seed);
    },
    setParams: apply,
    pointer() {},
    step(dt) {
      phase += dt;
    },
    draw(ctx) {
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      const horizon = h * 0.565;
      const mirrorTop = h * 0.735;
      const left = w * 0.075;
      const right = w * 0.925;
      const flightProgress = clamp(1 - seconds / 900, 0, 1);
      const planeX = left + (right - left) * flightProgress;
      const altitude = spot > 0 && strike > 0 ? spot - strike : 0;
      const range = clamp(Math.max(125, Math.abs(altitude) * 1.12), 125, 760);
      const toY = (value: number) => horizon - clamp((value - strike) / range, -1, 1) * h * 0.285;
      const planeYBase = spot > 0 && strike > 0 ? toY(spot) : horizon;
      const finalApproach = seconds <= 60;
      const lineHunt = finalApproach && seconds <= 20 && Math.abs(altitude) <= 20;
      const turbulence = lineHunt ? Math.sin(phase * 18) * h * 0.004 : 0;
      const planeY = planeYBase + turbulence;
      const tight = clamp(1 - Math.abs(altitude) / 105, 0, 1);
      const yesLeading = yesMid >= 50;
      const trailColor = yesLeading ? ORANGE : STEEL;
      const tipColor = yesLeading ? YES_GREEN : DOWN_RED;
      const short = Math.min(w, h);
      const small = clamp(short * 0.018, 12, 25);
      const tiny = clamp(short * 0.0135, 10, 18);

      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#01050b");
      sky.addColorStop(0.48, "#071929");
      sky.addColorStop(0.64, "#0a151e");
      sky.addColorStop(1, "#020407");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      const plateReady = Boolean(cloudPlate?.complete && cloudPlate.naturalWidth > 0);
      if (plateReady && cloudPlate) {
        const scale = Math.max(w / cloudPlate.naturalWidth, h / cloudPlate.naturalHeight) * 1.025;
        const imageWidth = cloudPlate.naturalWidth * scale;
        const imageHeight = cloudPlate.naturalHeight * scale;
        const drift = Math.sin(phase * 0.018) * w * 0.006;
        ctx.save();
        ctx.globalAlpha = 0.96;
        ctx.drawImage(
          cloudPlate,
          (w - imageWidth) * 0.5 + drift,
          (h - imageHeight) * 0.5,
          imageWidth,
          imageHeight,
        );
        const grade = ctx.createLinearGradient(0, 0, 0, h);
        grade.addColorStop(0, "rgba(0,8,18,0.18)");
        grade.addColorStop(0.55, "rgba(0,5,12,0.02)");
        grade.addColorStop(1, "rgba(0,2,7,0.3)");
        ctx.fillStyle = grade;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      ctx.save();
      for (const star of atmosphere.stars) {
        const twinkle = 0.76 + Math.sin(phase * 0.45 + star.x * 17) * 0.16;
        ctx.fillStyle = `rgba(200,224,238,${star.alpha * twinkle * (plateReady ? 0.34 : 1)})`;
        ctx.fillRect(star.x * w, star.y * horizon * 0.86, star.size, star.size);
      }
      const vignette = ctx.createRadialGradient(w * 0.52, horizon * 0.72, short * 0.08, w * 0.5, h * 0.52, Math.max(w, h) * 0.75);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, `rgba(0,0,0,${plateReady ? 0.4 : 0.62})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      const horizonGlow = ctx.createLinearGradient(0, horizon - h * 0.11, 0, horizon + h * 0.16);
      horizonGlow.addColorStop(0, "rgba(215,231,238,0)");
      horizonGlow.addColorStop(0.5, `rgba(204,221,228,${0.08 + tight * 0.12})`);
      horizonGlow.addColorStop(1, "rgba(27,42,54,0)");
      ctx.fillStyle = horizonGlow;
      ctx.fillRect(0, horizon - h * 0.11, w, h * 0.27);

      if (plateReady && tight > 0.04) {
        const pressure = ctx.createRadialGradient(w * 0.5, horizon, 0, w * 0.5, horizon, Math.max(w, h) * 0.52);
        pressure.addColorStop(0, `rgba(228,237,240,${tight * 0.13})`);
        pressure.addColorStop(0.34, `rgba(160,180,190,${tight * 0.07})`);
        pressure.addColorStop(1, "rgba(35,53,66,0)");
        ctx.fillStyle = pressure;
        ctx.fillRect(0, horizon - h * 0.18, w, h * 0.45);
      }

      const mirror = ctx.createLinearGradient(0, mirrorTop, 0, h);
      mirror.addColorStop(0, "rgba(11,24,33,0.18)");
      mirror.addColorStop(0.22, "rgba(5,12,18,0.72)");
      mirror.addColorStop(1, "#010204");
      ctx.fillStyle = mirror;
      ctx.fillRect(0, mirrorTop, w, h - mirrorTop);
      ctx.save();
      ctx.strokeStyle = "rgba(152,184,199,0.055)";
      ctx.lineWidth = 1;
      for (let index = 1; index <= 7; index += 1) {
        const p = index / 7;
        const y = mirrorTop + Math.pow(p, 1.8) * (h - mirrorTop);
        ctx.beginPath();
        ctx.moveTo(w * (0.5 - p * 0.58), y);
        ctx.lineTo(w * (0.5 + p * 0.58), y);
        ctx.stroke();
      }
      ctx.restore();

      const drawCloudRange = (from: number, to: number, alpha = 1) => {
        ctx.save();
        ctx.globalAlpha = alpha * cloudAmount;
        for (const cloud of atmosphere.clouds) {
          if (cloud.depth >= from && cloud.depth < to) cloudVolume(ctx, cloud, w, h, horizon, tight, phase);
        }
        ctx.restore();
      };

      if (!plateReady) drawCloudRange(0, 0.38, 0.78);

      ctx.save();
      ctx.strokeStyle = `rgba(224,235,239,${0.055 + tight * 0.075})`;
      ctx.lineWidth = 1;
      for (const edge of [0.04, 0.24, 0.76, 0.96]) {
        ctx.beginPath();
        ctx.moveTo(w * 0.5, horizon);
        ctx.lineTo(w * edge, mirrorTop + h * 0.05);
        ctx.stroke();
      }
      ctx.restore();

      if (!plateReady) drawCloudRange(0.38, 0.76, 0.92);

      ctx.save();
      ctx.setLineDash([short * 0.011, short * 0.014]);
      ctx.lineWidth = Math.max(1, short * 0.002);
      ctx.strokeStyle = `rgba(237,242,244,${0.38 + tight * 0.4})`;
      ctx.shadowColor = "rgba(219,236,242,0.72)";
      ctx.shadowBlur = short * (0.006 + tight * 0.014);
      ctx.beginPath();
      ctx.moveTo(left, horizon);
      ctx.lineTo(right, horizon);
      ctx.stroke();
      ctx.restore();

      label(ctx, "LOCKED STRIKE", left, horizon + tiny * 0.7, "left", tiny, 0.54 + tight * 0.22);
      if (strike > 0) label(ctx, `$${Math.round(strike).toLocaleString("en-US")}`, right, horizon + tiny * 0.7, "right", tiny, 0.74);

      const points = trail.filter((point) => point.p <= flightProgress + 0.02);
      if (spot > 0) points.push({ p: flightProgress, value: spot });
      const pathGradient = ctx.createLinearGradient(left, 0, right, 0);
      pathGradient.addColorStop(0, trailColor);
      pathGradient.addColorStop(1, tipColor);
      const drawPath = () => {
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = left + (right - left) * point.p;
          const y = strike > 0 ? toY(point.value) : horizon;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      };

      if (points.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, mirrorTop, w, h - mirrorTop);
        ctx.clip();
        ctx.transform(1, 0, 0, -0.28, 0, mirrorTop * 1.28);
        ctx.globalAlpha = plateReady ? 0.08 : 0.14;
        ctx.filter = `blur(${Math.max(2, short * 0.008)}px)`;
        ctx.strokeStyle = pathGradient;
        ctx.lineWidth = clamp(short * 0.0065 * trailAmount, 2.5, 9);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        drawPath();
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = pathGradient;
        ctx.lineWidth = clamp(short * 0.0055 * trailAmount, 2.2, 8);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = trailColor;
        ctx.shadowBlur = short * 0.014;
        drawPath();
        ctx.stroke();
        ctx.restore();
      }

      let angle = 0;
      if (points.length > 1) {
        const before = points[points.length - 2]!;
        const tailY = strike > 0 ? toY(before.value) : planeY;
        angle = clamp(Math.atan2(planeY - tailY, Math.max(1, planeX - (left + (right - left) * before.p))), -0.42, 0.42);
      }

      const planeSize = clamp(short * 0.038, 19, 52);
      if (spot > 0 && strike > 0) {
        const light = ctx.createRadialGradient(planeX, planeY, 0, planeX, planeY, short * 0.17);
        light.addColorStop(0, "rgba(247,147,26,0.18)");
        light.addColorStop(1, "rgba(247,147,26,0)");
        ctx.fillStyle = light;
        ctx.fillRect(planeX - short * 0.17, planeY - short * 0.17, short * 0.34, short * 0.34);

        const reflectionY = mirrorTop + Math.max(0, mirrorTop - planeY) * 0.18;
        const reflection = ctx.createRadialGradient(planeX, reflectionY, 0, planeX, reflectionY, short * 0.085);
        reflection.addColorStop(0, "rgba(247,147,26,0.2)");
        reflection.addColorStop(0.32, "rgba(247,147,26,0.075)");
        reflection.addColorStop(1, "rgba(247,147,26,0)");
        ctx.fillStyle = reflection;
        ctx.fillRect(planeX - short * 0.09, reflectionY - short * 0.025, short * 0.18, short * 0.05);

        aircraft(ctx, planeX, planeY, angle, planeSize, ORANGE, false, finalApproach);
      }

      const hasGhost = finalApproach && locked > 0 && settleAvg > 0 && strike > 0;
      if (hasGhost) {
        const ghostY = toY(settleAvg);
        ctx.save();
        ctx.setLineDash([short * 0.01, short * 0.012]);
        ctx.strokeStyle = "rgba(237,242,244,0.34)";
        ctx.lineWidth = Math.max(1, short * 0.002);
        ctx.beginPath();
        ctx.moveTo(left, ghostY);
        ctx.lineTo(planeX - short * 0.05, ghostY);
        ctx.stroke();
        ctx.restore();
        aircraft(ctx, planeX - short * 0.05, ghostY, 0, clamp(short * 0.033, 18, 46), WHITE, true, true);
        label(ctx, "SETTLEMENT GHOST", planeX - short * 0.06, ghostY + small * 1.35, "right", tiny, 0.55);
      }

      drawCloudRange(0.76, 1.01, plateReady ? (altitude < 0 ? 0.22 : 0.06) : (altitude < 0 ? 0.9 : 0.48));

      if (finalApproach) {
        const pulse = 0.36 + 0.18 * (0.5 + Math.sin(phase * 2.2) * 0.5);
        for (let index = 0; index < 5; index += 1) {
          const perspective = (index + 1) / 5;
          ctx.fillStyle = `rgba(247,147,26,${pulse * (1 - index * 0.11)})`;
          ctx.beginPath();
          ctx.ellipse(right - index * short * 0.055, mirrorTop + perspective * h * 0.16, short * 0.0048, short * 0.0028, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        label(ctx, "FINAL APPROACH", w * 0.5, h * 0.055, "center", small, 0.88);
        label(ctx, "CLEARED TO LAND", w * 0.5, h * 0.055 + small * 1.35, "center", tiny, 0.5);
      }

      const now = performance.now() / 1000;
      if (crossing && now <= crossingUntil) {
        const eventColor = crossing === "CEILING BROKEN" ? YES_GREEN : DOWN_RED;
        const life = clamp((crossingUntil - now) / 1.8, 0, 1);
        ctx.save();
        ctx.strokeStyle = eventColor;
        ctx.globalAlpha = life * 0.42;
        ctx.lineWidth = Math.max(1.5, short * 0.003);
        ctx.beginPath();
        ctx.ellipse(planeX, horizon, short * (0.05 + (1 - life) * 0.16), short * (0.018 + (1 - life) * 0.05), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${clamp(short * 0.027, 17, 38)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.fillStyle = eventColor;
        ctx.globalAlpha = 1;
        ctx.shadowColor = eventColor;
        ctx.shadowBlur = short * 0.035;
        ctx.fillText(crossing, w * 0.5, h * 0.2);
        ctx.restore();
      }

      if (lineHunt) label(ctx, "TURBULENCE · ALTIMETER HUNTING", w * 0.5, h * 0.15, "center", tiny, 0.72);

      label(ctx, "ALT", left, h * 0.075, "left", tiny, 0.45);
      label(ctx, strike > 0 && spot > 0 ? money(altitude) : "—", left, h * 0.075 + tiny * 1.3, "left", small, 0.9);
      label(ctx, "IAS", left, h * 0.075 + tiny * 3.4, "left", tiny, 0.45);
      label(ctx, lastSpotAt > 0 ? `${velocity >= 0 ? "+" : "−"}$${Math.round(Math.abs(velocity))}/s` : "—", left, h * 0.075 + tiny * 4.7, "left", small, 0.82);

      label(ctx, "FUEL", right, h * 0.075, "right", tiny, 0.45);
      label(ctx, clock, right, h * 0.075 + tiny * 1.3, "right", small, 0.9);
      label(ctx, "ODDS", right, h * 0.075 + tiny * 3.4, "right", tiny, 0.45);
      label(ctx, `YES MID ${Math.round(yesMid)}¢`, right, h * 0.075 + tiny * 4.7, "right", small, 0.82);

      const stateWord = altitude >= 0 ? "CLEAR AIR" : "IN THE SOUP";
      label(ctx, stateWord, left, h * 0.92, "left", tiny, 0.6);
      if (finalApproach) {
        const ghostAlt = hasGhost ? money(settleAvg - strike) : "—";
        label(ctx, `AVG ALT ${ghostAlt}`, right, h * 0.89, "right", tiny, hasGhost ? 0.82 : 0.55);
        label(ctx, hasGhost ? `${Math.round(locked)}/60 BRTI PRINTS OBSERVED` : "WAITING FOR BRTI PRINTS", right, h * 0.92, "right", tiny, 0.5);
      } else {
        label(ctx, "SETTLEMENT GHOST ENTERS AT 01:00", right, h * 0.92, "right", tiny, 0.44);
      }

      if (!(spot > 0) || !(strike > 0)) {
        ctx.fillStyle = "rgba(3,7,13,0.76)";
        ctx.fillRect(0, 0, w, h);
        label(ctx, !(strike > 0) ? "WAITING FOR LOCKED STRIKE" : "WAITING FOR BTC PRINT", w * 0.5, h * 0.48, "center", small, 0.78);
      }
    },
  };
};
