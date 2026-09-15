/**
 * Admin-only, read-only inventory of desk features and their documented
 * authority. Wrong or missing key returns 404, matching the research endpoints.
 */
export default async function featureRegistry(event: {
  url: URL;
  req: { headers: Headers };
}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });

  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });

    const { featureRegistryReport } = await import("../../src/lib/desk/feature-registry");
    const report = featureRegistryReport();
    return json(report, report.ok ? 200 : 500);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
