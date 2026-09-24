import { useMemo, useState } from "react";

type Bar = { o: number; h: number; l: number; c: number };
type Card = {
  id: string;
  code: string;
  name: string;
  hint: string;
  why: string;
  bars: Bar[];
  choices: string[];
};

const CARDS: Card[] = [
  {
    id: "1",
    code: "HAM",
    name: "Hammer (HAM)",
    hint: "Small body. Long lower tail. Closed.",
    why: "Price sold off, then came back to close near the open. WICK names that shape HAM. Location is the next lesson.",
    bars: [
      { o: 72, h: 78, l: 68, c: 70 },
      { o: 70, h: 73, l: 66, c: 67 },
      { o: 66, h: 69, l: 42, c: 67 },
    ],
    choices: ["Hammer (HAM)", "Shooting star (SHOOT)", "Doji (DOJI)", "Bull engulfing (ENG UL)"],
  },
  {
    id: "2",
    code: "SHOOT",
    name: "Shooting star (SHOOT)",
    hint: "Small body. Long upper tail. Closed.",
    why: "Price ran up and gave it back by the close. WICK names that shape SHOOT. A tail is not a next-bar promise.",
    bars: [
      { o: 48, h: 54, l: 46, c: 52 },
      { o: 52, h: 58, l: 50, c: 56 },
      { o: 56, h: 84, l: 54, c: 58 },
    ],
    choices: ["Hammer (HAM)", "Shooting star (SHOOT)", "Gravestone doji (GRAV)", "Bear harami (HAR DN)"],
  },
  {
    id: "3",
    code: "DOJI",
    name: "Doji (DOJI)",
    hint: "Open and close nearly the same.",
    why: "The body almost disappeared. WICK prints DOJI. That is indecision on this bar, not a vote for the next window.",
    bars: [
      { o: 50, h: 62, l: 46, c: 58 },
      { o: 58, h: 64, l: 52, c: 60 },
      { o: 60, h: 72, l: 48, c: 61 },
    ],
    choices: ["Doji (DOJI)", "Hammer (HAM)", "Pin (PIN)", "Morning star (MORN)"],
  },
  {
    id: "4",
    code: "DRAG",
    name: "Dragonfly doji (DRAG)",
    hint: "Almost the whole range is a lower tail.",
    why: "Open, high, and close sit together at the top of the bar. The journey was down and back. WICK names that DRAG.",
    bars: [
      { o: 70, h: 74, l: 64, c: 68 },
      { o: 68, h: 71, l: 62, c: 69 },
      { o: 78, h: 80, l: 38, c: 79 },
    ],
    choices: ["Dragonfly doji (DRAG)", "Gravestone doji (GRAV)", "Hammer (HAM)", "Doji (DOJI)"],
  },
  {
    id: "5",
    code: "GRAV",
    name: "Gravestone doji (GRAV)",
    hint: "Almost the whole range is an upper tail.",
    why: "Open and close sit at the bottom of the bar after a failed run up. WICK names that GRAV.",
    bars: [
      { o: 42, h: 48, l: 40, c: 46 },
      { o: 46, h: 52, l: 44, c: 50 },
      { o: 42, h: 86, l: 40, c: 43 },
    ],
    choices: ["Gravestone doji (GRAV)", "Shooting star (SHOOT)", "Dragonfly doji (DRAG)", "Inverted hammer (INVH)"],
  },
  {
    id: "6",
    code: "ENG UL",
    name: "Bull engulfing (ENG UL)",
    hint: "A green body that covers the prior red.",
    why: "The last closed green body swallows the prior red body. WICK names that ENG UL. Two closed bars. Still not a fill.",
    bars: [
      { o: 62, h: 66, l: 58, c: 60 },
      { o: 60, h: 62, l: 50, c: 52 },
      { o: 50, h: 72, l: 48, c: 70 },
    ],
    choices: ["Bull engulfing (ENG UL)", "Bear engulfing (ENG DN)", "Bull harami (HAR UL)", "Piercing line (PIERCE)"],
  },
  {
    id: "7",
    code: "ENG DN",
    name: "Bear engulfing (ENG DN)",
    hint: "A red body that covers the prior green.",
    why: "The last closed red body swallows the prior green body. WICK names that ENG DN.",
    bars: [
      { o: 48, h: 54, l: 46, c: 52 },
      { o: 52, h: 64, l: 50, c: 62 },
      { o: 64, h: 66, l: 42, c: 44 },
    ],
    choices: ["Bear engulfing (ENG DN)", "Bull engulfing (ENG UL)", "Bear harami (HAR DN)", "Dark cloud (DARK)"],
  },
  {
    id: "8",
    code: "HAR UL",
    name: "Bull harami (HAR UL)",
    hint: "A small green candle inside a prior red.",
    why: "The last closed green body lives inside the prior red body. WICK names that HAR UL. Inside is the observation. Confirmation is still a later close.",
    bars: [
      { o: 70, h: 74, l: 66, c: 68 },
      { o: 68, h: 70, l: 42, c: 44 },
      { o: 50, h: 58, l: 48, c: 56 },
    ],
    choices: ["Bull harami (HAR UL)", "Bull engulfing (ENG UL)", "Bear harami (HAR DN)", "Doji (DOJI)"],
  },
];

