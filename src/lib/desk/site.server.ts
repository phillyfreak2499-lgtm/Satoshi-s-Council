/**
 * The site's machine-readable edges (server only): sitemap.xml with the
 * reading pages, the rooms and every window that has a replay, and an Atom
 * feed of the board's update posts. Pure builders, so both can be tested.
 */
import { SEAT_IDS } from "./types";

async function getDb() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/** https://host, from the proxy's forwarded host when there is one. */
export function siteOrigin(req: { headers: Headers }): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "satoshiscouncil.com").split(",")[0]!.trim();
  return `https://${host.replace(/^https?:\/\//, "")}`;
}
export function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export const STATIC_PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: "/", changefreq: "always", priority: "1.0" },
  ...["/books", "/board", "/chamber", "/lab"].map((path) => ({ path, changefreq: "hourly", priority: "0.8" })),
  { path: "/training", changefreq: "weekly", priority: "0.8" },
  { path: "/training/wick", changefreq: "daily", priority: "0.8" },
  { path: "/arena", changefreq: "always", priority: "0.9" },
  { path: "/about", changefreq: "monthly", priority: "0.6" },
  { path: "/faq", changefreq: "monthly", priority: "0.6" },
  { path: "/legal", changefreq: "monthly", priority: "0.3" },
];

export function buildSitemap(origin: string, windows: { ticker: string; close_time: string }[], now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  const urls = STATIC_PAGES.map(
    (p) => `  <url><loc>${xmlEscape(origin + p.path)}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
  );
  for (const id of SEAT_IDS) {
    urls.push(`  <url><loc>${xmlEscape(`${origin}/seat/${id}`)}</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.5</priority></url>`);
  }
  for (const w of windows) {
    urls.push(
      `  <url><loc>${xmlEscape(`${origin}/window/${encodeURIComponent(w.ticker)}`)}</loc><lastmod>${w.close_time.slice(0, 10)}</lastmod><changefreq>never</changefreq><priority>0.4</priority></url>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export type FeedPost = { id: number; body: string; slug: string | null; created_at: string };

/** A title is the post's first sentence, trimmed to a line. */
export function feedTitle(p: FeedPost): string {
  const first = p.body.split(/(?<=[.!?])\s/)[0] ?? p.body;
  const t = first.trim().replace(/\s+/g, " ");
  return t.length > 96 ? `${t.slice(0, 93).trimEnd()}…` : t || p.slug || `Update ${p.id}`;
}

export function buildFeed(origin: string, posts: FeedPost[], now = new Date()): string {
  const updated = posts[0]?.created_at ?? now.toISOString();
  const entries = posts.map((p) => {
    const link = `${origin}/board`;
    return [
      "  <entry>",
      `    <title>${xmlEscape(feedTitle(p))}</title>`,
      `    <id>tag:satoshiscouncil.com,2026:board/${p.id}</id>`,
      `    <link href="${xmlEscape(link)}"/>`,
      `    <updated>${p.created_at}</updated>`,
      `    <published>${p.created_at}</published>`,
      `    <author><name>DESK</name></author>`,
      `    <content type="text">${xmlEscape(p.body)}</content>`,
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>Satoshi's Council — board updates</title>",
    "  <subtitle>What changed on a paper-only Bitcoin 15-minute research desk. Not financial advice.</subtitle>",
    `  <link href="${xmlEscape(origin + "/feed.xml")}" rel="self"/>`,
    `  <link href="${xmlEscape(origin + "/")}"/>`,
    `  <id>${xmlEscape(origin + "/feed.xml")}</id>`,
    `  <updated>${updated}</updated>`,
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export async function sitemapXml(origin: string): Promise<string> {
  const db = await getDb();
  const rows = await db<{ ticker: string; close_time: Date | string }>`
    select ticker, close_time from desk_replay order by close_time desc limit 400
  `;
  return buildSitemap(origin, rows.map((r) => ({ ticker: r.ticker, close_time: iso(r.close_time) })));
}

export async function feedXml(origin: string): Promise<string> {
  const db = await getDb();
  const rows = await db<{ id: number; body: string; slug: string | null; created_at: Date | string }>`
    select id, body, slug, created_at from board where kind = 'update' order by created_at desc limit 50
  `;
  return buildFeed(origin, rows.map((r) => ({ id: Number(r.id), body: r.body, slug: r.slug, created_at: iso(r.created_at) })));
}
