"""
Chair entry → mid → final lock methods.

MERGE into backend/agents/leader.py:
  1. Replace the old _locked_* fields in __init__ with the fields below
  2. Replace _clear_window_lock / _set_window_lock / _lock_blocks_opposite
     with the methods in this file
  3. Replace the "Per-window lock" block in synthesize() with apply_entry_mid_final()

Rules (per Kalshi ticker / 15m window):
  - ENTRY: first firm UP/DOWN. Captures entry_up_pct as the path baseline.
  - MID: at most one revision while mins_left in (5, 10]. Needs hysteresis.
  - FINAL: at most one revision while mins_left <= 5. Needs hysteresis.
  - Max 2 direction changes total.
  - Graded call = final or mid or entry (latest set).
  - Path tally always uses entry_up_pct.
"""
from __future__ import annotations
from typing import Any, Dict, Optional, Tuple
import time
from backend.config import settings


# ── fields to put on Leader.__init__ ────────────────────────────────
# self._em_ticker: Optional[str] = None
# self._entry_dir: Optional[str] = None
# self._entry_conf: int = 0
# self._entry_score: float = 0.0
# self._entry_up_pct: Optional[float] = None
# self._entry_at: float = 0.0
# self._mid_dir: Optional[str] = None
# self._mid_conf: int = 0
# self._mid_at: float = 0.0
# self._final_dir: Optional[str] = None
# self._final_conf: int = 0
# self._final_at: float = 0.0
# self._revisions_used: int = 0


def _side(direction: str) -> Optional[str]:
    if direction in ("UP", "UP_HOLD"):
        return "UP"
    if direction in ("DOWN", "DOWN_HOLD"):
        return "DOWN"
    return None


