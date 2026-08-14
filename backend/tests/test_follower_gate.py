"""Follower three-lock gate. Dummy secrets only — never real env values."""
from __future__ import annotations

import unittest

from backend.services.follower_gate import LATER, WRONG, FollowerGate


class FollowerGateTests(unittest.TestCase):
    def _gate(self, now=0.0):
        clock = {"t": float(now)}

        def _now():
            return clock["t"]

        g = FollowerGate(
            "admin-dummy",
            max_attempts=3,
            window_s=60.0,
            now=_now,
            load_p2=lambda: "two-dummy",
            load_p3=lambda: "three-dummy",
        )
        g._clock = clock
        return g

    def test_all_three_required(self):
        g = self._gate()
        self.assertTrue(g.verify("admin-dummy", "two-dummy", "three-dummy"))
        self.assertFalse(g.verify("admin-dummy", "two-dummy", "nope"))
        self.assertFalse(g.verify("admin-dummy", "nope", "three-dummy"))
        self.assertFalse(g.verify("nope", "two-dummy", "three-dummy"))
        self.assertFalse(g.verify("admin-dummy", "", ""))
        self.assertFalse(g.verify("", "", ""))

    def test_admin_alone_is_not_enough(self):
        g = self._gate()
        ok, err, token = g.unlock("1.1.1.1", "admin-dummy", "", "")
        self.assertFalse(ok)
        self.assertEqual(err, WRONG)
        self.assertIsNone(token)

    def test_missing_lock_env_fails_closed(self):
        g = FollowerGate(
            "admin-dummy",
            load_p2=lambda: "",
            load_p3=lambda: "three-dummy",
        )
        self.assertFalse(g.verify("admin-dummy", "anything", "three-dummy"))

    def test_error_never_names_a_lock(self):
        g = self._gate()
        _, err, _ = g.unlock("10.0.0.1", "admin-dummy", "wrong", "three-dummy")
        self.assertEqual(err, WRONG)
        self.assertNotIn("2", err)
        self.assertNotIn("admin", err.lower())
        self.assertNotIn("lock", err.lower())

    def test_rate_limit(self):
        g = self._gate()
        ip = "9.9.9.9"
        for _ in range(3):
            ok, err, _ = g.unlock(ip, "x", "y", "z")
            self.assertFalse(ok)
            self.assertEqual(err, WRONG)
        ok, err, _ = g.unlock(ip, "admin-dummy", "two-dummy", "three-dummy")
        self.assertFalse(ok)
        self.assertEqual(err, LATER)

    def test_session_after_success(self):
        g = self._gate()
        ok, err, token = g.unlock("2.2.2.2", "admin-dummy", "two-dummy", "three-dummy")
        self.assertTrue(ok)
        self.assertEqual(err, "")
        self.assertTrue(g.session_ok(token))
        self.assertFalse(g.session_ok("forged"))
        g.revoke(token)
        self.assertFalse(g.session_ok(token))


if __name__ == "__main__":
    unittest.main()
