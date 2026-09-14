import { num, str, type Params } from "../catalog";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type Ingot = {
  seat: string;
  lean: "UP" | "DOWN" | "WAIT";
  confidence: number;
  phase: number;
};

type Spark = {
  angle: number;
  distance: number;
  speed: number;
  size: number;
  phase: number;
};

const GOLD = "#c4a574";
const AMBER = "#d4a02a";
const ORANGE = "#f7931a";
const UP = "#55c78d";
const DOWN = "#d15b4a";
const CREAM = "#eee8dc";

const COLORS = { UP, DOWN, WAIT: AMBER } as const;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function callWord(value: string): "UP" | "DOWN" | "WAIT" {
  if (value === "up") return "UP";
  if (value === "hold" || value === "down") return "DOWN";
  return "WAIT";
}

function parseVotes(raw: string, previous: Ingot[], random: () => number): Ingot[] {
  if (!raw) return previous;
  const phases = new Map(previous.map((ingot) => [ingot.seat, ingot.phase]));
  return raw
    .split(";")
    .map((entry) => {
      const [seat = "—", rawLean = "WAIT", rawConfidence = "0"] = entry.split("|");
      const lean: Ingot["lean"] = rawLean === "UP" || rawLean === "DOWN" ? rawLean : "WAIT";
      return {
        seat,
        lean,
        confidence: clamp(Number(rawConfidence) || 0, 0, 100),
        phase: phases.get(seat) ?? random() * Math.PI * 2,
      };
    })
    .slice(0, 24);
}

