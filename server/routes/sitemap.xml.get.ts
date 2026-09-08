/** sitemap.xml: the reading pages, the rooms and every window with a replay. Public, cached an hour. */
export default async function sitemap(event: { req: Request }) {
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { siteOrigin, sitemapXml } = await import("../../src/lib/desk/site.server");
    return new Response(await sitemapXml(siteOrigin(event.req)), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
