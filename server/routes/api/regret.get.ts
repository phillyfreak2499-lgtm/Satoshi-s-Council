/** Public, read-only prospective regret receipts and price-band totals. */
export default async function regret() {
  try {
    const { directionalRegretReport } =
      await import("../../../src/lib/desk/directional-regret.server");
    return Response.json(await directionalRegretReport(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
