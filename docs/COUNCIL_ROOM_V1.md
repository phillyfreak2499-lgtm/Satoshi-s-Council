# Council Room V1 — Phase 1 source contract and narration

Assignment: CR-CLAUDE-001 + R2. Base: `main` @ `8e6d734906d5ffadcbaffef3c3e1e8ac00f6ea24`.
Scope: Phase 1 only. That covers source inventory, a read-only adapter, and text narration on `/chamber`.
The lightweight 2D room and the 3D room are not started. `SHOW_CINEMATIC_ROOM` stays `false`.

Paper only. The Chamber is downstream and read-only. Nothing in this change touches the Chair, the 80¢ floor, booking, the learner, the follower, production settings or any producer of events.

## 1. The one source

Every narrated line comes from one row of `desk_system_events` (migration `0030`). The row has `public = true` and is read through the existing bounded GET:

```
desk_system_events  (insert-once; unique event_key; no update/delete helper)
  └─ listPublicChamberEvents(5)        src/lib/desk/system-events-read.server.ts
       latest 5 per speaker for SATOSHI, WARDEN, ALCHEMIST, SWEEP; ≤ 20 rows; public = true only
  └─ listChamberSpeech  (createServerFn GET)   src/lib/desk/chamber-speech.ts
       statementFromEvent (src/lib/desk/chamber-reactions.ts) → ChamberStatement[]
       + attachBooksRosters (read-only roster receipts)
  └─ adaptStatement     (pure)                 src/lib/desk/council-room-narration.ts
  └─ feed merge/dedupe  (pure)                 src/lib/desk/council-room-feed.ts
  └─ ChamberRoom.tsx    (text only)
```

There is no new endpoint, no SSE, no new table and no new recording. SSE is not selected for Phase 1. The existing bounded GET is the transport.

### Columns available to the Chamber

| Column | Exposed to client | Notes |
|---|---|---|
| `event_key` | yes, as `event_id` | Stable, unique, insert-once. Used for dedupe and as the provenance id. |
| `event_type` | yes | Closed taxonomy (`SYSTEM_EVENT_TYPES`). |
| `character` | yes, as `speaker` | Closed roster (`SYSTEM_CHARACTERS`). |
| `occurred_at` | yes, as `recorded_at` | The producer's observation time (mostly `snap.as_of`). See §4 for what it is per kind. |
| `source_type` / `source_id` | yes | Shown under "Show evidence". |
| `payload` | allowlisted typed fields only | Stored prose (`payload.text`) is kept only as archival "stored wording". |
| `public` | filter only | Private rows never leave the server. |
| `id`, `created_at` | **no** | `created_at` (DB insert time) is not selected by the existing reader. See §7. |

No build or commit identity is recorded on these rows. `build` is always `null` and the UI says "not recorded on this source". None is invented.

## 2. Supported event kinds (recorded and narrated)

| event_type / speaker | Producer (unchanged) | Layer | Window-bound | Template keys |
|---|---|---|---|---|
| `CHAIR_DIRECTIONAL` / SATOSHI | `chamber-directional.ts` via `observeChairWaitMilestone` | **book** | yes | `book.paper_call_logged` |
| `CHAIR_WAIT_MILESTONE` / SATOSHI | `chamber-wait.ts` | **chair** | yes | `chair.wait.{feed_condition,hard_gate,under_bar,no_edge,agreement_withheld}` |
| `SYSTEM_HEALTH_ALERT` / `SYSTEM_HEALTH_RECOVERED` / WARDEN | `chamber-health.ts` | integrity | yes | `integrity.feed_alert`, `integrity.feed_recovered` |
| `EXPERIMENT_STARTED`, `EXPERIMENT_EVIDENCE_MILESTONE` / ALCHEMIST | `chamber-lab.ts` | **research** | no | `research.experiment_started`, `research.evidence_milestone` |
| `DESK_UPDATE` (`kind: sweep-seat-audit`) / SWEEP | `chamber-sweep.ts` (mirrors `desk_crew_log`) | conditions | no | `conditions.seat_flagged`, `conditions.seat_cleared` |

