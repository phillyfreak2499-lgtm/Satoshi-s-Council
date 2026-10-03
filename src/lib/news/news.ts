import { XMLParser, XMLValidator } from "fast-xml-parser";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export type FeedTag = 'btc' | 'ai';
export const FEEDS = Object.freeze([
  { feed: "btc" as const, source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", hosts: ["coindesk.com", "www.coindesk.com"] },
  { feed: "btc" as const, source: "The Block", url: "https://www.theblock.co/rss.xml", hosts: ["theblock.co", "www.theblock.co"] },
  { feed: "btc" as const, source: "Decrypt", url: "https://decrypt.co/feed", hosts: ["decrypt.co", "www.decrypt.co"] },
  { feed: "btc" as const, source: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed", hosts: ["bitcoinmagazine.com", "www.bitcoinmagazine.com"] },
  { feed: "ai" as const, source: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", hosts: ["techcrunch.com", "www.techcrunch.com"] },
  { feed: "ai" as const, source: "MIT Tech Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", hosts: ["technologyreview.com", "www.technologyreview.com"] },
].map(feed => Object.freeze({ ...feed, hosts: Object.freeze(feed.hosts) })));

export interface NewsItem {
  feed: FeedTag;
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  fetched_at: string;
}
export interface Candidate {
  title: string;
  url: string;
  published_at: string;
  description?: string;
}
export interface NewsDb {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export function allowedUrl(source: string, raw: string): boolean {
  const feed = FEEDS.find(feed => feed.source === source);
  if (!feed) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && feed.hosts.includes(url.hostname);
  } catch { return false; }
}

function plain(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}
export function normalizeItem(source: string, candidate: Candidate, now = new Date()): Candidate | null {
  if (!allowedUrl(source, candidate.url)) return null;
  const title = plain(candidate.title);
  const feed = FEEDS.find(feed => feed.source === source)!;
  if (!title || (feed.feed === "btc" && !/\b(?:bitcoin|btc)\b/i.test(`${title} ${plain(candidate.description)}`))) return null;
  const published = Date.parse(candidate.published_at);
  if (!Number.isFinite(published) || published > now.getTime() || published < now.getTime() - RETENTION_MS) return null;
  const url = new URL(candidate.url);
  url.hash = "";
  return { title, url: url.href, published_at: new Date(published).toISOString() };
}

/** RSS 2.0 + Atom, with entities decoded; external/custom DTD entities forbidden. */
export function parseFeed(xml: string): Candidate[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("invalid RSS XML");
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true }).parse(xml);
  const root = doc.rss?.channel ?? doc.feed;
  if (!root) throw new Error("not an RSS or Atom feed");
  const entries = root.item ?? root.entry ?? [];
  const list = Array.isArray(entries) ? entries : [entries];
  const value = (input: unknown): string => typeof input === "string" ? input : (input && typeof input === "object" ? String((input as Record<string, unknown>)["#text"] ?? "") : "");
  return list.slice(0, 1000).map((entry: Record<string, any>) => {
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const link = links.find((link: any) => typeof link === "string" || (link && (!link["@_rel"] || link["@_rel"] === "alternate")));
    return {
      title: value(entry.title),
      url: typeof link === "string" ? link : link?.["@_href"] ?? value(link),
      published_at: value(entry.pubDate ?? entry.published ?? entry.updated ?? entry.date),
      description: value(entry.description ?? entry.summary ?? entry.content ?? entry.encoded),
    };
  });
}

export async function ingestItems(db: NewsDb, source: string, candidates: Candidate[], now = new Date()): Promise<number> {
  const feed = FEEDS.find(feed => feed.source === source);
  if (!feed) throw new Error("non-allowlisted news source");
  let inserted = 0;
  for (const candidate of candidates) {
    const item = normalizeItem(source, candidate, now);
    if (!item) continue;
    const result = await db.query(
      "insert into news_items (title, source, url, published_at, fetched_at, feed) values ($1, $2, $3, $4, $5, $6) on conflict (url) do nothing returning id",
      [item.title, source, item.url, item.published_at, now.toISOString(), feed.feed],
    );
    inserted += result.rows.length;
  }
  return inserted;
}
export async function pruneItems(db: NewsDb, now = new Date(), feed?: FeedTag): Promise<void> {
  await db.query("delete from news_items where published_at < $1" + (feed ? " and feed = $2" : ""), [new Date(now.getTime() - RETENTION_MS).toISOString(), ...(feed ? [feed] : [])]);
}
export async function latestNews(db: NewsDb, now = new Date(), feed: FeedTag = "btc"): Promise<NewsItem[]> {
  const result = await db.query(
    "select id::text, title, source, url, published_at, fetched_at, feed from news_items where published_at >= $1 and published_at <= $2 and feed = $3 order by published_at desc, id desc limit 30",
    [new Date(now.getTime() - RETENTION_MS).toISOString(), now.toISOString(), feed],
  );
  return result.rows.map(row => ({
    feed: row.feed as FeedTag, id: String(row.id), title: String(row.title), source: String(row.source), url: String(row.url),
    published_at: new Date(row.published_at as string).toISOString(), fetched_at: new Date(row.fetched_at as string).toISOString(),
  }));
}
export async function newsResponse(db: NewsDb, now = new Date(), feed: FeedTag | "all" = "btc"): Promise<Response> {
  const items = feed === "all" ? [...await latestNews(db, now, "btc"), ...await latestNews(db, now, "ai")] : await latestNews(db, now, feed);
  return Response.json(items, { headers: { "cache-control": "no-store" } });
}