function CandleTape({ bars }: { bars: Bar[] }) {
  const pad = 18;
  const w = 320;
  const h = 140;
  const min = Math.min(...bars.map((b) => b.l)) - 4;
  const max = Math.max(...bars.map((b) => b.h)) + 4;
  const y = (v: number) => pad + ((max - v) / (max - min)) * (h - pad * 2);
  const slot = (w - pad * 2) / bars.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label="Frozen closed candles">
      <rect width={w} height={h} fill="#0e1413" />
      {bars.map((b, i) => {
        const x = pad + slot * i + slot / 2;
        const up = b.c >= b.o;
        const color = up ? "#7dcea0" : "#d9897a";
        const top = y(Math.max(b.o, b.c));
        const bot = y(Math.min(b.o, b.c));
        const body = Math.max(3, bot - top);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={color} strokeWidth="2" />
            <rect x={x - 7} y={top} width="14" height={body} fill={color} />
          </g>
        );
      })}
      <text x={pad} y={h - 6} fill="#8a8474" fontSize="8" fontFamily="ui-monospace, monospace">
        CLOSED · ILLUSTRATED · NOT LIVE
      </text>
    </svg>
  );
}

export function WickPatternDrill() {
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [hits, setHits] = useState(0);
  const [seen, setSeen] = useState(0);
  const card = CARDS[i]!;
  const done = seen >= CARDS.length && pick != null;
  const scoreLine = useMemo(() => `${hits} of ${seen || 0} named`, [hits, seen]);

  return (
    <section aria-labelledby="pattern-drill" className="mt-8 rounded-md border border-wait/30 bg-surface p-5 sm:p-6">
      <p className="font-mono text-micro uppercase tracking-widest text-wait">Lesson 02 · drill</p>
      <h2 id="pattern-drill" className="mt-2 font-sans text-title font-medium">Name the shape</h2>
      <p className="mt-2 max-w-2xl font-sans text-body leading-relaxed text-muted">
        Eight frozen closed candles. Name what WICK would print. Do not lean UP or DOWN yet. Location is the next lesson.
      </p>
      <p className="mt-2 font-mono text-micro text-subtle">Card {card.id} of {CARDS.length} · {scoreLine} · paper only</p>
      <div className="mt-4 overflow-hidden rounded border border-border bg-bg">
        <CandleTape bars={card.bars} />
      </div>
      <p className="mt-3 font-mono text-micro text-wait">{card.hint}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {card.choices.map((choice) => {
          const selected = pick === choice;
          const correct = choice === card.name;
          const shown = pick != null && (selected || correct);
          return (
            <button
              key={choice}
              type="button"
              disabled={pick != null}
              onClick={() => {
                if (pick != null) return;
                setPick(choice);
                setSeen((n) => n + 1);
                if (choice === card.name) setHits((n) => n + 1);
              }}
              className={`min-h-11 rounded-sm border px-3 py-2 text-left font-mono text-micro ${
                shown && correct
                  ? "border-up/50 bg-up/10 text-up"
                  : shown && selected
                    ? "border-down/50 bg-down/10 text-down"
                    : "border-border bg-canvas text-fg hover:border-border-strong"
              }`}
            >
              {choice}
            </button>
          );
        })}
      </div>
      {pick ? (
        <p className="mt-4 font-sans text-body leading-relaxed text-fg">
          {pick === card.name ? "WICK agrees. " : `WICK’s print is ${card.name}. `}
          {card.why} Desk code stays in parentheses ({card.code}).
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!pick}
          onClick={() => {
            setPick(null);
            setI((n) => (n + 1) % CARDS.length);
          }}
          className="btn btn-primary"
        >
          {i === CARDS.length - 1 ? "Start the eight again ↗" : "Next closed candle ↗"}
        </button>
        {done ? <span className="self-center font-mono text-micro text-subtle">{hits}/{CARDS.length} this pass. Shape first. Place next.</span> : null}
      </div>
    </section>
  );
}
