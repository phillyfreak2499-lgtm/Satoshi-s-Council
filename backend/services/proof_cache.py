"""Cached public proof ledger.

GET /api/public/proof used to scan 5k settled rows and N+1 the vote
blob on the only worker. The proof page infinite-loaded. This module
keeps a precomputed summary, rebuilt on settle (and once on first miss).
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from loguru import logger

NOTE = (
    "Counts are not an edge claim. Sample size before any rate. "
    "WAIT stays a process outcome and is never counted as a win. "
    "The desk does not auto-trade or promise performance."
)

_TTL_S = 90.0
_lock = asyncio.Lock()
_body: Optional[Dict[str, Any]] = None
_at = 0.0


def _disk_path() -> Path:
    from backend.config import settings
    root = Path(getattr(settings, "DATA_DIR", None) or "./data")
    root.mkdir(parents=True, exist_ok=True)
    return root / "proof_summary.json"


def summarize_proof_rows(rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Same shape the proof page already reads. No vote blobs."""
    directional = wait = 0
    by_horizon: dict = {}
    for r in rows:
        d = str((r or {}).get("direction") or "").upper()
        if d in ("", "WAIT"):
            wait += 1
            continue
        if (r or {}).get("correct") not in (0, 1):
            continue
        directional += 1
        ok = 1 if r.get("correct") in (1, True) else 0
        key = str(r.get("regime") or r.get("regime_key") or "15m")
        b = by_horizon.setdefault(key, {"n": 0, "correct": 0})
        b["n"] += 1
        b["correct"] += ok
    total = directional + wait
    # WAIT hero: rate only when the sample is real; WAIT is a process outcome.
    MIN_SAMPLE = 10
    wait_hero = {
        "wait_n": wait,
        "directional_n": directional,
        "total_n": total,
        "min_sample": MIN_SAMPLE,
        "wait_rate": (round(100.0 * wait / total, 1) if total >= MIN_SAMPLE else None),
        "line": "WAIT is not a miss.",
    }
    return {
        "decision_records": total,
        "wait_records": wait,
        "records_by_asset": {"BTC": total},
        "evaluation": {
            "evaluated_directional_n": directional,
            "wait_reviewed_n": wait,
            "by_horizon": by_horizon,
        },
        "wait_hero": wait_hero,
        "path_pnl": _weekly_path_pnl(rows),
        "note": NOTE,
    }


def _weekly_path_pnl(rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Monday-to-now $1,000 paper path P&L vs three honest baselines.

    desk       = actual settled paper path P&L (ask-fill, BTC path book)
    coin_flip  = EV of a random side per finish-graded window, $25 risk
    fade_mid   = always buy the sub-50c side, $25 risk
    sit_flat   = 0

    Baselines only see the entry side ask (open_price); the opposite ask is
    approximated as 100 - ask (vig ignored) — labeled as such. Paper, not a
    promise.
    """
    from datetime import datetime, timedelta, timezone
    try:
        from zoneinfo import ZoneInfo
        ct = ZoneInfo("America/Chicago")
    except Exception:
        ct = timezone.utc
    now_ct = datetime.now(ct)
    monday = (now_ct - timedelta(days=now_ct.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    monday_utc_iso = monday.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    week: list = []
    for r in rows or []:
        st = str((r or {}).get("settled_at") or "")
        if st and st >= monday_utc_iso:
            week.append(r)
    week.sort(key=lambda r: str(r.get("settled_at") or ""))

    STAKE = 25.0
    desk = flip = fade = 0.0
    pts = []
    n_desk = n_bench = 0
    for r in week:
        moved = False
        try:
            if r.get("paper_pnl") is not None:
                desk += float(r["paper_pnl"])
                n_desk += 1
                moved = True
        except (TypeError, ValueError):
            pass
        d = str(r.get("direction") or "").upper()
        fin = str(r.get("y_finish") or "").upper()
        ask = r.get("open_price")
        try:
            ask = float(ask) if ask is not None else None
        except (TypeError, ValueError):
            ask = None
        if fin in ("UP", "DOWN") and d in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD") and ask and 1.0 < ask < 99.0:
            side = "UP" if "UP" in d else "DOWN"
            win_ask = ask if side == fin else (100.0 - ask)  # winning side's ask (approx if not ours)
            lose_ask = 100.0 - win_ask
            flip += 0.5 * (STAKE * (100.0 - win_ask) / win_ask) + 0.5 * (-STAKE)
            cheap_ask = min(win_ask, lose_ask)
            cheap_won = cheap_ask == win_ask
            fade += (STAKE * (100.0 - cheap_ask) / cheap_ask) if cheap_won else -STAKE
            n_bench += 1
            moved = True
        if moved:
            pts.append({
                "t": str(r.get("settled_at") or "")[:16],
                "desk": round(1000.0 + desk, 2),
                "coin_flip": round(1000.0 + flip, 2),
                "fade_mid": round(1000.0 + fade, 2),
                "sit_flat": 1000.0,
            })
    return {
        "base": 1000.0,
        "since": monday.strftime("%Y-%m-%d"),
        "n_desk": n_desk,
        "n_bench": n_bench,
        "points": pts[-200:],
        "label": ("Paper · ask-fill · BTC path book · baselines approximate the "
                  "opposite ask as 100−ask (vig ignored) · not a promise"),
    }


def _read_disk() -> Optional[Dict[str, Any]]:
    try:
        raw = _disk_path().read_text(encoding="utf-8")
        body = json.loads(raw)
        if isinstance(body, dict) and "decision_records" in body:
            return body
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.debug(f"proof disk skip: {e}")
    return None


def _write_disk(body: Dict[str, Any]) -> None:
    try:
        path = _disk_path()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)
    except Exception as e:
        logger.debug(f"proof disk write skip: {e}")


def invalidate() -> None:
    global _body, _at
    _body = None
    _at = 0.0


async def _compute(store: Any) -> Dict[str, Any]:
    try:
        rows = await store.proof_ledger_rows(limit=5000, asset="btc")
    except Exception as e:
        logger.warning(f"proof ledger read: {e}")
        rows = []
    return summarize_proof_rows(rows)


async def refresh_proof(store: Any) -> Dict[str, Any]:
    """Rebuild after settle. Safe to call from the analysis loop."""
    global _body, _at
    async with _lock:
        body = await _compute(store)
        _body = body
        _at = time.time()
        _write_disk(body)
        return body


async def get_proof_summary(store: Any) -> Dict[str, Any]:
    """Return the cached ledger. Compute once if empty. Never N+1 votes."""
    global _body, _at
    now = time.time()
    if _body is not None and (now - _at) < _TTL_S:
        return _body
    if _body is None:
        disk = _read_disk()
        if disk is not None:
            _body = disk
            _at = now
            return disk
    async with _lock:
        now = time.time()
        if _body is not None and (now - _at) < _TTL_S:
            return _body
        body = await _compute(store)
        _body = body
        _at = now
        _write_disk(body)
        return body
