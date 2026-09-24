export const TRAINING_COACHES = [
  { id: "wick", name: "WICK", specialty: "Candle structure", lesson: "Read closed candles, understand their location, and learn when to wait.", available: true },
  { id: "tape", name: "TAPE", specialty: "Order-book pressure", lesson: "Read resting book size, compare pressure over successive snapshots, and learn what the book cannot prove.", available: true },
  { id: "drift", name: "DRIFT", specialty: "Momentum alignment", lesson: "Compare 5m, 15m, and 30m movement to separate aligned momentum from a bounce, pullback, or mixed tape.", available: true },
  { id: "streak", name: "STREAK", specialty: "Settled chips", lesson: "Count official Kalshi results, ask whether the YES book still agrees, and learn when a streak is a sit.", available: true },
  { id: "odds", name: "ODDS", specialty: "Market pricing", lesson: "Explore prices, probabilities, and the questions behind a paper decision.", available: false },
  { id: "wire", name: "WIRE", specialty: "Market sentiment", lesson: "Explore the Fear & Greed reading and learn why sentiment needs context.", available: false },
] as const;

export function availableCoach(id: string) {
  return TRAINING_COACHES.find((coach) => coach.id === id && coach.available);
}

/** Two-digit screen label for the six-screen station grid: 01–06. */
export const screenNumber = (index: number) => String(index + 1).padStart(2, "0");

/** WICK is the candle seat and the first training coach. Same read, two doors. */
export const WICK_ROLE_LINE =
  "WICK reads candles on the floor and teaches the same read in training.";

/** Alchemist is the Lab voice, not a voting seat. */
export const ALCHEMIST_ROLE_LINE =
  "Alchemist reports Lab experiment milestones. Nothing in the Lab moves the Chair.";

export const LESSON_ONE = {
  title: "Lesson 01 · Close first. Then a read.",
  points: [
    "A closed candle is evidence. A forming candle is not.",
    "Location matters more than color — near the top (HIGH), bottom (LOW), or middle (MID) of the recent range.",
    "If you cannot say what would invalidate the read, the read is WAIT.",
    "A lean is not a fill. Matching WICK books nothing.",
  ],
} as const;

export const WICK_LESSON_TWO = {
  title: "Lesson 02 · Name the shape.",
  points: [
    "Name the closed candle before you lean. Shape is not a vote.",
    "WICK’s first shapes: hammer, shooting star, doji, dragonfly, gravestone, engulfing, harami.",
    "Desk codes stay in parentheses: HAM, SHOOT, DOJI, DRAG, GRAV, ENG UL, ENG DN, HAR UL.",
    "Location is the next lesson. Do not treat a hammer and a hanging man as different shapes yet.",
    "A named pattern is still not a fill.",
  ],
} as const;

export const STREAK_LESSON_ONE = {
  title: "Lesson 01 · Count the chips. Then ask the book.",
  points: [
    "Official settles are chips. Spot versus the strike is someone else’s job.",
    "Live agreement is the YES book, not Bitcoin versus the line.",
    "A young streak that still agrees with the book can ride. An extended streak (≥5) can fade. A break ends it.",
    "If the last four chips alternate, or you cannot name the setup, the read is WAIT.",
    "A lean is not a fill. Matching STREAK books nothing.",
  ],
} as const;

/** Desk shorthand → first-lesson English. Code stays in parentheses. */
export const PATTERN_PLAIN: Record<string, string> = {
  "HAR UL": "Bull harami — a small green candle inside a prior red (HAR UL)",
  "HAR DN": "Bear harami — a small red candle inside a prior green (HAR DN)",
  "ENG UL": "Bull engulfing — a green body that covers the prior red (ENG UL)",
  "ENG DN": "Bear engulfing — a red body that covers the prior green (ENG DN)",
  HAM: "Hammer — a small body with a long lower tail (HAM)",
  HAMMER: "Hammer — a small body with a long lower tail (HAMMER)",
  HANG: "Hanging man — hammer shape near the top of the range (HANG)",
  INVH: "Inverted hammer — a small body with a long upper tail at a LOW (INVH)",
  SHOOT: "Shooting star — a small body with a long upper tail at a HIGH (SHOOT)",
  DOJI: "Doji — open and close nearly the same (DOJI)",
  DRAG: "Dragonfly doji — almost all of the range is a lower tail (DRAG)",
  GRAV: "Gravestone doji — almost all of the range is an upper tail (GRAV)",
  PIN: "Pin — a long tail that price did not keep by the close (PIN)",
  "TWZ HI": "Tweezer top — two bars reject the same high (TWZ HI)",
  "TWZ LO": "Tweezer bottom — two bars reject the same low (TWZ LO)",
  MORN: "Morning star — three-bar turn up (MORN)",
  EVEN: "Evening star — three-bar turn down (EVEN)",
  PIERCE: "Piercing line — green close back through the midpoint of the prior red (PIERCE)",
  DARK: "Dark cloud — red close back through the midpoint of the prior green (DARK)",
};

export const LOCATION_PLAIN: Record<string, string> = {
  HIGH: "near the top of the recent range (HIGH)",
  LOW: "near the bottom of the recent range (LOW)",
  MID: "in the middle of the recent range (MID)",
};

