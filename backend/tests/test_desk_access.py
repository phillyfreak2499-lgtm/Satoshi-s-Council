"""Desk gate: server/env check. Dummy fixture only — never a real access value."""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from backend.data.secrets import reset_secret_cache
from backend.services.desk_access import ENV_NAME, WRONG, unlock_result

ROOT = Path(__file__).resolve().parents[2]
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
JS_SRC = (ROOT / "frontend" / "js" / "roundtable.js").read_text(encoding="utf-8")
WIRE = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
DEPLOY = (ROOT / "DEPLOY-SIMPLE.txt").read_text(encoding="utf-8")
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
DESK = (ROOT / "backend" / "services" / "desk_access.py").read_text(encoding="utf-8")

# Process-local fixture. Not a production code. Never commit a real value.
_FIXTURE = "desk-test-fixture"


def _init_gate(src: str) -> str:
    return src.split("function initPasswordGate", 1)[1].split("function initLogoCredit", 1)[0]


class DeskAccessServerTests(unittest.TestCase):
    def setUp(self):
        os.environ[ENV_NAME] = _FIXTURE
        reset_secret_cache(ENV_NAME)

    def tearDown(self):
        os.environ.pop(ENV_NAME, None)
        reset_secret_cache(ENV_NAME)

    def test_match_ok(self):
        self.assertEqual(unlock_result(_FIXTURE), {"ok": True})

    def test_wrong_is_generic(self):
        out = unlock_result("nope")
        self.assertEqual(out, {"ok": False, "error": WRONG})
        self.assertEqual(out["error"], "Wrong password")
        blob = json.dumps(out)
        self.assertNotIn(_FIXTURE, blob)

    def test_missing_env_fails_closed(self):
        os.environ.pop(ENV_NAME, None)
        reset_secret_cache(ENV_NAME)
        out = unlock_result(_FIXTURE)
        self.assertEqual(out, {"ok": False, "error": "Wrong password"})

    def test_empty_submitted_fails(self):
        self.assertEqual(unlock_result(""), {"ok": False, "error": "Wrong password"})
        self.assertEqual(unlock_result(None), {"ok": False, "error": "Wrong password"})

    def test_route_does_not_echo(self):
        self.assertIn('@app.post("/api/desk/unlock")', MAIN)
        self.assertIn("desk_unlock_result", MAIN)
        self.assertNotIn("print(", DESK)
        self.assertNotIn("logger.", DESK)
        self.assertIn("Never log", DESK)


class DeskAccessBundleTests(unittest.TestCase):
    def test_served_bundle_checks_server(self):
        init = _init_gate(JS)
        self.assertIn("/api/desk/unlock", init)
        self.assertIn("Wrong password", init)
        self.assertIn("tryUnlock()", init)
        self.assertNotIn("ACCESS_PASSWORD", JS)
        self.assertNotIn("ACCESS_PASSWORD", JS_SRC)
        self.assertNotRegex(init, r'v === "[^"]+"')
        self.assertNotRegex(_init_gate(JS_SRC), r'v === "[^"]+"')

    def test_docs_and_blueprint_have_no_literal(self):
        self.assertNotIn("PASSWORD:", DEPLOY)
        self.assertNotIn("Password:", DEPLOY)
        self.assertIn(ENV_NAME, DEPLOY)
        self.assertIn(ENV_NAME, RENDER)
        self.assertIn("sync: false", RENDER.split(ENV_NAME, 1)[1][:80])
        self.assertNotRegex(RENDER, rf"{ENV_NAME}\s*\n\s*value:")

    def test_wire_says_env_not_bundle(self):
        why = WIRE.split("2026-08-16-btc-15m-path-pnl", 1)[1]
        self.assertIn("Desk access is checked on the server from env", why)
        self.assertIn("served bundle does not contain the code", why)
        self.assertNotIn("ZT", why[:800])


if __name__ == "__main__":
    unittest.main()
