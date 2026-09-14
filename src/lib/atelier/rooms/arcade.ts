import { num, str, type Params } from "../catalog";
import type { RoomFactory, RoomWorld } from "../world";

type RoadPoint = { p: number; value: number };
type GhostPoint = { p: number; value: number };
type PriorRun = { ticker: string; grip: number; rails: number; at: number };

const RUN_STORE = "atelier:arcade:last-run";

const ORANGE = "#f7931a";
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
    .slice(-24);
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
  if (secondsAtPoint > 420) return h * 0.13;
  if (secondsAtPoint > 60) return h * (0.071 + clamp(distance / 170, 0, 1) * 0.052);
  return h * (0.052 + clamp(distance / 120, 0, 1) * 0.036);
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  offRoad: boolean,
  phase: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(phase * 4.1) * (offRoad ? 0.04 : 0.012));
  ctx.shadowColor = offRoad ? RED : ORANGE;
  ctx.shadowBlur = size * (offRoad ? 1.2 : 0.72);
  ctx.fillStyle = offRoad ? "#a93836" : ORANGE;
  ctx.beginPath();
  ctx.moveTo(size * 0.64, 0);
  ctx.lineTo(size * 0.36, -size * 0.42);
  ctx.lineTo(-size * 0.36, -size * 0.46);
  ctx.lineTo(-size * 0.7, -size * 0.25);
  ctx.lineTo(-size * 0.7, size * 0.25);
  ctx.lineTo(-size * 0.36, size * 0.46);
  ctx.lineTo(size * 0.36, size * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#111820";
  ctx.fillRect(-size * 0.24, -size * 0.31, size * 0.3, size * 0.62);
  ctx.fillStyle = CREAM;
  ctx.globalAlpha = 0.82;
  ctx.fillRect(size * 0.36, -size * 0.25, size * 0.1, size * 0.16);
  ctx.fillRect(size * 0.36, size * 0.09, size * 0.1, size * 0.16);
  ctx.restore();
}

