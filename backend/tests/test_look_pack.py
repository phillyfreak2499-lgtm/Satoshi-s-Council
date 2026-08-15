"""Look pack: Floor attract + thinking ring after lock-only seats (#17)."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


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


class FloorLockOnlyStaysTests(unittest.TestCase):
    def test_floor_still_hides_wait_seats(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("hideWait ? floorLockedAgents(roster) : roster", JS)
        self.assertIn("floorCryptoTable(which)", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("const floorHideWait = floorLikeMode()", art)
        self.assertIn("order = order.filter(function (n) { return locked[n]; });", art)
        self.assertNotIn("full WAIT roster", JS)
        self.assertNotIn("WAIT roster to fill", JS)
        self.assertTrue(floor_seat_dir_locked("UP"))
        self.assertTrue(floor_seat_dir_locked("DOWN_HOLD"))
        self.assertFalse(floor_seat_dir_locked("WAIT"))
        self.assertFalse(floor_seat_dir_locked("SIT"))
        self.assertEqual(
            [a["agent_name"] for a in floor_locked_agents([
                {"agent_name": "candle", "direction": "WAIT"},
                {"agent_name": "volume", "direction": "UP"},
                {"agent_name": "leader", "direction": "DOWN"},
            ])],
            ["volume"],
        )

    def test_no_extra_seat_nodes_or_particle_systems(self):
        attract = JS.split("function drawFloorAttractGlow", 1)[1].split("function syncSeatSpinBtn", 1)[0]
        self.assertNotIn("createElement", attract)
        self.assertNotIn("particles.push", attract)
        think = JS.split("function drawThinkingRing", 1)[1].split("function drawChairThink", 1)[0]
        self.assertNotIn("createElement", think)
        self.assertNotIn("new Image", think)
        self.assertNotIn("particles.push", think)


class AttractModeTests(unittest.TestCase):
    def test_idle_auto_enter_floor(self):
        self.assertIn("function maybeAttractEnter()", JS)
        self.assertIn("function noteDeskActivity()", JS)
        self.assertIn("function wireAttractIdle()", JS)
        self.assertIn("function attractEnterBlocked()", JS)
        self.assertIn("Cabinet attract: idle auto-enter Floor", JS)
        self.assertIn("const ATTRACT_IDLE_MS = 24000", JS)
        self.assertIn('setMode("floor")', JS.split("function maybeAttractEnter", 1)[1][:800])
        blocked = JS.split("function attractEnterBlocked", 1)[1].split("function maybeAttractEnter", 1)[0]
        self.assertIn('mode === "settings"', blocked)
        self.assertIn('mode === "follower"', blocked)
        self.assertIn("gate-locked", blocked)
        self.assertIn("Never auto-bet", blocked)
        self.assertIn("Seat Storm still never auto-starts", blocked)
        self.assertIn("maybeAttractEnter()", JS.split("function loop", 1)[1][:400])
        self.assertIn("wireAttractIdle()", JS)

    def test_camera_breathe_glow_stay_light(self):
        self.assertIn("function floorCameraOffset()", JS)
        self.assertIn("function chairBreatheScale(", JS)
        self.assertIn("function drawFloorAttractGlow(", JS)
        self.assertIn("Slow room drift", JS)
        self.assertIn("No extra haze, particles, or purple", JS)
        self.assertIn("WAIT Floor attract: motion/glow, not extra bots", JS)
        self.assertIn("chairBreatheScale(which, locked)", JS)
        self.assertIn("drawFloorAttractGlow(cx, cy, radius, which)", JS)
        self.assertIn("drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable))", JS)
        self.assertIn("st.z * 0.72", JS)


class ThinkingRingTests(unittest.TestCase):
    def test_exists_and_gated_to_satoshi_vitalik(self):
        self.assertIn("function thinkingRingAllowed(", JS)
        self.assertIn("function thinkingRingFrac(", JS)
        self.assertIn("function drawThinkingRing(", JS)
        self.assertIn("Satoshi / Vitalik only", JS)
        self.assertIn("1H cook ring around Satoshi / Vitalik", JS)
        self.assertIn("return floorCryptoTable(which)", JS.split("function thinkingRingAllowed", 1)[1][:240])
        self.assertIn("return hourFillFrac", JS.split("function thinkingRingFrac", 1)[1][:200])
        self.assertIn("drawThinkingRing(cx, cy, photoR, seatR, opts)", JS)
        ring = JS.split("function drawThinkingRing", 1)[1].split("function drawChairThink", 1)[0]
        self.assertIn("if (!thinkingRingAllowed(opts.which)) return", ring)
        self.assertNotIn("isAtsTable", ring)
        self.assertNotIn("isFrontTable", ring)
        self.assertNotIn("new Image", ring)
        self.assertIn("Cheap annulus stroke", ring)

    def test_lock_is_a_punch_not_a_fade(self):
        ign = JS.split("function drawLockIgnition", 1)[1].split("function resizeRoundtable", 1)[0]
        self.assertIn("hard hit", ign)
        self.assertIn("Not a fade", ign)
        self.assertIn("Fat lock saber: hard hit on Chair LOCK (~1s), then stays OFF", JS)
        self.assertIn("Lock is a punch — hard hit, not a fade", JS)


class LeftoverHudStaysHiddenTests(unittest.TestCase):
    def test_ares_front_crypto_hud_stays_hidden(self):
        self.assertIn('body[data-focus-table="ats"] #dualFightCard', CSS)
        self.assertIn('body[data-focus-table="front"] #dualFightCard', CSS)
        self.assertIn('body[data-focus-table="ats"] #stripKalshi', CSS)
        self.assertIn('body[data-focus-table="front"] #stripKalshi', CSS)
        self.assertIn("body[data-focus-table=\"ats\"] .chart-card.chart-crypto-funding", CSS)
        self.assertIn("body[data-focus-table=\"front\"] .chart-card.chart-crypto-funding", CSS)
        hud = JS.split("function paintTableHud", 1)[1].split("function collectChairLocks", 1)[0]
        self.assertIn("fightCard.hidden = !!deskBook", hud)
        self.assertIn("if (deskBook) return", hud)
        self.assertIn("function atsKickLine", JS)
        self.assertIn("seconds_to_close", JS)
        self.assertIn("function paintAresEyes", JS)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn("ats-sport-chip", HTML + CSS)


class PaperFollowerUntouchedTests(unittest.TestCase):
    def test_no_follower_or_live_changes(self):
        self.assertNotIn("drawThinkingRing", FOLLOWER_PY)
        self.assertNotIn("maybeAttractEnter", FOLLOWER_PY)
        self.assertNotIn("drawThinkingRing", FOLLOWER_ROUTE)
        self.assertNotIn("maybeAttractEnter", FOLLOWER_ROUTE)
        self.assertNotIn("drawThinkingRing", FOLLOWER_JS)
        self.assertNotIn("maybeAttractEnter", FOLLOWER_JS)
        self.assertIn("paper default · live off", JS)
        self.assertIn("Never auto-bet", JS)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT ·", HTML)
        title = HTML.split("<title>", 1)[1].split("</title>", 1)[0]
        self.assertEqual(title, "Satoshi’s Council")
        self.assertIn("SATOSHI’S COUNCIL", HTML.split('id="passwordGate"', 1)[1][:400])
        self.assertIn("SATOSHI’S COUNCIL", HTML.split('id="summonGate"', 1)[1][:500])


if __name__ == "__main__":
    unittest.main()