### Allowlisted fields per kind (the source-field map)

| Layer | Fields carried to narration (typed) | Source payload keys |
|---|---|---|
| book | `lean` (UP/DOWN), `entry_cents` (0–100 exclusive), `call_id` | `lean`, `entry_cents`, `call_id`, plus `ticker`, `close_time` |
| chair | `wait_reason`, `failed_gates`, `score`, `bar`, `quorum_{up,down,wait}` | `wait_reason`, `failed_hard`, `score`, `bar`, `quorum`, `roster`, plus `ticker`, `close_time` |
| integrity | `provider`, `feed`, `gap`, `receipt_age_s`, `last_change_age_s` | same keys, plus `ticker`, `close_time` |
| research | `candidate_id`, `candidate_label`, `sample_n`, `milestone`, `paper_only`, `authority` | same keys |
| conditions | `seat`, `action`, `reads`, `spoke`, `mid_n`, `grade_n` | same keys |

Every narration event also carries:
- `schema_version` (1) and `event_id` (= `event_key`)
- `source {table, event_key, source_type, source_id}`
- `recorded_at`, and `received_at`, which is always a real receipt time:
  - for rows that came with the page, the clock right after the route loader's bounded read (the server's clock during SSR, serialized with the rows, so hydration renders the same value);
  - for later rows, this client's clock right after its read.
  It is never presented as the recorded or event time. A row without a usable receipt time is refused (`missing-receipt-time`).
- `window {ticker, close_time, ticker_agrees: true}` and `seat` where present
- `template_key`, plus the stored wording as `archival_text`

## 3. Research vs Chair decision vs paper position

The three layers are kept separate on purpose. Each line shows its layer label.

- **Research** (ALCHEMIST) means a frozen shadow specimen reached a lifecycle or sample milestone. It has no authority.
- **Chair decision** (SATOSHI WAIT milestone) means the finalized Chair result was WAIT for a recorded reason.
- **Paper book** (SATOSHI `CHAIR_DIRECTIONAL`) is written only from a canonical Chair `CallLogRow`:
  - The row has `source == null`. Recovery-pilot rows are excluded by `chairOnlyCalls`.
  - `noteCall` appends that row only after the edge, team, selective, floor (`bookable`) and position guards pass.
  - An unbooked Chair lean never produces this event.
  - The adapter labels a row as a paper call only when it carries the book's canonical `call_id`. The id has the form `${close_time}-${lean}-${as_of}`, and its close and side must agree with the window and the lean. Without that, the row is refused (`book-identity`).
  - No position is inferred from `entry_cents` or the enum name.

**Known producer gap (not fixed, protected code):** `noteCall` adds the row to the in-memory `callLog` *before* `persistState`. If persistence fails, the row stays in memory and the next tick's observer can still record `CHAIR_DIRECTIONAL`. So the event proves "a canonical Chair call row was in the engine call log". It does **not** prove the durable ledger write. The template therefore says "logged a canonical Chair … call", not "filled". Checking against the durable ledger is outside the Chamber's read scope and is **UNVERIFIED**.

## 4. What each timestamp means (observation, not invention)

| Kind | `occurred_at` is | Insert-once key |
|---|---|---|
| book | `CallLogRow.t`, the tick when the book appended the call. Falls back to `snap.as_of`. | one per window |
| chair WAIT | `snap.as_of` of the first tick observed with that wait reason | one per (window, reason) |
| integrity | `snap.as_of` of the observed transition | one per (window, alert/recovered). A repeat in the same window is collapsed. |
| research | `observed_at` when the Chamber's Lab poll first saw the specimen. **Not** when a milestone was crossed. Milestones found in one poll share a timestamp. | one per (candidate, milestone) |
| conditions | `desk_crew_log.t` of the SWEEP flag/clear | one per crew-log slug |

## 5. Validation (refuse, never guess)

`adaptStatement` refuses a row when:

