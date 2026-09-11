/** The research board, admin-key only: for every Phase 2 measurement, how much
 *  sample it has and how much of that was recorded AFTER its definition was
 *  frozen — the only count that is evidence for it. Also the six-seat objection
 *  watchlist, listed so the sample can be watched growing. Read-only; the status
 *  ladder stops at "measurable" and nothing here promotes anything.
 *  Wrong or missing key → 404. */
export default async function research(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { researchStudy } = await import("../../src/lib/desk/research-status.server");
    return json(await researchStudy());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
