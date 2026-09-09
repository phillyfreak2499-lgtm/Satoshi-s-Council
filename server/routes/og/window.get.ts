/** Share card for a window page: PNG drawn on the server from the window's replay. Public, cached an hour. */
export default async function ogWindow(event: { url: URL }) {
  try {
    const ticker = (event.url.searchParams.get("ticker") ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(ticker)) return new Response("not found", { status: 404 });
    const eng = await import("../../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { replayFor } = await import("../../../src/lib/desk/replay.server");
    const { windowCard } = await import("../../../src/lib/desk/og.server");
    const rep = await replayFor(ticker);
    if (!rep) return new Response("not found", { status: 404 });
    const png = windowCard({
      ticker: rep.ticker,
      close_time: rep.close_time,
      strike: rep.strike,
      winner: rep.winner,
      official: rep.official,
      call: rep.call,
      cols: { spot: rep.cols.spot, yes_ask: rep.cols.yes_ask, lean: rep.cols.lean },
    });
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=3600", "content-length": String(png.length) },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
