"""Dual loop cadence: 2s normal floor, 1.2s BEAST floor."""
from __future__ import annotations

import sys
import unittest
from unittest.mock import MagicMock

sys.modules.setdefault("httpx", MagicMock())
sys.modules.setdefault("tenacity", MagicMock())
sys.modules.setdefault("sqlalchemy", MagicMock())
sys.modules.setdefault("sqlalchemy.ext", MagicMock())
sys.modules.setdefault("sqlalchemy.ext.asyncio", MagicMock())
sys.modules.setdefault("sqlalchemy.orm", MagicMock())
sys.modules.setdefault("backend.data.binance", MagicMock())
sys.modules.setdefault("backend.data.kalshi", MagicMock())
sys.modules.setdefault("backend.data.pipeline", MagicMock())
sys.modules.setdefault("backend.storage.db", MagicMock())
sys.modules.setdefault("backend.storage", MagicMock())

from backend.config import settings
from backend.services.dual import BEAST_FLOOR_S, DUAL_FLOOR_S, compute_dual_interval
from backend.services.runtime_settings import DEFAULTS


class LoopCadenceTests(unittest.TestCase):
    def test_config_defaults_are_two_seconds(self):
        self.assertEqual(settings.ANALYSIS_INTERVAL, 2.0)
        self.assertEqual(settings.ANALYSIS_INTERVAL_BTC, 2.0)
        self.assertEqual(settings.ANALYSIS_INTERVAL_ETH, 2.0)
        self.assertEqual(settings.ANALYSIS_INTERVAL_HOT, 1.5)
        self.assertEqual(settings.ANALYSIS_INTERVAL_FLAT, 3.5)

    def test_runtime_profile_defaults_match_loop(self):
        self.assertEqual(DEFAULTS["normal"]["analysis_interval"], 2.0)
        self.assertEqual(DEFAULTS["normal"]["analysis_interval_hot"], 1.5)
        self.assertEqual(DEFAULTS["normal"]["analysis_interval_flat"], 3.5)
        self.assertEqual(DEFAULTS["beast"]["analysis_interval"], 1.2)
        self.assertGreaterEqual(DEFAULTS["beast"]["analysis_interval"], BEAST_FLOOR_S)

    def test_normal_quiet_uses_flat_and_two_second_floor(self):
        n = compute_dual_interval(beast=False, active=False, profile=DEFAULTS["normal"])
        self.assertGreaterEqual(n, DUAL_FLOOR_S)
        self.assertEqual(n, 3.5)

    def test_normal_active_stays_at_two_second_floor(self):
        n = compute_dual_interval(beast=False, active=True, profile=DEFAULTS["normal"])
        self.assertEqual(n, DUAL_FLOOR_S)

    def test_beast_can_run_at_1_2s(self):
        n = compute_dual_interval(beast=True, active=True, profile=DEFAULTS["beast"])
        self.assertGreaterEqual(n, BEAST_FLOOR_S)
        self.assertLess(n, DUAL_FLOOR_S)
        self.assertAlmostEqual(n, BEAST_FLOOR_S)


if __name__ == "__main__":
    unittest.main()
