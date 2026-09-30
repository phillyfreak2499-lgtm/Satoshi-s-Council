-- Bounded, read-only visibility of the six E1 cards' already-published papers.
-- PAPER_EVALUATED is an unscaled producer output, not eligible support, a
-- simulated fill, or P1/P2-clean evidence. Qualification remains UNKNOWN.
-- Missing selected outputs, malformed receipts and absent sources stay visible.
-- A nonpartial flag and one build do not prove exhaustive frame coverage.
with bounded as materialized (
  select * from desk_research_decision_tape
   where close_time >= now() - interval '24 hours' and close_time <= now()
), coverage as (
  select ticker, close_time, count(*) tape_rows,
         count(distinct build_sha) builds, bool_or(partial_window) partial,
         count(distinct checkpoint_secs) checkpoints
    from bounded group by ticker, close_time
)
select t.ticker, t.close_time, t.as_of, t.secs_left, t.checkpoint_secs,
       t.build_sha, c.builds, c.partial, c.checkpoints, c.tape_rows,
       c.tape_rows >= 80 as event_cap_reached,
       t.record->'e1_paper'->>'source' paper_source,
       t.record->'e1_paper'->>'authority' authority,
       t.record->'e1_paper'->>'qualification' qualification,
       p->>'kind' observation_kind, p->>'card_id' card_id,
       p->>'seat' seat, p->>'status' card_status,
       p->>'lean' paper_lean, p->'conf' paper_strength,
       t.record->'e1_paper'->'missing' unavailable_outputs,
       t.record->'market' same_frame_market,
       t.label production_label, t.stage production_stage,
       t.record->'values' production_values,
       l.winner official_winner, l.source settlement_source
  from bounded t
  join coverage c using (ticker, close_time)
  left join lateral jsonb_array_elements(t.record->'e1_paper'->'outputs') p on true
  left join desk_ledger_research l using (ticker, close_time)
 where t.checkpoint_secs is not null and t.record ? 'e1_paper'
 order by t.close_time desc, t.as_of, p->>'card_id'
 limit 4032;
