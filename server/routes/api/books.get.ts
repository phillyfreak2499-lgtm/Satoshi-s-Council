/** Public, read-only Books data. The human page lives at /books. */
export default async function books() {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
    });
  try {
    const eng = await import("../../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { booksSummary } = await import("../../../src/lib/desk/books.server");
    return json(await booksSummary());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