export function plainSeatNote(input: {
  pattern?: string | null;
  location?: string | null;
  pending?: boolean | null;
  reasoning?: string | null;
}): string {
  const pattern = input.pattern ? PATTERN_PLAIN[input.pattern] ?? input.pattern : null;
  const place = input.location ? LOCATION_PLAIN[input.location] ?? input.location : null;
  if (pattern && place) {
    const wait = input.pending ? " Waiting for the next candle to close before treating this as confirmed." : "";
    return `${pattern} ${place}.${wait}`;
  }
  const raw = input.reasoning?.trim();
  if (!raw) return "No recorded reason was printed for this snapshot.";
  return raw
    .replace(/\bHAR UL\b/g, "bull harami (HAR UL)")
    .replace(/\bHAR DN\b/g, "bear harami (HAR DN)")
    .replace(/\bat MID\b/g, "in the middle of the recent range (MID)")
    .replace(/\bat HIGH\b/g, "near the top of the recent range (HIGH)")
    .replace(/\bat LOW\b/g, "near the bottom of the recent range (LOW)")
    .replace(/\bwaiting confirm close\b/gi, "waiting for the next candle to close");
}

export type GuidedQuestion = { q: string; a: string };

export const GUIDED_QUESTIONS: Record<string, GuidedQuestion[]> = {
  wick: [
    {
      q: "Why are you waiting?",
      a: "The forming candle can still change shape until the minute ends. WICK only treats a candle as evidence after the feed marks it closed. If the next close has not confirmed the pattern, the printed seat decision is WAIT.",
    },
    {
      q: "What is a wick?",
      a: "The body is the distance between open and close. The thin tails — the wicks — show how far price traveled and then gave back. A long tail is an observation about that bar, not a promise about the next one.",
    },
    {
      q: "What would change your mind?",
      a: "A later closed candle that breaks the condition written on the notes. If no invalidation is written, the honest read is still WAIT.",
    },
    {
      q: "What is lesson one?",
      a: "Close first. Then a read. You do not need the live market to take it — the illustrated practice example is labeled and frozen.",
    },
    {
      q: "What is lesson two?",
      a: "Name the shape. Eight frozen closed candles: hammer, shooting star, doji, dragonfly, gravestone, bull engulfing, bear engulfing, bull harami. No lean yet. Location is lesson three.",
    },
    {
      q: "What is a hammer?",
      a: "A small body with a long lower tail after the bar has closed (HAM). Price sold off and came back. WICK names the shape first. Whether that hammer sits at a LOW or a HIGH is the next lesson.",
    },
    {
      q: "What is an engulfing candle?",
      a: "A closed body that covers the prior closed body. Green covering red is ENG UL. Red covering green is ENG DN. Two closed bars. Still not a fill.",
    },
  ],
  tape: [
    {
      q: "Why are you waiting?",
      a: "Resting size on one side of the book can flip in the next snapshot. TAPE waits until the same pressure holds across enough fresh prints to be worth talking about.",
    },
    {
      q: "What can the book not prove?",
      a: "A larger bid or offer is not a fill and not a future trade. The book shows what is resting now. It does not show who will still be there after the next print.",
    },
    {
      q: "What would change your mind?",
      a: "A flip in persistence — the imbalance changing sign — or a stale feed. TAPE will not invent size that the snapshot did not print.",
    },
  ],
  drift: [
    {
      q: "Why are you waiting?",
      a: "A bounce on one timeframe is not aligned momentum. DRIFT waits until the 5-minute, 15-minute and 30-minute moves agree, or else the printed read is WAIT.",
    },
    {
      q: "What is aligned momentum?",
      a: "The same direction across the teaching timeframes, not a single sharp print. Mixed signs are a pullback or chop, not a stack.",
    },
    {
      q: "What would change your mind?",
      a: "One of the teaching timeframes flipping while the others hold, or the feed going stale. Alignment is checked on closed evidence, not on a forming bar.",
    },
  ],
  streak: [
    {
      q: "What is a chip?",
      a: "One official Kalshi settlement for a closed 15-minute window. STREAK reads the last official results as a tape of chips — not candles, and not the live Bitcoin print versus the strike.",
    },
    {
      q: "Why does the YES book matter?",
      a: "A settled streak is history. The live YES book is whether that history is still being paid. If the book has already flipped against a young streak, STREAK treats the streak as broken and sits.",
    },
    {
      q: "When do you ride?",
      a: "When the official streak is young (about 2–4) and the YES mid still agrees with that side. That is a continue setup — a lean, not a booked paper position.",
    },
    {
      q: "When do you fade?",
      a: "When the official streak is extended (≥5) and the book is still on that side. STREAK looks for the run that has gone too far. Fade is still a lean. The chair still has to clear price, fee, and time.",
    },
    {
      q: "What would change your mind?",
      a: "The YES book breaking the streak side, the chips flipping into alternating chop, or a streak that is neither young-and-agreed nor extended. If the setup cannot be named, STREAK prints WAIT.",
    },
  ],
};

export function stationCopy(id: string) {
  const coach = availableCoach(id);
  if (!coach) return null;
  return {
    coach,
    questions: GUIDED_QUESTIONS[coach.id] ?? [],
    role: coach.id === "wick" ? WICK_ROLE_LINE : `${coach.name} teaches the same evidence it votes on the floor.`,
    lessonOne: coach.id === "wick" ? LESSON_ONE : coach.id === "streak" ? STREAK_LESSON_ONE : null,
    lessonTwo: coach.id === "wick" ? WICK_LESSON_TWO : null,
  };
}
