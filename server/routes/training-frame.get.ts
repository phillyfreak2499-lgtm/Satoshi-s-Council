/** Read-only training projection. No grades, orders, or learner state are written here. */
export default async function trainingFrame() {
  try {
    const { getServerFrame } = await import("../../src/lib/desk/server-engine");
    const f = await getServerFrame();
    const v = f.votes.find((vote) => vote.seat === "WICK");
    const snap = f.snap;
    const body = {
      as_of: f.as_of,
      tick_age_s: f.tick_age_s,
      snap: snap ? { ticker: snap.ticker, close_time: snap.close_time, spot: snap.spot, strike: snap.strike, location: snap.location, candles_1m: snap.candles_1m?.slice(-48) } : null,
      wick: v ? { lean: v.lean, raw_lean: v.raw_lean, health: v.health, reasoning: v.reasoning, hypothesis: v.hypothesis, evidence: v.evidence, invalidate_if: v.invalidate_if, counter: v.counter, features: v.features } : null,
    };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch {
    return new Response(JSON.stringify({ error: "The training feed is unavailable." }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}
