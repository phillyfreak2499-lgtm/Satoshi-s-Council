import { newsDatabase } from "../../../src/lib/news/database.server";
import { newsResponse } from "../../../src/lib/news/news";

export default async function news() {
  try { return await newsResponse(newsDatabase()); }
  catch {
    return Response.json({ error: "Bitcoin Wire is temporarily unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
