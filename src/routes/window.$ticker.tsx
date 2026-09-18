import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Page } from "@/components/desk/Page";
import { ReplayPane } from "@/components/desk/ReplayPane";
import { ogWindowImage, pageHead } from "@/lib/desk/site";
import { loadReplay } from "@/lib/desk/replay";

const TICKER_RE = /^[A-Z0-9-]{4,40}$/;

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

/** One graded window on its own page, so a replay can be shared by link. Paper only. */
function WindowPage() {
  const { ticker } = Route.useParams();
  const replay = Route.useLoaderData();
  const [msg, setMsg] = useState<string | null>(null);
  const [tz, setTz] = useState("America/Chicago");

  useEffect(() => setTz(browserTz()), []);
  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
        await navigator.share({ title: `Window replay · ${ticker}`, url });
        setMsg("shared");
        return;
      }
      await navigator.clipboard.writeText(url);
      setMsg("link copied");
    } catch (e) {
      setMsg(e instanceof Error && e.name === "AbortError" ? null : "could not share — copy the address bar instead");
    }
  };
  return (
    <Page
      title="Window replay"
      lede="One Bitcoin 15-minute window, replayed: what the seats saw and said, the chair's read, and Kalshi's official settlement value. Paper only."
    >
      <ReplayPane ticker={ticker} tz={tz} initial={replay} />
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-micro text-muted">
        <button
          type="button"
          onClick={() => void share()}
          className="btn btn-secondary"
        >
          share this window
        </button>
        <a href="/desk" className="btn btn-secondary">
          open the floor
        </a>
        {msg ? <span aria-live="polite">{msg}</span> : null}
      </div>
      <p className="mt-3 max-w-[70ch] font-mono text-micro leading-relaxed text-subtle">
        Nothing here was a live order. The chair books on paper at the ask plus Kalshi&apos;s fee, at 80¢ or better, and is graded on the official
        settlement value: the average of the final minute&apos;s sixty BRTI prints. Not financial advice.
      </p>
    </Page>
  );
}

export const Route = createFileRoute("/window/$ticker")({
  beforeLoad: ({ params }) => {
    if (!TICKER_RE.test(params.ticker)) throw notFound();
  },
  loader: async ({ params }) => {
    const replay = await loadReplay({ data: { ticker: params.ticker } });
    if (!replay) throw notFound();
    return replay;
  },
  head: ({ params }) => pageHead(`/window/${encodeURIComponent(params.ticker)}`, `Window replay · ${params.ticker} · Satoshi's Council`, "Replay one Bitcoin paper window: recorded prices, specialist reads, the chair’s call and official settlement. Not financial advice.", ogWindowImage(params.ticker)),
  component: WindowPage,
});
