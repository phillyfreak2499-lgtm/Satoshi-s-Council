/** Admin-only read of Chair v3 shadow research. No writes and no decision authority. */
export default async function chairV3Research(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { chairV3Snapshot } = await import("../../../src/lib/desk/chair-v3.server");
    return json(await chairV3Snapshot());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
