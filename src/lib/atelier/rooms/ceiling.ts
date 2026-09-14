import { num, str, type Params } from "../catalog";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type TrailPoint = { p: number; value: number };
type CloudCell = { x: number; y: number; rx: number; ry: number; alpha: number };

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
  return Array.from({ length: 34 }, () => ({
    x: random(),
    y: random() * 2 - 1,
    rx: 0.035 + random() * 0.085,
    ry: 0.018 + random() * 0.042,
    alpha: 0.35 + random() * 0.65,
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
  ctx.globalAlpha = ghost ? 0.42 : 0.98;
  ctx.shadowColor = color;
  ctx.shadowBlur = ghost ? size * 0.7 : size * 1.1;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(size * 1.12, 0);
  ctx.lineTo(size * 0.22, -size * 0.13);
  ctx.lineTo(-size * 0.42, -size * 0.82);
  ctx.lineTo(-size * 0.72, -size * 0.76);
  ctx.lineTo(-size * 0.42, -size * 0.08);
  ctx.lineTo(-size * 0.92, -size * 0.2);
  ctx.lineTo(-size * 1.02, 0);
  ctx.lineTo(-size * 0.92, size * 0.2);
  ctx.lineTo(-size * 0.42, size * 0.08);
  ctx.lineTo(-size * 0.72, size * 0.76);
  ctx.lineTo(-size * 0.42, size * 0.82);
  ctx.lineTo(size * 0.22, size * 0.13);
  ctx.closePath();
  ctx.fill();
  if (gear) {
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-size * 0.05, size * 0.15);
    ctx.lineTo(-size * 0.12, size * 0.55);
    ctx.moveTo(size * 0.36, size * 0.1);
    ctx.lineTo(size * 0.32, size * 0.48);
    ctx.stroke();
  }
  ctx.restore();
}

export const createCeiling: RoomFactory = (iw, ih, initialSeed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let seed = initialSeed;
  let clouds = makeClouds(seed);
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
      sky.addColorStop(0, "#03070d");
      sky.addColorStop(0.5, "#091521");
      sky.addColorStop(1, "#05080c");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      const lowFog = ctx.createLinearGradient(0, deckY, 0, h);
      lowFog.addColorStop(0, `rgba(115,132,143,${0.06 + tight * 0.11})`);
      lowFog.addColorStop(1, "rgba(11,15,19,0.72)");
      ctx.fillStyle = lowFog;
      ctx.fillRect(0, deckY, w, h - deckY);

      ctx.save();
      for (let index = 0; index < clouds.length; index += 1) {
        const cloud = clouds[index]!;
        if (tight < 0.28 && index % 3 === 0) continue;
        const drift = Math.sin(phase * 0.035 + index * 1.7) * w * 0.006;
        const cx = cloud.x * w + drift;
        const cy = deckY + cloud.y * h * (0.014 + tight * 0.045);
        const rx = cloud.rx * w * cloudAmount * (0.8 + tight * 0.42);
        const ry = cloud.ry * h * cloudAmount * (0.62 + tight * 0.76);
        const fog = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
        const alpha = cloud.alpha * (0.08 + tight * 0.27);
        fog.addColorStop(0, `rgba(238,243,245,${alpha})`);
        fog.addColorStop(0.58, `rgba(189,201,207,${alpha * 0.48})`);
        fog.addColorStop(1, "rgba(153,168,177,0)");
        ctx.fillStyle = fog;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.setLineDash([short * 0.012, short * 0.014]);
      ctx.lineWidth = Math.max(1, short * 0.002);
      ctx.strokeStyle = `rgba(237,242,244,${0.32 + tight * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(left, deckY);
      ctx.lineTo(right, deckY);
      ctx.stroke();
      ctx.restore();

      label(ctx, "LOCKED STRIKE", left, deckY + tiny * 0.7, "left", tiny, 0.5 + tight * 0.25);
      if (strike > 0) label(ctx, `$${Math.round(strike).toLocaleString("en-US")}`, right, deckY + tiny * 0.7, "right", tiny, 0.72);

      const points = trail.filter((point) => point.p <= flightProgress + 0.02);
      if (spot > 0) points.push({ p: flightProgress, value: spot });
      const gradient = ctx.createLinearGradient(left, 0, right, 0);
      gradient.addColorStop(0, trailColor);
      gradient.addColorStop(1, tipColor);
      ctx.save();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = clamp(short * 0.0055 * trailAmount, 2.2, 8);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = trailColor;
      ctx.shadowBlur = short * 0.012;
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
        angle = clamp(Math.atan2(planeY - tailY, Math.max(1, planeX - (left + (right - left) * before.p))), -0.42, 0.42);
      }

      if (spot > 0 && strike > 0) {
        aircraft(ctx, planeX, planeY, angle, clamp(short * 0.034, 18, 48), ORANGE, false, finalApproach);
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
        aircraft(ctx, planeX - short * 0.045, ghostY, 0, clamp(short * 0.031, 17, 44), WHITE, true, true);
        label(ctx, "SETTLEMENT GHOST", planeX - short * 0.055, ghostY + small * 1.35, "right", tiny, 0.52);
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
      label(ctx, stateWord, left, h * 0.92, "left", tiny, 0.56);
      if (finalApproach) {
        const ghostAlt = hasGhost ? money(settleAvg - strike) : "—";
        label(ctx, `AVG ALT ${ghostAlt}`, right, h * 0.89, "right", tiny, hasGhost ? 0.82 : 0.55);
        label(ctx, hasGhost ? `${Math.round(locked)}/60 BRTI PRINTS OBSERVED` : "WAITING FOR BRTI PRINTS", right, h * 0.92, "right", tiny, 0.48);
      } else {
        label(ctx, "SETTLEMENT GHOST ENTERS AT 01:00", right, h * 0.92, "right", tiny, 0.42);
      }

      if (!(spot > 0) || !(strike > 0)) {
        ctx.fillStyle = "rgba(3,7,13,0.72)";
        ctx.fillRect(0, 0, w, h);
        label(ctx, !(strike > 0) ? "WAITING FOR LOCKED STRIKE" : "WAITING FOR BTC PRINT", w * 0.5, h * 0.48, "center", small, 0.78);
      }
    },
  };
};
