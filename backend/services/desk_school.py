"""Desk School — Bitcoin research-desk lessons.

Progressive lessons that teach the desk's process — reading the table,
building a case, and running a personal review loop. They never change a
Council conclusion, size a position, or connect to order routing.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")
TF = ["True", "False"]


def _lesson(
    ident: str, n: int, path: str, title: str, minutes: int, idea: str,
    body: str, callout: str, quiz: List[tuple[str, int]], board: str = "candle",
) -> Dict[str, Any]:
    return {
        "id": ident, "n": n, "path": path, "title": title, "minutes": minutes,
        "idea": idea, "body": [body], "board": board, "callout": callout,
        "quiz": [{"q": question, "choices": TF, "answer": answer} for question, answer in quiz],
    }


LESSONS: List[Dict[str, Any]] = [
    _lesson(
        "wait-is-a-win", 1, "Beginner · Read the Table", "WAIT is a position", 5,
        "A disciplined stand-down protects your next decision.",
        "A WAIT is not a missing prediction. It means the evidence is incomplete, stale, or divided. The Council records the reason, names the next review, and refuses to turn boredom into a trade.",
        "No aligned evidence means no active thesis.",
        [("A WAIT means the desk failed to make a prediction.", 1), ("A clear next review time makes a WAIT useful.", 0), ("Boredom is a valid reason to act.", 1)], "edge",
    ),
    _lesson(
        "timeframes", 2, "Beginner · Read the Table", "Noise has a clock", 6,
        "A one-hour move and a one-day structure can tell different stories.",
        "The Council reads 1h for immediate context, 4h for structure, and 1d for the broader trend. When they disagree, the disagreement is information. It is usually a reason to wait, not to force certainty.",
        "Name the timeframe before you name the opinion.",
        [("A 1h candle can replace a 1d trend by itself.", 1), ("Timeframe disagreement can justify a WAIT.", 0), ("The Council uses one timeframe only.", 1)], "candle",
    ),
    _lesson(
        "invalidation", 3, "Beginner · Read the Table", "Every thesis needs a door", 6,
        "An invalidation is what would make you reconsider—not a promise of a target.",
        "Before acting on any thesis, write the evidence that would weaken it. An invalidation turns a vague hope into a reviewable process. If you cannot say what would change your mind, you do not yet have a research case.",
        "A good thesis includes the evidence that could defeat it.",
        [("An invalidation means the thesis was dishonest.", 1), ("A thesis without an invalidation is incomplete.", 0), ("Targets matter more than conditions that would change your mind.", 1)], "seats",
    ),
    _lesson(
        "confluence", 4, "Intermediate · Build a Case", "Confluence, not applause", 7,
        "Different evidence lanes should agree for a reason.",
        "Confluence is not counting every bot that says the same thing. Structure, momentum, volume, and crowding are different lanes. A good case explains which lanes agree, which one dissents, and why the dissent does or does not block the conclusion.",
        "Four copies of one idea are not four independent signals.",
        [("Confluence means every agent must agree.", 1), ("Independent evidence lanes are stronger than duplicate signals.", 0), ("A dissenting specialist should be hidden from the user.", 1)], "seats",
    ),
    _lesson(
        "who-earns-the-mic", 5, "Intermediate · Build a Case", "Who earns the mic", 7,
        "Advisors are ranked by their record on Bitcoin calls, not by title.",
        "SATOSHI is the fixed centre and is never ranked. The four advisors earn their seat by being right over enough calls. The desk uses a Wilson lower-bound so a lucky 3-for-3 does not outrank a proven 40-of-55 — evidence beats streaks. A chronic loser is muted until it earns the mic back, which is why the same specialist can carry more weight on a different day.",
        "A small hot streak is not the same as a proven edge.",
        [("A 3-for-3 agent should always outrank a 40-of-55 agent.", 1), ("The desk ranks advisors by evidence, not by title.", 0), ("A muted advisor can earn its influence back.", 0)], "seats",
    ),
    _lesson(
        "crowding", 6, "Intermediate · Build a Case", "Crowding is context", 7,
        "Funding and open interest can describe positioning; they do not predict the next candle alone.",
        "When leverage looks crowded, the Council lowers confidence and asks for better structure before trusting a move. Crowding can amplify a trend, but it can also make late entries fragile. It is a caution flag, not a magic reversal button.",
        "Crowding changes the quality bar; it does not replace structure.",
        [("Elevated funding proves price must reverse now.", 1), ("Crowding can justify a higher bar for action.", 0), ("Funding and price trend are the same type of evidence.", 1)], "edge",
    ),
    _lesson(
        "review-loop", 7, "Intermediate · Build a Case", "Schedule the review", 6,
        "A decision is unfinished until it is reviewed at the horizon you declared.",
        "Record the thesis, confluence, risk, invalidation, and next review before checking an outcome. Later, compare the original record with what actually happened. That protects you from rewriting history after the fact.",
        "Write it before the outcome can flatter or embarrass you.",
        [("You should adjust the original thesis after the result is known.", 1), ("A predeclared review horizon reduces hindsight bias.", 0), ("Only profitable ideas deserve a review.", 1)], "edge",
    ),
    _lesson(
        "calibration", 8, "Advanced · Personal Process", "Confidence is a promise to audit", 8,
        "Confidence labels need completed samples before they mean anything.",
        "If the desk calls a setup strong, completed reviews should eventually show whether strong setups performed differently from cautious ones. Small samples are not proof. Separate results by horizon and regime, show the count, and treat uncertainty as part of the lesson.",
        "Rate without sample size is decoration.",
        [("A high hit rate from three reviews proves a durable edge.", 1), ("Confidence should be checked against completed outcomes.", 0), ("Regime and horizon do not affect evaluation.", 1)], "edge",
    ),
    _lesson(
        "weekly-review", 9, "Advanced · Personal Process", "Review the process, not just the chart", 8,
        "The best weekly review asks whether you followed your rules.",
        "Score whether you named a horizon, wrote an invalidation, honored the next review, and avoided acting without confluence. A lucky result cannot repair a poor process. A clean WAIT can be a better week than a reckless win.",
        "Process quality is visible before P&L is known.",
        [("A profitable result automatically proves good process.", 1), ("Weekly reviews should include disciplined WAITs.", 0), ("Rule adherence can be measured before the market resolves.", 0)], "seats",
    ),
    _lesson(
        "council-method", 10, "Advanced · Personal Process", "Use the Council Method anywhere", 7,
        "Evidence, dissent, decision, review is useful beyond markets.",
        "For a sales call, project decision, or leadership meeting: name the decision, collect independent evidence, invite dissent, record the risk, and set a review date. The method is transferable because it rewards honest process instead of loud certainty.",
        "Good decisions leave a trail someone else can inspect.",
        [("The Council Method only works for crypto charts.", 1), ("A clear dissent can improve a team decision.", 0), ("A decision record is useful only when the outcome is positive.", 1)], "seats",
    ),
]


def week_id(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(CT)
    n = n.replace(tzinfo=CT) if n.tzinfo is None else n.astimezone(CT)
    iso = n.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def bump_week_streak(progress: Dict[str, Any] | None, now: Optional[datetime] = None) -> Dict[str, Any]:
    progress = dict(progress or {})
    current = week_id(now)
    week = dict(progress.get("week") or {})
    if week.get("id") != current:
        week = {"id": current, "n": 0}
    week["n"] = int(week.get("n") or 0) + 1
    progress["week"] = week
    return progress


def lesson_by_id(lid: str) -> Optional[Dict[str, Any]]:
    return next((lesson for lesson in LESSONS if lesson["id"] == lid), None)


def next_lesson_id(done: List[str] | None) -> str:
    complete = set(done or [])
    return next((str(lesson["id"]) for lesson in LESSONS if lesson["id"] not in complete), str(LESSONS[0]["id"]))


def grade_choice(lesson_id: str, q_index: int, choice: int) -> Dict[str, Any]:
    lesson = lesson_by_id(lesson_id)
    if not lesson:
        return {"ok": False, "why": "No such lesson.", "done": False}
    quiz = list(lesson.get("quiz") or [])
    if q_index < 0 or q_index >= len(quiz):
        return {"ok": False, "why": "No such question.", "done": False}
    item = quiz[q_index]
    ok = int(choice) == int(item["answer"])
    return {"ok": ok, "why": "Right." if ok else "Try again: read the callout, then choose the process-safe answer.", "done": q_index >= len(quiz) - 1, "n": len(quiz)}


def school_payload() -> Dict[str, Any]:
    return {
        "lessons": LESSONS,
        "note": "Research and teaching only. Lessons never change a Council conclusion.",
        "streak_label": "lessons this week",
        "paths": ["Beginner · Read the Table", "Intermediate · Build a Case", "Advanced · Personal Process"],
    }
