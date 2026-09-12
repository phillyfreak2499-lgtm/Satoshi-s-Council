# GA4 custom events (thin instrumentation)

Measurement ID on site: `G-JMQGD1WTVT` (gtag direct in `src/routes/__root.tsx`). No GTM. No new vendor.

Helper: `src/lib/desk/ga.ts` → `gtagEvent` / `gtagEventAfterSuccess`.

## Event matrix

| EVENT | TRIGGER | SUCCESS CONDITION | PARAMETERS | KEY EVENT CANDIDATE | NOTES |
| --- | --- | --- | --- | --- | --- |
| `enter_the_floor` | Click **"Enter the floor"** (IntroBand) or **"Open the floor"** (reading `Page`) | Intentional CTA click (not page load) | none | yes | Primary navigation CTA only |
| `feedback_submitted` | Ideas & feedback composer submit | `postBoard` resolves for kind `idea` or `feedback` | none | yes | Not DESK admin updates; not click-before-request; never on fail |
| `paper_call_locked` | Arena panel human UP/DOWN lock | `placeCall` resolves | none | yes | Human paper lock only — not Chair/Council/WAIT/auto; not signup |

## Removed / never use

- `generate_lead` — renamed to `feedback_submitted`
- `signup` / `sign_up` — renamed to `paper_call_locked` (Arena is not account signup)
- `purchase` and other commerce events — out of scope; do not mark in Admin from this PR

## Freezes

Observe-only analytics plumbing. No Chair/Council/seats/learner/Lab/Stage1/Kalshi business logic, auth, DB, migrations, Render, or execution changes.