class EntryMidFinalMixin:
    """Mixin-style methods for Leader. Copy onto Leader class."""

    def _clear_window_lock(self) -> None:
        self._em_ticker = None
        self._entry_dir = None
        self._entry_conf = 0
        self._entry_score = 0.0
        self._entry_up_pct = None
        self._entry_at = 0.0
        self._mid_dir = None
        self._mid_conf = 0
        self._mid_at = 0.0
        self._final_dir = None
        self._final_conf = 0
        self._final_at = 0.0
        self._revisions_used = 0
        # backward compat aliases
        self._locked_ticker = None
        self._locked_dir = None
        self._locked_conf = 0
        self._locked_score = 0.0
        self._locked_at = 0.0

    def _active_dir(self) -> Optional[str]:
        return self._final_dir or self._mid_dir or self._entry_dir

    def _active_conf(self) -> int:
        if self._final_dir:
            return int(self._final_conf)
        if self._mid_dir:
            return int(self._mid_conf)
        return int(self._entry_conf or 0)

    def _hysteresis_allows(
        self,
        new_dir: str,
        new_conf: int,
        new_score: float,
    ) -> Tuple[bool, str]:
        """Can we revise away from the active lock?"""
        active = self._active_dir()
        if not active or new_dir == active:
            return True, ""
        hysteresis = float(getattr(settings, "HYSTERESIS_BAND", 14))
        min_delta = float(getattr(settings, "FLIP_MIN_CONF_DELTA", 18))
        min_gap = float(getattr(settings, "FLIP_MIN_GAP_SEC", 90.0))
        locked_conf = self._active_conf()
        locked_at = self._final_at or self._mid_at or self._entry_at or 0.0
        age = time.time() - locked_at
        conf_ok = new_conf >= (locked_conf + hysteresis)
        delta_ok = new_conf >= (locked_conf + min_delta)
        gap_ok = age >= min_gap
        if conf_ok and delta_ok and gap_ok:
            return True, ""
        return False, (
            f"hold {active} (need +{hysteresis:.0f} conf / Δ{min_delta:.0f}, "
            f"have {new_conf} vs {locked_conf})"
        )

    def apply_entry_mid_final(
        self,
        ticker: Optional[str],
        direction: str,
        lean: Optional[str],
        conf: int,
        score: float,
        firm: bool,
        summary: str,
        mins_left: Optional[float],
        up_pct: Optional[float],
        gate_notes: Optional[list] = None,
    ) -> Dict[str, Any]:
        """
        Core state machine. Call from synthesize() after confluence is decided.
        Returns updated direction/lean/conf/firm/summary plus lock metadata.
        """
        gate_notes = gate_notes or []
        if not getattr(settings, "WINDOW_LOCK_ENABLED", True):
            return {
                "direction": direction,
                "lean": lean,
                "conf": conf,
                "firm": firm,
                "summary": summary,
                "window_locked": False,
                "locked_dir": None,
                "entry_dir": None,
                "mid_dir": None,
                "final_dir": None,
                "call_phase": None,
                "entry_up_pct": None,
                "revisions_used": 0,
            }

        # New ticker → reset
        if ticker and getattr(self, "_em_ticker", None) and ticker != self._em_ticker:
            self._clear_window_lock()
        if ticker and not getattr(self, "_em_ticker", None):
            self._em_ticker = ticker
            self._locked_ticker = ticker

        side = _side(direction) if firm else None
        if lean in ("UP", "DOWN"):
            side = lean if firm else side

        # Phase by mins_left
        if mins_left is None:
            phase = "entry"
        elif mins_left > 10.0:
            phase = "entry"
        elif mins_left > 5.0:
            phase = "mid"
        else:
            phase = "final"

        call_phase = None

        # ── No entry yet ────────────────────────────────────────────
        if not self._entry_dir:
            if side in ("UP", "DOWN") and firm:
                self._entry_dir = side
                self._entry_conf = int(conf)
                self._entry_score = float(score)
                self._entry_up_pct = float(up_pct) if up_pct is not None else None
                self._entry_at = time.time()
                self._locked_dir = side
                self._locked_conf = int(conf)
                self._locked_score = float(score)
                self._locked_at = self._entry_at
                call_phase = "entry"
                summary = f"ENTRY {side} @ {self._entry_up_pct or '—'}¢ · {summary}"
            # else stay WAIT / unformed
            return self._pack(direction, lean, conf, firm, summary, call_phase, gate_notes)

        # ── Have entry; maybe revise ────────────────────────────────
        active = self._active_dir()

        # Same side as active → reinforce, no revision spent
        if side == active and firm:
            summary = f"{active} held ({phase}) · {summary}"
            return self._pack(active, active, max(conf, 55), True, summary, phase, gate_notes)

        # Opposite side proposed
        if side in ("UP", "DOWN") and side != active and firm:
            allowed, why = self._hysteresis_allows(side, conf, score)
            revisions_left = 2 - int(getattr(self, "_revisions_used", 0) or 0)

            can_mid = (
                phase == "mid"
                and self._mid_dir is None
                and revisions_left > 0
                and allowed
            )
            can_final = (
                phase == "final"
                and self._final_dir is None
                and revisions_left > 0
                and allowed
            )

            if can_mid:
                self._mid_dir = side
                self._mid_conf = int(conf)
                self._mid_at = time.time()
                self._revisions_used = int(getattr(self, "_revisions_used", 0)) + 1
                self._locked_dir = side
                self._locked_conf = int(conf)
                self._locked_at = self._mid_at
                call_phase = "mid"
                summary = f"MID revise → {side} (was {active}) · {summary}"
                return self._pack(side, side, conf, True, summary, call_phase, gate_notes)

            if can_final:
                self._final_dir = side
                self._final_conf = int(conf)
                self._final_at = time.time()
                self._revisions_used = int(getattr(self, "_revisions_used", 0)) + 1
                self._locked_dir = side
                self._locked_conf = int(conf)
                self._locked_at = self._final_at
                call_phase = "final"
                summary = f"FINAL revise → {side} (was {active}) · {summary}"
                return self._pack(side, side, conf, True, summary, call_phase, gate_notes)

            # Blocked — hold active
            hold = active
            conf = max(55, min(int(conf), self._active_conf()))
            summary = f"Lock held {hold} · {why or 'revision not allowed this phase'}"
            if gate_notes:
                summary += " · " + ", ".join(gate_notes[:2])
            return self._pack(hold, hold, conf, True, summary, phase, gate_notes)

        # WAIT or soft — still surface active lock
        if active:
            summary = f"Lock held {active} · {summary}"
            return self._pack(active, active, max(55, conf), True, summary, phase, gate_notes)

        return self._pack(direction, lean, conf, firm, summary, phase, gate_notes)

    def _pack(self, direction, lean, conf, firm, summary, call_phase, gate_notes):
        return {
            "direction": direction,
            "lean": lean,
            "conf": int(conf),
            "firm": bool(firm),
            "summary": summary,
            "window_locked": bool(self._entry_dir),
            "locked_dir": self._active_dir(),
            "entry_dir": self._entry_dir,
            "mid_dir": self._mid_dir,
            "final_dir": self._final_dir,
            "call_phase": call_phase,
            "entry_up_pct": self._entry_up_pct,
            "revisions_used": int(getattr(self, "_revisions_used", 0) or 0),
        }
