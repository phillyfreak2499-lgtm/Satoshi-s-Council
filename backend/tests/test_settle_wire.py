"""The settle sweep must have a real Kalshi client on the pipeline."""
from __future__ import annotations

import unittest

from backend.data.pipeline import DataPipeline
from backend.agents.chair_gates import collect_official_results, official_y_finish


class SettleWireTests(unittest.TestCase):
    def test_pipeline_carries_kalshi_client(self) -> None:
        p = DataPipeline(asset="btc")
        c = getattr(p, "kalshi", None)
        self.assertIsNotNone(c, "pipeline.kalshi missing — no call can ever grade")
        # council._official_results_for_opens detects methods on the class
        for name in ("get_event", "get_market"):
            self.assertTrue(callable(getattr(type(c), name, None)), name)

    def test_official_parsers_accept_raw_kalshi_bodies(self) -> None:
        event_body = {
            "event": {"event_ticker": "KXBTC15M-26AUG2213"},
            "markets": [{"ticker": "KXBTC15M-26AUG2213-T117249.99",
                         "status": "finalized", "result": "yes"}],
        }
        got = collect_official_results(event_body)
        self.assertEqual(
            official_y_finish(got.get("KXBTC15M-26AUG2213-T117249.99")), "UP")
        market_body = {"market": {"ticker": "KXETHD-26AUG2214-T4600",
                                  "status": "settled", "result": "no"}}
        got2 = collect_official_results(market_body)
        self.assertEqual(official_y_finish(got2.get("KXETHD-26AUG2214-T4600")), "DOWN")
