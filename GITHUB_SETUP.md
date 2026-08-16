# GitHub Setup & Repo Structure Guide

This document tells you exactly how to turn the current codebase + the new polished documents into a clean, public (or private) GitHub repository.

---

## Recommended Repo Name

`satoshi-council`  
or  
`satoshis-council`

---

## Suggested Final Structure

```text
satoshi-council/
├── README.md                 ← New positioning (already written)
├── DOCTRINE.md               ← Full operating rules
├── ROSTER.md                 ← Agent mapping
├── MEMBERSHIP.md             ← Pricing & access
├── COUNCIL_METHOD.md         ← Digital product outline
├── PIVOT.md                  ← Why the system changed
├── DOCTRINE-LEGACY-PATH.md   ← Archived old doctrine (do NOT drop — README links it)
├── GITHUB_SETUP.md           ← This file
├── DEPLOY_RENDER.md          ← Keep / lightly update existing
├── DEPLOY-SIMPLE.txt
├── WINDOWS-SETUP.txt
├── requirements.txt
├── render.yaml
├── .gitignore                ← Add this before the first commit (see Security Notes)
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── agents/
│   ├── data/
│   ├── services/
│   ├── storage/
│   ├── learning/
│   ├── risk/
│   └── tests/
├── frontend/
│   ├── static/               ← The page actually served in production
│   ├── protected/
│   ├── index.html            ← Legacy standalone page (see note below)
│   ├── css/
│   └── js/
├── deploy/                   ← REQUIRED — render.yaml runs cron_huddle.py + cron_keepalive.py
└── docs/                     ← Optional: put extra docs here later
```

> **Do not omit `deploy/`.** `render.yaml` invokes `python deploy/cron_huddle.py` and
> `python deploy/cron_keepalive.py`. A repo built without that directory deploys with two broken
> cron services.

---

## Step-by-Step: Create the Repo

1. Create a new repository on GitHub (private recommended at first).
2. Clone it locally or initialize in your project folder.
3. Copy the entire existing `Satoshi-s-Council-main` contents into the repo.
4. Replace / add the polished markdown files from this pivot package:
   - README.md (overwrite — merged version, keeps the existing setup/deploy/API sections)
   - DOCTRINE.md (overwrite)
   - DOCTRINE-LEGACY-PATH.md (**new — this is the old `DOCTRINE.md`, archived.** Add it in the same
     commit that overwrites `DOCTRINE.md`, or the previous doctrine is lost and `README.md`'s link
     to it dangles)
   - ROSTER.md (new)
   - MEMBERSHIP.md (new)
   - COUNCIL_METHOD.md (new)
   - PIVOT.md (new)
   - GITHUB_SETUP.md (new)
5. Add a `.gitignore` **before** the first commit — see Security Notes below.
6. Commit with a clear message:

```bash
git add .
git commit -m "Pivot to longer-horizon multi-coin research desk + full documentation package"
git push origin main
```

---

## Immediate Code Priorities After Push

These are the highest-leverage technical changes (in order):

1. **Frontend text & labels**
   - Edit **`frontend/static/index.html`** — that is the page the backend actually serves
     (`main.py` sets `STATIC_DIR = frontend/static`). The visible "Kalshi", "15M WINDOW", and
     "SIDE TABLE" copy lives there. `frontend/index.html` is a legacy standalone page that loads
     assets from absolute root paths and is not what production renders.
   - Change decision labels to the new set (Accumulate / Buy Zone / Hold / Reduce / Sell / Wait).

2. **Agent display names**
   - Edit **`frontend/static/roundtable.js`** (~563 KB, the served bundle). Note there is a second,
     stale `frontend/js/roundtable.js` (~143 KB) that nothing loads — editing it has no effect.
     `frontend/js/api.js` is likewise unreferenced. Consider deleting the dead `frontend/js/` copies
     so this trap doesn't repeat.
   - Backend callsigns come from `backend/agents/roster.py` → `display_name()`.
   - While in there: `SUB_ROSTER["session"]` and `SUB_ROSTER["fade"]` collide with the main-seat
     callsigns CLOCK and FADE, so two different bots currently render under the same name.

3. **Backend decision schema**
   - Update the Chair / leader output language and remove or heavily de-weight pure Kalshi path grading as the primary scoreboard.

4. **Config cleanup**
   - Mute or reduce weight of odds/strike/short-window specific agents. Be aware this is not a small
     change: in `backend/config.py` these carry `strike: 0.11`, `cheap: 0.10`, `odds: 0.09` — about
     30% of total base weight, with `strike` the second-highest-weighted specialist. Redistribute
     deliberately and re-baseline, don't just zero them.
   - `ETH_CORE_AGENTS` currently excludes `regime` (ORBIT), so a documented core seat is missing from
     the ETH table. Decide whether to seat it or amend the docs.
   - Multi-symbol support is **not** currently extensible: `DualOrchestrator` hardcodes `self.btc` /
     `self.eth`, plus a fixed leader map and per-asset branches across `council.py`, `config.py`, and
     `coinglass.py`. Adding SOL is a refactor, not a config change — scope it as such.
   - The CoinGlass plan wall forces CARRY / CHAIN / CASCADE to WAIT (unconditionally on the BTC 15m
     book). Decide whether to pay for the plan or make those seats degrade gracefully.

5. **Access control**
   - Simple free vs paid gate (even a basic password or member flag is fine to start).
   - Today this is a single shared `COUNCIL_ACCESS_PASSWORD`. Everything in `MEMBERSHIP.md` is
     unbuilt — do not publish those tiers publicly until this step is real.

7. **Decide the fate of the off-thesis desks**
   - Side Table (15m Kalshi arcade, SOL/XRP, `LIVE SIDE TABLE` arm phrase) and THE FRONT (Dallas
     weather markets, `LIVE THE FRONT` arm phrase) are still shipped UI tabs. They contradict the
     README's claim that the short-horizon Kalshi path is retired. Either remove them or document
     them honestly — leaving them undocumented is the worst of the three options.

6. **Deployment**
   - Redeploy to Render (or equivalent) so the site is live again.
   - Change the site password immediately.

---

## Security Notes

- The previous password was shared in conversation. Change it on first deploy.
- Do not commit secrets, API keys, or `.env` files.
- **The repo currently has no `.gitignore`**, and step 3 above says to copy everything and `git add .`.
  Done literally, that commits the SQLite database under `backend/data/` (including the paper
  journal) and any mounted `kalshi.pem`. Add this before the first commit:

```gitignore
.env
*.pem
*.key
__pycache__/
*.pyc
.venv/
venv/
backend/data/*.db
backend/data/*.sqlite3
*.log
.DS_Store
```

- **Correction:** `backend/data/secrets.py` contains no secrets — it is an env-var *loader* imported
  by `coinglass.py`, `kalshi_trade.py`, `desk_access.py`, `follower_gate.py`, and `follower_ping.py`.
  Do not remove or gitignore it; doing so breaks the app. Keep the actual secret *values* in
  environment variables and out of the tree.
- Verify before pushing: `git status --porcelain` should list no `.db`, `.pem`, or `.env` files.

---

## What “Done” Looks Like for v1 of the Pivot

- [ ] New README and doctrine live in the repo
- [ ] Site is online again
- [ ] Visible language no longer pushes short-term Kalshi betting
- [ ] Agent seats show the new roles
- [ ] Decision outputs use the new vocabulary
- [ ] Simple free + paid access exists
- [ ] Council Method outline is published (even as markdown initially)

Once the above is true, you have successfully converted the sunk-cost asset into a coherent longer-horizon research product that can begin recovering value.
