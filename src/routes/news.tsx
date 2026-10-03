import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page } from "@/components/desk/Page";
import type { FeedTag, NewsItem } from "@/lib/news/news";

export const Route = createFileRoute("/news")({
  validateSearch: (search: Record<string, unknown>): { feed?: "ai" } => ({ feed: search.feed === "ai" ? "ai" : undefined }),
  head: ({ match }) => ({ meta: [{ title: `${match.search.feed === "ai" ? "AI" : "Bitcoin"} Wire · Satoshi's Council` }, { name: "description", content: `${match.search.feed === "ai" ? "AI" : "Bitcoin"} headlines from allowlisted publishers. News context only.` }] }),
  component: BitcoinWire,
});
function relativeTime(published: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(published)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
function BitcoinWire() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const feed: FeedTag = search.feed === "ai" ? "ai" : "btc";
  const positions = useRef<Record<FeedTag, number>>({ btc: 0, ai: 0 });
  const tabs = useRef<HTMLButtonElement[]>([]);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const header = document.querySelector(".council-site-header");
    if (!header) return;
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const saved = positions.current;
    const target = saved[feed];
    const remember = () => { saved[feed] = window.scrollY; };
    // Restore after the router's rendered-location scroll handling, then track
    // user scrolling. Router resets must not overwrite a tab's saved position.
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: target, behavior: "instant" });
      window.addEventListener("scroll", remember, { passive: true });
    });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", remember); };
  }, [feed]);
  const select = (next: FeedTag) => {
    if (next === feed) return;
    void navigate({ search: { feed: next === "ai" ? "ai" : undefined }, resetScroll: false });
  };
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch("/api/news?feed=all", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("news unavailable");
        const list: NewsItem[] = await response.json();
        if (!Array.isArray(list)) throw new Error("invalid news response");
        if (!disposed) { setItems(list); setFailed(false); setNow(Date.now()); }
      } catch { if (!disposed) setFailed(true); }
      finally { clearTimeout(timeout); pending = false; }
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 5 * 60 * 1000);
    const clock = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => { disposed = true; controller?.abort(); clearInterval(poll); clearInterval(clock); };
  }, []);
  const visible = items?.filter(item => item.feed === feed);
  const name = feed === "ai" ? "AI" : "Bitcoin";
  return <Page title={`${name} Wire`} lede="News context — not research, not a SATOSHI call.">
    <div style={{ top: headerHeight }} className="sticky z-20 bg-bg py-2">
    <div role="tablist" aria-label="Wire feed" className="mb-2 inline-flex rounded-md border border-border bg-surface p-1">
      {(["btc", "ai"] as const).map((tag, index) => <button key={tag} ref={el => { if (el) tabs.current[index] = el; }}
        type="button" role="tab" id={`wire-tab-${tag}`} aria-controls="wire-headlines" aria-selected={feed === tag} tabIndex={feed === tag ? 0 : -1}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }}
        onClick={() => select(tag)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const target = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
          tabs.current[target]?.focus({ preventScroll: true }); select(target === 0 ? "btc" : "ai");
        }} className={`rounded-sm px-4 py-2 font-mono text-ui focus-visible:outline focus-visible:outline-2 ${feed === tag ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}>
        {tag === "btc" ? "Bitcoin" : "AI"}
      </button>)}
    </div>
    <p className="mb-3 text-micro text-subtle">News context, not desk research. Not a trading signal.</p>
    </div>
    <section role="tabpanel" id="wire-headlines" aria-labelledby={`wire-tab-${feed}`}>
    <p className="font-mono text-micro text-subtle">Headlines from independent publishers · refreshes every 5 minutes</p>
    {failed ? <p role="status" className="mt-4 text-body text-muted">{name} Wire is temporarily unavailable.{items ? " Showing the last loaded headlines." : " Retrying automatically."}</p> : null}
    {!items && !failed ? <p role="status" className="mt-4 text-body text-muted">Loading headlines…</p> : null}
    {visible?.length === 0 ? <p className="mt-4 text-body text-muted">No {name} headlines in the last 7 days yet.</p> : null}
    <ul className="mt-6 list-none divide-y divide-border p-0">
      {visible?.map(item => <li key={item.id} className="py-5">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="block rounded-sm font-sans text-body font-medium leading-relaxed text-fg underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={`${item.title} (opens in a new tab)`}>{item.title} <span aria-hidden="true">↗</span></a>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro text-muted"><span>{item.source}</span><time dateTime={item.published_at} title={new Date(item.published_at).toLocaleString()}>{relativeTime(item.published_at, now)}</time></p>
      </li>)}
    </ul>
    </section>
  </Page>;
}
