"""
Satoshi’s Council – FastAPI backend entrypoint.
Serves /api/state + static Round Table UI. Continuous analysis loop.
Deploy on Render: PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1
"""
from __future__ import annotations
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Request, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from backend.services.council import Council
from backend.services.dual import DualOrchestrator
from backend.config import settings
from backend.services.runtime_settings import runtime_settings

council = DualOrchestrator()  # BTC Satoshi + ETH Vitalik

# frontend/static is the single deployable UI for Render
STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "static"
DATA_DIR = Path(getattr(settings, "DATA_DIR", None) or (Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await council.start()
    logger.info(
        f"{settings.APP_NAME} online · analysis every {settings.ANALYSIS_INTERVAL}s · "
        f"http_timeout={settings.HTTP_TIMEOUT}s"
    )
    yield
    await council.stop()
    logger.info("Council shut down cleanly")


app = FastAPI(
    title=settings.APP_NAME,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Render health check — dual-aware freshness for BTC + ETH tables."""
    from datetime import datetime, timezone

    def _age(ts):
        if not ts:
            return None
        try:
            tt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            return max(0.0, (datetime.now(timezone.utc) - tt).total_seconds())
        except Exception:
            return None

    state = council.get_state()
    btc = (state.get("tables") or {}).get("bitcoin") or state.get("btc") or state
    eth = (state.get("tables") or {}).get("ethereum") or state.get("eth")
    age = _age(state.get("timestamp"))
    btc_age = _age((btc or {}).get("timestamp"))
    eth_age = _age((eth or {}).get("timestamp")) if eth else None
    max_age = max(90.0, float(getattr(settings, "ANALYSIS_INTERVAL", 4.5)) * 10)
    healthy = bool(council.running) and (age is None or age < max_age)
    return {
        "status": "ok" if healthy else "degraded",
        "service": settings.APP_NAME,
        "running": council.running,
        "dual": bool(state.get("dual")),
        "state_age_s": round(age, 1) if age is not None else None,
        "btc_age_s": round(btc_age, 1) if btc_age is not None else None,
        "eth_age_s": round(eth_age, 1) if eth_age is not None else None,
        "kalshi_btc_ok": bool(((btc or {}).get("health") or {}).get("kalshi", True)),
        "kalshi_eth_ok": bool(((eth or {}).get("health") or {}).get("kalshi", True)) if eth else None,
        "analysis_interval_s": settings.ANALYSIS_INTERVAL,
        "fetch_ms": (state.get("health") or {}).get("last_fetch_ms"),
    }


@app.get("/api/state")
async def get_state(response: Response):
    """Primary endpoint polled by the Round Table. Cache-Control: no-store for live."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    state = council.get_state()
    # Surface server-side lag for the UI
    if isinstance(state, dict):
        state = _strip_public_auto_bet(dict(state))
        state["server_time"] = time.time()
    return state


@app.post("/api/analyze")
async def force_analyze():
    """Manual trigger for testing."""
    state = await council.analyze_once()
    return _strip_public_auto_bet(state) if isinstance(state, dict) else state


@app.get("/api/history")
async def history(limit: int = 50):
    return await council.store.recent_signals(limit)


@app.get("/api/roster")
async def roster():
    """Cool callsigns + titles for every council seat and sub-bot."""
    from backend.agents.roster import roster_payload
    return roster_payload()


@app.get("/api/accuracy")
async def accuracy():
    """Lifetime hit-rate per asset (btc/eth) + combined."""
    store = council.store
    btc = await store.get_accuracy(asset="btc")
    eth = await store.get_accuracy(asset="eth")
    all_ = await store.get_accuracy(asset=None)
    return {"btc": btc, "eth": eth, "combined": all_, "finish_only": True, **all_}


@app.get("/api/huddle")
async def huddle_status():
    """Nightly 3–4 AM CT cool-down status + last report."""
    return council.huddle.status()



@app.get("/api/paper")
async def paper_journal():
    """Manual user paper tracker — daily/weekly/monthly/yearly (America/Chicago)."""
    return await council.store.get_manual_journal()


@app.post("/api/paper")
async def paper_add(request: Request):
    """
    Add a manual paper trade.
    JSON: { "side": "UP"|"DOWN", "stake": 25, "returned": 40, "note": "optional", "traded_at": optional ISO }
    PnL = returned - stake.
    """
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "invalid JSON"}
    try:
        trade = await council.store.add_manual_trade(
            side=body.get("side") or "",
            stake=float(body.get("stake") or 0),
            returned=float(body.get("returned") if body.get("returned") is not None else body.get("got_back") or 0),
            note=body.get("note"),
            traded_at=body.get("traded_at"),
        )
        return {"ok": True, "trade": trade, "journal": await council.store.get_manual_journal()}
    except Exception as e:
        return {"ok": False, "error": str(e)}



@app.get("/api/paper/auto")
async def paper_auto(asset: str | None = None):
    """Finish-only auto paper journal, filtered by asset=btc|eth."""
    a = (asset or "").lower() or None
    if a not in (None, "btc", "eth", "bitcoin", "ethereum"):
        a = None
    if a == "bitcoin":
        a = "btc"
    if a == "ethereum":
        a = "eth"
    return await council.store.paper_summary_by_asset(asset=a)

@app.delete("/api/paper/{trade_id}")
async def paper_delete(trade_id: int):
    ok = await council.store.delete_manual_trade(trade_id)
    return {"ok": ok, "journal": await council.store.get_manual_journal() if ok else None}



@app.post("/api/huddle/run")
async def huddle_force():
    """Force a huddle review (testing). Still writes a dated log."""
    report = await council.huddle._run_huddle(
        council.store, council.learner, council.leader,
        council.huddle.status().get("now_ct", "")[:10] or "force",
    )
    return report


@app.get("/api/lifetime")
async def lifetime(limit: int = 500, offset: int = 0):
    """Full lifetime graded call log (paginated) for long-run audit."""
    return await council.store.get_lifetime_log(limit=limit, offset=offset)



def _strip_public_auto_bet(obj):
    """Remove auto-bet setup from any public payload. Admin GET /api/settings keeps it."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "auto_bet":
                continue
            out[k] = _strip_public_auto_bet(v)
        return out
    if isinstance(obj, list):
        return [_strip_public_auto_bet(x) for x in obj]
    return obj


def _settings_for_client(request: Request) -> dict:
    snap = runtime_settings.snapshot()
    if not _admin_ok(request):
        return _strip_public_auto_bet(snap)
    return snap


@app.get("/api/settings")
async def get_settings(request: Request):
    return _settings_for_client(request)


@app.post("/api/settings")
async def post_settings(request: Request):
    """Update system settings. Accepts beast_mode + learning/trading/huddle/ui sections."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    # Auto-bet setup is admin-only. Desk access code is not enough.
    if "auto_bet" in body and not _admin_ok(request):
        body = dict(body)
        body.pop("auto_bet", None)
    runtime_settings.apply_patch(body)
    return _settings_for_client(request)


@app.post("/api/settings/beast")
async def toggle_beast(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if "enabled" in body:
        on = bool(body["enabled"])
    else:
        on = not runtime_settings.beast_mode
    runtime_settings.set_beast_mode(on)
    return _settings_for_client(request)


@app.get("/api/brain/export")
async def brain_export():
    """
    Download full learning brain: weights, coalitions, regime stats,
    lifetime window calls, accuracy summary. Re-upload into any new instance.
    """
    import json
    from datetime import datetime, timezone
    from fastapi.responses import Response
    accuracy = await council.store.get_accuracy()
    calls = await council.store.export_brain_rows(limit=5000)
    payload = {
        "format": "satoshi-council-brain",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "learning": council.learner.export_dict(),
        "accuracy": accuracy,
        "window_calls": calls,
        "leader_weights": dict(council.leader.weights),
        "law": council.law.status(),
    }
    body = json.dumps(payload, indent=2, default=str)
    fname = f"satoshi-council-brain-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/brain/import")
async def brain_import(request: Request):
    """
    Upload a previously exported brain JSON.
    Restores adaptive weights/coalitions and merges window call history.
    Body: raw JSON (the export file) OR { "brain": {...}, "mode": "merge"|"replace" }
    """
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "invalid JSON"}
    mode = "merge"
    data = body
    if isinstance(body, dict) and "brain" in body:
        data = body["brain"]
        mode = body.get("mode") or "merge"
    if not isinstance(data, dict):
        return {"ok": False, "error": "expected object"}
    # Accept either wrapped export or bare learning dict
    learning = data.get("learning") if "learning" in data else data
    if data.get("format") == "satoshi-council-brain":
        learning = data.get("learning") or {}
    ok = council.learner.load_from_dict(learning or {})
    try:
        council.learner.save()
    except Exception:
        pass
    council.leader.sync_from_learner()
    if data.get("leader_weights"):
        try:
            council.leader.update_weights({k: float(v) for k, v in data["leader_weights"].items()})
        except Exception:
            pass
    call_result = {"imported": 0, "skipped": 0}
    rows = data.get("window_calls") or []
    if rows:
        try:
            call_result = await council.store.import_brain_rows(rows, mode=mode)
        except Exception as e:
            call_result = {"error": str(e)}
    # Rebuild adaptive from settled if present
    try:
        recent = await council.store.recent_settled_calls(limit=200)
        if recent and hasattr(council.learner, "rebuild_from_history"):
            # optional rebuild
            pass
    except Exception:
        pass
    return {
        "ok": ok,
        "learning_restored": ok,
        "calls": call_result,
        "snapshot": council.learner.snapshot(),
    }


@app.get("/api/learning")
async def learning():
    """Adaptive weights, per-bot records, and top coalitions."""
    return council.learner.snapshot()




# ── Admin (password-gated from UI; soft check on destructive ops) ─────
ADMIN_PASSWORD = "5152622439"


def _admin_ok(request: Request) -> bool:
    """Accept password via header X-Council-Admin or query ?admin=."""
    try:
        hdr = request.headers.get("X-Council-Admin") or ""
        q = request.query_params.get("admin") or ""
        return hdr == ADMIN_PASSWORD or q == ADMIN_PASSWORD
    except Exception:
        return False



@app.get("/api/journal/locks.csv")
async def journal_locks_csv(asset: str | None = None, limit: int = 200):
    """Finish-only lock journal for offline review."""
    import csv
    import io
    from fastapi.responses import StreamingResponse
    rows = await council.store.recent_settled_calls(limit=min(500, max(20, limit)))
    # filter finish-only + optional asset
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id","asset","direction","entry_odds","outcome","result","settle_reason","strike","close_time","called_at"])
    for r in rows:
        reason = r.get("settle_reason") or ""
        if reason not in ("finish_match", "finish_miss") and r.get("correct") is None:
            # still include settled directional with outcome
            if not r.get("outcome"):
                continue
        a = (r.get("asset") or "").lower()
        if asset and a and a != asset.lower():
            continue
        direction = r.get("direction") or r.get("call_direction") or ""
        outcome = r.get("outcome") or ""
        ok = reason == "finish_match" or (direction and outcome and str(direction).upper() == str(outcome).upper())
        w.writerow([
            r.get("id"),
            a,
            direction,
            r.get("entry_odds_pct") or r.get("open_price"),
            outcome,
            "RIGHT" if ok else "WRONG",
            reason,
            r.get("kalshi_target"),
            r.get("close_time"),
            r.get("called_at"),
        ])
    out.seek(0)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=lock-journal.csv"},
    )

