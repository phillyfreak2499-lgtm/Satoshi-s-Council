/** Read-only TAPE projection. Resting book size is not an execution tape. */
export default async function trainingTapeFrame() {
  try {
    const { getServerFrame } = await import("../../src/lib/desk/server-engine");
    const f = await getServerFrame();
    const v = f.votes.find((vote) => vote.seat === "TAPE");
    const s = f.snap;
    const body = {
      as_of: f.as_of, tick_age_s: f.tick_age_s,
      snap: s ? { ticker: s.ticker, close_time: s.close_time, spot: s.spot, strike: s.strike, candles_1m: s.candles_1m?.slice(-48) } : null,
      book: s ? { yes_bid_size: s.yes_bid_size, no_bid_size: s.no_bid_size, spread_cents: s.spread_cents, imbalance: s.imbalance, imbalance_hist: s.imbalance_hist?.slice(-24) } : null,
      tape: v ? { lean: v.lean, raw_lean: v.raw_lean, health: v.health, feed_age_s: v.feed_age_s, reasoning: v.reasoning, hypothesis: v.hypothesis, evidence: v.evidence, invalidate_if: v.invalidate_if, counter: v.counter, features: v.features } : null,
    };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch {
    return new Response(JSON.stringify({ error: "The training feed is unavailable." }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}
