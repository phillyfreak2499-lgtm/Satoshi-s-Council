"""Seats tab: Bots + Ranks + Dashboard composed on one page."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_bundle.js").read_text(encoding="utf-8")
FOLLOWER_GATE = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")


def floor_seat_dir_locked(dir_):
    d = str(dir_ or "").upper()
    if not d or d in ("WAIT", "SIT", "—", "-", "EMPTY"):
        return False
    return d in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD")


def floor_locked_agents(agents):
    out = []
    for a in agents or []:
        if not a or not a.get("agent_name") or a.get("agent_name") == "leader" or a.get("sub"):
            continue
        if floor_seat_dir_locked(a.get("direction")):
            out.append(a)
    return out


class SeatsBarTests(unittest.TestCase):
    def test_seats_tab_exists_old_bar_buttons_gone(self):
        self.assertIn('id="tabSeats"', HTML)
        self.assertIn('data-mode="seats"', HTML)
        self.assertIn(">Seats</button>", HTML)
        self.assertNotIn('id="tabBots"', HTML)
        self.assertNotIn('id="tabRanks"', HTML)
        self.assertNotIn('id="tabDashboard"', HTML)
        self.assertNotIn('data-mode="bots"', HTML)
        self.assertNotIn('data-mode="ranks"', HTML)
        self.assertNotIn('data-mode="dashboard"', HTML)
        self.assertNotIn(">Bots</button>", HTML)
        self.assertNotIn(">Ranks</button>", HTML)
        self.assertNotIn(">Dashboard</button>", HTML)

    def test_core_bar_order_and_kept_extras(self):
        self.assertLess(HTML.find('id="tabFloor"'), HTML.find('id="tabScreensaver"'))
        self.assertLess(HTML.find('id="tabScreensaver"'), HTML.find('id="tabSeats"'))
        self.assertLess(HTML.find('id="tabSeats"'), HTML.find('id="tabPaper"'))
        self.assertLess(HTML.find('id="tabPaper"'), HTML.find('id="tabCharts"'))
        self.assertLess(HTML.find('id="tabCharts"'), HTML.find('id="tabSettings"'))
        self.assertIn('id="tabWire"', HTML)
        self.assertIn('id="tabFront"', HTML)
        self.assertIn('id="focusAts"', HTML)
        self.assertIn(">WIRE</button>", HTML)

    def test_product_name_stays(self):
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT ·", HTML.split("<title>", 1)[1][:80])
        self.assertNotIn("ZT ·", HTML.split('id="seatsView"', 1)[1][:600])


class SeatsComposeTests(unittest.TestCase):
    def test_field_guide_ranks_cards_on_one_page(self):
        seats = HTML.split('id="seatsView"', 1)[1].split('id="tapeView"', 1)[0]
        self.assertIn('id="botsView"', seats)
        self.assertIn('id="ranksView"', seats)
        self.assertIn('id="dashboardOverlay"', seats)
        self.assertIn("BOT FIELD GUIDE", seats)
        self.assertIn("RANK BOARD", seats)
        self.assertIn("SEAT CARDS", seats)
        self.assertIn('id="botsGrid"', seats)
        self.assertIn('id="ranksTable"', seats)
        self.assertIn('id="learnNotes"', seats)
        self.assertIn('id="seatsCardsToggle"', seats)
        self.assertNotIn('id="dashboardOverlay"', HTML.split('id="tableStage"', 1)[1].split('id="seatsView"', 1)[0])

    def test_js_aliases_old_modes_and_paints_all_three(self):
        self.assertIn("function aliasDeskMode(", JS)
        self.assertIn('n === "bots" || n === "ranks" || n === "dashboard"', JS)
        self.assertIn('return "seats"', JS)
        self.assertIn("function isSeatsMode(", JS)
        self.assertIn("function paintSeatsPage()", JS)
        paint = JS.split("function paintSeatsPage()", 1)[1][:240]
        self.assertIn("renderBotsGuide()", paint)
        self.assertIn("renderRanksBoard()", paint)
        self.assertIn("renderDashboard()", paint)
        self.assertIn("next = aliasDeskMode(next)", JS)
        self.assertIn("function renderDashboard()", JS)
        self.assertIn("function renderBotsGuide()", JS)
        self.assertIn("function renderRanksBoard()", JS)

    def test_old_hashes_route_to_seats(self):
        self.assertIn("function modeFromHash(", JS)
        self.assertIn("function applyHashMode()", JS)
        self.assertIn("function syncModeHash(", JS)
        self.assertIn('hashchange', JS)
        aliases = JS.split("function aliasDeskMode", 1)[1][:400]
        self.assertIn('"bots"', aliases)
        self.assertIn('"ranks"', aliases)
        self.assertIn('"dashboard"', aliases)
        self.assertIn('"seats"', aliases)
        self.assertIn("window.modeFromHash = modeFromHash", JS)
        auth = JS.split("function showAppAfterAuth", 1)[1][:900]
        self.assertIn("modeFromHash(location.hash)", auth)


class SeatsPhoneTests(unittest.TestCase):
    def test_phone_seats_is_normal_flow_not_three_col(self):
        self.assertIn("@media (max-width: 720px)", CSS)
        phone = CSS.split("Phone / narrow: Seats stays in normal flow", 1)[1][:1800]
        self.assertIn("overflow-y: visible", phone)
        self.assertIn("position: relative", phone)
        self.assertIn("flex-direction: column", phone)
        self.assertIn("grid-template-columns: 1fr", phone)
        self.assertNotIn("grid-template-columns: 1fr 1fr 1fr", phone)
        self.assertIn("body.phone-floor #tabSeats", CSS)


class SeatsLeaveAloneTests(unittest.TestCase):
    def test_floor_lock_only_still_holds(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("onFloor ? [] : roster", JS)
        self.assertIn("Floor is leaders only", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("if (floorLikeMode())", art)
        self.assertIn("drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable))", art)
        self.assertTrue(floor_seat_dir_locked("UP"))
        self.assertTrue(floor_seat_dir_locked("DOWN_HOLD"))
        self.assertFalse(floor_seat_dir_locked("WAIT"))
        self.assertEqual(
            [a["agent_name"] for a in floor_locked_agents([
                {"agent_name": "candle", "direction": "WAIT"},
                {"agent_name": "volume", "direction": "UP"},
                {"agent_name": "leader", "direction": "DOWN"},
            ])],
            ["volume"],
        )

    def test_follower_untouched(self):
        self.assertIn("window.__deskModeCycle", FOLLOWER_JS)
        self.assertIn('"dashboard"', FOLLOWER_JS)
        self.assertIn('"bots"', FOLLOWER_JS)
        self.assertIn('"ranks"', FOLLOWER_JS)
        self.assertNotIn("aliasDeskMode", FOLLOWER_JS)
        self.assertNotIn("tabSeats", FOLLOWER_JS)
        self.assertIn("class FollowerGate", FOLLOWER_GATE)
        self.assertNotIn("seatsView", FOLLOWER_GATE)
        self.assertNotIn("aliasDeskMode", FOLLOWER_GATE)

    def test_chair_math_and_paper_left_alone(self):
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn('id="tabPaper"', HTML)
        self.assertIn('id="paperView"', HTML)
        self.assertIn("PAPER TRACKER", HTML)
        self.assertNotIn("from backend.services.desk_wire", GATES)

    def test_persistent_disk_stays(self):
        self.assertIn("disk:", RENDER)
        self.assertIn("sizeGB:", RENDER)

    def test_signed_hud_untouched(self):
        self.assertIn("function atsKickLine(", JS)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn("function paintAresEyes", JS)
        self.assertIn("seconds_to_close", JS)


class SeatsWireTests(unittest.TestCase):
    def test_wire_note_appended(self):
        self.assertIn("2026-08-15-seats-tab", WIRE_JS)
        self.assertIn("Seats tab is one page", WIRE_JS)
        self.assertIn("Bots, Ranks, and Dashboard", WIRE_JS)
        self.assertIn("Follower OFF", WIRE_JS.split("2026-08-15-seats-tab", 1)[1][:400])
        self.assertNotIn("ZT ·", WIRE_JS.split("2026-08-15-seats-tab", 1)[1][:400])


if __name__ == "__main__":
    unittest.main()
