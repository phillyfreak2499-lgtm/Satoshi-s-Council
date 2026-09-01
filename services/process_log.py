"""
Process-quality log — judge the discipline, not just the hits.

A directional hit rate says whether the table got lucky. These metrics say
whether it followed its own rules. Both matter; neither replaces the other.

Two numbers:

  Confluence Rate    Of every directional call (non-WAIT), the share that
                     actually met the 3-of-4 alignment rule.

  Process Adherence  Of every recorded decision, the share where the call
                     Satoshi issued matches what the rules dictate given
                     the alignment count and veto state at that moment.

Adherence should sit at 100%. That is the point — it is an audit, not a
forecast. A number below 100% means the decision path drifted from the
stated rules and something is wrong, which is exactly what you want to see.

Stored as append-only JSON Lines next to the other runtime state, the same
shape as follower-audit.jsonl. No schema migration on the live paper DB.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from loguru import logger

from backend.services.round_table import (
    BUY_ZONE,
    FOUR,
    HOLD,
    MIN_ALIGNMENT,
    REDUCE,
    WAIT,
    canonical_call,
)

DIRECTIONAL = (BUY_ZONE, HOLD, REDUCE)
MAX_ROWS = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def expected_call_class(aligned: Any, veto_active: Any, *, override: bool = False) -> str:
    """
    What the rules dictate: "WAIT" or "DIRECTIONAL".

    A protective veto forces WAIT unless the unanimous-and-high-conviction
    override applied. Below the alignment floor, WAIT. Otherwise directional.
    """
    try:
        n = int(aligned or 0)
    except (TypeError, ValueError):
        n = 0
    if veto_active and not override:
        return "WAIT"
    if n < MIN_ALIGNMENT:
        return "WAIT"
    return "DIRECTIONAL"


def actual_call_class(call: Any) -> str:
    """
    "DIRECTIONAL" or "WAIT". Goes through canonical_call so rows written
    before the language change still classify correctly — otherwise every
    historical "BUY ZONE" would silently read as a stand-down.
    """
    return "DIRECTIONAL" if canonical_call(call) in DIRECTIONAL else "WAIT"


class ProcessLog:
    """Append-only decision log plus the two process metrics."""

    def __init__(self, path: Optional[Path] = None):
        self.path = path
        self._lock = threading.RLock()
        self._rows: List[Dict[str, Any]] = []
        self._last_key: Optional[tuple] = None
        self._load()

    # ── persistence ──────────────────────────────────────────────────
    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        rows: List[Dict[str, Any]] = []
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(row, dict):
                        rows.append(row)
        except OSError as e:
            logger.warning(f"Process log load failed: {e}")
            return
        self._rows = rows[-MAX_ROWS:]
        if self._rows:
            self._last_key = self._key(self._rows[-1])

    def _append_line(self, row: Dict[str, Any]) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, separators=(",", ":")) + "\n")
        except OSError as e:
            logger.debug(f"Process log write skip: {e}")

    @staticmethod
    def _key(row: Dict[str, Any]) -> tuple:
        return (
            str(row.get("call") or ""),
            int(row.get("aligned") or 0),
            bool(row.get("veto_active")),
            str(row.get("side") or ""),
        )

    # ── writes ───────────────────────────────────────────────────────
    def record_decision(self, board: Dict[str, Any], *, ref: Any = None) -> Optional[Dict[str, Any]]:
        """
        Record one Satoshi decision from a round-table board.

        Consecutive identical states collapse into one row, so a 2s analysis
        loop does not write thousands of duplicates for a table that has been
        sitting on WAIT all hour. Returns the row, or None when deduped.
        """
        if not isinstance(board, dict):
            return None
        final = board.get("final") if isinstance(board.get("final"), dict) else {}
        align = board.get("alignment") if isinstance(board.get("alignment"), dict) else {}
        if not final:
            return None

        row = {
            "ts": _now_iso(),
            "ref": str(ref) if ref is not None else None,
            "call": str(final.get("call") or WAIT),
            "side": final.get("side"),
            "aligned": int(final.get("aligned") or 0),
            "of": int(final.get("of") or FOUR),
            "confluence_ok": bool(final.get("confluence_ok")),
            "veto_active": bool(final.get("veto_active")),
            "veto_lines": list(final.get("veto_lines") or []),
            "rule": str(final.get("rule") or ""),
            "min_alignment": int(align.get("min_alignment") or MIN_ALIGNMENT),
            "leaders": [
                {
                    "leader": d.get("callsign") or d.get("leader"),
                    "call": d.get("call"),
                    "confidence": d.get("confidence"),
                    "rank": d.get("rank"),
                }
                for d in (board.get("debate") or [])
                if isinstance(d, dict)
            ],
            "outcome": None,
            "correct": None,
        }
        key = self._key(row)
        with self._lock:
            if key == self._last_key:
                return None
            self._last_key = key
            self._rows.append(row)
            if len(self._rows) > MAX_ROWS:
                self._rows = self._rows[-MAX_ROWS:]
            self._append_line(row)
        return row

    def settle(self, ref: Any, *, outcome: Any = None, correct: Optional[bool] = None) -> bool:
        """Attach an outcome to the most recent row carrying this ref."""
        target = str(ref) if ref is not None else None
        if target is None:
            return False
        with self._lock:
            for row in reversed(self._rows):
                if row.get("ref") == target:
                    row["outcome"] = outcome
                    row["correct"] = None if correct is None else bool(correct)
                    self._rewrite()
                    return True
        return False

    def settle_finish(self, ref: Any, finish: Any) -> bool:
        """
        Grade the council's OWN most-recent decision for this window against the
        official Kalshi finish (UP / DOWN). A directional call scores
        correct = (its side matched the finish); a stand-down records the finish
        for context but stays correct=None — sitting is never a miss. Idempotent:
        a row already carrying an outcome is left untouched, never re-graded.

        This is what gives the Round Table its own finish hit-rate (surfaced by
        metrics()/patience()), independent of the scalp engine's paper P&L.
        """
        target = str(ref) if ref is not None else None
        fin = str(finish or "").upper()
        if target is None or fin not in ("UP", "DOWN"):
            return False
        with self._lock:
            for row in reversed(self._rows):
                if row.get("ref") != target:
                    continue
                if row.get("outcome") is not None or row.get("correct") is not None:
                    return False  # already graded — never re-grade
                row["outcome"] = fin
                if actual_call_class(row.get("call")) == "DIRECTIONAL":
                    side = str(row.get("side") or "").upper()
                    row["correct"] = (side == fin) if side in ("UP", "DOWN") else None
                else:
                    row["correct"] = None  # stand-down: recorded, not graded
                self._rewrite()
                return True
        return False

    def _rewrite(self) -> None:
        """Rewrite the file after an in-place settle. Cheap at this size."""
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as fh:
                for row in self._rows:
                    fh.write(json.dumps(row, separators=(",", ":")) + "\n")
            tmp.replace(self.path)
        except OSError as e:
            logger.debug(f"Process log rewrite skip: {e}")

    # ── reads ────────────────────────────────────────────────────────
    def rows(self, limit: int = 500) -> List[Dict[str, Any]]:
        n = max(1, min(MAX_ROWS, int(limit)))
        with self._lock:
            return [dict(r) for r in self._rows[-n:]]

    def metrics(self, limit: int = MAX_ROWS) -> Dict[str, Any]:
        """Confluence Rate + Process Adherence, alongside the raw counts."""
        rows = self.rows(limit)
        total = len(rows)
        directional = [r for r in rows if actual_call_class(r.get("call")) == "DIRECTIONAL"]
        waits = total - len(directional)

        with_confluence = [r for r in directional if int(r.get("aligned") or 0) >= MIN_ALIGNMENT]
        conf_rate = (len(with_confluence) / len(directional)) if directional else None

        followed = 0
        breaches: List[Dict[str, Any]] = []
        for r in rows:
            override = str(r.get("rule") or "") == "confluence" and bool(r.get("veto_active"))
            want = expected_call_class(r.get("aligned"), r.get("veto_active"), override=override)
            got = actual_call_class(r.get("call"))
            if want == got:
                followed += 1
            else:
                breaches.append({
                    "ts": r.get("ts"), "call": r.get("call"),
                    "aligned": r.get("aligned"), "veto_active": r.get("veto_active"),
                    "expected": want, "actual": got,
                })
        adherence = (followed / total) if total else None

        vetoed = sum(1 for r in rows if r.get("veto_active"))
        graded = [r for r in rows if r.get("correct") is not None]
        hits = sum(1 for r in graded if r.get("correct"))

        return {
            "n": total,
            "directional": len(directional),
            "waits": waits,
            "wait_share_pct": round(100.0 * waits / total, 1) if total else None,
            "confluence_rate_pct": round(100.0 * conf_rate, 1) if conf_rate is not None else None,
            "confluence_met": len(with_confluence),
            "process_adherence_pct": round(100.0 * adherence, 1) if adherence is not None else None,
            "process_followed": followed,
            "process_breaches": breaches[-10:],
            "veto_decisions": vetoed,
            "min_alignment": MIN_ALIGNMENT,
            "of": FOUR,
            # Hit rate is kept alongside, never replaced by these.
            "graded": len(graded),
            "hits": hits,
            "hit_rate_pct": round(100.0 * hits / len(graded), 1) if graded else None,
            "label": _label(conf_rate, adherence, total),
            "patience": self.patience(limit),
        }

    def patience(self, limit: int = MAX_ROWS) -> Dict[str, Any]:
        """
        WAIT as a tracked outcome rather than a gap in the record.

        `avoided` counts WAIT decisions where the floor was leaning a side
        and the window went the other way — a call would have been wrong,
        so holding saved it. Only decisions carrying a settled outcome are
        counted; the rest are reported as unresolved rather than guessed at.
        """
        rows = self.rows(limit)
        waits = [r for r in rows if actual_call_class(r.get("call")) == "WAIT"]

        # current + longest run of consecutive WAIT decisions
        current = 0
        for r in reversed(rows):
            if actual_call_class(r.get("call")) == "WAIT":
                current += 1
            else:
                break
        longest = run = 0
        for r in rows:
            if actual_call_class(r.get("call")) == "WAIT":
                run += 1
                longest = max(longest, run)
            else:
                run = 0

        avoided = 0
        would_have_won = 0
        resolved = 0
        for r in waits:
            side = r.get("side")
            outcome = r.get("outcome")
            if not side or not outcome:
                continue
            resolved += 1
            if str(side).upper() != str(outcome).upper():
                avoided += 1
            else:
                would_have_won += 1

        return {
            "waits": len(waits),
            "n": len(rows),
            "streak": current,
            "longest_streak": longest,
            "avoided": avoided,
            "would_have_won": would_have_won,
            "resolved": resolved,
            "unresolved": len(waits) - resolved,
            "avoided_pct": round(100.0 * avoided / resolved, 1) if resolved else None,
            "label": _patience_label(current, avoided, resolved),
        }

    def weekly_review(self, limit: int = MAX_ROWS) -> Dict[str, Any]:
        """
        Auto-score for the Weekly Process Scorecard template.

        Combines process adherence, confluence on actions, wait discipline,
        and patience into a single 0–100 process grade plus plain-language
        notes a human can paste into their Decision Log review.
        """
        m = self.metrics(limit=limit)
        pat = m.get("patience") or {}
        n = int(m.get("n") or 0)
        adherence = m.get("process_adherence_pct")
        confluence = m.get("confluence_rate_pct")
        wait_share = m.get("wait_share_pct")
        streak = int(pat.get("streak") or 0)
        avoided = int(pat.get("avoided") or 0)
        resolved = int(pat.get("resolved") or 0)

        # Weighted process grade (0–100). Missing components do not punish.
        parts = []
        if adherence is not None:
            parts.append(("adherence", float(adherence), 0.40))
        if confluence is not None:
            parts.append(("confluence", float(confluence), 0.30))
        # Wait share is healthy in a band, not maximized — target ~35–75%
        if wait_share is not None:
            ws = float(wait_share)
            if 35 <= ws <= 75:
                wait_score = 100.0
            elif ws < 35:
                wait_score = max(0.0, 100.0 - (35 - ws) * 2.5)
            else:
                wait_score = max(0.0, 100.0 - (ws - 75) * 2.0)
            parts.append(("wait_discipline", wait_score, 0.20))
        # Patience credit: clean streak + avoided losses
        patience_score = min(100.0, 40.0 + streak * 8.0 + (20.0 if avoided else 0.0))
        parts.append(("patience", patience_score, 0.10))

        if parts:
            total_w = sum(w for _, _, w in parts)
            grade = sum(v * w for _, v, w in parts) / total_w if total_w else None
        else:
            grade = None

        notes = []
        if adherence is not None and adherence >= 95:
            notes.append("Rule adherence is strong — keep the confluence floor.")
        elif adherence is not None and adherence < 90:
            notes.append("Adherence slipped — review breaches and restore the Stand-down default.")
        if confluence is not None and confluence < 80 and (m.get("directional") or 0) > 0:
            notes.append("Directional calls are outrunning confluence — prefer Stand down when top seats diverge.")
        if streak >= 3:
            notes.append(f"Clean Stand-down streak of {streak} — process wins are compounding.")
        if avoided and resolved:
            notes.append(f"Patience saved {avoided} of {resolved} resolved stand-downs from becoming losses.")
        if n < 30:
            notes.append("Sample still building — treat expectancy lightly; process quality is the primary signal.")
        if not notes:
            notes.append("Steady process week — log one Decision Log row and keep the weekly cadence.")

        return {
            "ok": True,
            "n": n,
            "process_grade": round(grade, 1) if grade is not None else None,
            "process_adherence_pct": adherence,
            "confluence_rate_pct": confluence,
            "wait_share_pct": wait_share,
            "clean_wait_streak": streak,
            "longest_wait_streak": pat.get("longest_streak"),
            "avoided_losses": avoided,
            "patience_resolved": resolved,
            "hit_rate_pct": m.get("hit_rate_pct"),
            "label": m.get("label"),
            "notes": notes,
            "scorecard_blurb": (
                f"Process grade {round(grade)}/100 across {n} decisions. "
                + (" ".join(notes[:2]) if notes else "")
            ) if grade is not None else "No decisions logged yet — run the desk and return for a weekly score.",
            "template": "/templates/weekly-process-scorecard.md",
        }

    def export_rows(self, limit: int = MAX_ROWS) -> List[Dict[str, Any]]:
        """Flat rows for CSV/JSON export — one line per decision."""
        out = []
        for r in self.rows(limit):
            out.append({
                "timestamp": r.get("ts"),
                "final_call": r.get("call"),
                "side": r.get("side") or "",
                "alignment_count": r.get("aligned"),
                "of": r.get("of"),
                "confluence_ok": bool(r.get("confluence_ok")),
                "veto_active": bool(r.get("veto_active")),
                "veto_reason": "; ".join(str(x) for x in (r.get("veto_lines") or [])),
                "rule": r.get("rule"),
                "outcome": r.get("outcome") if r.get("outcome") is not None else "",
                "correct": "" if r.get("correct") is None else bool(r.get("correct")),
            })
        return out


EXPORT_COLUMNS = (
    "timestamp", "final_call", "side", "alignment_count", "of",
    "confluence_ok", "veto_active", "veto_reason", "rule", "outcome", "correct",
)


def rows_to_csv(rows: Iterable[Dict[str, Any]]) -> str:
    import csv
    import io

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(EXPORT_COLUMNS), extrasaction="ignore")
    w.writeheader()
    for row in rows:
        w.writerow(row)
    return buf.getvalue()


def _patience_label(streak: int, avoided: int, resolved: int) -> str:
    if streak <= 0:
        return "engaged"
    if resolved and avoided:
        return f"holding {streak} · {avoided} avoided"
    return f"holding {streak}"


def _label(conf_rate: Optional[float], adherence: Optional[float], n: int) -> str:
    if not n:
        return "no decisions yet"
    parts = []
    if conf_rate is not None:
        parts.append(f"confluence {round(100 * conf_rate)}%")
    else:
        parts.append("no directional calls yet")
    if adherence is not None:
        parts.append(f"process {round(100 * adherence)}%")
    return " · ".join(parts)


# ── Process-wide singleton ────────────────────────────────────────────
_LOG: Optional[ProcessLog] = None


def process_log() -> ProcessLog:
    global _LOG
    if _LOG is None:
        from backend.config import settings

        root = Path(getattr(settings, "DATA_DIR", None) or "./data")
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        _LOG = ProcessLog(root / "process-log.jsonl")
    return _LOG
