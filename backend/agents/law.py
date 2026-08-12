"""
LAW – enforcer bot with productive lockdown.

Rules:
  1. Track consecutive wrong Chair calls.
  2. After LOCK_AFTER_WRONGS wrongs → lockdown (default 1 window, max ~8 min).
  3. On trigger: LET'S FIND OUT post-mortem + weight surgery (once).
  4. During lock: no live paper UP/DOWN, but SHADOW decisions keep learning.
  5. Grade shadows on Kalshi path; early-unlock if the fix proves out.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import time
from loguru import logger

from backend.agents.base import AgentSignal, BaseSpecialist
from backend.agents.roster import display_name
from backend.config import settings


LOCK_AFTER_WRONGS = 2
LOCK_FOR_CALLS = 1          # shorter shield — learning is front-loaded
LOCK_MAX_SECONDS = 8 * 60   # hard time cap even if window doesn't roll
DIAG_WINDOW = 6
SHADOW_WIN_PTS = 2.5        # 1/4-HOLD sized path target for shadows
SHADOW_EARLY_UNLOCK_RIGHTS = 1  # unlock after this many graded-right shadows


class LawBot(BaseSpecialist):
    name = "law"
    category = "law"
    base_weight = 0.0

    def __init__(self):
        super().__init__()
        self.lockdown_remaining: int = 0
        self.find_out_mode: bool = False
        self.wrong_streak: int = 0
        self.last_lock_reason: str = ""
        self.findings: List[str] = []
        self.fixes_applied: List[str] = []
        self._last_settled_id: int = 0
        self._lock_started_at: Optional[str] = None
        self._lock_started_mono: float = 0.0
        self._windows_seen_during_lock: set = set()
        self.post_unlock_strict: int = 0  # first N live calls after unlock use stricter bar

        # Shadow learning state (in-memory; not paper-staked)
        self.shadows: List[Dict[str, Any]] = []
        self.shadow_stats: Dict[str, int] = {
            "open": 0, "right": 0, "wrong": 0, "expired": 0
        }

    def status(self) -> Dict[str, Any]:
        locked = self.is_locked()
        return {
            "agent_name": "law",
            "display_name": "LAW",
            "title": "Enforcer",
            "lockdown": locked,
            "lockdown_remaining": self.lockdown_remaining,
            "find_out_mode": self.find_out_mode and locked,
            "wrong_streak": self.wrong_streak,
            "reason": self.last_lock_reason,
            "findings": self.findings[-8:],
            "fixes": self.fixes_applied[-8:],
            "lock_started_at": self._lock_started_at,
            "shadow": {
                **self.shadow_stats,
                "open_details": [
                    {
                        "direction": s["direction"],
                        "confidence": s["confidence"],
                        "entry": s.get("entry_pct"),
                        "ticker": s.get("ticker"),
                    }
                    for s in self.shadows
                    if s.get("status") == "open"
                ][-5:],
            },
            "post_unlock_strict": self.post_unlock_strict,
        }

    def is_locked(self) -> bool:
        if self.lockdown_remaining <= 0 and not self.find_out_mode:
            return False
        # Time cap
        if self._lock_started_mono and (time.monotonic() - self._lock_started_mono) >= LOCK_MAX_SECONDS:
            self._lift("Lockdown time cap reached")
            return False
        return self.lockdown_remaining > 0 or self.find_out_mode

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_locked():
            sh = self.shadow_stats
            reason = (
                f"LOCKDOWN · {self.lockdown_remaining} window(s) · "
                f"shadow {sh['right']}✓/{sh['wrong']}✗ · "
                f"{self.last_lock_reason or 'repair bay'}"
            )
            return AgentSignal(
                self.name, "WAIT", 95, reason, self.category,
                features={
                    "lockdown": True,
                    "lockdown_remaining": self.lockdown_remaining,
                    "find_out_mode": True,
                    "wrong_streak": self.wrong_streak,
                    "shadow_right": sh["right"],
                    "shadow_wrong": sh["wrong"],
                },
            )
        if self.wrong_streak >= 1:
            return AgentSignal(
                self.name, "WAIT", 40 + self.wrong_streak * 15,
                f"Watching · wrong streak {self.wrong_streak}/{LOCK_AFTER_WRONGS}",
                self.category,
                features={"wrong_streak": self.wrong_streak, "lockdown": False},
            )
        return AgentSignal(
            self.name, "WAIT", 20,
            "Order held · no consecutive faults",
            self.category,
            features={"wrong_streak": 0, "lockdown": False},
        )

    async def evaluate_after_settle(
        self,
        store: Any,
        leader: Any,
        agents: List[Any],
    ) -> Dict[str, Any]:
        recent = await store.recent_settled_calls(limit=20)
        streak = 0
        for row in recent:
            if row.get("correct") == 1:
                break
            if row.get("correct") == 0:
                streak += 1
            else:
                break
        self.wrong_streak = streak

        newest_id = recent[0]["id"] if recent else 0
        new_faults = newest_id > self._last_settled_id and streak >= LOCK_AFTER_WRONGS
        if recent:
            self._last_settled_id = max(self._last_settled_id, newest_id)

        triggered = False
        if new_faults and not self.is_locked():
            self.lockdown_remaining = LOCK_FOR_CALLS
            self.find_out_mode = True
            self._lock_started_at = datetime.now(timezone.utc).isoformat()
            self._lock_started_mono = time.monotonic()
            self._windows_seen_during_lock = set()
            self.shadows = []
            self.shadow_stats = {"open": 0, "right": 0, "wrong": 0, "expired": 0}
            self.last_lock_reason = (
                f"{LOCK_AFTER_WRONGS} wrongs in a row – "
                f"repair bay for {LOCK_FOR_CALLS} window (shadow learning on)"
            )
            triggered = True
            logger.warning(f"LAW: {self.last_lock_reason}")
            report = await self.run_find_out(store, leader, agents, recent)
            self.findings = report.get("findings", [])
            self.fixes_applied = report.get("fixes", [])

        return {
            "triggered": triggered,
            "wrong_streak": self.wrong_streak,
            "lockdown_remaining": self.lockdown_remaining,
            "find_out_mode": self.find_out_mode,
            "shadow": dict(self.shadow_stats),
        }

    def note_window(self, ticker: str | None) -> None:
        if not self.is_locked():
            return
        if not ticker:
            return
        if not self._windows_seen_during_lock:
            self._windows_seen_during_lock.add(ticker)
            return
        if ticker in self._windows_seen_during_lock:
            return
        self._windows_seen_during_lock.add(ticker)
        self.lockdown_remaining = max(0, self.lockdown_remaining - 1)
        logger.info(
            f"LAW: lockdown window consumed ({ticker}) · "
            f"{self.lockdown_remaining} remaining"
        )
        if self.lockdown_remaining <= 0:
            self._lift("Lockdown complete – council restored")

    def _lift(self, reason: str) -> None:
        was = self.find_out_mode or self.lockdown_remaining > 0
        self.lockdown_remaining = 0
        self.find_out_mode = False
        self.last_lock_reason = reason
        if was:
            self.post_unlock_strict = 1  # first live call after unlock is pickier
            logger.info(f"LAW: {reason} · shadow_stats={self.shadow_stats}")

    # ── Shadow learning ──────────────────────────────────────────────

    def record_shadow(
        self,
        direction: str,
        confidence: int,
        up_pct: float | None,
        down_pct: float | None,
        ticker: str | None = None,
        summary: str = "",
    ) -> None:
        """
        Record a shadow decision during lockdown.
        Only directional (UP/DOWN/HOLD) shadows are kept; WAIT is ignored.
        """
        if not self.is_locked():
            return
        d = (direction or "WAIT").upper()
        if d in ("WAIT", "SWAP", ""):
            return
        side = "UP" if "UP" in d else ("DOWN" if "DOWN" in d else None)
        if side is None:
            return
        entry = up_pct if side == "UP" else down_pct
        try:
            entry_f = float(entry) if entry is not None else None
        except (TypeError, ValueError):
            entry_f = None
        if entry_f is None:
            return

        # Debounce: one open shadow per side
        for s in self.shadows:
            if s.get("status") == "open" and s.get("side") == side:
                s["confidence"] = max(int(s.get("confidence") or 0), int(confidence))
                s["last_seen"] = time.monotonic()
                return

        self.shadows.append({
            "direction": d,
            "side": side,
            "confidence": int(confidence),
            "entry_pct": entry_f,
            "peak_pct": entry_f,
            "ticker": ticker,
            "summary": summary[:160],
            "opened_at": time.monotonic(),
            "last_seen": time.monotonic(),
            "status": "open",
            "path_pts": 0.0,
        })
        self.shadow_stats["open"] = sum(1 for s in self.shadows if s["status"] == "open")
        logger.info(f"LAW shadow OPEN {d} @{entry_f:.1f}% conf={confidence}")

    def grade_shadows(self, up_pct: float | None, down_pct: float | None) -> Dict[str, Any]:
        """
        Path-grade open shadows against current Kalshi %.
        RIGHT if favorable side moved >= SHADOW_WIN_PTS from entry.
        No paper PnL — pure learning signal.
        """
        try:
            up = float(up_pct) if up_pct is not None else None
            down = float(down_pct) if down_pct is not None else None
        except (TypeError, ValueError):
            return {"graded": 0}

        graded = 0
        now = time.monotonic()
        for s in self.shadows:
            if s.get("status") != "open":
                continue
            side = s["side"]
            cur = up if side == "UP" else down
            if cur is None:
                continue
            entry = float(s["entry_pct"])
            path = cur - entry
            if path > float(s.get("path_pts") or 0):
                s["path_pts"] = path
                s["peak_pct"] = cur

            # Win
            if path >= SHADOW_WIN_PTS:
                s["status"] = "right"
                s["settled_at"] = now
                self.shadow_stats["right"] += 1
                graded += 1
                logger.info(
                    f"LAW shadow RIGHT {s['direction']} path={path:+.2f}pts "
                    f"(entry {entry:.1f} → {cur:.1f})"
                )
                continue

            # Expire after lock max if never hit
            if (now - float(s["opened_at"])) >= LOCK_MAX_SECONDS:
                s["status"] = "wrong" if path < 0 else "expired"
                s["settled_at"] = now
                if s["status"] == "wrong":
                    self.shadow_stats["wrong"] += 1
                else:
                    self.shadow_stats["expired"] += 1
                graded += 1

        self.shadow_stats["open"] = sum(1 for s in self.shadows if s["status"] == "open")

        # Early unlock: fix validated by shadow rights
        if (
            self.is_locked()
            and self.shadow_stats["right"] >= SHADOW_EARLY_UNLOCK_RIGHTS
            and self.shadow_stats["right"] > self.shadow_stats["wrong"]
        ):
            self._lift(
                f"Early unlock – shadow proved fix "
                f"({self.shadow_stats['right']}✓/{self.shadow_stats['wrong']}✗)"
            )

        return {"graded": graded, "stats": dict(self.shadow_stats)}

    def consume_post_unlock_strict(self) -> bool:
        """Chair asks once: should the next live call use a stricter bar?"""
        if self.post_unlock_strict > 0:
            self.post_unlock_strict -= 1
            return True
        return False

    async def run_find_out(
        self,
        store: Any,
        leader: Any,
        agents: List[Any],
        recent: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        findings: List[str] = []
        fixes: List[str] = []
        wrongs = [r for r in recent if r.get("correct") == 0][:DIAG_WINDOW]
        if not wrongs:
            findings.append("No graded failures in the log yet.")
            return {"findings": findings, "fixes": fixes}

        blame: Dict[str, float] = defaultdict(float)
        credit: Dict[str, float] = defaultdict(float)

        for w in wrongs:
            outcome = w.get("outcome")
            direction = w.get("direction")
            ticker = w.get("ticker") or "?"
            findings.append(f"{ticker}: called {direction}, market went {outcome}")
            votes = w.get("agent_votes") or {}
            if isinstance(votes, str):
                import json
                try:
                    votes = json.loads(votes)
                except Exception:
                    votes = {}
            for name, v in votes.items():
                if name in ("guardian", "law", "leader"):
                    continue
                d = (v or {}).get("direction")
                conf = ((v or {}).get("confidence") or 50) / 100.0
                if d in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD"):
                    base = "UP" if "UP" in d else "DOWN"
                    if base == direction or d == direction:
                        blame[name] += conf
                    if outcome and (base == outcome or d == outcome):
                        credit[name] += conf

        if blame:
            worst = sorted(blame.items(), key=lambda x: -x[1])[:3]
            findings.append(
                "Over-weighted on faults: "
                + ", ".join(f"{display_name(n)} ({s:.1f})" for n, s in worst)
            )
        if credit:
            best = sorted(credit.items(), key=lambda x: -x[1])[:3]
            findings.append(
                "Were right on the misses: "
                + ", ".join(f"{display_name(n)} ({s:.1f})" for n, s in best)
            )

        old_weights = dict(leader.weights)
        new_weights = dict(old_weights)
        for name, score in blame.items():
            if name not in new_weights:
                continue
            penalty = min(0.35, 0.08 + 0.05 * score)
            before = new_weights[name]
            new_weights[name] = max(settings.MIN_WEIGHT, before * (1.0 - penalty))
            if abs(new_weights[name] - before) > 0.002:
                fixes.append(
                    f"{display_name(name)} weight {before:.3f} → {new_weights[name]:.3f} (fault)"
                )
        for name, score in credit.items():
            if name not in new_weights:
                continue
            boost = min(0.25, 0.06 + 0.04 * score)
            before = new_weights[name]
            new_weights[name] = min(settings.MAX_WEIGHT, before * (1.0 + boost))
            if abs(new_weights[name] - before) > 0.002:
                fixes.append(
                    f"{display_name(name)} weight {before:.3f} → {new_weights[name]:.3f} (credit)"
                )

        if new_weights != old_weights:
            leader.update_weights(new_weights)
            for name in new_weights:
                if abs(new_weights[name] - old_weights.get(name, 0)) > 0.002:
                    try:
                        await store.log_weight_change(
                            name,
                            old_weights.get(name, 0),
                            leader.weights.get(name, new_weights[name]),
                            "LAW find-out fix",
                        )
                    except Exception:
                        pass
            fixes.append("Leader weights renormalized after LAW review")
        else:
            fixes.append("No weight shift required – sparse vote data")

        if blame:
            worst_name = max(blame.items(), key=lambda x: x[1])[0]
            for agent in agents:
                if getattr(agent, "name", None) == worst_name and hasattr(agent, "set_health"):
                    agent.set_health(0.55)
                    fixes.append(
                        f"{display_name(worst_name)} health cut to 0.55 for review window"
                    )
                    break

        # Raise Chair cool-down bump slightly during repair
        if hasattr(leader, "cool_down_bump"):
            leader.cool_down_bump = max(float(getattr(leader, "cool_down_bump", 0) or 0), 0.04)
            fixes.append("Chair confluence bump +0.04 during repair")

        logger.info(f"LAW FIND OUT findings={findings} fixes={fixes}")
        return {"findings": findings, "fixes": fixes}


def apply_find_out_to_signals(
    signals: List[AgentSignal],
    law: LawBot,
) -> List[AgentSignal]:
    """
    Annotate signals during lockdown for the debate UI.
    Preserves prior direction in features so shadow synthesis can still read it.
    """
    if not law.is_locked():
        return signals

    findings_hint = law.findings[0] if law.findings else "reviewing last faults"
    out: List[AgentSignal] = []
    for s in signals:
        if s.agent_name in ("law",):
            out.append(s)
            continue
        feats = dict(s.features or {})
        feats["find_out_mode"] = True
        feats["prior_direction"] = s.direction
        feats["prior_confidence"] = s.confidence
        # Keep original direction for shadow path; mark muted so live Chair ignores
        diag = AgentSignal(
            agent_name=s.agent_name,
            direction=s.direction,  # preserve for shadow synthesis
            confidence=s.confidence,
            reasoning=(
                f"SHADOW · was {s.direction} {s.confidence}% · "
                f"live suspended · {findings_hint}"
            ),
            category=s.category,
            features=feats,
            muted=True,  # live vote muted; shadow still uses direction
            parent=s.parent,
            subs=s.subs,
        )
        out.append(diag)
    return out
