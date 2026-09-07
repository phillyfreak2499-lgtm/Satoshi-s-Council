/** The Arena summary (JSON): leaderboards (7 days and all-time), the desk's
 *  own rows for comparison, and — with ?token= — the caller's record and
 *  calls. The HTML room lives at /arena; this is /arena/summary. */
export default async function arena(event: { url: URL }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const eng = await import("../../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { arenaSummary } = await import("../../../src/lib/desk/arena.server");
    return json(await arenaSummary(event.url.searchParams.get("token")));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
