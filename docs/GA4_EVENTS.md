# GA4 custom events (thin instrumentation)

Measurement ID on site: `G-JMQGD1WTVT`. No GTM. No new vendor.

The standard loader/config remains in `src/routes/__root.tsx`. Automatic config pageviews are disabled there (`send_page_view: false`) and `src/components/analytics/GaPageViews.tsx` emits one explicit initial `page_view` plus one for each TanStack Router path/search change.

`src/lib/desk/ga.ts` provides `gtagEvent`, `gtagEventAfterSuccess`, and the page-view bridge. It also repairs a missing client-side `gtag` queue/loader so a dropped or late head script does not silently lose Floor events.

## Event matrix

| EVENT | TRIGGER | SUCCESS CONDITION | PARAMETERS | KEY EVENT CANDIDATE | NOTES |
| --- | --- | --- | --- | --- | --- |
| `enter_the_floor` | Click **"Enter the floor"** (IntroBand) or **"Open the floor"** (reading `Page`) | Intentional CTA click (not page load) | none | yes | Primary navigation CTA only |
| `feedback_submitted` | Ideas & feedback composer submit | `postBoard` resolves for kind `idea` or `feedback` | none | yes | Not DESK admin updates; not click-before-request; exactly one emit per successful submit |
| `paper_call_locked` | Arena panel human UP/DOWN lock | `placeCall` resolves | none | yes | Human paper lock only — not Chair/Council/WAIT/auto; not signup |
| `character_voice_played` | Visitor explicitly taps a Council voice control | Browser audio fires `playing` | none | no | Aggregate engagement only; no speaker, text, event key, ticker, or other content is sent |

## GA automatic form events

GA4 Enhanced Measurement may independently report `form_start` and `form_submit`. Those are generic automatic events and are **not** the Floor success event.

The Floor contract remains the literal custom event `feedback_submitted`, emitted only after the Board write succeeds. Do not rename the product event to `form_submit`.

## Removed / never use

- `generate_lead` — renamed to `feedback_submitted`
- `signup` / `sign_up` — renamed to `paper_call_locked` (Arena is not account signup)
- `purchase` and other commerce events — out of scope; do not mark in Admin from this PR

## Human verification after deploy

1. **Tag Assistant / browser network:** open an incognito visit to `https://satoshiscouncil.com/`. Confirm Measurement ID `G-JMQGD1WTVT` loads and one `page_view` collect request is sent. Navigate client-side to another room and confirm one additional `page_view`.
2. **GA4 Realtime / DebugView:** while that visit is active, confirm the user appears and `page_view` is received. Submit one real Board idea or feedback item and confirm exactly one `feedback_submitted` event. A successful Arena human paper lock should continue to emit `paper_call_locked`.
3. **Admin → Events:** confirm `enter_the_floor`, `paper_call_locked`, and `feedback_submitted` all appear after GA processing. Do not mark Key Events from code or from this PR; Analytics Watch can mark the Floor trio once all three are present.

## Realtime incident note

During the September 20, 2026 investigation, a fresh automated browser visit to the live homepage and Board successfully loaded `gtag.js` and sent a `page_view` collect request to `G-JMQGD1WTVT`. The earlier zero-user Realtime state therefore could not be reproduced as a persistent loader/CSP failure.

Two concrete reliability gaps were still present and are fixed here:

- pageviews depended on the one-time `gtag('config', ...)`, so TanStack SPA route changes had no explicit page-view bridge;
- custom events were discarded when `window.gtag` was unavailable instead of being queued/repaired.

## Freezes

Observe-only analytics plumbing. No Chair/Council/seats/learner/Lab/Stage1/Kalshi business logic, auth, DB, migrations, Render, execution, shop DNS, or Fourthwall changes.
