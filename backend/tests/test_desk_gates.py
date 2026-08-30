"""
Phase 1 desk gates: WARDEN veto, WICK location, ORBIT fade gating,
QUORUM families, LAW lockdown, the pre-lock checklist, and WAIT-not-a-miss.
"""
from __future__ import annotations

import asyncio
import time
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from backend.agents.base import AgentSignal
from backend.agents.candle import BitcoinPatternSpecialist
from backend.agents.law import LawBot
from backend.agents.leader import Leader
from backend.agents.panic import PanicSpecialist
from backend.agents.quorum import QuorumSpecialist


def _sig(name, direction, conf, category, features=None):
    return AgentSignal(name, direction, conf, f"{name} test", category, features=features or {})


def _guardian(binance=True, kalshi=True):
    return _sig("guardian", "WAIT", 20, "health", {"binance": binance, "kalshi": kalshi})


def _strong_board(direction="UP"):
    """Two families (structure + flow) leaning hard the same way."""
    return [
        _sig("candle_btc", direction, 80, "candle"),
        _sig("momentum", direction, 78, "momentum"),
        _sig("volume", direction, 76, "volume"),
    ]


_RF_OK = {"asset": "btc", "up_pct": 55.0, "yes_ask": 55.0, "no_ask": 47.0,
          "aggressiveness": 0.6}


class WardenVeto(unittest.TestCase):
    def test_both_feeds_down_forces_wait(self):
        leader = Leader()
        out = leader.synthesize(
            [_guardian(binance=False, kalshi=False)] + _strong_board(),
            dict(_RF_OK),
        )
        self.assertEqual(out["direction"], "WAIT")
        self.assertIn("WARDEN", out["summary"])

    def test_one_feed_down_caps_directional_confidence(self):
        leader = Leader()
        out = leader.synthesize(
            [_guardian(binance=False, kalshi=True)] + _strong_board(),
            dict(_RF_OK),
        )
        if out["direction"] in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD"):
            self.assertLessEqual(out["confidence"], 62)


class WickLocationGate(unittest.TestCase):
    def test_mid_range_wick_is_wait(self):
        # Compact re-assertion of the WICK rule inside the desk-gate suite.
        base = 100_000.0
        t0 = int(time.time() * 1000) - 40 * 900_000
        cs = []
        for i in range(30):
            p = base + (i % 3) * 5.0
            cs.append({"t": t0 + i * 900_000, "open_time": t0 + i * 900_000,
                       "open": p, "high": p + 20, "low": p - 20, "close": p + 4,
                       "o": p, "h": p + 20, "l": p - 20, "c": p + 4})
        # hammer far from the window low
        cs[-1].update({"open": base + 50, "o": base + 50, "high": base + 52, "h": base + 52,
                       "low": base + 20, "l": base + 20, "close": base + 51, "c": base + 51})
        md = {"asset": "btc", "candles": cs, "atr_pct": 0.6, "volume_percentile": 80,
              "wm": {"phase": "entry"}}
        sig = asyncio.run(BitcoinPatternSpecialist().get_signal(md))
        self.assertEqual(sig.direction, "WAIT")
        self.assertIn("noise", sig.reasoning)


