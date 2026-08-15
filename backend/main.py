"""
Satoshi’s Council – FastAPI backend entrypoint.
Serves /api/state + static Round Table UI. Continuous analysis loop.
Deploy on Render: PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1
"""
from __future__ import annotations
import asyncio
import os
import time
from contextlib import asynccontextmanager, suppress
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
from backend.services.follower_gate import COOKIE as FOLLOWER_COOKIE
from backend.services.follower_gate import WRONG as FOLLOWER_WRONG
from backend.services.follower_gate import FollowerAudit, FollowerGate, FollowerRuntime
from backend.services.follower_ping import ping_lock_event

council = DualOrchestrator()  # BTC Satoshi + ETH Vitalik

# frontend/static is the single deployable UI for Render
STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "static"
PROTECTED_DIR = Path(__file__).resolve().parent.parent / "frontend" / "protected"
DATA_DIR = Path(getattr(settings, "DATA_DIR", None) or (Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
_PROTECTED_OK = {
    "follower_gate.html",
    "follower_gate.js",
    "follower_bundle.html",
    "follower_bundle.js",
}


async def _boot_council():
    """Hydrate + first Kalshi/candle fetch. Must not run before the HTTP port is bound."""
    try:
        await council.start()
        logger.info(
            f"{settings.APP_NAME} online · analysis every {settings.ANALYSIS_INTERVAL}s · "
            f"http_timeout={settings.HTTP_TIMEOUT}s"
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Council boot failed — HTTP stays up")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Listen first. Hydrate/sweep/first fetch stay off the uvicorn bind path.
    # Render single-instance disk swap 502s if $PORT is still closed.
    boot = asyncio.create_task(_boot_council(), name="council-boot")
    logger.info("HTTP listen ready — council boot continues in background")
    try:
        yield
    finally:
        if not boot.done():
            boot.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await boot
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
    if not council.running:
        status = "warming"
    elif age is None or age < max_age:
        status = "ok"
    else:
        status = "degraded"
    btc_h = ((btc or {}).get("health") or {}) if isinstance(btc, dict) else {}
    eth_h = ((eth or {}).get("health") or {}) if isinstance(eth, dict) else {}
    from backend.data.spot_health import spot_feed_ok

    spot_ok = bool(spot_feed_ok(btc_h, btc)) or bool(eth and spot_feed_ok(eth_h, eth))
    kalshi_btc_ok = bool(btc_h.get("kalshi", True))
    kalshi_eth_ok = bool(eth_h.get("kalshi", True)) if eth else None
    kalshi_ok = kalshi_btc_ok and (kalshi_eth_ok is not False)
    coinglass_ok = bool(btc_h.get("coinglass") or eth_h.get("coinglass"))
    quote_age = btc_h.get("quote_age_s")
    if quote_age is None:
        quote_age = age
    return {
        "status": status,
        "service": settings.APP_NAME,
        "running": council.running,
        "dual": bool(state.get("dual")),
        "state_age_s": round(age, 1) if age is not None else None,
        "btc_age_s": round(btc_age, 1) if btc_age is not None else None,
        "eth_age_s": round(eth_age, 1) if eth_age is not None else None,
        "kalshi_btc_ok": kalshi_btc_ok,
        "kalshi_eth_ok": kalshi_eth_ok,
        "kalshi_ok": kalshi_ok,
        "spot_ok": spot_ok,
        "coinglass_ok": coinglass_ok,
        "quote_age_s": round(float(quote_age), 1) if quote_age is not None else None,
        "analysis_interval_s": settings.ANALYSIS_INTERVAL,
        "fetch_ms": (state.get("health") or {}).get("last_fetch_ms") or btc_h.get("last_fetch_ms"),
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
    from backend.agents.chair_gates import floor_scorecard
    return {
        "btc": btc,
        "eth": eth,
        "combined": all_,
        "finish_only": True,
        "scorecard": floor_scorecard(btc, eth),
        **all_,
    }


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


@app.get("/api/tape")
async def chair_tape():
    """Auto-graded Chair paper tape — last 24h BTC + ETH. OPEN until official result."""
    from backend.services.desk_pack import chair_tape_payload, load_chair_tape_rows

    rows = await load_chair_tape_rows(council.store, hours=24)
    return chair_tape_payload(rows, hours=24)


@app.get("/api/book")
async def kalshi_book():
    """Live Kalshi depth for the current BTC (Satoshi) and ETH (Vitalik) hours."""
    from backend.services.desk_pack import book_payload

    btc = _table_for_asset("btc")
    eth = _table_for_asset("eth")
    return book_payload(
        (btc.get("market") if isinstance(btc, dict) else None) or {},
        (eth.get("market") if isinstance(eth, dict) else None) or {},
    )


@app.get("/api/brain/recap")
async def brain_recap():
    """Public last-huddle recap. Admin knobs stay in Settings."""
    from backend.agents.chair_gates import floor_scorecard
    from backend.services.desk_pack import brain_recap_from_report

    report = getattr(council.huddle, "last_report", None)
    hier_btc = []
    hier_eth = []
    try:
        hier_btc = council.learner.hierarchy_ranks() if council.learner else []
    except Exception:
        hier_btc = []
    try:
        if getattr(council, "eth", None) is not None and getattr(council.eth, "learner", None):
            hier_eth = council.eth.learner.hierarchy_ranks()
    except Exception:
        hier_eth = []
    btc_acc = await council.store.get_accuracy(asset="btc")
    eth_acc = await council.store.get_accuracy(asset="eth")
    return brain_recap_from_report(
        report,
        hierarchy_btc=hier_btc,
        hierarchy_eth=hier_eth,
        scorecard=floor_scorecard(btc_acc, eth_acc),
        btc_acc=btc_acc,
        eth_acc=eth_acc,
    )


@app.get("/api/news")
async def desk_news():
    """Coming-up prints + breaking hour headlines. Display only — never locks."""
    from backend.services.desk_news import fetch_news_desk

    btc = _table_for_asset("btc")
    market = (btc.get("market") if isinstance(btc, dict) else None) or {}
    liq = None
    try:
        pipe = getattr(council, "pipeline", None)
        last = getattr(pipe, "last_good", None) if pipe is not None else None
        if isinstance(last, dict):
            liq = last
    except Exception:
        liq = None
    return await fetch_news_desk(hour_close=market.get("close_time"), liq_snap=liq)


@app.get("/api/school")
async def desk_school():
    """Short Floor lessons. Display only — never locks."""
    from backend.services.desk_school import school_payload

    return school_payload()


@app.get("/api/side")
async def api_side():
    """Side Table — 15m arcade + hot strip. Paper default. No Follower."""
    from backend.services import desk_side

    return await desk_side.build_board()


@app.post("/api/side/tap")
async def api_side_tap(request: Request):
    """Manual paper (default) or armed live tap. Never auto."""
    from backend.services import desk_side

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return await desk_side.tap(
        ticker=str(body.get("ticker") or ""),
        side=str(body.get("side") or ""),
        stake=body.get("stake") if body.get("stake") is not None else body.get("size"),
        live=bool(body.get("live")),
        yes_bid=body.get("yes_bid"),
        yes_ask=body.get("yes_ask"),
        secs_left=body.get("secs_left"),
        sick=bool(body.get("sick") or body.get("dont_play")),
    )


@app.post("/api/side/arm")
async def api_side_arm(request: Request):
    """Opt-in live on this tab only. Typed phrase + delay."""
    from backend.services import desk_side

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return desk_side.arm_live(str(body.get("phrase") or ""))


@app.post("/api/side/kill")
async def api_side_kill():
    """Kill switch — Side Table live off."""
    from backend.services import desk_side

    return desk_side.kill_live()


@app.get("/api/front")
async def api_front():
    """THE FRONT — Dallas DFW weather council. Paper default. No Follower."""
    from backend.services import desk_front

    return await desk_front.build_board()


@app.post("/api/front/tap")
async def api_front_tap(request: Request):
    """Manual paper (default) or armed live tap. Never auto."""
    from backend.services import desk_front

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return await desk_front.tap(
        ticker=str(body.get("ticker") or ""),
        side=str(body.get("side") or "YES"),
        stake=body.get("stake") if body.get("stake") is not None else body.get("size"),
        live=bool(body.get("live")),
        yes_bid=body.get("yes_bid"),
        yes_ask=body.get("yes_ask"),
        sick=bool(body.get("sick") or body.get("dont_play")),
        votes=body.get("votes"),
        bracket=body.get("bracket"),
        best=bool(body.get("best")),
        strike_type=body.get("strike_type"),
        floor_strike=body.get("floor_strike"),
        cap_strike=body.get("cap_strike"),
    )


@app.post("/api/front/arm")
async def api_front_arm(request: Request):
    """Opt-in live on this tab only. Typed phrase + delay."""
    from backend.services import desk_front

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return desk_front.arm_live(str(body.get("phrase") or ""))


@app.post("/api/front/kill")
async def api_front_kill():
    """Kill switch — THE FRONT live off."""
    from backend.services import desk_front

    return desk_front.kill_live()


@app.get("/api/ats")
async def api_ats():
    """Ares — one-game sports Chair. Paper only. No Follower. No Live."""
    from backend.services import desk_ats

    return await desk_ats.build_board()

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


async def _read_json_obj(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        body = {}
    return body if isinstance(body, dict) else {}


def _settings_payload(request: Request, extra: dict | None = None) -> dict:
    snap = dict(_settings_for_client(request))
    snap["ok"] = True
    if extra:
        snap.update(extra)
    return snap


async def _apply_settings_body(request: Request) -> dict:
    """Persist Settings tab PATCH. Always JSON — never index.html."""
    body = await _read_json_obj(request)
    if body.get("reset") is True or body.get("reset_defaults") is True:
        runtime_settings.reset_to_defaults()
        return _settings_payload(request, {"reset": True})
    if "auto_bet" in body and not _admin_ok(request):
        body = dict(body)
        body.pop("auto_bet", None)
    runtime_settings.apply_patch(body)
    return _settings_payload(request)


@app.get("/api/settings")
@app.get("/api/settings/")
async def get_settings(request: Request):
    return _settings_payload(request)


@app.post("/api/settings")
@app.post("/api/settings/")
@app.post("/api/settings/save")
@app.post("/api/settings/save/")
async def post_settings(request: Request):
    """Update system settings. Accepts beast_mode + learning/trading/huddle/ui sections."""
    return await _apply_settings_body(request)


@app.post("/api/settings/reset")
@app.post("/api/settings/reset/")
async def reset_settings(request: Request):
    """Factory defaults. Always JSON."""
    runtime_settings.reset_to_defaults()
    return _settings_payload(request, {"reset": True})


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
async def brain_export(request: Request):
    """
    Download full learning brain: weights, coalitions, regime stats,
    lifetime window calls, accuracy summary. Re-upload into any new instance.
    Admin password required — desk access code is not enough.
    """
    if not _admin_ok(request):
        from fastapi.responses import JSONResponse
        return JSONResponse({"ok": False, "error": "admin password required"}, status_code=401)
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
    if not _admin_ok(request):
        return {"ok": False, "error": "admin password required"}
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

follower_gate = FollowerGate(
    ADMIN_PASSWORD,
    audit=FollowerAudit(DATA_DIR / "follower-audit.jsonl"),
    runtime=FollowerRuntime(DATA_DIR / "follower-runtime.json"),
    ping=ping_lock_event,
)


def _cookie_secure() -> bool:
    raw = (os.environ.get("FOLLOWER_COOKIE_SECURE") or "").strip().lower()
    if raw in ("0", "false", "no"):
        return False
    if raw in ("1", "true", "yes"):
        return True
    return True


def _client_ip(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _follower_token(request: Request) -> str:
    return (request.cookies.get(FOLLOWER_COOKIE) or "").strip()


def _follower_ok(request: Request) -> bool:
    return follower_gate.session_ok(_follower_token(request))


def _set_follower_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=FOLLOWER_COOKIE,
        value=token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _clear_follower_cookie(response: Response) -> None:
    response.delete_cookie(
        FOLLOWER_COOKIE,
        path="/",
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
    )


def _read_protected(name: str) -> Path | None:
    if name not in _PROTECTED_OK:
        return None
    path = PROTECTED_DIR / name
    if not path.is_file():
        return None
    try:
        path.resolve().relative_to(PROTECTED_DIR.resolve())
    except ValueError:
        return None
    return path


def _table_for_asset(asset: str) -> dict:
    state = council.get_state() if council else {}
    if not isinstance(state, dict):
        return {}
    if asset == "eth":
        table = state.get("eth") or (state.get("tables") or {}).get("ethereum") or {}
        return table if isinstance(table, dict) else {}
    table = state.get("btc") or (state.get("tables") or {}).get("bitcoin") or state
    return table if isinstance(table, dict) else {}


def _follower_world(asset: str) -> dict:
    """LAW / huddle / sick-feed / clock. Live cannot bypass these."""
    from backend.data.spot_health import spot_feed_ok
    from backend.services.huddle import is_huddle_window

    table = _table_for_asset(asset)
    health = table.get("health") if isinstance(table.get("health"), dict) else {}
    if not health:
        st = council.get_state() if council else {}
        health = (st.get("health") or {}) if isinstance(st, dict) else {}
        if not isinstance(health, dict):
            health = {}
    spot_ok = spot_feed_ok(health, table)
    kalshi_ok = bool(health.get("kalshi", True))
    sick = (not spot_ok) and (not kalshi_ok)
    law_locked = True
    try:
        if asset == "eth" and getattr(council, "eth", None) is not None:
            law_locked = bool(council.eth.law.is_locked())
        else:
            law_locked = bool(council.law.is_locked())
    except Exception:
        law_locked = True
    try:
        huddle = bool(is_huddle_window())
    except Exception:
        huddle = True
    mins_left = None
    if isinstance(table, dict):
        mins_left = (table.get("lock_timeline") or {}).get("mins_left")
        if mins_left is None:
            mins_left = table.get("mins_left")
        market = table.get("market") if isinstance(table.get("market"), dict) else {}
        if mins_left is None:
            mins_left = market.get("mins_left")
        if mins_left is None and market.get("seconds_left") is not None:
            try:
                mins_left = float(market["seconds_left"]) / 60.0
            except (TypeError, ValueError):
                mins_left = None
    return {
        "law_locked": law_locked,
        "huddle": huddle,
        "sick_feed": sick,
        "mins_left": mins_left,
    }


async def _zach_lifetime_n() -> int:
    """n=0 until 1062/1063 settle. Do not arm Live off an empty lifetime."""
    from backend.agents.chair_gates import lifetime_n_for_zach

    opens: list = []
    raw = 0
    try:
        store = getattr(council, "store", None)
        if store is not None:
            getter = getattr(store, "list_open_calls", None)
            if callable(getter):
                maybe = getter()
                import inspect
                opens = await maybe if inspect.isawaitable(maybe) else (maybe or [])
            if not isinstance(opens, list):
                opens = []
            acc = await store.get_accuracy()
            raw = int((acc or {}).get("total") or 0)
    except Exception:
        opens, raw = [], 0
    return lifetime_n_for_zach(raw, opens)


def _table_quotes(asset: str) -> dict:
    table = _table_for_asset(asset)
    market = table.get("market") if isinstance(table, dict) and isinstance(table.get("market"), dict) else {}
    return {
        "ticker": str(market.get("kalshi_ticker") or market.get("ticker") or "").strip(),
        "yes_bid": market.get("kalshi_yes_bid"),
        "yes_ask": market.get("kalshi_yes_ask"),
        "up_pct": market.get("up_pct") if market.get("up_pct") is not None else market.get("up_mid"),
    }


def _chair_lock(asset: str) -> dict | None:
    """Current Chair UP/DOWN lock + ticker/quotes. None if no lock."""
    table = _table_for_asset(asset)
    if not isinstance(table, dict):
        return None
    lc = table.get("locked_call")
    if not isinstance(lc, dict):
        dec = table.get("decision") if isinstance(table.get("decision"), dict) else {}
        lc = dec.get("locked_call") if isinstance(dec.get("locked_call"), dict) else {}
    if not lc.get("locked"):
        return None
    side = str(lc.get("direction") or "").upper()
    if side not in ("UP", "DOWN"):
        return None
    q = _table_quotes(asset)
    q["side"] = side
    return q


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


@app.get("/api/desk/extensions")
async def desk_extensions(request: Request):
    """Admin-only fragments. Desk-code-only users get 404 — no Follower label."""
    if not _admin_ok(request):
        return Response(status_code=404)
    html_path = _read_protected("follower_gate.html")
    js_path = _read_protected("follower_gate.js")
    return {
        "html": html_path.read_text(encoding="utf-8") if html_path else "",
        "js": js_path.read_text(encoding="utf-8") if js_path else "",
    }


@app.get("/api/desk/extensions.js")
async def desk_extensions_js(request: Request):
    if not _admin_ok(request):
        return Response(status_code=404)
    path = _read_protected("follower_gate.js")
    if path is None:
        return Response(status_code=404)
    return FileResponse(
        path,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/follower/status")
async def follower_status(request: Request):
    """Session cookie only. Desk code and Settings admin unlock are not enough."""
    view = follower_gate.session_view(_follower_token(request))
    if not view:
        return Response(status_code=404)
    return view


@app.get("/api/follower/bundle")
async def follower_bundle(request: Request):
    if not _follower_ok(request):
        return Response(status_code=404)
    follower_gate.touch(_follower_token(request))
    path = _read_protected("follower_bundle.html")
    if path is None:
        return Response(status_code=404)
    return FileResponse(
        path,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/follower/bundle.js")
async def follower_bundle_js(request: Request):
    if not _follower_ok(request):
        return Response(status_code=404)
    follower_gate.touch(_follower_token(request))
    path = _read_protected("follower_bundle.js")
    if path is None:
        return Response(status_code=404)
    return FileResponse(
        path,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/follower/unlock")
async def follower_unlock(request: Request):
    """
    Three locks, one answer: ok or 'wrong password'.
    Never echo submitted values. Never say which lock failed.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    p1 = body.get("p1") or body.get("lock1") or ""
    p2 = body.get("p2") or body.get("lock2") or ""
    p3 = body.get("p3") or body.get("lock3") or ""
    ip = _client_ip(request)
    ok, err, token, _reason = follower_gate.unlock(ip, str(p1), str(p2), str(p3))
    if not ok:
        return {"ok": False, "error": err or FOLLOWER_WRONG}
    resp = ORJSONResponse({"ok": True})
    if token:
        _set_follower_cookie(resp, token)
    return resp


@app.post("/api/follower/lock")
async def follower_lock(request: Request):
    follower_gate.revoke(_follower_token(request))
    resp = ORJSONResponse({"ok": True})
    _clear_follower_cookie(resp)
    return resp


@app.post("/api/follower/heartbeat")
async def follower_heartbeat(request: Request):
    sess = follower_gate.touch(_follower_token(request))
    if sess is None:
        return Response(status_code=404)
    return {"ok": True}


@app.post("/api/follower/live")
async def follower_live(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    confirm = body.get("confirm") or body.get("word") or ""
    lifetime_n = await _zach_lifetime_n()
    ok, err, view = follower_gate.set_live(
        _follower_token(request), confirm, on=True, lifetime_n=lifetime_n
    )
    if not ok:
        return {"ok": False, "error": "refused", "reason": err}
    return {"ok": True, **(view or {})}


@app.post("/api/follower/live-off")
async def follower_live_off(request: Request):
    follower_gate.live_off(_follower_token(request))
    view = follower_gate.session_view(_follower_token(request))
    if not view:
        return {"ok": True, "live": False}
    return {"ok": True, **view}


@app.post("/api/follower/order")
async def follower_order(request: Request):
    """
    Paper intended, or live Kalshi after Follower gates.
    from_lock uses the Chair lock side (HUD "Send this lock live").
    Seat Storm never calls this. Sick-feed / LAW / huddle / caps still refuse.
    """
    from backend.services.follower_route import route_accepted_live

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    asset = "eth" if str(body.get("asset") or "").lower() in ("eth", "ethereum") else "btc"
    from_lock = bool(body.get("from_lock"))
    lock = _chair_lock(asset)
    quotes = _table_quotes(asset)
    if from_lock:
        if not lock:
            return {
                "ok": False,
                "accepted": False,
                "routed": False,
                "live": True,
                "refuse": "intent",
            }
        side = lock["side"]
        live = True
    else:
        side = body.get("side")
        live = bool(body.get("live"))
    intent = {
        "asset": asset,
        "side": side,
        "stake": body.get("stake"),
        "contracts": body.get("contracts"),
        "live": live,
        "confirm_first": body.get("confirm_first") or body.get("confirm") or "",
    }
    want_live = bool(intent["live"])
    lifetime_n = await _zach_lifetime_n()
    world = _follower_world(asset)
    world["lifetime_n"] = lifetime_n
    result = follower_gate.evaluate_order(
        _follower_token(request),
        intent,
        world,
        commit=not want_live,
        lifetime_n=lifetime_n,
    )
    if result.get("accepted") and want_live:
        route_lock = dict(quotes)
        route_lock["side"] = result.get("side")
        if lock:
            route_lock.update({k: lock[k] for k in ("ticker", "yes_bid", "yes_ask", "up_pct") if lock.get(k) is not None})
        result = await route_accepted_live(result, route_lock)
        if result.get("accepted") and result.get("routed"):
            follower_gate.runtime.record_accept(result.get("stake") or 0, result.get("contracts") or 1)
    return {
        "ok": bool(result.get("accepted")) and (not want_live or bool(result.get("routed"))),
        "accepted": bool(result.get("accepted")),
        "routed": bool(result.get("routed")),
        "live": bool(result.get("live")),
        "refuse": result.get("refuse") or "",
        "order_id": result.get("order_id") or "",
    }


@app.get("/api/follower/audit")
async def follower_audit(request: Request, limit: int = 80):
    if not _follower_ok(request):
        return Response(status_code=404)
    return {"ok": True, "events": follower_gate.audit.recent(limit)}



@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_unknown(rest: str):
    """Unknown /api/* must stay JSON. A miss must never fall through to index.html."""
    from fastapi.responses import JSONResponse
    return JSONResponse({"ok": False, "error": "not found", "path": f"/api/{rest}"}, status_code=404)


# ── Static UI (single Render web service) ─────────────────────────────
if STATIC_DIR.is_dir():
    @app.get("/")
    async def index():
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
        )

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
        return FileResponse(
            STATIC_DIR / "style.css",
            media_type="text/css",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
        )

    @app.get("/roundtable.js")
    async def roundtable_js():
        return FileResponse(
            STATIC_DIR / "roundtable.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
        )

    @app.get("/wire.js")
    async def wire_js():
        return FileResponse(
            STATIC_DIR / "wire.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
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
        return _video_response(_first_video("zt-intro.mp4"))

    @app.get("/leader-click.mp4")
    async def leader_click_video():
        return _video_response(_first_video("leader-click.mp4"))

    @app.get("/zt-logo.jpg")
    async def zt_logo():
        path = STATIC_DIR / "zt-logo.jpg"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        return FileResponse(path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/council-mark.png")
    async def council_mark():
        path = STATIC_DIR / "council-mark.png"
        if not path.exists():
            path = STATIC_DIR / "zt-logo.jpg"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        media = "image/png" if path.suffix == ".png" else "image/jpeg"
        return FileResponse(path, media_type=media,
                            headers={"Cache-Control": "no-store"})

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

    @app.get("/raijin-up.jpg")
    async def raijin_up():
        return FileResponse(STATIC_DIR / "raijin-up.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/raijin-down.jpg")
    async def raijin_down():
        return FileResponse(STATIC_DIR / "raijin-down.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/raijin-wait.jpg")
    async def raijin_wait():
        return FileResponse(STATIC_DIR / "raijin-wait.jpg", media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/ares-chair.png")
    async def ares_chair_png():
        return FileResponse(STATIC_DIR / "ares-chair.png", media_type="image/png",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/ares-wait.png")
    async def ares_wait_png():
        path = STATIC_DIR / "ares-wait.png"
        if not path.exists():
            path = STATIC_DIR / "ares-chair.png"
        return FileResponse(path, media_type="image/png",
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
