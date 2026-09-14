export const TRAINING_COACHES = [
  { id: "wick", name: "WICK", specialty: "Candle structure", lesson: "Read closed candles, understand their location, and learn when to wait.", available: true },
  { id: "tape", name: "TAPE", specialty: "Order flow", lesson: "Follow the pressure behind the tape and learn what needs confirmation.", available: false },
  { id: "odds", name: "ODDS", specialty: "Market pricing", lesson: "Explore prices, probabilities, and the questions behind a paper decision.", available: false },
  { id: "wire", name: "WIRE", specialty: "Feed quality", lesson: "Learn what the desk can see, what is missing, and when to pause.", available: false },
] as const;
export function availableCoach(id: string) {
  return TRAINING_COACHES.find((coach) => coach.id === id && coach.available);
}
