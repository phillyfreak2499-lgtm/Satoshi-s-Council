"""HELP tab: desk tickets to Zach. Persist, rate-limit, no contact leak."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import desk_help as help_mod
from backend.services.desk_help import GENERIC, KINDS, list_tickets, reset_rate_limits, submit

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
HELP_JS = (ROOT / "frontend" / "static" / "help.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
HELP_PY = (ROOT / "backend" / "services" / "desk_help.py").read_text(encoding="utf-8")
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")

# Channel leaks only — never a real phone or inbox.
CONTACT_NEEDLES = ("mailto:", "sms:", "tel:", "twilio", "@gmail.com")


class HelpMarkupTests(unittest.TestCase):
    def test_tab_and_view(self):
        self.assertIn('id="tabHelp"', HTML)
        self.assertIn('data-mode="help"', HTML)
        self.assertIn(">HELP</button>", HTML)
        self.assertIn('id="helpView"', HTML)
        self.assertIn('id="helpForm"', HTML)
        self.assertIn('id="helpText"', HTML)
        self.assertIn('data-kind="WRONG"', HTML)
        self.assertIn('data-kind="ADD"', HTML)
        self.assertIn('data-kind="IDEA"', HTML)
        self.assertIn('data-kind="SHOUT"', HTML)
        self.assertIn('id="helpVenmo"', HTML)
        self.assertIn('href="https://venmo.com/u/zachery-Teas-1"', HTML)
        self.assertIn("@zachery-Teas-1", HTML)
        self.assertIn("Tip Zach", HTML)
        self.assertEqual(HTML.count("zachery-Teas-1"), 2)
        self.assertNotIn("text me", HTML.lower())
        self.assertIn("FILE IT", HTML)
        self.assertNotIn("bug report", HTML.lower())
        self.assertIn("<title>Satoshi’s Council</title>", HTML)
        self.assertNotIn("ZT ·", HTML.split('id="helpView"', 1)[1][:800])
        self.assertIn("Paper. Follower OFF.", HTML.split('id="helpView"', 1)[1][:500])
        self.assertLess(HTML.find('id="tabWire"'), HTML.find('id="tabHelp"'))
        self.assertLess(HTML.find('id="tabHelp"'), HTML.find('id="tabSchool"'))
        self.assertIn('src="/help.js"', HTML)
        self.assertIn('id="btnHelp"', HTML)

    def test_admin_list_is_behind_settings_template(self):
        live = HTML.split('<template id="adminDeskTemplate">')[0]
        self.assertNotIn('id="helpAdminList"', live)
        self.assertNotIn('id="helpAdminCard"', live)
        tpl = HTML.split('<template id="adminDeskTemplate">', 1)[1]
        self.assertIn('id="helpAdminList"', tpl)
        self.assertIn("HELP TICKETS", tpl)

    def test_js_mode_and_cycle(self):
        self.assertIn('mode === "help"', JS)
        self.assertIn("window.loadHelpDesk", JS)
        cycle = JS.split("window.__deskModeCycle = function", 1)[1][:400]
        self.assertIn('"help"', cycle)
        self.assertIn("function loadHelpDesk", HELP_JS)
        self.assertIn("/api/help", HELP_JS)
        self.assertIn("/api/admin/help", HELP_JS)
        self.assertIn("Could not send.", HELP_JS)
        self.assertNotIn("rate limit", HELP_JS.lower())
        self.assertNotIn("cooldown", HELP_JS.lower())

    def test_css_chrome(self):
        self.assertIn("body.mode-help #tabHelp", CSS)
        self.assertIn("body.night-mode #tabHelp", CSS)
        self.assertIn("body.phone-floor #tabHelp", CSS)
        self.assertIn(".help-desk", CSS)
        self.assertIn(".help-kind", CSS)
        self.assertIn(".help-venmo", CSS)
        self.assertIn(".help-venmo-handle", CSS)


class HelpPersistTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        help_mod._data_override = Path(self._tmp.name)
        reset_rate_limits()

    def tearDown(self):
        help_mod._data_override = None
        reset_rate_limits()
        self._tmp.cleanup()

    def test_wrong_add_idea_shout_persist(self):
        self.assertIn("SHOUT", KINDS)
        pings = []
        now = 1_700_000_000.0
        for i, kind in enumerate(KINDS):
            out = submit(
                "10.0.0.%d" % (i + 1),
                kind,
                "%s on the desk" % kind,
                now=now + i,
                ping_fn=lambda k, t, ct, **kw: pings.append((k, t, ct)) or True,
            )
            self.assertTrue(out["ok"], out)
        rows = list_tickets()
        self.assertEqual(len(rows), len(KINDS))
        kinds = [r["kind"] for r in rows]
        self.assertEqual(kinds, list(reversed(KINDS)))
        texts = {r["text"] for r in rows}
        self.assertEqual(texts, {"%s on the desk" % k for k in KINDS})
        for row in rows:
            self.assertIn("time", row)
            self.assertIn("at", row)
            self.assertNotIn("ip", row)
        self.assertEqual([p[0] for p in pings], list(KINDS))
        shout = [r for r in rows if r["kind"] == "SHOUT"]
        self.assertEqual(len(shout), 1)
        self.assertEqual(shout[0]["text"], "SHOUT on the desk")
        self.assertEqual(pings[-1][0], "SHOUT")

    def test_optional_kind_and_empty_rejected(self):
        ok = submit("1.1.1.1", "", "just a note", now=10.0, ping=False)
        self.assertTrue(ok["ok"])
        bad = submit("1.1.1.2", "WRONG", "   ", now=11.0, ping=False)
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["error"], GENERIC)
        bogus = submit("1.1.1.3", "BUG", "hello", now=12.0, ping=False)
        self.assertFalse(bogus["ok"])
        self.assertEqual(bogus["error"], GENERIC)
        self.assertEqual(len(list_tickets()), 1)

    def test_rate_limit_generic(self):
        first = submit("8.8.8.8", "ADD", "one", now=100.0, ping=False)
        self.assertTrue(first["ok"])
        second = submit("8.8.8.8", "ADD", "two", now=105.0, ping=False)
        self.assertFalse(second["ok"])
        self.assertEqual(second["error"], GENERIC)
        self.assertNotIn("rate", second["error"].lower())
        self.assertNotIn("lock", second["error"].lower())
        self.assertNotIn("cooldown", second["error"].lower())
        later = submit("8.8.8.8", "ADD", "two later", now=100.0 + 21.0, ping=False)
        self.assertTrue(later["ok"])
        other = submit("9.9.9.9", "IDEA", "other ip", now=105.0, ping=False)
        self.assertTrue(other["ok"])
        self.assertEqual(len(list_tickets()), 3)


class HelpContactAndScopeTests(unittest.TestCase):
    def test_help_bundle_has_no_contact_channels(self):
        blobs = (HTML, JS, HELP_JS, CSS, WIRE_JS, HELP_PY, MAIN, RENDER)
        for blob in blobs:
            low = blob.lower()
            for needle in CONTACT_NEEDLES:
                self.assertNotIn(needle, low)

    def test_leak_needles_catch_a_paste(self):
        sample = "ping mailto:desk@example.com sms:+15550100 tel:+15550100 twilio @gmail.com"
        for needle in CONTACT_NEEDLES:
            self.assertIn(needle, sample.lower())

    def test_ping_env_documented_not_hardcoded(self):
        self.assertIn("HELP_PING_URL", HELP_PY)
        self.assertIn("LOCK_PING_URL", HELP_PY)
        self.assertIn("HELP_PING_URL", RENDER)
        self.assertIn("Never put the URL here", RENDER)
        self.assertNotIn("https://", HELP_PY)
        self.assertNotIn("http://", HELP_JS)
        self.assertNotIn("from backend.services.follower", HELP_PY)
        self.assertNotIn("follower_gate", HELP_PY)
        self.assertNotIn("decide_open_lock_grade", HELP_PY)
        self.assertNotIn("auto-bet", HELP_PY.lower())

    def test_routes_and_admin_gate(self):
        self.assertIn('@app.post("/api/help")', MAIN)
        self.assertIn('@app.get("/api/admin/help")', MAIN)
        self.assertIn('@app.get("/help.js")', MAIN)
        self.assertIn("_admin_ok(request)", MAIN.split("@app.get(\"/api/admin/help\")", 1)[1][:400])
        self.assertIn("_client_ip(request)", MAIN.split("@app.post(\"/api/help\")", 1)[1][:400])

    def test_wire_note(self):
        self.assertIn("HELP tab — tickets to Zach", WIRE_JS)
        self.assertIn("HELP gained SHOUT", WIRE_JS)
        self.assertIn("HELP: SHOUT + Venmo", WIRE_JS)
        self.assertIn("@zachery-Teas-1", WIRE_JS)
        self.assertIn("Zach approves before anything ships", WIRE_JS)
        self.assertIn("WRONG / ADD / IDEA", WIRE_JS)
        self.assertIn("SHOUT", WIRE_JS)
        self.assertIn("Follower OFF", WIRE_JS)
        self.assertNotIn("ZT ·", WIRE_JS.split("2026-08-15-help-tab", 1)[1][:400])

    def test_follower_untouched(self):
        self.assertIn("Lock 1 = existing admin password", FOLLOWER_PY)
        self.assertIn("WRONG", FOLLOWER_PY)
        self.assertNotIn("desk_help", FOLLOWER_PY)
        self.assertNotIn("desk_help", FOLLOWER_ROUTE)
        self.assertNotIn("desk_help", FOLLOWER_JS)
        self.assertNotIn("/api/help", FOLLOWER_JS)

    def test_floor_still_lock_only(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("hideWait ? floorLockedAgents(roster) : roster", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("const floorHideWait = floorLikeMode()", art)
        self.assertIn("order = order.filter(function (n) { return locked[n]; });", art)
        self.assertNotIn("full WAIT roster", JS)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertNotIn("from backend.services.desk_help", GATES)


class HelpPingEnvTests(unittest.TestCase):
    def test_prefers_help_ping_url(self):
        env = {"HELP_PING_URL": "https://example.test/help", "LOCK_PING_URL": "https://example.test/lock"}
        with patch.dict(os.environ, env, clear=False):
            from backend.data.secrets import reset_secret_cache
            reset_secret_cache()
            self.assertEqual(help_mod.load_help_ping_url(), "https://example.test/help")
        reset_secret_cache()


if __name__ == "__main__":
    unittest.main()
