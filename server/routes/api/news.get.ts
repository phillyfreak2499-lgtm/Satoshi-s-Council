import { newsDatabase } from "../../../src/lib/news/database.server";
import { newsResponse } from "../../../src/lib/news/news";
import { getQuery, type H3Event } from "h3";

export default async function news(event: H3Event) {
  const requested = getQuery(event).feed;
  const feed = requested === "ai" || requested === "all" ? requested : "btc";
  try { return await newsResponse(newsDatabase(), new Date(), feed); }
  catch {
    return Response.json({ error: "Bitcoin Wire is temporarily unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