@app.post("/api/admin/clear-hit-rate")
async def admin_clear_hit_rate(request: Request):
    """Reset hit-rate counters display. Does NOT wipe AdaptiveLearner weights."""
    if not _admin_ok(request):
        return {"ok": False, "error": "admin password required"}
    try:
        result = await council.store.clear_hit_rate()
        return result
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/clear-life-log")
async def admin_clear_life_log(request: Request):
    """Clear lifetime log display history. Training weights preserved."""
    if not _admin_ok(request):
        return {"ok": False, "error": "admin password required"}
    try:
        result = await council.store.clear_life_log()
        return result
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/admin/export.xlsx")
async def admin_export_xlsx(request: Request):
    """Download settled life log + hit rate + agent snapshot as Excel."""
    if not _admin_ok(request):
        from fastapi.responses import JSONResponse
        return JSONResponse({"ok": False, "error": "admin password required"}, status_code=401)
    try:
        data = await council.store.export_excel_bytes()
        from datetime import datetime, timezone
        from fastapi.responses import Response
        fname = f"satoshi-council-log-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.xlsx"
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{fname}"',
                "Cache-Control": "no-store",
            },
        )
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/admin/verify")
async def admin_verify(request: Request):
    """UI calls this to check the settings password without mutating state."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    pw = (body or {}).get("password") or ""
    ok = pw == ADMIN_PASSWORD
    return {"ok": ok}



# ── Static UI (single Render web service) ─────────────────────────────
if STATIC_DIR.is_dir():
    @app.get("/")
    async def index():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # Bot portraits — currently nested under bots/bots/ (upload layout). Prefer flatten later.
    bots_dir = STATIC_DIR / "bots" / "bots"
    if not bots_dir.is_dir():
        bots_dir = STATIC_DIR / "bots"  # fallback if user flattens
    if bots_dir.is_dir():
        app.mount("/bots", StaticFiles(directory=str(bots_dir)), name="bots")

    # Flat asset paths used by static/index.html (style.css, roundtable.js)
    @app.get("/style.css")
    async def style_css():
        return FileResponse(STATIC_DIR / "style.css", media_type="text/css")

    @app.get("/roundtable.js")
    async def roundtable_js():
        return FileResponse(
            STATIC_DIR / "roundtable.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/app.js")
    async def app_js_stub():
        path = STATIC_DIR / "app.js"
        if not path.exists():
            from fastapi.responses import Response
            return Response("// desk UI is /roundtable.js\n", media_type="application/javascript")
        return FileResponse(
            path,
            media_type="application/javascript",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.get("/favicon.ico")
    async def favicon_ico():
        ico = STATIC_DIR / "favicon.ico"
        svg = STATIC_DIR / "favicon.svg"
        if ico.exists():
            return FileResponse(ico, media_type="image/x-icon",
                                headers={"Cache-Control": "public, max-age=86400"})
        if svg.exists():
            return FileResponse(svg, media_type="image/svg+xml",
                                headers={"Cache-Control": "public, max-age=86400"})
        from fastapi.responses import Response
        return Response(content=b"", media_type="image/x-icon", status_code=200)

    @app.get("/favicon.svg")
    async def favicon_svg():
        path = STATIC_DIR / "favicon.svg"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        return FileResponse(path, media_type="image/svg+xml",
                            headers={"Cache-Control": "public, max-age=86400"})

    def _first_video(*names: str):
        folders = (STATIC_DIR, STATIC_DIR / "video", STATIC_DIR / "videos")
        for name in names:
            for folder in folders:
                path = folder / name
                if path.exists():
                    return path
        return None

    def _video_response(path):
        from fastapi.responses import Response
        if path is None or not path.exists():
            return Response(status_code=404)
        return FileResponse(
            path,
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

    @app.get("/summon-council.mp4")
    async def summon_video():
        return _video_response(_first_video("summon-council.mp4"))

    @app.get("/zt-celebrate.mp4")
    async def zt_celebrate_video():
        return _video_response(_first_video("zt-celebrate.mp4", "money-closeup.mp4"))

    @app.get("/zt-intro.mp4")
    async def zt_intro_video():
        return _video_response(_first_video("zt-intro.mp4", "money-closeup.mp4"))

    @app.get("/zt-logo.jpg")
    async def zt_logo():
        path = STATIC_DIR / "zt-logo.jpg"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        return FileResponse(path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/zt-watermark.jpg")
    async def zt_watermark():
        path = STATIC_DIR / "zt-watermark.jpg"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        return FileResponse(path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/chair-up.jpg")
    async def chair_up():
        return FileResponse(STATIC_DIR / "chair-up.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/chair-down.jpg")
    async def chair_down():
        return FileResponse(STATIC_DIR / "chair-down.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/chair-wait.jpg")
    async def chair_wait():
        return FileResponse(STATIC_DIR / "chair-wait.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/vitalik-up.jpg")
    async def vitalik_up():
        return FileResponse(STATIC_DIR / "vitalik-up.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/vitalik-down.jpg")
    async def vitalik_down():
        return FileResponse(STATIC_DIR / "vitalik-down.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/vitalik-wait.jpg")
    async def vitalik_wait():
        return FileResponse(STATIC_DIR / "vitalik-wait.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/hive-egg.png")
    async def hive_egg_png():
        path = STATIC_DIR / "hive-egg.png"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        return FileResponse(path, media_type="image/png",
                            headers={"Cache-Control": "public, max-age=86400"})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", settings.PORT))
    # workers=1 required: analysis loop lives in-process
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=port,
        reload=settings.DEBUG,
        workers=1,
    )
