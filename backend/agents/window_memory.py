"""
WindowMemory – multi-window context for every specialist.

Holds:
  - Last N settled windows (direction, correctness, path, regime, bot votes)
  - Live path of the current Kalshi 15m window (entry lock, mid, final, ticks)

Injected into market_data as market_data["wm"] every council cycle.
Bots use this to think beyond the last few ticks.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Any, Deque, Dict, List, Optional
import time
from loguru import logger


MAX_SETTLED = 24          # several hours of 15m windows
MAX_PATH_TICKS = 180      # ~ one tick per 5s for 15m


@dataclass
class SettledWindow:
    ticker: str
    entry_dir: Optional[str]
    final_dir: Optional[str]
    correct: Optional[int]          # 1 / 0 / None
    entry_up_pct: Optional[float]
    settle_up_pct: Optional[float]
    path_pts: Optional[float]
    regime_key: Optional[str]
    atr_pct: Optional[float]
    volume_percentile: Optional[float]
    bot_votes_entry: Dict[str, str] = field(default_factory=dict)
    bot_votes_final: Dict[str, str] = field(default_factory=dict)
    settled_at: float = 0.0


@dataclass
class LiveWindow:
    ticker: Optional[str] = None
    phase: str = "entry"            # entry | mid | final
    mins_left: Optional[float] = None
    entry_dir: Optional[str] = None
    entry_conf: int = 0
    entry_up_pct: Optional[float] = None
    entry_ts: float = 0.0
    mid_dir: Optional[str] = None
    mid_conf: int = 0
    mid_ts: float = 0.0
    final_dir: Optional[str] = None
    final_conf: int = 0
    final_ts: float = 0.0
    path: List[Dict[str, float]] = field(default_factory=list)  # {t, up, px}
    revisions_used: int = 0         # 0..2


class WindowMemory:
    """
    Shared singleton-style memory. Council holds one instance.
    """

    def __init__(self, max_settled: int = MAX_SETTLED):
        self.settled: Deque[SettledWindow] = deque(maxlen=max_settled)
        self.live = LiveWindow()
        self._last_ticker: Optional[str] = None

    # ── live window management ──────────────────────────────────────

    def on_tick(
        self,
        ticker: Optional[str],
        up_pct: Optional[float],
        price: Optional[float],
        mins_left: Optional[float],
    ) -> None:
        """Called every council cycle with latest market snapshot."""
        if not ticker:
            return

        # New ticker → reset live state
        if ticker != self._last_ticker:
            self.live = LiveWindow(ticker=ticker)
            self._last_ticker = ticker

        self.live.ticker = ticker
        self.live.mins_left = mins_left

        # Phase by remaining time in the 15m window
        if mins_left is None:
            self.live.phase = "entry"
        elif mins_left > 10.0:
            self.live.phase = "entry"
        elif mins_left > 5.0:
            self.live.phase = "mid"
        else:
            self.live.phase = "final"

        if up_pct is not None:
            tick = {"t": time.time(), "up": float(up_pct)}
            if price is not None:
                tick["px"] = float(price)
            self.live.path.append(tick)
            if len(self.live.path) > MAX_PATH_TICKS:
                self.live.path = self.live.path[-MAX_PATH_TICKS:]

    def set_entry(self, direction: str, conf: int, up_pct: Optional[float]) -> None:
        if self.live.entry_dir:
            return  # immutable once set
        self.live.entry_dir = direction
        self.live.entry_conf = int(conf)
        self.live.entry_up_pct = float(up_pct) if up_pct is not None else None
        self.live.entry_ts = time.time()

    def set_mid(self, direction: str, conf: int) -> bool:
        if self.live.mid_dir is not None:
            return False
        if self.live.revisions_used >= 2:
            return False
        self.live.mid_dir = direction
        self.live.mid_conf = int(conf)
        self.live.mid_ts = time.time()
        self.live.revisions_used += 1
        return True

    def set_final(self, direction: str, conf: int) -> bool:
        if self.live.final_dir is not None:
            return False
        if self.live.revisions_used >= 2:
            return False
        self.live.final_dir = direction
        self.live.final_conf = int(conf)
        self.live.final_ts = time.time()
        self.live.revisions_used += 1
        return True

    def graded_call(self) -> Optional[str]:
        """Latest locked call used for settlement / hit rate."""
        if self.live.final_dir:
            return self.live.final_dir
        if self.live.mid_dir:
            return self.live.mid_dir
        return self.live.entry_dir

    def entry_point(self) -> Optional[float]:
        return self.live.entry_up_pct

    # ── settled history ─────────────────────────────────────────────

    def push_settled(self, row: Dict[str, Any]) -> None:
        """Ingest a settled window_calls row from the store."""
        try:
            sw = SettledWindow(
                ticker=str(row.get("market_ticker") or row.get("ticker") or ""),
                entry_dir=row.get("entry_dir") or row.get("leader_direction"),
                final_dir=row.get("final_dir") or row.get("leader_direction"),
                correct=row.get("correct"),
                entry_up_pct=_f(row.get("entry_up_pct") or row.get("open_price")),
                settle_up_pct=_f(row.get("settle_up_pct") or row.get("win_pct")),
                path_pts=_f(row.get("path_move_pct") or row.get("path_pts")),
                regime_key=row.get("regime_key") or row.get("regime_tag"),
                atr_pct=_f(row.get("atr_pct")),
                volume_percentile=_f(row.get("volume_percentile")),
                bot_votes_entry=_votes(row.get("bot_votes_entry") or row.get("agent_votes")),
                bot_votes_final=_votes(row.get("bot_votes_final")),
                settled_at=float(row.get("settled_at") or time.time()),
            )
            self.settled.append(sw)
        except Exception as e:
            logger.debug(f"window_memory push_settled skip: {e}")

    def seed_from_store(self, rows: List[Dict[str, Any]]) -> int:
        n = 0
        for row in reversed(rows):  # oldest first
            self.push_settled(row)
            n += 1
        return n

    # ── query helpers for bots ──────────────────────────────────────

    def prior_windows(self, n: int = 8) -> List[SettledWindow]:
        items = list(self.settled)
        return items[-n:] if items else []

    def prior_dirs(self, n: int = 8) -> List[str]:
        out = []
        for w in self.prior_windows(n):
            d = w.final_dir or w.entry_dir
            if d in ("UP", "DOWN"):
                out.append(d)
        return out

    def recent_hit_rate(self, n: int = 12) -> Optional[float]:
        wins = 0
        total = 0
        for w in self.prior_windows(n):
            if w.correct is None:
                continue
            total += 1
            if int(w.correct) == 1:
                wins += 1
        return (wins / total) if total else None

    def consecutive_same_dir(self) -> tuple[Optional[str], int]:
        """How many prior windows ended the same direction (streak)."""
        dirs = self.prior_dirs(12)
        if not dirs:
            return None, 0
        last = dirs[-1]
        streak = 0
        for d in reversed(dirs):
            if d == last:
                streak += 1
            else:
                break
        return last, streak

    def mean_reversion_bias(self, n: int = 6) -> Optional[str]:
        """
        If last N windows were heavily one-sided, lean the other way
        (simple multi-window mean-reversion prior).
        """
        dirs = self.prior_dirs(n)
        if len(dirs) < max(3, n // 2):
            return None
        up = sum(1 for d in dirs if d == "UP")
        down = len(dirs) - up
        if up >= n - 1:
            return "DOWN"
        if down >= n - 1:
            return "UP"
        return None

    def current_path_move(self) -> Optional[float]:
        """Points of Kalshi YES move since entry (or since first tick)."""
        if not self.live.path:
            return None
        entry = self.live.entry_up_pct
        if entry is None:
            entry = self.live.path[0].get("up")
        if entry is None:
            return None
        last = self.live.path[-1].get("up")
        if last is None:
            return None
        return float(last) - float(entry)

    def is_quiet(self, atr_pct: Optional[float], vol_pct: Optional[float]) -> bool:
        """Thin edge / low activity → bots should raise the bar."""
        quiet = False
        if atr_pct is not None and atr_pct < 0.12:
            quiet = True
        if vol_pct is not None and vol_pct < 25.0:
            quiet = True
        return quiet

    def snapshot(self) -> Dict[str, Any]:
        """Serialize for market_data['wm'] and UI."""
        return {
            "phase": self.live.phase,
            "mins_left": self.live.mins_left,
            "ticker": self.live.ticker,
            "entry_dir": self.live.entry_dir,
            "entry_conf": self.live.entry_conf,
            "entry_up_pct": self.live.entry_up_pct,
            "mid_dir": self.live.mid_dir,
            "final_dir": self.live.final_dir,
            "graded_call": self.graded_call(),
            "revisions_used": self.live.revisions_used,
            "path_move": self.current_path_move(),
            "path_len": len(self.live.path),
            "prior_hit_rate": self.recent_hit_rate(12),
            "streak_dir": (self.consecutive_same_dir()[0]),
            "streak_n": (self.consecutive_same_dir()[1]),
            "mean_rev_bias": self.mean_reversion_bias(6),
            "settled_count": len(self.settled),
        }


def _f(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _votes(raw) -> Dict[str, str]:
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    if isinstance(raw, str):
        try:
            import json
            d = json.loads(raw)
            if isinstance(d, dict):
                return {str(k): str(v) for k, v in d.items()}
        except Exception:
            pass
    return {}