| Check | Refusal reason |
|---|---|
| `event_key` fails the Phase 1A key regex, `source_type` is unknown, or `source_id`/evidence is missing | `malformed-identity` |
| The (type, speaker, source_type, evidence kind) combination is unsupported | `unknown-record` |
| `occurred_at` does not parse | `invalid-recorded-time` |
| No real receipt time (missing, non-finite or ≤ 0) | `missing-receipt-time` |
| `occurred_at` is more than 120 s after the receipt time. This applies to page-load rows too, checked against the server receipt. | `future-recorded-time` |
| Window-bound row: no ticker, `close_time` off the 15-minute grid, or `source_id`/`event_key` disagreeing with the window | `window-identity` |
| Window-bound row: the canonical parser (`tickerCloseMs`) cannot read the ticker, so its identity cannot be verified (`tickerAgrees === null`). The desk trades one verified family, `KXBTC15M-YYMMMDDHHMM-MM`, and no valid family is known for which the parser intentionally returns null. | `window-identity` |
| Window-bound row: the ticker's own encoded close disagrees (`tickerAgrees === false`), or it was recorded outside `[close − 15 min − 90 s, close + 90 s]` | `rollover-mismatch` (the 2026-09-10 stale-ticker failure) |
| Book row without a matching canonical `call_id` | `book-identity` |
| Required typed fields are missing (wait reason, feed state, milestone, side/price) | `missing-fields` |

Refused rows are not narrated. The status panel counts them by reason ("Withheld from narration").

