import { recordSystemEvent } from "./system-events.server";
import { sweepCrewEvent, type SweepCrewLogRow } from "./chamber-sweep";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/**
 * Mirror only fresh, already-persisted SWEEP flag/clear transitions into the
 * Chamber event stream. The 15-minute lookback catches boot/digest ordering;
 * event_key uniqueness makes repeated observations harmless.
 */
export async function observeSweepCrewEvents(): Promise<number> {
  const db = await sql();
  const rows = await db<SweepCrewLogRow>`
    select t::text as t, seat, action, detail, slug, evidence
      from desk_crew_log
     where who = 'SWEEP'
       and action in ('flag', 'clear')
       and t > now() - interval '15 minutes'
     order by t asc
     limit 40
  `;
  let inserted = 0;
  for (const row of rows) {
    const ev = sweepCrewEvent(row);
    if (!ev) continue;
    const result = await recordSystemEvent(ev);
    if (result.inserted) inserted += 1;
  }
  return inserted;
}
