/** Share card for a seat page: PNG drawn on the server from the live frame. Public, cached five minutes. */
export default async function ogSeat(event: { url: URL }) {
  try {
    const id = (event.url.searchParams.get("id") ?? "").trim().toUpperCase();
    const { SEAT_IDS } = await import("../../../src/lib/desk/types");
    if (!(SEAT_IDS as readonly string[]).includes(id)) return new Response("not found", { status: 404 });
    const eng = await import("../../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const frame = await eng.getServerFrame();
    const { SEAT_BY_ID } = await import("../../../src/lib/desk/seats");
    const { wilsonLower } = await import("../../../src/lib/desk/math");
    const { readScalp, scalpAvg } = await import("../../../src/lib/desk/scalp");
    const { seatCard } = await import("../../../src/lib/desk/og.server");
    const meta = SEAT_BY_ID[id as keyof typeof SEAT_BY_ID];
    const vote = frame.votes.find((v) => v.seat === id);
    const n = frame.learner.seat_n[id] ?? 0;
    const hits = frame.learner.seat_hits[id] ?? 0;
    const png = seatCard({
      id,
      callsign: meta.callsign,
      eyes: meta.eyes,
      lean: vote?.lean ?? "WAIT",
      confidence: vote?.confidence ?? 0,
      skill: vote?.skill_used ?? "SIT",
      n,
      hits,
      wilson: n ? wilsonLower(hits, n) : 0,
      avg: scalpAvg(readScalp(frame.learner, id).legs),
      calls: frame.learner.seat_calls?.[id] ?? 0,
      recent: frame.learner.seat_recent?.[id] ?? [],
    });
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=300", "content-length": String(png.length) },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
