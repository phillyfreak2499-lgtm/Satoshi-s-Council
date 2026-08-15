"""
Follower unlock + live arming.

Lock 1 = existing admin password (same as Settings).
Locks 2–3 = FOLLOWER_PASSWORD_2 / FOLLOWER_PASSWORD_3 from env (or secret file).
Never log or return the values. Fail closed if 2/3 are unset.

The public document must not contain Follower HTML/JS. A session cookie
(HttpOnly, Secure, SameSite) is required to fetch the bundle.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.data.secrets import load_secret_string

WRONG = "wrong password"
COOKIE = "council_follower"
LIVE_WORD = "LIVE"
CT = ZoneInfo("America/Chicago")

IDLE_S = 8 * 60.0
ARM_DELAY_S = 8.0
MAX_ATTEMPTS = 5
WINDOW_S = 900.0

DEFAULT_CAPS: Dict[str, float] = {
    "max_stake": 25.0,
    "max_daily_loss": 100.0,
    "max_contracts": 4.0,
    "last_n_minutes_cutoff": 15.0,
}

_AUDIT_DROP = (
    "password", "passwd", "secret", "token", "cookie",
    "p1", "p2", "p3", "lock1", "lock2", "lock3",
    "confirm", "confirm_first", "authorization",
)


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


def hash_ip(ip: str) -> str:
    raw = (ip or "unknown").encode("utf-8", errors="replace")
    return hashlib.sha256(raw).hexdigest()[:16]


def confirm_live(word: Any) -> bool:
    return str(word or "").strip().upper() == LIVE_WORD


def empty_lifetime(lifetime_n: Any) -> bool:
    """Do not arm Live or size off an empty lifetime (n=0 until 1062/1063 settle)."""
    try:
        return int(lifetime_n or 0) <= 0
    except (TypeError, ValueError):
        return True


def _ct_day(now: float | None = None) -> str:
    if now is None:
        return datetime.now(CT).strftime("%Y-%m-%d")
    return datetime.fromtimestamp(float(now), CT).strftime("%Y-%m-%d")


def sanitize_audit(payload: Dict[str, Any] | None) -> Dict[str, Any]:
    """Drop password material and oversized values. Never echo secrets."""
    if not isinstance(payload, dict):
        return {}
    out: Dict[str, Any] = {}
    for k, v in payload.items():
        key = str(k).strip().lower()
        if key in _AUDIT_DROP or "password" in key or "secret" in key:
            continue
        if isinstance(v, (str, bytes)) and len(v) > 200:
            continue
        if isinstance(v, (bool, int, float)) or v is None:
            out[str(k)] = v
        elif isinstance(v, str):
            out[str(k)] = v[:120]
        else:
            out[str(k)] = str(v)[:80]
    return out


@dataclass
class FollowerSession:
    created: float
    last_seen: float
    live: bool = False
    arm_ready_at: float = 0.0
    first_live_ok: bool = False


@dataclass
class DayBook:
    day: str = ""
    risk: float = 0.0
    contracts: int = 0
    loss: float = 0.0


class FollowerAudit:
    def __init__(self, path: Path | None = None, *, now: Callable[[], float] | None = None):
        self.path = path
        self._now = now or time.time
        self._lock = threading.Lock()
        self.memory: list[dict] = []

    def write(self, event: str, **fields: Any) -> dict:
        rec = sanitize_audit(fields)
        rec["event"] = str(event or "note")[:40]
        rec["ts"] = float(self._now())
        rec.pop("p1", None)
        rec.pop("p2", None)
        rec.pop("p3", None)
        with self._lock:
            self.memory.append(rec)
            if len(self.memory) > 400:
                self.memory = self.memory[-300:]
            if self.path is not None:
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    with self.path.open("a", encoding="utf-8") as fh:
                        fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
                except OSError:
                    pass
        return rec

    def recent(self, limit: int = 80) -> list[dict]:
        n = max(1, min(200, int(limit)))
        return list(self.memory[-n:])


class FollowerRuntime:
    """Server-side caps + daily book. Not part of public settings."""

    def __init__(self, path: Path | None = None, *, now: Callable[[], float] | None = None):
        self.path = path
        self._now = now or time.time
        self.caps = dict(DEFAULT_CAPS)
        self.book = DayBook(day=_ct_day(self._now()))
        self._load()

    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        caps = raw.get("caps") if isinstance(raw.get("caps"), dict) else raw
        self.caps = _sanitize_caps(caps, self.caps)
        book = raw.get("book") if isinstance(raw.get("book"), dict) else {}
        self.book = DayBook(
            day=str(book.get("day") or ""),
            risk=float(book.get("risk") or 0.0),
            contracts=int(book.get("contracts") or 0),
            loss=float(book.get("loss") or 0.0),
        )
        self.roll()

    def save(self) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({
                "caps": self.caps,
                "book": {
                    "day": self.book.day,
                    "risk": self.book.risk,
                    "contracts": self.book.contracts,
                    "loss": self.book.loss,
                },
            }, indent=2), encoding="utf-8")
        except OSError:
            pass

    def roll(self) -> None:
        today = _ct_day(self._now())
        if self.book.day != today:
            self.book = DayBook(day=today)

    def snapshot(self) -> dict:
        self.roll()
        return {
            "caps": dict(self.caps),
            "book": {
                "day": self.book.day,
                "risk": self.book.risk,
                "contracts": self.book.contracts,
                "loss": self.book.loss,
            },
        }

    def record_accept(self, stake: float, contracts: int) -> None:
        self.roll()
        self.book.risk += max(0.0, float(stake))
        self.book.contracts += max(0, int(contracts))
        self.save()


def _sanitize_caps(patch: Dict[str, Any], base: Dict[str, float] | None = None) -> Dict[str, float]:
    out = dict(base or DEFAULT_CAPS)
    if not isinstance(patch, dict):
        return out
    if "max_stake" in patch:
        try:
            out["max_stake"] = max(0.0, min(10000.0, float(patch["max_stake"])))
        except (TypeError, ValueError):
            pass
    if "max_daily_loss" in patch:
        try:
            out["max_daily_loss"] = max(0.0, min(100000.0, float(patch["max_daily_loss"])))
        except (TypeError, ValueError):
            pass
    if "max_contracts" in patch:
        try:
            out["max_contracts"] = max(0.0, min(100.0, float(patch["max_contracts"])))
        except (TypeError, ValueError):
            pass
    if "last_n_minutes_cutoff" in patch:
        try:
            out["last_n_minutes_cutoff"] = max(0.0, min(60.0, float(patch["last_n_minutes_cutoff"])))
        except (TypeError, ValueError):
            pass
    return out


class FollowerGate:
    def __init__(
        self,
        admin_password: str,
        *,
        max_attempts: int = MAX_ATTEMPTS,
        window_s: float = WINDOW_S,
        idle_s: float = IDLE_S,
        arm_delay_s: float = ARM_DELAY_S,
        now: Callable[[], float] | None = None,
        load_p2: Callable[[], str] | None = None,
        load_p3: Callable[[], str] | None = None,
        audit: FollowerAudit | None = None,
        runtime: FollowerRuntime | None = None,
        ping: Callable[[str], None] | None = None,
    ):
        self._admin = admin_password if isinstance(admin_password, str) else ""
        self.max_attempts = int(max_attempts)
        self.window_s = float(window_s)
        self.idle_s = float(idle_s)
        self.arm_delay_s = float(arm_delay_s)
        self._now = now or time.time
        self._load_p2 = load_p2 or (lambda: load_follower_lock("FOLLOWER_PASSWORD_2"))
        self._load_p3 = load_p3 or (lambda: load_follower_lock("FOLLOWER_PASSWORD_3"))
        self._fails: dict[str, list[float]] = {}
        self._sessions: dict[str, FollowerSession] = {}
        self.audit = audit or FollowerAudit()
        self.runtime = runtime or FollowerRuntime()
        self._ping = ping

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

    def unlock(self, ip: str, p1: str, p2: str, p3: str) -> Tuple[bool, str, Optional[str], str]:
        """
        Returns (ok, public_error, token, audit_reason).
        public_error is always WRONG on failure — never which lock, never cooldown.
        """
        ip_h = hash_ip(ip)
        if self.rate_limited(ip):
            self.audit.write("unlock", ok=False, reason="rate_limited", ip=ip_h)
            return False, WRONG, None, "rate_limited"
        if not self.verify(p1, p2, p3):
            self.note_fail(ip)
            self.audit.write("unlock", ok=False, reason="wrong", ip=ip_h)
            return False, WRONG, None, "wrong"
        self.note_success(ip)
        token = secrets.token_urlsafe(32)
        now = float(self._now())
        self._sessions[token] = FollowerSession(created=now, last_seen=now)
        self.audit.write("unlock", ok=True, reason="ok", ip=ip_h)
        self._fire_ping("follower_unlocked")
        return True, "", token, "ok"

    def _get(self, token: str | None) -> Optional[FollowerSession]:
        if not token:
            return None
        sess = self._sessions.get(token)
        if sess is None:
            return None
        now = float(self._now())
        if now - float(sess.last_seen) >= self.idle_s:
            was_live = bool(sess.live)
            self._sessions.pop(token, None)
            self.audit.write("idle_lock", ok=True, live_was=was_live)
            if was_live:
                self._fire_ping("live_off")
            return None
        return sess

    def session_ok(self, token: str | None) -> bool:
        return self._get(token) is not None

    def touch(self, token: str | None) -> Optional[FollowerSession]:
        sess = self._get(token)
        if sess is None:
            return None
        sess.last_seen = float(self._now())
        return sess

    def revoke(self, token: str | None) -> None:
        if not token:
            return
        sess = self._sessions.pop(token, None)
        if sess and sess.live:
            self.audit.write("lock", live_was=True)
            self._fire_ping("live_off")

    def session_view(self, token: str | None) -> Optional[dict]:
        sess = self.touch(token)
        if sess is None:
            return None
        now = float(self._now())
        armed = bool(sess.live and now >= float(sess.arm_ready_at or 0.0))
        return {
            "ok": True,
            "live": bool(sess.live),
            "armed": armed,
            "arm_wait_s": max(0.0, float(sess.arm_ready_at or 0.0) - now) if sess.live else 0.0,
            "first_live_ok": bool(sess.first_live_ok),
            "idle_s": self.idle_s,
            "idle_left_s": max(0.0, self.idle_s - (now - float(sess.last_seen))),
            "runtime": self.runtime.snapshot(),
        }

    def set_live(
        self,
        token: str | None,
        confirm: Any,
        *,
        on: bool,
        lifetime_n: Any = 0,
    ) -> Tuple[bool, str, Optional[dict]]:
        sess = self.touch(token)
        if sess is None:
            return False, "session", None
        if on:
            if empty_lifetime(lifetime_n):
                self.audit.write("live", ok=False, reason="empty_lifetime", on=True)
                view = self.session_view(token)
                if view:
                    view["live"] = False
                    view["armed"] = False
                    view["refuse"] = "empty_lifetime"
                return False, "empty_lifetime", view
            if not confirm_live(confirm):
                self.audit.write("live", ok=False, reason="confirm", on=True)
                return False, "confirm", self.session_view(token)
            if not sess.live:
                sess.live = True
                sess.arm_ready_at = float(self._now()) + self.arm_delay_s
                sess.first_live_ok = False
                self.audit.write("live", ok=True, on=True)
                self._fire_ping("live_on")
            return True, "", self.session_view(token)
        if sess.live:
            sess.live = False
            sess.arm_ready_at = 0.0
            sess.first_live_ok = False
            self.audit.write("live", ok=True, on=False)
            self._fire_ping("live_off")
        return True, "", self.session_view(token)

    def live_off(self, token: str | None) -> None:
        self.set_live(token, "OFF", on=False)

    def evaluate_order(
        self,
        token: str | None,
        intent: Dict[str, Any],
        world: Dict[str, Any],
        *,
        commit: bool = True,
        lifetime_n: Any = None,
    ) -> dict:
        """
        Server-side refuse. Live cannot bypass LAW / huddle / sick-feed / caps.
        Does not place a Kalshi order — routing is a separate step after accept.
        """
        sess = self.touch(token)
        want_live = bool(intent.get("live"))
        rec = {
            "accepted": False,
            "routed": False,
            "live": want_live,
            "refuse": "session",
            "asset": _asset(intent.get("asset")),
            "side": _side(intent.get("side")),
            "stake": _stake(intent.get("stake")),
            "contracts": _contracts(intent.get("contracts")),
        }
        if sess is None:
            self.audit.write("order", **rec)
            return rec

        if lifetime_n is None:
            lifetime_n = world.get("lifetime_n", 0) if isinstance(world, dict) else 0
        if want_live and empty_lifetime(lifetime_n):
            rec["refuse"] = "empty_lifetime"
            rec["live"] = False
            self.audit.write("order", **rec)
            return rec

        if rec["side"] is None or rec["asset"] is None:
            rec["refuse"] = "intent"
            self.audit.write("order", **rec)
            return rec

        world = world if isinstance(world, dict) else {}
        if bool(world.get("law_locked")):
            rec["refuse"] = "law"
            self.audit.write("order", **rec)
            return rec
        if bool(world.get("huddle")):
            rec["refuse"] = "huddle"
            self.audit.write("order", **rec)
            return rec
        if bool(world.get("sick_feed")):
            rec["refuse"] = "sick_feed"
            self.audit.write("order", **rec)
            return rec

        caps = self.runtime.snapshot()["caps"]
        book = self.runtime.snapshot()["book"]
        if rec["stake"] > float(caps["max_stake"]):
            rec["refuse"] = "caps"
            self.audit.write("order", **rec)
            return rec
        if book["loss"] >= float(caps["max_daily_loss"]) or (
            book["risk"] + rec["stake"] > float(caps["max_daily_loss"])
        ):
            rec["refuse"] = "caps"
            self.audit.write("order", **rec)
            return rec
        if book["contracts"] + rec["contracts"] > float(caps["max_contracts"]):
            rec["refuse"] = "caps"
            self.audit.write("order", **rec)
            return rec

        mins_left = world.get("mins_left")
        cutoff = float(caps["last_n_minutes_cutoff"])
        try:
            ml = float(mins_left) if mins_left is not None else None
        except (TypeError, ValueError):
            ml = None
        if ml is None or ml <= cutoff:
            rec["refuse"] = "caps"
            self.audit.write("order", **rec)
            return rec

        if want_live:
            now = float(self._now())
            if not sess.live:
                rec["refuse"] = "live_off"
                self.audit.write("order", **rec)
                return rec
            if now < float(sess.arm_ready_at or 0.0):
                rec["refuse"] = "arm"
                self.audit.write("order", **rec)
                return rec
            if not sess.first_live_ok and not confirm_live(intent.get("confirm_first") or intent.get("confirm")):
                rec["refuse"] = "confirm"
                self.audit.write("order", **rec)
                return rec
            sess.first_live_ok = True

        if commit:
            self.runtime.record_accept(rec["stake"], rec["contracts"])
        rec["accepted"] = True
        rec["refuse"] = ""
        rec["routed"] = False
        self.audit.write("order", **rec)
        return rec

    def _fire_ping(self, event: str) -> None:
        if not self._ping:
            return
        try:
            self._ping(str(event))
        except Exception:
            pass


def _asset(raw: Any) -> Optional[str]:
    a = str(raw or "").strip().lower()
    if a in ("btc", "bitcoin"):
        return "btc"
    if a in ("eth", "ethereum"):
        return "eth"
    return None


def _side(raw: Any) -> Optional[str]:
    s = str(raw or "").strip().upper()
    return s if s in ("UP", "DOWN") else None


def _stake(raw: Any) -> float:
    try:
        return max(0.0, min(10000.0, float(raw)))
    except (TypeError, ValueError):
        return 0.0


def _contracts(raw: Any) -> int:
    try:
        return max(1, min(100, int(raw)))
    except (TypeError, ValueError):
        return 1
