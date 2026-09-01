"""
Desk alerts — stub, default OFF.

Wired events (and nothing else): chair_lock, wait_veto, law_lockdown,
feeds_dead, monday_reset. Fires only when ALERTS_ENABLED is truthy AND the
existing lock-ping webhook URL is configured in the environment
(LOCK_PING_URL — see follower_ping). No bot token in source, no per-seat
spam; each event fires on the transition edge, not every cycle.
"""
from __future__ import annotations

import os
from typing import Any

from backend.services.follower_ping import ping_lock_event

_ALLOWED = {"chair_lock", "wait_veto", "law_lockdown", "feeds_dead", "monday_reset"}


def alerts_enabled() -> bool:
    raw = (os.environ.get("ALERTS_ENABLED") or "").strip().lower()
    return raw in ("1", "true", "yes")


def desk_alert(event: str, detail: Any = None) -> bool:
    """Fire one allowed desk event. Returns True only if actually sent."""
    ev = str(event or "").strip()
    if ev not in _ALLOWED:
        return False
    if not alerts_enabled():
        return False
    tag = f"{ev}:{str(detail)[:60]}" if detail else ev
    try:
        return bool(ping_lock_event(tag))
    except Exception:
        return False
