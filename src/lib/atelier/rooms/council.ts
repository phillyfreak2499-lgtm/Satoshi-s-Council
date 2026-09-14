import { num, str, type Params } from "../catalog";
import { mulberry32 } from "../rng";
import type { RoomFactory, RoomWorld } from "../world";

type SeatStar = {
  seat: string;
  lean: "UP" | "DOWN" | "WAIT";
  confidence: number;
  x: number;
  y: number;
  phase: number;
};

const COLORS = {
  UP: "#55c78d",
  DOWN: "#d15b4a",
  WAIT: "#d4a02a",
} as const;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function parseVotes(raw: string, previous: SeatStar[], random: () => number): SeatStar[] {
  if (!raw) return previous;
  const prior = new Map(previous.map((seat) => [seat.seat, seat]));
  return raw
    .split(";")
    .map((entry) => {
      const [seat = "—", rawLean = "WAIT", rawConfidence = "0"] = entry.split("|");
      const lean: SeatStar["lean"] =
        rawLean === "UP" || rawLean === "DOWN" ? rawLean : "WAIT";
      const old = prior.get(seat);
      return {
        seat,
        lean,
        confidence: clamp(Number(rawConfidence) || 0, 0, 100),
        x: old?.x ?? 0.5,
        y: old?.y ?? 0.5,
        phase: old?.phase ?? random() * Math.PI * 2,
      };
    })
    .slice(0, 24);
}

function copy(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  size: number,
  color = "#eee8dc",
  alpha = 0.72,
) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function callWord(value: string) {
  if (value === "up") return "UP";
  if (value === "hold" || value === "down") return "DOWN";
  return "WAIT";
}

