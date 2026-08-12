"""
Adaptive learning for Satoshi's Council.

1. Individual weights drift with how often each bot is right.
2. Pair affinity: when two bots are right *together* more often,
   the Chair boosts their joint vote next time they agree.

All updates are gradual and bounded so one lucky streak doesn't dominate.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple
from loguru import logger

from backend.config import settings
from backend.agents.roster import display_name
from backend.learning.regime_keys import classify_regime, split_key

# Agents that never receive adaptive vote weight
NON_VOTERS = {"guardian", "law", "leader", "chair"}


def _pair_key(a: str, b: str) -> str:
    x, y = sorted([a, b])
    return f"{x}|{y}"


class AdaptiveLearner:
    """
    In-memory learning state, refreshed from settled history.
    Leader holds a reference and uses weights + affinities each cycle.
    """

    def __init__(self):
        self.weights: Dict[str, float] = {
            k: float(v) for k, v in settings.BASE_WEIGHTS.items()
            if k not in NON_VOTERS
        }
        self._normalize()
        # Per-agent track record
        self.correct: Dict[str, int] = defaultdict(int)
        self.wrong: Dict[str, int] = defaultdict(int)
        self.directional: Dict[str, int] = defaultdict(int)
        # Pair stats: times both agreed on a direction AND that direction was correct
        self.pair_hits: Dict[str, int] = defaultdict(int)
        self.pair_tries: Dict[str, int] = defaultdict(int)
        # Derived affinity 0..1
        self.pair_affinity: Dict[str, float] = {}
        # Anti-correlated pairs: disagreement history
        # anti_tries[key] = times A and B voted opposite
        # anti_right[key][agent] = times that agent was correct during disagreement
        self.anti_tries: Dict[str, int] = defaultdict(int)
        self.anti_right: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.updates: int = 0
        self.last_notes: List[str] = []
        # Calibration: conf bucket -> {hits, tries}
        self.calib_hits: Dict[str, int] = defaultdict(int)
        self.calib_tries: Dict[str, int] = defaultdict(int)
        self.agent_calib: Dict[str, Dict[str, list]] = defaultdict(lambda: {"hits": [], "confs": []})
        # Quorum: how many agreeing bots when the side was right
        self.quorum_size_hits: Dict[int, int] = defaultdict(int)
        self.quorum_size_tries: Dict[int, int] = defaultdict(int)
        # Combinations (2–5 agents) that were co-correct
        self.combo_hits: Dict[str, int] = defaultdict(int)
        self.combo_tries: Dict[str, int] = defaultdict(int)
        # Regime-split track records: regime_key -> agent -> count
        self.regime_correct: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.regime_wrong: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        # Blended regime weights cache (recomputed on learn)
        self.regime_weights: Dict[str, Dict[str, float]] = {}
        self.REGIME_BLEND: float = float(getattr(settings, 'REGIME_WEIGHT_BLEND', 0.55))
        self.REGIME_MIN_N: int = int(getattr(settings, 'REGIME_MIN_SAMPLES', 4))

    def _normalize(self) -> None:
        total = sum(self.weights.values()) or 1.0
        self.weights = {k: v / total for k, v in self.weights.items()}


    def learning_phase(self, chair_n: int | None = None) -> Dict[str, Any]:
        """
        Explore → Calibrate → Exploit schedule based on graded Chair samples.
        """
        n = int(chair_n if chair_n is not None else (sum(self.correct.values()) + sum(self.wrong.values())) // max(1, len(self.weights) or 1))
        cold = int(getattr(settings, "COLD_START_SAMPLES", 15))
        cal = int(getattr(settings, "CALIBRATE_SAMPLES", 20))
        exp = int(getattr(settings, "EXPLOIT_SAMPLES", 80))
        if n < cold:
            phase = "explore"
            note = "Loose bar — collecting path samples"
        elif n < exp:
            phase = "calibrate"
            note = "Medium bar — ranking bots & coalitions"
        else:
            phase = "exploit"
            note = "Tighter bar — protect proven edge"
        return {"phase": phase, "n": n, "note": note, "explore_until": cold, "exploit_after": exp}

    def hierarchy_ranks(self) -> List[Dict[str, Any]]:
        """
        Live hierarchy: bots ordered by how right they've been.
        Higher rank (#1) sits closer to the Chair and is listened to more.
        Score = Bayesian win-rate primary, then weight, then correct count.
        """
        voters = [
            k for k in self.weights.keys()
            if k not in NON_VOTERS
        ]
        # Include any base-weight voters not yet in weights
        for k in settings.BASE_WEIGHTS:
            if k not in NON_VOTERS and k not in voters:
                voters.append(k)

        rows = []
        for name in voters:
            c = int(self.correct.get(name, 0))
            w = int(self.wrong.get(name, 0))
            n = c + w
            # Prior 0.5 strength 4 — cold start stays mid-pack
            wr = (c + 2) / (n + 4)
            weight = float(self.weights.get(name, settings.BASE_WEIGHTS.get(name, 0.1)))
            # Hierarchy score: win-rate dominates; weight breaks ties
            score = wr * 100.0 + weight * 8.0 + c * 0.15
            rows.append({
                "agent": name,
                "display_name": display_name(name),
                "correct": c,
                "wrong": w,
                "n": n,
                "win_rate": round(c / n, 3) if n else None,
                "smoothed_wr": round(wr, 3),
                "weight": round(weight, 4),
                "score": round(score, 3),
            })
        rows.sort(key=lambda r: (-r["score"], -r["weight"], r["agent"]))
        for i, r in enumerate(rows):
            r["rank"] = i + 1
            fade = self.fade_state(r)
            r["faded"] = fade["faded"]
            r["invert"] = fade["invert"]
            r["fade_strength"] = fade["strength"]
            r["hard_mute"] = bool(fade.get("hard_mute"))
            r["listen"] = self.listen_factor_for_rank(i + 1, r)
        return rows

    def fade_state(self, row: Dict[str, Any] | None) -> Dict[str, Any]:
        """
        Conditional fade: enough history + bad WR → invert contribution.
        Strength scales from threshold down to FADE_FULL_AT_WR.
        Hard mute: WR < HARD_MUTE_WR with ≥ HARD_MUTE_MIN_N samples → full invert + near-zero listen.
        Recomputed every hierarchy pass so it decays as WR recovers.
        """
        if not row:
            return {"faded": False, "invert": False, "strength": 0.0, "hard_mute": False}
        n = int(row.get("n") or 0)
        wr = row.get("win_rate")
        min_n = int(getattr(settings, "FADE_MIN_N", 20))
        thr = float(getattr(settings, "FADE_WR_THRESHOLD", 0.40))
        full_at = float(getattr(settings, "FADE_FULL_AT_WR", 0.28))
        hard_n = int(getattr(settings, "HARD_MUTE_MIN_N", 40))
        hard_wr = float(getattr(settings, "HARD_MUTE_WR", 0.40))
        if wr is None or n < min_n or wr >= thr:
            return {"faded": False, "invert": False, "strength": 0.0, "hard_mute": False}
        # Hard mute for chronic losers with enough samples
        if n >= hard_n and float(wr) < hard_wr:
            return {"faded": True, "invert": True, "strength": 1.0, "hard_mute": True}
        # strength 0 at thr, 1 at full_at or below
        span = max(1e-6, thr - full_at)
        strength = min(1.0, max(0.0, (thr - float(wr)) / span))
        return {"faded": True, "invert": True, "strength": round(strength, 3), "hard_mute": False}

    def listen_factor_for_rank(self, rank: int, row: Dict[str, Any] | None = None) -> float:
        """
        How much the Chair listens to this rank.
        #1 ≈ 1.0, each step down multiplies by RANK_LISTEN_DECAY, floor RANK_MIN_LISTEN.
        Chronic losers: keep a reduced positive magnitude and mark invert via fade_state
        (Chair flips their signed vote) instead of silencing them to ~0.
        """
        decay = float(getattr(settings, "RANK_LISTEN_DECAY", 0.82))
        floor = float(getattr(settings, "RANK_MIN_LISTEN", 0.12))
        factor = max(floor, decay ** max(0, rank - 1))

        if row:
            n = int(row.get("n") or 0)
            wr = row.get("win_rate")
            fade = self.fade_state(row)
            if fade.get("hard_mute"):
                # Chronic loser: near-zero listen so invert residual is tiny
                factor = float(getattr(settings, "HARD_MUTE_LISTEN", 0.04))
            elif fade["faded"]:
                # Keep usable magnitude so invert can matter; scale by strength
                # Mild fade → ~0.35 listen, full fade → ~0.55 of rank factor
                factor = max(floor * 0.5, factor * (0.35 + 0.25 * fade["strength"]))
            else:
                mute_wr = float(getattr(settings, "HIERARCHY_MUTE_WR", 0.42))
                mute_n = int(getattr(settings, "HIERARCHY_MUTE_MIN_N", 8))
                mute_f = float(getattr(settings, "HIERARCHY_MUTE_FACTOR", 0.35))
                # Soft mute only when not enough samples yet for full fade
                if n >= mute_n and n < int(getattr(settings, "FADE_MIN_N", 20)) and wr is not None and wr < mute_wr:
                    factor *= mute_f
        return round(max(0.02, factor), 4)

    def snapshot(self) -> Dict[str, Any]:
        hierarchy = self.hierarchy_ranks()
        ranked = [(r["agent"], r["weight"]) for r in hierarchy]
        top_pairs = sorted(
            self.pair_affinity.items(),
            key=lambda x: -x[1],
        )[:5]
        records = {}
        for r in hierarchy:
            name = r["agent"]
            records[name] = {
                "display_name": r["display_name"],
                "correct": r["correct"],
                "wrong": r["wrong"],
                "n": r["n"],
                "win_rate": r["win_rate"],
                "weight": r["weight"],
                "rank": r["rank"],
                "listen": r["listen"],
                "faded": r.get("faded", False),
                "invert": r.get("invert", False),
                "fade_strength": r.get("fade_strength", 0),
                "hard_mute": r.get("hard_mute", False),
            }
        return {
            "weights": {k: round(v, 4) for k, v in ranked},
            "records": records,
            "hierarchy": hierarchy,
            "top_pairs": [
                {
                    "pair": k,
                    "affinity": round(v, 3),
                    "hits": self.pair_hits.get(k, 0),
                    "tries": self.pair_tries.get(k, 0),
                    "labels": [display_name(p) for p in k.split("|")],
                }
                for k, v in top_pairs
            ],
            "top_anti_pairs": [
                {
                    "pair": ap["pair"],
                    "winner": ap["winner"],
                    "loser": ap["loser"],
                    "wr": ap["wr"],
                    "tries": ap["tries"],
                    "strength": ap["strength"],
                    "labels": ap["labels"],
                }
                for ap in self.active_anti_pairs()[:5]
            ],
            "updates": self.updates,
            "learning_phase": self.learning_phase(),
            "notes": self.last_notes[-6:],
            "quorum": self.quorum_snapshot(),
            "regime_split": {
                "regimes_seen": sorted(set(self.regime_correct.keys()) | set(self.regime_wrong.keys())),
                "blend": self.REGIME_BLEND,
                "min_n": self.REGIME_MIN_N,
            },
            "calibration": {
                k: {
                    "tries": self.calib_tries[k],
                    "hits": self.calib_hits[k],
                    "hit_rate": round(self.calib_hits[k] / self.calib_tries[k], 3) if self.calib_tries[k] else None,
                }
                for k in sorted(self.calib_tries.keys())
            },
        }

    def learn_from_settled(
        self,
        agent_votes: Dict[str, Any],
        outcome: str,
        regime: str | None = None,
        credit: float = 1.0,
    ) -> Dict[str, Any]:
        """
        Grade every directional agent vote against the market outcome,
        then nudge global weights + pair affinities + regime-split records.
        credit < 1.0 reduces the weight update (used for near_certain freebies).
        """
        if outcome not in ("UP", "DOWN"):
            return {}
        regime_key = regime or "UNKNOWN_MID"
        credit = max(0.05, min(1.0, float(credit or 1.0)))

        notes: List[str] = []
        directional: Dict[str, Dict[str, Any]] = {}

        for name, vote in (agent_votes or {}).items():
            if name in NON_VOTERS:
                continue
            if not isinstance(vote, dict):
                continue
            d = vote.get("direction")
            if d not in ("UP", "DOWN"):
                continue
            conf = float(vote.get("confidence") or 50)
            correct = d == outcome
            # Full count always (for WR / hierarchy), but weight nudge scales by credit
            self.directional[name] += 1
            if correct:
                self.correct[name] += 1
                self.regime_correct[regime_key][name] += 1
            else:
                self.wrong[name] += 1
                self.regime_wrong[regime_key][name] += 1
            directional[name] = {"direction": d, "correct": correct, "confidence": conf}
            # Calibration tracking (WAIT never arrives here)
            bucket = f"{int(conf // 10) * 10}-{int(conf // 10) * 10 + 9}"
            self.calib_tries[bucket] += 1
            if correct:
                self.calib_hits[bucket] += 1
            ac = self.agent_calib[name]
            ac["confs"].append(conf)
            ac["hits"].append(1 if correct else 0)
            if len(ac["confs"]) > 80:
                ac["confs"] = ac["confs"][-80:]
                ac["hits"] = ac["hits"][-80:]

        if not directional:
            return {"notes": ["No directional agent votes to grade"]}

        if credit < 0.99:
            notes.append(f"reduced credit x{credit:.2f} (near_certain / easy freebie)")

        # --- Individual weight nudge (lifetime + recent form) ---
        # Longer run → more stable ranks, but recent form still moves the needle
        total_graded = sum(self.correct.values()) + sum(self.wrong.values())
        cold_n = int(getattr(settings, "COLD_START_SAMPLES", 15)) * 3
        lr = float(getattr(settings, "LEARNING_RATE_COLD", 0.16)) if total_graded < cold_n else float(settings.LEARNING_RATE)
        lr *= credit  # near_certain freebies move weights much less
        # Slightly slower LR in exploit so the system consolidates instead of thrashing
        exploit_n = int(getattr(settings, "EXPLOIT_SAMPLES", 80)) * 3
        if total_graded >= exploit_n:
            lr *= 0.75
        form_win = int(getattr(settings, "RECENT_FORM_WINDOW", 20))
        form_blend = float(getattr(settings, "RECENT_FORM_BLEND", 0.35))
        momentum = float(getattr(settings, "WEIGHT_MOMENTUM", 0.08))
        base = settings.BASE_WEIGHTS
        for name, info in directional.items():
            if name not in self.weights:
                self.weights[name] = float(base.get(name, 0.1))
            c = self.correct[name]
            w = self.wrong[name]
            n = c + w
            # Lifetime Bayesian WR
            life_wr = (c + 2) / (n + 4)
            # Recent form WR from calibration ring buffer
            ac = self.agent_calib.get(name) or {}
            recent_hits = list(ac.get("hits") or [])[-form_win:]
            recent_confs = list(ac.get("confs") or [])[-form_win:]
            if len(recent_hits) >= 5:
                form_wr = (sum(recent_hits) + 1) / (len(recent_hits) + 2)
            else:
                form_wr = life_wr
            # Blend: more history → trust lifetime more, but never ignore form
            blend = form_blend if n >= form_win else form_blend * (n / max(1, form_win))
            wr = (1 - blend) * life_wr + blend * form_wr
            b = float(base.get(name, 0.1))
            factor = 0.55 + wr * 0.9
            # Overconfidence penalty on recent high-conf misses
            if recent_hits and recent_confs:
                recent = list(zip(recent_confs, recent_hits))
                high_miss = sum(1 for cf, h in recent if cf >= 65 and h == 0)
                if high_miss >= 3:
                    factor *= 0.88
                    notes.append(f"{display_name(name)} overconf penalty ({high_miss} high-miss)")
                # --- Reward system: streaks + accuracy bounty ---
                # Hot streak: escalating bonus for sustained correctness
                if len(recent_hits) >= 5:
                    last5 = sum(recent_hits[-5:])
                    if last5 >= 5:
                        factor *= 1.14  # perfect 5-pack bounty
                        notes.append(f"{display_name(name)} 🔥 perfect streak bounty")
                    elif last5 >= 4:
                        factor *= 1.09
                        notes.append(f"{display_name(name)} hot streak reward")
                    elif last5 == 0:
                        factor *= 0.90
                        notes.append(f"{display_name(name)} cold streak drag")
                # Consecutive tail: count trailing correct hits
                trail = 0
                for h in reversed(recent_hits):
                    if h == 1:
                        trail += 1
                    else:
                        break
                if trail >= 3:
                    # +3% per consecutive after 2, capped
                    streak_boost = min(1.18, 1.0 + 0.03 * (trail - 2))
                    factor *= streak_boost
                    notes.append(f"{display_name(name)} +{trail} streak x{streak_boost:.2f}")
                # High-confidence correct bounty (bot "earned" a hard call)
                if recent_hits and recent_confs:
                    recent_pairs = list(zip(recent_confs, recent_hits))[-8:]
                    high_hits = sum(1 for cf, h in recent_pairs if cf >= 70 and h == 1)
                    if high_hits >= 2:
                        factor *= 1.05
                        notes.append(f"{display_name(name)} high-conf bounty ({high_hits})")
            target = b * factor
            old = self.weights[name]
            # Momentum: keep a little of previous direction of change
            new = (1 - lr) * old + lr * target
            new = (1 - momentum) * new + momentum * old
            new = max(settings.MIN_WEIGHT, min(settings.MAX_WEIGHT, new))
            self.weights[name] = new
            if abs(new - old) > 0.004:
                notes.append(
                    f"{display_name(name)} w {old:.3f}→{new:.3f} "
                    f"(life {c}/{n} form={form_wr:.2f})"
                )

        self._normalize()
        self._recompute_regime_weights()

        # --- Pair affinity (agreement) + anti-correlation (disagreement) ---
        names = sorted(directional.keys())
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                a, b = names[i], names[j]
                da = directional[a]["direction"]
                db = directional[b]["direction"]
                key = _pair_key(a, b)
                if da == db:
                    self.pair_tries[key] += 1
                    if da == outcome:
                        self.pair_hits[key] += 1
                    hits = self.pair_hits[key]
                    tries = self.pair_tries[key]
                    aff = (hits + 1) / (tries + 2)
                    self.pair_affinity[key] = aff
                else:
                    # Opposite votes — anti-correlation sample
                    self.anti_tries[key] += 1
                    if da == outcome:
                        self.anti_right[key][a] += 1
                    if db == outcome:
                        self.anti_right[key][b] += 1

        # Highlight strongest coalitions
        strong = [
            (k, v) for k, v in self.pair_affinity.items()
            if self.pair_tries.get(k, 0) >= 3 and v >= 0.6
        ]
        strong.sort(key=lambda x: -x[1])
        for k, v in strong[:2]:
            labels = " + ".join(display_name(p) for p in k.split("|"))
            notes.append(
                f"Coalition {labels} affinity {v:.2f} "
                f"({self.pair_hits[k]}/{self.pair_tries[k]})"
            )

        # Highlight strongest anti-pairs
        for ap in self.active_anti_pairs()[:2]:
            notes.append(
                f"ANTI {display_name(ap['winner'])}≫{display_name(ap['loser'])} "
                f"{ap['wr']:.0%} of {ap['tries']} clashes"
            )

        # --- Quorum size: how many bots agreed on the outcome side ---
        winners = sorted([n for n, info in directional.items() if info["correct"]])
        losers_side = sorted([n for n, info in directional.items() if not info["correct"]])
        # Size of the pack that matched outcome
        win_size = len(winners)
        if win_size > 0:
            self.quorum_size_tries[win_size] += 1
            self.quorum_size_hits[win_size] += 1  # this size produced correct side
        # Also record the size of the losing pack as a failed quorum for that headcount
        lose_size = len(losers_side)
        if lose_size > 0 and lose_size != win_size:
            self.quorum_size_tries[lose_size] += 1
            # no hit — they agreed with each other but wrong side

        # Track combinations among winners (pairs → up to 5)
        if len(winners) >= 2:
            from itertools import combinations
            for k in range(2, min(6, len(winners) + 1)):
                for combo in combinations(winners, k):
                    key = "|".join(combo)
                    self.combo_tries[key] += 1
                    self.combo_hits[key] += 1
        # Failed combos: directional agents that agreed on the wrong side
        wrong_agree = [n for n, info in directional.items() if not info["correct"]]
        # Group by direction among wrongs
        for side in ("UP", "DOWN"):
            pack = sorted([n for n, info in directional.items() if not info["correct"] and info["direction"] == side])
            if len(pack) >= 2:
                from itertools import combinations
                for k in range(2, min(5, len(pack) + 1)):
                    for combo in combinations(pack, k):
                        key = "|".join(combo)
                        self.combo_tries[key] += 1
                        # no hit

        # Quorum bot gets graded like others when it voted — handled via directional loop.
        # Extra note on best size
        qs = self.quorum_snapshot()
        if qs.get("best_size") and qs.get("best_size_tries", 0) >= 3:
            notes.append(
                f"QUORUM hist best size {qs['best_size']} "
                f"({qs.get('best_size_wr', 0):.0%} of {qs.get('best_size_tries')} tries)"
            )

        self.updates += 1
        self.last_notes = (self.last_notes + notes)[-12:]
        if notes:
            logger.info(f"Adaptive learn: {'; '.join(notes[:4])}")
        return {
            "notes": notes,
            "weights": dict(self.weights),
            "graded": len(directional),
        }




    def load_from_dict(self, data: dict) -> bool:
        """Restore learning state from an in-memory brain export."""
        if not data:
            return False
        try:
            if data.get("weights"):
                self.weights.update({k: float(v) for k, v in data["weights"].items()})
                self._normalize()
            for k, v in (data.get("correct") or {}).items():
                self.correct[k] = int(v)
            for k, v in (data.get("wrong") or {}).items():
                self.wrong[k] = int(v)
            for k, v in (data.get("directional") or {}).items():
                self.directional[k] = int(v)
            for k, v in (data.get("pair_hits") or {}).items():
                self.pair_hits[k] = int(v)
            for k, v in (data.get("pair_tries") or {}).items():
                self.pair_tries[k] = int(v)
            if data.get("pair_affinity"):
                self.pair_affinity = {k: float(v) for k, v in data["pair_affinity"].items()}
            for k, v in (data.get("anti_tries") or {}).items():
                self.anti_tries[k] = int(v)
            for k, agents in (data.get("anti_right") or {}).items():
                for a, c in agents.items():
                    self.anti_right[k][a] = int(c)
            self.updates = int(data.get("updates") or self.updates or 0)
            if data.get("notes"):
                self.last_notes = list(data["notes"])[-40:]
            for k, v in (data.get("calibration") or {}).items():
                self.calib_hits[k] = int(v.get("hits") or 0)
                self.calib_tries[k] = int(v.get("tries") or 0)
            for k, v in (data.get("quorum_size_hits") or {}).items():
                self.quorum_size_hits[int(k)] = int(v)
            for k, v in (data.get("quorum_size_tries") or {}).items():
                self.quorum_size_tries[int(k)] = int(v)
            for k, v in (data.get("combo_hits") or {}).items():
                self.combo_hits[k] = int(v)
            for k, v in (data.get("combo_tries") or {}).items():
                self.combo_tries[k] = int(v)
            for rk, agents in (data.get("regime_correct") or {}).items():
                for a, c in agents.items():
                    self.regime_correct[rk][a] = int(c)
            for rk, agents in (data.get("regime_wrong") or {}).items():
                for a, c in agents.items():
                    self.regime_wrong[rk][a] = int(c)
            try:
                self._recompute_regime_weights()
            except Exception:
                pass
            return True
        except Exception as e:
            from loguru import logger
            logger.error(f"load_from_dict failed: {e}")
            return False

    def export_dict(self) -> dict:
        """Full learning state as a dict (for brain export)."""
        return {
            "weights": dict(self.weights),
            "correct": dict(self.correct),
            "wrong": dict(self.wrong),
            "directional": dict(self.directional),
            "pair_hits": dict(self.pair_hits),
            "pair_tries": dict(self.pair_tries),
            "pair_affinity": dict(self.pair_affinity),
            "anti_tries": dict(self.anti_tries),
            "anti_right": {k: dict(v) for k, v in self.anti_right.items()},
            "updates": self.updates,
            "notes": list(self.last_notes[-40:]),
            "calibration": {
                k: {"hits": self.calib_hits[k], "tries": self.calib_tries[k]}
                for k in self.calib_tries
            },
            "quorum_size_hits": {str(k): v for k, v in self.quorum_size_hits.items()},
            "quorum_size_tries": {str(k): v for k, v in self.quorum_size_tries.items()},
            "combo_hits": dict(list(self.combo_hits.items())[:400]),
            "combo_tries": dict(list(self.combo_tries.items())[:400]),
            "regime_correct": {rk: dict(v) for rk, v in self.regime_correct.items()},
            "regime_wrong": {rk: dict(v) for rk, v in self.regime_wrong.items()},
        }

    def save(self, path: "Path | None" = None) -> None:
        """Persist weights, track records, and affinities for huddle / restart."""
        from pathlib import Path
        import json
        from backend.config import settings as _s
        root = Path(getattr(_s, "DATA_DIR", None) or (Path(__file__).resolve().parent.parent.parent / "data"))
        root.mkdir(parents=True, exist_ok=True)
        path = Path(path) if path else root / "council-learning.json"
        payload = {
            "weights": dict(self.weights),
            "correct": dict(self.correct),
            "wrong": dict(self.wrong),
            "directional": dict(self.directional),
            "pair_hits": dict(self.pair_hits),
            "pair_tries": dict(self.pair_tries),
            "pair_affinity": dict(self.pair_affinity),
            "anti_tries": dict(self.anti_tries),
            "anti_right": {k: dict(v) for k, v in self.anti_right.items()},
            "updates": self.updates,
            "notes": self.last_notes[-20:],
            "calibration": {
                k: {"hits": self.calib_hits[k], "tries": self.calib_tries[k]}
                for k in self.calib_tries
            },
            "quorum_size_hits": {str(k): v for k, v in self.quorum_size_hits.items()},
            "quorum_size_tries": {str(k): v for k, v in self.quorum_size_tries.items()},
            "combo_hits": dict(list(self.combo_hits.items())[:200]),
            "combo_tries": dict(list(self.combo_tries.items())[:200]),
            "regime_correct": {rk: dict(v) for rk, v in self.regime_correct.items()},
            "regime_wrong": {rk: dict(v) for rk, v in self.regime_wrong.items()},
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def load(self, path: "Path | None" = None) -> bool:
        from pathlib import Path
        import json
        from backend.config import settings as _s
        root = Path(getattr(_s, "DATA_DIR", None) or (Path(__file__).resolve().parent.parent.parent / "data"))
        path = Path(path) if path else root / "council-learning.json"
        if not path.exists():
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("weights"):
                self.weights.update({k: float(v) for k, v in data["weights"].items()})
                self._normalize()
            for k, v in (data.get("correct") or {}).items():
                self.correct[k] = int(v)
            for k, v in (data.get("wrong") or {}).items():
                self.wrong[k] = int(v)
            for k, v in (data.get("pair_hits") or {}).items():
                self.pair_hits[k] = int(v)
            for k, v in (data.get("pair_tries") or {}).items():
                self.pair_tries[k] = int(v)
            self.pair_affinity = {k: float(v) for k, v in (data.get("pair_affinity") or {}).items()}
            for k, v in (data.get("anti_tries") or {}).items():
                self.anti_tries[k] = int(v)
            for k, agents in (data.get("anti_right") or {}).items():
                for a, c in agents.items():
                    self.anti_right[k][a] = int(c)
            self.updates = int(data.get("updates") or 0)
            for k, v in (data.get("quorum_size_hits") or {}).items():
                self.quorum_size_hits[int(k)] = int(v)
            for k, v in (data.get("quorum_size_tries") or {}).items():
                self.quorum_size_tries[int(k)] = int(v)
            for k, v in (data.get("combo_hits") or {}).items():
                self.combo_hits[k] = int(v)
            for k, v in (data.get("combo_tries") or {}).items():
                self.combo_tries[k] = int(v)
            for rk, agents in (data.get("regime_correct") or {}).items():
                for a, c in agents.items():
                    self.regime_correct[rk][a] = int(c)
            for rk, agents in (data.get("regime_wrong") or {}).items():
                for a, c in agents.items():
                    self.regime_wrong[rk][a] = int(c)
            self._recompute_regime_weights()
            return True
        except Exception:
            return False


    def quorum_snapshot(self) -> Dict[str, Any]:
        """Best historical agreement size + top co-correct combinations."""
        best_size = 3
        best_wr = None
        best_tries = 0
        size_table = []
        for size, tries in sorted(self.quorum_size_tries.items()):
            hits = self.quorum_size_hits.get(size, 0)
            wr = (hits + 1) / (tries + 2)
            size_table.append({"size": size, "hits": hits, "tries": tries, "wr": round(wr, 3)})
            if tries >= 2 and (best_wr is None or wr > best_wr or (wr == best_wr and tries > best_tries)):
                best_wr = wr
                best_size = size
                best_tries = tries

        combos = []
        for key, tries in self.combo_tries.items():
            if tries < 2:
                continue
            hits = self.combo_hits.get(key, 0)
            wr = (hits + 1) / (tries + 2)
            members = key.split("|")
            combos.append({
                "key": key,
                "members": members,
                "labels": [display_name(m) for m in members],
                "hits": hits,
                "tries": tries,
                "wr": round(wr, 3),
            })
        combos.sort(key=lambda c: (-c["wr"], -c["tries"]))
        return {
            "best_size": best_size,
            "best_size_wr": round(best_wr, 3) if best_wr is not None else None,
            "best_size_tries": best_tries,
            "size_table": size_table[:12],
            "top_combos": combos[:8],
            "avg_winning_size": (
                round(
                    sum(s * self.quorum_size_hits[s] for s in self.quorum_size_hits)
                    / max(1, sum(self.quorum_size_hits.values())),
                    2,
                )
                if self.quorum_size_hits else None
            ),
        }


    def _recompute_regime_weights(self) -> None:
        """Build per-regime weight maps from regime win-rates × base weights."""
        base = settings.BASE_WEIGHTS
        all_regimes = set(self.regime_correct.keys()) | set(self.regime_wrong.keys())
        out: Dict[str, Dict[str, float]] = {}
        for reg in all_regimes:
            local: Dict[str, float] = {}
            for name in list(self.weights.keys()) + [k for k in base if k not in NON_VOTERS]:
                if name in NON_VOTERS:
                    continue
                c = int(self.regime_correct.get(reg, {}).get(name, 0))
                w = int(self.regime_wrong.get(reg, {}).get(name, 0))
                n = c + w
                # Bayesian smoothed win rate
                wr = (c + 2) / (n + 4)
                b = float(base.get(name, 0.1))
                # Same factor curve as global nudge
                factor = 0.55 + wr * 0.9
                local[name] = max(settings.MIN_WEIGHT, min(settings.MAX_WEIGHT, b * factor))
            # normalize local
            tot = sum(local.values()) or 1.0
            out[reg] = {k: v / tot for k, v in local.items()}
        self.regime_weights = out

    def weights_for_regime(self, regime: str | None) -> Dict[str, float]:
        """
        Blend global adaptive weights with regime-local weights.
        Falls back to session-only or global when the fine key is thin.
        """
        global_w = dict(self.weights)
        if not regime or regime == "UNKNOWN_MID":
            return global_w

        blend = float(getattr(self, "REGIME_BLEND", 0.55))
        min_n = int(getattr(self, "REGIME_MIN_N", 4))

        def regime_n(reg: str, agent: str) -> int:
            return int(self.regime_correct.get(reg, {}).get(agent, 0)) + int(
                self.regime_wrong.get(reg, {}).get(agent, 0)
            )

        # Prefer exact key; else session-only aggregate; else global
        candidates = [regime]
        session, phase = split_key(regime)
        if session:
            candidates.append(session)  # session-level bucket if we ever store it
        # Also try sibling phases under same session for more sample (soft)
        for ph in ("EARLY", "MID", "LATE", "PIN"):
            candidates.append(f"{session}_{ph}")

        local_map = self.regime_weights.get(regime) or {}
        # If exact regime has almost no mass, synthesize from session phases
        if not local_map:
            # aggregate counts across session phases into a temp weight set
            agg_c: Dict[str, int] = defaultdict(int)
            agg_w: Dict[str, int] = defaultdict(int)
            for reg, agents in self.regime_correct.items():
                if reg.startswith(session + "_"):
                    for a, c in agents.items():
                        agg_c[a] += c
            for reg, agents in self.regime_wrong.items():
                if reg.startswith(session + "_"):
                    for a, c in agents.items():
                        agg_w[a] += c
            if agg_c or agg_w:
                base = settings.BASE_WEIGHTS
                tmp = {}
                for name in self.weights:
                    c = agg_c.get(name, 0)
                    w = agg_w.get(name, 0)
                    n = c + w
                    wr = (c + 2) / (n + 4)
                    b = float(base.get(name, 0.1))
                    tmp[name] = max(settings.MIN_WEIGHT, min(settings.MAX_WEIGHT, b * (0.55 + wr * 0.9)))
                tot = sum(tmp.values()) or 1.0
                local_map = {k: v / tot for k, v in tmp.items()}

        blended: Dict[str, float] = {}
        for name, gw in global_w.items():
            n = regime_n(regime, name)
            # session aggregate sample count
            if n < min_n and session:
                n = sum(
                    regime_n(f"{session}_{ph}", name)
                    for ph in ("EARLY", "MID", "LATE", "PIN")
                )
            lw = local_map.get(name, gw)
            if n >= min_n:
                # More samples → trust regime more (up to blend)
                trust = blend * min(1.0, n / (min_n * 3))
                blended[name] = (1.0 - trust) * gw + trust * lw
            else:
                blended[name] = gw
        tot = sum(blended.values()) or 1.0
        return {k: v / tot for k, v in blended.items()}

    def regime_snapshot(self, regime: str | None = None) -> Dict[str, Any]:
        """UI / debug: current regime weights vs global."""
        reg = regime or "UNKNOWN_MID"
        gw = dict(self.weights)
        rw = self.weights_for_regime(reg)
        rows = []
        for name in sorted(set(gw) | set(rw)):
            c = int(self.regime_correct.get(reg, {}).get(name, 0))
            w = int(self.regime_wrong.get(reg, {}).get(name, 0))
            n = c + w
            rows.append({
                "agent": name,
                "display_name": display_name(name),
                "global_w": round(gw.get(name, 0), 4),
                "regime_w": round(rw.get(name, 0), 4),
                "regime_record": f"{c}/{n}" if n else "0/0",
                "regime_wr": round((c + 2) / (n + 4), 3) if n else None,
            })
        rows.sort(key=lambda r: -r["regime_w"])
        return {
            "regime": reg,
            "session": split_key(reg)[0],
            "phase": split_key(reg)[1],
            "min_n": self.REGIME_MIN_N,
            "blend": self.REGIME_BLEND,
            "rows": rows[:20],
            "regimes_seen": sorted(set(self.regime_correct.keys()) | set(self.regime_wrong.keys())),
        }


    def active_anti_pairs(self) -> List[Dict[str, Any]]:
        """
        Pairs that disagree often enough and one side wins the clash reliably.
        Returns list sorted by strength desc.
        """
        min_tries = int(getattr(settings, "ANTI_MIN_TRIES", 15))
        min_wr = float(getattr(settings, "ANTI_WIN_RATE", 0.62))
        out: List[Dict[str, Any]] = []
        for key, tries in self.anti_tries.items():
            if tries < min_tries:
                continue
            parts = key.split("|")
            if len(parts) != 2:
                continue
            a, b = parts[0], parts[1]
            ra = int(self.anti_right.get(key, {}).get(a, 0))
            rb = int(self.anti_right.get(key, {}).get(b, 0))
            # Only one can be right per clash; total rights ≈ tries
            if ra >= rb:
                winner, loser, w_hits = a, b, ra
            else:
                winner, loser, w_hits = b, a, rb
            wr = w_hits / max(1, tries)
            if wr < min_wr:
                continue
            # Strength 0 at min_wr, 1 near 0.85+
            strength = min(1.0, max(0.0, (wr - min_wr) / max(1e-6, 0.85 - min_wr)))
            out.append({
                "pair": key,
                "winner": winner,
                "loser": loser,
                "tries": tries,
                "winner_hits": w_hits,
                "wr": round(wr, 3),
                "strength": round(strength, 3),
                "labels": [display_name(winner), display_name(loser)],
            })
        out.sort(key=lambda x: (-x["strength"], -x["tries"]))
        return out

    def anti_bonus_for_disagreement(
        self,
        signals: List[Any],
    ) -> Tuple[float, List[str], Dict[str, float]]:
        """
        When known anti-pairs disagree live, nudge score toward the
        historically stronger side and soft-fade the weaker side's weight.
        Returns (score_nudge, explanation_bits, loser_fade_scales).
        score_nudge is signed: + favors UP, - favors DOWN.
        """
        max_bonus = float(getattr(settings, "ANTI_MAX_BONUS", 0.12))
        soft = float(getattr(settings, "ANTI_SOFT_FADE", 0.55))
        dirs = {
            getattr(s, "agent_name", None): getattr(s, "direction", None)
            for s in signals
            if getattr(s, "agent_name", None) not in NON_VOTERS
            and not getattr(s, "muted", False)
        }
        nudge = 0.0
        bits: List[str] = []
        loser_fade: Dict[str, float] = {}
        for ap in self.active_anti_pairs():
            w, l = ap["winner"], ap["loser"]
            dw, dl = dirs.get(w), dirs.get(l)
            if dw not in ("UP", "DOWN") or dl not in ("UP", "DOWN"):
                continue
            if dw == dl:
                continue  # not disagreeing this cycle
            # Winner's live direction is the one we trust
            edge = 0.04 + 0.10 * float(ap["strength"])
            if dw == "UP":
                nudge += edge
            else:
                nudge -= edge
            # Soft-fade the loser's contribution this cycle
            loser_fade[l] = min(loser_fade.get(l, 1.0), soft)
            bits.append(
                f"{display_name(w)}≫{display_name(l)} "
                f"({ap['wr']:.0%} anti)"
            )
        nudge = max(-max_bonus, min(max_bonus, nudge))
        return nudge, bits[:3], loser_fade

    def pair_bonus_for_agreement(
        self,
        signals: List[Any],
        direction: str,
    ) -> Tuple[float, List[str]]:
        """
        When multiple bots agree on `direction`, boost score by their
        historical co-success affinity.
        Returns (bonus_multiplier_add, explanation_bits).
        """
        if direction not in ("UP", "DOWN"):
            return 0.0, []

        agreeing = [
            s.agent_name
            for s in signals
            if getattr(s, "direction", None) == direction
            and s.agent_name not in NON_VOTERS
            and not getattr(s, "muted", False)
        ]
        if len(agreeing) < 2:
            return 0.0, []

        bonus = 0.0
        bits: List[str] = []
        seen = set()
        for i in range(len(agreeing)):
            for j in range(i + 1, len(agreeing)):
                key = _pair_key(agreeing[i], agreeing[j])
                if key in seen:
                    continue
                seen.add(key)
                tries = self.pair_tries.get(key, 0)
                aff = self.pair_affinity.get(key)
                if aff is None or tries < 2:
                    continue
                # Only reward pairs that have proven themselves above coin-flip
                if aff <= 0.55:
                    continue
                # Scale: affinity 0.55→0, 0.75→~0.06, 0.9→~0.10
                edge = (aff - 0.55) * 0.28
                bonus += edge
                if edge >= 0.03:
                    bits.append(
                        f"{display_name(agreeing[i])}+{display_name(agreeing[j])} "
                        f"({aff:.0%})"
                    )

        # Cap total pair bonus so it can't dominate confluence
        bonus = min(0.22, bonus)
        return bonus, bits[:4]

    async def rebuild_from_store(self, store: Any, limit: int = 120) -> int:
        """
        Replay recent settled window calls to rebuild weights + affinities.
        Safe to call on startup.
        """
        try:
            recent = await store.recent_settled_calls(limit=limit)
        except Exception as e:
            logger.debug(f"Adaptive rebuild skip: {e}")
            return 0

        # oldest first so learning order is chronological
        ordered = list(reversed(recent))
        n = 0
        for row in ordered:
            outcome = row.get("outcome")
            votes = row.get("agent_votes") or {}
            if outcome in ("UP", "DOWN") and votes:
                reg = row.get("regime") or row.get("regime_key")
                self.learn_from_settled(votes, outcome, regime=reg)
                n += 1
        if n:
            logger.info(f"Adaptive learner rebuilt from {n} settled windows")
        return n
