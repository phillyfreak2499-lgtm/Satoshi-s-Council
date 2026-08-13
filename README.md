Satoshi’s Council

A living Round Table of specialist agents for Kalshi’s 15-minute Bitcoin markets (KXBTC15M).

Paper signals only. Strong intentional WAIT bias. Deploy the FastAPI backend to Render; run the Round Table UI locally or via the web preview.

What you get







Piece



Role





FastAPI backend



Continuous analysis loop, agents, Leader confluence, SQLite history





/health



Health check for Render





/api/state



Full council snapshot (includes live accuracy)





/api/accuracy



Chair hit-rate: correct / total directional calls + %





/api/history



Recent logged signals





Canvas Round Table



Cyberpunk Art + Dashboard modes (polls /api/state)



Accuracy scoring





Only UP / DOWN Chair calls count (WAIT is not a call).



One call per Kalshi 15m window (latest directional vote before close).



After the window closes, the call is graded vs BTC open→close direction.



UI shows HIT RATE (66.7%) and fraction (2/3).



Project layout

satoshi-council/
├── backend/
│   ├── main.py              # FastAPI app + lifespan loop
│   ├── config.py            # weights, thresholds, endpoints
│   ├── agents/              # 7 specialists + Leader
│   ├── data/                # Binance + Kalshi + pipeline
│   ├── services/council.py  # orchestrator
│   ├── storage/db.py        # SQLite PerformanceStore
│   └── learning/            # reweighter helpers
├── frontend/                # static HTML/JS Canvas client
├── requirements.txt
├── render.yaml
├── DEPLOY_RENDER.md
└── README.md



Council roster (callsigns)







Callsign



Role



Internal key



Specialty





WICK



Pattern Seer



candle



candle patterns, S/R





PULSE



Flow Reader



volume



spikes / confirmation





DRIFT



Trend Scout



momentum



RSI / MACD-ish





TAPE



Book Walker



orderflow



Kalshi mid + taker flow





CARRY



Rate Oracle



funding



perp funding / OI





ORBIT



Regime Watch



regime



session / vol aggressiveness





WARDEN



System Guard



guardian



feed health





CHAIR



The Gavel



leader



confluence + final call

Sub-bots sit behind each specialist: CORE / FRAME, SURGE / ECHO, RIFT / SWING, LEDGER / EDGE, YIELD / SWARM, CLOCK / BAND, NODE-B / NODE-K.

Internal keys stay stable for weights + logic; the UI shows callsigns via display_name.

Example /api/state

{
  "timestamp": "2026-08-11T14:05:10.584Z",
  "decision": {
    "direction": "WAIT",
    "confidence": 72,
    "summary": "Insufficient confluence – WAIT",
    "score": 0.2651,
    "diversity": 2
  },
  "agents": [
    {
      "agent_name": "candle",
      "direction": "UP",
      "confidence": 58,
      "reasoning": "Breaking local high",
      "category": "candle",
      "features": { "body_ratio": 0.998 }
    }
  ],
  "weights": { "candle": 0.22, "volume": 0.15 },
  "market": {
    "price": 118432.1,
    "funding": 0.0001,
    "kalshi_ticker": "KXBTC15M-..."
  },
  "health": { "binance": true, "kalshi": true }
}



Local backend

cd satoshi-council
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 8000

Open frontend/index.html (or set API base) and poll http://localhost:8000/api/state.

Deploy to Render

See DEPLOY_RENDER.md.

Start command (critical):

PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT

Health check: /health
Plan: Starter or Standard (always-on). Free tier sleeps.

Design rules





High WAIT bias is intentional  



No auto-trading  



Free public data only (Binance + Kalshi)  



Modular agents with a shared signal contract



Philosophy

15-minute BTC direction is efficient. This is a research co-pilot and confluence filter, not a money printer. Paper-track expectancy before any size.

Deploy on Render (GitHub)

See DEPLOY_RENDER.md for the full max setup:





Push this repo to GitHub



Render → Blueprint → select repo (render.yaml)



Uses Web Service + 2 GB Disk + Huddle Cron + Keepalive Cron



Open https://YOUR-SERVICE.onrender.com/

Plan: Starter or higher (Free tier sleeps and stops live analysis).
