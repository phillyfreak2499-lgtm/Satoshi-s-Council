"""
Leader ranking for the Round Table.

SATOSHI is rank 0, fixed in the absolute center, and is never scored, ranked,
or moved. Only the four movable leaders are ranked:

    VITALIK · ARES · RAIJIN · ORACLE

Scoring per settled decision, from the leader's lean vs SATOSHI's final call
and whether that call was correct:

    +2.0   leaned with Satoshi, call correct
    -1.0   leaned with Satoshi, call wrong
    +0.5   both said WAIT
    -1.5   disagreed with Satoshi, Satoshi correct
    +1.0   disagreed with Satoshi, Satoshi wrong
     0.0   no vote / muted

Rolling window of the last 30 settled decisions, decayed by 0.94 ^ age so
newer results weigh more (age 0 = newest). Then:

    +0.1   per vote cast inside the window (participation)
    -0.75  if the last 4 directional leans were all wrong (wrong streak)

Rank 1 = highest score = closest seat to Satoshi. Rank 4 = farthest.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from loguru import logger

# Fixed center. Never scored, never ranked, never moved.
CENTER_LEADER = "satoshi"
# Ranked and seat-mobile, in default (tie-break) order.
MOVABLE_LEADERS = ("vitalik", "ares", "raijin", "oracle")

WINDOW = 30
DECAY = 0.94
PARTICIPATION_BONUS = 0.1
WRONG_STREAK_PENALTY = -0.75
WRONG_STREAK_LEN = 4

PTS_WITH_CORRECT = 2.0
PTS_WITH_WRONG = -1.0
PTS_BOTH_WAIT = 0.5
PTS_AGAINST_SATOSHI_CORRECT = -1.5
PTS_AGAINST_SATOSHI_WRONG = 1.0
PTS_NO_VOTE = 0.0

WAIT = "WAIT"


# Internal keys are the source of truth. Display labels are accepted too, so
# a lean that round-tripped through the UI still scores correctly.
#   HOLD is the display label for UP_HOLD, so it normalizes to UP.
#   REDUCE is the display label for both DOWN and DOWN_HOLD.
# Both the current research wording and the older labels, so a lean that
# round-tripped through the UI or an older log still scores correctly.
_UP_LEANS = ("UP", "UP_HOLD", "BUY", "BUY ZONE", "BUY_ZONE", "HOLD",
             "ACCUMULATE", "MAINTAIN")
_DOWN_LEANS = ("DOWN", "DOWN_HOLD", "REDUCE", "SELL")
_WAIT_LEANS = ("WAIT", "SIT", "SWAP", "REBALANCE", "STAND DOWN", "STAND_DOWN")
# Explicitly "no vote / muted" — scores 0, and does not count as participation.
_NO_VOTE = ("", "NONE", "NULL", "MUTED", "EMPTY", "—", "-", "N/A")


def _norm_lean(raw: Any) -> Optional[str]:
    """UP / DOWN / WAIT, or None for no vote / muted."""
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if s in _NO_VOTE:
        return None
    if s in _UP_LEANS:
        return "UP"
    if s in _DOWN_LEANS:
        return "DOWN"
    if s in _WAIT_LEANS:
        return WAIT
    return None


def score_one(lean: Optional[str], satoshi: Optional[str], correct: Optional[bool]) -> float:
    """Points for a single settled decision, before decay."""
    if lean is None:
        return PTS_NO_VOTE
    sat = _norm_lean(satoshi)
    if lean == WAIT and sat == WAIT:
        return PTS_BOTH_WAIT
    if sat is None or correct is None:
        return PTS_NO_VOTE
    agreed = lean == sat
    if agreed:
        # A shared WAIT is handled above; this is a shared directional call.
        return PTS_WITH_CORRECT if correct else PTS_WITH_WRONG
    return PTS_AGAINST_SATOSHI_CORRECT if correct else PTS_AGAINST_SATOSHI_WRONG


def leader_was_right(lean: Optional[str], satoshi: Optional[str], correct: Optional[bool]) -> Optional[bool]:
    """
    Was this leader's directional lean vindicated? None when the lean was
    not directional or the outcome is unknown.
    """
    if lean is None or lean == WAIT or correct is None:
        return None
    sat = _norm_lean(satoshi)
    if sat is None or sat == WAIT:
        return None
    return bool(correct) if lean == sat else (not correct)


@dataclass
class LeaderRecord:
    """Rolling window + derived standing for one movable leader."""

    leader: str
    results: List[Dict[str, Any]] = field(default_factory=list)
    score: float = 0.0
    rank: int = 0
    wrong_streak: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "leader": self.leader,
            "results": list(self.results[-WINDOW:]),
            "score": round(float(self.score), 4),
            "rank": int(self.rank),
            "wrong_streak": int(self.wrong_streak),
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "LeaderRecord":
        rows = raw.get("results")
        results = [r for r in rows if isinstance(r, dict)][-WINDOW:] if isinstance(rows, list) else []
        rec = cls(leader=str(raw.get("leader") or ""))
        rec.results = results
        try:
            rec.score = float(raw.get("score") or 0.0)
        except (TypeError, ValueError):
            rec.score = 0.0
        try:
            rec.rank = int(raw.get("rank") or 0)
        except (TypeError, ValueError):
            rec.rank = 0
        try:
            rec.wrong_streak = int(raw.get("wrong_streak") or 0)
        except (TypeError, ValueError):
            rec.wrong_streak = 0
        return rec

    # ── scoring ──────────────────────────────────────────────────────
    def compute_score(self) -> float:
        """Decayed window score + participation bonus + wrong-streak penalty."""
        window = self.results[-WINDOW:]
        total = 0.0
        votes = 0
        # age 0 = newest, so walk the window backwards
        for age, row in enumerate(reversed(window)):
            lean = _norm_lean(row.get("lean"))
            if lean is not None:
                votes += 1
            pts = score_one(lean, row.get("satoshi"), row.get("correct"))
            total += pts * (DECAY ** age)
        total += PARTICIPATION_BONUS * votes
        if self.compute_wrong_streak() >= WRONG_STREAK_LEN:
            total += WRONG_STREAK_PENALTY
        return total

    def compute_wrong_streak(self) -> int:
        """Consecutive wrong directional leans, newest first. WAIT is skipped."""
        streak = 0
        for row in reversed(self.results):
            right = leader_was_right(_norm_lean(row.get("lean")), row.get("satoshi"), row.get("correct"))
            if right is None:
                continue  # not a directional lean — does not break or extend
            if right:
                break
            streak += 1
        return streak

    def refresh(self) -> None:
        self.results = self.results[-WINDOW:]
        self.wrong_streak = self.compute_wrong_streak()
        self.score = self.compute_score()


def _seat_note(leader: str, was: int, now: int, rec: "LeaderRecord") -> str:
    """
    One restrained line about a seat change. States what happened and why,
    without commentary. Satoshi never appears here — he does not move.
    """
    who = str(leader or "").upper()
    if now < was:
        if now == 1:
            return f"{who} earned the nearest seat"
        return f"{who} earned the nearer seat"
    if rec.wrong_streak >= WRONG_STREAK_LEN:
        return f"{who} dropped after a wrong streak"
    if now == len(MOVABLE_LEADERS):
        return f"{who} dropped to the far seat"
    return f"{who} dropped after weak confluence"


class LeaderRankBook:
    """
    Persistent standings for the four movable leaders.

    Satoshi is never added here. Ranks are recalculated after every settled
    decision; callers can diff `moved` to decide whether to animate a seat.
    """

    def __init__(self, path: Path | None = None, *, now: Callable[[], float] | None = None):
        self.path = path
        self._now = now
        self._lock = threading.RLock()
        self.records: Dict[str, LeaderRecord] = {
            name: LeaderRecord(leader=name) for name in MOVABLE_LEADERS
        }
        # Short human notes for the last few seat changes, so the table
        # visibly reacts when a leader earns or loses ground.
        self.notes: List[Dict[str, Any]] = []
        self._load()
        self._rerank()

    # ── persistence ──────────────────────────────────────────────────
    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Leader rank book load failed: {e}")
            return
        notes = raw.get("notes") if isinstance(raw, dict) else None
        if isinstance(notes, list):
            self.notes = [n for n in notes if isinstance(n, dict)][-12:]
        rows = raw.get("leaders") if isinstance(raw, dict) else None
        if not isinstance(rows, dict):
            return
        for name in MOVABLE_LEADERS:
            item = rows.get(name)
            if isinstance(item, dict):
                rec = LeaderRecord.from_dict({**item, "leader": name})
                rec.refresh()
                self.records[name] = rec

    def save(self) -> None:
        if self.path is None:
            return
        with self._lock:
            payload = {
                "version": 1,
                "window": WINDOW,
                "decay": DECAY,
                "center": CENTER_LEADER,
                "notes": list(self.notes[-12:]),
                "leaders": {n: r.to_dict() for n, r in self.records.items()},
            }
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            except OSError as e:
                logger.warning(f"Leader rank book save failed: {e}")

    # ── updates ──────────────────────────────────────────────────────
    def record_settled(
        self,
        *,
        leans: Dict[str, Any],
        satoshi: Any,
        correct: Optional[bool],
        ref: Any = None,
    ) -> Dict[str, Any]:
        """
        Append one settled decision and recalculate.

        leans   — {"vitalik": "UP", "ares": None, ...}. Missing or None = no
                  vote / muted, which scores 0.
        satoshi — Satoshi's final call for that decision.
        correct — whether Satoshi's call was right. None when ungraded, which
                  scores 0 for everyone except a shared WAIT.

        Returns the standings, plus `moved` — the leaders whose rank changed.
        """
        sat = _norm_lean(satoshi)
        with self._lock:
            before = {n: r.rank for n, r in self.records.items()}
            for name in MOVABLE_LEADERS:
                rec = self.records[name]
                rec.results.append({
                    "lean": _norm_lean((leans or {}).get(name)),
                    "satoshi": sat,
                    "correct": None if correct is None else bool(correct),
                    "ref": str(ref) if ref is not None else None,
                })
                rec.results = rec.results[-WINDOW:]
            self._rerank()
            moved = [n for n, r in self.records.items() if before.get(n) != r.rank]
            for name in moved:
                was, now = before.get(name), self.records[name].rank
                if not was:
                    continue
                self.notes.append({
                    "leader": name,
                    "from": was,
                    "to": now,
                    "up": now < was,
                    "text": _seat_note(name, was, now, self.records[name]),
                })
            self.notes = self.notes[-12:]
            self.save()
            out = self.standings()
            out["moved"] = moved
            return out

    def _rerank(self) -> None:
        """Score, sort, assign seats. Rank 1 = closest to Satoshi."""
        for rec in self.records.values():
            rec.refresh()
        order = sorted(
            MOVABLE_LEADERS,
            key=lambda n: (-self.records[n].score, MOVABLE_LEADERS.index(n)),
        )
        for seat, name in enumerate(order, start=1):
            self.records[name].rank = seat

    def reset(self) -> Dict[str, Any]:
        with self._lock:
            self.records = {n: LeaderRecord(leader=n) for n in MOVABLE_LEADERS}
            self.notes = []
            self._rerank()
            self.save()
            return self.standings()

    # ── reads ────────────────────────────────────────────────────────
    def rank_of(self, leader: str) -> int:
        """0 for Satoshi (center, immovable); 1-4 otherwise."""
        name = str(leader or "").strip().lower()
        if name == CENTER_LEADER:
            return 0
        rec = self.records.get(name)
        return int(rec.rank) if rec else 0

    def standings(self) -> Dict[str, Any]:
        with self._lock:
            rows = [
                {
                    "leader": name,
                    "rank": rec.rank,
                    "score": round(float(rec.score), 3),
                    "wrong_streak": int(rec.wrong_streak),
                    "votes": sum(1 for r in rec.results if _norm_lean(r.get("lean")) is not None),
                    "n": len(rec.results),
                }
                for name, rec in self.records.items()
            ]
            rows.sort(key=lambda r: r["rank"])
            return {
                "center": CENTER_LEADER,
                "center_rank": 0,
                "center_fixed": True,
                "notes": list(self.notes[-6:]),
                "window": WINDOW,
                "decay": DECAY,
                "ranked": rows,
                "order": [r["leader"] for r in rows],
            }


# ── Process-wide singleton ────────────────────────────────────────────
# main.py serves it and the council writes to it, so both must share one
# instance and one file on the persistent disk.
_BOOK: Optional[LeaderRankBook] = None


def rank_book() -> LeaderRankBook:
    """The shared rank book, stored under DATA_DIR."""
    global _BOOK
    if _BOOK is None:
        from backend.config import settings

        root = Path(getattr(settings, "DATA_DIR", None) or "./data")
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        _BOOK = LeaderRankBook(root / "leader-ranks.json")
    return _BOOK
