import { num, str, type Params } from "../catalog";
import type { RoomFactory, RoomWorld } from "../world";

type RoadPoint = { p: number; value: number };
type GhostPoint = { p: number; value: number };
type PriorRun = { ticker: string; grip: number; rails: number; at: number };
type ScreenRoadPoint = { x: number; y: number; lane: number };

const RUN_STORE = "atelier:arcade:last-run";

const ORANGE = "#f7931a";
const GOLD = "#e8b14d";
const BLUE = "#61b8df";
const RED = "#cf514d";
const CREAM = "#eee8dc";

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function parseRoad(raw: string): RoadPoint[] {
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
    .slice(-180);
}

function signedDollars(value: number) {
  return `${value >= 0 ? "+" : "−"}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

function readPriorRun(currentTicker: string): PriorRun | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RUN_STORE) ?? "null") as PriorRun | null;
    if (
      !parsed ||
      !parsed.ticker ||
      parsed.ticker === currentTicker ||
      !Number.isFinite(parsed.grip) ||
      !Number.isFinite(parsed.rails)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function rememberRun(run: PriorRun) {
  try {
    sessionStorage.setItem(RUN_STORE, JSON.stringify(run));
  } catch {
    /* the cabinet still plays when browser storage is unavailable */
  }
}

function hud(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  size: number,
  color = CREAM,
  alpha = 0.78,
) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function laneWidth(h: number, p: number, value: number, strike: number) {
  const secondsAtPoint = 900 * (1 - p);
  const distance = Math.abs(value - strike);
  if (secondsAtPoint > 420) return h * 0.14;
  if (secondsAtPoint > 60) return h * (0.078 + clamp(distance / 170, 0, 1) * 0.052);
  return h * (0.058 + clamp(distance / 120, 0, 1) * 0.038);
}

function traceRoadShape(
  ctx: CanvasRenderingContext2D,
  upper: ScreenRoadPoint[],
  lower: ScreenRoadPoint[],
  offsetY = 0,
) {
  if (upper.length === 0 || lower.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(upper[0]!.x, upper[0]!.y + offsetY);
  for (const point of upper) ctx.lineTo(point.x, point.y + offsetY);
  for (let index = lower.length - 1; index >= 0; index -= 1) {
    const point = lower[index]!;
    ctx.lineTo(point.x, point.y + offsetY);
  }
  ctx.closePath();
}

function traceRoadLine(ctx: CanvasRenderingContext2D, points: ScreenRoadPoint[]) {
  if (points.length === 0) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

function drawRoadster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  offRoad: boolean,
  phase: number,
  rush: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.sin(phase * 4.1) * (offRoad ? 0.035 : 0.007));

  const wake = ctx.createLinearGradient(-size * 3.3, 0, -size * 0.75, 0);
  wake.addColorStop(0, "rgba(247,147,26,0)");
  wake.addColorStop(0.66, `rgba(247,147,26,${0.045 + rush * 0.018})`);
  wake.addColorStop(1, offRoad ? "rgba(207,81,77,0.48)" : "rgba(247,147,26,0.28)");
  ctx.fillStyle = wake;
  ctx.beginPath();
  ctx.moveTo(-size * (2.45 + rush * 0.2), -size * 0.16);
  ctx.lineTo(-size * 0.88, -size * 0.25);
  ctx.lineTo(-size * 0.88, size * 0.25);
  ctx.lineTo(-size * (2.45 + rush * 0.2), size * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = "rgba(0,0,0,0.92)";
  ctx.shadowBlur = size * 0.52;
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.18, size * 1.24, size * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#020304";
  ctx.fillRect(-size * 0.88, -size * 0.65, size * 0.46, size * 0.2);
  ctx.fillRect(size * 0.38, -size * 0.65, size * 0.5, size * 0.2);
  ctx.fillRect(-size * 0.88, size * 0.45, size * 0.46, size * 0.2);
  ctx.fillRect(size * 0.38, size * 0.45, size * 0.5, size * 0.2);

  ctx.fillStyle = "#56616a";
  ctx.globalAlpha = 0.54;
  ctx.fillRect(-size * 0.77, -size * 0.67, size * 0.22, size * 0.035);
  ctx.fillRect(size * 0.51, -size * 0.67, size * 0.23, size * 0.035);
  ctx.fillRect(-size * 0.77, size * 0.635, size * 0.22, size * 0.035);
  ctx.fillRect(size * 0.51, size * 0.635, size * 0.23, size * 0.035);
  ctx.globalAlpha = 1;

  const body = ctx.createLinearGradient(-size * 1.15, -size * 0.5, size * 1.36, size * 0.46);
  if (offRoad) {
    body.addColorStop(0, "#321012");
    body.addColorStop(0.44, "#9f3936");
    body.addColorStop(0.7, "#e16758");
    body.addColorStop(1, "#351011");
  } else {
    body.addColorStop(0, "#281408");
    body.addColorStop(0.28, "#8b460e");
    body.addColorStop(0.54, "#ef941d");
    body.addColorStop(0.72, "#ffd17a");
    body.addColorStop(1, "#552608");
  }
  ctx.shadowColor = offRoad ? RED : ORANGE;
  ctx.shadowBlur = size * (offRoad ? 0.62 : 0.34);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(size * 1.42, 0);
  ctx.bezierCurveTo(size * 1.25, -size * 0.23, size * 0.98, -size * 0.34, size * 0.7, -size * 0.4);
  ctx.lineTo(size * 0.16, -size * 0.55);
  ctx.lineTo(-size * 0.54, -size * 0.5);
  ctx.lineTo(-size * 1.05, -size * 0.35);
  ctx.lineTo(-size * 1.18, -size * 0.18);
  ctx.lineTo(-size * 1.18, size * 0.18);
  ctx.lineTo(-size * 1.05, size * 0.35);
  ctx.lineTo(-size * 0.54, size * 0.5);
  ctx.lineTo(size * 0.16, size * 0.55);
  ctx.lineTo(size * 0.7, size * 0.4);
  ctx.bezierCurveTo(size * 0.98, size * 0.34, size * 1.25, size * 0.23, size * 1.42, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = offRoad ? "rgba(255,177,160,0.62)" : "rgba(255,225,166,0.62)";
  ctx.lineWidth = Math.max(1, size * 0.026);
  ctx.stroke();

  ctx.fillStyle = "rgba(29,17,10,0.62)";
  ctx.beginPath();
  ctx.moveTo(-size * 1.08, -size * 0.28);
  ctx.lineTo(-size * 0.5, -size * 0.39);
  ctx.lineTo(-size * 0.5, size * 0.39);
  ctx.lineTo(-size * 1.08, size * 0.28);
  ctx.closePath();
  ctx.fill();

  const hood = ctx.createLinearGradient(size * 0.2, -size * 0.32, size * 1.25, size * 0.28);
  hood.addColorStop(0, "rgba(88,43,10,0.64)");
  hood.addColorStop(0.52, "rgba(255,194,92,0.74)");
  hood.addColorStop(1, "rgba(75,31,7,0.74)");
  ctx.fillStyle = hood;
  ctx.beginPath();
  ctx.moveTo(size * 1.24, 0);
  ctx.lineTo(size * 0.84, -size * 0.26);
  ctx.lineTo(size * 0.25, -size * 0.3);
  ctx.lineTo(size * 0.32, size * 0.3);
  ctx.lineTo(size * 0.84, size * 0.26);
  ctx.closePath();
  ctx.fill();

  const canopy = ctx.createLinearGradient(-size * 0.38, -size * 0.24, size * 0.22, size * 0.2);
  canopy.addColorStop(0, "#07111a");
  canopy.addColorStop(0.44, "#133544");
  canopy.addColorStop(0.72, "#74aebe");
  canopy.addColorStop(1, "#061017");
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.moveTo(size * 0.25, 0);
  ctx.lineTo(size * 0.02, -size * 0.24);
  ctx.lineTo(-size * 0.47, -size * 0.2);
  ctx.lineTo(-size * 0.62, 0);
  ctx.lineTo(-size * 0.47, size * 0.2);
  ctx.lineTo(size * 0.02, size * 0.24);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(220,239,243,0.48)";
  ctx.lineWidth = Math.max(1, size * 0.022);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,235,195,0.7)";
  ctx.lineWidth = Math.max(1, size * 0.027);
  ctx.beginPath();
  ctx.moveTo(-size * 0.96, -size * 0.3);
  ctx.lineTo(size * 1.08, -size * 0.24);
  ctx.stroke();

  ctx.strokeStyle = "rgba(6,8,9,0.72)";
  ctx.lineWidth = Math.max(1, size * 0.038);
  for (let index = 0; index < 4; index += 1) {
    const ventX = -size * (0.92 - index * 0.1);
    ctx.beginPath();
    ctx.moveTo(ventX, -size * 0.21);
    ctx.lineTo(ventX, size * 0.21);
    ctx.stroke();
  }

  ctx.fillStyle = "#fff3d4";
  ctx.shadowColor = "#fff3d4";
  ctx.shadowBlur = size * 0.22;
  ctx.fillRect(size * 1.08, -size * 0.22, size * 0.17, size * 0.09);
  ctx.fillRect(size * 1.08, size * 0.13, size * 0.17, size * 0.09);
  ctx.shadowBlur = 0;

  ctx.fillStyle = offRoad ? "#ff7668" : "#dc493b";
  ctx.shadowColor = offRoad ? RED : "#dc493b";
  ctx.shadowBlur = size * 0.24;
  ctx.fillRect(-size * 1.19, -size * 0.23, size * 0.1, size * 0.13);
  ctx.fillRect(-size * 1.19, size * 0.1, size * 0.1, size * 0.13);
  ctx.restore();
}

function drawCabinetFinish(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = "#fff";
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = 1;
  const vignette = ctx.createRadialGradient(
    w * 0.52,
    h * 0.46,
    0,
    w * 0.52,
    h * 0.46,
    Math.max(w, h) * 0.7,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.62, "rgba(0,0,0,0.08)");
  vignette.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export const createArcade: RoomFactory = (iw, ih, _seed, params, host): RoomWorld => {
  let w = iw;
  let h = ih;
  let phase = 0;
  let mode = "watch";
  let assist = true;
  let glow = 1;
  let rush = 1.8;
  let spot = 0;
  let strike = 0;
  let settleAvg = 0;
  let locked = 0;
  let seconds = 900;
  let clock = "15:00";
  let ticker = "";
  let settled = "";
  let lastSettled = "";
  let lastSettledAt = 0;
  let lastSettledTicker = "";
  let priorRun: PriorRun | null = null;
  let resetMode = false;
  let roadRaw = "";
  let road: RoadPoint[] = [];
  let liveRoad: RoadPoint[] = [];
  let ghostRoad: GhostPoint[] = [];
  let lastGhost = 0;
  let steer = 0.5;
  let carY = h * 0.5;
  let roadY = h * 0.5;
  let lane = h * 0.1;
  let driveTime = 0;
  let gripTime = 0;
  let rails = 0;
  let offRoad = false;
  let previousOffRoad = false;
  let velocity = 0;
  let lastSpotAt = 0;
  let lastPersist = 0;
  let cameraCenter = 0;
  let cameraRange = 54;
  let targetCameraCenter = 0;
  let targetCameraRange = 54;

  const apply = (next: Params) => {
    const nextTicker = str(next, "ticker", ticker);
    if (nextTicker && nextTicker !== ticker) {
      ticker = nextTicker;
      priorRun = readPriorRun(ticker);
      resetMode = priorRun != null;
      liveRoad = [];
      ghostRoad = [];
      lastGhost = 0;
      cameraCenter = 0;
      targetCameraCenter = 0;
    }
    mode = str(next, "mode", mode);
    assist = str(next, "assist", assist ? "on" : "off") === "on";
    glow = num(next, "cabinet", glow);
    rush = num(next, "rush", rush);
    strike = num(next, "strike", strike);
    locked = num(next, "locked", locked);
    seconds = num(next, "seconds", seconds);
    clock = str(next, "clock", clock);
    settled = str(next, "settled", settled);
    lastSettled = str(next, "lastSettled", lastSettled);
    lastSettledAt = num(next, "lastSettledAt", lastSettledAt);
    lastSettledTicker = str(next, "lastSettledTicker", lastSettledTicker);
    steer = clamp(num(next, "steer", steer), 0.06, 0.94);

    const nextRaw = str(next, "history", roadRaw);
    if (nextRaw !== roadRaw) {
      roadRaw = nextRaw;
      road = parseRoad(roadRaw);
    }

    const nextSpot = num(next, "spot", spot);
    if (nextSpot > 0 && nextSpot !== spot) {
      const now = performance.now() / 1000;
      if (spot > 0 && lastSpotAt > 0) {
        const elapsed = clamp(now - lastSpotAt, 0.08, 6);
        velocity = velocity * 0.72 + ((nextSpot - spot) / elapsed) * 0.28;
      }
      const tickProgress = clamp(1 - seconds / 900, 0, 1);
      const lastRoadPoint = liveRoad[liveRoad.length - 1];
      if (!lastRoadPoint || tickProgress - lastRoadPoint.p >= 1 / 4500) {
        liveRoad.push({ p: tickProgress, value: nextSpot });
      } else {
        liveRoad[liveRoad.length - 1] = { p: tickProgress, value: nextSpot };
      }
      liveRoad = liveRoad.slice(-240);
      spot = nextSpot;
      lastSpotAt = now;
    } else {
      spot = nextSpot;
    }

    const nextGhost = num(next, "settleAvg", settleAvg);
    if (seconds <= 60 && nextGhost > 0 && nextGhost !== lastGhost) {
      ghostRoad.push({ p: clamp(1 - seconds / 900, 14 / 15, 1), value: nextGhost });
      ghostRoad = ghostRoad.slice(-64);
      lastGhost = nextGhost;
    }
    settleAvg = nextGhost;
  };

  apply(params);

  return {
    resize(nextWidth, nextHeight) {
      const ratio = nextHeight / Math.max(1, h);
      carY *= ratio;
      roadY *= ratio;
      w = nextWidth;
      h = nextHeight;
    },
    reseed() {},
    setParams: apply,
    pointer(_x, y, kind) {
      if (kind === "up") return;
      mode = "drive";
      steer = clamp(y / Math.max(1, h), 0.06, 0.94);
      host.setParam("mode", "drive");
      host.setParam("steer", steer);
    },
    step(dt) {
      phase += dt;
      if (targetCameraCenter > 0) {
        if (!(cameraCenter > 0)) cameraCenter = targetCameraCenter;
        cameraCenter += (targetCameraCenter - cameraCenter) * (1 - Math.exp(-5.5 * dt));
      }
      cameraRange += (targetCameraRange - cameraRange) * (1 - Math.exp(-4.2 * dt));
      if (resetMode) {
        resetMode = false;
        mode = "watch";
        steer = 0.5;
        host.setParam("mode", "watch");
        host.setParam("steer", steer);
      }
      if (mode === "watch") {
        carY += (roadY - carY) * (1 - Math.exp(-9 * dt));
      } else {
        let desired = steer * h;
        if (assist) desired += (roadY - desired) * 0.3;
        carY += (desired - carY) * (1 - Math.exp(-7.5 * dt));
        const far = Math.abs(carY - roadY) - lane * 0.7;
        if (far > 0) carY += (roadY - carY) * (1 - Math.exp(-2.8 * dt));
      }

      offRoad = Math.abs(carY - roadY) > lane * 0.5;
      if (mode === "drive" && seconds > 0) {
        driveTime += dt;
        if (!offRoad) gripTime += dt;
        if (offRoad && !previousOffRoad) rails += 1;
      }
      previousOffRoad = offRoad;
      if (mode === "drive" && driveTime > 0 && phase - lastPersist >= 0.5 && ticker) {
        lastPersist = phase;
        rememberRun({
          ticker,
          grip: Math.round((gripTime / driveTime) * 100),
          rails,
          at: Date.now(),
        });
      }
    },
    draw(ctx) {
      const short = Math.min(w, h);
      const tiny = clamp(short * 0.013, 10, 18);
      const small = clamp(short * 0.019, 13, 27);
      const left = w * 0.065;
      const right = w * 0.935;
      const progress = clamp(1 - seconds / 900, 0, 1);
      const finalMinute = seconds <= 60;
      const openRoad = seconds > 420;
      const phaseWord = finalMinute ? "GHOST LAP" : openRoad ? "OPEN ROAD" : "PINCH";
      const tape = [...road, ...liveRoad]
        .filter((point) => point.p <= progress + 0.004)
        .sort((a, b) => a.p - b.p);
      if (spot > 0) tape.push({ p: progress, value: spot });

      const cameraSeconds = finalMinute ? 45 : openRoad ? 120 : 75;
      const cameraLens = cameraSeconds / 900;
      const cameraStart = Math.max(0, progress - cameraLens);
      const cameraSpan = Math.max(0.025, progress - cameraStart);
      const launch = clamp(progress / 0.14, 0, 1);
      const carX = left + (right - left) * (0.12 + launch * 0.54);
      const visibleTape = tape.filter((point) => point.p >= cameraStart - cameraLens * 0.1);
      const rangePoints = visibleTape.length > 1 ? visibleTape : tape;
      const localExtent = Math.max(
        7,
        ...rangePoints.map((point) => Math.abs(point.value - spot)),
        settleAvg > 0 ? Math.abs(settleAvg - spot) : 0,
      );
      const strikeDistance = spot > 0 && strike > 0 ? Math.abs(spot - strike) : 0;
      const includeStrike = strikeDistance <= 110;
      targetCameraCenter = spot > 0
        ? includeStrike && strike > 0
          ? (spot + strike) * 0.5
          : spot
        : strike;
      targetCameraRange = clamp(
        Math.max(20, localExtent * 1.5, Math.abs(velocity) * 0.7, includeStrike ? strikeDistance * 0.62 : 0),
        20,
        145,
      );
      if (!(cameraCenter > 0)) cameraCenter = targetCameraCenter;
      const center = h * 0.51;
      const toY = (value: number) =>
        center - ((value - cameraCenter) / Math.max(16, cameraRange)) * h * 0.34;
      const roadX = (p: number) => left + ((p - cameraStart) / cameraSpan) * (carX - left);
      const topTrack = h * 0.185;
      const bottomTrack = h * 0.84;
      const rawStrikeY = strike > 0 ? toY(strike) : center;
      const strikeOffscreen = rawStrikeY < topTrack || rawStrikeY > bottomTrack;
      const strikeY = clamp(rawStrikeY, topTrack, bottomTrack);
      roadY = spot > 0 && strike > 0 ? clamp(toY(spot), topTrack, bottomTrack) : center;
      lane = laneWidth(h, progress, spot, strike);
      if (!(carY > 0) || (mode === "watch" && Math.abs(carY - roadY) > h * 0.4)) carY = roadY;

      const roadPhase = phase * clamp(rush, 0.65, 3);
      const speedEnergy = clamp(0.36 + rush * 0.2 + Math.abs(velocity) / 150, 0.4, 1.35);
      const shake = clamp(Math.abs(velocity) / 80, 0, 1) * Math.sin(phase * 24) * h * 0.003;
      const screenRoad: ScreenRoadPoint[] = visibleTape.map((point) => ({
        x: roadX(point.p),
        y: toY(point.value),
        lane: laneWidth(h, point.p, point.value, strike),
      }));

      if (screenRoad.length === 1) {
        screenRoad.unshift({ x: left, y: screenRoad[0]!.y, lane: screenRoad[0]!.lane });
      }

      const background = ctx.createLinearGradient(0, 0, 0, h);
      background.addColorStop(0, finalMinute ? "#020913" : "#030507");
      background.addColorStop(0.48, finalMinute ? "#07131d" : "#0b0d0f");
      background.addColorStop(1, "#010203");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      const horizonGlow = ctx.createRadialGradient(carX, roadY, 0, carX, roadY, short * 0.55);
      horizonGlow.addColorStop(
        0,
        finalMinute ? "rgba(97,184,223,0.12)" : `rgba(247,147,26,${0.08 * glow})`,
      );
      horizonGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = horizonGlow;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(0, shake);

      const gridGap = Math.max(42, short * 0.092);
      const gridShift = (roadPhase * short * 0.11) % gridGap;
      ctx.strokeStyle = finalMinute ? "rgba(97,184,223,0.065)" : "rgba(232,177,77,0.052)";
      ctx.lineWidth = 1;
      for (let x = left - gridGap + gridShift; x <= right + gridGap; x += gridGap) {
        ctx.beginPath();
        ctx.moveTo(x, h * 0.15);
        ctx.lineTo(x, h * 0.88);
        ctx.stroke();
      }
      for (let y = h * 0.2; y <= h * 0.84; y += gridGap) {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }

      for (let index = 0; index < 26; index += 1) {
        const pace = 0.08 + (index % 7) * 0.013;
        const travel = (roadPhase * pace + index * 0.149) % 1;
        const x = right - travel * (right - left);
        const y = h * (0.18 + ((index * 37) % 67) / 100);
        const length = short * (0.012 + (index % 5) * 0.006) * speedEnergy;
        const streak = ctx.createLinearGradient(x - length, 0, x, 0);
        streak.addColorStop(0, "rgba(232,177,77,0)");
        streak.addColorStop(1, finalMinute ? "rgba(97,184,223,0.16)" : "rgba(232,177,77,0.13)");
        ctx.fillStyle = streak;
        ctx.fillRect(x - length, y, length, Math.max(1, short * 0.0015));
      }

      ctx.save();
      ctx.setLineDash([short * 0.018, short * 0.014]);
      ctx.strokeStyle = "rgba(232,177,77,0.54)";
      ctx.lineWidth = Math.max(1.4, short * 0.0025);
      ctx.beginPath();
      ctx.moveTo(left, strikeY);
      ctx.lineTo(right, strikeY);
      ctx.stroke();
      if (strikeOffscreen) {
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(232,177,77,0.84)";
        ctx.beginPath();
        if (rawStrikeY < topTrack) {
          ctx.moveTo(right - tiny * 0.7, strikeY + tiny * 0.8);
          ctx.lineTo(right, strikeY);
          ctx.lineTo(right + tiny * 0.7, strikeY + tiny * 0.8);
        } else {
          ctx.moveTo(right - tiny * 0.7, strikeY - tiny * 0.8);
          ctx.lineTo(right, strikeY);
          ctx.lineTo(right + tiny * 0.7, strikeY - tiny * 0.8);
        }
        ctx.fill();
      }
      ctx.restore();

      if (screenRoad.length > 1 && strike > 0) {
        const upper = screenRoad.map((point) => ({ ...point, y: point.y - point.lane * 0.5 }));
        const lower = screenRoad.map((point) => ({ ...point, y: point.y + point.lane * 0.5 }));

        ctx.fillStyle = "rgba(43,8,10,0.78)";
        traceRoadShape(ctx, upper, lower, short * 0.026);
        ctx.shadowColor = RED;
        ctx.shadowBlur = short * 0.018;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = "rgba(117,27,28,0.34)";
        traceRoadShape(ctx, upper, lower, short * 0.012);
        ctx.fill();

        const roadFill = ctx.createLinearGradient(0, center - lane, 0, center + lane);
        roadFill.addColorStop(0, "#313941");
        roadFill.addColorStop(0.15, "#171d22");
        roadFill.addColorStop(0.52, "#090d11");
        roadFill.addColorStop(0.86, "#1d242a");
        roadFill.addColorStop(1, "#07090b");
        ctx.fillStyle = roadFill;
        traceRoadShape(ctx, upper, lower);
        ctx.fill();

        ctx.save();
        traceRoadShape(ctx, upper, lower);
        ctx.clip();
        const surfaceSheen = ctx.createLinearGradient(left, 0, carX, 0);
        surfaceSheen.addColorStop(0, "rgba(255,255,255,0.015)");
        surfaceSheen.addColorStop(0.72, "rgba(247,147,26,0.055)");
        surfaceSheen.addColorStop(1, "rgba(255,219,154,0.14)");
        ctx.fillStyle = surfaceSheen;
        ctx.fillRect(left, 0, carX - left, h);

        ctx.setLineDash([short * 0.032, short * 0.052]);
        ctx.lineDashOffset = -roadPhase * short * 0.19;
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(244,231,205,0.34)";
        ctx.lineWidth = clamp(short * 0.004, 2, 6);
        traceRoadLine(ctx, screenRoad);
        ctx.stroke();
        ctx.restore();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = `rgba(247,147,26,${0.62 * glow})`;
        ctx.lineWidth = clamp(short * 0.0035, 2, 6);
        ctx.shadowColor = ORANGE;
        ctx.shadowBlur = short * 0.014 * glow;
        traceRoadLine(ctx, screenRoad);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.save();
        ctx.setLineDash([short * 0.026, short * 0.044]);
        ctx.lineDashOffset = -roadPhase * short * 0.3;
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255,241,211,0.68)";
        ctx.lineWidth = clamp(short * 0.0018, 1.25, 3.2);
        traceRoadLine(ctx, screenRoad);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = "rgba(189,76,61,0.54)";
        ctx.lineWidth = clamp(short * 0.0022, 1.25, 3.8);
        traceRoadLine(ctx, upper);
        ctx.stroke();
        traceRoadLine(ctx, lower);
        ctx.stroke();
      }

      if (progress < 0.995) {
        const beam = ctx.createLinearGradient(carX, 0, right, 0);
        beam.addColorStop(0, finalMinute ? "rgba(97,184,223,0.13)" : "rgba(247,147,26,0.12)");
        beam.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(carX, roadY - lane * 0.45);
        ctx.lineTo(right, roadY - lane * 0.16);
        ctx.lineTo(right, roadY + lane * 0.16);
        ctx.lineTo(carX, roadY + lane * 0.45);
        ctx.closePath();
        ctx.fill();

        ctx.save();
        ctx.setLineDash([short * 0.012, short * 0.021]);
        ctx.lineDashOffset = -roadPhase * short * 0.14;
        ctx.strokeStyle = "rgba(237,232,220,0.22)";
        ctx.lineWidth = Math.max(1, short * 0.002);
        ctx.beginPath();
        ctx.moveTo(carX + short * 0.07, roadY);
        ctx.lineTo(right, roadY);
        ctx.stroke();
        ctx.restore();
        hud(ctx, "TAPE AHEAD UNWRITTEN", right, roadY + tiny * 1.1, "right", tiny, CREAM, 0.42);
      }

      let ghostY = 0;
      if (finalMinute && settleAvg > 0 && locked > 0 && strike > 0) {
        const visibleGhost =
          ghostRoad.length > 1
            ? ghostRoad.filter((point) => point.p >= cameraStart - cameraLens * 0.1)
            : [
                { p: Math.max(14 / 15, progress - 0.035), value: settleAvg },
                { p: progress, value: settleAvg },
              ];
        const ghostScreen = visibleGhost.map((point) => ({
          x: roadX(point.p),
          y: toY(point.value),
          lane: lane * 0.54,
        }));
        if (ghostScreen.length === 1) ghostScreen.unshift({ ...ghostScreen[0]!, x: left });
        ctx.save();
        ctx.strokeStyle = "rgba(29,83,111,0.72)";
        ctx.lineWidth = clamp(short * 0.022, 9, 28);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = BLUE;
        ctx.shadowBlur = short * 0.03;
        traceRoadLine(ctx, ghostScreen);
        ctx.stroke();
        ctx.strokeStyle = "rgba(148,224,255,0.82)";
        ctx.lineWidth = clamp(short * 0.0045, 2, 7);
        ctx.setLineDash([short * 0.026, short * 0.03]);
        ctx.lineDashOffset = -roadPhase * short * 0.22;
        traceRoadLine(ctx, ghostScreen);
        ctx.stroke();
        ctx.restore();
        ghostY = toY(settleAvg);
        hud(ctx, "BLUE LANE SETTLES", right, ghostY + tiny * 1.2, "right", tiny, BLUE, 0.78);
      }

      if (spot > 0 && strike > 0) {
        let angle = 0;
        if (screenRoad.length > 1) {
          const before = screenRoad[screenRoad.length - 2]!;
          angle = clamp(Math.atan2(roadY - before.y, Math.max(1, carX - before.x)), -0.28, 0.28);
        }
        drawRoadster(ctx, carX, carY, clamp(short * 0.068, 34, 88), angle, offRoad, phase, rush);
        if (offRoad) {
          ctx.fillStyle = "rgba(255,179,88,0.82)";
          ctx.shadowColor = RED;
          ctx.shadowBlur = short * 0.01;
          for (let index = 0; index < 11; index += 1) {
            const scatter = (index + 1) / 11;
            const sx = carX - short * (0.045 + scatter * 0.15);
            const sy = carY + Math.sin(phase * 15 + index * 2.1) * short * (0.012 + scatter * 0.03);
            ctx.fillRect(sx, sy, short * (0.005 + scatter * 0.005), Math.max(1, short * 0.002));
          }
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();

      drawCabinetFinish(ctx, w, h);

      const grip = driveTime > 0 ? Math.round((gripTime / driveTime) * 100) : null;
      const onGhost = ghostY > 0 && Math.abs(carY - ghostY) <= lane * 0.58;
      const flagReplay =
        seconds >= 890 &&
        priorRun != null &&
        lastSettledTicker === priorRun.ticker &&
        (lastSettled === "UP" || lastSettled === "DOWN") &&
        Math.abs(Date.now() - lastSettledAt) <= 2 * 60 * 1000;
      hud(ctx, mode === "drive" ? "DRIVE" : "WATCH", left, h * 0.055, "left", small, ORANGE, 0.94);
      hud(ctx, phaseWord, w * 0.5, h * 0.055, "center", small, finalMinute ? BLUE : CREAM, 0.88);
      hud(ctx, `FUEL ${clock}`, right, h * 0.055, "right", small, CREAM, 0.88);

      hud(ctx, "GRIP", left, h * 0.12, "left", tiny, CREAM, 0.46);
      hud(
        ctx,
        grip == null ? "—" : `${grip}%`,
        left,
        h * 0.12 + tiny * 1.35,
        "left",
        small,
        offRoad ? RED : CREAM,
        0.92,
      );
      hud(ctx, "RAILS", left, h * 0.12 + tiny * 3.8, "left", tiny, CREAM, 0.46);
      hud(
        ctx,
        String(rails),
        left,
        h * 0.12 + tiny * 5.15,
        "left",
        small,
        rails ? RED : CREAM,
        0.88,
      );

      hud(ctx, "LANDING", right, h * 0.12, "right", tiny, CREAM, 0.46);
      hud(
        ctx,
        finalMinute && ghostY > 0 ? (onGhost ? "ON GHOST" : "OFF GHOST") : "—",
        right,
        h * 0.12 + tiny * 1.35,
        "right",
        small,
        onGhost ? BLUE : finalMinute ? RED : CREAM,
        0.92,
      );
      hud(ctx, "CONTRACT", right, h * 0.12 + tiny * 3.8, "right", tiny, CREAM, 0.46);
      hud(
        ctx,
        settled === "UP" || settled === "DOWN" ? `SETTLED ${settled}` : "OPEN",
        right,
        h * 0.12 + tiny * 5.15,
        "right",
        small,
        settled === "UP" ? "#52c58b" : settled === "DOWN" ? RED : CREAM,
        0.9,
      );

      hud(
        ctx,
        strikeOffscreen
          ? `GUARDRAIL ${signedDollars(strike - spot)} ${rawStrikeY < topTrack ? "↑" : "↓"}`
          : "STRIKE GUARDRAIL",
        left,
        strikeY + (rawStrikeY > bottomTrack ? -tiny * 1.7 : tiny * 0.65),
        "left",
        tiny,
        GOLD,
        0.58,
      );
      const driveHelp =
        mode === "watch"
          ? "TOUCH THE ROAD TO DRIVE"
          : assist
            ? "ASSIST ON · DRAG OR ↑↓"
            : "EXPERT · DRAG OR ↑↓";
      hud(ctx, driveHelp, w * 0.5, h * 0.875, "center", tiny, CREAM, 0.52);
      hud(
        ctx,
        `CHASE CAMERA ${cameraSeconds}s · ZOOM ±$${Math.round(cameraRange)} · ROAD RUSH ${rush.toFixed(1)}×`,
        w * 0.5,
        h * 0.91,
        "center",
        tiny,
        GOLD,
        0.44,
      );

      if (seconds <= 0) {
        ctx.fillStyle = "rgba(2,3,4,0.82)";
        ctx.fillRect(0, h * 0.34, w, h * 0.34);
        hud(
          ctx,
          "CHECKERED",
          w * 0.5,
          h * 0.39,
          "center",
          clamp(short * 0.04, 24, 54),
          CREAM,
          0.94,
        );
        hud(
          ctx,
          grip == null ? "DRIVE: WATCHED" : `DRIVE: ${grip}% GRIP`,
          w * 0.5,
          h * 0.49,
          "center",
          small,
          ORANGE,
          0.9,
        );
        hud(
          ctx,
          settled ? `CONTRACT: SETTLED ${settled}` : "CONTRACT: AWAITING OFFICIAL SETTLEMENT",
          w * 0.5,
          h * 0.55,
          "center",
          small,
          settled === "UP" ? "#52c58b" : settled === "DOWN" ? RED : CREAM,
          0.86,
        );
      } else if (finalMinute && ghostY > 0 && seconds <= 8 && !onGhost && mode === "drive") {
        hud(ctx, "MISSED LANDING", w * 0.5, h * 0.78, "center", small, RED, 0.9);
      }

      if (flagReplay && priorRun) {
        ctx.fillStyle = "rgba(2,3,4,0.9)";
        ctx.fillRect(0, h * 0.33, w, h * 0.36);
        hud(
          ctx,
          "CHECKERED · LAST WINDOW",
          w * 0.5,
          h * 0.39,
          "center",
          clamp(short * 0.032, 20, 44),
          CREAM,
          0.94,
        );
        hud(
          ctx,
          `DRIVE: ${priorRun.grip}% GRIP · ${priorRun.rails} RAILS`,
          w * 0.5,
          h * 0.49,
          "center",
          small,
          ORANGE,
          0.9,
        );
        hud(
          ctx,
          `CONTRACT: SETTLED ${lastSettled}`,
          w * 0.5,
          h * 0.55,
          "center",
          small,
          lastSettled === "UP" ? "#52c58b" : RED,
          0.9,
        );
        hud(ctx, "GREEN FLAG · NEW ROAD OPEN", w * 0.5, h * 0.63, "center", tiny, CREAM, 0.58);
      }

      if (!(spot > 0) || !(strike > 0)) {
        ctx.fillStyle = "rgba(2,3,4,0.78)";
        ctx.fillRect(0, 0, w, h);
        hud(
          ctx,
          !(strike > 0) ? "WAITING FOR GUARDRAIL" : "WAITING FOR THE PRINT",
          w * 0.5,
          h * 0.48,
          "center",
          small,
          CREAM,
          0.78,
        );
      }
    },
  };
};
