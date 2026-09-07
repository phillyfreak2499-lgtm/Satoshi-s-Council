/** One graded window's replay: what the desk saw and said every few
 *  seconds. Public; immutable once written, so cached for an hour. */
export default async function replay(event: { url: URL }) {
  const json = (body: unknown, status = 200, maxAge = 3600) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` },
    });
  try {
    const ticker = event.url.searchParams.get("ticker") ?? "";
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { replayFor } = await import("../../src/lib/desk/replay.server");
    const r = await replayFor(ticker);
    if (!r) return json({ ok: false, error: "no replay for that window" }, 404, 30);
    return json(r);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500, 0);
  }
}
