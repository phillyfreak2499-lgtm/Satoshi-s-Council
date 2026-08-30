"""
WICK candle-literacy rules (candle_btc / candle_eth).

The lesson: location -> structure -> candle -> confirmation -> invalidation.
- A wick rejection mid-range is noise, not a vote.
- A wick rejection AT the window low/high votes, and names its invalidation.
- An inside bar is a coil: WAIT, vote the break.
- A poke beyond the window extreme that closes back inside is a trap:
  vote the fail direction, invalidation = the fake extreme.
- Confidence caps: voters never exceed 84; an open (provisional) bar caps 68.
- A dead bar (no range) is unreadable: WAIT.
- Wrong coin still refuses (WICK votes; it never locks).
"""
from __future__ import annotations

import asyncio
import time
import unittest

from backend.agents.candle import BitcoinPatternSpecialist


BAR_MS = 15 * 60 * 1000


def _mk_candles(n=30, base=100_000.0, t0=None, closed=True):
    """Flat-ish history of n bars; timestamps make the last bar CLOSED by default."""
    if t0 is None:
        # Last bar's open long in the past -> definitely closed.
        t0 = int(time.time() * 1000) - (n + 2) * BAR_MS
    out = []
    for i in range(n):
        p = base + (i % 3) * 5.0  # tiny wiggle, mid-range everything
        out.append({
            "t": t0 + i * BAR_MS, "open_time": t0 + i * BAR_MS,
            "open": p, "o": p,
            "high": p + 20.0, "h": p + 20.0,
            "low": p - 20.0, "l": p - 20.0,
            "close": p + 4.0, "c": p + 4.0,
            "volume": 10.0, "v": 10.0,
        })
    if not closed:
        # Shift so the LAST bar's bucket is still open right now.
        shift = int(time.time() * 1000) - out[-1]["open_time"] - BAR_MS // 2
        for c in out:
            c["t"] += shift
            c["open_time"] += shift
    return out


def _md(candles, asset="btc"):
    return {
        "asset": asset,
        "candles": candles,
        "atr_pct": 0.6,               # not quiet
        "volume_percentile": 80.0,    # not quiet
        "wm": {"phase": "entry"},
    }


def _sig(md):
    return asyncio.run(BitcoinPatternSpecialist().get_signal(md))


def _set_bar(c, o, h, l, cl):
    c["open"] = c["o"] = o
    c["high"] = c["h"] = h
    c["low"] = c["l"] = l
    c["close"] = c["c"] = cl


class WickLocation(unittest.TestCase):
    def test_lower_wick_mid_range_is_noise(self):
        cs = _mk_candles()
        # Window spans ~[99960, 100130]. Put a hammer well inside it: long
        # lower wick, tiny body near the bar high, bar far from the window low.
        _set_bar(cs[-1], 100_050.0, 100_052.0, 100_020.0, 100_051.0)
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "WAIT", sig.reasoning)
        self.assertIn("noise", sig.reasoning)

    def test_lower_wick_at_the_low_votes_up_with_invalidation(self):
        cs = _mk_candles()
        lo = min(c["low"] for c in cs[:-1])
        # Hammer AT the window low: long probe INTO the low zone (not through
        # it — a sweep through is the trap detector's case) closing near its high.
        _set_bar(cs[-1], lo + 40.0, lo + 44.0, lo + 1.0, lo + 42.0)
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "UP", sig.reasoning)
        self.assertIn("at the low", sig.reasoning)
        self.assertIn("invalidation", sig.features)
        self.assertAlmostEqual(sig.features["invalidation"], lo + 1.0, places=1)

    def test_sweep_through_the_low_is_a_trap_up(self):
        cs = _mk_candles()
        lo = min(c["low"] for c in cs[:-1])
        # Probe THROUGH the window low, close back above it: spring / trap.
        _set_bar(cs[-1], lo + 4.0, lo + 6.0, lo - 40.0, lo + 5.0)
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "UP", sig.reasoning)
        self.assertIn("break-and-fail", sig.reasoning)
        self.assertAlmostEqual(sig.features["invalidation"], lo - 40.0, places=1)

    def test_upper_wick_at_the_high_votes_down(self):
        cs = _mk_candles()
        hi = max(c["high"] for c in cs[:-1])
        # Star at the ceiling with a real body-down close so it is a rejection,
        # not a trap bar: open near the top, long upper probe, close near the low.
        _set_bar(cs[-1], hi - 2.0, hi + 40.0, hi - 8.0, hi - 6.0)
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "DOWN", sig.reasoning)
        self.assertIn("invalidation", sig.features)


