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

# Lessons stay in this file so tests can read the copy. JS mirrors the same ids.
LESSONS: List[Dict[str, Any]] = [
    {
        "id": "hour",
        "n": 1,
        "title": "The hour",
        "minutes": 6,
        "idea": "One Kalshi hour. One strike. UP or DOWN at the close — not the vibe.",
        "body": [
            "Satoshi sits BTC. Vitalik sits ETH. Same game: a 1-hour contract, a strike printed on the ticker, and a clock that dies at minute 0.",
            "UP pays if the official finish is above the strike. DOWN pays if it finishes below. Mid-hour wicks do not grade the hour.",
            "“This window” is the contract on the 1H chip right now. When it slams, the next hour is a new book and a new Chair call. Last hour’s lock does not ride.",
            "If Kalshi has not posted market.result yet, the desk says OPEN. We do not invent HIT from spot.",
        ],
        "board": "window",
        "callout": "Strike is the line. Time left is the only clock.",
        "quiz": [
            {
                "q": "UP means the hour finishes where, vs strike?",
                "choices": ["Above the strike", "Below the strike", "Wherever it opened"],
                "answer": 0,
                "why": "UP is finish above strike. Wicks on the way do not pay.",
            },
            {
                "q": "When this window ends, the next hour…",
                "choices": ["Keeps the same strike", "Is a new contract", "Pays last hour’s WAIT"],
                "answer": 1,
                "why": "Minute 0 is a new book. New strike. New Chair call.",
            },
            {
                "q": "If Kalshi has not graded yet, Close should say?",
                "choices": ["HIT — spot looks good", "OPEN", "MISS — we guessed"],
                "answer": 1,
                "why": "OPEN until official market.result. No invented grade.",
            },
            {
                "q": "Who sits the BTC hour on this desk?",
                "choices": ["Vitalik", "Satoshi", "WICK"],
                "answer": 1,
                "why": "Satoshi is BTC. Vitalik is ETH. WICK is a seat, not the Chair.",
            },
        ],
    },
    {
        "id": "candle",
        "n": 2,
        "title": "Reading the candle",
        "minutes": 7,
        "idea": "Body is open-to-close. Wicks are the reach. Close vs strike is what pays.",
        "body": [
            "A candle is a cheap story: open, high, low, close. The body is open-to-close. The wicks are how far it reached and got rejected.",
            "Green body = close above open. Red body = close below open. That is path, not the grade.",
            "The hour grades close vs strike. A long upper wick that tags above strike and dies back under is still DOWN if the finish is under.",
            "Read the last hour on Full Charts the same way: body first, wick second, strike last. If there is no live tape, the board holds a still of a dead hour.",
        ],
        "board": "candle",
        "callout": "Body = path. Close vs strike = the grade.",
        "quiz": [
            {
                "q": "The candle body is…",
                "choices": ["High to low", "Open to close", "Strike to close"],
                "answer": 1,
                "why": "Body is open-to-close. Wicks are the high/low reach.",
            },
            {
                "q": "A long wick above strike that dies back under — if the finish is under, the hour is?",
                "choices": ["UP — it tagged", "DOWN", "WAIT forever"],
                "answer": 1,
                "why": "Tags do not pay. Finish vs strike pays.",
            },
            {
                "q": "What should you read first on this desk’s chart?",
                "choices": ["Twitter", "Body, then wick, then strike", "Funding only"],
                "answer": 1,
                "why": "Same chalkboard as Full Charts. Body, wick, strike.",
            },
            {
                "q": "WICK the seat is watching…",
                "choices": ["Candle shape", "The Chair’s P&L", "Altcoin perps"],
                "answer": 0,
                "why": "WICK reads candles. The Chair still decides.",
            },
        ],
    },
    {
        "id": "book",
        "n": 3,
        "title": "The book",
        "minutes": 8,
        "idea": "Bid is what you can sell. Ask is what you pay. Size is whether anyone is there. 99¢ is a WAIT.",
        "body": [
            "The Book tab is live Kalshi depth for this hour. Bid, ask, size, spread, mid. Satoshi’s BTC book and Vitalik’s ETH book.",
            "A fat bid with no size is a ghost. Empty book, sick book, or a one-tick wide desert — the Chair can WAIT. That is not fear. That is no fill.",
            "A 99¢ wall means the market already priced the finish. Buying the last penny is not edge. Why on the Floor will say it in one line: DOWN is 99¢, no edge.",
            "If the live book is quiet, the board shows a still. Same picture. Display only — this lesson does not lock.",
        ],
        "board": "book",
        "callout": "99¢ wall = WAIT. No edge left in the last penny.",
        "quiz": [
            {
                "q": "Ask is…",
                "choices": ["What you pay to buy", "What paid last hour", "The strike"],
                "answer": 0,
                "why": "Ask is the offer. Bid is what you can sell into.",
            },
            {
                "q": "Why can the Chair WAIT at 99¢?",
                "choices": ["Guaranteed edge if you smash it", "No edge left in the last penny", "Because Night mode is on"],
                "answer": 1,
                "why": "The book already priced the finish. Last penny is not a lock.",
            },
            {
                "q": "Size on the book means…",
                "choices": ["How loud WICK is", "Whether anyone is actually there", "P(finish)"],
                "answer": 1,
                "why": "No size = ghost quotes. Sick or empty book → WAIT is honest.",
            },
            {
                "q": "This lesson can change the Chair’s lock?",
                "choices": ["Yes, if you ace the quiz", "No. Display only", "Only on Live"],
                "answer": 1,
                "why": "School teaches. It does not lock. Paper only. Follower OFF.",
            },
        ],
    },
    {
        "id": "edge",
        "n": 4,
        "title": "Odds vs P(finish)",
        "minutes": 8,
        "idea": "Odds are the book’s price. P(finish) is the Chair’s read. EV is after spread — and it can be nothing.",
        "body": [
            "Odds are what the book is charging for UP or DOWN. P(finish) is the Chair’s number for how likely that side finishes.",
            "If the book wants 70¢ and the Chair only has 62% P(finish), that is not a lock. You are paying more than you think you win.",
            "EV is the leftover after the spread. A pretty P with a fat ask still dies. Why will say no edge, stale quote, or sick book — one line, this hour only.",
            "There is no guaranteed edge on this desk. Paper only. The Chair can WAIT the whole hour and be right.",
        ],
        "board": "edge",
        "callout": "Edge = P(finish) minus what the book charges, after spread.",
        "quiz": [
            {
                "q": "Odds on this desk are…",
                "choices": ["The book’s price", "A promise you hit", "Yesterday’s hit rate"],
                "answer": 0,
                "why": "Odds are the book. P(finish) is the Chair’s read.",
            },
            {
                "q": "Chair has edge when…",
                "choices": ["P(finish) beats the ask after spread", "Any UP over 50%", "You feel it"],
                "answer": 0,
                "why": "P has to clear what you pay. Spread eats the cute ones.",
            },
            {
                "q": "A fat spread does what to EV?",
                "choices": ["Nothing", "Eats it", "Guarantees a lock"],
                "answer": 1,
                "why": "EV is after spread. Wide book, thin leftover.",
            },
            {
                "q": "Is there a guaranteed edge here?",
                "choices": ["Yes, if you finish School", "No", "On Live only"],
                "answer": 1,
                "why": "No guaranteed edge. WAIT is a real call.",
            },
        ],
    },
    {
        "id": "seats",
        "n": 5,
        "title": "The seats",
        "minutes": 6,
        "idea": "Four voices. Chair only listens as hard as rank.",
        "body": [
            "WICK reads the candle — body, wick, reject. Not the Chair. A seat.",
            "TAPE walks the book — prints, size, whether the quote is real.",
            "CARRY watches funding / rate. Useful, not a crystal ball.",
            "CLOCK is session and time-of-day. The hour has a mood. It does not get a vote bigger than its rank.",
            "The Chair hears them in rank order. A faded seat can talk. It does not drive the lock. Rank is how hard they get listened to — not a trophy.",
        ],
        "board": "seats",
        "callout": "WICK · TAPE · CARRY · CLOCK — Chair listens as hard as rank.",
        "quiz": [
            {
                "q": "WICK’s one job?",
                "choices": ["Candle shape", "Funding", "The Close recap"],
                "answer": 0,
                "why": "WICK is the candle seat.",
            },
            {
                "q": "TAPE is watching…",
                "choices": ["The book / prints", "NFP only", "Your phone"],
                "answer": 0,
                "why": "TAPE walks the book.",
            },
            {
                "q": "CARRY is the…",
                "choices": ["Rate / funding seat", "Ring clock", "Paper Tracker"],
                "answer": 0,
                "why": "CARRY is funding. CLOCK is session.",
            },
            {
                "q": "The Chair listens to a seat…",
                "choices": ["As hard as its rank", "Only if you liked the lesson", "Always 100%"],
                "answer": 0,
                "why": "Rank is listen weight. Faded seats still speak. They do not drive.",
            },
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
