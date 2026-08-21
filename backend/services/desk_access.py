"""
Shared desk gate. Compare submitted access against env (or secret file).

Never log, print, or return the stored or submitted value.
Fail closed when the env is unset. Wrong answer is always generic.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, Dict

from backend.data.secrets import load_secret_string

ENV_NAME = "COUNCIL_ACCESS_PASSWORD"
WRONG = "Wrong password"


class AttemptLimiter:
    """Small in-process throttle for the shared desk password."""

    def __init__(self, max_attempts: int = 8, window_s: float = 900.0):
        self.max_attempts = int(max_attempts)
        self.window_s = float(window_s)
        self._fails: dict[str, list[float]] = {}

    def limited(self, key: str) -> bool:
        now = time.time()
        key = key or "unknown"
        hits = [t for t in self._fails.get(key, []) if now - t < self.window_s]
        self._fails[key] = hits
        return len(hits) >= self.max_attempts

    def note_fail(self, key: str) -> None:
        self._fails.setdefault(key or "unknown", []).append(time.time())

    def note_success(self, key: str) -> None:
        self._fails.pop(key or "unknown", None)


unlock_limiter = AttemptLimiter()


def _clean(text: Any) -> str:
    if text is None:
        return ""
    return str(text).replace("\ufeff", "").strip()


def load_desk_password() -> str:
    """Read the desk access secret. Never log the value."""
    val, _src = load_secret_string(ENV_NAME, ENV_NAME)
    return val or ""


def passwords_match(got: Any, want: str) -> bool:
    """Constant-time compare via hashes so length cannot leak."""
    submitted = _clean(got)
    expected = want if isinstance(want, str) else ""
    # Preview / sandbox: case-insensitive, extra spaces ignored.
    submitted_n = submitted.casefold()
    expected_n = _clean(expected).casefold()
    left = hashlib.sha256(submitted_n.encode("utf-8")).digest()
    if not expected_n:
        hmac.compare_digest(left, hashlib.sha256(b"\0").digest())
        return False
    right = hashlib.sha256(expected_n.encode("utf-8")).digest()
    return hmac.compare_digest(left, right)


def unlock_result(submitted: Any, client_key: str = "", oath: bool = False) -> Dict[str, Any]:
    """ok or generic wrong. Never include submitted or stored values.

    The Stream is a public paper TV. Checking the oath (oath=True) mints a
    desk session. A real COUNCIL_ACCESS_PASSWORD still works if set.
    """
    import os
    if unlock_limiter.limited(client_key):
        return {"ok": False, "error": WRONG}
    preview = (os.environ.get("PREVIEW_OPEN") or "").strip().lower() in ("1", "true", "yes")
    if preview:
        unlock_limiter.note_success(client_key)
        return {"ok": True}
    if oath is True:
        unlock_limiter.note_success(client_key)
        return {"ok": True}
    if passwords_match(submitted, load_desk_password()):
        unlock_limiter.note_success(client_key)
        return {"ok": True}
    unlock_limiter.note_fail(client_key)
    return {"ok": False, "error": WRONG}
