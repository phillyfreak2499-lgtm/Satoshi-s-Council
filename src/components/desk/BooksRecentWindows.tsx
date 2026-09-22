import { useState } from "react";
import type { BooksWindow } from "@/lib/desk/books";
import { collapseWindowLog, datedClose, sitRunLabel } from "@/lib/desk/books-window-log";
import { fmtCents } from "@/lib/desk/record";
import { LeanChip } from "./bits";

function ReplayLink({ w }: { w: BooksWindow }) {
  if (!w.ticker) return <span className="text-subtle">—</span>;
  return (
    <a
      href={`/window/${encodeURIComponent(w.ticker)}`}
      className="font-mono text-micro text-fg underline underline-offset-2 hover:text-muted"
    >
      replay
    </a>
  );
}

function FillRow({ w, tz }: { w: BooksWindow; tz: string }) {
  const net = w.call?.ev == null ? "—" : fmtCents(w.call.ev);
  return (
    <tr className="border-t border-border">
      <td role="cell" data-label="Close" className="py-2 pr-3 font-mono text-micro text-fg">
        {datedClose(w.close_time, tz)}
      </td>
      <td role="cell" data-label="Side" className="py-2 pr-3">
        {w.call?.lean ? <LeanChip lean={w.call.lean} /> : "—"}
      </td>
      <td role="cell" data-label="Result" className="py-2 pr-3">
        <LeanChip lean={w.winner} />
      </td>
      <td role="cell" data-label="Net" className="py-2 pr-3 font-mono text-micro tabular">
        {net}
      </td>
      <td role="cell" data-label="Replay" className="py-2">
        <ReplayLink w={w} />
      </td>
    </tr>
  );
}

function SitRunRow({
  count,
  from,
  to,
  windows,
  tz,
}: {
  count: number;
  from: string;
  to: string;
  windows: BooksWindow[];
  tz: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <tr className="border-t border-border bg-surface-2/40">
      <td role="cell" data-label="Close" colSpan={5} className="py-2">
        <button
          type="button"
          className="min-h-11 w-full text-left font-mono text-micro text-muted hover:text-fg"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {sitRunLabel({ kind: "sit-run", count, from, to, windows })} · {datedClose(from, tz)}
          {count > 1 ? ` – ${datedClose(to, tz)}` : ""} · {open ? "collapse" : "expand"}
        </button>
        {open ? (
          <ul className="mt-1 max-h-48 overflow-y-auto pl-3">
            {windows.map((w) => (
              <li key={w.ticker || w.close_time} className="py-1 font-mono text-micro text-subtle">
                {datedClose(w.close_time, tz)} · sat · settled {w.winner}
                {w.ticker ? (
                  <>
                    {" · "}
                    <a className="underline underline-offset-2" href={`/window/${encodeURIComponent(w.ticker)}`}>
                      window
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </td>
    </tr>
  );
}

/** Summary-first recent windows: fills stay visible, sit streaks collapse. */
export function BooksRecentWindows({
  windows,
  missing,
  tz = "America/Chicago",
}: {
  windows: BooksWindow[];
  missing?: string[];
  tz?: string;
}) {
  const rows = collapseWindowLog(windows);
  const fills = rows.filter((r) => r.kind === "fill").length;
  return (
    <section aria-label="Recent windows summary" className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-micro uppercase tracking-widest text-subtle">Recent windows</h2>
        <p className="font-mono text-micro text-subtle">
          {fills} filled · sit runs collapsed
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="books-window-table w-full min-w-[520px] border-collapse text-left">
          <caption className="sr-only">
            Filled paper windows stay open with a replay link. Consecutive sits collapse into one row.
          </caption>
          <thead>
            <tr className="font-mono text-micro uppercase tracking-widest text-subtle">
              <th scope="col" className="pb-2 pr-3 font-normal">
                Close
              </th>
              <th scope="col" className="pb-2 pr-3 font-normal">
                Side
              </th>
              <th scope="col" className="pb-2 pr-3 font-normal">
                Result
              </th>
              <th scope="col" className="pb-2 pr-3 font-normal">
                Net after fee
              </th>
              <th scope="col" className="pb-2 font-normal">
                Replay
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) =>
              row.kind === "fill" ? (
                <FillRow key={row.window.ticker || row.window.close_time} w={row.window} tz={tz} />
              ) : (
                <SitRunRow
                  key={`sit-${row.from}-${row.to}-${i}`}
                  count={row.count}
                  from={row.from}
                  to={row.to}
                  windows={row.windows}
                  tz={tz}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
      {missing && missing.length > 0 ? (
        <details className="mt-3 font-mono text-micro text-subtle">
          <summary className="min-h-11 cursor-pointer py-2">
            Show missing closes · {missing.length} dated outages
          </summary>
          <ul>
            {missing.slice(-100).reverse().map((close) => (
              <li key={close} className="py-1">
                <time dateTime={close}>{datedClose(close, tz)}</time>
                {" · no recorded result"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
