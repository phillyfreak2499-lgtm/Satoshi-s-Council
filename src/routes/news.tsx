import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Page } from "@/components/desk/Page";
import type { NewsItem } from "@/lib/news/news";

export const Route = createFileRoute("/news")({
  head: () => ({ meta: [{ title: "Bitcoin Wire · Satoshi's Council" }, { name: "description", content: "Bitcoin headlines from allowlisted publishers. News context only." }] }),
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
        const response = await fetch("/api/news", { cache: "no-store", signal: controller.signal });
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
  return <Page title="Bitcoin Wire" lede="News context — not research, not a SATOSHI call.">
    <p className="font-mono text-micro text-subtle">Headlines from independent publishers · refreshes every 5 minutes</p>
    {failed ? <p role="status" className="mt-4 text-body text-muted">Bitcoin Wire is temporarily unavailable.{items ? " Showing the last loaded headlines." : " Retrying automatically."}</p> : null}
    {!items && !failed ? <p role="status" className="mt-4 text-body text-muted">Loading headlines…</p> : null}
    {items?.length === 0 ? <p className="mt-4 text-body text-muted">No Bitcoin headlines in the last 7 days yet.</p> : null}
    <ul className="mt-6 list-none divide-y divide-border p-0">
      {items?.map(item => <li key={item.id} className="py-5">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="block rounded-sm font-sans text-body font-medium leading-relaxed text-fg underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={`${item.title} (opens in a new tab)`}>{item.title} <span aria-hidden="true">↗</span></a>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro text-muted"><span>{item.source}</span><time dateTime={item.published_at} title={new Date(item.published_at).toLocaleString()}>{relativeTime(item.published_at, now)}</time></p>
      </li>)}
    </ul>
  </Page>;
}
