/** HEAD for /og/window — OpenTweet and link checkers probe HEAD; GET-only routes 404. */
import windowGet from "./window.get";

export default async function ogWindowHead(event: { url: URL; req?: Request }) {
  const res = await windowGet(event);
  return new Response(null, { status: res.status, headers: res.headers });
}
