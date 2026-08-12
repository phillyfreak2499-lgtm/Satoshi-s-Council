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
from backend.config import settings
from backend.services.runtime_settings import runtime_settings

council = Council()

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
    """Render health check — include loop freshness so probes detect a stuck worker."""
    state = council.get_state()
    ts = state.get("timestamp")
    age = None
    if ts:
        try:
            # ISO timestamp from council
            from datetime import datetime, timezone
            t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            age = max(0.0, (datetime.now(timezone.utc) - t).total_seconds())
        except Exception:
            age = None
    healthy = council.running and (age is None or age < max(90.0, settings.ANALYSIS_INTERVAL * 8))
    # Always HTTP 200 so Render doesn't recycle during brief stalls; status field shows health
    return {
        "status": "ok" if healthy else "degraded",
        "service": settings.APP_NAME,
        "running": council.running,
        "state_age_s": round(age, 1) if age is not None else None,
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
        state = dict(state)
        state["server_time"] = time.time()
    return state


@app.post("/api/analyze")
async def force_analyze():
    """Manual trigger for testing."""
    state = await council.analyze_once()
    return state


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
    """Lifetime hit-rate: correct / total + rolling windows + verdict."""
    return await council.store.get_accuracy()


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



@app.get("/api/settings")
async def get_settings():
    return runtime_settings.snapshot()


@app.post("/api/settings")
async def post_settings(request: Request):
    """Update system settings. Accepts beast_mode + learning/trading/huddle/ui sections."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return runtime_settings.apply_patch(body)


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
    return runtime_settings.set_beast_mode(on)


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


# ── Static UI (single Render web service) ─────────────────────────────
if STATIC_DIR.is_dir():
    @app.get("/")
    async def index():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

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

    @app.get("/summon-council.mp4")
    async def summon_video():
        from fastapi.responses import Response
        path = STATIC_DIR / "summon-council.mp4"
        if not path.exists():
            return Response(status_code=404)
        return FileResponse(
            path,
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

    @app.get("/zt-celebrate.mp4")
    async def zt_celebrate_video():
        from fastapi.responses import Response
        path = STATIC_DIR / "zt-celebrate.mp4"
        if not path.exists():
            return Response(status_code=404)
        return FileResponse(
            path,
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

    @app.get("/zt-intro.mp4")
    async def zt_intro_video():
        from fastapi.responses import Response
        path = STATIC_DIR / "zt-intro.mp4"
        if not path.exists():
            return Response(status_code=404)
        return FileResponse(
            path,
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

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