class OrbitFadeGate(unittest.TestCase):
    def _md(self, quiet=True, streak=0):
        wm = {"phase": "entry"}
        if streak:
            wm.update({"streak_dir": "UP", "streak_n": streak})
        md = {"asset": "btc", "wm": wm}
        if quiet:
            md.update({"atr_pct": 0.05, "volume_percentile": 10})
        else:
            md.update({"atr_pct": 0.6, "volume_percentile": 80})
        return md

    def _run_panic(self, md, jump):
        seat = PanicSpecialist()
        md1 = dict(md, up_pct=50.0)
        asyncio.run(seat.get_signal(md1))          # seed mid history
        md2 = dict(md, up_pct=50.0 + jump)
        return asyncio.run(seat.get_signal(md2))   # the move

    def test_quiet_orbit_caps_soft_panic(self):
        sig = self._run_panic(self._md(quiet=True), jump=5.0)  # soft (< 2x thr)
        if sig.direction != "WAIT":
            self.assertLessEqual(sig.confidence, 72)
        self.assertIn("ORBIT", sig.reasoning)

    def test_hard_panic_passes_quiet_orbit(self):
        sig = self._run_panic(self._md(quiet=True), jump=10.0)  # hard (>= 2x thr)
        self.assertIn(sig.direction, ("UP", "DOWN"))
        self.assertGreater(sig.confidence, 72)
        self.assertTrue(sig.features.get("hard_trigger"))

    def test_trend_day_mutes_soft_fade(self):
        sig = self._run_panic(self._md(quiet=False, streak=5), jump=5.0)
        self.assertEqual(sig.direction, "WAIT")
        self.assertIn("trend day", sig.reasoning)


class QuorumFamilies(unittest.TestCase):
    def test_fade_pile_is_one_family(self):
        q = QuorumSpecialist()
        peers = {"panic": "UP", "exhaust": "UP", "cheap": "UP", "news": "UP"}
        sig = q.from_peers(peers, {"wm": {"phase": "entry"},
                                   "atr_pct": 0.6, "volume_percentile": 80})
        self.assertEqual(sig.features["family_up"], ["fade"])
        self.assertEqual(len(sig.features["family_up"]), 1)
        self.assertEqual(sig.direction, "WAIT")
        self.assertIn("famil", sig.reasoning)

    def test_two_families_can_lean(self):
        q = QuorumSpecialist()
        peers = {"panic": "UP", "exhaust": "UP", "candle_btc": "UP", "volume": "UP"}
        sig = q.from_peers(peers, {"wm": {"phase": "entry"},
                                   "atr_pct": 0.6, "volume_percentile": 80})
        self.assertGreaterEqual(sig.features["families_aligned"], 2)
        self.assertEqual(sig.direction, "UP")


class LawLockdown(unittest.TestCase):
    def test_two_wrongs_still_lock(self):
        law = LawBot()

        async def _no_findout(*a, **k):
            return {"findings": [], "fixes": []}

        law.run_find_out = _no_findout  # keep the test on the lock mechanics

        class _Store:
            async def recent_settled_calls(self, limit=20, asset=None):
                return [
                    {"id": 2, "correct": 0, "direction": "UP", "outcome": "DOWN", "ticker": "T2"},
                    {"id": 1, "correct": 0, "direction": "UP", "outcome": "DOWN", "ticker": "T1"},
                ]

        out = asyncio.run(law.evaluate_after_settle(_Store(), SimpleNamespace(weights={}), []))
        self.assertTrue(out["triggered"])
        self.assertTrue(law.is_locked())


class PreLockChecklist(unittest.TestCase):
    def test_chalk_book_refuses_lock(self):
        leader = Leader()
        rf = dict(_RF_OK, yes_ask=99.0)  # 99c wall
        out = leader.synthesize([_guardian()] + _strong_board(), rf)
        self.assertEqual(out["direction"], "WAIT")
        self.assertEqual(out.get("checklist_veto"), "chalk book")

    def test_one_family_lean_refuses_lock(self):
        leader = Leader()
        board = [
            _sig("candle_btc", "UP", 82, "candle"),
            _sig("momentum", "UP", 80, "momentum"),  # both structure family
        ]
        out = leader.synthesize([_guardian()] + board, dict(_RF_OK))
        self.assertEqual(out["direction"], "WAIT")
        self.assertEqual(out.get("checklist_veto"), "one-family lean")

    def test_healthy_two_family_board_can_lock(self):
        leader = Leader()
        out = leader.synthesize([_guardian()] + _strong_board(), dict(_RF_OK))
        self.assertIn(out["direction"], ("UP", "UP_HOLD"))
        self.assertEqual(out.get("checklist_veto"), "")


