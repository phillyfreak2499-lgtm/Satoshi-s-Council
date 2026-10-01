/** Public, read-only prospective regret receipts and price-band totals. */
export default async function regret(event: { url: URL }) {
  try {
    const { directionalRegretReport } =
      await import("../../../src/lib/desk/directional-regret.server");
    const raw = event.url.searchParams.get("cursor");
    let cursor;
    if (raw) {
      try {
        cursor = JSON.parse(raw);
        if (
          typeof cursor.ticker !== "string" ||
          !["UP", "DOWN"].includes(cursor.side) ||
          !Number.isFinite(Date.parse(cursor.observed_at)) ||
          !Number.isFinite(Date.parse(cursor.close_time))
        )
          throw Error("invalid cursor");
      } catch {
        return Response.json({ error: "invalid cursor" }, { status: 400 });
      }
    }
    return Response.json(await directionalRegretReport(cursor), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
