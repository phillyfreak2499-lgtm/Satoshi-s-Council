# Security — protecting access and the system

Satoshi’s Council is a web app. The browser must load HTML/JS/CSS — that part is always visible. What must stay protected is **desk access**, **full reasoning/history**, **admin controls**, **secrets**, and **source code**.

## What is hardened in code

1. **Access is gated by server-side desk sessions.**
   Unlocking the desk mints a random `secrets.token_urlsafe(32)` token that is stored **server-side** (in `_desk_sessions`) and set as an HttpOnly `council_desk` cookie (`SameSite=lax`, 12h idle expiry). The token is **not derived from any secret**, so it cannot be forged; it is **revocable** at any time by dropping the server-side entry. This is stronger than a signed/stateless cookie (which cannot be revoked before expiry and forges en masse if the signing secret leaks).

2. **A middleware gates the entire API.**
   `require_desk_session` returns **401 on every `/api/*` request** except `OPTIONS` (CORS preflight) and `/api/desk/unlock`. The static shell (`/`, `/static/*`, `/templates/*`) and `/health` load without a session; nothing live — state, reasoning, history, process metrics, calibration, backtest — is served until the desk is unlocked.

3. **Desk unlock is brute-force throttled.**
   `AttemptLimiter` allows **8 failed attempts per 15 minutes per IP**; further attempts return a generic wrong-password result (no lockout signal is leaked). The password itself is compared with `hmac.compare_digest`.

4. **Admin stays fail-closed.**
   If `COUNCIL_ADMIN_PASSWORD` is unset, admin routes (brain export, forced analyze, settings writes, seat backfill) stay **closed**.

5. **Follower / live-order path is session-gated and idempotent.**
   The Follower bundle and live paths require the follower session cookie. Live orders additionally require a per-order idempotency key (16–160 chars, deduped per session) and reserve daily risk/contract exposure **atomically** before the broker call, releasing it if the order never routes — so concurrent requests cannot both exceed a cap and a failed route cannot silently consume the day’s book.

> Paper-only by default: the desk places no live orders unless the Follower is explicitly armed. Live routing and the Follower stay **off** by default.

## What you must do operationally

### Secrets (Render / VPS)
Set strong values — long random strings, not dictionary words:

```
COUNCIL_ADMIN_PASSWORD=...
COUNCIL_ACCESS_PASSWORD=...
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
3. Correct desk unlock → subsequent `/api/*` calls succeed (the `council_desk` cookie is set).
4. Eight wrong unlock attempts within 15 min → further attempts are throttled.
5. Without `COUNCIL_ADMIN_PASSWORD` set → admin routes (e.g. brain export) return **401**.

If any of those fail, stop and fix before exposing the desk.

## Note on a future free tier

The desk is currently **fully gated** — there is no thinned public data view. If a free→paid conversion funnel is added later, keep the server-side desk sessions and relax the middleware to serve only a **thinned** `/api/state` publicly; do not switch to stateless signed cookies, which are weaker and non-revocable.
