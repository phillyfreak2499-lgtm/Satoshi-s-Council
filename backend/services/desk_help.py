"""
HELP — desk tickets for Zach. WRONG / ADD / IDEA / SHOUT.

Persists under DATA_DIR. Optional ping via HELP_PING_URL (then LOCK_PING_URL).
Does not lock, size, grade, or change Chair math.
Does not import follower, Kalshi trade keys, or secrets values.
Does not send SMS. Phone and email never live here.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")
KINDS = ("WRONG", "ADD", "IDEA", "SHOUT")
GENERIC = "Could not send."
COOLDOWN_S = 20.0
HOUR_CAP = 8
TEXT_MAX = 280
_PING_ENVS = ("HELP_PING_URL", "LOCK_PING_URL", "FOLLOWER_PING_URL", "LOCK_WEBHOOK_URL")

_lock = threading.Lock()
_hits: Dict[str, List[float]] = {}
_data_override: Optional[Path] = None


def _root() -> Path:
    if _data_override is not None:
        return _data_override
    raw = (os.environ.get("DATA_DIR") or "").strip()
    if raw:
        return Path(raw)
    try:
        from backend.config import settings
        return Path(getattr(settings, "DATA_DIR", None) or "./data")
    except Exception:
        return Path("./data")


def tickets_path() -> Path:
    return _root() / "help-tickets.jsonl"


def now_ct(ts: Optional[float] = None) -> datetime:
    if ts is None:
        return datetime.now(CT)
    return datetime.fromtimestamp(float(ts), CT)


def format_ct(ts: Optional[float] = None) -> str:
    dt = now_ct(ts)
    return dt.strftime("%Y-%m-%d %H:%M %Z")


def load_help_ping_url() -> Optional[str]:
    """Dashboard env only. Never a hardcoded URL."""
    from backend.data.secrets import load_secret_string

    for name in _PING_ENVS:
        val, _src = load_secret_string(name, name)
        if val:
            return val
    return None


def _clean_kind(raw: Any) -> str:
    kind = str(raw or "").strip().upper()
    if not kind:
        return ""
    if kind in KINDS:
        return kind
    return ""


def _clean_text(raw: Any) -> str:
    text = " ".join(str(raw or "").replace("\r", " ").split())
    return text[:TEXT_MAX]


def _rate_blocked(ip: str, now: float) -> bool:
    key = (ip or "unknown").strip() or "unknown"
    window = [t for t in _hits.get(key, []) if now - t < 3600.0]
    _hits[key] = window
    if window and (now - window[-1]) < COOLDOWN_S:
        return True
    if len(window) >= HOUR_CAP:
        return True
    return False


def _note_hit(ip: str, now: float) -> None:
    key = (ip or "unknown").strip() or "unknown"
    _hits.setdefault(key, []).append(now)


def ping_help_ticket(kind: str, text: str, time_ct: str, *, url: Optional[str] = None) -> bool:
    dest = url if url is not None else load_help_ping_url()
    if not dest:
        return False
    payload = {
        "event": "help",
        "kind": kind or "",
        "text": text,
        "time": time_ct,
        "source": "council",
    }
    body = json.dumps(payload).encode("utf-8")

    def _send() -> None:
        try:
            req = urllib.request.Request(
                dest,
                data=body,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=4)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            pass

    threading.Thread(target=_send, daemon=True).start()
    return True


def _append(row: Dict[str, Any]) -> None:
    path = tickets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(row, ensure_ascii=False) + "\n"
    with _lock:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line)


def list_tickets(limit: int = 80) -> List[Dict[str, Any]]:
    path = tickets_path()
    if not path.is_file():
        return []
    rows: List[Dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    rows.reverse()
    return rows[: max(1, min(200, int(limit or 80)))]


def submit(
    ip: str,
    kind: Any = "",
    text: Any = "",
    *,
    now: Optional[float] = None,
    ping: bool = True,
    ping_fn: Optional[Callable[..., bool]] = None,
) -> Dict[str, Any]:
    """
    Desk-code gate is frontend-only (same as the rest of the desk).
    Server lock is IP + short cooldown. Public error is always GENERIC.
    """
    ts = float(now if now is not None else time.time())
    cleaned_kind = _clean_kind(kind)
    if kind and not cleaned_kind:
        return {"ok": False, "error": GENERIC}
    cleaned = _clean_text(text)
    if not cleaned:
        return {"ok": False, "error": GENERIC}
    if _rate_blocked(ip, ts):
        return {"ok": False, "error": GENERIC}
    time_ct = format_ct(ts)
    row = {
        "id": uuid.uuid4().hex[:12],
        "kind": cleaned_kind,
        "text": cleaned,
        "at": now_ct(ts).isoformat(),
        "time": time_ct,
    }
    try:
        _append(row)
    except OSError:
        return {"ok": False, "error": GENERIC}
    _note_hit(ip, ts)
    if ping:
        sender = ping_fn or ping_help_ticket
        try:
            sender(cleaned_kind, cleaned, time_ct)
        except Exception:
            pass
    return {"ok": True}


def reset_rate_limits() -> None:
    _hits.clear()
