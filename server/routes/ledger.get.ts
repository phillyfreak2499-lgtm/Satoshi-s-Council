/** LEDGER's read-only panel: the cross-seat vote patterns it has mined from
 *  the ledger and promoted walk-forward. Public, cached for 30 seconds.
 *  Nothing here writes; LEDGER never votes. */
export default async function ledger() {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
    });
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { ledgerSummary } = await import("../../src/lib/desk/ledger-clerk.server");
    return json(await ledgerSummary());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
