# Metric contract — the one economic book (ECONOMICS_BOOK_V1)

Every public number about the paper book is defined here once. A surface that
prints a number this contract does not define is printing an opinion.

## Units and identity

- Cents per one contract. Fees from the versioned fee engine only
  (`fee-engine.ts`); every row carries the engine fingerprint.
- **Net cents** = 100 · I(booked side won officially) − ask cents − fee cents.
  Holds exactly for one-contract HOLD rows (`settle_cents ∈ {0, 100}` and
  `|ev − identity| ≤ 0.05`). Rows it cannot describe are `booked_legacy_exit`
  or `scratch` and are reported apart, never netted with HOLD.
- **Win rate** = official settlement wins / settled HOLD fills. A positive-net
  position is not a win.
- **Needed win rate** = Σ(ask + fee) / (100 · settled HOLD fills).
- **Realized net**, **pending full-loss exposure** (ask + fee of every fill
  without an official result at as-of), **scratches/voids** and **missing
  outcomes** are four separate fields.

## Populations (never pooled without saying so)

| Dimension | Values |
|---|---|
| Ledger | `main_paper`, `shadow_70`, `arena`, `research` |
| Era | `A0_pre_floor` (< 2026-09-08 20:47Z, legacy mixed exits), `A1_floor70`, `B_floor80_trial` (2026-09-10 23:00Z – 2026-09-15 14:05:13Z), `C1_selective_v1v2`, `C2_selective_v3` (≥ 2026-09-17 12:09:31Z) |
| Event | `no_decision`, `chair_read_no_book`, `booked_pending`, `booked_settled`, `booked_legacy_exit`, `scratch`, `excluded` |
| Exit / quantity | `one_contract_hold` (A1 onward) vs `legacy_mixed` (A0) |

## Scopes

A scope is `{ledger, start_ms inclusive, end_ms exclusive, axis=close_time, tz, as_of_ms}`.
Settlements graded after `as_of` are pending in that scope.

| Surface | Scope | Note |
|---|---|---|
| /books "week", /record | rolling 168 h: `close_time > as_of − 7d AND close_time ≤ as_of` | rolls every window; four readings of it in one week were 49/+159, 42/+76, 38/+8, 15/−165 |
| /books "today" | the Chicago calendar day of as_of | DST-safe boundaries |
| /books "floor" | `close_time ≥ 2026-09-08 20:47Z` | since the 70¢ floor, NOT since the 80¢ floor |
| /books "all" | everything ≤ as_of | pools A0 legacy rows; the contract reports them apart |
| Board recap | Chicago days yesterday − 6 .. yesterday | different rows from the rolling week by design |
| Completed week | Monday–Sunday Chicago, ending before as_of's day | for weekly net |

## Published statistics (per scope)

n scheduled/captured/graded windows, n decisions, n qualified fills, official
WR, needed WR, net, net/fill, net/100 windows, no-book rate, entry-time WAIT
rate (UNKNOWN from the ledger; from decision receipts only), max drawdown on
cumulative settled-HOLD net **ordered by (close_time, id)**, worst Chicago
week, CVaR 5% (**unit: cents per settled one-contract fill; descriptive below
20 fills**), time-to-recover in hours from the drawdown peak (**censored** when
not regained), identity mismatches.

## What is not a fill

A receipt, a raw vote, a shock, a veto, a late directional hit, an intention,
a mid-price mark, a reconstructed quote. A shadow fill is a fill in the shadow
ledger only.

## Promotion gates (frozen, AND-ed)

≥ 250 prospective qualified fills per promoted arm AND ≥ 30 calendar days AND
≥ 25 paired control-loss windows AND positive absolute after-fee net AND
supported incremental net vs the current Chair + HOLD on the same universe AND
the registered primary benchmark AND drawdown/tail gates. Insufficient is not
a pass. One futility look at 150 qualified fills may bench, never promote.
