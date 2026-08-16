"""Hourly BTC/ETH books are a strike ladder. Pick the playable rung, not ATM chalk."""
from __future__ import annotations

import unittest
from pathlib import Path

from backend.data.kalshi import pick_hour_book, score_ladder_contract

ROOT = Path(__file__).resolve().parents[2]
KALSHI = (ROOT / "backend" / "data" / "kalshi.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")


def _rung(strike: float, yes: float, no: float, *, close: str = "2026-08-16T04:00:00Z", series: str = "KXBTCD") -> dict:
    tick = f"{series}-26AUG1523-T{int(strike)}"
    return {
        "ticker": tick,
        "series_ticker": series,
        "title": f"BTC above {int(strike)}" if series == "KXBTCD" else f"ETH above {int(strike)}",
        "strike_type": "greater",
        "floor_strike": strike,
        "close_time": close,
        "yes_bid_dollars": yes - 0.01,
        "yes_ask_dollars": yes,
        "no_bid_dollars": no - 0.01,
        "no_ask_dollars": no,
        "status": "open",
    }


class HourLadderTests(unittest.TestCase):
    def test_zach_btc_or_above_picks_64_36_not_chalk(self):
        ladder = [
            _rung(62900, 0.98, 0.02),
            _rung(63000, 0.64, 0.36),
            _rung(63100, 0.02, 0.98),
        ]
        pick = pick_hour_book(ladder, spot=62950)
        self.assertIsNotNone(pick)
        self.assertEqual(pick["floor_strike"], 63000)
        self.assertIn("63000", pick["ticker"])
        self.assertTrue(score_ladder_contract(ladder[1], 62950)["playable"])
        self.assertFalse(score_ladder_contract(ladder[0], 62950)["playable"])
        self.assertFalse(score_ladder_contract(ladder[2], 62950)["playable"])
        near_chalk = pick_hour_book(ladder, spot=62920)
        self.assertEqual(near_chalk["floor_strike"], 63000)

    def test_cheap_wing_loses_to_near_spot_64_36(self):
        ladder = [
            _rung(60000, 0.22, 0.78),
            _rung(62900, 0.98, 0.02),
            _rung(63000, 0.64, 0.36),
            _rung(63100, 0.02, 0.98),
        ]
        pick = pick_hour_book(ladder, spot=62950)
        self.assertEqual(pick["floor_strike"], 63000)

    def test_eth_same_ladder_rule(self):
        ladder = [
            _rung(2480, 0.97, 0.03, series="KXETHD"),
            _rung(2500, 0.58, 0.42, series="KXETHD"),
            _rung(2520, 0.04, 0.96, series="KXETHD"),
        ]
        pick = pick_hour_book(ladder, spot=2490)
        self.assertEqual(pick["floor_strike"], 2500)
        self.assertTrue(str(pick["ticker"]).startswith("KXETHD"))

    def test_single_book_still_returns(self):
        only = [_rung(63000, 0.51, 0.49)]
        pick = pick_hour_book(only, spot=63000)
        self.assertEqual(pick["floor_strike"], 63000)

    def test_all_chalk_falls_back_to_nearest_spot(self):
        ladder = [
            _rung(62900, 0.98, 0.02),
            _rung(63100, 0.02, 0.98),
        ]
        pick = pick_hour_book(ladder, spot=62920)
        self.assertEqual(pick["floor_strike"], 62900)

    def test_later_hour_is_not_this_ladder(self):
        now = [
            _rung(62900, 0.98, 0.02, close="2026-08-16T04:00:00Z"),
            _rung(63000, 0.64, 0.36, close="2026-08-16T04:00:00Z"),
        ]
        later = [_rung(64000, 0.55, 0.45, close="2026-08-16T05:00:00Z")]
        pick = pick_hour_book(now + later, spot=62950)
        self.assertEqual(pick["floor_strike"], 63000)

    def test_gates_and_pick_stay_in_source(self):
        self.assertIn("def pick_hour_book", KALSHI)
        self.assertIn("LADDER_BAND_HI = 80.0", KALSHI)
        self.assertIn("not ATM chalk", KALSHI)
        self.assertIn("def early_lock_blocked", GATES)
        self.assertIn("def dead_book_reason", GATES)
        self.assertIn("btc_lead", GATES)
        self.assertNotIn("#passwordGate.password-gate,", CSS)
        self.assertIn("#passwordGate.password-gate:not(.hidden)", CSS)


if __name__ == "__main__":
    unittest.main()
