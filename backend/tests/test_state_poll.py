"""Thin /api/state poll: cookie-gated, <30 KB, no research book."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
SECURITY = (ROOT / "SECURITY.md").read_text(encoding="utf-8")

from backend.services.state_poll import POLL_STRIP, thin_poll_state


def _fat_state() -> dict:
    agents = []
    for i in range(22):
        agents.append({
            "agent_name": f"seat_{i}",
            "display_name": f"SEAT {i}",
            "direction": "WAIT" if i else "LONG_DOWN",
            "confidence": 40 + i,
            "reasoning": "x" * 4000,
            "features": {"a": list(range(200)), "b": "y" * 500},
            "subs": [{"name": "sub", "reasoning": "z" * 800}],
            "muted": False,
            "faded": False,
            "category": "tape",
            "weight_used": 0.04,
        })
    accuracy = {
        "correct": 162, "total": 317, "wrong": 155, "accuracy_pct": 51.1,
        "log": [{"id": n, "note": "row" * 40} for n in range(400)],
        "lifetime": {"hits": 1000, "detail": "q" * 2000},
    }
    hierarchy = [{"agent": f"seat_{i}", "n": 5000, "win_rate": 0.5, "history": list(range(200))} for i in range(22)]
    learning = {"weights": {f"seat_{i}": 0.04 for i in range(22)}, "records": [{"r": "w" * 200} for _ in range(300)], "top_pairs": []}
    table = {
        "timestamp": "2026-08-21T10:00:00+00:00",
        "asset": "btc",
        "leader_name": "satoshi",
        "decision": {"direction": "WAIT", "confidence": 72, "summary": "WAIT · no leftover", "lean": "DOWN", "score": -0.2, "lockdown": False, "secret_math": "nope"},
        "agents": agents,
        "market": {"price": 72583.3, "funding": 0.0001, "oi": 12.0, "mins_left": 9.5, "seconds_left": 570, "candles": [[1, 2, 3, 4, 5]] * 60, "kalshi_ticker": "KXBTC15M"},
        "health": {"kalshi": True, "binance": False, "coinglass": False, "derivs_ok": False, "coinglass_reason": "no_key", "last_fetch_ms": 80},
        "accuracy": accuracy,
        "weights": learning["weights"],
        "hierarchy": hierarchy,
        "learning": learning,
        "huddle": {"now_ct": "05:00", "essay": "h" * 5000},
        "locked_call": None,
    }
    eth = dict(table)
    eth["asset"] = "eth"
    eth["leader_name"] = "vitalik"
    eth["agents"] = agents[:18]
    return {
        "timestamp": table["timestamp"],
        "asset": "btc",
        "dual": True,
        "decision": table["decision"],
        "agents": agents,
        "market": table["market"],
        "health": table["health"],
        "accuracy": accuracy,
        "weights": learning["weights"],
        "hierarchy": hierarchy,
        "learning": learning,
        "huddle": table["huddle"],
        "tables": {"bitcoin": table, "ethereum": eth},
        "btc": table,
        "eth": eth,
        "scorecard": {"btc": 51.1, "eth": 47.0},
        "leaders": {"bitcoin": "satoshi", "ethereum": "vitalik"},
    }


class ThinPollTests(unittest.TestCase):
    def test_strips_research_book_and_stays_small(self) -> None:
        fat = _fat_state()
        fat_bytes = len(json.dumps(fat))
        self.assertGreater(fat_bytes, 100_000)
        thin = thin_poll_state(fat)
        blob = json.dumps(thin, separators=(",", ":")).encode("utf-8")
        self.assertLess(len(blob), 30_000, len(blob))
        for banned in ("accuracy", "weights", "hierarchy", "learning", "huddle", "lifetime"):
            self.assertNotIn(banned, thin)
            self.assertNotIn(banned, thin["tables"]["bitcoin"] or {})
            self.assertNotIn(banned, thin["tables"]["ethereum"] or {})
        self.assertNotIn("btc", thin)
        self.assertNotIn("eth", thin)
        self.assertEqual(len(thin["agents"]), 22)
        self.assertEqual(thin["agents"][0]["direction"], "LONG_DOWN")
        self.assertNotIn("reasoning", thin["agents"][0])
        self.assertNotIn("features", thin["agents"][0])
        self.assertEqual(thin["decision"]["direction"], "WAIT")
        self.assertEqual(thin["market"]["mins_left"], 9.5)
        self.assertIn("kalshi", thin["health"])
        self.assertNotIn("candles", thin["market"])
        self.assertTrue(thin["dual"])
        self.assertEqual(len(thin["tables"]["ethereum"]["agents"]), 18)

    def test_poll_strip_covers_the_named_leaks(self) -> None:
        for k in ("accuracy", "weights", "hierarchy", "learning", "huddle"):
            self.assertIn(k, POLL_STRIP)


class GateSourceTests(unittest.TestCase):
    def test_middleware_does_not_exempt_api_state(self) -> None:
        mw = MAIN.split("async def require_desk_session", 1)[1].split("@app.get(\"/health\")", 1)[0]
        self.assertNotIn('request.url.path == "/api/state"', mw)
        self.assertIn("/api/desk/unlock", mw)
        self.assertIn("thin_poll_state", MAIN)

    def test_security_md_tells_the_truth(self) -> None:
        self.assertIn("including `GET /api/state`", SECURITY)
        self.assertIn("under 30 KB", SECURITY)
        self.assertNotIn("Stream is the free TV", MAIN)
        self.assertIn("accuracy", SECURITY.lower())


if __name__ == "__main__":
    unittest.main()
