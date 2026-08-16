"""Dedicated BTC / ETH pattern specialists — not one shared Pattern Seer."""
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path

from backend.agents.base import AgentSignal
from backend.agents.candle import (
    BitcoinPatternSpecialist,
    EthereumPatternSpecialist,
    pattern_specialist_for_asset,
)
from backend.agents.chair_gates import (
    can_final_lock,
    canonicalize_pattern_vote_name,
    filter_pattern_signals_for_asset,
    seat_settle_key,
)
from backend.agents.leader import Leader
from backend.agents.roster import MAIN_ROSTER, title_of
from backend.config import prior_weight, settings
from backend.learning.adaptive import AdaptiveLearner
from backend.services.council import Council

ROOT = Path(__file__).resolve().parents[2]
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
WIRE = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
ROSTER = (ROOT / "backend" / "agents" / "roster.py").read_text(encoding="utf-8")


def _bars(n: int = 40, start: float = 100.0, step: float = 0.2) -> list:
    out = []
    px = start
    for i in range(n):
        o = px
        c = px + step
        hi = max(o, c) + 0.05
        lo = min(o, c) - 0.05
        out.append({"open": o, "high": hi, "low": lo, "close": c, "volume": 10})
        px = c
    return out


def _md(asset: str, ticker: str) -> dict:
    return {
        "asset": asset,
        "ticker": ticker,
        "candles": _bars(),
        "current_price": 108.0,
        "mins_left": 40,
        "wm": {"phase": "entry"},
        "phase": "entry",
    }


