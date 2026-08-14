"""Live Follower routing: Kalshi after gates. Seat Storm never places."""
from __future__ import annotations

import unittest
from pathlib import Path

from backend.data.kalshi_trade import book_side_for_lock, yes_price_dollars
from backend.services.follower_gate import FollowerGate
from backend.services.follower_route import route_accepted_live

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
GATE = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
BUNDLE_JS = (ROOT / "frontend" / "protected" / "follower_bundle.js").read_text(encoding="utf-8")
BUNDLE_HTML = (ROOT / "frontend" / "protected" / "follower_bundle.html").read_text(encoding="utf-8")
STORM = JS[JS.find("Seat Storm — pass-time after a Chair lock"):JS.find("function wireFloorChairClicks()")]


class QuoteHelperTests(unittest.TestCase):
    def test_book_side_yes_only(self):
        self.assertEqual(book_side_for_lock("UP"), "bid")
        self.assertEqual(book_side_for_lock("DOWN"), "ask")
        self.assertIsNone(book_side_for_lock("WAIT"))

    def test_price_normalizes_cents_and_dollars(self):
        self.assertEqual(yes_price_dollars(56), "0.5600")
        self.assertEqual(yes_price_dollars(0.56), "0.5600")
        self.assertIsNone(yes_price_dollars(0))
        self.assertIsNone(yes_price_dollars(100))

    def test_sign_request_is_base64(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        from backend.data.kalshi_trade import sign_request

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")
        sig = sign_request(pem, "1700000000000", "POST", "/trade-api/v2/portfolio/events/orders")
        self.assertGreater(len(sig), 80)
        self.assertNotIn("BEGIN", sig)


class RouteLiveTests(unittest.TestCase):
    def test_paper_never_calls_place(self):
        called = []

        async def place(**kwargs):
            called.append(kwargs)
            return {"ok": True, "order_id": "x"}

        rec = {"accepted": True, "live": False, "refuse": "", "side": "UP", "contracts": 1}
        out = self._run(route_accepted_live(rec, {"ticker": "KX", "side": "UP", "yes_ask": 50}, place=place))
        self.assertFalse(out["routed"])
        self.assertEqual(called, [])

    def test_refused_never_calls_place(self):
        called = []

        async def place(**kwargs):
            called.append(kwargs)
            return {"ok": True, "order_id": "x"}

        rec = {"accepted": False, "live": True, "refuse": "sick_feed", "side": "UP"}
        out = self._run(route_accepted_live(rec, {"ticker": "KX", "side": "UP", "yes_ask": 50}, place=place))
        self.assertFalse(out["routed"])
        self.assertEqual(out["refuse"], "sick_feed")
        self.assertEqual(called, [])

    def test_live_accepted_routes(self):
        called = []

        async def place(**kwargs):
            called.append(kwargs)
            return {"ok": True, "order_id": "ord-1"}

        rec = {
            "accepted": True,
            "live": True,
            "refuse": "",
            "side": "UP",
            "contracts": 2,
            "stake": 10,
        }
        lock = {"ticker": "KXBTCD-TEST", "side": "UP", "yes_ask": 44}
        out = self._run(route_accepted_live(rec, lock, place=place))
        self.assertTrue(out["routed"])
        self.assertTrue(out["accepted"])
        self.assertEqual(out["order_id"], "ord-1")
        self.assertEqual(called[0]["ticker"], "KXBTCD-TEST")
        self.assertEqual(called[0]["direction"], "UP")
        self.assertEqual(called[0]["contracts"], 2)

    def test_broker_fail_does_not_claim_routed(self):
        async def place(**kwargs):
            return {"ok": False, "refuse": "broker"}

        rec = {"accepted": True, "live": True, "refuse": "", "side": "DOWN", "contracts": 1}
        out = self._run(route_accepted_live(rec, {"ticker": "KX", "side": "DOWN", "yes_bid": 40}, place=place))
        self.assertFalse(out["routed"])
        self.assertFalse(out["accepted"])
        self.assertEqual(out["refuse"], "broker")

    def _run(self, coro):
        import asyncio
        return asyncio.run(coro)


class GateStillDoesNotPlaceTests(unittest.TestCase):
    def test_evaluate_order_has_no_kalshi_client(self):
        self.assertIn("Does not place a Kalshi order", GATE)
        self.assertNotIn("KalshiTradeClient", GATE)
        self.assertNotIn("portfolio/events/orders", GATE)

    def test_sick_feed_still_wins(self):
        clock = {"t": 0.0}
        g = FollowerGate(
            "admin-dummy",
            arm_delay_s=0.0,
            now=lambda: clock["t"],
            load_p2=lambda: "two-dummy",
            load_p3=lambda: "three-dummy",
        )
        ok, _, token, _ = g.unlock("1.1.1.1", "admin-dummy", "two-dummy", "three-dummy")
        self.assertTrue(ok)
        g.set_live(token, "LIVE", on=True)
        rec = g.evaluate_order(
            token,
            {"asset": "btc", "side": "UP", "stake": 10, "contracts": 1, "live": True, "confirm_first": "LIVE"},
            {"law_locked": False, "huddle": False, "sick_feed": True, "mins_left": 40},
        )
        self.assertFalse(rec["accepted"])
        self.assertEqual(rec["refuse"], "sick_feed")
        self.assertFalse(rec["routed"])


class WiringTests(unittest.TestCase):
    def test_main_routes_live_after_evaluate(self):
        self.assertIn("from_lock", MAIN)
        self.assertIn("route_accepted_live", MAIN)
        self.assertIn("commit=not want_live", MAIN)
        self.assertIn("def _chair_lock", MAIN)
        self.assertIn("sick_feed", MAIN)

    def test_hud_host_is_empty_in_public_doc(self):
        self.assertIn('id="lockLiveHost"', HTML)
        self.assertNotIn("SEND THIS LOCK LIVE", HTML)
        self.assertNotIn("SEND THIS LOCK LIVE", JS)
        self.assertNotIn("/api/follower/order", JS)
        self.assertNotIn("/api/follower/order", HTML)

    def test_bundle_owns_send_lock_live(self):
        self.assertIn("SEND THIS LOCK LIVE", BUNDLE_JS)
        self.assertIn("from_lock: true", BUNDLE_JS)
        self.assertIn("/api/follower/order", BUNDLE_JS)
        self.assertIn("Send live", BUNDLE_HTML)
        self.assertNotIn("Intended live held — not routed.", BUNDLE_JS)

    def test_storm_still_cannot_order(self):
        self.assertNotIn("/api/follower", STORM)
        self.assertNotIn("from_lock", STORM)
        self.assertNotIn("SEND THIS LOCK LIVE", STORM)

    def test_desk_snapshot_is_public_safe(self):
        self.assertIn("function deskLockSnapshot()", JS)
        self.assertIn("window.__deskLockSnapshot", JS)
        self.assertIn("window.__afterDeskUpdate", JS)


if __name__ == "__main__":
    unittest.main()
