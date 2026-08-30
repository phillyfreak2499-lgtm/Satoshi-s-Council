"""
P0 fixes from the security review.

F5 — admin_auth AttemptLimiter._sweep must not raise (module-level `import time`).
F2 — Follower idempotency must survive a process restart (durable ledger), while
     keeping the in-memory dedup and the atomic exposure reserve.
F1 — the live route stays inert without real broker creds (paper-safety lock-in).
"""
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.services.admin_auth import AttemptLimiter
from backend.services.follower_gate import FollowerGate, FollowerOrderLedger, FollowerRuntime
from backend.services.follower_route import route_accepted_live


def _mk_gate(clock, ledger_path=None, runtime_path=None):
    """A gate with locks wide open so tests exercise idempotency, not auth."""
    return FollowerGate(
        lambda: "p1",
        load_p2=lambda: "p2",
        load_p3=lambda: "p3",
        arm_delay_s=0.0,               # skip the arm wait in tests
        now=clock,
        order_ledger=FollowerOrderLedger(ledger_path, now=clock),
        runtime=FollowerRuntime(runtime_path, now=clock),
    )


def _armed_session(gate):
    ok, _err, token, _reason = gate.unlock("1.2.3.4", "p1", "p2", "p3")
    assert ok and token
    ok2, _e, _v = gate.set_live(token, "LIVE", on=True, lifetime_n=5)
    assert ok2
    return token


def _live_intent(key, stake=5.0, contracts=1):
    return {
        "asset": "btc", "side": "UP", "stake": stake, "contracts": contracts,
        "live": True, "confirm_first": "LIVE", "idempotency_key": key,
    }


_GOOD_WORLD = {"law_locked": False, "huddle": False, "sick_feed": False,
               "mins_left": 30.0, "lifetime_n": 5}
_KEY = "idem-key-abcdef 0123456789"  # 16..160 chars


class AdminLimiterSweep(unittest.TestCase):
    def test_sweep_over_cap_does_not_raise(self):
        # F5: _sweep referenced time.time() with no module import → NameError.
        lim = AttemptLimiter()
        for i in range(5001):
            lim._fails[f"k{i}"] = [0.0]      # ancient timestamps → prunable
        lim.note_fail("trigger")             # calls _sweep()
        self.assertLess(len(lim._fails), 5001)


class FollowerIdempotency(unittest.TestCase):
    def test_duplicate_same_session_refused(self):
        t = [1000.0]
        gate = _mk_gate(lambda: t[0])
        token = _armed_session(gate)
        first = gate.evaluate_order(token, _live_intent(_KEY), dict(_GOOD_WORLD))
        self.assertTrue(first["accepted"], first)
        second = gate.evaluate_order(token, _live_intent(_KEY), dict(_GOOD_WORLD))
        self.assertFalse(second["accepted"])
        self.assertEqual(second["refuse"], "duplicate")

    def test_duplicate_survives_restart(self):
        # F2: a fresh process (new gate, new session) reading the same ledger
        # file must still refuse a key that was already used.
        with TemporaryDirectory() as td:
            lp = Path(td) / "keys.json"
            rp = Path(td) / "rt.json"
            t = [1000.0]
            g1 = _mk_gate(lambda: t[0], ledger_path=lp, runtime_path=rp)
            tok1 = _armed_session(g1)
            self.assertTrue(g1.evaluate_order(tok1, _live_intent(_KEY), dict(_GOOD_WORLD))["accepted"])

            # "restart": brand-new gate + ledger loaded from the same file
            g2 = _mk_gate(lambda: t[0], ledger_path=lp, runtime_path=rp)
            tok2 = _armed_session(g2)
            dup = g2.evaluate_order(tok2, _live_intent(_KEY), dict(_GOOD_WORLD))
            self.assertFalse(dup["accepted"])
            self.assertEqual(dup["refuse"], "duplicate")

    def test_duplicate_does_not_double_reserve(self):
        # A refused duplicate must refund the exposure it briefly reserved, so
        # the daily book reflects one order, not two.
        t = [1000.0]
        gate = _mk_gate(lambda: t[0])
        token = _armed_session(gate)
        gate.evaluate_order(token, _live_intent(_KEY, stake=5.0, contracts=2), dict(_GOOD_WORLD))
        risk_after_first = gate.runtime.book.risk
        contracts_after_first = gate.runtime.book.contracts
        gate.evaluate_order(token, _live_intent(_KEY, stake=5.0, contracts=2), dict(_GOOD_WORLD))
        self.assertEqual(gate.runtime.book.risk, risk_after_first)
        self.assertEqual(gate.runtime.book.contracts, contracts_after_first)

    def test_released_key_can_retry(self):
        # A key freed after a non-routed broker attempt is reusable.
        with TemporaryDirectory() as td:
            lp = Path(td) / "keys.json"
            led = FollowerOrderLedger(lp)
            self.assertTrue(led.reserve(_KEY))
            self.assertTrue(led.seen(_KEY))
            led.release(_KEY)
            self.assertFalse(led.seen(_KEY))
            self.assertTrue(led.reserve(_KEY))  # reusable after release

    def test_idempotency_length_bounds(self):
        t = [1000.0]
        gate = _mk_gate(lambda: t[0])
        token = _armed_session(gate)
        short = gate.evaluate_order(token, _live_intent("x" * 15), dict(_GOOD_WORLD))
        self.assertEqual(short["refuse"], "idempotency")
        long_ = gate.evaluate_order(token, _live_intent("x" * 161), dict(_GOOD_WORLD))
        self.assertEqual(long_["refuse"], "idempotency")

    def test_atomic_reserve_still_caps(self):
        # Two distinct keys that together exceed max_contracts (4): second caps out.
        t = [1000.0]
        gate = _mk_gate(lambda: t[0])
        token = _armed_session(gate)
        a = gate.evaluate_order(token, _live_intent("key-aaaaaaaaaaaa-1", contracts=3), dict(_GOOD_WORLD))
        b = gate.evaluate_order(token, _live_intent("key-bbbbbbbbbbbb-2", contracts=3), dict(_GOOD_WORLD))
        self.assertTrue(a["accepted"])
        self.assertFalse(b["accepted"])
        self.assertEqual(b["refuse"], "caps")


class LiveRouteInert(unittest.TestCase):
    def test_accepted_live_does_not_route_without_creds(self):
        # F1: with the stub broker (trade_creds_ready()==False, place=None) an
        # accepted live intent must NOT route — the desk stays paper-safe.
        rec = {"accepted": True, "live": True, "refuse": "", "side": "UP",
               "stake": 5.0, "contracts": 1, "idempotency_key": _KEY}
        out = asyncio.run(route_accepted_live(rec, {"ticker": "KXBTC15M-T1", "side": "UP"}))
        self.assertFalse(out["routed"])
        self.assertFalse(out["accepted"])
        self.assertEqual(out["refuse"], "no_keys")


if __name__ == "__main__":
    unittest.main()
