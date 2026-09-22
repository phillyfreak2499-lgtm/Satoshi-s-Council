# Shadow experiments — 2026-09-22

Registry of frozen hypotheses in the shared shadow lab (`src/lib/desk/shadow-manifests.ts`,
JSON twins in `docs/experiments/`). Cap: **3 active** (`SHADOW_MAX_ACTIVE`),
counted over SHADOW and PAUSED manifests. Nothing collects until an owner sets
`SHADOW_LAB_ENABLED=true` **and** moves a manifest to SHADOW with a real
`prospective_start_at`. Neither has been done.

| id | fingerprint | status | counts against cap | arms | primary contrast |
|---|---|---|---|---|---|
| UNMUTE_DEDUP_SHELF_V1 | `…|612f23b9|8arms` | CANDIDATE | no (not active) | NULL_FAV_80/85/88, PKG_80/85/88, PKG_85_OWNER3 | PKG_85 vs NULL_FAV_85 |
| WARDEN_JUMP_VETO_V1 | `…|ae4a57cc|5arms` | CANDIDATE | no | BASE_NO_VETO, VETO_8S/15S/30S | VETO_8S vs BASE |
| SETTLE_BASIS_MEASURED_V1 | `…|e1c9d3b1|4arms` | CANDIDATE | no | BASIS_LIVE_2BPS, BASIS_5/7/9BPS | BASIS_7 vs LIVE |
| **MIRROR_35_V1** | `MIRROR_35_V1|v1|15d0f9d4|3arms` | **CANDIDATE_NOT_COLLECTING** | **never** | MIRROR_35, NO_TRADE (control), MIRROR_35_EXEC | MIRROR_35 vs NO_TRADE |

Migration `0058` adds `CANDIDATE_NOT_COLLECTING` to the manifest status check.

SELECTOR ATTRIBUTION v1 (`docs/SELECTOR_ATTRIBUTION_V1_2026-09-22.md`) is not
a fourth experiment and holds no slot: it is a recorder that rides the same
observer tick, starts with the same boundary, and writes its own table.
`capRespected()` and `activeShadowCount()` are pinned by `mirror35.test.ts`.

## MIRROR-35 (registered, not collecting)

Rule as relayed by the external audit: buy the side quoted **30–45¢** on the
first touch inside **T−5:00 .. T−2:00**, one contract, HOLD. Reproduced on
`desk_replay` (MARKET_BASELINE, split 2026-09-14T12:00Z):

| split | fills | avg ask | WR | needed | net | per fill | max DD | next-tick net | slip |
|---|---|---|---|---|---|---|---|---|---|
| TRAIN | 293 | 36.39 | 40.3% | 38.39% | +553 | **+1.89** | −1,066 | +561 | −0.02¢ |
| TEST | 299 | 36.06 | 37.5% | 38.06% | −180 | **−0.60** | −1,005 | −246 | +0.22¢ |
| ALL | 592 | 36.22 | 38.9% | 38.22% | +373 | +0.63 | −1,066 | +315 | +0.10¢ |

**Honesty tax**: the external search covered ~60 price × time cells
(`MIRROR35.discovery_cells_searched = 60`). The train figure reproduces to the
cent and the sign flips out of sample. Any positive here is discovery-biased.
The quote never disappeared at the next 4 s tick (0 of 592), but hittability at
sub-second latency is UNKNOWN at a 2 s poll.

Fields the collecting arm would record per intention (`mirror35Intention`,
`src/lib/desk/shadow-arms.ts`): signal timestamp, side, signal ask, bid, size
at ask, hypothetical executable ask (null when no resting size), spread,
feeds-ok, seconds left, first-touch flag; the observer would add next-tick and
+1/+2/+5/+60 s asks, settlement, fee, net, slippage and quote-disappearance
from the receipt stream. It is **not wired** into the observer: rail 3 asserts
`shadow-lab.server.ts` never references it and that it reaches no production
writer.

## Activation state

| switch | value now | who flips it |
|---|---|---|
| `healthz` import of `ensureShadowLabObserver` | present (this branch) | — |
| `SHADOW_LAB_ENABLED` | **unset** (observer returns "disabled") | owner, in the Render environment |
| manifest status → SHADOW with `prospective_start_at = now()` | none | owner, by SQL at the actual instant |
| MIRROR_35_V1 | CANDIDATE_NOT_COLLECTING; would need a free slot and a new manifest version to change | owner |

Rails: a failing database or frame inside `shadowLabTick` is absorbed into the
observer's health record and the frame object is byte-identical afterwards
(`scripts/audit-reconcile-rails.test.mjs` rails 1/1b/1c); the observer writes
only its two tables (`scripts/shadow-lab-rails.test.mjs`).

## Promotion gates (unchanged, AND-ed)

≥ 250 prospective qualified fills per promoted arm, ≥ 30 calendar days,
≥ 25 paired control-loss windows, positive absolute after-fee net, supported
incremental net vs the current Chair + HOLD on the same universe, the
registered benchmark, drawdown/tail gates. Insufficient is not a pass. MIRROR-35
cannot reach any gate while it holds no slot; that is intended.