class PatternSpecialistSplitTests(unittest.TestCase):
    def test_names_and_titles_in_state(self):
        self.assertEqual(BitcoinPatternSpecialist.name, "candle_btc")
        self.assertEqual(EthereumPatternSpecialist.name, "candle_eth")
        self.assertEqual(title_of("candle_btc"), "Bitcoin Pattern Specialist")
        self.assertEqual(title_of("candle_eth"), "Ethereum Pattern Specialist")
        self.assertIn("Bitcoin Pattern Specialist", JS)
        self.assertIn("Ethereum Pattern Specialist", JS)
        self.assertIn("candle_btc", JS)
        self.assertIn("candle_eth", JS)
        self.assertIn("Bitcoin Pattern Specialist", ROSTER)
        self.assertIn("Ethereum Pattern Specialist", ROSTER)
        self.assertEqual(MAIN_ROSTER["candle_btc"][0], "WICK")
        self.assertEqual(MAIN_ROSTER["candle_eth"][0], "WICK")

    def test_internals_are_not_clones(self):
        btc = BitcoinPatternSpecialist
        eth = EthereumPatternSpecialist
        self.assertNotEqual(btc.lookback, eth.lookback)
        self.assertNotEqual(btc.body_ratio_bar, eth.body_ratio_bar)
        self.assertNotEqual(btc.ret5_bar, eth.ret5_bar)
        self.assertNotEqual(btc.ret15_bar, eth.ret15_bar)
        self.assertNotEqual(btc.wick_rej, eth.wick_rej)
        self.assertNotEqual(btc.mean_rev_boost, eth.mean_rev_boost)
        self.assertNotEqual(btc.prefer_mean_rev, eth.prefer_mean_rev)
        self.assertNotEqual(btc.extension_fade, eth.extension_fade)
        self.assertEqual(settings.BASE_WEIGHTS["candle_btc"], 0.10)
        self.assertEqual(settings.BASE_WEIGHTS["candle_eth"], 0.07)
        self.assertEqual(prior_weight("btc", "candle_btc"), 0.10)
        self.assertEqual(prior_weight("eth", "candle_eth"), 0.022)
        self.assertNotEqual(prior_weight("btc", "candle_btc"), prior_weight("eth", "candle_eth"))

    def test_no_cross_coin_answers(self):
        btc = BitcoinPatternSpecialist()
        eth = EthereumPatternSpecialist()
        btc_on_eth = asyncio.run(btc.get_signal(_md("eth", "KXETHD-26AUG1612-T1")))
        eth_on_btc = asyncio.run(eth.get_signal(_md("btc", "KXBTCD-26AUG1612-T1")))
        self.assertEqual(btc_on_eth.direction, "WAIT")
        self.assertEqual(eth_on_btc.direction, "WAIT")
        self.assertIn("Wrong coin", btc_on_eth.reasoning)
        self.assertIn("Wrong coin", eth_on_btc.reasoning)
        self.assertEqual(btc_on_eth.features.get("refused_asset"), "eth")
        self.assertEqual(eth_on_btc.features.get("refused_asset"), "btc")
        self.assertFalse(btc_on_eth.features.get("lock_force"))
        self.assertFalse(eth_on_btc.features.get("final_call"))

        btc_own = asyncio.run(btc.get_signal(_md("btc", "KXBTCD-26AUG1612-T1")))
        eth_own = asyncio.run(eth.get_signal(_md("eth", "KXETHD-26AUG1612-T1")))
        self.assertNotIn("Wrong coin", btc_own.reasoning)
        self.assertNotIn("Wrong coin", eth_own.reasoning)
        self.assertEqual(btc_own.agent_name, "candle_btc")
        self.assertEqual(eth_own.agent_name, "candle_eth")
        self.assertFalse(btc_own.features.get("final_call"))
        self.assertFalse(eth_own.features.get("final_call"))

    def test_settle_keys_are_not_shared(self):
        ticker, close = "KXBTCD-26AUG1612-T62999.99", "2026-08-16T16:00:00Z"
        btc_key = seat_settle_key("candle_btc", ticker, close)
        eth_key = seat_settle_key("candle_eth", ticker, close)
        legacy = seat_settle_key("candle", ticker, close)
        self.assertNotEqual(btc_key, eth_key)
        self.assertNotEqual(btc_key, legacy)
        self.assertTrue(btc_key.startswith("candle_btc|"))
        self.assertTrue(eth_key.startswith("candle_eth|"))
        self.assertEqual(canonicalize_pattern_vote_name("candle_eth", "btc"), None)
        self.assertEqual(canonicalize_pattern_vote_name("candle_btc", "eth"), None)
        self.assertEqual(canonicalize_pattern_vote_name("candle", "btc"), "candle_btc")
        self.assertEqual(canonicalize_pattern_vote_name("candle", "eth"), "candle_eth")

    def test_leaders_only_call_own_specialist(self):
        self.assertEqual(pattern_specialist_for_asset("btc").name, "candle_btc")
        self.assertEqual(pattern_specialist_for_asset("eth").name, "candle_eth")
        btc = Council(asset="btc", leader_name="satoshi")
        eth = Council(asset="eth", leader_name="vitalik")
        btc_names = [getattr(a, "name", None) for a in btc.agents]
        eth_names = [getattr(a, "name", None) for a in eth.agents]
        self.assertIn("candle_btc", btc_names)
        self.assertNotIn("candle_eth", btc_names)
        self.assertNotIn("candle", btc_names)
        self.assertIn("candle_eth", eth_names)
        self.assertNotIn("candle_btc", eth_names)
        self.assertNotIn("candle", eth_names)
        mixed = [
            AgentSignal("candle_btc", "UP", 70, "btc wick", "candle"),
            AgentSignal("candle_eth", "DOWN", 70, "eth wick", "candle"),
            AgentSignal("volume", "UP", 60, "flow", "volume"),
        ]
        satoshi_hears = filter_pattern_signals_for_asset(mixed, "btc")
        vitalik_hears = filter_pattern_signals_for_asset(mixed, "eth")
        self.assertEqual({s.agent_name for s in satoshi_hears}, {"candle_btc", "volume"})
        self.assertEqual({s.agent_name for s in vitalik_hears}, {"candle_eth", "volume"})
        out = Leader().synthesize(mixed, {"asset": "btc"})
        heard = {d.get("agent") or d.get("agent_name") for d in (out.get("details") or [])}
        if heard:
            self.assertNotIn("candle_eth", heard)

    def test_shared_bots_and_specialists_cannot_lock(self):
        self.assertTrue(can_final_lock("leader"))
        self.assertTrue(can_final_lock("chair"))
        for name in (
            "candle_btc", "candle_eth", "candle", "volume", "funding",
            "oi_pressure", "liq", "odds", "strike", "guardian", "law",
        ):
            self.assertFalse(can_final_lock(name), name)

    def test_not_floor_chairs_or_apprentice(self):
        self.assertNotIn("Pattern Apprentice", HTML + ROSTER)
        self.assertNotIn("Pattern Apprentice", JS)
        self.assertNotIn("Pattern Apprentice", WIRE)
        self.assertEqual(HTML.count('class="floor-chair-tog"'), 5)
        self.assertIn('data-floor-chair="bitcoin"', HTML)
        self.assertIn('data-floor-chair="ethereum"', HTML)
        self.assertNotIn("data-floor-chair=\"candle", HTML)

    def test_memory_and_weights_split(self):
        btc = AdaptiveLearner(asset="btc")
        eth = AdaptiveLearner(asset="eth")
        self.assertIn("candle_btc", btc.weights)
        self.assertNotIn("candle_eth", btc.weights)
        self.assertNotIn("candle", btc.weights)
        self.assertIn("candle_eth", eth.weights)
        self.assertNotIn("candle_btc", eth.weights)
        self.assertNotIn("candle", eth.weights)
        self.assertLess(eth.weights["candle_eth"], btc.weights["candle_btc"])
        eth2 = AdaptiveLearner(asset="eth")
        eth2.load_from_dict({
            "weights": {"candle": 0.10, "volume": 0.07, "candle_eth": 0.07},
            "correct": {"candle": 0},
            "wrong": {},
        })
        self.assertNotIn("candle", eth2.weights)
        self.assertNotIn("candle_btc", eth2.weights)
        self.assertIn("candle_eth", eth2.weights)
        self.assertLess(eth2.weights["candle_eth"], 0.08)
        eth3 = AdaptiveLearner(asset="eth")
        eth3.learn_from_settled(
            {
                "candle": {"direction": "UP", "confidence": 70},
                "candle_btc": {"direction": "DOWN", "confidence": 80},
            },
            "UP",
        )
        self.assertGreaterEqual(eth3.correct.get("candle_eth") or 0, 1)
        self.assertEqual(int(eth3.correct.get("candle_btc") or 0), 0)
        self.assertEqual(int(eth3.correct.get("candle") or 0), 0)

    def test_paper_follower_live_off(self):
        self.assertFalse(settings.SIDE_TABLE_LIVE)
        self.assertFalse(settings.FRONT_LIVE)
        self.assertIn("Paper. Follower OFF.", WIRE)
        self.assertIn("2026-08-16-pattern-specialists", WIRE)
        self.assertNotIn("ZT ·", WIRE.split("2026-08-16-pattern-specialists", 1)[1][:800])


if __name__ == "__main__":
    unittest.main()
