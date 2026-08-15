"""
School — short Floor lessons. Display / teach only.

Does not lock, size, grade, or change Chair math.
Does not import follower, Kalshi trade keys, or secrets.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")

# Exact Floor copy. JS mirrors the same ids, bodies, and A/B answers.
TF = ["True", "False"]
LESSONS: List[Dict[str, Any]] = [
    {
        "id": "hour",
        "n": 1,
        "title": "The hour",
        "minutes": 6,
        "idea": "Kalshi is not “is Bitcoin going up forever.” It is one window.",
        "body": [
            "Kalshi is not “is Bitcoin going up forever.” It is one window. A strike is the line. UP means finish above it when the clock hits zero. DOWN means finish below. Forty minutes left is a different game than four. The Chair only has to be right at the bell, not the whole hour.",
        ],
        "board": "window",
        "callout": "A strike is the line.",
        "quiz": [
            {"q": "This desk is guessing the next year of Bitcoin.", "choices": TF, "answer": 1},
            {"q": "UP means finish above the strike at the end of the hour.", "choices": TF, "answer": 0},
            {"q": "Time left does not change the trade.", "choices": TF, "answer": 1},
        ],
    },
    {
        "id": "candle",
        "n": 2,
        "title": "Reading the candle",
        "minutes": 7,
        "idea": "The body is where price spent the time. The wick is the rejected poke.",
        "body": [
            "The body is where price spent the time. The wick is the rejected poke. A long upper wick into the strike and a close back under it is not strength. It is a failed break. Watch close vs strike, not the loudest wick.",
        ],
        "board": "candle",
        "callout": "Watch close vs strike, not the loudest wick.",
        "quiz": [
            {"q": "The wick is more important than the close.", "choices": TF, "answer": 1},
            {"q": "A long upper wick that closes back under the strike is a failed break.", "choices": TF, "answer": 0},
            {"q": "The body shows where price actually spent the time.", "choices": TF, "answer": 0},
        ],
    },
    {
        "id": "book",
        "n": 3,
        "title": "The book",
        "minutes": 8,
        "idea": "Bid is what people will pay. Ask is what they will sell.",
        "body": [
            "Bid is what people will pay. Ask is what they will sell. Size is whether that price is real. If DOWN is 99¢, the market already thinks it is over. Buying that is paying a dollar to maybe win a penny. That is why the Chair WAITs. An empty book is the same: no one there to take the other side.",
        ],
        "board": "book",
        "callout": "If DOWN is 99¢, the market already thinks it is over.",
        "quiz": [
            {"q": "A 99¢ DOWN is a great lock because it is almost sure.", "choices": TF, "answer": 1},
            {"q": "Size tells you if the price is actually there.", "choices": TF, "answer": 0},
            {"q": "An empty book is a reason to WAIT.", "choices": TF, "answer": 0},
        ],
    },
    {
        "id": "edge",
        "n": 4,
        "title": "Odds vs P(finish)",
        "minutes": 8,
        "idea": "Odds are the market’s price. P(finish) is the Chair’s guess you finish on that side.",
        "body": [
            "Odds are the market’s price. P(finish) is the Chair’s guess you finish on that side. EV is the gap after the spread. If the Chair says 62% and DOWN costs 99¢, there is no edge. If it says 62% and UP costs 48¢ with size, that is a conversation. Never lock just because a seat is loud.",
        ],
        "board": "edge",
        "callout": "If the Chair says 62% and DOWN costs 99¢, there is no edge.",
        "quiz": [
            {"q": "A high Chair confidence is enough to lock.", "choices": TF, "answer": 1},
            {"q": "EV is P(finish) versus the price you actually pay, after spread.", "choices": TF, "answer": 0},
            {"q": "Market odds and Chair P(finish) are the same number.", "choices": TF, "answer": 1},
        ],
    },
    {
        "id": "seats",
        "n": 5,
        "title": "The seats",
        "minutes": 6,
        "idea": "WICK reads the candle. TAPE reads the flow. CARRY reads funding. CLOCK reads the session.",
        "body": [
            "WICK reads the candle. TAPE reads the flow. CARRY reads funding. CLOCK reads the session. They vote. The Chair only listens as hard as their rank. A hot seat with a bad record gets quieter. You are not picking a favorite bot. You are watching who earned the mic.",
        ],
        "board": "seats",
        "callout": "The Chair only listens as hard as their rank.",
        "quiz": [
            {"q": "The loudest seat should decide the lock.", "choices": TF, "answer": 1},
            {"q": "Rank is how hard the Chair hears that seat.", "choices": TF, "answer": 0},
            {"q": "WICK, TAPE, CARRY, and CLOCK each watch a different lane.", "choices": TF, "answer": 0},
        ],
    },
]


def week_id(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(CT)
    if n.tzinfo is None:
        n = n.replace(tzinfo=CT)
    else:
        n = n.astimezone(CT)
    iso = n.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def bump_week_streak(progress: Dict[str, Any] | None, now: Optional[datetime] = None) -> Dict[str, Any]:
    p = dict(progress or {})
    wid = week_id(now)
    week = dict(p.get("week") or {})
    if week.get("id") != wid:
        week = {"id": wid, "n": 0}
    week["n"] = int(week.get("n") or 0) + 1
    p["week"] = week
    return p


def lesson_by_id(lid: str) -> Optional[Dict[str, Any]]:
    for les in LESSONS:
        if les["id"] == lid:
            return les
    return None


def next_lesson_id(done: List[str] | None) -> str:
    have = set(done or [])
    for les in LESSONS:
        if les["id"] not in have:
            return str(les["id"])
    return str(LESSONS[0]["id"])


def grade_choice(lesson_id: str, q_index: int, choice: int) -> Dict[str, Any]:
    les = lesson_by_id(lesson_id)
    if not les:
        return {"ok": False, "why": "No such lesson.", "done": False}
    quiz = list(les.get("quiz") or [])
    if q_index < 0 or q_index >= len(quiz):
        return {"ok": False, "why": "No such question.", "done": False}
    item = quiz[q_index]
    ok = int(choice) == int(item["answer"])
    return {
        "ok": ok,
        "why": item.get("why") or ("Right." if ok else "Wrong."),
        "done": q_index >= len(quiz) - 1,
        "n": len(quiz),
    }


def school_payload() -> Dict[str, Any]:
    return {
        "lessons": LESSONS,
        "note": "Display only. Lessons do not change Chair locks.",
        "streak_label": "lessons this week",
    }
