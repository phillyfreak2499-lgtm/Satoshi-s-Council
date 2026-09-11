/** HEAD for /og/seat — OpenTweet and link checkers probe HEAD; GET-only routes 404. */
import seatGet from "./seat.get";

export default async function ogSeatHead(event: { url: URL; req?: Request }) {
  const res = await seatGet(event);
  return new Response(null, { status: res.status, headers: res.headers });
}
