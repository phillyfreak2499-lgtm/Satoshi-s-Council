export function plainSeatNote({ pattern, location, pending, reasoning } = {}) {
  const PATTERN_PLAIN = {
    "HAR UL": "Bull harami — a small green candle inside a prior red (HAR UL)",
    "HAR DN": "Bear harami — a small red candle inside a prior green (HAR DN)",
    HAM: "Hammer — a small body with a long lower tail (HAM)",
    HAMMER: "Hammer — a small body with a long lower tail (HAMMER)",
  };
  const LOCATION_PLAIN = {
    HIGH: "near the top of the recent range (HIGH)",
    LOW: "near the bottom of the recent range (LOW)",
    MID: "in the middle of the recent range (MID)",
  };
  const p = pattern ? PATTERN_PLAIN[pattern] || pattern : null;
  const place = location ? LOCATION_PLAIN[location] || location : null;
  if (p && place) {
    const wait = pending ? " Waiting for the next candle to close before treating this as confirmed." : "";
    return `${p} ${place}.${wait}`;
  }
  const raw = (reasoning || "").trim();
  if (!raw) return "No recorded reason was printed for this snapshot.";
  return raw
    .replace(/\bHAR UL\b/g, "bull harami (HAR UL)")
    .replace(/\bHAR DN\b/g, "bear harami (HAR DN)")
    .replace(/\bat MID\b/g, "in the middle of the recent range (MID)")
    .replace(/\bat HIGH\b/g, "near the top of the recent range (HIGH)")
    .replace(/\bat LOW\b/g, "near the bottom of the recent range (LOW)")
    .replace(/\bwaiting confirm close\b/gi, "waiting for the next candle to close");
}
