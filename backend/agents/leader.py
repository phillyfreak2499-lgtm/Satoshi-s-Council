"""
The Chair / Leader – confluence synthesis + adaptive weighting.

Weights drift with each bot's historical correctness.
When historically strong coalitions agree again, their joint vote
gets an affinity bonus — the Chair "remembers" who is right together.

GOAL CONTRACT (enforced here):
  Exactly ONE high-quality directional guess per official window
  (BTC 15m / ETH 1H), taken only when the book is inside the playable
  band (20–80 after vig on 15m BTC; never 99¢ chalk).
  Once locked, the call is irreversible for that window.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import AgentSignal, Direction, GOAL_CONTRACT, GOAL_CONTRACT_SHORT
from backend.config import settings
from backend.learning.adaptive import AdaptiveLearner, NON_VOTERS
from backend.agents.roster import display_name
from backend.agents.chair_gates import (
    book_too_thin,
    chair_ticker_blocked,
    chair_top_dir_eligible,
    compute_ev_cents,
    dead_book_reason,
    early_lock_blocked,
    estimate_p_finish,
    eth_fades_btc_impulse,
    eth_paper_lock_blocked,
    btc_shadow_pick,
    eth_shadow_pick,
    ev_gate_blocks,
    explore_paper_lock_ok,
    explore_paper_lock_open,
    late_spot_decisive,
    leftover_after_vig,
    filter_pattern_signals_for_asset,
    lock_force_allowed,
    never_lock_near_certain,
    odds_to_cents,
    paper_lock_day_ok,
    parse_book_depth,
    stuck_hours_open,
    time_ev_hurdles,
    zach_band_skips_preferred,
)
from backend.data.cfbenchmarks import last15_spot
from loguru import logger
import copy
import time


class Leader:
    def __init__(self, learner: Optional[AdaptiveLearner] = None):
        self.learner = learner or AdaptiveLearner()
        self.weights: Dict[str, float] = dict(self.learner.weights)
        # Keep guardian in the map for compatibility even though it rarely votes
        for k, v in settings.BASE_WEIGHTS.items():
            if k not in self.weights:
                self.weights[k] = float(v)
        self._normalize_weights()
        self.signal_count = 0
        # Track last firm lean so we can flag regime flips as SWAP (not SELL)
        self._last_firm_dir: Optional[str] = None
        self._last_firm_score: float = 0.0
        # Lifetime edge stats → adaptive WAIT threshold (fewer WAITs when proven)
        self.edge: Dict[str, Any] = {
            "total": 0,
            "accuracy_pct": None,
            "last_20_pct": None,
            "verdict": "COLLECTING",
        }
        self.wait_calls: int = 0
        self.directional_calls: int = 0

        # Per-window Entry / Mid / Final lock (one graded call path per Kalshi ticker)
        self._locked_ticker: Optional[str] = None
        self._locked_window: Optional[str] = None  # close_time identity — stable across ATM ticker hops
        self._locked_dir: Optional[str] = None  # active UP | DOWN
        self._locked_conf: int = 0
        self._locked_score: float = 0.0
        self._locked_at: float = 0.0
        # Entry / Mid / Final state
        self._entry_dir: Optional[str] = None
        self._entry_conf: int = 0
        self._entry_score: float = 0.0
        self._entry_up_pct: Optional[float] = None
        self._entry_at: float = 0.0
        self._mid_dir: Optional[str] = None
        self._mid_conf: int = 0
        self._mid_at: float = 0.0
        self._final_dir: Optional[str] = None
        self._final_conf: int = 0
        self._final_at: float = 0.0
        self._revisions_used: int = 0
        # Two-stage lean → lock
        self._lean_pending_dir: Optional[str] = None
        self._lean_pending_since: float = 0.0
        self._lean_pending_conf: int = 0
        # Anti-chase: recent side-odds samples (ts, side_odds for UP as up_pct)
        self._odds_hist: list = []
        # Paper P(finish) / EV — last cycle + values frozen at lock
        self._last_p_finish: Optional[float] = None
        self._last_ev_cents: Optional[float] = None
        self._last_ev_phase: Optional[str] = None
        self._locked_p_finish: Optional[float] = None
        self._locked_ev_cents: Optional[float] = None
        self._locked_floor_strike: Optional[float] = None
        self._locked_close_time: Optional[str] = None
        self.edge: Dict[str, Any] = {}

    def _normalize_weights(self) -> None:
        total = sum(self.weights.values()) or 1.0
        self.weights = {k: v / total for k, v in self.weights.items()}


    def _clear_window_lock(self) -> None:
        self._locked_ticker = None
        self._locked_window = None
        self._locked_dir = None
        self._locked_conf = 0
        self._locked_score = 0.0
        self._locked_at = 0.0
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
        self._lean_pending_dir = None
        self._lean_pending_since = 0.0
        self._lean_pending_conf = 0
        self._odds_hist = []
        self._last_p_finish = None
        self._last_ev_cents = None
        self._last_ev_phase = None
        self._locked_p_finish = None
        self._locked_ev_cents = None
        self._locked_floor_strike = None
        self._locked_close_time = None

    def _active_dir(self) -> Optional[str]:
        return self._final_dir or self._mid_dir or self._entry_dir or self._locked_dir

    def _active_conf(self) -> int:
        if self._final_dir:
            return int(self._final_conf)
        if self._mid_dir:
            return int(self._mid_conf)
        if self._entry_dir:
            return int(self._entry_conf)
        return int(self._locked_conf or 0)

    def _set_window_lock(self, ticker: str, direction: str, conf: int, score: float,
                         up_pct: float | None = None, call_phase: str = "entry") -> None:
        """Set the single Chair lock for this ticker (GOAL: one call max).

        When MAX_CALLS_PER_WINDOW <= 1 the lock is irreversible for the ticker.
        Mid/final revision slots are only opened when the config allows >1 calls.
        """
        if direction in ("UP", "UP_HOLD"):
            side = "UP"
        elif direction in ("DOWN", "DOWN_HOLD"):
            side = "DOWN"
        else:
            return
        if not ticker:
            return
        now = time.time()
        if ticker != self._locked_ticker:
            self._clear_window_lock()
            self._locked_ticker = ticker

        max_calls = int(getattr(settings, "MAX_CALLS_PER_WINDOW", 1) or 1)
        # Always record the first firm call as ENTRY
        if call_phase == "entry" or not self._entry_dir:
            self._entry_dir = side
            self._entry_conf = int(conf)
            self._entry_score = float(score)
            self._entry_up_pct = float(up_pct) if up_pct is not None else None
            self._entry_at = now
        elif max_calls > 1 and call_phase == "mid" and self._mid_dir is None and self._revisions_used < (max_calls - 1):
            self._mid_dir = side
            self._mid_conf = int(conf)
            self._mid_at = now
            self._revisions_used += 1
        elif max_calls > 1 and call_phase == "final" and self._final_dir is None and self._revisions_used < (max_calls - 1):
            self._final_dir = side
            self._final_conf = int(conf)
            self._final_at = now
            self._revisions_used += 1
        else:
            # Reinforce active side; no new graded event
            pass

        self._locked_ticker = ticker
        self._locked_dir = side
        self._locked_conf = int(conf)
        self._locked_score = float(score)
        self._locked_at = now

    def _lock_blocks_opposite(
        self,
        ticker: str | None,
        lean: str | None,
        conf: int,
        score: float,
        mins_left: float | None = None,
    ) -> tuple:
        """Return (blocked, reason, allowed_phase).

        GOAL CONTRACT rules (follower-bot ready):
          - Same side as active lock → always blocked (hold)
          - Opposite side → only if MAX_CALLS_PER_WINDOW > 1 and a revision slot remains
          - When MAX_CALLS_PER_WINDOW == 1 → hard irreversible lock after first entry
          - After final / budget spent → hard lock until ticker changes
        """
        if not getattr(settings, "WINDOW_LOCK_ENABLED", True):
            return False, "", None
        if not ticker or not lean or lean not in ("UP", "DOWN"):
            return False, "", None
        if self._locked_ticker != ticker or not self._active_dir():
            return False, "", None

        active = self._active_dir()
        max_calls = int(getattr(settings, "MAX_CALLS_PER_WINDOW", 1) or 1)

        # Same side: never open a new graded call — just hold
        if lean == active:
            return True, f"hold {active}", None

        # Strict one-call policy: any opposite attempt is blocked
        if max_calls <= 1:
            return True, f"hard-lock {active} (one-call / irreversible)", None

        # Hard lock after final or revision budget spent
        if self._final_dir or int(getattr(self, "_revisions_used", 0) or 0) >= (max_calls - 1):
            return True, f"hard-lock {active} (final/budget spent)", None

        # Phase from minutes left
        if mins_left is None:
            phase = "entry"
        elif mins_left > 10.0:
            phase = "entry"
        elif mins_left > 5.0:
            phase = "mid"
        else:
            phase = "final"

        # Entry is immutable — only mid/final may revise opposite when allowed
        if not self._entry_dir:
            return False, "", "entry"

        can_mid = phase == "mid" and self._mid_dir is None and self._revisions_used < (max_calls - 1)
        can_final = phase == "final" and self._final_dir is None and self._revisions_used < (max_calls - 1)
        if not can_mid and not can_final:
            return True, f"lock held {active} · no revision slot in {phase}", None

        # Stricter hysteresis for opposite flips
        hysteresis = float(getattr(settings, "HYSTERESIS_BAND", 18))
        min_delta = float(getattr(settings, "FLIP_MIN_CONF_DELTA", 22))
        min_gap = float(getattr(settings, "FLIP_MIN_GAP_SEC", 120.0))

        locked_conf = self._active_conf()
        locked_at = self._final_at or self._mid_at or self._entry_at or self._locked_at or 0.0
        age = time.time() - locked_at
        conf_ok = conf >= (locked_conf + hysteresis)
        delta_ok = conf >= (locked_conf + min_delta)
        gap_ok = age >= min_gap
        score_ok = abs(score - float(self._locked_score or 0.0)) >= 0.32

        if conf_ok and delta_ok and gap_ok and score_ok:
            return False, "", ("mid" if can_mid else "final")

        return True, (
            f"lock held {active} "
            f"(need +{hysteresis:.0f} conf / Δ{min_delta:.0f} / {min_gap:.0f}s, "
            f"have conf {conf} vs locked {locked_conf}, age {age:.0f}s)"
        ), None

    def _build_locked_call(self) -> Optional[Dict[str, Any]]:
        """Clean follower-readable lock object. None when no lock is active."""
        active = self._active_dir()
        if not active or not (self._entry_dir or self._locked_dir):
            return None
        entry_odds = None
        if self._entry_up_pct is not None:
            if active == "UP":
                entry_odds = float(self._entry_up_pct)
            elif active == "DOWN":
                entry_odds = 100.0 - float(self._entry_up_pct)
        locked_at = self._entry_at or self._locked_at or None
        locked_at_iso = None
        if locked_at:
            try:
                from datetime import datetime, timezone
                locked_at_iso = datetime.fromtimestamp(float(locked_at), tz=timezone.utc).isoformat()
            except Exception:
                locked_at_iso = str(locked_at)
        return {
            "locked": True,
            "direction": active,
            "confidence": int(self._active_conf()),
            "entry_odds_pct": entry_odds,
            "entry_up_pct": self._entry_up_pct,
            "locked_at": locked_at_iso or locked_at,
            "phase": (
                "final" if self._final_dir else
                "mid" if self._mid_dir else
                "entry"
            ),
            "irreversible": int(getattr(settings, "MAX_CALLS_PER_WINDOW", 1) or 1) <= 1,
            "ticker": self._locked_ticker,
            "goal": GOAL_CONTRACT_SHORT,
            "p_finish": self._locked_p_finish,
            "ev_cents": self._locked_ev_cents,
            "leftover_after_vig": self._locked_ev_cents,
            "floor_strike": self._locked_floor_strike,
            "close_time": self._locked_close_time,
            "paper_only": True,
        }

    def _price_edge(
        self,
        conf: Any,
        lean: str | None,
        side_odds: float | None,
        regime_features: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        """Paper P(finish) + EV at the real ask, not mid."""
        spread = None
        try:
            if regime_features and regime_features.get("spread_cents") is not None:
                spread = float(regime_features["spread_cents"])
        except (TypeError, ValueError):
            spread = None
        settled_n = 0
        try:
            settled_n = int((self.edge or {}).get("total") or 0)
        except (TypeError, ValueError):
            settled_n = 0
        if regime_features and regime_features.get("settled_n") is not None:
            try:
                settled_n = int(regime_features["settled_n"])
            except (TypeError, ValueError):
                pass
        bin_n = None
        if regime_features and regime_features.get("chair_bin_settled_n") is not None:
            try:
                bin_n = int(regime_features["chair_bin_settled_n"])
            except (TypeError, ValueError):
                bin_n = 0
        elif isinstance(self.edge, dict):
            hot = ((self.edge.get("chair_bins") or {}).get("90+") or {})
            if hot.get("settled") is not None:
                try:
                    bin_n = int(hot.get("settled") or 0)
                except (TypeError, ValueError):
                    bin_n = 0
        # 1062/1063 still OPEN → n=0. Chair conf is not P(finish).
        if regime_features and (
            regime_features.get("stuck_open")
            or stuck_hours_open(regime_features.get("open_rows") or [])
        ):
            settled_n = 0
            bin_n = 0
        p_finish = (
            estimate_p_finish(conf, settled_n, bin_settled_n=bin_n)
            if lean in ("UP", "DOWN")
            else None
        )
        fill_ask = None
        if regime_features:
            fill_ask = odds_to_cents(regime_features.get("side_ask"))
            if fill_ask is None and lean == "UP":
                fill_ask = odds_to_cents(regime_features.get("yes_ask"))
            if fill_ask is None and lean == "DOWN":
                fill_ask = odds_to_cents(regime_features.get("no_ask"))
                if fill_ask is None:
                    yb = odds_to_cents(regime_features.get("yes_bid"))
                    if yb is not None:
                        fill_ask = 100.0 - yb
        if fill_ask is None:
            fill_ask = odds_to_cents(side_odds)
        ev = None
        if p_finish is not None and fill_ask is not None:
            ev = compute_ev_cents(p_finish, fill_ask, spread)
        mins_left = None
        window_minutes = None
        if regime_features:
            try:
                if regime_features.get("mins_left") is not None:
                    mins_left = float(regime_features["mins_left"])
            except (TypeError, ValueError):
                mins_left = None
            try:
                if regime_features.get("window_minutes") is not None:
                    window_minutes = float(regime_features["window_minutes"])
            except (TypeError, ValueError):
                window_minutes = None
        try:
            from backend.learning.btc15m import timeframe_gates
            tf = timeframe_gates(
                window_minutes=window_minutes,
                ticker=(regime_features or {}).get("ticker"),
                series=(regime_features or {}).get("series_ticker"),
                asset=(regime_features or {}).get("asset"),
            )
        except Exception:
            tf = {
                "early_window_mins": float(getattr(settings, "EARLY_WINDOW_MINS", 20.0)),
                "late_window_mins": float(getattr(settings, "LATE_WINDOW_MINS", 15.0)),
                "late_min_p": float(getattr(settings, "LATE_MIN_P_FINISH", 0.70)),
                "late_min_ev": float(getattr(settings, "LATE_MIN_EV_CENTS", 8.0)),
            }
        hurdles = time_ev_hurdles(
            mins_left,
            window_minutes,
            min_p=float(getattr(settings, "MIN_P_FINISH", 0.55)),
            min_ev=float(getattr(settings, "MIN_EV_CENTS", 3.0)),
            early_window_mins=float(tf.get("early_window_mins") or getattr(settings, "EARLY_WINDOW_MINS", 20.0)),
            late_window_mins=float(tf.get("late_window_mins") or getattr(settings, "LATE_WINDOW_MINS", 15.0)),
            early_ev_mult=float(getattr(settings, "EARLY_EV_MULT", 1.5)),
            late_min_p=float(tf.get("late_min_p") or getattr(settings, "LATE_MIN_P_FINISH", 0.70)),
            late_min_ev=float(tf.get("late_min_ev") or getattr(settings, "LATE_MIN_EV_CENTS", 8.0)),
        )
        min_p = float(hurdles["min_p"])
        min_ev = float(hurdles["min_ev"])
        if side_odds is not None and hasattr(self.learner, "odds_band_tighten"):
            try:
                tight = self.learner.odds_band_tighten(side_odds)
                min_p += float(tight.get("p_add") or 0.0)
                min_ev += float(tight.get("ev_add") or 0.0)
            except Exception:
                pass
        return {
            "p_finish": p_finish,
            "ev_cents": ev,
            "spread": spread,
            "phase": hurdles["phase"],
            "min_p": min_p,
            "min_ev": min_ev,
        }

    def update_edge_from_accuracy(self, accuracy: Dict[str, Any] | None) -> None:
        """Feed lifetime log stats so confluence bar can loosen or tighten."""
        if not accuracy:
            return
        self.cool_down_bump: float = 0.0
        self.edge = {
            "total": int(accuracy.get("total") or 0),
            "reliability_n": int(accuracy.get("reliability_n") or accuracy.get("total") or 0),
            "accuracy_pct": accuracy.get("accuracy_pct"),
            "last_20_pct": (accuracy.get("last_20") or {}).get("accuracy_pct"),
            "verdict": accuracy.get("verdict") or "COLLECTING",
            "chair_bins": accuracy.get("chair_bins") or {},
            "eth_shadow": accuracy.get("eth_shadow") or {},
            "btc_shadow": accuracy.get("btc_shadow") or {},
        }

    def adaptive_thresholds(self) -> Dict[str, float]:
        """
        Dynamic confluence / confidence bars — learn-first design.

        - Cold start (few samples): LOOSE bar → more directional calls → data for hierarchy
        - Lifetime healthy: stay aggressive / loosen further
        - Recent (L20) weak: raise bar so the Chair gets pickier
        """
        base = float(settings.MIN_CONFLUENCE_SCORE)
        conf_base = float(settings.MIN_DIRECTIONAL_CONFIDENCE)
        floor = float(settings.CONFLUENCE_FLOOR)
        ceil = float(settings.CONFLUENCE_CEILING)
        conf_floor = float(settings.DIR_CONF_FLOOR)
        conf_ceil = float(settings.DIR_CONF_CEILING)
        min_n = int(settings.ADAPT_WAIT_MIN_SAMPLES)
        cold_n = int(getattr(settings, "COLD_START_SAMPLES", 15))
        cold_thr = float(getattr(settings, "COLD_START_CONFLUENCE", 0.36))
        cold_conf = float(getattr(settings, "COLD_START_DIR_CONF", 46))

        n = int(self.edge.get("total") or 0)
        life = self.edge.get("accuracy_pct")
        l20 = self.edge.get("last_20_pct")

        # Default: configured base (already fairly loose)
        thr = base
        conf_bar = conf_base

        # Explore → Calibrate → Exploit
        cal_n = int(getattr(settings, "CALIBRATE_SAMPLES", 20))
        exp_n = int(getattr(settings, "EXPLOIT_SAMPLES", 80))
        if n < cold_n:
            phase = "explore"
        elif n < exp_n:
            phase = "calibrate"
        else:
            phase = "exploit"

        # Explore: loose bar so path samples flow
        if phase == "explore":
            thr = cold_thr
            conf_bar = cold_conf
            if cold_n > 0 and n > 0:
                blend = n / cold_n
                thr = cold_thr + (base - cold_thr) * blend
                conf_bar = cold_conf + (conf_base - cold_conf) * blend
        else:
            # Calibrate / Exploit start from base, then adapt to lifetime + L20
            thr = base
            conf_bar = conf_base
            if phase == "exploit":
                # Slightly higher floor so we protect edge once we have data
                thr = min(ceil, base + 0.03)

        if n >= min_n and life is not None:
            edge = float(life) - 50.0
            thr = thr - edge * 0.014
            conf_bar = conf_bar - edge * 0.4

            # Strong lifetime + strong L20 → take more
            if l20 is not None and l20 >= 55 and life >= 53:
                thr -= 0.05
                conf_bar -= 2.5
            # Rolling form breaker: cold streak → effectively WAIT-only until form recovers
            form_break = False
            if l20 is not None and n >= min_n + 6:
                if l20 < 45:
                    form_break = True
                    thr = max(thr, ceil - 0.02)  # near ceiling
                    conf_bar = max(conf_bar, conf_ceil - 1)
                elif l20 < 48:
                    thr += 0.08
                    conf_bar += 4.0
                elif l20 < 52:
                    thr += 0.04
                    conf_bar += 2.0

        else:
            form_break = False

        # Nightly huddle cool-down: fewer noise calls 3–4 AM CT
        bump = float(getattr(self, "cool_down_bump", 0.0) or 0.0)
        if bump:
            thr = thr + bump
            conf_bar = conf_bar + bump * 40

        thr = max(floor, min(ceil, thr))
        conf_bar = max(conf_floor, min(conf_ceil, conf_bar))
        return {
            "confluence": thr,
            "dir_conf": conf_bar,
            "phase": phase,
            "n": n,
            "form_break": bool(locals().get("form_break", False)),
            "l20": l20,
        }

    def sync_from_learner(self) -> None:
        """Pull latest adaptive weights into the Chair's working set."""
        for k, v in self.learner.weights.items():
            self.weights[k] = v
        self._normalize_weights()

    def update_weights(self, new_weights: Dict[str, float]):
        for k, v in new_weights.items():
            if k in self.weights or k in settings.BASE_WEIGHTS:
                self.weights[k] = max(settings.MIN_WEIGHT, min(settings.MAX_WEIGHT, v))
        self._normalize_weights()
        # Mirror into learner so the two stay aligned
        for k, v in self.weights.items():
            if k not in NON_VOTERS:
                self.learner.weights[k] = v
        self.learner._normalize()


    @staticmethod
    def _clean_summary(text: str) -> str:
        """Strip legacy path/scalp language — finish-only doctrine."""
        if not text:
            return text
        import re
        t = str(text)
        t = re.sub(r"\s*·\s*¼\s*scalp[^·]*", "", t, flags=re.I)
        t = re.sub(r"\s*·\s*1/4\s*scalp[^·]*", "", t, flags=re.I)
        t = re.sub(r"finish not required", "finish grades only", t, flags=re.I)
        t = re.sub(r"path = right[^·]*", "directional", t, flags=re.I)
        t = re.sub(r"Kalshi \+?[\d.]+ pts path = right[^·]*", "Kalshi path note", t, flags=re.I)
        t = re.sub(r"\s{2,}", " ", t).strip(" ·")
        return t

    def summarize_clean(self, summary: str) -> str:
        return self._clean_summary(summary)

    def synthesize(
        self,
        signals: List[AgentSignal],
        regime_features: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        Core confluence logic with adaptive weights + pair affinity.
        """
        self.sync_from_learner()
        book = (regime_features or {}).get("asset") if isinstance(regime_features, dict) else None
        signals = filter_pattern_signals_for_asset(signals, book)

        active = [
            s for s in signals
            if not s.muted and s.agent_name not in ("guardian", "law")
        ]
        if not active:
            return self._wait_result("No active specialists", 90)

        # Regime-split weights: listen harder to bots that win in *this* pocket of the day
        regime_key = None
        if regime_features:
            regime_key = regime_features.get("regime_key") or regime_features.get("regime")
        if not regime_key and hasattr(self.learner, "weights_for_regime"):
            from backend.learning.regime_keys import classify_regime
            regime_key = classify_regime(
                mins_left=regime_features.get("mins_left") if regime_features else None
            )
        regime_weights = (
            self.learner.weights_for_regime(regime_key)
            if hasattr(self.learner, "weights_for_regime")
            else dict(self.weights)
        )

        # Live hierarchy — closer to Chair = higher rank = louder vote
        hierarchy = self.learner.hierarchy_ranks()
        rank_map = {r["agent"]: r for r in hierarchy}

        score = 0.0
        weight_sum = 0.0
        anti_bits: List[str] = []
        category_dirs: Dict[str, List[str]] = {}
        details = []

        for s in active:
            base_w = regime_weights.get(s.agent_name, self.weights.get(s.agent_name, 0.1))
            rec = self.learner.correct.get(s.agent_name, 0)
            wrong = self.learner.wrong.get(s.agent_name, 0)
            n = rec + wrong
            wr = (rec / n) if n else None

            h = rank_map.get(s.agent_name) or {}
            rank = int(h.get("rank") or 99)
            listen = float(h.get("listen") or self.learner.listen_factor_for_rank(rank, h))
            invert = bool(h.get("invert"))
            fade_strength = float(h.get("fade_strength") or 0.0)

            # Hierarchy gate + conditional fade (invert chronic losers)
            w = base_w * getattr(s, "health_score", 1.0) * listen
            # Confidence-weighted vote (power curve so 90% >> 55%)
            power = float(getattr(settings, "CONF_WEIGHT_POWER", 1.4))
            conf_w = (max(0.0, min(100.0, float(s.confidence or 0))) / 100.0) ** power
            signed = 0.0
            d = (s.direction or "WAIT").upper()
            can_force = lock_force_allowed(getattr(s, "features", None))
            if can_force:
                if d in ("UP", "UP_HOLD"):
                    signed = conf_w
                elif d in ("DOWN", "DOWN_HOLD"):
                    signed = -conf_w
            effective_dir = d
            if invert and signed != 0.0:
                signed = -signed
                # Scale by how reliably wrong (mild near 42%, stronger near 30%)
                w = w * (0.55 + 0.45 * fade_strength)
                if "UP" in d:
                    effective_dir = "DOWN" if d == "UP" else "DOWN_HOLD"
                elif "DOWN" in d:
                    effective_dir = "UP" if d == "DOWN" else "UP_HOLD"
            score += signed * w
            if can_force:
                weight_sum += w
            cat_dir = effective_dir if invert else s.direction
            category_dirs.setdefault(s.category, []).append(cat_dir)
            details.append({
                "agent": s.agent_name,
                "display_name": display_name(s.agent_name),
                "direction": s.direction,
                "effective_direction": effective_dir if invert else s.direction,
                "confidence": s.confidence,
                "weight": round(w, 3),
                "base_weight": round(base_w, 3),
                "global_weight": round(self.weights.get(s.agent_name, 0.1), 3),
                "rank": rank,
                "listen": round(listen, 3),
                "win_rate": round(wr, 3) if wr is not None else None,
                "record": f"{rec}/{n}" if n else "0/0",
                "regime": regime_key,
                "reasoning": s.reasoning,
                "category": s.category,
                "faded": invert,
                "invert": invert,
                "fade_strength": round(fade_strength, 3),
                "lock_force": can_force,
                "advisory": not can_force,
            })

        # Cap total influence of inverted (faded) bots so one loser can't steer the Chair
        max_share = float(getattr(settings, "FADE_MAX_WEIGHT_SHARE", 0.18))
        inv = [d for d in details if d.get("invert") and d.get("lock_force") is not False]
        if inv and weight_sum > 0:
            inv_w = sum(float(d["weight"]) for d in inv)
            share = inv_w / weight_sum
            if share > max_share and inv_w > 0:
                scale = (max_share * weight_sum) / inv_w
                # Rebuild score with scaled invert weights
                score = 0.0
                weight_sum = 0.0
                for d in details:
                    if d.get("lock_force") is False:
                        continue
                    w = float(d["weight"])
                    if d.get("invert"):
                        w *= scale
                        d["weight"] = round(w, 3)
                    signed = 0.0
                    ed = (d.get("effective_direction") or d.get("direction") or "WAIT").upper()
                    conf = float(d.get("confidence") or 0) / 100.0
                    if "UP" in ed:
                        signed = conf
                    elif "DOWN" in ed:
                        signed = -conf
                    score += signed * w
                    weight_sum += w

        # Sort details by rank for UI
        details.sort(key=lambda d: d.get("rank") or 99)

        if weight_sum > 0:
            score /= weight_sum

        # Cross-category diversity bonus
        up_cats = sum(1 for dirs in category_dirs.values() if dirs.count("UP") > len(dirs) / 2)
        down_cats = sum(1 for dirs in category_dirs.values() if dirs.count("DOWN") > len(dirs) / 2)
        diversity = max(up_cats, down_cats)

        if diversity >= 3:
            score *= (1.0 + settings.CROSS_CATEGORY_BONUS)
        elif diversity >= 2:
            score *= (1.0 + settings.CROSS_CATEGORY_BONUS * 0.5)

        # Pair-affinity boost: bots that have been right *together* before
        lean = "UP" if score > 0 else "DOWN" if score < 0 else "WAIT"
        pair_bonus, pair_bits = self.learner.pair_bonus_for_agreement(active, lean)
        if pair_bonus > 0 and lean in ("UP", "DOWN"):
            # Push score further in the leaning direction
            score = score + (pair_bonus if lean == "UP" else -pair_bonus)

        # Anti-correlated pairs: when known rivals disagree, trust the historical winner
        anti_nudge, anti_bits, anti_loser_fade = self.learner.anti_bonus_for_disagreement(active)
        if anti_nudge != 0.0:
            score = score + anti_nudge
        # Soft-fade weaker side of active anti-pairs in details (for UI / transparency)
        if anti_loser_fade:
            for d in details:
                if d["agent"] in anti_loser_fade:
                    scale = anti_loser_fade[d["agent"]]
                    d["weight"] = round(float(d["weight"]) * scale, 3)
                    d["anti_faded"] = True

        # BTC-leads-ETH: feed Satoshi impulse into Vitalik score (do not fade it)
        btc_lead = None
        if regime_features and isinstance(regime_features.get("btc_lead"), dict):
            btc_lead = regime_features["btc_lead"]
            bd = str(btc_lead.get("direction") or "").upper()
            if btc_lead.get("impulse") and bd in ("UP", "DOWN"):
                mag = 0.08 if btc_lead.get("strong") else 0.045
                score = score + (mag if bd == "UP" else -mag)

        # Regime aggressiveness
        aggressiveness = 1.0
        if regime_features and "aggressiveness" in regime_features:
            aggressiveness = float(regime_features["aggressiveness"])
            aggressiveness = max(0.75, min(1.35, aggressiveness))


        # --- Research gates (KXBTC15M backtests) ---
        gate_notes = []
        if btc_lead and btc_lead.get("impulse"):
            gate_notes.append(f"btc-lead {btc_lead.get('direction')}")
        mins_left = None
        if regime_features:
            try:
                mins_left = float(regime_features.get("mins_left")) if regime_features.get("mins_left") is not None else None
            except Exception:
                mins_left = None

        # Time-in-window gates (highest remaining accuracy lever for 15m path scalps)
        # Hard do-nothing zones + graduated dampen/boost so most noise calls die.
        mid_boost = float(getattr(settings, "MID_WINDOW_BOOST", 0.10))
        try:
            from backend.learning.btc15m import is_15m_window
            fifteen = is_15m_window(
                (regime_features or {}).get("window_minutes"),
                (regime_features or {}).get("ticker"),
                (regime_features or {}).get("series_ticker"),
                (regime_features or {}).get("asset"),
            )
        except Exception:
            fifteen = False
        if fifteen:
            # 15m research gates — not the 1H EARLY_WINDOW_MIN=55 leftover.
            late_min = 2.8
            early_min = 12.0
            hard_early = 12.0
            hard_late = 2.2
        else:
            late_min = float(getattr(settings, "HOURLY_LATE_MIN", 20.0))
            early_min = float(getattr(settings, "HOURLY_EARLY_MIN", 35.0))
            hard_early = float(getattr(settings, "HOURLY_HARD_EARLY_MIN", 45.0))
            hard_late = float(getattr(settings, "HOURLY_HARD_LATE_MIN", 8.0))
        early_dampen = float(getattr(settings, "EARLY_DAMPEN", 0.78))
        late_dampen = float(getattr(settings, "LATE_DAMPEN", 0.72))
        hard_dampen = float(getattr(settings, "HARD_ZONE_DAMPEN", 0.55))

        if mins_left is not None:
            if mins_left >= hard_early:
                # First ~90s of the candle — pure noise, near-hard WAIT
                aggressiveness = max(0.55, aggressiveness * hard_dampen)
                gate_notes.append("hard-early do-nothing")
            elif mins_left >= early_min:
                aggressiveness = max(0.65, aggressiveness * early_dampen)
                gate_notes.append("early-window caution")
            elif 4.0 <= mins_left <= 10.0:
                aggressiveness = min(1.40, aggressiveness * (1.0 + mid_boost))
                gate_notes.append("mid-window edge")
            elif mins_left <= hard_late:
                # Last ~2 min — not enough path left for a clean scalp
                aggressiveness = max(0.55, aggressiveness * hard_dampen)
                gate_notes.append("hard-late do-nothing")
            elif mins_left <= late_min:
                aggressiveness = max(0.65, aggressiveness * late_dampen)
                gate_notes.append("late-window dampen")

        # Spread filter — wide book → force more WAIT (edge eaten by spread)
        spread_max = float(getattr(settings, "SPREAD_MAX_CENTS", 6.0))
        spread = None
        if regime_features and regime_features.get("spread_cents") is not None:
            try:
                spread = float(regime_features["spread_cents"])
            except Exception:
                spread = None
        if spread is not None and spread > spread_max:
            aggressiveness = max(0.7, aggressiveness * 0.85)
            gate_notes.append(f"wide spread {spread:.1f}¢")

        # Fade-family: chronic losers (panic/cheap) no longer get agreement boost.
        # If they agree while hard-muted/faded, treat as a mild WARNING instead.
        fade_dirs = []
        for s in active:
            if s.agent_name in ("panic", "cheap", "exhaust") and s.direction in ("UP", "DOWN"):
                fade_dirs.append(s.direction)
        if len(fade_dirs) >= 2 and len(set(fade_dirs)) == 1:
            # Do NOT boost score — these bots are net-negative historically
            gate_notes.append("toxic-family ignored")

        # Adaptive anti-WAIT: lifetime edge lowers the bar; bad L20 raises it
        bars = self.adaptive_thresholds()
        if bars.get("form_break"):
            # Circuit: recent form too cold — force WAIT path by maxing threshold
            pass
        threshold = bars["confluence"] / aggressiveness
        dir_conf_bar = bars["dir_conf"]

        # Quiet / low-vol hard gate — raise the bar when edge is thin
        quiet = False
        if regime_features:
            try:
                atr_pct = regime_features.get("atr_pct") or regime_features.get("realized_vol")
                vol_pctile = regime_features.get("volume_percentile")
                if atr_pct is not None and float(atr_pct) < float(getattr(settings, "QUIET_ATR_PCT", 0.12)):
                    quiet = True
                if vol_pctile is not None and float(vol_pctile) < float(getattr(settings, "QUIET_VOLUME_PERCENTILE", 25)):
                    quiet = True
            except Exception:
                pass
        quiet_floor = float(getattr(settings, "QUIET_MIN_DIRECTIONAL_CONF", 80))
        if quiet:
            dir_conf_bar = max(dir_conf_bar, quiet_floor)
            gate_notes.append(f"quiet-mode conf≥{quiet_floor:.0f}")

        direction: Direction = "WAIT"
        conf = settings.WAIT_DEFAULT_CONFIDENCE
        summary = "Insufficient confluence – WAIT (scalp calls paused)"
        if bars.get("form_break"):
            summary = f"FORM BREAK · L20={bars.get('l20')}% – WAIT until recent form recovers"
        lean: Optional[str] = None  # underlying UP/DOWN when direction is SWAP / HOLD

        abs_score = abs(score)
        firm = False
        # Soft directional path: strong lean can pass a slightly lower conf bar
        conf_gate = (dir_conf_bar / 100.0) * 50
        hold_thr = threshold * float(settings.HOLD_CONFLUENCE_RATIO)
        hold_pts = settings.PATH_WIN_PCT * settings.HOLD_FRACTION
        full_pts = settings.PATH_WIN_PCT

        # Top-N hierarchy agreement: #1..#N must not conflict for a FULL call
        top_n = int(getattr(settings, "TOP_N_AGREEMENT", 3))
        top_agents = [r["agent"] for r in hierarchy[:top_n]]
        top_dirs = []
        for name in top_agents:
            sig = next((s for s in active if s.agent_name == name), None)
            if sig and sig.direction in ("UP", "DOWN") and chair_top_dir_eligible(sig):
                top_dirs.append(sig.direction)
        top_agree = False
        top_conflict = False
        if len(top_dirs) >= 2:
            if len(set(top_dirs)) == 1:
                top_agree = True
            else:
                top_conflict = True
        elif len(top_dirs) == 1:
            top_agree = True  # single directional top seat is OK with score
        if top_agree:
            top_conflict = False

        # Edge / quality score 0-100 (separate from direction)
        edge_score = int(min(100, max(0, abs_score * 120 + diversity * 6 + (8 if top_agree else 0) + (pair_bonus * 40))))
        if top_conflict:
            edge_score = max(0, edge_score - 18)

        if abs_score >= threshold and abs_score * 100 >= conf_gate:
            lean = "UP" if score > 0 else "DOWN"
            # Full call only if top ranks aren't fighting each other
            if top_conflict:
                firm = True
                direction = ("UP_HOLD" if lean == "UP" else "DOWN_HOLD")  # type: ignore[assignment]
                conf = int(min(72, max(settings.HOLD_CONFIDENCE_FLOOR, 44 + abs_score * 45)))
                summary = (
                    f"Top-{top_n} conflict – demote to 1/4 HOLD {lean} · "
                    f"need hierarchy agreement for FULL"
                )
            else:
                firm = True
                direction = lean  # type: ignore[assignment]
                conf = int(min(92, 50 + abs_score * 55))
                summary = (
                    f"Confluence across {diversity} categories – {direction} · "
                    f"Kalshi +{full_pts:g} pts path = right"
                )
                if top_agree:
                    conf = min(94, conf + 4)
                    summary += f" · top-{top_n} aligned"
                if pair_bits:
                    summary += " · coalition " + ", ".join(pair_bits[:2])
                if anti_bits:
                    summary += " · ANTI " + ", ".join(anti_bits[:2])
                if bars["confluence"] < settings.MIN_CONFLUENCE_SCORE - 0.02:
                    summary += f" · edge-adapted thr {threshold:.2f}"
                if gate_notes:
                    summary += " · " + ", ".join(gate_notes[:3])

                # Big regime flip → SWAP (much higher bar — flips were bleeding edge)
                flip_bump = float(getattr(settings, "FLIP_CONFLUENCE_BUMP", 0.15))
                if (
                    self._last_firm_dir
                    and lean
                    and lean != self._last_firm_dir
                    and abs_score >= max(threshold * (1.20 + flip_bump), 0.28)
                    and abs(score - self._last_firm_score) >= 0.30
                ):
                    direction = "SWAP"
                    conf = int(min(95, conf + 4))
                    summary = (
                        f"Regime flip {self._last_firm_dir}→{lean} – SWAP "
                        f"(paper signal · not execution advice) · "
                        f"new path needs Kalshi +{full_pts:g} pts"
                    )
                    if pair_bits:
                        summary += " · " + ", ".join(pair_bits[:2])
                elif (
                    self._last_firm_dir
                    and lean
                    and lean != self._last_firm_dir
                ):
                    # Not enough edge to flip — stay WAIT instead of flipping into a loss
                    direction = "WAIT"
                    conf = max(conf, 70)
                    summary = (
                        f"Flip blocked – need stronger confluence to reverse "
                        f"{self._last_firm_dir} (score {abs_score:.2f} < bar)"
                    )
                    firm = False
                    lean = None

        elif abs_score >= hold_thr and abs_score * 100 >= (settings.HOLD_CONFIDENCE_FLOOR / 100.0) * 40:
            # 1/4 HOLD scalp — weaker confluence, smaller Kalshi path target
            firm = True
            lean = "UP" if score > 0 else "DOWN"
            direction = ("UP_HOLD" if lean == "UP" else "DOWN_HOLD")  # type: ignore[assignment]
            conf = int(min(78, max(settings.HOLD_CONFIDENCE_FLOOR, 42 + abs_score * 50)))
            label = "1/4 UP HOLD" if lean == "UP" else "1/4 DOWN HOLD"
            summary = (
                f"Partial confluence – {label} · "
                f"Kalshi +{hold_pts:g} pts path = right (¼ scalp, finish not required)"
            )
            if pair_bits:
                summary += " · " + ", ".join(pair_bits[:1])


        # --- Path-aware confidence (zero new data) ---
        # Use remaining time + current Kalshi mid vs lean to raise/lower confidence.
        # More path room left + mid already moving our way → boost.
        # Little room left or adverse mid → dampen or WAIT.
        if firm and lean in ("UP", "DOWN") and direction not in ("WAIT",):
            up_mid = None
            if regime_features:
                try:
                    up_mid = regime_features.get("up_pct")
                    if up_mid is not None:
                        up_mid = float(up_mid)
                        if up_mid <= 1.5:  # probability form
                            up_mid *= 100.0
                except Exception:
                    up_mid = None

            path_notes = []
            # Remaining path room (minutes)
            if mins_left is not None:
                if mins_left >= 8:
                    conf = min(94, conf + 3)
                    path_notes.append("path-room+")
                elif mins_left <= 3.5:
                    conf = max(48, conf - 8)
                    path_notes.append("path-room-")
                    # Very late with weak score → demote to WAIT
                    if abs_score < threshold * 1.15 and mins_left <= 2.5:
                        direction = "WAIT"
                        firm = False
                        conf = max(conf, 72)
                        summary = f"Path-aware: too late for clean scalp ({mins_left:.1f}m left)"
                        lean = None
                        path_notes.append("late-kill")

            # Current Kalshi mid vs lean direction
            if up_mid is not None and lean in ("UP", "DOWN") and direction not in ("WAIT",):
                # How much has the side already moved toward us from 50?
                if lean == "UP":
                    progress = up_mid - 50.0  # positive = already going our way
                else:
                    progress = 50.0 - up_mid
                features_progress = progress
                # Already 8+ pts in our favor with time left → high confidence path continuation
                if progress >= 8 and mins_left is not None and mins_left >= 4:
                    conf = min(95, conf + 6)
                    path_notes.append(f"path-progress +{progress:.0f}")
                elif progress >= 4:
                    conf = min(93, conf + 3)
                    path_notes.append(f"path-progress +{progress:.0f}")
                elif progress <= -6:
                    # Adverse path — mid moved against us
                    conf = max(48, conf - 12)
                    path_notes.append(f"adverse-path {progress:.0f}")
                    if progress <= -10 and abs_score < threshold * 1.25:
                        direction = "WAIT"
                        firm = False
                        conf = max(conf, 70)
                        summary = f"Path-aware: adverse mid ({up_mid:.0f}¢) vs {lean} lean"
                        lean = None
                        path_notes.append("adverse-kill")

            if path_notes and direction not in ("WAIT",):
                summary += " · " + ", ".join(path_notes[:3])


        # --- Per-window single lock (GOAL CONTRACT: one call max, best odds only) ---
        ticker = None
        mins_left = None
        up_pct = None
        if regime_features:
            ticker = regime_features.get("ticker") or regime_features.get("market_ticker")
            mins_left = regime_features.get("mins_left")
            up_pct = regime_features.get("up_pct")
        try:
            if mins_left is not None:
                mins_left = float(mins_left)
        except (TypeError, ValueError):
            mins_left = None
        try:
            if up_pct is not None:
                up_pct = float(up_pct)
        except (TypeError, ValueError):
            up_pct = None

        # Window identity: prefer close_time so ATM strike/ticker hops do NOT clear the lock
        window_id = None
        if regime_features:
            window_id = regime_features.get("close_time") or regime_features.get("window_id")
        if not window_id:
            window_id = ticker
        window_id = str(window_id) if window_id else None

        if window_id and self._locked_window and window_id != self._locked_window:
            # True new hourly window → clear
            self._clear_window_lock()
        elif ticker and self._locked_ticker and ticker != self._locked_ticker and self._entry_dir:
            # Same window, market ticker hopped (ATM ladder) — keep lock, update ticker tag
            self._locked_ticker = ticker

        call_phase = None
        max_odds = float(getattr(settings, "PLAYABLE_MID_MAX", getattr(settings, "MAX_ENTRY_ODDS_PCT", 90.0)))

        # Resolve underlying lean from HOLD/SWAP so we can lock a single side
        if lean not in ("UP", "DOWN"):
            if direction in ("UP", "UP_HOLD"):
                lean = "UP"
            elif direction in ("DOWN", "DOWN_HOLD"):
                lean = "DOWN"

        # Any firm directional (full OR HOLD) can open the one-call lock
        is_directional = (
            direction in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD")
            and lean in ("UP", "DOWN")
            and firm
        )

        # Explore paper path: lock from a lean even if confluence is 1/4 or top-3 conflict.
        # PAPER only — does not arm Follower or loosen live gates.
        rel_n = 0
        try:
            rel_n = int((self.edge or {}).get("reliability_n") or (self.edge or {}).get("total") or 0)
        except (TypeError, ValueError):
            rel_n = 0
        if regime_features and regime_features.get("reliability_n") is not None:
            try:
                rel_n = int(regime_features["reliability_n"])
            except (TypeError, ValueError):
                pass
        learn_phase = str(
            (regime_features or {}).get("learning_phase")
            or bars.get("phase")
            or ""
        ).lower()
        explore_open = explore_paper_lock_open(learn_phase, rel_n)
        if lean not in ("UP", "DOWN") and score is not None:
            try:
                if float(score) > 0:
                    lean = "UP"
                elif float(score) < 0:
                    lean = "DOWN"
            except (TypeError, ValueError):
                pass
        explore_paper = bool(
            explore_open
            and lean in ("UP", "DOWN")
            and ticker
            and not (self._entry_dir or self._active_dir())
        )
        paper_lock_candidate = bool(is_directional or explore_paper)

        # Chosen-side market odds (¢)
        side_odds = None
        if lean in ("UP", "DOWN") and up_pct is not None:
            side_odds = float(up_pct) if lean == "UP" else (100.0 - float(up_pct))
        # Shadow pick keeps the intended side even if the counting lock WAITs.
        shadow_side = lean if lean in ("UP", "DOWN") else None
        shadow_conf = int(conf) if conf is not None else 0
        shadow_vetoed = False

        edge = self._price_edge(conf, lean, side_odds, regime_features)
        p_finish = edge["p_finish"]
        ev_cents = edge["ev_cents"]
        ev_phase = edge["phase"]
        self._last_p_finish = p_finish
        self._last_ev_cents = ev_cents
        self._last_ev_phase = ev_phase
        eth_n_for_lock = 0
        if regime_features:
            if regime_features.get("eth_settled_n") is not None:
                try:
                    eth_n_for_lock = int(regime_features["eth_settled_n"])
                except (TypeError, ValueError):
                    eth_n_for_lock = 0
            elif str(regime_features.get("asset") or "").upper() in ("ETH", "ETHEREUM"):
                try:
                    eth_n_for_lock = int(regime_features.get("settled_n") or 0)
                except (TypeError, ValueError):
                    eth_n_for_lock = 0

        # ══════════════════════════════════════════════════════════════
        # GOAL CONTRACT: one irreversible call per window. No flipping.
        # Hold even if ticker is briefly missing this cycle.
        # ══════════════════════════════════════════════════════════════
        if self._entry_dir or self._active_dir():
            self._lean_pending_dir = None
            self._lean_pending_since = 0.0
            active = self._active_dir()
            direction = active  # type: ignore[assignment]
            lean = active
            firm = True
            conf = max(int(conf), self._active_conf())
            summary = f"Lock held {active} · irreversible · one call · specialists monitoring"
            if gate_notes:
                summary += " · " + ", ".join(gate_notes[:2])
            call_phase = None
            if ticker:
                self._locked_ticker = ticker
            if window_id:
                self._locked_window = window_id

        elif paper_lock_candidate and ticker:
            # No lock yet → try to open the single ENTRY lock
            # Fresh-quote gate: never ENTRY on stale / unhealthy Kalshi
            import time as _time
            stale_mkt = bool(regime_features.get("stale")) if regime_features else False
            kalshi_ok = True if not regime_features else bool(regime_features.get("kalshi_healthy", True))
            fetched_at = regime_features.get("kalshi_fetched_at") if regime_features else None
            age_s = None
            try:
                if fetched_at is not None:
                    age_s = max(0.0, _time.time() - float(fetched_at))
            except (TypeError, ValueError):
                age_s = None
            max_age = float(getattr(settings, "KALSHI_MAX_QUOTE_AGE_S", 25.0))
            quote_stale = (age_s is not None and age_s > max_age) or stale_mkt or (not kalshi_ok)
            try:
                from backend.learning.btc15m import early_no_lock_mins_for, timeframe_gates, window_label
                _tf = timeframe_gates(
                    window_minutes=(regime_features or {}).get("window_minutes"),
                    ticker=(regime_features or {}).get("ticker") or ticker,
                    series=(regime_features or {}).get("series_ticker"),
                    asset=(regime_features or {}).get("asset"),
                )
                _sit_m = float(_tf.get("early_no_lock_mins") or early_no_lock_mins_for(
                    window_minutes=(regime_features or {}).get("window_minutes"),
                    ticker=(regime_features or {}).get("ticker") or ticker,
                    series=(regime_features or {}).get("series_ticker"),
                    asset=(regime_features or {}).get("asset"),
                ))
                _wlab = window_label(
                    (regime_features or {}).get("window_minutes"),
                    (regime_features or {}).get("ticker") or ticker,
                    (regime_features or {}).get("series_ticker"),
                    (regime_features or {}).get("asset"),
                )
                _band_hi = float(_tf.get("band_hi") or 80.0)
                _late_vol = float(_tf.get("late_vol_pct") or 0.40)
                _win_mins = float(_tf.get("window_minutes") or (regime_features or {}).get("window_minutes") or 60.0)
                max_odds = _band_hi
            except Exception:
                _sit_m = float(getattr(settings, "EARLY_NO_LOCK_MINS", 10.0))
                _wlab = "1H WINDOW"
                _band_hi = float(getattr(settings, "PLAYABLE_MID_MAX", 90.0))
                _late_vol = float(getattr(settings, "LATE_HOURLY_VOL_PCT", 0.40))
                _win_mins = float((regime_features or {}).get("window_minutes") or 60.0)

            if quote_stale:
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 70)
                age_txt = f"{age_s:.0f}s old" if age_s is not None else "stale"
                summary = (
                    f"WAIT · fresh quote required ({age_txt}) — no lock on stale Kalshi · {summary}"
                )
            elif early_lock_blocked(
                (regime_features or {}).get("mins_left"),
                (regime_features or {}).get("window_minutes") or _win_mins,
                _sit_m,
            ):
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 68)
                summary = (
                    f"WAIT · first {_sit_m:.0f}m of the {_wlab.replace(' WINDOW', '').lower()} "
                    f"— no lock · {summary}"
                )
            elif chair_ticker_blocked(
                strike=(regime_features or {}).get("floor_strike"),
                spot=(
                    (regime_features or {}).get("spot_price")
                    or (regime_features or {}).get("current_price")
                    or (regime_features or {}).get("research_spot")
                ),
                asset=(regime_features or {}).get("asset"),
                ticker=ticker,
            ):
                why = chair_ticker_blocked(
                    strike=(regime_features or {}).get("floor_strike"),
                    spot=(
                        (regime_features or {}).get("spot_price")
                        or (regime_features or {}).get("current_price")
                        or (regime_features or {}).get("research_spot")
                    ),
                    asset=(regime_features or {}).get("asset"),
                    ticker=ticker,
                )
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 68)
                summary = f"WAIT · {why} — no lock · {summary}"
            elif never_lock_near_certain(
                (regime_features or {}).get("yes_ask"),
                (regime_features or {}).get("no_ask"),
                side_odds=side_odds,
            ):
                why = never_lock_near_certain(
                    (regime_features or {}).get("yes_ask"),
                    (regime_features or {}).get("no_ask"),
                    side_odds=side_odds,
                )
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 72)
                summary = f"WAIT · {why} — no lock · {summary}"
            elif dead_book_reason(
                (regime_features or {}).get("book_depth") if isinstance((regime_features or {}).get("book_depth"), dict) else None,
                lean,
                (regime_features or {}).get("yes_mid"),
                _band_hi,
                ticker=ticker,
                asset=(regime_features or {}).get("asset"),
                window_minutes=_win_mins,
            ):
                why = dead_book_reason(
                    (regime_features or {}).get("book_depth") if isinstance((regime_features or {}).get("book_depth"), dict) else None,
                    lean,
                    (regime_features or {}).get("yes_mid"),
                    _band_hi,
                    ticker=ticker,
                    asset=(regime_features or {}).get("asset"),
                    window_minutes=_win_mins,
                )
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 72)
                summary = f"WAIT · dead book · {why} — no lock · {summary}"
            elif ev_phase == "late" and not late_spot_decisive(
                last15_spot({
                    "spot": (regime_features or {}).get("research_spot")
                    or (regime_features or {}).get("cfb_avg_60s"),
                    "kind": (regime_features or {}).get("research_spot_kind")
                    or (regime_features or {}).get("kind"),
                }),
                (regime_features or {}).get("floor_strike"),
                (regime_features or {}).get("mins_left"),
                _late_vol,
                window_minutes=_win_mins,
            ):
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 70)
                late_txt = "last 2.5m of the 15m" if _win_mins <= 20 else "last 15m"
                summary = (
                    f"WAIT · {late_txt} — 60s CFB avg not decisive vs strike · {summary}"
                )
            elif (regime_features or {}).get("btc_fade_blocked") or eth_fades_btc_impulse(
                lean, (regime_features or {}).get("btc_lead")
            ):
                shadow_vetoed = True
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 70)
                summary = (
                    f"WAIT · ETH fade of BTC impulse blocked · {summary}"
                )
            elif eth_paper_lock_blocked(
                (regime_features or {}).get("asset"),
                eth_n_for_lock,
            ):
                why = eth_paper_lock_blocked(
                    (regime_features or {}).get("asset"),
                    eth_n_for_lock,
                )
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 70)
                summary = f"WAIT · {why} — ETH may still vote · {summary}"
            elif side_odds is not None and side_odds >= max_odds:
                refused_side = lean
                direction = "WAIT"
                lean = None
                firm = False
                conf = max(int(conf), 72)
                summary = (
                    f"WAIT · GOAL CONTRACT · {refused_side} already {side_odds:.0f}¢ "
                    f"(≥{max_odds:.0f}¢) — low edge, no lock · {summary}"
                )
            else:
                # Soft preferred band 40–65¢ + hourly timing bias
                pref_lo = float(getattr(settings, "PREFERRED_ENTRY_ODDS_MIN", 40.0))
                pref_hi = float(getattr(settings, "PREFERRED_ENTRY_ODDS_MAX", 65.0))
                in_band = side_odds is None or (pref_lo <= float(side_odds) <= pref_hi)
                thr = self.adaptive_thresholds()
                need = float(thr.get("confluence", 0.55) or 0.55)
                if not in_band:
                    need = max(need, need * 1.18)
                ml = None
                try:
                    if regime_features and regime_features.get("mins_left") is not None:
                        ml = float(regime_features["mins_left"])
                except (TypeError, ValueError):
                    ml = None
                if ml is not None:
                    hard_early = float(getattr(settings, "HOURLY_HARD_EARLY_MIN", 45.0))
                    early = float(getattr(settings, "HOURLY_EARLY_MIN", 35.0))
                    late = float(getattr(settings, "HOURLY_LATE_MIN", 20.0))
                    if ml >= hard_early:
                        need = max(need, need * 1.25)
                    elif ml >= early:
                        need = max(need, need * 1.12)
                    elif ml <= late:
                        need = need * 0.92
                abs_score = abs(float(score)) if score is not None else 0.0
                zach_mid = (regime_features or {}).get("yes_mid")
                if zach_mid is None:
                    zach_mid = side_odds
                leftover = ev_cents
                if leftover is None and p_finish is not None:
                    fill = odds_to_cents((regime_features or {}).get("side_ask"))
                    if fill is None:
                        fill = odds_to_cents(side_odds)
                    if fill is not None:
                        leftover = leftover_after_vig(float(p_finish), float(fill))
                # 10–90 + leftover after vig is playable. Do not shrink to 45–55.
                # Explore paper: skip 4-category / preferred-band confluence extras.
                skip_conf_extras = bool(explore_paper)
                if (
                    not skip_conf_extras
                    and abs_score < need
                    and not in_band
                    and not zach_band_skips_preferred(zach_mid, leftover)
                ):
                    direction = "WAIT"
                    lean = None
                    firm = False
                    conf = max(int(conf), 68)
                    summary = (
                        f"WAIT · odds {float(side_odds):.0f}¢ outside preferred "
                        f"{pref_lo:.0f}–{pref_hi:.0f}¢ — need stronger confluence · {summary}"
                    )
                elif (
                    not skip_conf_extras
                    and abs_score < need * 0.95
                    and ml is not None
                    and ml >= early
                ):
                    direction = "WAIT"
                    lean = None
                    firm = False
                    conf = max(int(conf), 70)
                    summary = (
                        f"WAIT · early hour ({ml:.0f}m left) — patience · {summary}"
                    )
                else:
                    import time as _t2
                    # --- Spread gate ---
                    spread = None
                    try:
                        if regime_features and regime_features.get("spread_cents") is not None:
                            spread = float(regime_features["spread_cents"])
                    except (TypeError, ValueError):
                        spread = None
                    max_spread = float(getattr(settings, "MAX_SPREAD_CENTS", 5.0))
                    if spread is not None and spread > max_spread:
                        direction = "WAIT"
                        lean = None
                        firm = False
                        conf = max(int(conf), 68)
                        summary = (
                            f"WAIT · spread {spread:.1f}¢ > {max_spread:.0f}¢ — no lock · {summary}"
                        )
                    else:
                        # --- Book depth: wide already gated; thin size → WAIT ---
                        depth = None
                        if regime_features:
                            depth = regime_features.get("book_depth")
                            if not isinstance(depth, dict):
                                depth = parse_book_depth(
                                    regime_features.get("kalshi_orderbook")
                                    or regime_features.get("orderbook")
                                )
                        min_book = float(getattr(settings, "MIN_BOOK_SIZE", 5.0))
                        thin_book = book_too_thin(depth, lean, min_book)
                        if thin_book:
                            direction = "WAIT"
                            lean = None
                            firm = False
                            conf = max(int(conf), 68)
                            summary = (
                                f"WAIT · thin book (need ≥{min_book:.0f} size) — no lock · {summary}"
                            )
                        elif side_odds is None or p_finish is None or ev_cents is None:
                            direction = "WAIT"
                            lean = None
                            firm = False
                            conf = max(int(conf), 68)
                            summary = (
                                f"WAIT · no chosen-side mid — cannot price EV · {summary}"
                            )
                        elif explore_paper and not explore_paper_lock_ok(
                            p_finish, ev_cents, zach_mid
                        ):
                            direction = "WAIT"
                            lean = None
                            firm = False
                            conf = max(int(conf), 70)
                            if p_finish < float(getattr(settings, "EXPLORE_PAPER_MIN_P", 0.55)):
                                summary = (
                                    f"WAIT · P(finish) {p_finish:.2f} < "
                                    f"{float(getattr(settings, 'EXPLORE_PAPER_MIN_P', 0.55)):.2f}"
                                    f" — no lock · {summary}"
                                )
                            else:
                                summary = (
                                    f"WAIT · EV {ev_cents:.1f}¢ < 0 after half-spread"
                                    f" — no lock · {summary}"
                                )
                        elif (not explore_paper) and ev_gate_blocks(
                            p_finish, ev_cents, edge["min_p"], edge["min_ev"]
                        ):
                            direction = "WAIT"
                            lean = None
                            firm = False
                            conf = max(int(conf), 70)
                            phase_txt = f" · {ev_phase}" if ev_phase and ev_phase != "middle" else ""
                            if p_finish < float(edge["min_p"]):
                                summary = (
                                    f"WAIT · P(finish) {p_finish:.2f} < {edge['min_p']:.2f}"
                                    f"{phase_txt} — no lock · {summary}"
                                )
                            else:
                                summary = (
                                    f"WAIT · EV {ev_cents:.1f}¢ < {edge['min_ev']:.1f}¢"
                                    f"{phase_txt} — no lock · {summary}"
                                )
                        else:
                            locks_today = 0
                            try:
                                if regime_features and regime_features.get("paper_locks_today") is not None:
                                    locks_today = int(regime_features["paper_locks_today"])
                            except (TypeError, ValueError):
                                locks_today = 0
                            if explore_paper and not paper_lock_day_ok(locks_today):
                                direction = "WAIT"
                                lean = None
                                firm = False
                                conf = max(int(conf), 68)
                                summary = (
                                    f"WAIT · paper lock rate {locks_today} today"
                                    f" — a few per day · {summary}"
                                )
                            else:
                                # --- Anti-chase: side mid jumped toward lean recently ---
                                chased = False
                                try:
                                    now = _t2.time()
                                    look = float(getattr(settings, "ANTI_CHASE_LOOKBACK_S", 180.0))
                                    thr_pts = float(getattr(settings, "ANTI_CHASE_PTS", 4.0))
                                    if side_odds is not None:
                                        self._odds_hist.append((now, float(side_odds), lean))
                                        self._odds_hist = [h for h in self._odds_hist if now - h[0] <= look]
                                        old = [h for h in self._odds_hist if h[2] == lean and now - h[0] >= min(30.0, look * 0.3)]
                                        if old:
                                            oldest = old[0][1]
                                            delta = float(side_odds) - float(oldest)
                                            if delta >= thr_pts:
                                                chased = True
                                except Exception:
                                    chased = False
                                if chased:
                                    direction = "WAIT"
                                    lean = None
                                    firm = False
                                    conf = max(int(conf), 70)
                                    summary = (
                                        f"WAIT · anti-chase — side already ran {thr_pts:.0f}¢+ · {summary}"
                                    )
                                else:
                                    # Two-stage hold stays for live / calibrate.
                                    # Explore paper locks this cycle (daily rate already capped).
                                    hold_s = 0.0 if explore_paper else float(getattr(settings, "TWO_STAGE_HOLD_S", 12.0))
                                    now = _t2.time()
                                    if hold_s > 0 and self._lean_pending_dir != lean:
                                        self._lean_pending_dir = lean
                                        self._lean_pending_since = now
                                        self._lean_pending_conf = int(conf)
                                        direction = "WAIT"
                                        firm = False
                                        conf = max(int(conf), 65)
                                        summary = (
                                            f"LEAN {lean} · holding {hold_s:.0f}s before lock · {summary}"
                                        )
                                    elif hold_s > 0 and (now - float(self._lean_pending_since or now)) < hold_s:
                                        left = hold_s - (now - float(self._lean_pending_since))
                                        direction = "WAIT"
                                        firm = False
                                        conf = max(int(conf), 65)
                                        summary = (
                                            f"LEAN {lean} · {left:.0f}s to lock · {summary}"
                                        )
                                    else:
                                        lock_dir = lean
                                        lock_conf = int(conf)
                                        if p_finish is not None:
                                            lock_conf = min(
                                                lock_conf,
                                                max(1, int(round(float(p_finish) * 100.0))),
                                            )
                                        conf = lock_conf
                                        self._set_window_lock(
                                            ticker, lock_dir, lock_conf, score, up_pct=up_pct, call_phase="entry"
                                        )
                                        self._locked_p_finish = p_finish
                                        self._locked_ev_cents = ev_cents
                                        try:
                                            fs = (
                                                regime_features.get("floor_strike")
                                                if regime_features else None
                                            )
                                            self._locked_floor_strike = float(fs) if fs is not None else None
                                        except (TypeError, ValueError):
                                            self._locked_floor_strike = None
                                        ct = (
                                            regime_features.get("close_time")
                                            if regime_features else None
                                        )
                                        self._locked_close_time = str(ct) if ct else None
                                        self._lean_pending_dir = None
                                        self._lean_pending_since = 0.0
                                        call_phase = "entry"
                                        direction = lock_dir  # type: ignore[assignment]
                                        odds_str = f" @ {side_odds:.0f}¢" if side_odds is not None else ""
                                        ev_str = f" · EV {ev_cents:.1f}¢" if ev_cents is not None else ""
                                        paper_bit = " · PAPER explore" if explore_paper else ""
                                        goal_txt = GOAL_CONTRACT_SHORT
                                        try:
                                            from backend.learning.btc15m import goal_short_for
                                            goal_txt = goal_short_for(
                                                asset=(regime_features or {}).get("asset"),
                                                ticker=(regime_features or {}).get("ticker") or ticker,
                                                series=(regime_features or {}).get("series_ticker"),
                                                window_minutes=(regime_features or {}).get("window_minutes"),
                                            )
                                        except Exception:
                                            pass
                                        summary = (
                                            f"LOCKED {lock_dir}{odds_str}{ev_str}{paper_bit} · ONE CALL · FOLLOW THIS · "
                                            f"{goal_txt} · {summary}"
                                        )

        elif direction == "SWAP" and not (self._entry_dir or self._active_dir()):
            # SWAP with no lock → WAIT (no flip noise)
            direction = "WAIT"
            lean = None
            firm = False
            summary = f"WAIT · SWAP suppressed under one-call mode · {summary}"

        # Remember last firm directional lean
        if firm and lean in ("UP", "DOWN"):
            self._last_firm_dir = lean
            self._last_firm_score = score

        if direction == "WAIT":
            self.wait_calls += 1
        else:
            self.directional_calls += 1

        self.signal_count += 1
        total_calls = max(1, self.wait_calls + self.directional_calls)
        live_lean = lean if lean in ("UP", "DOWN") else self._active_dir()
        live_odds = side_odds
        if live_odds is None and live_lean in ("UP", "DOWN") and up_pct is not None:
            live_odds = float(up_pct) if live_lean == "UP" else (100.0 - float(up_pct))
        live_edge = self._price_edge(conf, live_lean, live_odds, regime_features)
        # Keep the priced edge on WAIT so /api/state still shows why we stood down
        p_finish = live_edge["p_finish"] if live_edge["p_finish"] is not None else self._last_p_finish
        ev_cents = live_edge["ev_cents"] if live_edge["ev_cents"] is not None else self._last_ev_cents
        ev_phase = live_edge["phase"] if live_edge["p_finish"] is not None else (self._last_ev_phase or live_edge["phase"])
        self._last_p_finish = p_finish
        self._last_ev_cents = ev_cents
        self._last_ev_phase = ev_phase
        locked_call = self._build_locked_call()
        if locked_call and p_finish is not None and locked_call.get("p_finish") is None:
            locked_call["p_finish"] = p_finish
        if locked_call and ev_cents is not None and locked_call.get("ev_cents") is None:
            locked_call["ev_cents"] = ev_cents
        eth_pick = None
        btc_pick = None
        try:
            asset = (regime_features or {}).get("asset")
            if shadow_side in ("UP", "DOWN"):
                ask = None
                if regime_features:
                    if shadow_side == "UP":
                        ask = regime_features.get("yes_ask") or regime_features.get("side_ask")
                    else:
                        ask = regime_features.get("no_ask") or regime_features.get("side_ask")
                if ask is None:
                    ask = live_odds
                kwargs = dict(
                    asset=asset,
                    side=shadow_side,
                    conf=shadow_conf,
                    ask=ask,
                    strike=(regime_features or {}).get("floor_strike"),
                    vetoed=shadow_vetoed,
                    ticker=ticker,
                )
                eth_pick = eth_shadow_pick(**kwargs)
                btc_pick = btc_shadow_pick(**kwargs)
        except Exception:
            eth_pick = None
            btc_pick = None
        return {
            "direction": direction,
            "confidence": conf,
            "summary": self._clean_summary(summary),
            "score": round(score, 4),
            "diversity": diversity,
            "aggressiveness": aggressiveness,
            "threshold_used": round(threshold, 3),
            "threshold_base": round(bars["confluence"], 3),
            "phase": bars.get("phase", "learned"),
            "dir_conf_bar": round(dir_conf_bar, 1),
            "pair_bonus": round(pair_bonus, 4),
            "regime_key": regime_key,
            "regime_weights": {k: round(v, 4) for k, v in list(regime_weights.items())[:16]},
            "pair_notes": pair_bits,
            "edge_score": locals().get("edge_score", int(min(100, abs(score) * 100))),
            "top_agree": bool(locals().get("top_agree", False)),
            "top_conflict": bool(locals().get("top_conflict", False)),
            "lean": lean,  # underlying UP/DOWN when direction is SWAP
            "window_locked": bool(self._entry_dir or self._locked_dir),
            "locked_dir": self._active_dir(),
            "entry_dir": self._entry_dir,
            "mid_dir": self._mid_dir,
            "final_dir": self._final_dir,
            "entry_up_pct": self._entry_up_pct,
            "revisions_used": int(getattr(self, "_revisions_used", 0) or 0),
            "call_phase": locals().get("call_phase"),
            # Follower-bot ready: only present when a real lock exists
            "locked_call": locked_call,
            "eth_shadow_pick": eth_pick,
            "btc_shadow_pick": btc_pick,
            "p_finish": p_finish,
            "ev_cents": ev_cents,
            "ev_phase": ev_phase,
            "explore_paper": bool(locals().get("explore_paper", False)),
            "paper_only": True,
            "floor_strike": (
                self._locked_floor_strike
                if self._locked_floor_strike is not None
                else (regime_features or {}).get("floor_strike")
            ),
            "agent_details": details,
            "weights": {k: round(v, 3) for k, v in self.weights.items()},
            "learning": self.learner.snapshot(),
            "signal_index": self.signal_count,
            "wait_rate": round(self.wait_calls / total_calls, 3),
            "edge": dict(self.edge),
        }

    def _wait_result(self, reason: str, conf: int) -> Dict[str, Any]:
        return {
            "direction": "WAIT",
            "confidence": conf,
            "summary": reason,
            "score": 0.0,
            "diversity": 0,
            "aggressiveness": 1.0,
            "threshold_used": settings.MIN_CONFLUENCE_SCORE,
            "pair_bonus": 0.0,
            "pair_notes": [],
            "locked_call": self._build_locked_call(),
            "eth_shadow_pick": None,
            "btc_shadow_pick": None,
            "p_finish": self._last_p_finish,
            "ev_cents": self._last_ev_cents,
            "ev_phase": self._last_ev_phase,
            "agent_details": [],
            "weights": {k: round(v, 3) for k, v in self.weights.items()},
            "learning": self.learner.snapshot(),
            "signal_index": self.signal_count,
        }
