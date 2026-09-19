export const TRAINING_COACHES = [
  { id: "wick", name: "WICK", specialty: "Candle structure", lesson: "Read closed candles, understand their location, and learn when to wait.", available: true },
  { id: "tape", name: "TAPE", specialty: "Order-book pressure", lesson: "Read resting book size, compare pressure over successive snapshots, and learn what the book cannot prove.", available: true },\n  { id: "drift", name: "DRIFT", specialty: "Momentum alignment", lesson: "Compare 5m, 15m, and 30m movement to separate aligned momentum from a bounce, pullback, or mixed tape.", available: true },
  { id: "odds", name: "ODDS", specialty: "Market pricing", lesson: "Explore prices, probabilities, and the questions behind a paper decision.", available: false },
  { id: "wire", name: "WIRE", specialty: "Market sentiment", lesson: "Explore the Fear & Greed reading and learn why sentiment needs context.", available: false },
] as const;
export function availableCoach(id: string) {
  return TRAINING_COACHES.find((coach) => coach.id === id && coach.available);
}
/** Two-digit screen label for the six-screen station grid: 01–06. */
export const screenNumber = (index: number) => String(index + 1).padStart(2, "0");
