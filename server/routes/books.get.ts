/** The desk's books, read straight from the ledger: last window, totals,
 *  the cents curve, calibration by price, the hour-by-weekday heat and the
 *  recent windows. Public, cached for 30 seconds. Nothing here writes. */
export default async function books() {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
    });
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { booksSummary } = await import("../../src/lib/desk/books.server");
    return json(await booksSummary());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