class CoilAndTrap(unittest.TestCase):
    def test_inside_bar_is_wait(self):
        cs = _mk_candles()
        prev = cs[-2]
        _set_bar(cs[-1], prev["open"] + 2.0, prev["high"] - 5.0, prev["low"] + 5.0, prev["open"] + 3.0)
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "WAIT", sig.reasoning)
        self.assertIn("coil", sig.reasoning)
        self.assertTrue(sig.features.get("inside_bar"))

    def test_break_and_fail_votes_the_fail_direction(self):
        cs = _mk_candles()
        hi = max(c["high"] for c in cs[:-1])
        # Wick pokes above the prior window high, close back inside, smallish body.
        _set_bar(cs[-1], hi - 12.0, hi + 30.0, hi - 16.0, hi - 10.0)
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "DOWN", sig.reasoning)
        self.assertIn("break-and-fail", sig.reasoning)
        self.assertAlmostEqual(sig.features["invalidation"], hi + 30.0, places=1)


class ConfidenceRubric(unittest.TestCase):
    def test_voter_never_exceeds_84(self):
        cs = _mk_candles()
        lo = min(c["low"] for c in cs[:-1])
        _set_bar(cs[-1], lo + 4.0, lo + 6.0, lo - 40.0, lo + 5.0)
        md = _md(cs)
        # Stack every boost the seat can earn.
        md["wm"] = {"phase": "entry", "mean_rev_bias": "UP", "streak_dir": "UP", "streak_n": 5}
        sig = _sig(md)
        self.assertEqual(sig.direction, "UP")
        self.assertLessEqual(sig.confidence, 84)

    def test_open_bar_is_provisional_and_capped(self):
        cs = _mk_candles(closed=False)
        lo = min(c["low"] for c in cs[:-1])
        _set_bar(cs[-1], lo + 4.0, lo + 6.0, lo - 40.0, lo + 5.0)
        sig = _sig(_md(cs))
        self.assertTrue(sig.features.get("provisional_bar"), sig.features)
        if sig.direction != "WAIT":
            self.assertLessEqual(sig.confidence, 68)
            self.assertIn("provisional", sig.reasoning)


class Guards(unittest.TestCase):
    def test_dead_bar_is_wait(self):
        cs = _mk_candles()
        p = cs[-1]["open"]
        _set_bar(cs[-1], p, p, p, p)  # zero range
        sig = _sig(_md(cs))
        self.assertEqual(sig.direction, "WAIT")
        self.assertIn("Dead bar", sig.reasoning)

    def test_wrong_coin_still_refuses(self):
        cs = _mk_candles()
        sig = _sig(_md(cs, asset="eth"))
        self.assertEqual(sig.direction, "WAIT")
        self.assertIn("Wrong coin", sig.reasoning)

    def test_votes_never_claim_lock(self):
        cs = _mk_candles()
        lo = min(c["low"] for c in cs[:-1])
        _set_bar(cs[-1], lo + 4.0, lo + 6.0, lo - 40.0, lo + 5.0)
        sig = _sig(_md(cs))
        self.assertFalse(sig.features.get("final_call"), "WICK votes; Satoshi locks")


if __name__ == "__main__":
    unittest.main()
