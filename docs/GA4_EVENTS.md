# GA4 custom events (thin instrumentation)

Measurement ID on site: `G-JMQGD1WTVT` (gtag direct in `src/routes/__root.tsx`).

Helper: `src/lib/desk/ga.ts` → `gtagEvent(name, params?)`.

| Event | When it fires | UI surface |
| --- | --- | --- |
| `enter_the_floor` | Click primary CTA | IntroBand **"Enter the floor"**; reading pages **"Open the floor"** (`Page.tsx`) |
| `generate_lead` | Successful board post | Ideas & feedback composer — **idea** or **feedback** (not DESK updates) |
| `signup` | Successful paper Arena lock | Arena panel **UP** / **DOWN** lock (`placeCall` succeeds). Account OAuth signup UI is off on Render (`VITE_AUTH_ENABLED=false`); this is the live visitor-join action. |

No purchase events. No GTM. No invented metrics — AWO marks key events in GA Admin after they appear.
