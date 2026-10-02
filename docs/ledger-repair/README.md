# Ledger repair proposal — October 1, 2026

Status: code preparation only. No production writes, classifications, historical
recovery, merge, deployment, settings changes, or spending have been executed.

## Evidence and exact scope

The manifest contains 24 proposed `NO_CONTRACT / VENUE_PAUSE` records: the eight
quarter-hour closes from 07:15 through 09:00 UTC on September 17, September 24,
and October 1. Chicago closes are 02:15 through 04:00 on each date. Public Kalshi
market inventories are exhausted (`cursor` empty) and list the 07:00 and 09:15
contracts, but none of the eight intermediate contracts. Its official maintenance
documentation describes Thursday's 03:00–05:00 Eastern pause. Retained identity
faults name the stale 03:00 Eastern ticker against each advanced close.

All evidence files are captured source responses, with SHA-256 byte hashes in
`venue-pause-manifest.json`. SQL exports identify their database and exact query.
No chamber text is evidence. The executable registration pins the exact manifest,
intervals and records; it cannot classify a future Thursday or expand its scope.

On October 1 each missing interval has 75 chair evaluations and 1,575 seat rows;
the recorded chairs all WAIT with `hard:leftover`. Those are sampled observations
of the expired market, not valid grading records for new contracts. Contract
ticker, official winner/value, final grading snapshot, and final grading votes
remain explicitly null. No synthetic WAIT ledger rows, winners, fills, fees,
votes or research credit are created.

The other four raw gaps remain unresolved:

| UTC close | Chicago close | Retained evidence | Limit |
|---|---|---|---|
| Sep 9 16:45 | Sep 9 11:45 | Mid-window sample; official UP | Final grading record missing; exact loss trigger unproven |
| Sep 13 22:00 | Sep 13 17:00 | Opening snapshot/sample; official DOWN | Final grading record missing; exact loss trigger unproven |
| Sep 14 06:30 | Sep 14 01:30 | Opening snapshot/sample; official DOWN | Final grading record missing; exact loss trigger unproven |
| Sep 14 12:45 | Sep 14 07:45 | Opening/directional snapshots, saved DOWN at 85 cents, stored 1-cent fee; official DOWN | Paper outcome +14 cents recoverable; final grading record missing |

September 14 recovery is **outside this PR**. Its saved call/risk records still
have null settlement. `docs/LEDGER_WINDOW_2026-09-14.md` documents the deployment
crossing close and the prevention subsequently shipped in PR #205. Recovering its
supported economic fields requires a separate proposal and explicit write
approval. Earlier observations cannot stand in for the final chair or votes.

## Recorder prevention

`bundleToSnapshot` retains a market's observed ticker and close as one pair after
expiry. A wall clock cannot advance a stale ticker into a new contract. With no
observed identity, ticker is empty and close is zero (explicitly unknown).
Settlement continues matching the official ticker and close using existing
identity rules. On a retained expired contract, it uses the frozen pre-close
decision, never post-result votes. Without that evidence it records the loss and
does not grade or teach. Existing durable outbox, active-window recovery and
duplicate-grade protections are retained.

## Owner-controlled classification execution

There is no automatic migration, boot seed, route, cron or environment activation.
The manual schema is under `docs/sql/manual/`, outside migration discovery. The
default command is an offline hash-checked preview and never opens a database:

```sh
node --experimental-strip-types scripts/classify-venue-pause.ts --dry-run
```

An owner-approved operation must supply `--apply`, `--owner-approval-id` identifying
the specific execution approval, and `--manifest-sha256` equal to the reviewed
manifest hash. `DATABASE_URL` comes from secure process storage; the command never
loads keys from repo files and never logs credentials. It verifies the exact
database name, stops if any interval now has a ledger row, and appends the full
source-hashed records in one transaction with equality read-back. Failed storage
or conflicts roll back the entire operation. UPDATE/DELETE are forbidden by an
append-only trigger. Identical retries are idempotent.

Classification alone appends `integrity_effect=NONE`. It changes no missing-window
count or DEAD verdict. To affect integrity counting, a separately reviewed
execution must additionally supply `--apply-integrity-effect`; this appends an
`EXCLUDE_FROM_MISSING_CONTRACT_COUNT` record rather than updating an old record.
That flag is not approval: the owner must explicitly approve the operation and
its integrity effect first. Do not run either write mode under code-only approval.

After approved execution, the engine's read-only lookup accepts only exact pinned
records with the explicit integrity effect and owner approval reference. Missing
table, no approval, different hashes, changed/null fields, or expanded scope cannot
exclude a gap. Classification read failure keeps raw holes blocking. No record is
inserted into the canonical ledger or fed to any learner/research experiment.

`/status` retains the raw reconciliation `holes` and `missing_recent`, and adds
`classified` and `unresolved`; recent raw/classified counts are also shown.
The existing reconciliation baseline and six-hour health lookback are unchanged.
Expiry of that lookback is not repair; the 90-day unresolved count remains visible.
Future maintenance intervals stay unclassified until independently evidenced and
owner-approved. No existing experiment endpoint, duration or denominator changes.

## Validation and release

Behavioral tests exercise the actual bundle converter, engine settlement and gap
scan, manual writer against in-memory PostgreSQL, and classification reader.
They cover all eight maintenance rollovers, new-contract recovery, unknown feeds,
pre-close freezing, missing evidence, duplicate grading, inactive classifications,
altered evidence, scope expansion, read failure, transactional rollback, idempotent
retry, immutable records, explicit null fields and wrong-database refusal.

Run the full repository tests, typecheck, lint, build and server smoke before
review. CI must pass on the draft PR's exact head. Merge and deployment each need
explicit owner approval. Main auto-deploy coupling must be handled before merge;
neither approval is inferred from code preparation.
