"""
Nightly Council Huddle – 03:00–03:15 America/Chicago (Central Time).

One short cool-down window (~one 15m call) each night. During it the council:
  1. Full weight rebuild from all graded path history
  2. Anti-pair + coalition refresh from latest clash/agreement stats
  3. Phase recalibration (explore → calibrate → exploit)
  4. L20 drift correction (small tighten/loosen)
  5. Prune graded windows older than ~90 days
  6. Law cooldown bump if any lock / cold streak in the last day
  7. Log a dated summary under data/huddle-logs/

Idempotent: at most one full huddle report per Central calendar day.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from loguru import logger

from backend.config import settings
from backend.services.runtime_settings import runtime_settings

CT = ZoneInfo("America/Chicago")
HUDDLE_START_HOUR = 3          # 3:00 AM CT
HUDDLE_START_MINUTE = 0
HUDDLE_END_HOUR = 3            # ends same hour
HUDDLE_END_MINUTE = 15         # 15-minute / ~1-call window
PRUNE_DAYS = 90
LAW_BUMP_HOURS = 6


def now_ct() -> datetime:
    return datetime.now(CT)


def _huddle_bounds() -> tuple[int, int, int]:
    """hour, start_minute, end_minute from runtime settings (defaults 3:00–3:15)."""
    try:
        hd = runtime_settings.huddle()
        hour = int(hd.get("hour_ct", HUDDLE_START_HOUR))
        dur = max(5, min(60, int(hd.get("duration_minutes", 15))))
        if not hd.get("enabled", True):
            return (-1, 0, 0)  # disabled
        return hour, 0, dur
    except Exception:
        return HUDDLE_START_HOUR, HUDDLE_START_MINUTE, HUDDLE_END_MINUTE


def is_huddle_window(dt: Optional[datetime] = None) -> bool:
    """True during configured CT huddle window (default 03:00–03:15)."""
    t = dt or now_ct()
    hour, start_m, end_m = _huddle_bounds()
    if hour < 0:
        return False
    if t.hour != hour:
        return False
    return start_m <= t.minute < end_m


def ct_date_key(dt: Optional[datetime] = None) -> str:
    return (dt or now_ct()).strftime("%Y-%m-%d")


class NightlyHuddle:
    def __init__(self, data_dir: Optional[Path] = None):
        root = Path(__file__).resolve().parent.parent.parent
        self.data_dir = data_dir or Path(getattr(settings, "DATA_DIR", None) or (root / "data"))
        self.log_dir = self.data_dir / "huddle-logs"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.last_report: Optional[Dict[str, Any]] = None
        self.last_date: Optional[str] = None
        self.in_huddle: bool = False
        self.activity_log: List[str] = []
        # Post-huddle law bump (elevated confluence for a few hours after a rough day)
        self._law_bump_until: Optional[datetime] = None
        self._law_bump_value: float = 0.0
        self._l20_bump: float = 0.0
        self._load_latest()

    def _load_latest(self) -> None:
        files = sorted(self.log_dir.glob("huddle-*.json"), reverse=True)
        if not files:
            return
        try:
            self.last_report = json.loads(files[0].read_text(encoding="utf-8"))
            self.last_date = self.last_report.get("date")
            # Restore law bump if still active
            until = (self.last_report.get("law_bump") or {}).get("until")
            val = (self.last_report.get("law_bump") or {}).get("value") or 0.0
            if until and val:
                try:
                    ts = datetime.fromisoformat(until)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=CT)
                    if ts > now_ct():
                        self._law_bump_until = ts
                        self._law_bump_value = float(val)
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"huddle load: {e}")

    def status(self) -> Dict[str, Any]:
        n = now_ct()
        in_window = is_huddle_window(n)
        self.in_huddle = in_window
        hour, start_m, end_m = _huddle_bounds()
        window_label = (
            "disabled"
            if hour < 0
            else f"{hour:02d}:{start_m:02d}–{hour:02d}:{end_m:02d} America/Chicago"
        )
        return {
            "in_huddle": in_window,
            "window": window_label,
            "now_ct": n.strftime("%Y-%m-%d %H:%M:%S %Z"),
            "last_huddle_date": self.last_date,
            "last_report_complete": bool(self.last_report and self.last_report.get("complete")),
            "activity_tail": (self.last_report or {}).get("activity", [])[-8:],
            "next_huddle_hint": self._next_hint(n),
            "cool_down_bump": self.cool_down_bump(),
            "law_bump_active": bool(
                self._law_bump_until and self._law_bump_until > n
            ),
        }

    def _next_hint(self, n: datetime) -> str:
        if is_huddle_window(n):
            left = HUDDLE_END_MINUTE - n.minute
            return f"In huddle now — {max(0, left)} min left"
        target = n.replace(
            hour=HUDDLE_START_HOUR, minute=HUDDLE_START_MINUTE, second=0, microsecond=0
        )
        if n.hour > HUDDLE_START_HOUR or (
            n.hour == HUDDLE_START_HOUR and n.minute >= HUDDLE_END_MINUTE
        ):
            target = target + timedelta(days=1)
        delta = target - n
        hours = int(delta.total_seconds() // 3600)
        mins = int((delta.total_seconds() % 3600) // 60)
        return f"Next huddle in {hours}h {mins}m (3:00 AM CT, 15 min)"

    async def maybe_run(
        self,
        store,
        learner,
        leader,
        law: Any = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Called every analysis cycle. If inside the 15-min CT huddle window and we
        haven't completed today's huddle yet, run the full review once.
        """
        n = now_ct()
        self.in_huddle = is_huddle_window(n)
        if not self.in_huddle:
            return None

        key = ct_date_key(n)
        if self.last_date == key and self.last_report and self.last_report.get("complete"):
            # Already huddled today — stay in cool-down mode for the rest of the 15 min
            return self.last_report

        report = await self._run_huddle(store, learner, leader, key, law=law)
        return report

    async def _run_huddle(
        self,
        store,
        learner,
        leader,
        date_key: str,
        law: Any = None,
    ) -> Dict[str, Any]:
        self.activity_log = []
        self._log("Huddle started — 15-min cool-down (3:00–3:15 AM CT)")

        # ------------------------------------------------------------------
        # 0) Accuracy / day review
        # ------------------------------------------------------------------
        accuracy: Dict[str, Any] = {}
        try:
            accuracy = await store.get_accuracy()
            self._log(
                f"Reviewed lifetime record: {accuracy.get('correct', 0)}/"
                f"{accuracy.get('total', 0)} · "
                f"{accuracy.get('accuracy_pct', '—')}% · verdict {accuracy.get('verdict', '—')}"
            )
        except Exception as e:
            self._log(f"Accuracy review failed: {e}")

        day_stats = self._day_stats(accuracy)
        went_well = day_stats.get("went_well") or []
        went_poor = day_stats.get("went_poor") or []
        for line in went_well:
            self._log(f"✓ {line}")
        for line in went_poor:
            self._log(f"✗ {line}")

        hierarchy: List[Dict[str, Any]] = []
        try:
            hierarchy = learner.hierarchy_ranks()
            top = hierarchy[:3] if hierarchy else []
            bot = hierarchy[-3:] if hierarchy and len(hierarchy) > 3 else []
            if top:
                self._log(
                    "Top ranks: "
                    + ", ".join(
                        f"{r.get('display_name')}#{r.get('rank')} "
                        f"({int((r.get('win_rate') or 0)*100)}% WR)"
                        for r in top
                    )
                )
            if bot:
                self._log(
                    "Watch list (low ranks): "
                    + ", ".join(str(r.get("display_name")) for r in bot)
                )
        except Exception as e:
            self._log(f"Hierarchy review failed: {e}")

        # ------------------------------------------------------------------
        # 1) Full weight rebuild from graded path history
        # ------------------------------------------------------------------
        consolidate_notes: List[str] = []
        rebuilt_n = 0
        try:
            # Use a deep replay so nightly pass is higher leverage than live ticks
            rebuild_limit = int(getattr(settings, "HUDDLE_REBUILD_LIMIT", 400))
            rebuilt_n = await learner.rebuild_from_store(store, limit=rebuild_limit)
            leader.sync_from_learner()
            msg = f"Full weight rebuild from {rebuilt_n} graded windows"
            consolidate_notes.append(msg)
            self._log(msg)
        except Exception as e:
            self._log(f"Weight rebuild failed: {e}")
            logger.exception("huddle rebuild")

        # ------------------------------------------------------------------
        # 2) Anti-pair + coalition refresh (affinities already updated by rebuild)
        # ------------------------------------------------------------------
        try:
            snap = learner.snapshot() if hasattr(learner, "snapshot") else {}
            top_pairs = (snap.get("top_pairs") or snap.get("coalitions") or [])[:5]
            top_anti = (snap.get("top_anti_pairs") or [])[:5]
            if not top_pairs and hasattr(learner, "pair_affinity"):
                ranked = sorted(
                    (learner.pair_affinity or {}).items(),
                    key=lambda kv: kv[1],
                    reverse=True,
                )[:5]
                top_pairs = [{"pair": k, "affinity": v} for k, v in ranked]
            if not top_anti and hasattr(learner, "active_anti_pairs"):
                top_anti = learner.active_anti_pairs()[:5]

            if top_pairs:
                bits = []
                for p in top_pairs[:4]:
                    if isinstance(p, dict):
                        label = p.get("pair") or p.get("label") or p.get("names") or "?"
                        aff = p.get("affinity") or p.get("wr") or p.get("strength")
                        bits.append(f"{label}:{aff}" if aff is not None else str(label))
                    else:
                        bits.append(str(p))
                msg = "Coalition refresh: " + ", ".join(bits)
                consolidate_notes.append(msg)
                self._log(msg)
            else:
                self._log("Coalition refresh: not enough co-success samples yet")

            if top_anti:
                bits = []
                for ap in top_anti[:4]:
                    if isinstance(ap, dict):
                        w = ap.get("winner") or ap.get("a") or "?"
                        l = ap.get("loser") or ap.get("b") or "?"
                        wr = ap.get("wr") or ap.get("strength")
                        bits.append(f"{w}≫{l}" + (f"({wr:.0%})" if isinstance(wr, float) else ""))
                    else:
                        bits.append(str(ap))
                msg = "Anti-pair refresh: " + ", ".join(bits)
                consolidate_notes.append(msg)
                self._log(msg)
            else:
                self._log("Anti-pair refresh: no strong clash pairs yet")
        except Exception as e:
            self._log(f"Pair/anti refresh failed: {e}")

        # ------------------------------------------------------------------
        # 3) Phase recalibration (explore → calibrate → exploit)
        # ------------------------------------------------------------------
        phase_info: Dict[str, Any] = {}
        try:
            chair_n = int(accuracy.get("total") or 0)
            if hasattr(learner, "learning_phase"):
                phase_info = learner.learning_phase(chair_n=chair_n) or {}
            else:
                cold = int(getattr(settings, "COLD_START_SAMPLES", 15))
                exp = int(getattr(settings, "EXPLOIT_SAMPLES", 80))
                if chair_n < cold:
                    phase_info = {"phase": "explore", "n": chair_n, "note": "collecting samples"}
                elif chair_n < exp:
                    phase_info = {"phase": "calibrate", "n": chair_n, "note": "ranking bots"}
                else:
                    phase_info = {"phase": "exploit", "n": chair_n, "note": "protect edge"}
            msg = (
                f"Phase: {phase_info.get('phase', '?')} "
                f"(n={phase_info.get('n', chair_n)}) — {phase_info.get('note', '')}"
            )
            consolidate_notes.append(msg)
            self._log(msg)
        except Exception as e:
            self._log(f"Phase recalibration failed: {e}")

        # ------------------------------------------------------------------
        # 4) L20 drift correction (tighten if weak, loosen if strong)
        # ------------------------------------------------------------------
        self._l20_bump = 0.0
        try:
            l20 = (accuracy.get("last_20") or {}).get("accuracy_pct")
            life = accuracy.get("accuracy_pct")
            if l20 is not None:
                if l20 < 45:
                    self._l20_bump = 0.08
                    msg = f"L20 cold at {l20}% — tighten bar +{self._l20_bump:.2f} during window"
                elif l20 < 48:
                    self._l20_bump = 0.04
                    msg = f"L20 soft at {l20}% — mild tighten +{self._l20_bump:.2f}"
                elif l20 >= 58 and (life is None or life >= 52):
                    self._l20_bump = -0.03
                    msg = f"L20 hot at {l20}% — slight loosen {self._l20_bump:.2f}"
                else:
                    msg = f"L20 stable at {l20}% — no drift correction"
                consolidate_notes.append(msg)
                self._log(msg)
            else:
                self._log("L20 drift: not enough recent samples")
        except Exception as e:
            self._log(f"L20 drift correction failed: {e}")

        # Night mute/promote on extreme seats (light, after full rebuild)
        try:
            muted = promoted = 0
            for r in hierarchy:
                wr = r.get("win_rate")
                total = (r.get("correct") or 0) + (r.get("wrong") or 0)
                name = r.get("agent")
                if not name or name not in getattr(learner, "weights", {}):
                    continue
                if wr is not None and wr < 0.40 and total >= 10:
                    old = learner.weights[name]
                    learner.weights[name] = max(
                        float(settings.BASE_WEIGHTS.get(name, 0.05)) * 0.35,
                        old * 0.92,
                    )
                    muted += 1
                elif wr is not None and wr >= 0.58 and total >= 8:
                    learner.weights[name] = min(
                        float(settings.BASE_WEIGHTS.get(name, 0.1)) * 1.6,
                        learner.weights[name] * 1.04,
                    )
                    promoted += 1
            if muted or promoted:
                if hasattr(learner, "_normalize"):
                    learner._normalize()
                leader.sync_from_learner()
                msg = f"Night dampen {muted} / promote {promoted} seat(s)"
                consolidate_notes.append(msg)
                self._log(msg)
        except Exception as e:
            self._log(f"Mute/promote pass: {e}")

        # ------------------------------------------------------------------
        # 5) Prune graded windows older than ~90 days
        # ------------------------------------------------------------------
        house: List[str] = []
        try:
            pruned = 0
            if hasattr(store, "prune_old_window_calls"):
                pruned = await store.prune_old_window_calls(days=PRUNE_DAYS)
            if pruned:
                msg = f"Pruned {pruned} graded windows older than {PRUNE_DAYS} days"
                house.append(msg)
                self._log(msg)
            else:
                self._log(f"Prune: no window_calls older than {PRUNE_DAYS} days")
        except Exception as e:
            self._log(f"Prune failed: {e}")

        # Trim old huddle log files (keep last 30)
        try:
            files = sorted(self.log_dir.glob("huddle-*.json"))
            if len(files) > 30:
                for f in files[:-30]:
                    f.unlink(missing_ok=True)
                house.append("Pruned old huddle logs (kept 30)")
                self._log(house[-1])
        except Exception as e:
            self._log(f"Huddle log prune: {e}")

        # ------------------------------------------------------------------
        # 6) Law cooldown bump if lock / rough day
        # ------------------------------------------------------------------
        law_bump_meta: Dict[str, Any] = {"active": False, "value": 0.0, "until": None, "reason": None}
        try:
            need_bump = False
            reason = None
            if law is not None:
                try:
                    st = law.status() if hasattr(law, "status") else {}
                    if st.get("lockdown") or int(st.get("lockdown_remaining") or 0) > 0:
                        need_bump = True
                        reason = "law lockdown active/recent"
                    elif int(st.get("post_unlock_strict") or 0) > 0:
                        need_bump = True
                        reason = "post-unlock strict still armed"
                except Exception:
                    pass
            wrong_streak = int(accuracy.get("wrong_streak") or 0)
            if wrong_streak >= 2:
                need_bump = True
                reason = reason or f"wrong streak {wrong_streak}"
            l20 = (accuracy.get("last_20") or {}).get("accuracy_pct")
            if l20 is not None and l20 < 42 and int(accuracy.get("total") or 0) >= 12:
                need_bump = True
                reason = reason or f"L20 collapsed to {l20}%"

            if need_bump:
                self._law_bump_value = 0.06
                self._law_bump_until = now_ct() + timedelta(hours=LAW_BUMP_HOURS)
                law_bump_meta = {
                    "active": True,
                    "value": self._law_bump_value,
                    "until": self._law_bump_until.isoformat(),
                    "reason": reason,
                    "hours": LAW_BUMP_HOURS,
                }
                msg = (
                    f"Law cooldown bump +{self._law_bump_value:.2f} for {LAW_BUMP_HOURS}h "
                    f"({reason})"
                )
                consolidate_notes.append(msg)
                self._log(msg)
            else:
                self._law_bump_value = 0.0
                self._law_bump_until = None
                self._log("Law cooldown: no lock / cold streak — no extra bump")
        except Exception as e:
            self._log(f"Law bump check failed: {e}")

        # Persist brain after all weight changes
        try:
            if hasattr(learner, "save"):
                learner.save()
                house.append("Persisted council-learning.json")
                self._log(house[-1])
        except Exception as e:
            self._log(f"Learner save failed: {e}")

        backfill_meta: Dict[str, Any] = {}
        try:
            snap = learner.snapshot() if hasattr(learner, "snapshot") else {}
            backfill_meta = (snap.get("backfill") or getattr(learner, "backfill", None) or {}) if isinstance(snap, dict) else {}
            if not isinstance(backfill_meta, dict):
                backfill_meta = {}
            n_bf = int(backfill_meta.get("hours_graded") or 0)
            if n_bf > 0:
                msg = (
                    f"Backfill tape: {n_bf} hour(s) tagged backfill "
                    f"(merge into live brain, not a wipe)"
                )
                house.append(msg)
                self._log(msg)
        except Exception as e:
            self._log(f"Backfill tag read: {e}")

        # ------------------------------------------------------------------
        # 7) Patterns + report
        # ------------------------------------------------------------------
        patterns = self._patterns(accuracy, hierarchy, phase_info)

        report: Dict[str, Any] = {
            "date": date_key,
            "complete": True,
            "started_at": now_ct().isoformat(),
            "timezone": "America/Chicago",
            "window": "03:00–03:15",
            "went_well": went_well,
            "went_poor": went_poor,
            "patterns": patterns,
            "consolidate_notes": consolidate_notes,
            "housekeeping": house,
            "phase": phase_info,
            "rebuilt_windows": rebuilt_n,
            "l20_bump": self._l20_bump,
            "law_bump": law_bump_meta,
            "backfill": backfill_meta,
            "accuracy_snapshot": {
                "total": accuracy.get("total"),
                "correct": accuracy.get("correct"),
                "wrong": accuracy.get("wrong"),
                "accuracy_pct": accuracy.get("accuracy_pct"),
                "last_20_pct": (accuracy.get("last_20") or {}).get("accuracy_pct"),
                "verdict": accuracy.get("verdict"),
                "shadow": accuracy.get("shadow"),
                "wrong_streak": accuracy.get("wrong_streak"),
            },
            "top_ranks": [
                {
                    "name": r.get("display_name"),
                    "rank": r.get("rank"),
                    "win_rate": r.get("win_rate"),
                    "correct": r.get("correct"),
                    "wrong": r.get("wrong"),
                }
                for r in (hierarchy[:5] if hierarchy else [])
            ],
            "activity": list(self.activity_log),
            "cool_down": {
                "active": True,
                "note": "Chair elevates confluence during 15-min huddle — fewer noise calls",
                "confluence_bump": self.cool_down_bump(),
            },
        }

        path = self.log_dir / f"huddle-{date_key}.json"
        try:
            path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            self._log(f"Wrote {path.name}")
        except Exception as e:
            self._log(f"Failed to write huddle log: {e}")

        self.last_report = report
        self.last_date = date_key
        self._log("Huddle complete — normal trading resumes after 3:15 AM CT")
        report["activity"] = list(self.activity_log)
        logger.info(f"Nightly huddle complete for {date_key}")
        return report

    def _log(self, msg: str) -> None:
        self.activity_log.append(msg)
        logger.info(f"HUDDLE {msg}")

    def _day_stats(self, accuracy: Dict[str, Any]) -> Dict[str, List[str]]:
        well: List[str] = []
        poor: List[str] = []
        total = int(accuracy.get("total") or 0)
        life = accuracy.get("accuracy_pct")
        l20 = (accuracy.get("last_20") or {}).get("accuracy_pct")

        if life is not None:
            if life >= 55:
                well.append(f"Lifetime edge healthy at {life}%")
            elif life < 48 and total >= 12:
                poor.append(f"Lifetime edge soft at {life}%")

        if l20 is not None:
            if l20 >= 55:
                well.append(f"Last-20 strong at {l20}%")
            elif l20 < 45:
                poor.append(f"Last-20 cold at {l20}% — hierarchy will mute losers")

        shadow = accuracy.get("shadow") or {}
        avg = shadow.get("avg_pts_per_call")
        if avg is not None:
            if avg > 0:
                well.append(f"Shadow book positive ({shadow.get('label')})")
            else:
                poor.append(f"Shadow book negative ({shadow.get('label')})")

        streak = accuracy.get("streak") or 0
        wrong_streak = accuracy.get("wrong_streak") or 0
        if streak >= 3:
            well.append(f"Current win streak: {streak}")
        if wrong_streak >= 3:
            poor.append(f"Current miss streak: {wrong_streak}")

        if not well and not poor:
            well.append(f"{total} settled calls on the board — keep logging")

        return {"went_well": well, "went_poor": poor}

    def _patterns(
        self,
        accuracy: Dict[str, Any],
        hierarchy: List[Dict],
        phase_info: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        out: List[str] = []
        l20 = (accuracy.get("last_20") or {}).get("accuracy_pct")
        life = accuracy.get("accuracy_pct")
        if l20 is not None and life is not None:
            drift = round(l20 - life, 1)
            if drift <= -8:
                out.append(f"Recent form lagging lifetime by {abs(drift)} pts — tighten bar")
            elif drift >= 8:
                out.append(f"Recent form beating lifetime by {drift} pts — edge alive")
            else:
                out.append(f"Recent vs lifetime drift {drift:+.1f} pts — stable")

        if phase_info and phase_info.get("phase"):
            out.append(
                f"Learning phase {phase_info.get('phase')} "
                f"(n={phase_info.get('n')})"
            )

        if hierarchy:
            spreads = [r.get("win_rate") for r in hierarchy if r.get("win_rate") is not None]
            if spreads:
                out.append(
                    f"Rank WR spread {min(spreads)*100:.0f}%–{max(spreads)*100:.0f}% "
                    f"across {len(hierarchy)} seats"
                )
            strong = [
                r
                for r in hierarchy
                if (r.get("win_rate") or 0) >= 0.55
                and ((r.get("correct") or 0) + (r.get("wrong") or 0)) >= 6
            ]
            if len(strong) >= 2:
                out.append(
                    "Strong coalition: "
                    + ", ".join(str(r.get("display_name")) for r in strong[:4])
                )
        if not out:
            out.append("Not enough sample for pattern claims yet")
        return out

    def cool_down_bump(self) -> float:
        """
        Extra confluence required:
          • during the 15-min 3 AM window
          • plus any post-huddle law bump still active
          • plus L20 drift correction applied at huddle time (window only)
        """
        bump = 0.0
        if is_huddle_window():
            bump += 0.12  # primary 15-min pause on noisy scalps
            bump += float(self._l20_bump or 0.0)
        n = now_ct()
        if self._law_bump_until and self._law_bump_until > n:
            bump += float(self._law_bump_value or 0.0)
        elif self._law_bump_until and self._law_bump_until <= n:
            self._law_bump_until = None
            self._law_bump_value = 0.0
        return max(0.0, bump)
