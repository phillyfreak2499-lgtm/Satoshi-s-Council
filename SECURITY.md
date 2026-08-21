# Security — protecting access and the system

Satoshi’s Council is a web app. The browser must load HTML/JS/CSS — that part is always visible. What must stay protected is **desk access**, **full reasoning/history**, **admin controls**, **secrets**, and **source code**.

## What is hardened in code

1. **Access is gated by server-side desk sessions.**
   The Stream is a **public paper TV**. Checking the oath (`POST /api/desk/unlock` with `{oath: true}`) mints a random `secrets.token_urlsafe(32)` token that is stored **server-side** (in `_desk_sessions`) and set as an HttpOnly `council_desk` cookie (`SameSite=lax`, 12h idle expiry). There is no visitor password and no hardcoded `"council"` accept. A real `COUNCIL_ACCESS_PASSWORD` still works if you set one. The token is **not derived from any secret**, so it cannot be forged; it is **revocable** at any time by dropping the server-side entry.

2. **A middleware gates the entire API, including `GET /api/state`.**
   `require_desk_session` returns **401 on every `/api/*` request** except `OPTIONS` (CORS preflight), `/api/desk/unlock`, `/api/public/*`, and the listed billing webhooks. The static shell (`/`, `/static/*`, `/templates/*`) and `/health` load without a session.

3. **`GET /api/state` is a thin poll, not the research book.**
   After a desk session is minted, `/api/state` returns **decision, clock, seat directions, and health flags only** (target < 30 KB). It does **not** include accuracy, weights, hierarchy, learning, huddle, or lifetime logs. Those live on their own gated routes (`/api/accuracy`, `/api/learning`, `/api/huddle`, `/api/lifetime`, `/api/council/ranks`). A scraper without the cookie gets 401, not a megabyte of edge.

4. **Desk unlock is brute-force throttled.**
   Empty / no-oath posts fail closed with **401**. `AttemptLimiter` allows **8 failed attempts per 15 minutes per IP**; further attempts return a generic wrong-password result (no lockout signal is leaked). If `COUNCIL_ACCESS_PASSWORD` is set, it is compared with `hmac.compare_digest`.

5. **Admin stays fail-closed.**
   If `COUNCIL_ADMIN_PASSWORD` is unset, admin routes (brain export, forced analyze, settings writes, seat backfill) stay **closed**. The admin password is **never** stored in frontend JS. The UI posts the typed value to `POST /api/admin/verify`; success mints an HttpOnly `council_admin` cookie. Downloads use that cookie — never `?admin=` query strings.

   The previous client-side literal is burned. Set a **new** `COUNCIL_ADMIN_PASSWORD` on Render after this deploy even if the old env value was already different.

6. **Follower / live-order path is session-gated and idempotent.**
   The Follower bundle and live paths require the follower session cookie. Live orders additionally require a per-order idempotency key (16–160 chars, deduped per session) and reserve daily risk/contract exposure **atomically** before the broker call, releasing it if the order never routes — so concurrent requests cannot both exceed a cap and a failed route cannot silently consume the day’s book.

> Paper-only by default: the desk places no live orders unless the Follower is explicitly armed. Live routing and the Follower stay **off** by default.

## What you must do operationally

### Secrets (Render / VPS)
Set strong values — long random strings, not dictionary words:

```
COUNCIL_ADMIN_PASSWORD=...
COUNCIL_ACCESS_PASSWORD=...   # optional extra lock; Stream oath is enough without it
FOLLOWER_PASSWORD_2=...
FOLLOWER_PASSWORD_3=...
COINGLASS_API_KEY=...        # optional; enables funding/OI/liquidations
```

- Never commit `.env`
- Never put passwords in the frontend JS
- Prefer Render “Secret” env vars or `/etc/secrets`

### Source code
- Keep the **GitHub repo private** and do not publish the project ZIP.
- Frontend JS is expected to be public in the browser; the **backend + DB + passwords** are the gate.

### CORS
- Prefer an explicit origin list over `CORS_ORIGINS=*` when using cookies in production. With `*`, credentialed CORS is disabled (safe default), but same-origin cookie auth still works.

### HTTPS
- Keep cookies `Secure` in production (`FOLLOWER_COOKIE_SECURE=1`) so they are never sent over plain HTTP.

## Quick self-test after deploy

1. Incognito, no unlock → `GET /api/state` returns **401** (the whole API is gated).
2. `GET /health` returns **200** without a session (intended — liveness only).
3. `POST /api/desk/unlock` with `{oath: true}` → subsequent `/api/*` calls succeed (the `council_desk` cookie is set). Empty / `"council"` posts stay **401**.
4. Unlocked `GET /api/state` is **under 30 KB** and has no `accuracy` / `weights` / `hierarchy` / `learning` / `huddle` keys.
5. Eight wrong unlock attempts within 15 min → further attempts are throttled.
6. Without `COUNCIL_ADMIN_PASSWORD` set → admin routes (e.g. brain export) return **401**.

If any of those fail, stop and fix before exposing the desk.

## Note on a future free tier

The live poll is **session-gated and thinned**. Do not add a public unauthenticated `/api/state`. If a free→paid funnel needs a teaser, serve a **separate** `/api/public/*` snapshot with no seats, no clock edge, and no learning — and keep the desk session cookie as the gate for the real poll. Do not switch to stateless signed cookies, which are weaker and non-revocable.
