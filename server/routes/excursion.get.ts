/** MAE/MFE, admin-key only: what each booked call was worth while it was still
 *  open, walked from the stored replay path and marked at the bid on the side
 *  held. Read-only, non-voting, off the public boards — the numbers are
 *  hindsight by construction and an exit rule read straight off them would be
 *  fitted to the past. Wrong or missing key → 404. */
export default async function excursion(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { excursionStudy } = await import("../../src/lib/desk/excursion.server");
    return json(await excursionStudy());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
