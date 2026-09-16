import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { GLOSS } from "@/lib/desk/glossary";
import { SEATS } from "@/lib/desk/seats";
import { SITE_DESTINATIONS } from "@/lib/desk/navigation";
import type { SeatId, TabId } from "@/lib/desk/types";
import { cn } from "@/lib/utils";

type Item =
  | { kind: "tab"; id: TabId; label: string; hint: string }
  | { kind: "seat"; id: SeatId; label: string; hint: string }
  | { kind: "action"; id: string; label: string; hint: string }
  | { kind: "page"; href: string; label: string; hint: string }
  | { kind: "gloss"; id: string; label: string; hint: string; body: string };

const TAB_ITEMS: { id: TabId; label: string; hint: string }[] = [
  { id: "satoshi", label: "FLOOR", hint: "the chair's call and the vote" },
  { id: "structure", label: "STRUCTURE", hint: "candles and swings · WICK DRIFT STREAK EXHAUST" },
  { id: "tape", label: "TAPE", hint: "order flow and the book · PULSE TAPE WHALE VEL" },
  { id: "derivs", label: "DERIVS", hint: "funding, open interest, liquidations · CARRY CHAIN CASCADE VOLT" },
  { id: "book", label: "BOOK", hint: "the odds themselves · ODDS STRIKE CHEAP FADE INDEX" },
  { id: "context", label: "CONTEXT", hint: "clock and regime · ORBIT CLOCK WIRE WARDEN" },
  { id: "atelier", label: "GALLERY", hint: "atelier, visualizations and Streamer" },
  { id: "crew", label: "PIT CREW", hint: "SWEEP, COACH, WRENCH and LEDGER" },
  { id: "settings", label: "SETTINGS", hint: "demo or live, alerts, display" },
];

const PAGES: { href: string; label: string; hint: string }[] = SITE_DESTINATIONS.filter(
  ({ href }) => href !== "/" && !href.startsWith("/?"),
).map(({ href, label, hint }) => ({ href, label, hint }));

function score(q: string, text: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  return 0;
}

export function Palette({
  open,
  onOpenChange,
  onTab,
  onJump,
  onTour,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onTab: (t: TabId) => void;
  onJump: (s: SeatId) => void;
  onTour: () => void;
}) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setShown(null);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const out: (Item & { s: number })[] = [];
    if (!needle || "tour".includes(needle) || score(needle, "start the 60-second tour") || score(needle, "help")) {
      out.push({ kind: "action", id: "tour", label: "Start the 60-second tour", hint: "six stops, Esc to leave", s: needle ? 3 : 2 });
    }
    for (const t of TAB_ITEMS) {
      const s = Math.max(score(needle, t.label), score(needle, t.hint));
      if (s) out.push({ kind: "tab", ...t, s });
    }
    for (const p of PAGES) {
      const s = Math.max(score(needle, p.label), score(needle, p.hint));
      if (s) out.push({ kind: "page", ...p, s: s - 0.5 });
    }
    for (const m of SEATS) {
      const label = `${m.id} · ${m.callsign}`;
      const s = Math.max(score(needle, m.id), score(needle, m.callsign), score(needle, m.eyes));
      if (s && needle) out.push({ kind: "seat", id: m.id, label, hint: `jump to the seat · ${m.eyes}`, s });
    }
    if (needle.length >= 2) {
      for (const [k, g] of Object.entries(GLOSS)) {
        const s = Math.max(score(needle, g.title), k.toLowerCase().includes(needle) ? 1 : 0);
        if (s) out.push({ kind: "gloss", id: k, label: g.title, hint: "definition", body: g.body, s: s - 1 });
      }
    }
    return out
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map(({ s: _s, ...rest }) => rest);
  }, [q]);

  useEffect(() => setCursor(0), [items.length, q]);

  const run = (it: Item) => {
    if (it.kind === "gloss") {
      setShown(shown === it.id ? null : it.id);
      return;
    }
    onOpenChange(false);
    if (it.kind === "tab") onTab(it.id);
    else if (it.kind === "seat") onJump(it.id);
    else if (it.kind === "action" && it.id === "tour") onTour();
    else if (it.kind === "page") window.location.assign(it.href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[8vh] z-50 mx-auto max-w-lg rounded-md border border-border bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Find anything on the desk</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <span aria-hidden="true" className="font-mono text-micro text-subtle">
              ⌘K
            </span>
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(items.length - 1, c + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const it = items[cursor];
                  if (it) run(it);
                }
              }}
              placeholder="Jump to a tab, a seat, a page, or look up a word…"
              aria-label="Search the desk"
              className="min-h-11 w-full bg-transparent font-mono text-ui text-fg placeholder:text-subtle focus:outline-none"
            />
          </div>
          <ul role="listbox" aria-label="Results" className="max-h-[60vh] overflow-auto py-1">
            {items.length === 0 ? <li className="px-3 py-2 font-mono text-micro text-subtle">Nothing by that name. Try a tab, a seat, or a word from the floor.</li> : null}
            {items.map((it, i) => {
              const key = it.kind === "page" ? it.href : `${it.kind}:${it.id}`;
              const active = i === cursor;
              return (
                <li key={key} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => run(it)}
                    className={cn("flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5 text-left", active ? "bg-surface-2" : "hover:bg-surface-2")}
                  >
                    <span className="font-mono text-ui text-fg">{it.label}</span>
                    <span className="truncate font-mono text-micro text-subtle">{it.hint}</span>
                  </button>
                  {it.kind === "gloss" && shown === it.id ? <div className="px-3 pb-2 font-sans text-ui leading-snug text-muted">{it.body}</div> : null}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border px-3 py-1.5 font-mono text-micro text-subtle">↑↓ move · Enter open · Esc close</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
