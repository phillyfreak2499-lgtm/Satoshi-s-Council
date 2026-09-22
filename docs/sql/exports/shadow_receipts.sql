-- 14. shadow_receipts: every shadow-lab receipt with its manifest status. Empty until an owner sets SHADOW_LAB_ENABLED=true.
-- A CANDIDATE_NOT_COLLECTING manifest (MIRROR_35_V1) has no receipts by construction.
select r.experiment, m.status as manifest_status, m.prospective_start_at, r.arm, r.ticker, r.close_time, r.kind, r.decided_at, r.side, r.ask_cents, r.fee_engine, r.fee_cents,
  r.size_at_ask, r.spread_cents, r.feeds_ok, r.hittable_150ms, r.hittable_500ms, r.official_winner, r.net_cents, r.note, r.payload, r.build_sha
from desk_shadow_receipts r left join desk_shadow_manifests m on m.experiment = r.experiment
where r.close_time >= :from and r.close_time < :to order by r.close_time, r.experiment, r.arm;
