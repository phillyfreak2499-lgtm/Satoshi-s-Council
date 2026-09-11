/** The absorption study, admin-key only: on the windows where aggressive size
 *  crossed and the price did not respond, did the outcome happen more or less
 *  often than Kalshi's price implied? Not a hit rate and not a signal. Reports
 *  a frozen grid of candidate bands rather than one threshold, keeps BUY and
 *  SELL and single and clustered apart, discards every pre-quantity-fix
 *  observation rather than pooling it, and answers each way the effect could be
 *  nothing before asking whether it is something. Wrong or missing key → 404. */
export default async function absorption(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { absorptionStudy } = await import("../../src/lib/desk/absorption.server");
    return json(await absorptionStudy());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
