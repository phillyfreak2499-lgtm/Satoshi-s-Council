"""
Parked lock ping / webhook for Follower unlock and Live flips.

Reads LOCK_PING_URL (then FOLLOWER_PING_URL, LOCK_WEBHOOK_URL) from env
or a secret file. Never logs or commits the URL. No password material.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Optional

from backend.data.secrets import load_secret_string

_PING_ENVS = ("LOCK_PING_URL", "FOLLOWER_PING_URL", "LOCK_WEBHOOK_URL")


def load_lock_ping_url() -> Optional[str]:
    for name in _PING_ENVS:
        val, _src = load_secret_string(name, name)
        if val:
            return val
    return None


def ping_lock_event(event: str, *, url: str | None = None) -> bool:
    """Fire-and-forget POST. Returns True if a URL was found (not if it delivered)."""
    dest = url if url is not None else load_lock_ping_url()
    if not dest:
        return False
    label = str(event or "follower").strip()[:40] or "follower"
    payload = {
        "event": label,
        "text": label.replace("_", " "),
        "source": "council",
        "ts": time.time(),
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
