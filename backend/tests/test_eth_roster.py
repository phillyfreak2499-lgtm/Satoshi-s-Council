"""Thin ETH roster: VOLT + EXHAUST only. Not Satoshi's BTC weights."""
from __future__ import annotations

import unittest
from pathlib import Path

from backend.config import eth_core_agent_set, prior_weight, settings
from backend.learning.adaptive import AdaptiveLearner
from backend.services.council import Council

ROOT = Path(__file__).resolve().parents[2]
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CFG = (ROOT / "backend" / "config.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


class EthRosterTests(unittest.TestCase):
    def test_eth_core_appends_volt_and_exhaust_only(self):
        core = eth_core_agent_set()
        self.assertIn("volatility", core)
        self.assertIn("exhaust", core)
        self.assertIn("guardian", core)
        self.assertIn("law", core)
        for banned in ("regime", "streak", "spotlag", "news"):
            self.assertNotIn(banned, core)
        raw = settings.ETH_CORE_AGENTS
        self.assertIn("volatility", raw)
        self.assertIn("exhaust", raw)
        self.assertNotIn("regime", raw)
        self.assertNotIn("streak", raw)
        self.assertNotIn("spotlag", raw)
        self.assertNotIn("news", raw)

    def test_live_eth_has_18_btc_still_22(self):
        eth = Council(asset="eth", leader_name="vitalik")
        btc = Council(asset="btc", leader_name="satoshi")
        eth_names = [getattr(a, "name", None) for a in eth.agents]
        btc_names = [getattr(a, "name", None) for a in btc.agents]
        self.assertEqual(len(eth.agents), 18, eth_names)
        self.assertEqual(len(btc.agents), 22, btc_names)
        self.assertIn("volatility", eth_names)
        self.assertIn("exhaust", eth_names)
        self.assertNotIn("regime", eth_names)
        self.assertNotIn("streak", eth_names)
        self.assertNotIn("spotlag", eth_names)
        self.assertNotIn("news", eth_names)
        self.assertIn("volatility", btc_names)
        self.assertIn("exhaust", btc_names)
        self.assertIn("regime", btc_names)
        self.assertIn("guardian", eth_names)
        self.assertIn("law", eth_names)

    def test_eth_priors_are_not_satoshi_numbers(self):
        self.assertNotEqual(prior_weight("eth", "volatility"), settings.BASE_WEIGHTS["volatility"])
        self.assertNotEqual(prior_weight("eth", "exhaust"), settings.BASE_WEIGHTS["exhaust"])
        self.assertEqual(prior_weight("btc", "volatility"), settings.BASE_WEIGHTS["volatility"])
        self.assertEqual(prior_weight("btc", "exhaust"), settings.BASE_WEIGHTS["exhaust"])
        self.assertLess(prior_weight("eth", "volatility"), 0.04)
        self.assertLess(prior_weight("eth", "exhaust"), 0.04)
        self.assertEqual(settings.BASE_WEIGHTS["volatility"], 0.07)
        self.assertEqual(settings.BASE_WEIGHTS["exhaust"], 0.09)

    def test_eth_brain_starts_quiet_until_own_hours(self):
        eth = AdaptiveLearner(asset="eth")
        btc = AdaptiveLearner(asset="btc")
        self.assertIn("volatility", eth.weights)
        self.assertIn("exhaust", eth.weights)
        self.assertNotIn("regime", eth.weights)
        self.assertNotIn("streak", eth.weights)
        self.assertNotIn("spotlag", eth.weights)
        self.assertNotIn("news", eth.weights)
        self.assertLess(eth.weights["volatility"], btc.weights["volatility"])
        self.assertLess(eth.weights["exhaust"], btc.weights["exhaust"])
        self.assertAlmostEqual(btc.weights["volatility"] / btc.weights["exhaust"], 0.07 / 0.09, places=5)
        self.assertNotAlmostEqual(
            eth.weights["volatility"] / eth.weights["exhaust"],
            0.07 / 0.09,
            places=3,
        )
        self.assertEqual(eth.correct["volatility"] + eth.wrong["volatility"], 0)
        self.assertEqual(eth.correct["exhaust"] + eth.wrong["exhaust"], 0)
        eth.correct["news"] = 117
        eth.wrong["news"] = 113
        eth.weights["news"] = 0.1
        eth.correct["regime"] = 10
        eth.wrong["spotlag"] = 10
        eth.weights["streak"] = 0.08
        eth._trim_eth_roster_weights()
        for ghost in ("news", "regime", "spotlag", "streak"):
            self.assertNotIn(ghost, eth.weights)
            self.assertNotIn(ghost, eth.correct)
            self.assertNotIn(ghost, eth.wrong)

    def test_eth_paper_lock_and_chair_gates_stay(self):
        self.assertIn("ETH_RELIABILITY_MIN_N: int = 8", CFG)
        self.assertIn("def eth_paper_lock_blocked", GATES)
        self.assertIn("def estimate_p_finish", GATES)
        self.assertIn("def leftover_after_vig", GATES)
        from backend.agents.chair_gates import eth_paper_lock_blocked

        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 0))
        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 7))
        self.assertIsNone(eth_paper_lock_blocked("ETH", 8))

    def test_floor_and_bots_show_eth_volt_exhaust(self):
        self.assertIn('volatility: "VOLT"', JS)
        self.assertIn('exhaust: "EXHAUST"', JS)
        self.assertIn('volatility: "/bots/volt.png"', JS)
        self.assertIn('exhaust: "/bots/exhaust.png"', JS)
        self.assertIn("live.volatility = true", JS)
        self.assertIn("live.exhaust = true", JS)
        self.assertIn("ethLive", JS)
        self.assertNotIn("ZT ·", JS)


if __name__ == "__main__":
    unittest.main()
