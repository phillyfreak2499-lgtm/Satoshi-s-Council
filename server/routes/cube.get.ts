/** The performance cube, admin-key only: the book's record cut by side, price,
 *  floor era, confidence, margin over the bar, session, weekday, seat agreement
 *  and each seat — with Wilson intervals, each cell's own breakeven, and a
 *  look-elsewhere count saying how many of the clearing cells chance alone
 *  would supply. Read-only and non-voting; it tunes nothing. Kept off the public
 *  boards because a slice-and-dice tool invites reading noise as signal.
 *  Wrong or missing key → 404. */
export default async function cube(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { cubeStudy } = await import("../../src/lib/desk/cube.server");
    return json(await cubeStudy());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