Narration templates are deterministic, neutral and third-person. They are built only from the allowlisted fields. They contain no quotations, motives, confidence or fills. The stored producer prose, which is partly first person (e.g. WARDEN's "I'm flagging…"), is kept verbatim only as "stored wording" under Show evidence.

## 6. Feed behaviour

- **One request at a time.** The next read is scheduled only after the previous one settles (`createPoller`), so reads cannot overlap or finish out of order. A result that arrives after unmount is dropped.
- **Cadence:** 12 s, only while the tab is visible and the browser is online. A hidden tab or offline browser schedules nothing. Coming back triggers one read.
- **Replay:** rows loaded with the server page, the first client read, and the first read after any gap (hidden, offline or failed read) are labelled **History** and never flash. A row seen first on a continuous follow-up read is **New** and flashes once. Reduced motion turns the flash off. After that it reads "Received live". An older row that arrives after newer ones is "Arrived late" and does not flash.
- **Dedupe and order:** rows are deduped by `event_id`, including ids already scrolled out (up to 500 remembered). Order is newest `recorded_at` first, then `event_id`. At most 60 rows are retained.
- **Status:** the panel distinguishes loading, connected, empty, stale (more than 36 s since the last success), error (the last read failed; earlier rows stay as history), disconnected (offline or 3+ failures) and paused (hidden). It shows the last successful receipt and the newest recorded event's age separately. A successful read that brings nothing new does not count as desk activity.
- **Accessibility:** one polite live region (`role="status"`, `aria-atomic`) holds only meaningful transitions: the phase label, the read error and the withheld-record counts. The read times and ages update every few seconds, so they render in a separate block outside the live region and are never announced. `scripts/council-room-a11y.test.mjs` renders the panel at different clock times and asserts the live region's content is identical.

### Current state snapshot (separate from events)

Before this change, `/chamber` called `useDesk()`. That **started the full client desk engine**: it polled `/frame` every ≥4 s, or ran a local *demo* desk if the viewer's saved source was demo. The roster's seat availability could therefore come from simulated state without any label.

This change removes it. The "Meet the Council" roster is shown only on the quiet floor. While it is visible, it reads the existing public GET `/frame` once per Chamber cycle. `parseRosterSnapshot` allowlists `as_of`, `snap.ticker`/`close_time` and per-seat `seat`/`selectable_live_cards`/`authority_ready_cards`/`authority_hold_reason`, and refuses demo tickers. The roster is labelled "Current state snapshot · not a recorded event". It is never diffed into events.

### Voice

`/chamber` is now text only. The `CouncilVoiceButton` "Hear" controls and the voice copy are removed from `ChamberRoom`. The global voice service, `/council-voice`, the Floor strip (`ChamberSpeech.tsx`), training and streamer pages are unchanged.

## 7. Unsupported kinds and gaps (omitted, not invented)

| Kind | Status |
|---|---|
| Per-seat lean transitions (seat X moved UP→WAIT) | **Not recorded** in any public event. Snapshot leans exist only as current state. Omitted. |
| Chair UP/DOWN decisions that did not book | Not recorded as events (by design). Omitted. |
| Settlement / win-loss of a paper call | Not in `desk_system_events`. Omitted. |
| `EXPERIMENT_REVIEW_READY`, `EXPERIMENT_REJECTED`, `EXPERIMENT_INCONCLUSIVE` | In the taxonomy, but no producer writes them. Refused as `unknown-record` if they ever appear. |
| COACH skill-status transitions (`DESK_UPDATE`/COACH) | Recorded with `public = false`. Never read. |
| WRENCH, DESK speakers | No public producer. Silent. |
| Cinematic `RoomStage` text | Disabled (`SHOW_CINEMATIC_ROOM = false`) and left untouched. It still reads the newest statement's stored text. Phase 2/3 must switch it to the narration `text` and layer before enabling it. |
| Build/commit provenance | Not recorded on the rows. Reported as unavailable. |
| DB insert time (`created_at`) | Exists, but the existing reader does not select it. Adding it to the same public query would give a persistence witness separate from observation time. **Proposed follow-up for lead decision.** Not done here, so the reader query and the exported type stay unchanged. |

## 8. Tests

- `src/lib/desk/council-room-narration.test.ts` covers provenance and template determinism, research/Chair/book separation, book identity, pilot exclusion, invalid/future dates, malformed identity, rollover/window mismatches, unverifiable (junk) tickers with self-consistent key/source/close, required real receipt time, future-skew refusal against the receipt, unknown kinds, and agreement-withheld.
- `src/lib/desk/council-room-feed.test.ts` covers server receipt time on page-load rows (including refusing future-dated and receipt-less rows), history vs fresh, duplicates, deterministic order and tie-break, late arrivals, gap replay, failure preservation, all phases, no-news reads, bounded retention, refused records, the no-overlap poller, hidden/offline pause, the post-stop drop, snapshot allowlisting and snapshot ≠ event.
- `scripts/council-room-rails.test.mjs` covers pure modules (no writer, DB, engine, network or voice), the text-only Chamber, no engine/`setInterval`/POST, "Recorded" (not "Live") headings, the stage staying disabled, the source staying the bounded public GET, decision producers having no reverse dependency, and the route loader supplying the page-load receipt time.
- `scripts/council-room-a11y.test.mjs` renders `FeedStatus` and checks that clocks stay outside the single polite live region and that phase, error, withheld, stale and disconnected transitions are announced.

**Fixtures are SYNTHETIC.** The build environment could not reach the public site (egress denied), so no real public rows were captured. `src/lib/desk/council-room.fixtures.ts` generates every fixture through the real producers, the real Phase 1A validator and the real `statementFromEvent`. Sanitized public captures can replace them when supplied.

Test-scope conflict (reported per R2): `scripts/council-voice-rails.test.mjs` asserted that `/chamber` carried voice copy and a `source="chamber"` Hear button. Those two assertions are inverted to assert their absence. The Floor-strip and server-side voice assertions are unchanged.

## 9. Phase 2 — lightweight live room (CR-CLAUDE-002)

Phase 2 adds a small 2D room to `/chamber`. It uses semantic HTML, CSS and inline SVG only, and sits above the Phase 1 text feed. The text feed stays the canonical record and evidence surface. Nothing in §1–§8 changes.

### 9.1 Inputs (no new reads)

| Input | Source | What the room may show |
|---|---|---|
| Recorded events | The Phase 1 feed (§6): the same serialized `listChamberSpeech` GET, adapter and dedupe | The latest recorded line per layer, and flashes |
| Current state | The existing public GET `/frame`, allowlisted by `parseRosterSnapshot` | Seat reads, Chair state, seat availability |

`parseRosterSnapshot` now also allowlists four things, each exactly as the server sends it:
- per-seat `lean` (`UP`/`DOWN`/`WAIT`, otherwise unknown)
- `chair.lean` (same values)
- the frame's `tick_age_s`
- `snap.ticker` / `snap.close_time`

Nothing else is read. Demo frames are still refused.

**Cadence change, stated plainly.**
- Phase 1 read `/frame` only while the quiet-floor roster was on screen.
- Phase 2 reads it once per Chamber cycle, inside the same serialized poller and right after the event read: at most one `/frame` GET every 12 s, only while the tab is visible and the browser is online.
- The event read cadence is unchanged.
- There is no new endpoint, SSE, WebSocket, engine start or `server-engine` import.

### 9.2 State vs event (never combined silently)

- **Seat lights are current state.** Each seat shows its snapshot read (UP / DOWN / WAIT) under the heading "Current state · seat reads".
  - Retired seats (ODDS, CHEAP, FADE) and pit-crew seats (WARDEN, ORBIT, WIRE) show their role and no vote mark.
  - A seat without a usable snapshot value shows "unknown". It never shows WAIT.
- **SATOSHI / Chair** has two separately labelled lines:
  - "Current state" from `chair.lean` in the snapshot.
  - "Last recorded" from the newest Chair-layer narration event (recorded time shown).
  - Neither line fills in for the other.
- **Paper book** shows only the newest recorded `book`-layer narration event: a canonical call id, as defined in §3. A position is never inferred from a seat read, a Chair lean or a price. With no such event in the retained feed, it says "none in retained recorded events · position unknown".
- **Integrity (WARDEN)** and **Lab (ALCHEMIST)** tiles show only their newest recorded event.
- **A snapshot change alone never creates narration, an event claim or a flash.** The room model takes the current snapshot and the feed. It keeps no previous snapshot, so it cannot compute a diff.

Visual vocabulary. Shape plus text, never colour alone:
- open circle = seat read (research, current state)
- diamond = Chair (SATOSHI)
- filled square = recorded paper call
- dashed outline = unknown or unavailable

### 9.3 Flashes

A tile or seat flashes only when a feed event has `arrival === "fresh"` (§6). That means the event was first delivered on a continuous follow-up read and was not recorded before rows already seen.

| Fresh event layer | Flash target |
|---|---|
| chair, book | the SATOSHI tile and the paper-book tile respectively |
| integrity | WARDEN tile |
| research | Lab tile |
| conditions | the named seat, if it is one of the 21 |

History, replay after a gap, late rows, duplicates and reconnect deliveries are never `fresh`, so they never flash. The flash lasts until the next delivery, when `fresh` becomes `live`.

Under `prefers-reduced-motion` or `html[data-motion="reduce"]`, the flash is a static outline with no animation. There is no idle or looping animation anywhere in the room.

### 9.4 Snapshot status

The room shows one explicit snapshot status:

| Status | When |
|---|---|
| loading | no snapshot read yet |
| current | last read succeeded within 36 s |
| stale | the latest read failed after an earlier success, or the last success was more than 36 s ago; values are dimmed and kept with their read time |
| unavailable | the read failed or the frame was refused, and there is no earlier success |
| disconnected | browser offline, or 3 or more consecutive snapshot failures |
| paused | tab hidden |

When the status is not current or stale, seats show unknown. Missing data is never shown as WAIT or quiet. The read time and the server's reported `tick_age_s` are shown as reported.

### 9.5 Accessibility

- Seats are non-interactive list items (`<ul>` with 21 `<li>`). There are no controls.
- The reading order is: room status, SATOSHI, paper book, integrity, lab, then seats.
- Every state has text. SVG marks are `aria-hidden`.
- One polite live region announces only snapshot-status changes. Ages and times sit outside it. The Phase 1 `FeedStatus` live region is unchanged.
- Focus-visible styles cover the room's single "Jump to recorded exchanges" link.
- The layout works at 390 px and 1280 px without horizontal overflow.

### 9.6 Out of scope

Phase 3 remains dormant: `SHOW_CINEMATIC_ROOM = false`, with no Three.js, canvas, WebGL, models, audio, voice or new assets.
