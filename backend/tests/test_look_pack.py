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
    def test_floor_is_leaders_only_no_seat_bots(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("onFloor ? [] : roster", JS)
        self.assertIn("Floor is leaders only", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("if (floorLikeMode())", art)
        self.assertIn("drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable))", art)
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
        self.assertNotIn("drawChairRoom", FOLLOWER_PY)
        self.assertNotIn("hourWeatherOf", FOLLOWER_PY)
        self.assertNotIn("drawLockStamp", FOLLOWER_ROUTE)
        self.assertNotIn("chairRoomOf", FOLLOWER_JS)


def hour_weather_of(st):
    """Mirror of hourWeatherOf — range / VOLT / book spread / time-left. No weather API."""
    m = (st or {}).get("market") or {}
    agents = (st or {}).get("agents") or []
    range_score = 0.0
    candles = m.get("candles") or []
    if len(candles) >= 2:
        hi = max(float(c.get("h", c.get("high", 0)) or 0) for c in candles)
        lo = min(float(c.get("l", c.get("low", 0)) or 0) for c in candles)
        last = float(candles[-1].get("c", candles[-1].get("close", 0)) or 0)
        if last > 0 and hi > lo:
            range_score = min(1.0, ((hi - lo) / last) / 0.012)
    volt_score = 0.0
    for a in agents:
        if a and a.get("agent_name") == "volatility":
            d = str(a.get("direction") or "").upper()
            c = float(a.get("confidence") or 0)
            if d and d not in ("WAIT", "SIT"):
                volt_score = min(1.0, c / 100.0)
            break
    yb = m.get("kalshi_yes_bid", m.get("up_pct"))
    ya = m.get("kalshi_yes_ask")
    book_score = 0.0
    if yb is not None and ya is not None:
        book_score = min(1.0, abs(float(ya) - float(yb)) / 8.0)
    secs = m.get("seconds_left")
    chop_score = 0.0
    if secs is not None and secs < 720:
        chop_score = (1 - secs / 720) * max(range_score, volt_score, 0.25)
    level = max(0.0, min(1.0, range_score * 0.38 + volt_score * 0.28 + book_score * 0.18 + chop_score * 0.16))
    mode = "wild" if level >= 0.62 else ("dead" if level <= 0.22 else "calm")
    return {"level": level, "mode": mode}


class ChairRoomTests(unittest.TestCase):
    def test_three_distinct_room_skins(self):
        self.assertIn("function chairRoomOf(", JS)
        self.assertIn('return "ares"', JS.split("function chairRoomOf", 1)[1][:400])
        self.assertIn('return "vitalik"', JS.split("function chairRoomOf", 1)[1][:400])
        self.assertIn('return "satoshi"', JS.split("function chairRoomOf", 1)[1][:500])
        self.assertIn('return "oracle"', JS.split("function chairRoomOf", 1)[1][:500])
        self.assertIn('return "raijin"', JS.split("function chairRoomOf", 1)[1][:500])
        self.assertIn("function drawChairRoom(", JS)
        self.assertIn("function syncChairRoom(", JS)
        self.assertIn("dataset.chairRoom", JS)
        self.assertIn("dataset.hourWeather", JS)
        sat = CSS.split('data-chair-room="satoshi"', 1)[1][:1200]
        vit = CSS.split('data-chair-room="vitalik"', 1)[1][:1200]
        ares = CSS.split('data-chair-room="ares"', 1)[1][:1200]
        ora = CSS.split('data-chair-room="oracle"', 1)[1][:1200]
        rai = CSS.split('data-chair-room="raijin"', 1)[1][:1200]
        self.assertIn("/satoshi-shrine.jpg", sat)
        self.assertIn("/vitalik-city.jpg", vit)
        self.assertIn("/ares-stadium.jpg", ares)
        self.assertIn("/raijin-dallas.jpg", rai)
        self.assertIn("/oracle-room.jpg", ora)
        self.assertNotIn("/chair-wait.jpg", sat + vit + ares + rai)
        self.assertNotIn("/vitalik-wait.jpg", sat + vit + ares + rai)
        self.assertNotEqual(sat[:200], vit[:200])
        self.assertNotEqual(vit[:200], ares[:200])
        self.assertNotEqual(ares[:200], ora[:200])
        self.assertIn("drawAresScorebug", JS)
        self.assertIn("atsKickLine", JS.split("function drawAresScorebug", 1)[1][:500])
        self.assertNotIn("id=\"tabAresScore\"", HTML)
        self.assertNotIn("id=\"tabScorebug\"", HTML)
        self.assertIn("Same table, different world", JS)

    def test_rooms_under_wisps_screensaver_first(self):
        self.assertIn("UNDER majority wisps", JS)
        self.assertIn("UNDER wisps", JS)
        self.assertIn("drawChairRoom(w, h, focusTable, _hourWx)", JS)
        smoke = JS.split("function drawTableSmoke", 1)[1].split("function drawMajorityHaze", 1)[0]
        self.assertIn("smokeTone(dir)", smoke)
        self.assertIn("w.drift * motion", smoke)
        self.assertIn("body.night-mode[data-chair-room=\"satoshi\"]", CSS)
        self.assertIn("body.night-mode[data-chair-room=\"vitalik\"]", CSS)
        self.assertIn("body.night-mode[data-chair-room=\"ares\"]", CSS)
        self.assertIn("body.night-mode[data-chair-room=\"oracle\"]", CSS)
        self.assertIn("body.night-mode[data-chair-room=\"raijin\"]", CSS)


class LockStampTests(unittest.TestCase):
    def test_stamp_only_on_real_lock_not_wait(self):
        self.assertIn("function chairLockIsReal(", JS)
        self.assertIn("function lockStampWord(", JS)
        self.assertIn("function drawLockStamp(", JS)
        real = JS.split("function chairLockIsReal", 1)[1].split("function lockStampWord", 1)[0]
        self.assertIn('side === "WAIT"', real)
        self.assertIn("return false", real)
        note = JS.split("function noteChairLock", 1)[1].split("const _chairPulse", 1)[0]
        self.assertIn("chairLockIsReal(lc)", note)
        ign = JS.split("function drawLockIgnition", 1)[1].split("function drawLockStamp", 1)[0]
        self.assertIn("Don't fire on WAIT", ign)
        self.assertIn('dir === "WAIT"', ign)
        self.assertIn("drawLockStamp(", ign)
        stamp = JS.split("function drawLockStamp", 1)[1].split("function resizeRoundtable", 1)[0]
        self.assertIn("Stamp slams the call onto the table", JS)
        self.assertIn("One beat", stamp)
        self.assertNotIn("particles.push", stamp)
        self.assertNotIn("new Image", stamp)


class HourWeatherTests(unittest.TestCase):
    def test_weather_tied_to_existing_signal(self):
        self.assertIn("function hourWeatherOf(", JS)
        wx = JS.split("function hourWeatherOf", 1)[1].split("function syncChairRoom", 1)[0]
        self.assertIn("m.candles", wx)
        self.assertIn('agent_name !== "volatility"', wx)
        self.assertIn("kalshi_yes_bid", wx)
        self.assertIn("kalshi_yes_ask", wx)
        self.assertIn("secondsLeftOf", wx)
        self.assertIn("No weather API", JS)
        self.assertNotIn("weatherapi", JS.lower())
        self.assertNotIn("openweathermap", JS.lower())
        dead = hour_weather_of({
            "market": {
                "candles": [{"h": 100.1, "l": 99.95, "c": 100}, {"h": 100.08, "l": 99.98, "c": 100.02}],
                "kalshi_yes_bid": 49, "kalshi_yes_ask": 50, "seconds_left": 2400,
            },
            "agents": [{"agent_name": "volatility", "direction": "WAIT", "confidence": 10}],
        })
        wild = hour_weather_of({
            "market": {
                "candles": [{"h": 104, "l": 98, "c": 100}, {"h": 105, "l": 97, "c": 101}],
                "kalshi_yes_bid": 40, "kalshi_yes_ask": 52, "seconds_left": 180,
            },
            "agents": [{"agent_name": "volatility", "direction": "UP", "confidence": 88}],
        })
        self.assertEqual(dead["mode"], "dead")
        self.assertEqual(wild["mode"], "wild")
        self.assertGreater(wild["level"], dead["level"])
        self.assertIn('dataset.hourWeather', JS)
        self.assertIn("data-hour-weather", CSS)

    def test_phone_path_no_heavy_particles(self):
        room = JS.split("function drawChairRoom", 1)[1].split("function drawAresScorebug", 1)[0]
        self.assertIn("Phone: wash only", room)
        self.assertIn("isPhoneDesk", room)
        self.assertNotIn("particles.push", room)
        self.assertNotIn("createElement", room)
        self.assertNotIn("new Image", room)
        self.assertIn("if (phone) return", JS.split("function drawAresScorebug", 1)[1][:400])
        self.assertIn("body.phone-floor[data-hour-weather=\"wild\"]", CSS)
        stamp = JS.split("function drawLockStamp", 1)[1].split("function resizeRoundtable", 1)[0]
        self.assertNotIn("particles.push", stamp)


if __name__ == "__main__":
    unittest.main()
