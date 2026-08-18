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
├── GITHUB_SETUP.md           ← This file
├── DEPLOY_RENDER.md          ← Keep / lightly update existing
├── DEPLOY-SIMPLE.txt
├── requirements.txt
├── render.yaml
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
│   ├── index.html
│   ├── css/
│   ├── js/
│   ├── static/
│   └── protected/
└── docs/                     ← Optional: put extra docs here later
```

---

## Step-by-Step: Create the Repo

1. Create a new repository on GitHub (private recommended at first).
2. Clone it locally or initialize in your project folder.
3. Copy the entire existing `Satoshi-s-Council-main` contents into the repo.
4. Replace / add the polished markdown files from this pivot package:
   - README.md (overwrite)
   - DOCTRINE.md (overwrite)
   - ROSTER.md (new)
   - MEMBERSHIP.md (new)
   - COUNCIL_METHOD.md (new)
   - PIVOT.md (new)
   - GITHUB_SETUP.md (new)
5. Commit with a clear message:

```bash
git add .
git commit -m "Pivot to longer-horizon multi-coin research desk + full documentation package"
git push origin main
```

---

## Immediate Code Priorities After Push

These are the highest-leverage technical changes (in order):

1. **Frontend text & labels**
   - Update title, homepage copy, and any visible “Kalshi / 15m / path” language in `frontend/index.html` and related JS.
   - Change decision labels to the new set (Accumulate / Buy Zone / Hold / Reduce / Sell / Wait).

2. **Agent display names**
   - Map the new callsigns in the UI layer (roundtable.js or wherever display_name is set).

3. **Backend decision schema**
   - Update the Chair / leader output language and remove or heavily de-weight pure Kalshi path grading as the primary scoreboard.

4. **Config cleanup**
   - Mute or reduce weight of odds/strike/short-window specific agents for the primary research path.
   - Ensure multi-symbol support is clean for BTC / ETH / SOL (and easily extensible).

5. **Access control**
   - Simple free vs paid gate (even a basic password or member flag is fine to start).

6. **Deployment**
   - Redeploy to Render (or equivalent) so the site is live again.
   - Change the site password immediately.

---

## Security Notes

- The previous password was shared in conversation. Change it on first deploy.
- Do not commit secrets, API keys, or `.env` files.
- Keep `backend/data/secrets.py` patterns out of the public tree or properly gitignored.

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
