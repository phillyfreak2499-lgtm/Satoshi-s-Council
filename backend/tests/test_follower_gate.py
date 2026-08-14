"""Follower three-lock gate + live arming. Dummy secrets only — never real env values."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.services.follower_gate import (
    WRONG,
    FollowerAudit,
    FollowerGate,
    FollowerRuntime,
    sanitize_audit,
)


class FollowerGateTests(unittest.TestCase):
    def _gate(self, now=0.0, **kwargs):
        clock = {"t": float(now)}
        pings = []

        def _now():
            return clock["t"]

        g = FollowerGate(
            "admin-dummy",
            max_attempts=3,
            window_s=60.0,
            idle_s=480.0,
            arm_delay_s=8.0,
            now=_now,
            load_p2=lambda: "two-dummy",
            load_p3=lambda: "three-dummy",
            ping=pings.append,
            **kwargs,
        )
        g._clock = clock
        g._pings = pings
        return g

    def _open(self, g, ip="2.2.2.2"):
        ok, err, token, reason = g.unlock(ip, "admin-dummy", "two-dummy", "three-dummy")
        self.assertTrue(ok)
        self.assertEqual(err, "")
        self.assertEqual(reason, "ok")
        return token

    def _world(self, **over):
        base = {
            "law_locked": False,
            "huddle": False,
            "sick_feed": False,
            "mins_left": 40,
        }
        base.update(over)
        return base

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
        ok, err, token, reason = g.unlock("1.1.1.1", "admin-dummy", "", "")
        self.assertFalse(ok)
        self.assertEqual(err, WRONG)
        self.assertIsNone(token)
        self.assertEqual(reason, "wrong")

    def test_missing_lock_env_fails_closed(self):
        g = FollowerGate(
            "admin-dummy",
            load_p2=lambda: "",
            load_p3=lambda: "three-dummy",
        )
        self.assertFalse(g.verify("admin-dummy", "anything", "three-dummy"))

    def test_error_never_names_a_lock(self):
        g = self._gate()
        _, err, _, _ = g.unlock("10.0.0.1", "admin-dummy", "wrong", "three-dummy")
        self.assertEqual(err, WRONG)
        self.assertNotIn("2", err)
        self.assertNotIn("admin", err.lower())
        self.assertNotIn("lock", err.lower())

    def test_rate_limit_generic_wrong_password(self):
        g = self._gate()
        ip = "9.9.9.9"
        for _ in range(3):
            ok, err, _, reason = g.unlock(ip, "x", "y", "z")
            self.assertFalse(ok)
            self.assertEqual(err, WRONG)
            self.assertEqual(reason, "wrong")
        ok, err, token, reason = g.unlock(ip, "admin-dummy", "two-dummy", "three-dummy")
        self.assertFalse(ok)
        self.assertEqual(err, WRONG)
        self.assertIsNone(token)
        self.assertEqual(reason, "rate_limited")

    def test_session_after_success(self):
        g = self._gate()
        token = self._open(g)
        self.assertTrue(g.session_ok(token))
        self.assertFalse(g.session_ok("forged"))
        g.revoke(token)
        self.assertFalse(g.session_ok(token))

    def test_idle_relock_drops_live(self):
        g = self._gate()
        token = self._open(g)
        ok, err, view = g.set_live(token, "LIVE", on=True)
        self.assertTrue(ok)
        self.assertTrue(view["live"])
        g._clock["t"] = 500.0
        self.assertFalse(g.session_ok(token))
        self.assertIn("live_off", g._pings)
        self.assertTrue(any(e.get("event") == "idle_lock" for e in g.audit.recent()))

    def test_live_needs_typed_confirm_and_delay(self):
        g = self._gate()
        token = self._open(g)
        ok, err, _ = g.set_live(token, "yes", on=True)
        self.assertFalse(ok)
        self.assertEqual(err, "confirm")
        ok, err, view = g.set_live(token, "LIVE", on=True)
        self.assertTrue(ok)
        self.assertTrue(view["live"])
        self.assertFalse(view["armed"])
        rec = g.evaluate_order(
            token,
            {"asset": "btc", "side": "UP", "stake": 10, "contracts": 1, "live": True, "confirm_first": "LIVE"},
            self._world(),
        )
        self.assertFalse(rec["accepted"])
        self.assertEqual(rec["refuse"], "arm")
        g._clock["t"] = 8.0
        rec = g.evaluate_order(
            token,
            {"asset": "btc", "side": "UP", "stake": 10, "contracts": 1, "live": True},
            self._world(),
        )
        self.assertFalse(rec["accepted"])
        self.assertEqual(rec["refuse"], "confirm")
        rec = g.evaluate_order(
            token,
            {"asset": "btc", "side": "UP", "stake": 10, "contracts": 1, "live": True, "confirm_first": "LIVE"},
            self._world(),
            commit=False,
        )
        self.assertTrue(rec["accepted"])
        self.assertFalse(rec["routed"])
        self.assertEqual(g.runtime.book.contracts, 0)

    def test_law_huddle_sick_refuse_even_when_live(self):
        g = self._gate()
        token = self._open(g)
        g.set_live(token, "LIVE", on=True)
        g._clock["t"] = 9.0
        intent = {
            "asset": "btc",
            "side": "UP",
            "stake": 10,
            "contracts": 1,
            "live": True,
            "confirm_first": "LIVE",
        }
        self.assertEqual(g.evaluate_order(token, intent, self._world(law_locked=True))["refuse"], "law")
        self.assertEqual(g.evaluate_order(token, intent, self._world(huddle=True))["refuse"], "huddle")
        self.assertEqual(g.evaluate_order(token, intent, self._world(sick_feed=True))["refuse"], "sick_feed")

    def test_caps_refuse(self):
        g = self._gate()
        token = self._open(g)
        paper = {"asset": "eth", "side": "DOWN", "stake": 26, "contracts": 1, "live": False}
        self.assertEqual(g.evaluate_order(token, paper, self._world())["refuse"], "caps")
        paper["stake"] = 10
        paper["contracts"] = 5
        self.assertEqual(g.evaluate_order(token, paper, self._world())["refuse"], "caps")
        paper["contracts"] = 1
        self.assertEqual(g.evaluate_order(token, paper, self._world(mins_left=10))["refuse"], "caps")
        rec = g.evaluate_order(token, paper, self._world(mins_left=40))
        self.assertTrue(rec["accepted"])

    def test_audit_strips_password_material(self):
        dirty = sanitize_audit({
            "p1": "admin-dummy",
            "password": "x",
            "ok": False,
            "reason": "wrong",
        })
        self.assertNotIn("p1", dirty)
        self.assertNotIn("password", dirty)
        self.assertEqual(dirty.get("reason"), "wrong")
        g = self._gate()
        g.unlock("8.8.8.8", "admin-dummy", "leaked-two", "leaked-three")
        blob = json.dumps(g.audit.recent())
        self.assertNotIn("leaked-two", blob)
        self.assertNotIn("leaked-three", blob)
        self.assertNotIn("admin-dummy", blob)

    def test_unlock_and_live_ping(self):
        g = self._gate()
        token = self._open(g)
        self.assertIn("follower_unlocked", g._pings)
        g.set_live(token, "LIVE", on=True)
        self.assertIn("live_on", g._pings)
        g.live_off(token)
        self.assertIn("live_off", g._pings)

    def test_runtime_persists_caps_not_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "follower-runtime.json"
            rt = FollowerRuntime(path, now=lambda: 1.0)
            rt.record_accept(10, 1)
            raw = path.read_text(encoding="utf-8")
            self.assertNotIn("PASSWORD", raw)
            self.assertIn("max_stake", raw)
            again = FollowerRuntime(path, now=lambda: 1.0)
            self.assertEqual(again.book.contracts, 1)


class FollowerPublicSurfaceTests(unittest.TestCase):
    def test_public_document_has_no_follower_tab_or_gate(self):
        root = Path(__file__).resolve().parents[2]
        html = (root / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
        js = (root / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
        for needle in (
            "tabFollower",
            "followerGate",
            "followerPw1",
            "requestFollowerUnlock",
            "FOLLOWER_PASSWORD",
            'setMode("follower")',
            "Type LIVE to arm",
            "/api/follower/unlock",
            "/api/follower/order",
            "SEND THIS LOCK LIVE",
            "FOLLOWER_PASSWORD_2",
        ):
            self.assertNotIn(needle, html)
            self.assertNotIn(needle, js)

    def test_bundle_is_not_under_static(self):
        root = Path(__file__).resolve().parents[2]
        static = root / "frontend" / "static"
        self.assertFalse((static / "follower_bundle.js").exists())
        self.assertTrue((root / "frontend" / "protected" / "follower_bundle.js").is_file())
        self.assertTrue((root / "frontend" / "protected" / "follower_gate.html").is_file())


if __name__ == "__main__":
    unittest.main()
