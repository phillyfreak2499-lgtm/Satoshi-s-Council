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
3. Build: `pip install -r requirements.txt`  
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

## D) Cron jobs (if not via Blueprint)

**Huddle** — schedule `5 8 * * *` (08:05 UTC ≈ 3:05 AM CDT):

```
python deploy/cron_huddle.py
```

Env: `COUNCIL_URL=https://YOUR-SERVICE.onrender.com`

**Keepalive** — schedule `*/10 * * * *`:

```
python deploy/cron_keepalive.py
```

Same `COUNCIL_URL`.

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
