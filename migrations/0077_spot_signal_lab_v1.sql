-- Independent paper research; schema, constraints and one active version only.
create table if not exists spot_prices_1m (
  ts timestamptz primary key check (ts = date_trunc('minute', ts)),
  price numeric not null check (price > 0 and price < 'Infinity'::numeric),
  source text not null
);
create table if not exists paper_spot_trades (
  id bigint generated always as identity primary key,
  signal_version text not null,
  side text not null check (side in ('long', 'short')),
  entry_ts timestamptz not null,
  entry_price numeric not null check (entry_price > 0 and entry_price < 'Infinity'::numeric),
  exit_ts timestamptz,
  exit_price numeric check (exit_price > 0 and exit_price < 'Infinity'::numeric),
  exit_reason text check (exit_reason in ('opposite', 'max_hold', 'stale', 'killed_flatten')),
  gross numeric check (abs(gross) < 'Infinity'::numeric),
  pnl_paper numeric check (abs(pnl_paper) < 'Infinity'::numeric),
  status text not null check (status in ('open', 'closed')),
  unique (signal_version, entry_ts),
  check ((status = 'open' and exit_ts is null and exit_price is null and exit_reason is null and gross is null and pnl_paper is null)
    or (status = 'closed' and exit_ts is not null and exit_ts >= entry_ts and exit_price is not null and exit_reason is not null and gross is not null and pnl_paper is not null))
);
create unique index if not exists paper_spot_one_open on paper_spot_trades(signal_version) where status = 'open';
create table if not exists spot_signal_versions (
  signal_version text primary key,
  status text not null check (status in ('active', 'killed')),
  killed_at timestamptz,
  kill_reason text,
  n_closed integer not null default 0 check (n_closed >= 0),
  pnl_paper numeric not null default 0,
  bh_pnl numeric,
  check ((status = 'active' and killed_at is null and kill_reason is null)
    or (status = 'killed' and killed_at is not null and kill_reason is not null))
);
insert into spot_signal_versions(signal_version, status) values ('spot-signal-v1', 'active') on conflict do nothing;

-- Serialize a whole paper event and its checkpoint receipt in one transaction.
create or replace function spot_apply_tick(
  expected_id bigint, expected_state text, decision_ts timestamptz, tick_ts timestamptz,
  action text, paper_side text, mark_price numeric, reason text, return_gross numeric, return_net numeric,
  closed_count integer, net_sum numeric, baseline numeric, should_kill boolean, checkpoint_reason text
) returns boolean language plpgsql as $$
declare
  version_row spot_signal_versions%rowtype;
  latest_row paper_spot_trades%rowtype;
  actual_count integer;
begin
  select * into version_row from spot_signal_versions where signal_version = 'spot-signal-v1' for update;
  if not found then raise exception 'missing paper version'; end if;
  select * into latest_row from paper_spot_trades where signal_version = 'spot-signal-v1' order by id desc limit 1;
  if latest_row.id is distinct from expected_id or latest_row.status is distinct from expected_state then return false; end if;
  if decision_ts <> date_trunc('minute', decision_ts) or tick_ts < decision_ts then raise exception 'invalid paper clock'; end if;
  if action = 'enter' then
    if version_row.status <> 'active' or paper_side not in ('long', 'short') then return false; end if;
    if exists (select 1 from paper_spot_trades where signal_version = 'spot-signal-v1' and
      (status = 'open' or entry_ts >= decision_ts or exit_ts >= decision_ts)) then return false; end if;
    insert into paper_spot_trades(signal_version, side, entry_ts, entry_price, status)
      values ('spot-signal-v1', paper_side, decision_ts, mark_price, 'open');
  elsif action = 'exit' then
    if latest_row.status is distinct from 'open' then return false; end if;
    if version_row.status = 'killed' and reason is distinct from 'killed_flatten' then return false; end if;
    update paper_spot_trades set exit_ts = decision_ts, exit_price = mark_price, exit_reason = reason,
      gross = return_gross, pnl_paper = return_net, status = 'closed' where id = latest_row.id and status = 'open';
  elsif action <> 'hold' then raise exception 'invalid paper action';
  end if;
  select count(*) into actual_count from paper_spot_trades where signal_version = 'spot-signal-v1' and status = 'closed';
  if actual_count <> closed_count then raise exception 'paper count mismatch'; end if;
  if version_row.status = 'active' then
    if should_kill and (closed_count < 50 or version_row.n_closed >= 50 or checkpoint_reason is null or baseline is null) then raise exception 'invalid kill checkpoint'; end if;
    if closed_count >= 50 and version_row.n_closed < 50 and baseline is null then raise exception 'missing kill checkpoint'; end if;
    update spot_signal_versions set n_closed = closed_count, pnl_paper = net_sum,
      bh_pnl = coalesce(baseline, bh_pnl),
      status = case when should_kill then 'killed' else 'active' end,
      killed_at = case when should_kill then tick_ts else null end,
      kill_reason = case when should_kill then checkpoint_reason else null end
      where signal_version = 'spot-signal-v1';
  end if;
  return true;
end $$;