function makeSparks(random: () => number): Spark[] {
  return Array.from({ length: 44 }, () => ({
    angle: -Math.PI * (0.12 + random() * 0.76),
    distance: 0.15 + random() * 0.85,
    speed: 0.35 + random() * 1.1,
    size: 0.45 + random() * 1.25,
    phase: random() * 10,
  }));
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  size: number,
  color = CREAM,
  alpha = 0.72,
) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.font = `650 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawGavel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
  glow: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.22 * glow;

  const handle = ctx.createLinearGradient(-size * 0.52, 0, size * 0.48, 0);
  handle.addColorStop(0, "#443a2c");
  handle.addColorStop(0.48, GOLD);
  handle.addColorStop(1, "#5a4932");
  ctx.fillStyle = handle;
  ctx.fillRect(-size * 0.54, -size * 0.045, size * 0.98, size * 0.09);

  const head = ctx.createLinearGradient(0, -size * 0.22, 0, size * 0.22);
  head.addColorStop(0, "#8d7652");
  head.addColorStop(0.45, color);
  head.addColorStop(1, "#51422e");
  ctx.fillStyle = head;
  ctx.fillRect(size * 0.27, -size * 0.22, size * 0.29, size * 0.44);
  ctx.fillStyle = "rgba(238,232,220,0.28)";
  ctx.fillRect(size * 0.29, -size * 0.19, size * 0.25, size * 0.035);
  ctx.restore();
}

function drawAnvil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  lit: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = color;
  ctx.shadowBlur = lit ? size * 0.22 : size * 0.04;
  const metal = ctx.createLinearGradient(0, -size * 0.2, 0, size * 0.34);
  metal.addColorStop(0, lit ? color : "#8b8170");
  metal.addColorStop(0.14, "#5e5d59");
  metal.addColorStop(1, "#202225");
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.moveTo(-size * 0.48, -size * 0.16);
  ctx.lineTo(size * 0.5, -size * 0.16);
  ctx.lineTo(size * 0.38, size * 0.02);
  ctx.lineTo(size * 0.16, size * 0.08);
  ctx.lineTo(size * 0.24, size * 0.34);
  ctx.lineTo(-size * 0.24, size * 0.34);
  ctx.lineTo(-size * 0.16, size * 0.08);
  ctx.lineTo(-size * 0.38, size * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export const createForge: RoomFactory = (iw, ih, initialSeed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let seed = initialSeed;
  let random = mulberry32(seed ^ 0x4f7d3a21);
  let sparks = makeSparks(random);
  let ingots: Ingot[] = [];
  let voteRaw = "";
  let chairCall: "UP" | "DOWN" | "WAIT" = "WAIT";
  let confidence = 0;
  let score = 0;
  let bar = 0;
  let clock = "15:00";
  let phaseName = "—";
  let heat = 1;
  let sparkAmount = 0.85;
  let phase = 0;

  const apply = (next: Params) => {
    const nextVotes = str(next, "votes", voteRaw);
    if (nextVotes !== voteRaw) {
      voteRaw = nextVotes;
      ingots = parseVotes(voteRaw, ingots, random);
    }
    chairCall = callWord(str(next, "paperCall", chairCall.toLowerCase()));
    confidence = clamp(num(next, "confidence", confidence), 0, 100);
    score = num(next, "score", score);
    bar = Math.max(0, num(next, "bar", bar));
    clock = str(next, "clock", clock);
    phaseName = str(next, "phase", phaseName);
    heat = num(next, "heat", heat);
    sparkAmount = num(next, "sparks", sparkAmount);
  };

  apply(params);

  return {
    resize(nextWidth, nextHeight) {
      w = nextWidth;
      h = nextHeight;
    },
    reseed(nextSeed) {
      seed = nextSeed;
      random = mulberry32(seed ^ 0x4f7d3a21);
      sparks = makeSparks(random);
      ingots = ingots.map((ingot) => ({ ...ingot, phase: random() * Math.PI * 2 }));
    },
    setParams: apply,
    pointer() {},
    step(dt) {
      phase += dt;
    },
    draw(ctx) {
      const short = Math.min(w, h);
      const tiny = clamp(short * 0.0125, 10, 17);
      const small = clamp(short * 0.018, 13, 25);
      const large = clamp(short * 0.038, 24, 50);
      const cx = w * 0.5;
      const cy = h * 0.39;
      const furnaceRadius = short * 0.17;
      const callColor = COLORS[chairCall];
      const scoreColor = score > 0.001 ? UP : score < -0.001 ? DOWN : AMBER;
      const scoreRatio = bar > 0 ? Math.abs(score) / bar : 0;
      const ringRatio = clamp(scoreRatio, 0, 1);
      const barClear = bar > 0 && scoreRatio >= 1;
      const release = chairCall !== "WAIT";
      const impact = release ? Math.pow(Math.max(0, Math.sin(phase * 1.45)), 12) : 0;
      const breathe = 0.86 + Math.sin(phase * 1.1) * 0.14;

      const background = ctx.createLinearGradient(0, 0, 0, h);
      background.addColorStop(0, "#090b0d");
      background.addColorStop(0.58, "#11100d");
      background.addColorStop(1, "#030405");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.strokeStyle = "rgba(238,232,220,0.045)";
      ctx.lineWidth = Math.max(1, short * 0.0012);
      const grid = short * 0.085;
      for (let x = 0; x <= w; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = grid; y <= h; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();

      const furnaceGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, furnaceRadius * 2.15);
      furnaceGlow.addColorStop(0, `${scoreColor}78`);
      furnaceGlow.addColorStop(0.34, `${ORANGE}24`);
      furnaceGlow.addColorStop(1, `${ORANGE}00`);
      ctx.globalAlpha = clamp(heat * 0.76, 0.35, 1);
      ctx.fillStyle = furnaceGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, furnaceRadius * 2.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const count = Math.max(1, ingots.length);
      ingots.forEach((ingot, index) => {
        const angle = -Math.PI * 0.92 + (index / Math.max(1, count - 1)) * Math.PI * 1.84;
        const outerRadius = furnaceRadius * (1.48 + (index % 2) * 0.12);
        const innerRadius = furnaceRadius * 1.08;
        const outerX = cx + Math.cos(angle) * outerRadius;
        const outerY = cy + Math.sin(angle) * outerRadius;
        const innerX = cx + Math.cos(angle) * innerRadius;
        const innerY = cy + Math.sin(angle) * innerRadius;
        const color = COLORS[ingot.lean];
        const speaking = ingot.lean !== "WAIT";
        const pulse = 0.8 + Math.sin(phase * 0.75 + ingot.phase) * 0.2;
        const strength = clamp(ingot.confidence / 100, 0.12, 1);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = (speaking ? 0.26 : 0.07) * strength * heat;
        ctx.lineWidth = clamp(short * (0.0018 + strength * 0.0027), 1, 6);
        ctx.shadowColor = color;
        ctx.shadowBlur = speaking ? short * 0.018 * heat : 0;
        ctx.beginPath();
        ctx.moveTo(outerX, outerY);
        ctx.lineTo(innerX, innerY);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(outerX, outerY);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = speaking ? 0.76 : 0.24 + strength * 0.14;
        ctx.shadowColor = color;
        ctx.shadowBlur = speaking ? short * 0.018 * pulse : 0;
        const ingotW = short * (0.012 + strength * 0.01);
        ctx.fillRect(-ingotW, -short * 0.005, ingotW * 2, short * 0.01);
        ctx.restore();

        if (speaking) {
          label(
            ctx,
            ingot.seat,
            outerX + Math.cos(angle) * tiny * 1.45,
            outerY + Math.sin(angle) * tiny * 1.45,
            Math.cos(angle) >= 0 ? "left" : "right",
            tiny,
            color,
            0.66,
          );
        }
      });

      ctx.save();
      ctx.setLineDash([short * 0.012, short * 0.012]);
      ctx.strokeStyle = "rgba(238,232,220,0.34)";
      ctx.lineWidth = clamp(short * 0.003, 1.5, 5);
      ctx.beginPath();
      ctx.arc(cx, cy, furnaceRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (ringRatio > 0.001) {
        ctx.save();
        ctx.strokeStyle = scoreColor;
        ctx.lineWidth = clamp(short * 0.014, 6, 18);
        ctx.lineCap = "round";
        ctx.shadowColor = scoreColor;
        ctx.shadowBlur = short * 0.04 * heat;
        ctx.beginPath();
        ctx.arc(cx, cy, furnaceRadius * 0.88, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ringRatio);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, furnaceRadius * 0.68);
      core.addColorStop(0, `${scoreColor}${barClear ? "a8" : "70"}`);
      core.addColorStop(0.28, `${ORANGE}35`);
      core.addColorStop(1, "rgba(4,5,5,0.92)");
      ctx.fillStyle = core;
      ctx.shadowColor = scoreColor;
      ctx.shadowBlur = barClear ? short * 0.055 * breathe * heat : short * 0.018 * heat;
      ctx.beginPath();
      ctx.arc(cx, cy, furnaceRadius * 0.67, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      label(ctx, "WEIGHTED SCORE", cx, cy - large * 0.72, "center", tiny, CREAM, 0.42);
      label(
        ctx,
        `${score >= 0 ? "+" : ""}${score.toFixed(2)}`,
        cx,
        cy,
        "center",
        large,
        scoreColor,
        0.94,
      );
      label(ctx, `BAR ${bar.toFixed(2)}`, cx, cy + large * 0.72, "center", tiny, CREAM, 0.58);

      const anvilY = h * 0.76;
      const gavelY = h * 0.675 + impact * short * 0.055;
      const gavelAngle = release ? -0.4 + impact * 0.32 : -0.48 + Math.sin(phase * 0.7) * 0.018;
      drawAnvil(ctx, cx, anvilY, short * 0.34, callColor, impact > 0.7);
      drawGavel(
        ctx,
        cx - short * 0.02,
        gavelY,
        short * 0.34,
        gavelAngle,
        release ? callColor : GOLD,
        heat,
      );

      if (release && impact > 0.3 && sparkAmount > 0) {
        const sparkCount = Math.round(sparks.length * clamp(sparkAmount / 1.4, 0, 1));
        for (let index = 0; index < sparkCount; index += 1) {
          const spark = sparks[index]!;
          const life = (phase * spark.speed + spark.phase) % 1;
          const distance = short * (0.02 + life * 0.18 * spark.distance);
          const x = cx + Math.cos(spark.angle) * distance;
          const y =
            anvilY - short * 0.09 + Math.sin(spark.angle) * distance + life * life * short * 0.08;
          ctx.fillStyle = index % 3 === 0 ? callColor : ORANGE;
          ctx.globalAlpha = (1 - life) * impact * 0.9;
          ctx.fillRect(
            x,
            y,
            Math.max(1.2, tiny * 0.16 * spark.size),
            Math.max(1.2, tiny * 0.16 * spark.size),
          );
        }
        ctx.globalAlpha = 1;
      }

      const up = ingots.filter((ingot) => ingot.lean === "UP").length;
      const down = ingots.filter((ingot) => ingot.lean === "DOWN").length;
      const wait = ingots.filter((ingot) => ingot.lean === "WAIT").length;
      const margin = bar > 0 ? bar - Math.abs(score) : 0;
      const barState =
        bar <= 0
          ? "WAITING FOR BAR"
          : barClear
            ? "SCORE BAR CLEARED"
            : `SHORT ${Math.max(0, margin).toFixed(2)}`;

      label(ctx, "GAVEL FOUNDRY", w * 0.06, h * 0.06, "left", small, CREAM, 0.76);
      label(ctx, clock, w * 0.94, h * 0.06, "right", small, CREAM, 0.84);
      label(
        ctx,
        `${phaseName.toUpperCase()} · READ-ONLY FURNACE`,
        w * 0.06,
        h * 0.1,
        "left",
        tiny,
        callColor,
        0.54,
      );
      label(
        ctx,
        `${up} UP · ${down} DOWN · ${wait} WAIT`,
        w * 0.94,
        h * 0.1,
        "right",
        tiny,
        CREAM,
        0.48,
      );

      label(
        ctx,
        barState,
        cx,
        h * 0.57,
        "center",
        tiny,
        barClear ? scoreColor : CREAM,
        barClear ? 0.82 : 0.48,
      );
      label(
        ctx,
        `PUBLISHED ${chairCall} · ${release ? "GAVEL RELEASED" : "GAVEL HELD"}`,
        cx,
        h * 0.86,
        "center",
        small,
        callColor,
        0.88,
      );
      label(
        ctx,
        `${Math.round(confidence)} GATE CONFIDENCE`,
        cx,
        h * 0.895,
        "center",
        tiny,
        CREAM,
        0.42,
      );
      label(ctx, "SCORE RING · NOT WIN PROBABILITY", cx, h * 0.94, "center", tiny, CREAM, 0.4);
      label(
        ctx,
        "DISPLAY ONLY · CANNOT VOTE OR PLACE ORDERS",
        cx,
        h * 0.97,
        "center",
        tiny,
        GOLD,
        0.46,
      );

      if (!ingots.length) {
        ctx.fillStyle = "rgba(3,4,5,0.7)";
        ctx.fillRect(0, 0, w, h);
        label(ctx, "WAITING FOR THE COUNCIL", cx, h * 0.48, "center", small, CREAM, 0.72);
      }
    },
  };
};
