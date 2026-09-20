/** Owner-only AI cost observability. Header auth only: never put the admin key in a URL. */
export default async function aiCost(event: { req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });

  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });

    const { aiCostSnapshot } = await import("../../../src/lib/desk/ai-cost.server");
    return json(await aiCostSnapshot());
  } catch (err) {
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}
