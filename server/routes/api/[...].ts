/** The previous Council's API lived under /api. Those endpoints are gone;
 *  an old tab still polling them gets a calm 410 instead of an error page.
 *  The desk's live data is at /frame, /pulse, /arena/rack and friends. */
export default function legacyApi(event: { url: URL }) {
  const gone = !event.url.pathname.startsWith("/api/auth");
  return new Response(
    JSON.stringify({
      ok: false,
      error: gone ? "this was the old Council's API; the desk moved — see /frame, /pulse and /arena/rack" : "not found",
    }),
    {
      status: gone ? 410 : 404,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": gone ? "public, max-age=86400" : "no-store" },
    },
  );
}
