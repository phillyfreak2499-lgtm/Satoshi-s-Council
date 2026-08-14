"""
Follower unlock: three sequential passwords, verified together.

Lock 1 = existing admin password (same as Settings).
Locks 2–3 = FOLLOWER_PASSWORD_2 / FOLLOWER_PASSWORD_3 from env (or secret file).
Never log or return the values. Fail closed if 2/3 are unset.
"""
from __future__ import annotations

import hmac
import secrets
import time
from typing import Callable, Optional, Tuple

from backend.data.secrets import load_secret_string

WRONG = "wrong password"
LATER = "try again later"
COOKIE = "council_follower"


def _cmp(got: str, want: str) -> bool:
    """Constant-ish compare. Empty want always fails (fail closed)."""
    a = got if isinstance(got, str) else ""
    b = want if isinstance(want, str) else ""
    if not b:
        try:
            hmac.compare_digest(a.encode("utf-8"), b"\0")
        except Exception:
            pass
        return False
    try:
        return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
    except Exception:
        return False


def load_follower_lock(env_name: str) -> str:
    """Read a follower lock from env. Never log the value."""
    val, _src = load_secret_string(env_name, env_name)
    return val or ""


class FollowerGate:
    def __init__(
        self,
        admin_password: str,
        *,
        max_attempts: int = 5,
        window_s: float = 900.0,
        session_ttl_s: float = 12 * 3600.0,
        now: Callable[[], float] | None = None,
        load_p2: Callable[[], str] | None = None,
        load_p3: Callable[[], str] | None = None,
    ):
        self._admin = admin_password if isinstance(admin_password, str) else ""
        self.max_attempts = int(max_attempts)
        self.window_s = float(window_s)
        self.session_ttl_s = float(session_ttl_s)
        self._now = now or time.time
        self._load_p2 = load_p2 or (lambda: load_follower_lock("FOLLOWER_PASSWORD_2"))
        self._load_p3 = load_p3 or (lambda: load_follower_lock("FOLLOWER_PASSWORD_3"))
        self._fails: dict[str, list[float]] = {}
        self._sessions: dict[str, float] = {}

    def rate_limited(self, ip: str) -> bool:
        now = float(self._now())
        key = ip or "unknown"
        hits = [t for t in self._fails.get(key, []) if now - t < self.window_s]
        self._fails[key] = hits
        return len(hits) >= self.max_attempts

    def note_fail(self, ip: str) -> None:
        key = ip or "unknown"
        self._fails.setdefault(key, []).append(float(self._now()))

    def note_success(self, ip: str) -> None:
        self._fails.pop(ip or "unknown", None)

    def verify(self, p1: str, p2: str, p3: str) -> bool:
        """Check all three. Do not say which failed."""
        ok1 = _cmp(p1, self._admin)
        ok2 = _cmp(p2, self._load_p2())
        ok3 = _cmp(p3, self._load_p3())
        return bool(ok1 and ok2 and ok3)

    def unlock(self, ip: str, p1: str, p2: str, p3: str) -> Tuple[bool, str, Optional[str]]:
        if self.rate_limited(ip):
            return False, LATER, None
        if not self.verify(p1, p2, p3):
            self.note_fail(ip)
            return False, WRONG, None
        self.note_success(ip)
        token = secrets.token_urlsafe(32)
        self._sessions[token] = float(self._now()) + self.session_ttl_s
        return True, "", token

    def session_ok(self, token: str | None) -> bool:
        if not token:
            return False
        exp = self._sessions.get(token)
        if exp is None:
            return False
        if float(self._now()) >= float(exp):
            self._sessions.pop(token, None)
            return False
        return True

    def revoke(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)
