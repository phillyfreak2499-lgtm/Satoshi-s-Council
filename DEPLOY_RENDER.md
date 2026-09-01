# Deploy Satoshi’s Council on Render (max setup)

Uses **three** Render resources so the council stays live and learns overnight:

| Resource | Role |
|----------|------|
| **Web Service** (Starter+) | FastAPI + Round Table UI + continuous analysis loop |
| **Persistent Disk** (2 GB) | SQLite DB, brain weights, huddle logs, settings |
| **Cron: huddle** | Fires `/api/huddle/run` ~3:05 AM CT |
| **Cron: keepalive** | Pings `/health` every 10 min (safety if plan sleeps) |

> **Do not use Free tier** for live trading signals — it spins down and stops the analysis loop.

## A) GitHub first

1. Create a new GitHub repo (public or private).
2. Upload **this folder as the repo root** (must contain `backend/`, `frontend/`, `requirements.txt`, `render.yaml`).
3. Push to `main`.

Parse-check the desk JS before every push (this is the dark-desk bug):

```bash
sh scripts/check.sh
# or: node --check frontend/static/roundtable.js
```

The Render build also runs `python3 scripts/check.py`, which calls `node --check` when node is on PATH.

```bash
git init
git add .
git commit -m "Satoshi Council — Render ready"
git branch -M main
git remote add origin https://github.com/YOUR_USER/satoshi-council.git
git push -u origin main
```

## B) Render Blueprint (recommended)

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the GitHub repo
3. Render reads `render.yaml` and creates:
   - Web service `satoshi-council`
   - Disk on `/opt/render/project/src/data`
   - Two cron jobs
4. Apply → wait for first deploy (3–6 min)

## C) Manual Web Service (if not using Blueprint)

1. **New → Web Service** → connect repo  
2. Runtime **Python 3**  
3. Build: `pip install -r requirements.txt && python3 scripts/check.py`  
4. Start:

```
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 75
```

5. Health check path: `/health`  
6. **Disk**: mount path `/opt/render/project/src/data`, size **2 GB**  
7. Environment:

```
DATA_DIR=/opt/render/project/src/data
DATABASE_URL=sqlite+aiosqlite:////opt/render/project/src/data/council.db
CORS_ORIGINS=*
BEAST_MODE=true
ANALYSIS_INTERVAL=2
HTTP_TIMEOUT=6
KLINE_LIMIT=90
DUAL_SPOT=true
PARALLEL_AGENTS=true
```

8. Plan: **Starter** or **Standard**

## C2) Secrets — required

Set these as **secret** env vars in the Render dashboard (or as secret files in
`/etc/secrets/<NAME>`). They are never committed and never appear in the JS bundle.

| Name | Gates | If unset |
|------|-------|----------|
| `COUNCIL_ADMIN_PASSWORD` | Settings writes, brain export/import, seat backfill, Excel export, forced analyze/huddle, live arming, Follower lock 1 | **Those routes stay closed.** The desk still runs and reads fine, but you cannot change settings or arm live |
| `COUNCIL_ACCESS_PASSWORD` | Shared desk gate (`/api/desk/unlock`) | Desk gate fails closed |
| `FOLLOWER_PASSWORD_2` | Follower lock 2 | Follower cannot unlock |
| `FOLLOWER_PASSWORD_3` | Follower lock 3 | Follower cannot unlock |
| `COINGLASS_API_KEY` | Funding / OI / liquidation feeds | CARRY / CHAIN / CASCADE sit WAIT |

`COUNCIL_ADMIN_PASSWORD` is the one to set first — without it the Settings tab
will reject every save with `401 admin password required`.

**Do not put the admin password in a URL.** The old `?admin=<password>` query
form has been removed; the UI sends it as the `X-Council-Admin` header and holds
it in memory for the page session only.

`CORS_ORIGINS=*` disables credentialed cross-origin calls. Set it to your actual
desk origin (e.g. `https://YOUR-SERVICE.onrender.com`) if you need cookies to
work across origins.

## D) Cron jobs

This repo does not ship `deploy/cron_huddle.py` or `deploy/cron_keepalive.py`.
The Blueprint is one web service. Do not add cron resources unless those
scripts exist in the tree.

## E) After deploy

- Open `https://YOUR-SERVICE.onrender.com/`
- Settings → BEAST on, tune path/FADE/ANTI/huddle
- **Download brain.json** periodically (also stored on the disk)
- Check `/health` → `"status":"ok"` and low `state_age_s`

## F) What Render is doing for you

| Feature | How we use it |
|---------|----------------|
| Always-on web | Analysis loop never stops (Starter+) |
| Persistent disk | Learning + paper history survive deploys |
| Auto-deploy | Push to `main` → new build |
| Health checks | Restarts stuck workers |
| Cron | Guaranteed 3 AM CT huddle + warm pings |
| Env vars | Secrets + tuning without code changes |
| Proxy headers | Correct client IP / HTTPS behind Render |

## G) Limits to respect

- **One web instance only** — in-process loop + SQLite are not multi-instance safe
- No Kalshi/Binance keys required for public market data
- If Binance futures is geo-blocked, spot + vision endpoints still feed most bots
- Optional Postgres: only needed if you outgrow SQLite; disk SQLite is fine for this scale

## H) Local check before push

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PYTHONPATH = "."
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Visit `http://127.0.0.1:8000/health` then the UI.
