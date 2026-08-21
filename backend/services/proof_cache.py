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
    return {
        "decision_records": directional + wait,
        "wait_records": wait,
        "records_by_asset": {"BTC": directional + wait},
        "evaluation": {
            "evaluated_directional_n": directional,
            "wait_reviewed_n": wait,
            "by_horizon": by_horizon,
        },
        "note": NOTE,
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