export const createArcade: RoomFactory = (iw, ih, _seed, params, host): RoomWorld => {
  let w = iw;
  let h = ih;
  let phase = 0;
  let mode = "watch";
  let assist = true;
  let glow = 1;
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

  const apply = (next: Params) => {
    const nextTicker = str(next, "ticker", ticker);
    if (nextTicker && nextTicker !== ticker) {
      ticker = nextTicker;
      priorRun = readPriorRun(ticker);
      resetMode = priorRun != null;
    }
    mode = str(next, "mode", mode);
    assist = str(next, "assist", assist ? "on" : "off") === "on";
    glow = num(next, "cabinet", glow);
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
      const carX = left + (right - left) * progress;
      const finalMinute = seconds <= 60;
      const openRoad = seconds > 420;
      const phaseWord = finalMinute ? "GHOST LAP" : openRoad ? "OPEN ROAD" : "PINCH";
      const allPoints = road.filter((point) => point.p <= progress + 0.015);
      if (spot > 0) allPoints.push({ p: progress, value: spot });
      const maxDistance = Math.max(
        160,
        ...allPoints.map((point) => Math.abs(point.value - strike) * 1.22),
        settleAvg > 0 ? Math.abs(settleAvg - strike) * 1.22 : 0,
      );
      const range = clamp(maxDistance, 160, 900);
      const center = h * 0.51;
      const toY = (value: number) => center - clamp((value - strike) / range, -1, 1) * h * (finalMinute ? 0.38 : 0.31);
      const strikeY = strike > 0 ? toY(strike) : center;
      roadY = spot > 0 && strike > 0 ? toY(spot) : center;
      lane = laneWidth(h, progress, spot, strike);
      if (!(carY > 0) || mode === "watch" && Math.abs(carY - roadY) > h * 0.4) carY = roadY;
      const shake = clamp(Math.abs(velocity) / 80, 0, 1) * Math.sin(phase * 24) * h * 0.004;

      const background = ctx.createLinearGradient(0, 0, 0, h);
      background.addColorStop(0, "#05070b");
      background.addColorStop(0.58, finalMinute ? "#071824" : "#0a0c10");
      background.addColorStop(1, "#020304");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(0, shake);
      ctx.strokeStyle = finalMinute ? "rgba(97,184,223,0.12)" : "rgba(247,147,26,0.075)";
      ctx.lineWidth = 1;
      for (let x = left; x <= right; x += Math.max(34, short * 0.085)) {
        ctx.beginPath();
        ctx.moveTo(x, h * 0.12);
        ctx.lineTo(x, h * 0.9);
        ctx.stroke();
      }
      for (let y = h * 0.18; y <= h * 0.86; y += Math.max(34, short * 0.085)) {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }

      ctx.save();
      ctx.setLineDash([short * 0.018, short * 0.014]);
      ctx.strokeStyle = "rgba(247,147,26,0.5)";
      ctx.lineWidth = Math.max(1.4, short * 0.0025);
      ctx.beginPath();
      ctx.moveTo(left, strikeY);
      ctx.lineTo(right, strikeY);
      ctx.stroke();
      ctx.restore();

      if (allPoints.length > 0 && strike > 0) {
        const upper = allPoints.map((point) => ({
          x: left + (right - left) * point.p,
          y: toY(point.value) - laneWidth(h, point.p, point.value, strike) * 0.5,
        }));
        const lower = allPoints.map((point) => ({
          x: left + (right - left) * point.p,
          y: toY(point.value) + laneWidth(h, point.p, point.value, strike) * 0.5,
        }));

        ctx.fillStyle = "rgba(199,66,62,0.4)";
        ctx.beginPath();
        ctx.moveTo(upper[0]!.x, upper[0]!.y - short * 0.018);
        for (const point of upper) ctx.lineTo(point.x, point.y - short * 0.018);
        for (let index = lower.length - 1; index >= 0; index -= 1) {
          const point = lower[index]!;
          ctx.lineTo(point.x, point.y + short * 0.018);
        }
        ctx.closePath();
        ctx.fill();

        const roadFill = ctx.createLinearGradient(0, center - lane, 0, center + lane);
        roadFill.addColorStop(0, "#273039");
        roadFill.addColorStop(0.5, "#11171d");
        roadFill.addColorStop(1, "#242d34");
        ctx.fillStyle = roadFill;
        ctx.beginPath();
        ctx.moveTo(upper[0]!.x, upper[0]!.y);
        for (const point of upper) ctx.lineTo(point.x, point.y);
        for (let index = lower.length - 1; index >= 0; index -= 1) {
          const point = lower[index]!;
          ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = `rgba(247,147,26,${0.52 * glow})`;
        ctx.lineWidth = clamp(short * 0.004, 2, 7);
        ctx.lineJoin = "round";
        ctx.shadowColor = ORANGE;
        ctx.shadowBlur = short * 0.012 * glow;
        ctx.beginPath();
        allPoints.forEach((point, index) => {
          const x = left + (right - left) * point.p;
          const y = toY(point.value);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      if (progress < 0.995) {
        ctx.save();
        ctx.setLineDash([short * 0.009, short * 0.015]);
        ctx.strokeStyle = "rgba(237,232,220,0.13)";
        ctx.lineWidth = Math.max(1, short * 0.002);
        ctx.beginPath();
        ctx.moveTo(carX + short * 0.07, roadY);
        ctx.lineTo(right, roadY);
        ctx.stroke();
        ctx.restore();
        hud(ctx, "TAPE AHEAD UNWRITTEN", right, roadY + tiny * 1.1, "right", tiny, CREAM, 0.34);
      }

      let ghostY = 0;
      if (finalMinute && settleAvg > 0 && locked > 0 && strike > 0) {
        const visibleGhost = ghostRoad.length > 1
          ? ghostRoad
          : [{ p: Math.max(14 / 15, progress - 0.035), value: settleAvg }, { p: progress, value: settleAvg }];
        ctx.save();
        ctx.strokeStyle = "rgba(97,184,223,0.68)";
        ctx.lineWidth = clamp(short * 0.012, 5, 17);
        ctx.lineJoin = "round";
        ctx.shadowColor = BLUE;
        ctx.shadowBlur = short * 0.025;
        ctx.beginPath();
        visibleGhost.forEach((point, index) => {
          const x = left + (right - left) * point.p;
          const y = toY(point.value);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
        ghostY = toY(settleAvg);
        hud(ctx, "BLUE LANE SETTLES", right, ghostY + tiny * 1.2, "right", tiny, BLUE, 0.72);
      }

      if (spot > 0 && strike > 0) {
        drawCar(ctx, carX, carY, clamp(short * 0.046, 24, 62), offRoad, phase);
        if (offRoad) {
          ctx.fillStyle = "rgba(207,81,77,0.72)";
          for (let index = 0; index < 8; index += 1) {
            const scatter = (index + 1) / 8;
            ctx.fillRect(
              carX - short * (0.04 + scatter * 0.08),
              carY + Math.sin(phase * 13 + index) * short * 0.02,
              short * 0.006,
              short * 0.003,
            );
          }
        }
      }
      ctx.restore();

      const grip = driveTime > 0 ? Math.round((gripTime / driveTime) * 100) : null;
      const onGhost = ghostY > 0 && Math.abs(carY - ghostY) <= lane * 0.58;
      const flagReplay =
        seconds >= 890 &&
        priorRun != null &&
        lastSettledTicker === priorRun.ticker &&
        (lastSettled === "UP" || lastSettled === "DOWN") &&
        Math.abs(Date.now() - lastSettledAt) <= 2 * 60 * 1000;
      hud(ctx, mode === "drive" ? "DRIVE" : "WATCH", left, h * 0.055, "left", small, ORANGE, 0.92);
      hud(ctx, phaseWord, w * 0.5, h * 0.055, "center", small, finalMinute ? BLUE : CREAM, 0.86);
      hud(ctx, `FUEL ${clock}`, right, h * 0.055, "right", small, CREAM, 0.86);

      hud(ctx, "GRIP", left, h * 0.12, "left", tiny, CREAM, 0.42);
      hud(ctx, grip == null ? "—" : `${grip}%`, left, h * 0.12 + tiny * 1.35, "left", small, offRoad ? RED : CREAM, 0.9);
      hud(ctx, "RAILS", left, h * 0.12 + tiny * 3.8, "left", tiny, CREAM, 0.42);
      hud(ctx, String(rails), left, h * 0.12 + tiny * 5.15, "left", small, rails ? RED : CREAM, 0.86);

      hud(ctx, "LANDING", right, h * 0.12, "right", tiny, CREAM, 0.42);
      hud(
        ctx,
        finalMinute && ghostY > 0 ? (onGhost ? "ON GHOST" : "OFF GHOST") : "—",
        right,
        h * 0.12 + tiny * 1.35,
        "right",
        small,
        onGhost ? BLUE : finalMinute ? RED : CREAM,
        0.9,
      );
      hud(ctx, "CONTRACT", right, h * 0.12 + tiny * 3.8, "right", tiny, CREAM, 0.42);
      hud(
        ctx,
        settled === "UP" || settled === "DOWN" ? `SETTLED ${settled}` : "OPEN",
        right,
        h * 0.12 + tiny * 5.15,
        "right",
        small,
        settled === "UP" ? "#52c58b" : settled === "DOWN" ? RED : CREAM,
        0.88,
      );

      hud(ctx, "STRIKE GUARDRAIL", left, strikeY + tiny * 0.65, "left", tiny, ORANGE, 0.48);
      if (mode === "watch") hud(ctx, "TOUCH THE ROAD TO DRIVE", w * 0.5, h * 0.9, "center", tiny, CREAM, 0.48);
      else hud(ctx, assist ? "ASSIST ON · DRAG OR ↑↓" : "EXPERT · DRAG OR ↑↓", w * 0.5, h * 0.9, "center", tiny, CREAM, 0.48);

      if (seconds <= 0) {
        ctx.fillStyle = "rgba(2,3,4,0.78)";
        ctx.fillRect(0, h * 0.36, w, h * 0.3);
        hud(ctx, "CHECKERED", w * 0.5, h * 0.4, "center", clamp(short * 0.04, 24, 54), CREAM, 0.94);
        hud(ctx, grip == null ? "DRIVE: WATCHED" : `DRIVE: ${grip}% GRIP`, w * 0.5, h * 0.49, "center", small, ORANGE, 0.9);
        hud(ctx, settled ? `CONTRACT: SETTLED ${settled}` : "CONTRACT: AWAITING OFFICIAL SETTLEMENT", w * 0.5, h * 0.55, "center", small, settled === "UP" ? "#52c58b" : settled === "DOWN" ? RED : CREAM, 0.86);
      } else if (finalMinute && ghostY > 0 && seconds <= 8 && !onGhost && mode === "drive") {
        hud(ctx, "MISSED LANDING", w * 0.5, h * 0.78, "center", small, RED, 0.9);
      }

      if (flagReplay && priorRun) {
        ctx.fillStyle = "rgba(2,3,4,0.86)";
        ctx.fillRect(0, h * 0.34, w, h * 0.34);
        hud(ctx, "CHECKERED · LAST WINDOW", w * 0.5, h * 0.39, "center", clamp(short * 0.032, 20, 44), CREAM, 0.94);
        hud(ctx, `DRIVE: ${priorRun.grip}% GRIP · ${priorRun.rails} RAILS`, w * 0.5, h * 0.49, "center", small, ORANGE, 0.9);
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
        ctx.fillStyle = "rgba(2,3,4,0.76)";
        ctx.fillRect(0, 0, w, h);
        hud(ctx, !(strike > 0) ? "WAITING FOR GUARDRAIL" : "WAITING FOR THE PRINT", w * 0.5, h * 0.48, "center", small, CREAM, 0.76);
      }
    },
  };
};
