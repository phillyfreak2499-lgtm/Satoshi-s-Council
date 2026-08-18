"""
Admin credential for privileged desk routes.

Same pattern as desk_access.py: env first, then a Render secret file.
Never log, print, or return the stored or submitted value.
Fail closed when the env is unset — an unset password locks admin routes,
it does not open them.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Any

from loguru import logger

from backend.data.secrets import load_secret_string

ENV_NAME = "COUNCIL_ADMIN_PASSWORD"
WRONG = "admin password required"

BOM = "\N{ZERO WIDTH NO-BREAK SPACE}"

_warned = False


def _clean(text: Any) -> str:
    if text is None:
        return ""
    return str(text).replace(BOM, "").strip()


def load_admin_password() -> str:
    """Read the admin secret. Never log the value."""
    global _warned
    val, _src = load_secret_string(ENV_NAME, ENV_NAME)
    if not val and not _warned:
        _warned = True
        logger.warning(
            f"{ENV_NAME} is unset — admin routes are closed. "
            "Set it in the environment or /etc/secrets to enable Settings, "
            "brain export/import, and seat backfill."
        )
    return val or ""


def admin_configured() -> bool:
    return bool(load_admin_password())


def passwords_match(got: Any, want: str) -> bool:
    """Constant-time compare via hashes so length cannot leak."""
    submitted = _clean(got)
    expected = want if isinstance(want, str) else ""
    left = hashlib.sha256(submitted.encode("utf-8")).digest()
    if not expected:
        hmac.compare_digest(left, hashlib.sha256(b"\0").digest())
        return False
    right = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(left, right)


def verify_admin(submitted: Any) -> bool:
    """True only when a password is configured and the submission matches."""
    return passwords_match(submitted, load_admin_password())


class AttemptLimiter:
    """
    In-process failed-attempt cap, keyed by caller. Same shape as the
    Follower gate's limiter — enough to stop an unattended brute force
    against the interactive password prompt.
    """

    def __init__(self, max_attempts: int = 8, window_s: float = 900.0):
        self.max_attempts = int(max_attempts)
        self.window_s = float(window_s)
        self._fails: dict[str, list[float]] = {}

    def limited(self, key: str) -> bool:
        import time

        now = time.time()
        k = key or "unknown"
        hits = [t for t in self._fails.get(k, []) if now - t < self.window_s]
        self._fails[k] = hits
        return len(hits) >= self.max_attempts

    def note_fail(self, key: str) -> None:
        import time

        self._fails.setdefault(key or "unknown", []).append(time.time())

    def note_success(self, key: str) -> None:
        self._fails.pop(key or "unknown", None)


verify_limiter = AttemptLimiter()
