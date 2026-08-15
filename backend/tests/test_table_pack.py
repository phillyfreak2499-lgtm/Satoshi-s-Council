"""Table HUD: pulsing Chair beams, bigger portraits, right-side signal feed."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


class TableBeamTests(unittest.TestCase):
    def test_packets_travel_toward_chair(self):
        self.assertIn("function drawPacketSpoke", JS)
        self.assertIn("function markSeatTick", JS)
        self.assertIn("lineDashOffset", JS)
        self.assertIn("const fast = !!(agree || fresh)", JS)
        self.assertIn("Visual pulse stays on when Bell is muted", JS)
        self.assertNotIn("if (reduceMotion || soundMuted) return;", JS)

    def test_lean_colors_used_on_spokes(self):
        self.assertIn("strongColor(agent.direction)", JS)
        self.assertIn('adir === "UP"', JS)
        self.assertIn('adir === "DOWN"', JS)


class TablePortraitTests(unittest.TestCase):
    def test_portraits_fill_the_seat(self):
        self.assertIn("const pr = radius * 0.80", JS)
        self.assertIn("mode === \"floor\" ? 0.22 : 0.24", JS)
        self.assertIn("const scale = cover", JS)
        self.assertIn("object-fit: cover", JS)
        self.assertNotIn("contain + (cover - contain)", JS)
        self.assertIn('ctx.imageSmoothingQuality = "high"', JS)
        self.assertIn("const plateY = cy + radius + 14", JS)
        self.assertIn("vitalikImages[k].onload = _chairLoaded", JS)
        self.assertIn("function chairPortraitOf", JS)


class EthChairNameTests(unittest.TestCase):
    def test_eth_chair_says_vitalik_not_satoshi(self):
        self.assertIn('return isEthTable(which) ? "VITALIK" : "SATOSHI"', JS)
        self.assertIn('return isEthTable(which) ? "ETH · Vitalik" : "BTC · Satoshi"', JS)
        self.assertIn('return isEthTable(which) ? "ETH · VITALIK" : "BTC · SATOSHI"', JS)
        self.assertIn('leader: "CHAIR"', JS)
        self.assertIn('chair: "CHAIR"', JS)
        self.assertNotIn('leader: "SATOSHI"', JS)
        self.assertNotIn('chair: "SATOSHI"', JS)
        self.assertNotIn('chair: "Satoshi"', JS)
        self.assertIn("ctx.fillText(chairNameOf(focusTable)", JS)
        self.assertIn('chairNameOf("ethereum") + " · ETH"', JS)
        self.assertIn('chairNameOf("bitcoin") + " · BTC"', JS)
        self.assertIn("const focusName = chairTitleOf(focusTable)", JS)
        self.assertIn('chairTitleOf(focusTable) + " ranks (finish-only) · " + phase', JS)
        self.assertIn('isEth ? "Vitalik ETH table" : "Satoshi BTC table"', JS)
        self.assertIn('aria-label="ETH · Vitalik"', HTML)
        self.assertIn('aria-label="Focus Ethereum / Vitalik"', HTML)
        self.assertIn('aria-label="Vitalik ETH table"', HTML)
        self.assertIn("ETH · VITALIK", HTML)
        self.assertIn("The Chair only listens", HTML)
        self.assertNotIn("Satoshi only listens", HTML)
        self.assertNotIn("how hard Satoshi hears", HTML)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT ·", HTML)


class ChairThinkTests(unittest.TestCase):
    def test_think_hud_is_canvas_not_gif(self):
        self.assertIn("function drawChairThink", JS)
        self.assertIn("function noteChairLock", JS)
        self.assertIn("const sealFX", JS)
        self.assertIn("slow radar sweep", JS)
        self.assertIn("orbiting ticks", JS)
        self.assertIn("parked lock flash", JS)
        self.assertNotIn("spinner.gif", JS)
        self.assertNotIn('ctx.fillText("SEALED"', JS)

    def test_wait_ambient_no_face_cover_phone_cheap(self):
        self.assertIn("WAIT hours stay ambient", JS)
        self.assertIn("Don't cover the face", JS)
        self.assertIn("Phone: keep it cheap", JS)
        self.assertIn("isPhoneDesk()", JS)
        think = JS.split("function chairThinkRate", 1)[1].split("function resizeRoundtable", 1)[0]
        self.assertIn("ctx.clip()", think)
        self.assertIn("in_huddle", think)
        self.assertIn("function pulseRate", JS)
        self.assertIn("return chairThinkRate(st, dir, locked, which)", JS)
        self.assertIn("pulse-rate:", JS)
        self.assertIn("const rate = pulseRate(st, dir, locked, which)", JS)

    def test_called_on_table_and_floor_chairs(self):
        self.assertIn("drawChairThink(cx, portraitY, pr, radius", JS)
        self.assertIn("drawChairThink(cx, cy, lr, radius", JS)
        self.assertIn("noteChairLock(whichChair, _lc)", JS)


class ChairPulseCadenceTests(unittest.TestCase):
    def test_each_chair_has_its_own_clock(self):
        self.assertIn("function pulseKeyOf", JS)
        self.assertIn("function chairPulseTime", JS)
        self.assertIn("function stepAllChairPulses", JS)
        self.assertIn("function bumpChairPulse", JS)
        self.assertIn("function tasteChairActivity", JS)
        self.assertIn('Each Chair has its own pulse clock', JS)
        self.assertIn('Packets, not a metronome', JS)
        self.assertIn('stepChairPulse("bitcoin"', JS)
        self.assertIn('stepChairPulse("ethereum"', JS)
        self.assertIn('stepChairPulse("front"', JS)
        self.assertIn("chairPulseTime(which)", JS)
        self.assertIn("Math.max(0.32, Math.min(5.6", JS)
        self.assertIn("p.burstLeft = 2", JS)
        self.assertIn("Phone: one rate per chair, no per-segment sparkle", JS)
        self.assertIn('tasteChairActivity("bitcoin")', JS)
        self.assertIn('tasteChairActivity("ethereum")', JS)
        self.assertIn('tasteChairActivity("front")', JS)
        self.assertIn('bumpChairPulse("front", 0.85)', JS)
        self.assertIn("_newsPulseSig", JS)
        self.assertIn("/api/news", JS)
        self.assertNotIn("if (reduceMotion || soundMuted) return;", JS)
        self.assertIn('btn.textContent = spinning ? "SPIN" : "STILL"', JS)
        self.assertIn("Never auto-starts", JS)
        self.assertNotIn("from backend.services.follower_gate", JS)


class BotsGuideMarkTests(unittest.TestCase):
    def test_field_guide_uses_existing_bot_map(self):
        self.assertIn("function botGuideMarkHtml", JS)
        self.assertIn("function renderBotsGuide", JS)
        self.assertIn("botGuideMarkHtml(key, name)", JS)
        self.assertIn("BOT_ICON_FILES[key]", JS)
        self.assertIn('class="bot-mark"', JS)
        self.assertIn("/bots/wick.png", JS)
        self.assertIn("bot-mark-letter", JS)
        self.assertIn("no-art", JS)
        self.assertIn(".bot-mark-wrap", CSS)
        self.assertIn("width: 40px", CSS.split(".bot-mark-wrap", 1)[1][:200])
        self.assertIn("margin-left: auto", CSS.split(".bot-rank-pill", 1)[1][:180])
        self.assertNotIn("zt-logo", JS.split("function botGuideMarkHtml", 1)[1][:400].lower())


class SeatOrbitTests(unittest.TestCase):
    def test_seat_orbit_is_slower_and_can_freeze(self):
        self.assertIn("function seatOrbitAngle", JS)
        self.assertIn("const SEAT_ORBIT_SPEED = 0.00007", JS)
        self.assertIn('SEAT_SPIN_KEY = "council_seat_spin"', JS)
        self.assertIn("function setSeatSpin", JS)
        self.assertIn("function syncSeatSpinBtn", JS)
        self.assertIn("seatOrbitAngle()", JS)
        self.assertNotIn("time * 0.00014", JS)
        self.assertIn('id="seatSpinBtn"', HTML)
        self.assertIn(">SPIN</button>", HTML)
        self.assertIn("Freeze seat orbit", HTML)
        self.assertIn(".seat-spin-btn", CSS)
        self.assertIn("body.mode-art .seat-spin-btn", CSS)
        self.assertIn("localStorage.setItem(SEAT_SPIN_KEY", JS)
        self.assertIn("seatOrbitHold += dt * SEAT_ORBIT_SPEED", JS)


class LockIgnitionTests(unittest.TestCase):
    def test_fat_lock_beam_not_always_on(self):
        self.assertIn("function drawLockIgnition", JS)
        self.assertIn("drawLockIgnition(cx, portraitY, pr, which)", JS)
        self.assertIn("drawLockIgnition(cx, cy, lr, whichChair)", JS)
        self.assertIn("Fat lock saber: ignites ~1s on Chair LOCK, then stays OFF", JS)
        self.assertIn('dir !== "UP" && dir !== "DOWN"', JS.split("function drawLockIgnition", 1)[1][:800])
        self.assertIn("rgba(57, 255, 20", JS.split("function drawLockIgnition", 1)[1][:1600])
        self.assertIn("rgba(255, 45, 85", JS.split("function drawLockIgnition", 1)[1][:1600])
        ign = JS.split("function drawLockIgnition", 1)[1].split("function resizeRoundtable", 1)[0]
        self.assertNotIn("purple", ign.lower())
        self.assertNotIn("168, 85, 247", ign)
        self.assertIn("Math.max(14, Math.min(22", ign)
        self.assertIn("not over the face or seat labels", ign)
        self.assertIn("Date.now() + 1100", JS)
        wrap = CSS.split("Thin always-on saber retired", 1)[1][:280]
        self.assertIn("display: none !important", wrap)
        self.assertNotIn("ls-spark", JS.split("window.updateLightsaber", 1)[1][:500])
        self.assertNotIn("wait-blade", JS.split("window.updateLightsaber", 1)[1][:500])


class TableFeedTests(unittest.TestCase):
    def test_feed_is_packets_not_reasoning_only(self):
        self.assertIn('id="signalFeed"', HTML)
        self.assertIn('id="signalChair"', HTML)
        self.assertIn('id="signalChairLast"', HTML)
        feed = HTML.split('id="debatePanel"', 1)[1]
        chair = feed.find('id="signalChair"')
        ol = feed.find('id="signalFeed"')
        self.assertGreater(chair, ol)
        self.assertIn("No specialist packets yet", JS)
        self.assertNotIn(".filter((s) => s.shout)", JS)
        self.assertIn("sf-in", JS)
        self.assertIn("P(finish)", JS)
        self.assertIn("last lock", JS)

    def test_table_right_column_shows_feed(self):
        self.assertIn('grid-template-areas: "lifetime table debate"', CSS)
        self.assertIn("body.mode-art #debatePanel.signal-feed", CSS)
        self.assertIn("sfPacketIn", CSS)


class TableRightHudTests(unittest.TestCase):
    def test_right_column_has_tape_why_fight_storm(self):
        right = HTML.split('id="debatePanel"', 1)[1].split('id="hierarchyPanel"', 1)[0]
        left = HTML.split('id="lifetimePanel"', 1)[1].split('id="tableStage"', 1)[0]
        self.assertIn('id="lockTapeList"', right)
        self.assertIn('id="whyLockLine"', right)
        self.assertIn('id="dualFightStrip"', right)
        self.assertIn('id="seatStormTableBtn"', right)
        self.assertNotIn('id="lockTapeList"', left)
        self.assertNotIn('id="whyLockLine"', left)
        self.assertNotIn('id="dualFightStrip"', left)
        self.assertNotIn('id="seatStormTableBtn"', left)
        self.assertIn("START SEAT STORM", HTML)
        self.assertIn("function paintTableHud", JS)
        self.assertIn("function whyThisLockLine", JS)
        self.assertIn("No Chair lock this hour", JS)
        self.assertIn("No Chair lock this hour", HTML)
        self.assertNotIn("LIFETIME LOG EMPTY", JS)
        self.assertIn('class="lifetime-log-block idle"', HTML)
        self.assertIn('logBlock.classList.add("idle")', JS)
        self.assertIn("Never auto-starts", JS)
        self.assertIn("#debatePanel .lock-tape-card", CSS)

    def test_one_h_still_docks_in_left_column(self):
        panel = HTML.find('id="lifetimePanel"')
        led = HTML.find('id="windowLed"')
        debate = HTML.find('id="debatePanel"')
        self.assertGreater(led, panel)
        self.assertLess(led, debate)
        self.assertIn("body.mode-art #lifetimePanel #windowLed", CSS)
        self.assertIn("html body.mode-art #lifetimePanel #windowLed.led-float.led-window", CSS)
        self.assertNotIn("#lifetimePanel .lock-tape-card", CSS)
        self.assertIn("function dockWindowLed", JS)


class PriorityPacksStillPresentTests(unittest.TestCase):
    def test_gates_still_cold(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotRegex(HTML, r"<body[^>]*admin-unlocked")
        self.assertIn("Never start admin-unlocked", HTML)

    def test_closer_and_charts_still_present(self):
        self.assertIn("def official_y_finish", GATES)
        self.assertIn("KXBTCD-26AUG1415-T62999.99", GATES)
        self.assertIn('id="chartEth"', HTML)
        self.assertIn("function drawChartEth()", JS)
        self.assertIn('p => p.down, "#ff2d55"', JS)


if __name__ == "__main__":
    unittest.main()
