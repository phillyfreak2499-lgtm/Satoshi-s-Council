import { num, str, type Params } from "../catalog";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type TrailPoint = { p: number; value: number };
type CloudCell = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
  depth: number;
  tone: number;
};

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
    .slice(-24);
}

function makeClouds(seed: number): CloudCell[] {
  const random = mulberry32(seed ^ 0x6c8e9cf5);
  return Array.from({ length: 46 }, () => ({
    x: random(),
    y: random() * 2 - 1,
    rx: 0.035 + random() * 0.085,
    ry: 0.018 + random() * 0.042,
    alpha: 0.35 + random() * 0.65,
    depth: 0.25 + random() * 0.75,
    tone: random(),
  }));
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
  ctx.globalAlpha = ghost ? 0.38 : 0.99;

  const wake = ctx.createLinearGradient(-size * 2.5, 0, -size * 0.55, 0);
  wake.addColorStop(0, "rgba(247,147,26,0)");
  wake.addColorStop(0.72, ghost ? "rgba(237,242,244,0.04)" : "rgba(247,147,26,0.11)");
  wake.addColorStop(1, ghost ? "rgba(237,242,244,0.2)" : "rgba(247,147,26,0.52)");
  ctx.fillStyle = wake;
  ctx.beginPath();
  ctx.moveTo(-size * 2.35, -size * 0.08);
  ctx.lineTo(-size * 0.48, -size * 0.16);
  ctx.lineTo(-size * 0.48, size * 0.16);
  ctx.lineTo(-size * 2.35, size * 0.08);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = size * 0.55;
  ctx.beginPath();
  ctx.ellipse(-size * 0.08, size * 0.16, size * 0.94, size * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const wing = ctx.createLinearGradient(0, -size, 0, size);
  wing.addColorStop(0, ghost ? "#dce4e8" : "#6f7b83");
  wing.addColorStop(0.48, ghost ? "#f5f7f8" : "#d0d6d8");
  wing.addColorStop(1, ghost ? "#82919a" : "#3c474f");
  ctx.fillStyle = wing;
  ctx.beginPath();
  ctx.moveTo(size * 0.35, -size * 0.09);
  ctx.lineTo(-size * 0.2, -size * 0.92);
  ctx.lineTo(-size * 0.55, -size * 0.86);
  ctx.lineTo(-size * 0.34, -size * 0.08);
  ctx.lineTo(-size * 0.34, size * 0.08);
  ctx.lineTo(-size * 0.55, size * 0.86);
  ctx.lineTo(-size * 0.2, size * 0.92);
  ctx.lineTo(size * 0.35, size * 0.09);
  ctx.closePath();
  ctx.fill();

  const fuselage = ctx.createLinearGradient(0, -size * 0.25, 0, size * 0.25);
  fuselage.addColorStop(0, ghost ? "#f7f9fa" : "#f1e5cc");
  fuselage.addColorStop(0.32, ghost ? "#cfd8dc" : "#dba34d");
  fuselage.addColorStop(0.62, ghost ? "#768994" : "#6f3b11");
  fuselage.addColorStop(1, ghost ? "#33424b" : "#24170d");
  ctx.shadowColor = color;
  ctx.shadowBlur = ghost ? size * 0.46 : size * 0.72;
  ctx.fillStyle = fuselage;
  ctx.beginPath();
  ctx.moveTo(size * 1.2, 0);
  ctx.bezierCurveTo(size * 0.9, -size * 0.2, size * 0.2, -size * 0.19, -size * 0.66, -size * 0.12);
  ctx.lineTo(-size * 1.03, -size * 0.32);
  ctx.lineTo(-size * 0.87, -size * 0.05);
  ctx.lineTo(-size * 0.87, size * 0.05);
  ctx.lineTo(-size * 1.03, size * 0.32);
  ctx.lineTo(-size * 0.66, size * 0.12);
  ctx.bezierCurveTo(size * 0.2, size * 0.19, size * 0.9, size * 0.2, size * 1.2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  const canopy = ctx.createLinearGradient(0, -size * 0.18, 0, size * 0.18);
  canopy.addColorStop(0, ghost ? "rgba(255,255,255,0.62)" : "#b7d8e2");
  canopy.addColorStop(0.5, ghost ? "rgba(121,151,165,0.72)" : "#1e4b5d");
  canopy.addColorStop(1, ghost ? "rgba(39,59,68,0.74)" : "#07141c");
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.ellipse(size * 0.52, 0, size * 0.31, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ghost ? "rgba(255,255,255,0.54)" : "rgba(255,234,191,0.68)";
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(-size * 0.56, -size * 0.12);
  ctx.lineTo(size * 0.91, -size * 0.08);
  ctx.stroke();

  if (gear) {
    ctx.strokeStyle = ghost ? "rgba(237,242,244,0.62)" : "rgba(183,193,198,0.72)";
    ctx.lineWidth = Math.max(1.2, size * 0.055);
    ctx.beginPath();
    ctx.moveTo(-size * 0.08, size * 0.17);
    ctx.lineTo(-size * 0.14, size * 0.48);
    ctx.moveTo(size * 0.42, size * 0.13);
    ctx.lineTo(size * 0.38, size * 0.43);
    ctx.stroke();
    ctx.fillStyle = "#050607";
    ctx.beginPath();
    ctx.arc(-size * 0.14, size * 0.51, size * 0.085, 0, Math.PI * 2);
    ctx.arc(size * 0.38, size * 0.46, size * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = ghost ? WHITE : ORANGE;
  ctx.shadowColor = ghost ? WHITE : ORANGE;
  ctx.shadowBlur = size * 0.35;
  ctx.fillRect(-size * 0.92, -size * 0.08, size * 0.1, size * 0.16);
  ctx.restore();
}

function finishAtmosphere(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = 0.026;
  ctx.fillStyle = "#fff";
  for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = 1;
  const vignette = ctx.createRadialGradient(
    w * 0.52,
    h * 0.46,
    0,
    w * 0.52,
    h * 0.46,
    Math.max(w, h) * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.08)");
  vignette.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export const createCeiling: RoomFactory = (iw, ih, initialSeed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let seed = initialSeed;
  let clouds = makeClouds(seed);
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
      clouds = makeClouds(seed);
    },
    setParams: apply,
    pointer() {},
    step(dt) {
      phase += dt;
    },
    draw(ctx) {
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      const deckY = h * 0.55;
      const left = w * 0.075;
      const right = w * 0.925;
      const flightProgress = clamp(1 - seconds / 900, 0, 1);
      const planeX = left + (right - left) * flightProgress;
      const altitude = spot > 0 && strike > 0 ? spot - strike : 0;
      const range = clamp(Math.max(160, Math.abs(altitude) * 1.18), 160, 900);
      const toY = (value: number) => deckY - clamp((value - strike) / range, -1, 1) * h * 0.31;
      const planeYBase = spot > 0 && strike > 0 ? toY(spot) : deckY;
      const finalApproach = seconds <= 60;
      const lineHunt = finalApproach && seconds <= 20 && Math.abs(altitude) <= 20;
      const turbulence = lineHunt ? Math.sin(phase * 18) * h * 0.004 : 0;
      const planeY = planeYBase + turbulence;
      const tight = clamp(1 - Math.abs(altitude) / 100, 0, 1);
      const yesLeading = yesMid >= 50;
      const trailColor = yesLeading ? ORANGE : STEEL;
      const tipColor = yesLeading ? YES_GREEN : DOWN_RED;
      const short = Math.min(w, h);
      const small = clamp(short * 0.018, 12, 25);
      const tiny = clamp(short * 0.0135, 10, 18);

      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#01050a");
      sky.addColorStop(0.46, "#07121d");
      sky.addColorStop(0.72, "#0b1821");
      sky.addColorStop(1, "#020407");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      const plateReady = Boolean(cloudPlate?.complete && cloudPlate.naturalWidth > 0);
      if (plateReady && cloudPlate) {
        const scale = Math.max(w / cloudPlate.naturalWidth, h / cloudPlate.naturalHeight) * 1.025;
        const imageWidth = cloudPlate.naturalWidth * scale;
        const imageHeight = cloudPlate.naturalHeight * scale;
        const drift = Math.sin(phase * 0.018) * w * 0.008;
        ctx.save();
        ctx.globalAlpha = 0.97;
        ctx.drawImage(
          cloudPlate,
          (w - imageWidth) * 0.5 + drift,
          (h - imageHeight) * 0.5,
          imageWidth,
          imageHeight,
        );
        const grade = ctx.createLinearGradient(0, 0, 0, h);
        grade.addColorStop(0, "rgba(0,7,16,0.16)");
        grade.addColorStop(0.5, "rgba(0,5,12,0.01)");
        grade.addColorStop(1, "rgba(0,2,7,0.24)");
        ctx.fillStyle = grade;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      const moon = ctx.createRadialGradient(
        w * 0.78,
        h * 0.22,
        0,
        w * 0.78,
        h * 0.22,
        short * 0.34,
      );
      moon.addColorStop(0, "rgba(191,218,229,0.12)");
      moon.addColorStop(0.24, "rgba(108,151,170,0.055)");
      moon.addColorStop(1, "rgba(5,13,20,0)");
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, w, h * 0.62);

      ctx.save();
      for (let index = 0; index < 34; index += 1) {
        const sx = ((index * 0.618033 + seed * 0.000071) % 1) * w;
        const sy = (0.08 + ((index * 0.371 + seed * 0.000043) % 1) * 0.34) * h;
        const twinkle = 0.12 + ((index * 17) % 9) * 0.018 + Math.sin(phase * 0.55 + index) * 0.035;
        ctx.fillStyle = `rgba(211,228,235,${twinkle})`;
        ctx.fillRect(sx, sy, Math.max(1, short * 0.0015), Math.max(1, short * 0.0015));
      }
      ctx.restore();

      const lowFog = ctx.createLinearGradient(0, deckY, 0, h);
      lowFog.addColorStop(0, `rgba(120,145,158,${0.045 + tight * 0.095})`);
      lowFog.addColorStop(0.36, `rgba(68,87,99,${0.13 + tight * 0.1})`);
      lowFog.addColorStop(1, "rgba(5,9,13,0.84)");
      ctx.fillStyle = lowFog;
      ctx.fillRect(0, deckY, w, h - deckY);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = plateReady ? 0.1 + tight * 0.08 : 1;
      for (let index = 0; index < clouds.length; index += 1) {
        const cloud = clouds[index]!;
        if (tight < 0.28 && index % 3 === 0) continue;
        const drift = (phase * (0.0014 + cloud.depth * 0.0018) + cloud.x) % 1.16;
        const cx = (drift - 0.08) * w;
        const cy = deckY + cloud.y * h * (0.025 + tight * 0.052) + cloud.depth * h * 0.035;
        const rx = cloud.rx * w * cloudAmount * (0.72 + cloud.depth * 0.6 + tight * 0.28);
        const ry = cloud.ry * h * cloudAmount * (0.58 + cloud.depth * 0.7 + tight * 0.52);
        const alpha = cloud.alpha * cloud.depth * (0.075 + tight * 0.2);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(Math.max(1, rx), Math.max(1, ry));
        const fog = ctx.createRadialGradient(0, -0.18, 0.04, 0, 0, 1);
        fog.addColorStop(0, `rgba(231,240,244,${alpha * (0.72 + cloud.tone * 0.28)})`);
        fog.addColorStop(0.42, `rgba(154,176,187,${alpha * 0.7})`);
        fog.addColorStop(0.76, `rgba(72,92,104,${alpha * 0.34})`);
        fog.addColorStop(1, "rgba(32,45,54,0)");
        ctx.fillStyle = fog;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      for (let index = 0; index < 18; index += 1) {
        const travel = (phase * (0.025 + (index % 5) * 0.005) + index * 0.173) % 1;
        const sx = right - travel * (right - left);
        const sy = h * (0.26 + ((index * 29) % 54) / 100);
        const streak = ctx.createLinearGradient(sx - short * 0.045, 0, sx, 0);
        streak.addColorStop(0, "rgba(178,207,219,0)");
        streak.addColorStop(1, "rgba(178,207,219,0.08)");
        ctx.fillStyle = streak;
        ctx.fillRect(sx - short * 0.045, sy, short * 0.045, Math.max(1, short * 0.0012));
      }

      finishAtmosphere(ctx, w, h);

      const deckGlow = ctx.createLinearGradient(0, deckY - short * 0.04, 0, deckY + short * 0.04);
      deckGlow.addColorStop(0, "rgba(237,242,244,0)");
      deckGlow.addColorStop(0.5, `rgba(197,216,224,${0.035 + tight * 0.08})`);
      deckGlow.addColorStop(1, "rgba(237,242,244,0)");
      ctx.fillStyle = deckGlow;
      ctx.fillRect(left, deckY - short * 0.04, right - left, short * 0.08);

      ctx.save();
      ctx.setLineDash([short * 0.012, short * 0.014]);
      ctx.lineDashOffset = -phase * short * 0.035;
      ctx.lineWidth = Math.max(1, short * 0.002);
      ctx.strokeStyle = `rgba(237,242,244,${0.32 + tight * 0.4})`;
      ctx.shadowColor = WHITE;
      ctx.shadowBlur = short * 0.008;
      ctx.beginPath();
      ctx.moveTo(left, deckY);
      ctx.lineTo(right, deckY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(202,219,226,0.16)";
      for (let index = 0; index <= 12; index += 1) {
        const tx = left + ((right - left) * index) / 12;
        const tick = index % 3 === 0 ? short * 0.018 : short * 0.009;
        ctx.beginPath();
        ctx.moveTo(tx, deckY - tick);
        ctx.lineTo(tx, deckY + tick);
        ctx.stroke();
      }
      ctx.restore();

      label(ctx, "LOCKED STRIKE", left, deckY + tiny * 0.7, "left", tiny, 0.5 + tight * 0.25);
      if (strike > 0)
        label(
          ctx,
          `$${Math.round(strike).toLocaleString("en-US")}`,
          right,
          deckY + tiny * 0.7,
          "right",
          tiny,
          0.72,
        );

      const points = trail.filter((point) => point.p <= flightProgress + 0.02);
      if (spot > 0) points.push({ p: flightProgress, value: spot });
      const gradient = ctx.createLinearGradient(left, 0, right, 0);
      gradient.addColorStop(0, trailColor);
      gradient.addColorStop(1, tipColor);
      ctx.save();
      ctx.strokeStyle = "rgba(2,5,8,0.82)";
      ctx.lineWidth = clamp(short * 0.014 * trailAmount, 6, 18);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = left + (right - left) * point.p;
        const y = strike > 0 ? toY(point.value) : deckY;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (points.length > 1) ctx.stroke();

      ctx.strokeStyle = gradient;
      ctx.lineWidth = clamp(short * 0.006 * trailAmount, 2.5, 9);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = trailColor;
      ctx.shadowBlur = short * 0.018;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = left + (right - left) * point.p;
        const y = strike > 0 ? toY(point.value) : deckY;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (points.length > 1) ctx.stroke();

      ctx.setLineDash([short * 0.018, short * 0.026]);
      ctx.lineDashOffset = -phase * short * 0.055;
      ctx.strokeStyle = "rgba(240,246,248,0.36)";
      ctx.lineWidth = clamp(short * 0.0018 * trailAmount, 1, 3);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = left + (right - left) * point.p;
        const y = strike > 0 ? toY(point.value) : deckY;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (points.length > 1) ctx.stroke();
      ctx.restore();

      let angle = 0;
      if (points.length > 1) {
        const before = points[points.length - 2]!;
        const tailY = strike > 0 ? toY(before.value) : planeY;
        angle = clamp(
          Math.atan2(planeY - tailY, Math.max(1, planeX - (left + (right - left) * before.p))),
          -0.42,
          0.42,
        );
      }

      if (spot > 0 && strike > 0) {
        if (plateReady) {
          const mirrorY = h * 0.765 + Math.max(0, h * 0.68 - planeY) * 0.1;
          const reflectedLight = ctx.createRadialGradient(
            planeX,
            mirrorY,
            0,
            planeX,
            mirrorY,
            short * 0.1,
          );
          reflectedLight.addColorStop(0, "rgba(247,147,26,0.2)");
          reflectedLight.addColorStop(0.3, "rgba(247,147,26,0.07)");
          reflectedLight.addColorStop(1, "rgba(247,147,26,0)");
          ctx.fillStyle = reflectedLight;
          ctx.fillRect(
            planeX - short * 0.1,
            mirrorY - short * 0.035,
            short * 0.2,
            short * 0.07,
          );
        }
        aircraft(
          ctx,
          planeX,
          planeY,
          angle,
          clamp(short * 0.043, 24, 58),
          ORANGE,
          false,
          finalApproach,
        );
      }

      const hasGhost = finalApproach && locked > 0 && settleAvg > 0 && strike > 0;
      if (hasGhost) {
        const ghostY = toY(settleAvg);
        ctx.save();
        ctx.setLineDash([short * 0.01, short * 0.012]);
        ctx.strokeStyle = "rgba(237,242,244,0.32)";
        ctx.lineWidth = Math.max(1, short * 0.002);
        ctx.beginPath();
        ctx.moveTo(left, ghostY);
        ctx.lineTo(planeX - short * 0.05, ghostY);
        ctx.stroke();
        ctx.restore();
        aircraft(
          ctx,
          planeX - short * 0.045,
          ghostY,
          0,
          clamp(short * 0.031, 17, 44),
          WHITE,
          true,
          true,
        );
        label(
          ctx,
          "SETTLEMENT GHOST",
          planeX - short * 0.055,
          ghostY + small * 1.35,
          "right",
          tiny,
          0.52,
        );
      }

      if (finalApproach) {
        const pulse = 0.36 + 0.18 * (0.5 + Math.sin(phase * 2.2) * 0.5);
        for (let index = 0; index < 5; index += 1) {
          ctx.fillStyle = `rgba(247,147,26,${pulse * (1 - index * 0.11)})`;
          ctx.beginPath();
          ctx.arc(right - index * short * 0.055, h * 0.9, short * 0.0045, 0, Math.PI * 2);
          ctx.fill();
        }
        label(ctx, "FINAL APPROACH", w * 0.5, h * 0.055, "center", small, 0.88);
        label(ctx, "CLEARED TO LAND", w * 0.5, h * 0.055 + small * 1.35, "center", tiny, 0.5);
      }

      const now = performance.now() / 1000;
      if (crossing && now <= crossingUntil) {
        const eventColor = crossing === "CEILING BROKEN" ? YES_GREEN : DOWN_RED;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${clamp(short * 0.027, 17, 38)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.fillStyle = eventColor;
        ctx.shadowColor = eventColor;
        ctx.shadowBlur = short * 0.035;
        ctx.fillText(crossing, w * 0.5, h * 0.2);
        ctx.restore();
      }

      if (lineHunt)
        label(ctx, "TURBULENCE · ALTIMETER HUNTING", w * 0.5, h * 0.15, "center", tiny, 0.72);

      label(ctx, "ALT", left, h * 0.075, "left", tiny, 0.45);
      label(
        ctx,
        strike > 0 && spot > 0 ? money(altitude) : "—",
        left,
        h * 0.075 + tiny * 1.3,
        "left",
        small,
        0.9,
      );
      label(ctx, "IAS", left, h * 0.075 + tiny * 3.4, "left", tiny, 0.45);
      label(
        ctx,
        lastSpotAt > 0 ? `${velocity >= 0 ? "+" : "−"}$${Math.round(Math.abs(velocity))}/s` : "—",
        left,
        h * 0.075 + tiny * 4.7,
        "left",
        small,
        0.82,
      );

      label(ctx, "FUEL", right, h * 0.075, "right", tiny, 0.45);
      label(ctx, clock, right, h * 0.075 + tiny * 1.3, "right", small, 0.9);
      label(ctx, "ODDS", right, h * 0.075 + tiny * 3.4, "right", tiny, 0.45);
      label(
        ctx,
        `YES MID ${Math.round(yesMid)}¢`,
        right,
        h * 0.075 + tiny * 4.7,
        "right",
        small,
        0.82,
      );

      const stateWord = altitude >= 0 ? "CLEAR AIR" : "IN THE SOUP";
      label(ctx, stateWord, left, h * 0.92, "left", tiny, 0.56);
      if (finalApproach) {
        const ghostAlt = hasGhost ? money(settleAvg - strike) : "—";
        label(ctx, `AVG ALT ${ghostAlt}`, right, h * 0.89, "right", tiny, hasGhost ? 0.82 : 0.55);
        label(
          ctx,
          hasGhost ? `${Math.round(locked)}/60 BRTI PRINTS OBSERVED` : "WAITING FOR BRTI PRINTS",
          right,
          h * 0.92,
          "right",
          tiny,
          0.48,
        );
      } else {
        label(ctx, "SETTLEMENT GHOST ENTERS AT 01:00", right, h * 0.92, "right", tiny, 0.42);
      }

      if (!(spot > 0) || !(strike > 0)) {
        ctx.fillStyle = "rgba(3,7,13,0.72)";
        ctx.fillRect(0, 0, w, h);
        label(
          ctx,
          !(strike > 0) ? "WAITING FOR LOCKED STRIKE" : "WAITING FOR BTC PRINT",
          w * 0.5,
          h * 0.48,
          "center",
          small,
          0.78,
        );
      }
    },
  };
};