export const createCouncil: RoomFactory = (iw, ih, initialSeed, params): RoomWorld => {
  let w = iw;
  let h = ih;
  let seed = initialSeed;
  let random = mulberry32(seed ^ 0x3414f27b);
  let stars: SeatStar[] = [];
  let voteRaw = "";
  let chairCall = "WAIT";
  let confidence = 0;
  let score = 0;
  let bar = 0;
  let clock = "15:00";
  let phaseName = "—";
  let orbit = 1;
  let trails = 0.85;
  let phase = 0;

  const apply = (next: Params) => {
    const nextVotes = str(next, "votes", voteRaw);
    if (nextVotes !== voteRaw) {
      voteRaw = nextVotes;
      stars = parseVotes(voteRaw, stars, random);
    }
    chairCall = callWord(str(next, "paperCall", chairCall.toLowerCase()));
    confidence = clamp(num(next, "confidence", confidence), 0, 100);
    score = num(next, "score", score);
    bar = Math.max(0, num(next, "bar", bar));
    clock = str(next, "clock", clock);
    phaseName = str(next, "phase", phaseName);
    orbit = num(next, "orbit", orbit);
    trails = num(next, "trails", trails);
  };

  apply(params);

  return {
    resize(nextWidth, nextHeight) {
      w = nextWidth;
      h = nextHeight;
    },
    reseed(nextSeed) {
      seed = nextSeed;
      random = mulberry32(seed ^ 0x3414f27b);
      stars = stars.map((star) => ({ ...star, phase: random() * Math.PI * 2 }));
    },
    setParams: apply,
    pointer() {},
    step(dt) {
      phase += dt;
      const count = Math.max(1, stars.length);
      stars.forEach((star, index) => {
        const angle = -Math.PI * 0.93 + (index / Math.max(1, count - 1)) * Math.PI * 1.86;
        const baseX = 0.5 + Math.cos(angle) * 0.39 * orbit;
        const baseY = 0.53 + Math.sin(angle) * 0.34 * orbit;
        const directionalY = star.lean === "UP" ? 0.27 : star.lean === "DOWN" ? 0.73 : baseY;
        const targetX = clamp(baseX, 0.08, 0.92);
        const targetY = clamp(baseY * 0.45 + directionalY * 0.55, 0.12, 0.88);
        star.x += (targetX - star.x) * (1 - Math.exp(-2.8 * dt));
        star.y += (targetY - star.y) * (1 - Math.exp(-2.8 * dt));
      });
    },
    draw(ctx) {
      const short = Math.min(w, h);
      const tiny = clamp(short * 0.0125, 10, 17);
      const small = clamp(short * 0.018, 13, 25);
      const centerX = w * 0.5;
      const centerY = h * 0.52;
      const callColor = COLORS[chairCall as keyof typeof COLORS] ?? COLORS.WAIT;

      const background = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(w, h) * 0.72);
      background.addColorStop(0, "#121519");
      background.addColorStop(0.48, "#070a0d");
      background.addColorStop(1, "#020304");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.strokeStyle = "rgba(223,218,205,0.055)";
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, short * 0.11 * ring, short * 0.082 * ring, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      const directional = stars.filter((star) => star.lean !== "WAIT");
      ctx.save();
      ctx.lineWidth = Math.max(0.7, short * 0.0014);
      for (let index = 0; index < stars.length; index += 1) {
        const current = stars[index]!;
        const next = stars[(index + 1) % stars.length];
        if (!next) continue;
        ctx.strokeStyle = `rgba(212,160,42,${0.045 * trails})`;
        ctx.beginPath();
        ctx.moveTo(current.x * w, current.y * h);
        ctx.lineTo(next.x * w, next.y * h);
        ctx.stroke();
      }
      for (let index = 0; index < directional.length; index += 1) {
        const current = directional[index]!;
        const peers = directional.filter((candidate) => candidate.lean === current.lean);
        const next = peers[(peers.indexOf(current) + 1) % peers.length];
        if (!next || next === current) continue;
        const color = COLORS[current.lean];
        ctx.strokeStyle = `${color}${Math.round(clamp(0.16 * trails, 0, 0.7) * 255).toString(16).padStart(2, "0")}`;
        ctx.beginPath();
        ctx.moveTo(current.x * w, current.y * h);
        ctx.lineTo(next.x * w, next.y * h);
        ctx.stroke();
      }
      ctx.restore();

      for (const star of stars) {
        const x = star.x * w;
        const y = star.y * h;
        const color = COLORS[star.lean];
        const speaking = star.lean !== "WAIT";
        const breathe = 0.84 + Math.sin(phase * 0.8 + star.phase) * 0.16;
        const radius = short * (0.005 + (star.confidence / 100) * 0.008) * breathe;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * (speaking ? 7 : 4.2));
        halo.addColorStop(0, `${color}${speaking ? "d9" : "8f"}`);
        halo.addColorStop(0.22, `${color}${speaking ? "75" : "38"}`);
        halo.addColorStop(1, `${color}00`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, radius * (speaking ? 7 : 4.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.globalAlpha = speaking ? 0.88 : 0.35 + star.confidence / 300;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        copy(ctx, star.seat, x, y + radius * 2.6 + tiny * 0.55, "center", tiny, color, speaking ? 0.72 : 0.35);
      }

      const thresholdRadius = short * 0.105;
      const scoreRatio = bar > 0 ? clamp(Math.abs(score) / bar, 0, 1.25) : 0;
      ctx.save();
      ctx.setLineDash([short * 0.01, short * 0.012]);
      ctx.strokeStyle = "rgba(238,232,220,0.24)";
      ctx.lineWidth = Math.max(1, short * 0.0022);
      ctx.beginPath();
      ctx.arc(centerX, centerY, thresholdRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = callColor;
      ctx.lineWidth = clamp(short * 0.008, 3, 11);
      ctx.shadowColor = callColor;
      ctx.shadowBlur = short * 0.03;
      ctx.beginPath();
      ctx.arc(centerX, centerY, thresholdRadius * 0.78, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, scoreRatio));
      ctx.stroke();
      ctx.restore();

      const chairGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, short * 0.12);
      chairGlow.addColorStop(0, `${callColor}9a`);
      chairGlow.addColorStop(0.22, `${callColor}36`);
      chairGlow.addColorStop(1, `${callColor}00`);
      ctx.fillStyle = chairGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, short * 0.12, 0, Math.PI * 2);
      ctx.fill();

      copy(ctx, "SATOSHI", centerX, centerY - small * 0.62, "center", tiny, "#eee8dc", 0.48);
      copy(ctx, chairCall, centerX, centerY + small * 0.35, "center", clamp(short * 0.033, 22, 44), callColor, 0.94);
      copy(ctx, `${Math.round(confidence)} CONF`, centerX, centerY + small * 1.45, "center", tiny, "#eee8dc", 0.42);

      const up = stars.filter((star) => star.lean === "UP").length;
      const down = stars.filter((star) => star.lean === "DOWN").length;
      const wait = stars.filter((star) => star.lean === "WAIT").length;
      copy(ctx, "COUNCIL CONSTELLATION", w * 0.06, h * 0.065, "left", small, "#eee8dc", 0.72);
      copy(ctx, clock, w * 0.94, h * 0.065, "right", small, "#eee8dc", 0.8);
      copy(ctx, `${phaseName.toUpperCase()} · PAPER COUNCIL`, w * 0.06, h * 0.105, "left", tiny, callColor, 0.52);
      copy(ctx, `${up} UP · ${down} DOWN · ${wait} WAIT`, centerX, h * 0.92, "center", small, "#eee8dc", 0.74);
      copy(ctx, `|SCORE| ${Math.abs(score).toFixed(2)} / BAR ${bar.toFixed(2)} · RING IS NOT PROBABILITY`, centerX, h * 0.955, "center", tiny, "#eee8dc", 0.4);

      if (!stars.length) {
        ctx.fillStyle = "rgba(2,3,4,0.68)";
        ctx.fillRect(0, 0, w, h);
        copy(ctx, "WAITING FOR THE COUNCIL", centerX, centerY, "center", small, "#eee8dc", 0.7);
      }
    },
  };
};
