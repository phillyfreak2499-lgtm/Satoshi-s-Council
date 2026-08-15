"""Post-merge desk QA: settings JSON routes, gates, Floor 1H dock, paper P&L."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")


class SettingsJsonRouteTests(unittest.TestCase):
    def test_save_and_reset_routes_exist(self):
        for needle in (
            '@app.post("/api/settings")',
            '@app.post("/api/settings/save")',
            '@app.post("/api/settings/reset")',
            "def _apply_settings_body",
            "api_unknown",
        ):
            self.assertIn(needle, MAIN)
        self.assertIn("never index.html", MAIN)

    def test_client_posts_json_save_not_html(self):
        self.assertIn("/api/settings/save", JS)
        self.assertIn("/api/settings/reset", JS)
        self.assertIn("settings route returned HTML, not JSON", JS)
        self.assertIn("Accept: \"application/json\"", JS)
        self.assertIn("applySettingsSnapshot(s, { localToggles: true })", JS)


class GateColdVisitTests(unittest.TestCase):
    def test_html_starts_locked(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotRegex(HTML, r'<body[^>]*admin-unlocked')
        self.assertIn('data-password-protected="true"', HTML)
        self.assertIn('id="passwordGate"', HTML)
        self.assertNotIn('id="passwordGate" class="password-gate hidden"', HTML)
        self.assertIn('id="adminGate"', HTML)
        self.assertIn("Enter access code", HTML)
        self.assertIn("Never start admin-unlocked", HTML)
        self.assertIn('sessionStorage.removeItem("council_admin_unlocked")', HTML)
        self.assertIn('sessionStorage.removeItem("council_auth_ok")', HTML)

    def test_admin_tools_are_not_in_the_live_tree(self):
        live = HTML.split('<template id="adminDeskTemplate">')[0]
        self.assertNotIn('id="adminToolsCard"', live)
        self.assertNotIn("btnClearHitRate", live)
        self.assertIn('id="adminDeskTemplate"', HTML)
        self.assertIn("btnClearHitRate", HTML.split('<template id="adminDeskTemplate">', 1)[1])

    def test_js_requires_desk_code_and_admin_on_cold(self):
        self.assertIn('localStorage.removeItem(passKey)', JS)
        self.assertIn('localStorage.removeItem(ADMIN_KEY)', JS)
        self.assertIn("sessionStorage.removeItem(ADMIN_KEY)", JS)
        self.assertIn("sessionStorage.removeItem(passKey)", JS)
        self.assertIn("sessionStorage.removeItem(DESK_KEY)", JS)
        self.assertIn("sessionStorage.getItem(DESK_KEY)", JS)
        self.assertIn("requestAdminUnlock", JS)
        self.assertIn("if (!hasDeskAuth())", JS)
        self.assertIn("__adminUnlockedThisPage", JS)
        self.assertIn("__deskUnlockedThisPage", JS)
        self.assertIn("leftover unlocked session is not the public default", JS)
        self.assertNotIn("localStorage.setItem(passKey", JS)
        self.assertNotIn("localStorage.setItem(ADMIN_KEY", JS)
        self.assertNotIn("localStorage.getItem(passKey)", JS)


class PaperPnlPrefillTests(unittest.TestCase):
    def test_entry_does_not_hardcode_minus_25(self):
        self.assertNotIn("-$25.00", HTML)
        self.assertNotIn("−$25.00", HTML)
        self.assertRegex(HTML, r'id="pePnl">—</strong>')
        self.assertRegex(HTML, r'id="peReturned"[^>]*value=""')

    def test_preview_waits_for_got_back(self):
        self.assertIn("do not pre-fill a fake", JS)
        self.assertIn('el.textContent = "—";', JS)
        self.assertIn('if (ret) ret.value = "";', JS)
        self.assertIn('autocomplete="off"', HTML)


class FloorOneHDockTests(unittest.TestCase):
    def test_window_led_lives_inside_header_after_tabs(self):
        panel = HTML.find('id="lifetimePanel"')
        led = HTML.find('id="windowLed"')
        main = HTML.find('id="mainTable"')
        self.assertGreater(led, panel)
        self.assertGreater(led, main)
        self.assertEqual(len(re.findall(r'id="windowLed"', HTML)), 1)
        self.assertIn("function dockWindowLed", JS)

    def test_css_docks_floor_in_flow(self):
        self.assertIn("body.floor-mode #app > header #windowLed", CSS)
        self.assertIn("position: relative !important;", CSS)
        self.assertIn("COLD-LOAD GATES", CSS)


class PacksNotDroppedTests(unittest.TestCase):
    def test_official_closer_still_present(self):
        gates = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
        self.assertIn("def official_y_finish", gates)
        self.assertIn("def decide_open_lock_grade", gates)
        self.assertIn("KNOWN_OFFICIAL_FINISH", gates)
        self.assertIn("KXBTCD-26AUG1415-T62999.99", gates)
        self.assertIn("learn_from_settled", (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8"))

    def test_follower_stays_off_public_surface(self):
        for needle in ("tabFollower", "FOLLOWER_PASSWORD", "/api/follower/unlock", "/api/follower/order"):
            self.assertNotIn(needle, HTML)
            self.assertNotIn(needle, JS)

    def test_charts_wall_has_eth_canvas(self):
        self.assertIn('id="chartEth"', HTML)
        self.assertIn("function drawChartEth()", JS)
        self.assertIn('p => p.down, "#ff2d55"', JS)

    def test_table_feed_and_pulse_present(self):
        self.assertIn("function markSeatTick", JS)
        self.assertIn('id="signalChairLast"', HTML)
        self.assertIn("const pr = radius * 0.80", JS)

    def test_dashboard_follows_eth_focus(self):
        self.assertIn('focusName = focusTable === "ethereum" ? "ETH · Vitalik"', JS)
        self.assertIn("dash-focus-banner", JS)
        self.assertIn("state.btc && state.eth", JS)

    def test_ranks_empty_does_not_grid_wrap(self):
        self.assertIn('class="rank-empty">No rank data yet.', JS)
        self.assertIn(".rank-empty", CSS)

    def test_floor_header_stays_up_for_1h(self):
        self.assertIn("html body.floor-mode #app > header", CSS)
        self.assertIn("position: static !important;", CSS)
        self.assertNotIn("top: 40px", CSS)

    def test_kalshi_backs_off_on_502(self):
        kalshi = (ROOT / "backend" / "data" / "kalshi.py").read_text(encoding="utf-8")
        self.assertIn("_BACKOFF_S", kalshi)
        self.assertIn("kalshi_backoff", kalshi)
        self.assertIn("502", kalshi)
        self.assertNotIn("logger.exception", (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
