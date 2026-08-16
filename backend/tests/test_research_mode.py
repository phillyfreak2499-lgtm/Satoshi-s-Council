"""
Research mode: muting the Kalshi-specific seats without distorting the Chair.

Exercises Leader._normalize_weights directly via __new__, skipping __init__ so
the test does not depend on learner state on disk.
"""
import unittest
from unittest.mock import patch

from backend.agents.leader import Leader
from backend.config import settings


BASE = {
    "candle": 0.10, "candle_btc": 0.10, "candle_eth": 0.07, "volume": 0.07,
    "momentum": 0.07, "orderflow": 0.06, "funding": 0.06, "regime": 0.05,
    "volatility": 0.07, "oi_pressure": 0.06, "streak": 0.06, "odds": 0.09,
    "strike": 0.11, "session_tod": 0.07, "whale": 0.08, "quorum": 0.07,
    "panic": 0.12, "cheap": 0.10, "spotlag": 0.10, "exhaust": 0.09,
    "guardian": 0.02,
}
MUTED = ["odds", "strike", "cheap"]


def _leader(weights):
    """A Leader with weights set, bypassing __init__ and its learner load."""
    leader = Leader.__new__(Leader)
    leader.weights = dict(weights)
    return leader


class ResearchMuteTests(unittest.TestCase):

    def test_off_by_default_matches_plain_normalization(self):
        """RESEARCH_MODE off must not change a single weight."""
        with patch.object(settings, "RESEARCH_MODE", False):
            leader = _leader(BASE)
            leader._normalize_weights()

        total = sum(BASE.values())
        for key, value in BASE.items():
            self.assertAlmostEqual(leader.weights[key], value / total, places=12)

    def test_muted_seats_go_silent(self):
        with patch.object(settings, "RESEARCH_MODE", True), \
             patch.object(settings, "RESEARCH_MUTE_SHARE", 0.0), \
             patch.object(settings, "RESEARCH_MUTED_AGENTS", MUTED):
            leader = _leader(BASE)
            leader._normalize_weights()

        for key in MUTED:
            self.assertEqual(leader.weights[key], 0.0)
        self.assertAlmostEqual(sum(leader.weights.values()), 1.0, places=12)

    def test_freed_weight_is_redistributed_not_lost(self):
        """Surviving seats must absorb the freed weight proportionally."""
        with patch.object(settings, "RESEARCH_MODE", True), \
             patch.object(settings, "RESEARCH_MUTE_SHARE", 0.0), \
             patch.object(settings, "RESEARCH_MUTED_AGENTS", MUTED):
            leader = _leader(BASE)
            leader._normalize_weights()

        survivors_total = sum(v for k, v in BASE.items() if k not in MUTED)
        for key, value in BASE.items():
            if key in MUTED:
                continue
            self.assertAlmostEqual(leader.weights[key], value / survivors_total, places=12)

    def test_repeated_normalization_does_not_compound(self):
        """
        Regression guard. _normalize_weights runs after every learning update.
        A multiplicative mute would shrink muted seats on each pass until they
        vanished regardless of the configured share.
        """
        with patch.object(settings, "RESEARCH_MODE", True), \
             patch.object(settings, "RESEARCH_MUTE_SHARE", 0.02), \
             patch.object(settings, "RESEARCH_MUTED_AGENTS", MUTED):
            leader = _leader(BASE)
            leader._normalize_weights()
            once = dict(leader.weights)

            for _ in range(25):
                leader._normalize_weights()

        for key, value in once.items():
            self.assertAlmostEqual(leader.weights[key], value, places=12)
        self.assertGreater(leader.weights["strike"], 0.015)

    def test_learned_weights_are_muted_too(self):
        """The mute must bite on learner values, not just BASE_WEIGHTS."""
        learned = dict(BASE)
        learned["strike"] = 0.31   # learner promoted it hard
        learned["news"] = 0.04     # seat absent from BASE_WEIGHTS

        with patch.object(settings, "RESEARCH_MODE", True), \
             patch.object(settings, "RESEARCH_MUTE_SHARE", 0.0), \
             patch.object(settings, "RESEARCH_MUTED_AGENTS", MUTED):
            leader = _leader(learned)
            leader._normalize_weights()

        self.assertEqual(leader.weights["strike"], 0.0)
        self.assertGreater(leader.weights["news"], 0.0)
        self.assertAlmostEqual(sum(leader.weights.values()), 1.0, places=12)

    def test_muting_every_seat_is_refused(self):
        """Never leave the Chair with nothing to normalize against."""
        with patch.object(settings, "RESEARCH_MODE", True), \
             patch.object(settings, "RESEARCH_MUTE_SHARE", 0.0), \
             patch.object(settings, "RESEARCH_MUTED_AGENTS", list(BASE.keys())):
            leader = _leader(BASE)
            leader._normalize_weights()

        self.assertAlmostEqual(sum(leader.weights.values()), 1.0, places=12)
        self.assertTrue(any(v > 0 for v in leader.weights.values()))

    def test_unknown_muted_seat_is_ignored(self):
        with patch.object(settings, "RESEARCH_MODE", True), \
             patch.object(settings, "RESEARCH_MUTE_SHARE", 0.0), \
             patch.object(settings, "RESEARCH_MUTED_AGENTS", ["does_not_exist"]):
            leader = _leader(BASE)
            leader._normalize_weights()

        self.assertAlmostEqual(sum(leader.weights.values()), 1.0, places=12)
        self.assertNotIn("does_not_exist", leader.weights)


if __name__ == "__main__":
    unittest.main()
