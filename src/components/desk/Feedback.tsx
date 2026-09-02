import { useEffect, useMemo, useState } from "react";
import type { DeskFrame } from "@/lib/desk/engine";
import { fmtLocal, readMarket, zoneTag } from "@/lib/desk/market-hours";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";

const ISSUE =
  "https://github.com/phillyfreak2499-lgtm/Satoshi-s-Council/issues/new";

function snapshotBlurb(frame: DeskFrame) {
  const snap = frame.snap;
  const chair = frame.chair;
  const tz = frame.settings.tz || "America/Chicago";
  const m = snap ? readMarket(snap.as_of, snap.close_time) : null;
  const lines = [
    `SATOSHI beta feedback`,
    `when: ${fmtLocal(Date.now(), tz)} (${zoneTag(tz)})`,
    `source: ${frame.settings.source}`,
    snap
      ? `window: ${snap.ticker} · ${Math.max(0, snap.mins_left).toFixed(1)}m left · ${snap.phase}`
      : "window: none yet",
    chair
      ? `call: ${chair.lean} · ${chair.confidence} conf · size ${chair.size}`
      : "call: —",
    m ? `market: ${m.emoji} ${m.label}${m.event ? ` · ${m.event}` : ""}${m.micro ? " · turn" : ""}` : "",
    snap ? `YES ask ${snap.yes_ask.toFixed(1)}¢ · NO ask ${snap.no_ask.toFixed(1)}¢ · spot ${snap.spot.toFixed(0)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function Feedback({ frame }: { frame: DeskFrame }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const blurb = useMemo(() => snapshotBlurb(frame), [frame]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const body = [who.trim() ? `from: ${who.trim()}` : "from: (no name)", "", note.trim() || "(no note)", "", blurb].join(
    "\n",
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setStatus("Copied — paste it in the group chat or a text.");
    } catch {
      setStatus("Copy failed — select the text and copy it yourself.");
    }
  };

  const github = () => {
    const title = note.trim().slice(0, 72) || "Beta feedback";
    const url = `${ISSUE}?title=${encodeURIComponent(`Beta: ${title}`)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("Opened a GitHub issue draft.");
  };

  return (
    <div className="relative">
      <Tip k="beta.feedback" mark={false}>
        <button
          type="button"
          aria-expanded={open}
          aria-label="Send feedback"
          onClick={() => {
            setOpen((v) => !v);
            setStatus("");
          }}
          className={cn(
            "min-h-11 rounded-sm px-2 py-1 font-mono text-micro sm:min-h-0",
            open ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          Feedback
        </button>
      </Tip>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-border bg-surface p-3">
          <p className="mb-2 font-mono text-micro text-muted">
            Still learning. Tell us what looked wrong, slow, or smart. The current window is attached automatically.
          </p>
          <label className="mb-2 block font-mono text-micro text-subtle">
            Your name
            <input
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-data text-fg"
              placeholder="optional"
              autoComplete="nickname"
            />
          </label>
          <label className="mb-2 block font-mono text-micro text-subtle">
            Note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-sm border border-border bg-bg px-2 py-1.5 font-sans text-ui text-fg"
              placeholder="What did SATOSHI miss? What felt right?"
            />
          </label>
          <pre className="mb-2 max-h-20 overflow-auto rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-micro text-subtle">
            {blurb}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="min-h-11 rounded-sm border border-border px-3 py-1.5 font-mono text-micro text-fg hover:bg-surface-2 sm:min-h-0"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={github}
              className="min-h-11 rounded-sm border border-border px-3 py-1.5 font-mono text-micro text-fg hover:bg-surface-2 sm:min-h-0"
            >
              GitHub issue
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-sm px-3 py-1.5 font-mono text-micro text-muted hover:text-fg sm:min-h-0"
            >
              Close
            </button>
          </div>
          {status ? <p className="mt-2 font-mono text-micro text-wait">{status}</p> : null}
        </div>
      )}
    </div>
  );
}
