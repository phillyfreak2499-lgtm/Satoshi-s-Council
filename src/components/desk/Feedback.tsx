import { useEffect, useRef, useState } from "react";
import { listBoard, postBoard, type BoardPost } from "@/lib/desk/board";
import type { DeskFrame } from "@/lib/desk/engine";
import { fmtLocal } from "@/lib/desk/market-hours";
import { cn } from "@/lib/utils";
import { LeanChip } from "./bits";
import { Tip } from "./Tip";

const WHO_KEY = "satoshi-desk-v1-board-who";

function loadWho() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(WHO_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Feedback({ frame }: { frame: DeskFrame }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(loadWho);
  const [note, setNote] = useState("");
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tz = frame.settings.tz || "America/Chicago";

  const pull = async () => {
    try {
      const rows = await listBoard();
      setPosts(rows);
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Board is down.");
    }
  };

  useEffect(() => {
    void pull();
    const ms = open ? 3000 : 10000;
    const t = window.setInterval(() => void pull(), ms);
    return () => window.clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSeen(posts.length);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, posts.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const unread = !open && posts.length > seen ? posts.length - seen : 0;

  const send = async () => {
    const body = note.trim();
    if (!body || busy) return;
    setBusy(true);
    setStatus("");
    try {
      localStorage.setItem(WHO_KEY, who.trim().slice(0, 24));
      await postBoard({
        data: {
          who,
          body,
          lean: frame.chair?.lean ?? "",
          ticker: frame.snap?.ticker ?? "",
          conf: frame.chair?.confidence ?? 0,
        },
      });
      setNote("");
      await pull();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <Tip k="beta.feedback" mark={false}>
        <button
          type="button"
          aria-expanded={open}
          aria-label="Live board"
          onClick={() => {
            setOpen((v) => !v);
            setStatus("");
          }}
          className={cn(
            "relative min-h-11 rounded-sm px-2 py-1 font-mono text-micro sm:min-h-0",
            open ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          Board
          {unread > 0 ? (
            <span className="ml-1 rounded-sm bg-wait/20 px-1 font-mono text-micro text-wait">{unread}</span>
          ) : (
            <span className="ml-1 inline-block size-1.5 rounded-full bg-up/80" title="live" />
          )}
        </button>
      </Tip>
      {open && (
        <div className="absolute right-0 z-40 mt-1 flex w-80 flex-col rounded-md border border-border bg-surface">
          <div className="border-b border-border px-3 py-2">
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">Live board</div>
            <p className="mt-0.5 font-mono text-micro text-muted">Same tape, everyone. Paper notes only.</p>
          </div>
          <div ref={listRef} className="max-h-64 overflow-auto px-3 py-2">
            {!posts.length ? (
              <p className="font-mono text-micro text-muted">No notes yet. First one on the tape.</p>
            ) : (
              <ul className="space-y-2.5">
                {posts.map((p) => (
                  <li key={p.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-micro text-fg">{p.who}</span>
                      <span className="font-mono text-micro tabular text-subtle">{fmtLocal(p.t, tz)}</span>
                    </div>
                    <p className="mt-0.5 font-sans text-ui text-fg">{p.body}</p>
                    {p.lean ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {p.lean === "UP" || p.lean === "DOWN" || p.lean === "WAIT" ? (
                          <LeanChip lean={p.lean} />
                        ) : null}
                        {p.conf ? (
                          <span className="font-mono text-micro text-subtle">{p.conf} conf</span>
                        ) : null}
                        {p.ticker ? (
                          <span className="truncate font-mono text-micro text-subtle">{p.ticker}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className="mb-2 w-full rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-data text-fg"
              placeholder="your name"
              maxLength={24}
              autoComplete="nickname"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
              maxLength={400}
              className="w-full resize-none rounded-sm border border-border bg-bg px-2 py-1.5 font-sans text-ui text-fg"
              placeholder="What did you see?"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="submit"
                disabled={busy || !note.trim()}
                className="min-h-11 rounded-sm border border-border px-3 py-1.5 font-mono text-micro text-fg hover:bg-surface-2 disabled:opacity-40 sm:min-h-0"
              >
                Post
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-sm px-2 py-1.5 font-mono text-micro text-muted hover:text-fg sm:min-h-0"
              >
                Close
              </button>
            </div>
            {status ? <p className="mt-2 font-mono text-micro text-wait">{status}</p> : null}
          </form>
        </div>
      )}
    </div>
  );
}
