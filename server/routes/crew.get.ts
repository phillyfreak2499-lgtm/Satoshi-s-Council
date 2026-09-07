/** The Pit Crew's read-only panel: SWEEP's latest scorecard, COACH's knobs
 *  and log, WRENCH's log. Public, cached for 30 seconds. Nothing here
 *  writes; the knobs have no HTTP path at all. */
export default async function crew() {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
    });
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { crewSummary } = await import("../../src/lib/desk/crew.server");
    return json(await crewSummary());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
