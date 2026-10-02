import { allowedUrl, FEEDS, parseFeed } from "./news.ts";

/** Bounded reads and manually checked redirects keep every request on the allowlist. */
export async function fetchFeed(feed: typeof FEEDS[number], request: typeof fetch = fetch) {
  const known = FEEDS.find(candidate => candidate.source === feed.source && candidate.url === feed.url);
  if (!known) throw new Error("non-allowlisted feed");
  const signal = AbortSignal.timeout(15_000);
  let url = known.url;
  for (let redirect = 0; redirect <= 3; redirect++) {
    if (!allowedUrl(known.source, url)) throw new Error("non-allowlisted feed URL");
    const response = await request(url, {
      redirect: "manual", signal,
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "SatoshisCouncil-BitcoinWire/1.0" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("feed redirect missing location");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`feed HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("empty feed");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let xml = "";
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error("feed exceeds 2 MiB");
        xml += decoder.decode(value, { stream: true });
      }
      xml += decoder.decode();
      return parseFeed(xml);
    } finally { await reader.cancel(); }
  }
  throw new Error("too many feed redirects");
}
