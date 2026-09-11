/** STRIKE 2.0's research read-out, admin-key only: a walk-forward calibrated
 *  P(UP) scored against the market's own price, on two arms — one row per
 *  settled window (independent) and every stored instant of every window
 *  (correlated, read for shape). Read-only, non-voting, off the public boards.
 *  Nothing here influences the chair, any seat, the learner or COACH, and no
 *  number in it can promote anything. Wrong or missing key → 404. */
export default async function strike2(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { strike2Study } = await import("../../src/lib/desk/strike2.server");
    return json(await strike2Study());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
