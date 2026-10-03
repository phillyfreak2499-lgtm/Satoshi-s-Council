import { FEEDS, ingestItems, pruneItems, type Candidate, type FeedTag, type NewsDb } from "./news.ts";
import { fetchFeed } from "./fetch.ts";

/** One group's bounded publisher pass; every source gets a chance after failures. */
export async function collectGroup(db: NewsDb, tag: FeedTag, now = new Date(), load: (feed: typeof FEEDS[number]) => Promise<Candidate[]> = fetchFeed, log: (message: string) => void = console.log) {
  let failures = 0;
  for (const feed of FEEDS.filter(feed => feed.feed === tag)) {
    try {
      const inserted = await ingestItems(db, feed.source, await load(feed), now);
      log(`[bitcoin-wire/${tag}] ${feed.source}: ${inserted} new items`);
    } catch (error) {
      failures++;
      log(`[bitcoin-wire/${tag}] ${feed.source}: ${error instanceof Error ? error.message : "collection failed"}`);
    }
  }
  await pruneItems(db, now, tag);
  return failures;
}