class WaitIsNotAMiss(unittest.TestCase):
    def test_wait_rows_are_not_scored(self):
        import os
        from backend.storage.db import PerformanceStore, WindowCall

        async def main():
            s = PerformanceStore()
            await s.init()
            before = await s.get_accuracy(asset="eth")
            now = datetime.now(timezone.utc).isoformat()
            async with s.Session() as sess:
                sess.add(WindowCall(ticker="KXETHD-TEST-T1", direction="WAIT",
                                    confidence=70, called_at=now,
                                    actual_outcome="WAIT", settle_reason="wait_finish",
                                    settled_at=now, correct=None, asset="eth"))
                sess.add(WindowCall(ticker="KXETHD-TEST-T2", direction="UP",
                                    confidence=70, called_at=now,
                                    actual_outcome="DOWN", settle_reason="finish_miss",
                                    settled_at=now, correct=0, asset="eth"))
                await sess.commit()
            after = await s.get_accuracy(asset="eth")
            return before, after

        before, after = asyncio.run(main())
        # Exactly ONE new graded call: the directional miss. The settled WAIT
        # row never enters the graded set as a miss.
        delta = int(after.get("calls_settled") or 0) - int(before.get("calls_settled") or 0)
        self.assertEqual(delta, 1)


class DecisionJournalRows(unittest.TestCase):
    def test_one_row_per_window_upsert(self):
        from backend.storage.db import PerformanceStore

        async def main():
            s = PerformanceStore()
            await s.init()
            await s.journal_window(window_id="2099-01-01T13:00:00Z", ticker="KXBTC15M-J1",
                                   asset="btc", phase="entry", chair_dir="WAIT",
                                   vetoes="checklist:one-family lean")
            await s.journal_window(window_id="2099-01-01T13:00:00Z", ticker="KXBTC15M-J1",
                                   asset="btc", phase="mid", chair_dir="UP",
                                   families={"families_aligned": 2}, fill_at_ask=56.0)
            return [r for r in await s.journal_rows()
                    if r["window_id"] == "2099-01-01T13:00:00Z"]

        rows = asyncio.run(main())
        self.assertEqual(len(rows), 1)          # one row per window
        self.assertEqual(rows[0]["chair_dir"], "UP")
        self.assertEqual(rows[0]["wait_flag"], 0)
        self.assertEqual(rows[0]["fill_at_ask"], 56.0)


if __name__ == "__main__":
    unittest.main()


class Phase2Surfaces(unittest.TestCase):
    def test_family_why_on_decision(self):
        leader = Leader()
        out = leader.synthesize([_guardian()] + _strong_board(), dict(_RF_OK))
        self.assertTrue(out.get("family_why"))
        self.assertIn("lean", out["family_why"])

    def test_proof_wait_hero_and_pnl(self):
        from datetime import datetime, timezone
        from backend.services.proof_cache import summarize_proof_rows
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        rows = ([{"direction": "WAIT", "correct": None}] * 6
                + [{"direction": "UP", "correct": 1, "regime_key": "15m",
                    "paper_pnl": 5.0, "open_price": 55.0, "y_finish": "UP",
                    "settled_at": now}] * 5)
        out = summarize_proof_rows(rows)
        self.assertEqual(out["wait_hero"]["wait_rate"], 54.5)   # 6 of 11
        self.assertEqual(out["wait_hero"]["line"], "WAIT is not a miss.")
        self.assertIn("path_pnl", out)
        self.assertEqual(out["path_pnl"]["base"], 1000.0)

    def test_proof_wait_hero_thin_sample_no_rate(self):
        from backend.services.proof_cache import summarize_proof_rows
        out = summarize_proof_rows([{"direction": "WAIT", "correct": None}] * 4)
        self.assertIsNone(out["wait_hero"]["wait_rate"])

    def test_alerts_off_by_default(self):
        from backend.services.desk_alerts import alerts_enabled, desk_alert
        self.assertFalse(alerts_enabled())
        self.assertFalse(desk_alert("chair_lock", "btc"))   # OFF
        self.assertFalse(desk_alert("not_allowed"))         # allowlist
