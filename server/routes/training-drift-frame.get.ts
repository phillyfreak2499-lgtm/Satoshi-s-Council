/** Read-only DRIFT training projection. No learner, Chair, book, grading, or execution state is written. */
export default async function trainingDriftFrame() {
  try {
    const { getServerFrame } = await import("../../src/lib/desk/server-engine");
    const { readDrift } = await import("../../src/lib/desk/structure");
    const f = await getServerFrame();
    const v = f.votes.find((vote) => vote.seat === "DRIFT");
    const s = f.snap;
    const momentum = s ? readDrift(s) : null;
    const body = {
      as_of: f.as_of,
      tick_age_s: f.tick_age_s,
      snap: s
        ? {
            ticker: s.ticker,
            close_time: s.close_time,
            spot: s.spot,
            strike: s.strike,
            ret5: s.ret5,
            ret15: s.ret15,
            ret30: s.ret30,
            ret1h: s.ret1h,
            candles_1m: s.candles_1m?.slice(-48),
          }
        : null,
      momentum,
      drift: v
        ? {
            lean: v.lean,
            raw_lean: v.raw_lean,
            confidence: v.confidence,
            health: v.health,
            feed_age_s: v.feed_age_s,
            reasoning: v.reasoning,
            hypothesis: v.hypothesis,
            evidence: v.evidence,
            invalidate_if: v.invalidate_if,
            counter: v.counter,
            features: v.features,
          }
        : null,
    };
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "The training feed is unavailable." }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
