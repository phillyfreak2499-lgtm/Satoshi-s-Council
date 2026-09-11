/** The seat-signal study, admin-key only: for each seat, whether the price is
 *  worth less than it claims on the windows that seat objects to it. A hit rate
 *  is not skill — the price is right about four times in five and a seat that
 *  agrees inherits that. Read-only, non-voting; it reweights nothing.
 *  Wrong or missing key → 404. */
export default async function seatSignal(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { signalStudy } = await import("../../src/lib/desk/seat-signal.server");
    return json(await signalStudy());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
