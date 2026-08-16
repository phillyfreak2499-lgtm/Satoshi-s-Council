"""Header STILL next to mute — one freeze for slow pipes. Paper. Follower OFF."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
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


class HeaderStillMarkupTests(unittest.TestCase):
    def test_still_sits_next_to_mute(self):
        header = HTML.split("<header>", 1)[1].split("</header>", 1)[0]
        self.assertIn('id="soundToggle"', header)
        self.assertIn('id="stillToggle"', header)
        self.assertLess(header.find('id="soundToggle"'), header.find('id="stillToggle"'))
        self.assertLess(header.find('id="stillToggle"'), header.find('id="statusDot"'))
        self.assertIn(">STILL</button>", header)
        self.assertNotIn("hidden", header.split('id="stillToggle"', 1)[1].split(">", 1)[0])
        self.assertNotIn('id="stillToggle"', HTML.split('id="tableStage"', 1)[1][:800])
        self.assertIn('id="seatSpinBtn"', HTML)

    def test_label_stays_still_not_spin(self):
        btn = HTML.split('id="stillToggle"', 1)[1].split("</button>", 1)[0]
        self.assertIn("STILL", btn)
        self.assertNotIn("SPIN", btn)
        sync = JS.split("function syncStillBtn", 1)[1].split("function applyMotionFreeze", 1)[0]
        self.assertIn('btn.textContent = "STILL"', sync)
        self.assertNotIn("SPIN", sync)
        self.assertIn('aria-pressed', sync)
        self.assertIn("still-on", sync)


class HeaderStillFreezeTests(unittest.TestCase):
    def test_one_freeze_path_persists(self):
        self.assertIn('SEAT_SPIN_KEY = "council_seat_spin"', JS)
        self.assertIn("let seatOrbitFrozen", JS)
        self.assertIn("let reduceMotion", JS)
        self.assertIn("const systemReduceMotion", JS)
        self.assertIn("reduceMotion = systemReduceMotion || seatOrbitFrozen", JS)
        self.assertIn("function applyMotionFreeze", JS)
        self.assertIn("function setStill", JS)
        self.assertIn("function setSeatSpin", JS)
        self.assertIn("localStorage.setItem(SEAT_SPIN_KEY", JS)
        self.assertIn('localStorage.getItem(SEAT_SPIN_KEY) === "0"', JS)
        self.assertIn("document.body.classList.toggle(\"reduce-motion\", reduceMotion)", JS)
        self.assertIn("setSeatSpin(!on)", JS.split("function setStill", 1)[1][:200])
        self.assertIn("setStill(!seatOrbitFrozen)", JS)
        self.assertIn("window.setStill = setStill", JS)

    def test_orbit_spin_and_heavy_fx_honor_still(self):
        self.assertIn("if (systemReduceMotion) return 0", JS.split("function seatOrbitAngle", 1)[1][:400])
        self.assertIn("if (!seatOrbitFrozen)", JS.split("function seatOrbitAngle", 1)[1][:500])
        self.assertIn("attractEnterBlocked", JS)
        blocked = JS.split("function attractEnterBlocked", 1)[1].split("function maybeAttractEnter", 1)[0]
        self.assertIn("if (reduceMotion) return true", blocked)
        self.assertIn("if (reduceMotion || !floorLikeMode()) return { x: 0, y: 0 }", JS)
        self.assertIn("const still = document.body.classList.contains(\"reduce-motion\")", JS)
        self.assertIn("st.z * 0.72", JS)
        self.assertIn("if (!still)", JS.split("st.z * 0.72", 1)[0][-200:])
        self.assertIn("function motionStill()", JS)
        self.assertIn("if (motionStill()) return", JS.split("function startRain", 1)[1][:240])
        self.assertIn("if (on && !motionStill()) startRain()", JS)
        self.assertIn('classList.contains("reduce-motion")) return', JS.split("function playDeskUnlockIntro", 1)[1][:500])
        self.assertIn('classList.contains("reduce-motion")) return', JS.split("function playCelebrateVideo", 1)[1][:240])
        self.assertIn("if (!document.hidden && !reduceMotion)", JS)
        self.assertIn("const wait = document.hidden ? 500 : 180", JS)
        self.assertIn("window.__setFloorMoneyRain(false)", JS.split("function applyMotionFreeze", 1)[1][:600])

    def test_css_pressed_and_reduce_motion(self):
        self.assertIn("#stillToggle", CSS)
        self.assertIn("#stillToggle.still-on", CSS)
        self.assertIn('#stillToggle[aria-pressed="true"]', CSS)
        self.assertIn("body.reduce-motion .floor-money-rain", CSS)
        self.assertIn("body.reduce-motion #starfield", CSS)
        self.assertIn("body.reduce-motion #deskIntroWrap video", CSS)
        self.assertIn("body.mode-settings #app > header #stillToggle", CSS)


class HeaderStillLeaveAloneTests(unittest.TestCase):
    def test_follower_untouched(self):
        self.assertNotIn("stillToggle", FOLLOWER_PY)
        self.assertNotIn("stillToggle", FOLLOWER_ROUTE)
        self.assertNotIn("stillToggle", FOLLOWER_JS)
        self.assertNotIn("setStill", FOLLOWER_JS)
        self.assertNotIn("council_seat_spin", FOLLOWER_JS)
        self.assertIn("class FollowerGate", FOLLOWER_PY)

    def test_floor_lock_only_still_holds(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("Floor is leaders only", JS)
        self.assertNotIn("hideWait ? floorLockedAgents(roster) : roster", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("const floorHideWait = false", art)
        self.assertIn("if (floorLikeMode())", art)
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

    def test_no_chair_math_change(self):
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertNotIn("stillToggle", GATES)
        self.assertNotIn("from backend.services.desk_wire", GATES)

    def test_signed_hud_and_disk_stay(self):
        self.assertIn("function atsKickLine(", JS)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn("disk:", RENDER)
        self.assertIn("sizeGB:", RENDER)


class HeaderStillWireTests(unittest.TestCase):
    def test_wire_note_appended(self):
        self.assertIn("2026-08-16-header-still", WIRE_JS)
        self.assertIn("Header STILL sits next to mute", WIRE_JS)
        why = WIRE_JS.split("2026-08-16-header-still", 1)[1][:500]
        self.assertIn("Header STILL next to mute for slow pipes", why)
        self.assertIn("same freeze", why)
        self.assertIn("Follower OFF", why)
        self.assertNotIn("ZT ·", why)
        self.assertNotIn("SS Helper", why)


if __name__ == "__main__":
    unittest.main()
