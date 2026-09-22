-- 17. co_speak_identical_ticks: seat pairs raw-directional on the SAME 2 s tick (desk_seat_reads, from 2026-09-21T17:06Z only).
-- phi is computed offline from uu/ud/du/dd (src/lib/desk/vote-correlation.ts). Zero rows means no two seats co-spoke.
with d as (select as_of, seat, raw_lean, final_lean from desk_seat_reads where as_of >= :from and as_of < :to and raw_lean in ('UP', 'DOWN'))
select a.seat as seat_a, b.seat as seat_b, count(*) as n_both_directional,
  count(*) filter (where a.raw_lean = 'UP' and b.raw_lean = 'UP') as uu, count(*) filter (where a.raw_lean = 'UP' and b.raw_lean = 'DOWN') as ud,
  count(*) filter (where a.raw_lean = 'DOWN' and b.raw_lean = 'UP') as du, count(*) filter (where a.raw_lean = 'DOWN' and b.raw_lean = 'DOWN') as dd,
  count(*) filter (where a.raw_lean = b.raw_lean and a.final_lean in ('UP', 'DOWN') and b.final_lean in ('UP', 'DOWN')) as both_heard_same_side
from d a join d b on a.as_of = b.as_of and a.seat < b.seat group by 1, 2 order by 3 desc;
