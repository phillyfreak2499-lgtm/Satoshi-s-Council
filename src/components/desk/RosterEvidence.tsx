import type { ChamberStatement } from "@/lib/desk/chamber-reactions";

/** Shared by both read-only Chamber surfaces. */
export function RosterEvidence({ statement }: { statement: ChamberStatement }) {
  const e = statement.evidence;
  if (e.kind !== "chair-wait") return null;
  return <>
    <div className="sm:col-span-2"><dt className="inline text-muted">observation roster check </dt><dd className="inline">{e.roster_check?.status ?? "MISSING"} · {e.roster_check?.note ?? "Saved roster unavailable."}</dd></div>
    <div className="sm:col-span-2"><dt className="inline text-muted">observation seats </dt><dd className="inline">{e.roster ? e.roster.members.map((m) => `${m.seat} ${m.lean}`).join(" · ") || "none" : "MISSING"}</dd></div>
    <div><dt className="inline text-muted">roster observation time </dt><dd className="inline">{e.roster?.snapshot_at ? new Date(e.roster.snapshot_at).toISOString() : "MISSING"}</dd></div>
    <div className="sm:col-span-2"><dt className="inline text-muted">Chamber-to-Books </dt><dd className="inline">{e.books_check?.status ?? "MISSING"} · {e.books_check?.note ?? "Comparison unavailable."}</dd></div>
    {e.books_seats ? <div className="sm:col-span-2"><dt className="inline text-muted">Books at grade </dt><dd className="inline">{e.books_seats.right}/{e.books_seats.n} speaking seats right. This measures correctness at grade, not agreement at entry.</dd></div> : null}
    {e.books_roster ? <>
      <div className="sm:col-span-2"><dt className="inline text-muted">Books speaking seats </dt><dd className="inline">{e.books_roster.members.map((m) => `${m.seat} ${m.lean}`).join(" · ") || "none"}</dd></div>
      <div className="sm:col-span-2"><dt className="inline text-muted">Books input snapshot time </dt><dd className="inline">MISSING — the ledger records the window close, not this observation clock.</dd></div>
    </> : null}
    {statement.original_text ? <div className="sm:col-span-2"><dt className="text-muted">Original dispatch · superseded wording, retained for audit</dt><dd>{statement.original_text}</dd></div> : null}
  </>;
}
