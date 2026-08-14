"""
The Chair / Leader – confluence synthesis + adaptive weighting.

Weights drift with each bot's historical correctness.
When historically strong coalitions agree again, their joint vote
gets an affinity bonus — the Chair "remembers" who is right together.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import AgentSignal, Direction
from backend.config import settings
from backend.learning.adaptive import AdaptiveLearner, NON_VOTERS
from backend.agents.roster import display_name
from loguru import logger
import copy


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

    def _normalize_weights(self) -> None:
        total = sum(self.weights.values()) or 1.0
        self.weights = {k: v / total for k, v in self.weights.items()}


    def _clear_window_lock(self) -> None:
        self._locked_ticker = None
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
        """Set or revise the Chair lock for this ticker (entry / mid / final)."""
        if direction in ("UP", "UP_HOLD"):
            side = "UP"
        elif direction in ("DOWN", "DOWN_HOLD"):
            side = "DOWN"
        else:
            return
        if not ticker:
            return
        import time
        now = time.time()
        if ticker != self._locked_ticker:
            self._clear_window_lock()
            self._locked_ticker = ticker

        if call_phase == "entry" or not self._entry_dir:
            self._entry_dir = side
            self._entry_conf = int(conf)
            self._entry_score = float(score)
            self._entry_up_pct = float(up_pct) if up_pct is not None else None
            self._entry_at = now
        elif call_phase == "mid" and self._mid_dir is None and self._revisions_used < 2:
            self._mid_dir = side
            self._mid_conf = int(conf)
            self._mid_at = now
            self._revisions_used += 1
        elif call_phase == "final" and self._final_dir is None and self._revisions_used < 2:
            self._final_dir = side
            self._final_conf = int(conf)
            self._final_at = now
            self._revisions_used += 1
        else:
            # reinforce active side without spending a revision
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
        Opposite side blocked unless hysteresis clears AND a revision slot is open.
        """
        if not getattr(settings, "WINDOW_LOCK_ENABLED", True):
            return False, "", None
        if not ticker or not lean or lean not in ("UP", "DOWN"):
            return False, "", None
        if self._locked_ticker != ticker or not self._active_dir():
            return False, "", None
        active = self._active_dir()
        if lean == active:
            return False, "", None

        # Phase from minutes left
        if mins_left is None:
            phase = "entry"
        elif mins_left > 10.0:
            phase = "entry"
        elif mins_left > 5.0:
            phase = "mid"
        else:
            phase = "final"

        # Entry is immutable once set — only mid/final can revise
        if not self._entry_dir:
            return False, "", "entry"

        can_mid = phase == "mid" and self._mid_dir is None and self._revisions_used < 2
        can_final = phase == "final" and self._final_dir is None and self._revisions_used < 2
        if not can_mid and not can_final:
            return True, f"lock held {active} · no revision slot in {phase}", None

        hysteresis = float(getattr(settings, "HYSTERESIS_BAND", 14))
        min_delta = float(getattr(settings, "FLIP_MIN_CONF_DELTA", 18))
        min_gap = float(getattr(settings, "FLIP_MIN_GAP_SEC", 90.0))

        import time
        locked_conf = self._active_conf()
        locked_at = self._final_at or self._mid_at or self._entry_at or self._locked_at or 0.0
        age = time.time() - locked_at
        conf_ok = conf >= (locked_conf + hysteresis)
        delta_ok = conf >= (locked_conf + min_delta)
        gap_ok = age >= min_gap

        if conf_ok and delta_ok and gap_ok:
            return False, "", ("mid" if can_mid else "final")

        return True, (
            f"lock held {active} "
            f"(need +{hysteresis:.0f} conf / Δ{min_delta:.0f}, "
            f"have conf {conf} vs locked {locked_conf})"
        ), None

    def update_edge_from_accuracy(self, accuracy: Dict[str, Any] | None) -> None:
        """Feed lifetime log stats so confluence bar can loosen or tighten."""
        if not accuracy:
            return
        self.cool_down_bump: float = 0.0
        self.edge = {
            "total": int(accuracy.get("total") or 0),
            "accuracy_pct": accuracy.get("accuracy_pct"),
            "last_20_pct": (accuracy.get("last_20") or {}).get("accuracy_pct"),
            "verdict": accuracy.get("verdict") or "COLLECTING",
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
            # Bad recent form → stricter (learning from pain)
            if l20 is not None and l20 < 45 and n >= min_n + 4:
                thr += 0.10
                conf_bar += 5.0
            elif l20 is not None and l20 < 48 and n >= min_n + 4:
                thr += 0.05
                conf_bar += 2.5

        # Nightly huddle cool-down: fewer noise calls 3–4 AM CT
        bump = float(getattr(self, "cool_down_bump", 0.0) or 0.0)
        if bump:
            thr = thr + bump
            conf_bar = conf_bar + bump * 40

        thr = max(floor, min(ceil, thr))
        conf_bar = max(conf_floor, min(conf_ceil, conf_bar))
        return {"confluence": thr, "dir_conf": conf_bar, "phase": phase, "n": n}

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

    def synthesize(
        self,
        signals: List[AgentSignal],
        regime_features: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        Core confluence logic with adaptive weights + pair affinity.
        """
        self.sync_from_learner()

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
            })

        # Cap total influence of inverted (faded) bots so one loser can't steer the Chair
        max_share = float(getattr(settings, "FADE_MAX_WEIGHT_SHARE", 0.18))
        inv = [d for d in details if d.get("invert")]
        if inv and weight_sum > 0:
            inv_w = sum(float(d["weight"]) for d in inv)
            share = inv_w / weight_sum
            if share > max_share and inv_w > 0:
                scale = (max_share * weight_sum) / inv_w
                # Rebuild score with scaled invert weights
                score = 0.0
                weight_sum = 0.0
                for d in details:
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

        # Regime aggressiveness
        aggressiveness = 1.0
        if regime_features and "aggressiveness" in regime_features:
            aggressiveness = float(regime_features["aggressiveness"])
            aggressiveness = max(0.75, min(1.35, aggressiveness))


        # --- Research gates (KXBTC15M backtests) ---
        gate_notes = []
        mins_left = None
        if regime_features:
            try:
                mins_left = float(regime_features.get("mins_left")) if regime_features.get("mins_left") is not None else None
            except Exception:
                mins_left = None

        # Time-in-window gates (highest remaining accuracy lever for 15m path scalps)
        # Hard do-nothing zones + graduated dampen/boost so most noise calls die.
        mid_boost = float(getattr(settings, "MID_WINDOW_BOOST", 0.10))
        late_min = float(getattr(settings, "LATE_WINDOW_MIN", 2.8))
        early_min = float(getattr(settings, "EARLY_WINDOW_MIN", 13.2))
        hard_early = float(getattr(settings, "HARD_EARLY_MIN", 13.7))
        hard_late = float(getattr(settings, "HARD_LATE_MIN", 2.2))
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
            if sig and sig.direction in ("UP", "DOWN"):
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


        # --- Per-window Entry / Mid / Final lock ---
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

        # New ticker → clear previous lock
        if ticker and self._locked_ticker and ticker != self._locked_ticker:
            self._clear_window_lock()

        call_phase = None
        if firm and lean in ("UP", "DOWN") and direction not in ("WAIT",):
            if not self._entry_dir:
                # First firm call = ENTRY
                self._set_window_lock(ticker or "", direction, conf, score, up_pct=up_pct, call_phase="entry")
                call_phase = "entry"
                if self._entry_up_pct is not None:
                    summary = f"ENTRY {lean} @ {self._entry_up_pct:.0f}¢ · {summary}"
                else:
                    summary = f"ENTRY {lean} · {summary}"
            else:
                blocked, lock_reason, allowed_phase = self._lock_blocks_opposite(
                    ticker, lean, conf, score, mins_left=mins_left
                )
                if blocked:
                    active = self._active_dir()
                    if active:
                        direction = active  # type: ignore[assignment]
                        lean = active
                        conf = max(55, min(int(conf), self._active_conf()))
                        firm = True
                        summary = f"Lock held {active} · {lock_reason}"
                        if gate_notes:
                            summary += " · " + ", ".join(gate_notes[:2])
                    else:
                        direction = "WAIT"
                        firm = False
                        lean = None
                        conf = max(int(conf), 70)
                        summary = f"Flip blocked · {lock_reason}"
                else:
                    # Revision allowed
                    phase_to_use = allowed_phase or "mid"
                    self._set_window_lock(
                        ticker or "", direction, conf, score,
                        up_pct=up_pct, call_phase=phase_to_use,
                    )
                    call_phase = phase_to_use
                    summary = f"{phase_to_use.upper()} revise → {lean} · {summary}"
        elif self._active_dir() and direction == "WAIT":
            # Surface the held lock even on soft WAIT confluence
            active = self._active_dir()
            if active and firm is False:
                # keep WAIT if confluence truly weak; still annotate
                summary = f"Lock held {active} · {summary}"

        # Guardian caution (does not force WAIT — only trims confidence)
        guardian = next((s for s in signals if s.agent_name == "guardian"), None)
        if guardian and guardian.confidence > 70 and guardian.direction == "WAIT":
            if direction not in ("WAIT",):
                conf = max(42, conf - 12)
                summary += " (Guardian caution applied)"
            else:
                conf = max(conf, 75)

        # Remember last firm directional lean (UP/DOWN under SWAP/HOLD counts as lean)
        if firm and lean in ("UP", "DOWN"):
            self._last_firm_dir = lean
            self._last_firm_score = score

        if direction == "WAIT":
            self.wait_calls += 1
        else:
            self.directional_calls += 1

        self.signal_count += 1
        total_calls = max(1, self.wait_calls + self.directional_calls)
        return {
            "direction": direction,
            "confidence": conf,
            "summary": summary,
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
            "agent_details": [],
            "weights": {k: round(v, 3) for k, v in self.weights.items()},
            "learning": self.learner.snapshot(),
            "signal_index": self.signal_count,
        }
