"""
Satoshi’s Council – FastAPI backend entrypoint.
Serves /api/state + static Round Table UI. Continuous analysis loop.
Deploy on Render: PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1
"""
from __future__ import annotations
import asyncio
import os
import secrets
import threading
import time
import uuid
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
from backend.services.admin_auth import WRONG as ADMIN_WRONG
from backend.services.admin_auth import admin_configured, load_admin_password, verify_admin
from backend.services.desk_access import unlock_result as desk_unlock_result
from backend.services.follower_gate import COOKIE as FOLLOWER_COOKIE
from backend.services.follower_gate import WRONG as FOLLOWER_WRONG
from backend.services.follower_gate import FollowerAudit, FollowerGate, FollowerRuntime
from backend.services.follower_ping import ping_lock_event
from backend.learning.leader_ranks import rank_book

council = DualOrchestrator()  # BTC Satoshi + ETH Vitalik

# frontend/static is the single deployable UI for Render
STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "static"
# Leader portraits keep the same URL when the signed still is swapped.
# Phones cached the pre-#44 helmet/glow Vitalik at /vitalik-wait.jpg for 24h.
# Short max-age here; JS also appends a content-hash query.
LEADER_JPG_CACHE = {"Cache-Control": "public, max-age=86400"}
ROOM_JPG_CACHE = {"Cache-Control": "public, max-age=86400"}
ASSET_CACHE = {"Cache-Control": "public, max-age=31536000, immutable"}
PORTRAIT_CACHE = {"Cache-Control": "public, max-age=604800"}
PROTECTED_DIR = Path(__file__).resolve().parent.parent / "frontend" / "protected"
DATA_DIR = Path(getattr(settings, "DATA_DIR", None) or (Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
_PROTECTED_OK = {
    "follower_gate.html",
    "follower_gate.js",
    "follower_bundle.html",
    "follower_bundle.js",
}

# A browser storage flag can hide UI, but it cannot protect API data. Keep
# desk sessions server-side and send only an HttpOnly random identifier.
DESK_COOKIE = "council_desk"
DESK_IDLE_S = 12 * 60 * 60
_desk_sessions: dict[str, float] = {}
_desk_sessions_lock = threading.Lock()


def _desk_token(request: Request) -> str:
    return (request.cookies.get(DESK_COOKIE) or "").strip()


def _desk_ok(request: Request) -> bool:
    token = _desk_token(request)
    if not token:
        return False
    now = time.time()
    with _desk_sessions_lock:
        seen = _desk_sessions.get(token)
        if seen is None or now - seen >= DESK_IDLE_S:
            _desk_sessions.pop(token, None)
            return False
        _desk_sessions[token] = now
    return True


def _issue_desk_session(response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with _desk_sessions_lock:
        _desk_sessions[token] = now
        if len(_desk_sessions) > 2000:
            cutoff = now - DESK_IDLE_S
            for old, seen in list(_desk_sessions.items()):
                if seen < cutoff:
                    _desk_sessions.pop(old, None)
    response.set_cookie(
        key=DESK_COOKIE,
        value=token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
        max_age=DESK_IDLE_S,
    )


# Personal-workspace identity — an anonymous, browser-bound account cookie for
# the free process journal. Separate from desk access; carries no privileges.
WORKSPACE_COOKIE = "council_workspace"
WORKSPACE_MAX_AGE_S = 365 * 24 * 60 * 60


def _workspace_id(request: Request) -> str | None:
    raw = (request.cookies.get(WORKSPACE_COOKIE) or "").strip()
    try:
        return str(uuid.UUID(raw))
    except (ValueError, TypeError, AttributeError):
        return None


def _issue_workspace_cookie(response: Response, account_id: str) -> None:
    response.set_cookie(
        key=WORKSPACE_COOKIE,
        value=account_id,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
        max_age=WORKSPACE_MAX_AGE_S,
    )


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
# "*" + allow_credentials lets any site make credentialed calls with the
# visitor's Follower cookie. Wildcard therefore drops credentials; to allow
# them, set CORS_ORIGINS to the explicit origin list.
_cors_wildcard = ("*" in origins) or not origins
if _cors_wildcard:
    logger.warning(
        "CORS_ORIGINS is '*' — cross-origin credentials disabled. "
        "Set it to your desk origin(s) to allow cookie-bearing calls."
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _cors_wildcard else origins,
    allow_credentials=not _cors_wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_desk_session(request: Request, call_next):
    """Require a valid desk session for every API route except the unlock."""
    if (
        request.method == "OPTIONS"
        or not request.url.path.startswith("/api/")
        or request.url.path == "/api/desk/unlock"
        # Free funnel: public proof/workspace pages + Stripe billing (webhook is
        # server-to-server, its signature is its auth). /api/billing/grant is NOT
        # exempted — it stays admin + desk gated.
        or request.url.path.startswith("/api/public/")
        or request.url.path in {
            "/api/billing/webhook", "/api/billing/status",
            "/api/billing/checkout", "/api/billing/claim",
        }
    ):
        return await call_next(request)
    if _desk_ok(request):
        return await call_next(request)
    from fastapi.responses import JSONResponse
    return JSONResponse({"ok": False, "error": "desk session required"}, status_code=401)


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
    from backend.data.coinglass import (
        PLAN_WALL_REASON,
        chair_window_ok,
        coinglass_hud_ok,
        plan_wall_latched,
    )

    coinglass_reason = btc_h.get("coinglass_reason") or (eth_h.get("coinglass_reason") if eth else None)
    if plan_wall_latched():
        coinglass_reason = PLAN_WALL_REASON
    if coinglass_reason is not None:
        coinglass_reason = str(coinglass_reason)
    raw_ok = bool(btc_h.get("coinglass") or eth_h.get("coinglass"))
    snaps = []
    for table in (btc, eth):
        if isinstance(table, dict) and isinstance(table.get("coinglass"), dict) and table.get("coinglass"):
            snaps.append(table["coinglass"])
    if snaps and not any(chair_window_ok(s) for s in snaps):
        raw_ok = False
    coinglass_ok = False if plan_wall_latched() else coinglass_hud_ok(
        raw_ok,
        coinglass_reason,
    )
    if not coinglass_ok and not coinglass_reason and council.running:
        coinglass_reason = "no usable funding/OI/liq this cycle"
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
        "coinglass_reason": coinglass_reason,
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
async def force_analyze(request: Request):
    """
    Manual trigger for testing. Admin only — it drives real Binance/Kalshi/
    CoinGlass fetches. Serialized against the background loop so a forced
    pass cannot interleave with it on the same store and state.
    """
    denied = _admin_required(request)
    if denied is not None:
        return denied
    state = await council.analyze_once()
    return _strip_public_auto_bet(state) if isinstance(state, dict) else state


@app.get("/api/history")
async def history(limit: int = 50):
    return await council.store.recent_signals(limit)


@app.get("/api/council")
async def council_round_table():
    """
    The Round Table. SATOSHI centre and final authority; VITALIK, ARES,
    RAIJIN and ORACLE debate around him, seated by rank.

    Carries the debate lines, the alignment count, any protective veto,
    and Satoshi's single official call (BUY ZONE | HOLD | REDUCE | WAIT).
    """
    from backend.services.round_table import build_round_table

    return build_round_table(
        _table_for_asset("btc"),
        eth_table=_table_for_asset("eth"),
        standings=leader_ranks.standings(),
    )


@app.get("/api/process")
async def process_metrics(limit: int = 5000):
    """
    Process-quality metrics — Confluence Rate and Process Adherence.
    Sits alongside hit rate; it does not replace it.
    """
    from backend.services.process_log import process_log

    return process_log().metrics(limit=limit)


@app.get("/api/process/weekly")
async def process_weekly(limit: int = 5000):
    """
    Auto-scored Weekly Process Scorecard: a single 0–100 process grade plus
    plain-language notes for the Council-Method weekly review. Process quality,
    not P&L, is the score. Paper research only.
    """
    from backend.services.process_log import process_log

    return process_log().weekly_review(limit=limit)


@app.get("/api/move-accuracy")
async def move_accuracy(asset: str = "btc"):
    """
    MOVE accuracy: did BTC's raw spot move the called way (buy → up, sell →
    down) from call to settlement, independent of the Kalshi strike. Builds as
    new calls settle. Paper research only.
    """
    return await council.store.move_accuracy(asset=asset or "btc")


def _committed_finish_rows(rows):
    """Honest directional pool for finish-vs-strike calibration / backtest / proof.

    Keep ONLY rows the settler actually graded (correct in 0/1). This honors the
    grader's abstention: settle_reason chalk_skip / band_skip / path_* / wait_finish
    all leave correct=None on purpose. The old path re-graded those by
    direction-vs-finish, which auto-counted chalk_skip as WINS (the side was chosen
    to match an already ~99c-decided market) and fabricated LOSSES for path cut/flip
    legs — so the headline swung with market chop, not skill. Finish direction on a
    dual-sided P&L book is a diagnostic, never the edge KPI.
    """
    return [r for r in (rows or []) if r.get("correct") in (0, 1)]


# ── Public funnel: proof ledger + personal workspace journal ──────────────
# All /api/public/* is exempt from the desk gate (see require_desk_session).
@app.get("/api/public/proof")
async def public_proof():
    """
    Public transparent record: counts, WAIT share, and directional evaluation
    by regime. Counts are not an edge claim — sample size before any rate, and
    WAIT is a process outcome, never a win. Paper research only.
    """
    try:
        rows = await council.store.recent_settled_calls(limit=5000, asset="btc")
    except Exception:
        rows = []
    directional = wait = hits = 0
    by_horizon: dict = {}
    for r in rows:
        d = str(r.get("direction") or "").upper()
        if d in ("", "WAIT"):
            wait += 1
            continue
        # Only count genuinely committed finish calls the settler graded. Chalk /
        # band / path legs (correct=None) are not directional forecasts and must
        # not inflate the denominator or be re-graded by direction-vs-finish.
        if r.get("correct") not in (0, 1):
            continue
        directional += 1
        ok = 1 if r.get("correct") in (1, True) else 0
        hits += ok
        key = str(r.get("regime") or r.get("regime_key") or "15m")
        b = by_horizon.setdefault(key, {"n": 0, "correct": 0})
        b["n"] += 1
        b["correct"] += ok
    return {
        "decision_records": directional + wait,
        "wait_records": wait,
        "records_by_asset": {"BTC": directional + wait},
        "evaluation": {
            "evaluated_directional_n": directional,
            "wait_reviewed_n": wait,
            "by_horizon": by_horizon,
        },
        "note": "Counts are not an edge claim. Sample size before any rate. "
                "WAIT stays a process outcome and is never counted as a win. "
                "The desk does not auto-trade or promise performance.",
    }


@app.get("/api/public/membership")
async def public_membership():
    """Tier contract for the free→member funnel. Bitcoin-only, paper research."""
    from backend.services import stripe_billing
    return {
        "free": ["Public proof ledger", "First Desk School path",
                 f"{getattr(settings, 'FREE_JOURNAL_LIMIT', 10)} personal journal records", "Weekly process review"],
        "member": ["Full council reasoning & history", "Expanded personal workspace",
                   "Advanced lessons and Council-Method templates"],
        "price": "$24/month",
        "checkout_ready": bool(stripe_billing.configured()),
        "note": "Membership funds the research desk. Paper research only — no auto-trading, no performance promises.",
    }


async def _workspace_account_from_request(request: Request) -> dict | None:
    account_id = _workspace_id(request)
    return await council.store.workspace_account(account_id) if account_id else None


@app.post("/api/public/workspace/ensure")
async def workspace_ensure(request: Request):
    """Create an anonymous, browser-bound free workspace when one does not exist."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    account_id = _workspace_id(request) or str(uuid.uuid4())
    try:
        account = await council.store.get_or_create_workspace_account(account_id, body.get("display_name"))
    except ValueError as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    response = ORJSONResponse({"ok": True, "account": account,
                              "notice": "This free workspace is tied to this browser until account sign-in is added."})
    _issue_workspace_cookie(response, account_id)
    return response


@app.get("/api/public/workspace")
async def workspace_snapshot(request: Request):
    account = await _workspace_account_from_request(request)
    if account is None:
        return ORJSONResponse({"ok": False, "error": "create a free workspace first"}, status_code=401)
    snapshot = await council.store.workspace_snapshot(account["id"])
    return {"ok": True, **(snapshot or {})}


@app.post("/api/public/workspace/journal")
async def workspace_journal_add(request: Request):
    account = await _workspace_account_from_request(request)
    if account is None:
        return ORJSONResponse({"ok": False, "error": "create a free workspace first"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    try:
        entry = await council.store.add_workspace_journal_entry(account["id"], body if isinstance(body, dict) else {})
        return {"ok": True, "entry": entry, "workspace": await council.store.workspace_snapshot(account["id"])}
    except ValueError as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=400)


@app.patch("/api/public/workspace/journal/{entry_id}")
async def workspace_journal_reflect(entry_id: int, request: Request):
    account = await _workspace_account_from_request(request)
    if account is None:
        return ORJSONResponse({"ok": False, "error": "create a free workspace first"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    try:
        entry = await council.store.complete_workspace_journal_entry(account["id"], entry_id, (body or {}).get("reflection"))
        return {"ok": True, "entry": entry, "workspace": await council.store.workspace_snapshot(account["id"])}
    except ValueError as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=400)


@app.post("/api/public/workspace/review")
async def workspace_review(request: Request):
    account = await _workspace_account_from_request(request)
    if account is None:
        return ORJSONResponse({"ok": False, "error": "create a free workspace first"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    try:
        review = await council.store.save_weekly_process_review(account["id"], body if isinstance(body, dict) else {})
        return {"ok": True, "review": review, "workspace": await council.store.workspace_snapshot(account["id"])}
    except ValueError as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=400)


# ── Membership billing (Stripe). Entitlements are server-side on WorkspaceAccount.
@app.get("/api/billing/status")
async def billing_status():
    from backend.services import stripe_billing
    return {"configured": bool(stripe_billing.configured())}


@app.post("/api/billing/checkout")
async def billing_checkout(request: Request):
    from backend.services import stripe_billing
    if not stripe_billing.configured():
        return ORJSONResponse({"ok": False, "error": "billing not configured"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        body = {}
    email = (body or {}).get("email") if isinstance(body, dict) else None
    account_id = _workspace_id(request) or str(uuid.uuid4())
    try:
        await council.store.get_or_create_workspace_account(account_id)
        session = stripe_billing.create_checkout_session(account_id, email)
    except Exception as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=503)
    resp = ORJSONResponse({"ok": True, "url": session.get("url"), "id": session.get("id")})
    _issue_workspace_cookie(resp, account_id)
    return resp


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    from backend.services import stripe_billing
    payload = await request.body()
    sig = request.headers.get("stripe-signature") or ""
    try:
        ok, msg = await stripe_billing.handle_webhook(payload, sig, council.store)
    except Exception as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    return ORJSONResponse({"ok": bool(ok), "result": msg}, status_code=200 if ok else 400)


@app.post("/api/billing/claim")
async def billing_claim(request: Request):
    """After checkout, the browser posts {session_id}; verify ownership then grant."""
    from backend.services import stripe_billing
    if not stripe_billing.configured():
        return ORJSONResponse({"ok": False, "error": "billing not configured"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        body = {}
    session_id = str((body or {}).get("session_id") or "").strip()
    account_id = _workspace_id(request)
    if not session_id or not account_id:
        return ORJSONResponse({"ok": False, "error": "need a session and a workspace"}, status_code=400)
    try:
        info = stripe_billing.retrieve_checkout_session(session_id)
    except Exception as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    # Grant only if the session was paid AND references THIS workspace account.
    if info.get("payment_status") != "paid" or str(info.get("account_id") or "") != account_id:
        return ORJSONResponse({"ok": False, "error": "session not verified for this workspace"}, status_code=403)
    if info.get("customer"):
        await council.store.link_stripe_customer(
            account_id, str(info["customer"]),
            str(info.get("subscription")) if info.get("subscription") else None)
    return {"ok": True, "account": await council.store.workspace_account(account_id)}


@app.post("/api/billing/grant")
async def billing_grant(request: Request):
    """Admin-only manual comp (stays behind BOTH the desk gate and admin auth)."""
    if not _admin_ok(request):
        return ORJSONResponse({"ok": False, "error": "admin required"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    account_id = str((body or {}).get("account_id") or "").strip()
    if not account_id:
        return ORJSONResponse({"ok": False, "error": "account_id required"}, status_code=400)
    await council.store.get_or_create_workspace_account(account_id)
    await council.store.set_membership(account_id, "member", "active")
    return {"ok": True, "account": await council.store.workspace_account(account_id)}


@app.get("/api/process/log")
async def process_rows(limit: int = 200):
    """Recent Satoshi decisions with their alignment and veto context."""
    from backend.services.process_log import process_log

    return {"ok": True, "rows": process_log().rows(limit=limit)}


@app.get("/api/health/feeds")
async def health_feeds():
    """
    Per-feed data health for the desk: price, Kalshi, CoinGlass, ETH — each
    live / stale / down with a last-success age. Reads existing state only.
    """
    from backend.services.feed_health import build_feed_health

    state = council.get_state()
    if isinstance(state, dict):
        state = {**state, "running": council.running}
    return build_feed_health(state)


@app.get("/api/backtest")
async def backtest(limit: int = 2000, asset: str = "btc"):
    """
    Walk-forward evaluation of the desk's live forward record: out-of-sample
    accuracy, per-period drift, and an honest sufficiency read. Paper only.
    """
    from backend.services.backtest import build_backtest

    rows = await council.store.recent_settled_calls(
        limit=min(5000, max(50, limit)), asset=asset or None
    )
    # Grade only genuinely committed finish calls — never chalk auto-wins or
    # fabricated path losses. A thin, honest sample beats a large corrupted one.
    return build_backtest(_committed_finish_rows(rows))


@app.get("/api/calibration")
async def calibration(limit: int = 1000, asset: str = "btc"):
    """
    Reliability of the desk's confidence: does "70%" actually win 70%?
    Scored from settled directional calls. Paper research only.
    """
    from backend.services.calibration import build_calibration

    rows = await council.store.recent_settled_calls(
        limit=min(5000, max(50, limit)), asset=asset or None
    )
    # Same honesty gate as /api/backtest: calibrate only on rows the settler
    # actually graded, so a hardcoded-confidence chalk row can't manufacture
    # a fake "overconfident" gap.
    return build_calibration(_committed_finish_rows(rows))


@app.get("/api/process/export.json")
async def process_export_json(limit: int = 5000):
    """Full paper/decision history as JSON."""
    import json as _json
    from datetime import datetime, timezone
    from backend.services.process_log import process_log

    rows = process_log().export_rows(limit=limit)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=_json.dumps(
            {"format": "satoshi-council-process", "version": 1,
             "exported_at": datetime.now(timezone.utc).isoformat(), "rows": rows},
            indent=2, default=str,
        ),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="council-process-{stamp}.json"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/process/export.csv")
async def process_export_csv(limit: int = 5000):
    """Full paper/decision history as CSV — one row per decision."""
    from datetime import datetime, timezone
    from backend.services.process_log import process_log, rows_to_csv

    body = rows_to_csv(process_log().export_rows(limit=limit))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=body,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="council-process-{stamp}.csv"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/kalshi15m")
async def kalshi_15m():
    """
    Kalshi 15m BTC up/down — a lens on the existing council read. No new bots,
    no new analysis: it reframes the current board + the Kalshi 15m market the
    pipeline already fetches. Paper research only.
    """
    from backend.services.kalshi15m import build_view
    from backend.services.round_table import build_round_table

    btc = _table_for_asset("btc")
    board = build_round_table(
        btc,
        eth_table=_table_for_asset("eth"),
        standings=leader_ranks.standings(),
    )
    return build_view(btc, board)


@app.get("/api/council/ranks")
async def council_ranks():
    """Leader standings. Satoshi is rank 0, fixed, and never listed as movable."""
    return leader_ranks.standings()


@app.post("/api/council/ranks/reset")
async def council_ranks_reset(request: Request):
    """Clear the ranking window. Admin only. Never touches Satoshi's centre seat."""
    denied = _admin_required(request)
    if denied is not None:
        return denied
    return leader_ranks.reset()


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
@app.get("/api/dojo")
async def desk_school():
    """Dojo lessons (formerly School). Display only — never locks."""
    from backend.services.desk_school import school_payload

    return school_payload()


# Sports (ATS/Ares), weather (THE FRONT/Raijin), politics (ORACLE/CRT) and
# the 15m arcade (Side) were removed — this is a Bitcoin research desk.
# ARES / RAIJIN / ORACLE now live only as Satoshi's debate leaders.


@app.delete("/api/paper/{trade_id}")
async def paper_delete(trade_id: int):
    ok = await council.store.delete_manual_trade(trade_id)
    return {"ok": ok, "journal": await council.store.get_manual_journal() if ok else None}



@app.post("/api/huddle/run")
async def huddle_force(request: Request):
    """Force a huddle review (testing). Admin only. Still writes a dated log."""
    denied = _admin_required(request)
    if denied is not None:
        return denied
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
    """
    Update system settings. Admin only — these knobs move the call bar,
    the LAW lock, learning rates, and stake caps. Reads stay public.
    """
    denied = _admin_required(request)
    if denied is not None:
        return denied
    return await _apply_settings_body(request)


@app.post("/api/settings/reset")
@app.post("/api/settings/reset/")
async def reset_settings(request: Request):
    """Factory defaults. Admin only. Always JSON."""
    denied = _admin_required(request)
    if denied is not None:
        return denied
    runtime_settings.reset_to_defaults()
    return _settings_payload(request, {"reset": True})


@app.post("/api/settings/beast")
async def toggle_beast(request: Request):
    denied = _admin_required(request)
    if denied is not None:
        return denied
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




# ── Admin (password-gated) ────────────────────────────────────────────
# The secret lives in COUNCIL_ADMIN_PASSWORD (env or /etc/secrets), never in
# source and never in the JS bundle. Unset = admin routes closed, not open.
# Follower lock 1 reads it per-request so a rotated secret takes effect
# without a redeploy.
# Round Table standings for the four movable leaders. Satoshi is never in here.
# Shared singleton: the council writes to it as calls settle, this serves it.
leader_ranks = rank_book()

follower_gate = FollowerGate(
    load_admin_password,
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


def _file_or_404(path: Path, media_type: str, headers: dict | None = None) -> Response:
    """
    Starlette's FileResponse raises on a missing path, which surfaces as a
    500. A missing asset is a 404.
    """
    if not path.is_file():
        return Response(status_code=404)
    return FileResponse(path, media_type=media_type, headers=headers or {})


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
    """
    Header X-Council-Admin only. The old ?admin= query form is gone —
    query strings land in access logs, proxy logs, and Referer headers.
    Constant-time compare; unset secret fails closed.
    """
    try:
        return verify_admin(request.headers.get("X-Council-Admin") or "")
    except Exception:
        return False


def _admin_required(request: Request):
    """None when authorized, else the 401 to return."""
    if _admin_ok(request):
        return None
    from fastapi.responses import JSONResponse
    return JSONResponse(
        {"ok": False, "error": ADMIN_WRONG, "configured": admin_configured()},
        status_code=401,
    )



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

@app.get("/api/admin/seat-backfill")
async def admin_seat_backfill_contract(request: Request):
    """Print the 90-day Kalshi seat-backfill contract. No run. No live orders."""
    if not _admin_ok(request):
        return {"ok": False, "error": "admin password required"}
    from backend.learning.seat_backfill import backfill_contract, load_status
    return {"ok": True, "contract": backfill_contract(), "status": load_status()}


@app.post("/api/admin/seat-backfill")
async def admin_seat_backfill(request: Request):
    """
    One-pass 90-day Kalshi seat backfill on the persistent disk.
    Paper. Follower OFF. Merges into live brains. Does not wipe.
    """
    if not _admin_ok(request):
        return {"ok": False, "error": "admin password required"}
    body = await _read_json_obj(request)
    force = bool(body.get("force"))
    from backend.learning.seat_backfill import run_seat_backfill
    learners = {}
    clients = {}
    cg_clients = {}
    for c in council._councils():
        learners[c.asset] = c.learner
        pipe = getattr(c, "pipeline", None)
        if pipe is not None:
            clients[c.asset] = getattr(pipe, "kalshi", None)
            cg_clients[c.asset] = getattr(pipe, "coinglass", None)
    report = await run_seat_backfill(
        learners=learners,
        kalshi_clients=clients,
        coinglass_clients=cg_clients,
        persist=True,
        force=force,
    )
    for c in council._councils():
        try:
            c.leader.sync_from_learner()
        except Exception:
            pass
    return report


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
    """
    UI calls this to check the settings password without mutating state.
    Rate-limited per IP so it cannot be used as a brute-force oracle.
    """
    from backend.services.admin_auth import verify_limiter

    try:
        body = await request.json()
    except Exception:
        body = {}
    ip = _client_ip(request)
    if verify_limiter.limited(ip):
        return {"ok": False, "error": ADMIN_WRONG}
    pw = (body or {}).get("password") or ""
    ok = verify_admin(pw)
    if ok:
        verify_limiter.note_success(ip)
    else:
        verify_limiter.note_fail(ip)
    return {"ok": ok, "configured": admin_configured()}


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


@app.post("/api/desk/unlock")
async def desk_unlock(request: Request):
    """
    Shared desk gate. One answer: ok or 'Wrong password'.
    Never echo submitted values. Fail closed if env is unset.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    submitted = body.get("password") or body.get("code") or ""
    result = desk_unlock_result(str(submitted), _client_ip(request))
    if not result.get("ok"):
        return result
    response = ORJSONResponse(result)
    _issue_desk_session(response)
    return response


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
        "idempotency_key": body.get("idempotency_key") or request.headers.get("Idempotency-Key") or "",
    }
    want_live = bool(intent["live"])
    lifetime_n = await _zach_lifetime_n()
    world = _follower_world(asset)
    world["lifetime_n"] = lifetime_n
    result = follower_gate.evaluate_order(
        _follower_token(request),
        intent,
        world,
        # Reserve before awaiting the broker so concurrent requests cannot
        # both pass the same daily cap.
        commit=True,
        lifetime_n=lifetime_n,
    )
    if result.get("accepted") and want_live:
        # Capture the exposure reserved by evaluate_order (commit=True) so it can
        # be refunded if the broker leg never routes.
        reserved_stake = result.get("stake") or 0.0
        reserved_contracts = result.get("contracts") or 0
        route_lock = dict(quotes)
        route_lock["side"] = result.get("side")
        if lock:
            route_lock.update({k: lock[k] for k in ("ticker", "yes_bid", "yes_ask", "up_pct") if lock.get(k) is not None})
        result = await route_accepted_live(result, route_lock)
        # Exposure was atomically reserved before the broker request. Do not
        # record it again after routing or the daily book would double-count.
        # But if routing failed, release the reservation so a transient broker/
        # quote/intent error does not permanently consume the day's caps.
        if not result.get("routed"):
            try:
                follower_gate.runtime.release(reserved_stake, reserved_contracts)
            except Exception:
                pass
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

    # Public funnel pages (served without a desk session; their /api/public/*
    # data is likewise gate-exempt). The desk itself stays at "/".
    @app.get("/proof")
    async def proof_page():
        return FileResponse(STATIC_DIR / "proof.html",
                            headers={"Cache-Control": "no-store, no-cache, must-revalidate"})

    @app.get("/workspace")
    async def workspace_page():
        return FileResponse(STATIC_DIR / "workspace.html",
                            headers={"Cache-Control": "no-store, no-cache, must-revalidate"})

    # JS paints Ares from /static/ares-wait.png. The StaticFiles mount
    # would serve that path with no Cache-Control. Register these first
    # so they get the same short cache as the other leader stills.
    @app.get("/static/ares-wait.png")
    def _static_ares_wait_png() -> Response:
        wait = STATIC_DIR / "ares-wait.png"
        path = wait if wait.is_file() else STATIC_DIR / "ares-chair.png"
        return _file_or_404(path, "image/png", LEADER_JPG_CACHE)

    @app.get("/static/ares-chair.png")
    def _static_ares_chair_png() -> Response:
        return _file_or_404(STATIC_DIR / "ares-chair.png", "image/png", LEADER_JPG_CACHE)

    @app.get("/static/bots/raijin-chair.png")
    def _static_raijin_cowboy_chair_png() -> Response:
        return _file_or_404(STATIC_DIR / "bots" / "raijin-chair.png", "image/png", LEADER_JPG_CACHE)

    @app.get("/static/bots/raijin-wait.png")
    def _static_raijin_cowboy_wait_png() -> Response:
        return _file_or_404(STATIC_DIR / "bots" / "raijin-wait.png", "image/png", LEADER_JPG_CACHE)

    class _StaticLeaderCache(StaticFiles):
        async def get_response(self, path: str, scope):
            response = await super().get_response(path, scope)
            name = str(path).rsplit("/", 1)[-1]
            if name in ("ares-wait.png", "ares-chair.png", "raijin-chair.png", "raijin-wait.png"):
                response.headers["Cache-Control"] = LEADER_JPG_CACHE["Cache-Control"]
            return response

    app.mount("/static", _StaticLeaderCache(directory=str(STATIC_DIR)), name="static")

    # Council-Method templates (decision log, confluence checklist, weekly
    # scorecard, agent-role sheet) — downloadable education/proof assets. Served
    # from frontend/static/templates, falling back to the docs/templates copy.
    _templates_dir = STATIC_DIR / "templates"
    if not _templates_dir.is_dir():
        _templates_dir = Path(__file__).resolve().parent.parent / "docs" / "templates"
    if _templates_dir.is_dir():
        app.mount("/templates", StaticFiles(directory=str(_templates_dir)), name="templates")

    # Bot portraits — currently nested under bots/bots/ (upload layout). Prefer flatten later.
    bots_dir = STATIC_DIR / "bots" / "bots"
    if not bots_dir.is_dir():
        bots_dir = STATIC_DIR / "bots"  # fallback if user flattens
    if bots_dir.is_dir():
        app.mount("/bots", StaticFiles(directory=str(bots_dir)), name="bots")

    portraits_dir = STATIC_DIR / "portraits"
    if portraits_dir.is_dir():
        class _PortraitCache(StaticFiles):
            async def get_response(self, path: str, scope):
                response = await super().get_response(path, scope)
                response.headers["Cache-Control"] = PORTRAIT_CACHE["Cache-Control"]
                return response
        app.mount("/portraits", _PortraitCache(directory=str(portraits_dir)), name="portraits")

    campus_dir = STATIC_DIR / "campus"
    if campus_dir.is_dir():
        @app.get("/campus/dojo")
        @app.get("/campus/dojo/")
        async def campus_dojo():
            return FileResponse(
                campus_dir / "dojo.html",
                media_type="text/html",
                headers={"Cache-Control": "no-store"},
            )

        app.mount("/campus", StaticFiles(directory=str(campus_dir), html=True), name="campus")

    @app.get("/campus-tab.js")
    async def campus_tab_js():
        return _file_or_404(
            STATIC_DIR / "campus-tab.js", "application/javascript",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
        )

    @app.get("/campus-tab.css")
    async def campus_tab_css():
        return _file_or_404(
            STATIC_DIR / "campus-tab.css", "text/css",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
        )

    # Flat asset paths used by static/index.html (style.css, roundtable.js)
    @app.get("/style.css")
    async def style_css():
        return _file_or_404(
            STATIC_DIR / "style.css", "text/css",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
        )

    @app.get("/seat.js")
    async def seat_js():
        return _file_or_404(
            STATIC_DIR / "seat.js", "application/javascript",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
        )

    @app.get("/roundtable.js")
    async def roundtable_js():
        return _file_or_404(
            STATIC_DIR / "roundtable.js", "application/javascript",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
        )

    @app.get("/wire.js")
    async def wire_js():
        return _file_or_404(
            STATIC_DIR / "wire.js", "application/javascript",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
        )

    @app.get("/shrine-faces.js")
    async def shrine_faces_js():
        return _file_or_404(
            STATIC_DIR / "shrine-faces.js", "application/javascript",
            {"Cache-Control": ASSET_CACHE["Cache-Control"]},
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
        return _file_or_404(STATIC_DIR / "chair-up.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    @app.get("/chair-down.jpg")
    async def chair_down():
        return _file_or_404(STATIC_DIR / "chair-down.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    @app.get("/chair-wait.jpg")
    async def chair_wait():
        return _file_or_404(STATIC_DIR / "chair-wait.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    @app.get("/vitalik-up.jpg")
    async def vitalik_up():
        return _file_or_404(STATIC_DIR / "vitalik-up.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    @app.get("/vitalik-down.jpg")
    async def vitalik_down():
        return _file_or_404(STATIC_DIR / "vitalik-down.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    @app.get("/vitalik-wait.jpg")
    async def vitalik_wait():
        return _file_or_404(STATIC_DIR / "vitalik-wait.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    # ORACLE is still a debate-leader face on the Round Table (synthesis /
    # process guardian). Its old CRT desk is gone; the portrait stays.
    @app.get("/oracle-wait.jpg")
    async def oracle_wait():
        return _file_or_404(STATIC_DIR / "oracle-wait.jpg", "image/jpeg",
                            LEADER_JPG_CACHE)

    @app.get("/satoshi-shrine.jpg")
    async def satoshi_shrine():
        return _file_or_404(STATIC_DIR / "satoshi-shrine.jpg", "image/jpeg",
                            ROOM_JPG_CACHE)

    @app.get("/vitalik-city.jpg")
    async def vitalik_city():
        return _file_or_404(STATIC_DIR / "vitalik-city.jpg", "image/jpeg",
                            ROOM_JPG_CACHE)

    @app.get("/hive-egg.png")
    async def hive_egg_png():
        path = STATIC_DIR / "hive-egg.png"
        if not path.exists():
            from fastapi.responses import Response
            return Response(status_code=404)
        return FileResponse(path, media_type="image/png",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/login-council.jpg")
    async def login_council_jpg():
        return _file_or_404(STATIC_DIR / "login-council.jpg", "image/jpeg",
                            {"Cache-Control": "public, max-age=86400"})


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
