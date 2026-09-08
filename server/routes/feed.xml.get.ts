/** feed.xml: the board's update posts as Atom, for a feed reader. Public, cached five minutes. */
export default async function feed(event: { req: Request }) {
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { siteOrigin, feedXml } = await import("../../src/lib/desk/site.server");
    return new Response(await feedXml(siteOrigin(event.req)), {
      headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
