-- Spot and perp signed trade flow: instrument first, no decision use.
--
-- desk_research_flow_minutes: one insert-once row per (venue, minute), written
-- only after the minute is sealed (a gap-checked poll landed after its end).
-- Venues are kept separate: COINBASE_SPOT (BTC-USD) and OKX_PERP
-- (BTC-USDT-SWAP). Buy and sell are the AGGRESSOR's side under the frozen
-- definition FLOW_DEF_V1 (trade-flow.ts); sizes are in BTC, notional in quote
-- currency. `complete` is true only when no data-quality flag applies (a
-- continuity gap, clock skew, out-of-order trades). A gap is recorded, never
-- filled in.
--
-- desk_research_flow_marks: the engine's KXBTC15M quote at the fixed clocks
-- (T-600, 300, 180, 60), the same-time price control for the flow test.
--
-- Nothing reads either table into a decision.
--
-- Rollback: drop table desk_research_flow_minutes; drop table desk_research_flow_marks.
create table if not exists desk_research_flow_minutes (
  venue          text not null,
  minute         timestamptz not null,
  def_version    integer not null,
  complete       boolean not null,
  flags          text[] not null default '{}',
  n_buy          integer not null,
  n_sell         integer not null,
  buy_base       double precision not null,
  sell_base      double precision not null,
  buy_quote      double precision not null,
  sell_quote     double precision not null,
  open_px        double precision,
  close_px       double precision,
  high_px        double precision,
  low_px         double precision,
  max_trade_base double precision,
  first_trade_id text,
  last_trade_id  text,
  build_sha      text not null default '',
  recorded_at    timestamptz not null default now(),
  primary key (venue, minute),
  check (venue in ('COINBASE_SPOT', 'OKX_PERP')),
  check (extract(second from minute) = 0),
  check (n_buy >= 0 and n_sell >= 0 and buy_base >= 0 and sell_base >= 0)
);
create index if not exists desk_research_flow_minutes_minute_idx
  on desk_research_flow_minutes (minute desc);

create table if not exists desk_research_flow_marks (
  ticker       text not null,
  close_time   timestamptz not null,
  clock_secs   integer not null,
  as_of        timestamptz not null,
  quote_age_ms integer,
  yes_bid      double precision,
  yes_ask      double precision,
  no_bid       double precision,
  no_ask       double precision,
  yes_mid      double precision,
  build_sha    text not null default '',
  recorded_at  timestamptz not null default now(),
  primary key (ticker, close_time, clock_secs),
  check (clock_secs in (600, 300, 180, 60)),
  check (as_of < close_time)
);
create index if not exists desk_research_flow_marks_close_idx
  on desk_research_flow_marks (close_time desc);
