"""THE FRONT: Dallas-only weather council. Paper default. No Follower."""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.services import desk_front

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
FRONT = (ROOT / "backend" / "services" / "desk_front.py").read_text(encoding="utf-8")
SIDE = (ROOT / "backend" / "services" / "desk_side.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
BOTS = ROOT / "frontend" / "static" / "bots"

NOW = datetime(2026, 8, 15, 16, 5, tzinfo=timezone.utc)


def _m(
    ticker: str,
    *,
    series: str = "KXHIGHTDAL",
    strike_type: str = "between",
    floor: float | None = 103,
    cap: float | None = 104,
    yes_bid: str = "0.48",
    yes_ask: str = "0.50",
    volume: str = "4200",
) -> dict:
    return {
        "ticker": ticker,
        "series_ticker": series,
        "title": ticker,
        "strike_type": strike_type,
        "floor_strike": floor,
        "cap_strike": cap,
        "yes_bid_dollars": yes_bid,
        "yes_ask_dollars": yes_ask,
        "volume_fp": volume,
        "status": "active",
        "close_time": "2026-08-16T04:00:00Z",
    }


def _fetch_factory(extra: dict | None = None):
    extra = extra or {}

    async def fetch(path: str, params: dict):
        series = str((params or {}).get("series_ticker") or "")
        if extra.get("missing") or extra.get(series) == "404":
            return {"markets": [], "missing": True}
        if series == "KXHIGHTDAL":
            return {"markets": extra.get("rows") or [
                _m("KXHIGHTDAL-26AUG15-B103104"),
                _m("KXHIGHTDAL-26AUG15-B101102", floor=101, cap=102, yes_bid="0.22", yes_ask="0.24"),
            ]}
        if series == "KXHIGHNY":
            return {"markets": extra.get("nyc") or [
                _m("KXHIGHNY-26AUG15-B8485", series=series, floor=84, cap=85),
            ]}
        if series == "KXHIGHCHI":
            return {"markets": extra.get("chi") or [
                _m("KXHIGHCHI-26AUG15-B8384", series=series, floor=83, cap=84),
            ]}
        return {"markets": []}

    return fetch


async def _nws_high_only(url: str):
    high = 103
    if "/stations/KNYC" in url and "/observations" not in url:
        return {"geometry": {"coordinates": [-73.9692, 40.7789]}}
    if "/stations/KDFW" in url and "/observations" not in url:
        return {"geometry": {"coordinates": [-97.02196, 32.89743]}}
    if "/stations/KNYC" in url:
        high = 84
    if "/alerts/active" in url:
        return {"features": []}
    if "/products/types/CLI/" in url:
        return {"@graph": [{"@id": "https://api.weather.gov/products/CLI-YDAY"}]}
    if "CLI-YDAY" in url or url.rstrip("/").endswith("/products/CLI-YDAY"):
        return {"productText": "THE DALLAS-FORT WORTH CLIMATE SUMMARY FOR AUGUST 14 2026\nMAXIMUM TEMPERATURE (F)\n 102    104\n"}
    if "/points/" in url:
        return {"properties": {
            "forecast": "https://api.weather.gov/gridpoints/FWD/79,105/forecast",
            "forecastGridData": "https://api.weather.gov/gridpoints/FWD/79,105",
            "gridId": "FWD",
            "gridX": 79,
            "gridY": 105,
            "cwa": "FWD",
        }}
    if "/gridpoints/" in url and not url.rstrip("/").endswith("/forecast"):
        return {"properties": {"maxTemperature": {
            "uom": "wmoUnit:degC",
            "values": [{"validTime": "2026-08-15T12:00:00+00:00/P1D", "value": 39.444}],
        }}}
    if "ensemble" in url and "open-meteo" in url:
        return {"daily": {
            "time": ["2026-08-15"],
            "temperature_2m_max_member01": [102],
            "temperature_2m_max_member02": [104],
        }}
    if "open-meteo.com" in url:
        return {"daily": {"time": ["2026-08-15"], "temperature_2m_max": [103]}}
    if "forecast" in url:
        return {"properties": {"periods": [
            {"isDaytime": True, "startTime": "2026-08-15T06:00:00-05:00", "temperature": high, "temperatureUnit": "F"},
        ]}}
    return {}


class FrontMarkupTests(unittest.TestCase):
    def test_tab_and_ring_not_city_list(self):
        self.assertIn('id="tabFront"', HTML)
        self.assertIn('data-mode="front"', HTML)
        self.assertIn('id="frontView"', HTML)
        self.assertIn("THE FRONT", HTML)
        self.assertIn("id=\"frontRing\"", HTML)
        self.assertIn('id="frontChairImg"', HTML)
        self.assertIn('id="frontChairImg" src="/raijin-wait.jpg"', HTML)
        self.assertIn("/static/bots/raijin-wait.png", HTML)
        self.assertIn("/static/bots/raijin-chair.png", FRONT)
        self.assertIn("function drawFrontTable(", JS)
        self.assertIn("drawFrontTable(ctx, w, h)", JS)
        self.assertIn("frontSeatImgs", JS)
        self.assertIn("clip-path: inset(50%)", CSS)
        self.assertIn("RAIJIN", HTML)
        self.assertIn("GLASS", HTML)
        self.assertIn("PIT", HTML)
        self.assertIn("FROST", HTML)
        self.assertIn("BONE", HTML)
        self.assertIn("MESH", HTML)
        self.assertIn("HEAT", HTML)
        self.assertIn("ECHO", HTML)
        self.assertIn("CELL", HTML)
        self.assertNotIn('data-seat="HEAT"', HTML)
        self.assertNotIn('data-seat="ECHO"', HTML)
        self.assertNotIn('data-seat="CELL"', HTML)
        self.assertEqual(HTML.count('class="front-seat"'), 5)
        self.assertNotIn("FORECAST", HTML)
        self.assertNotIn("CLIMO", HTML)
        self.assertNotIn("CHI Midway", HTML)
        self.assertNotIn("NYC Central Park", HTML)
        self.assertNotIn("Dallas first, NYC second", HTML + JS)
        self.assertNotIn("KXHIGHNY", HTML + JS)
        self.assertNotIn("KXHIGHCHI", HTML + JS)
        self.assertEqual([c["series"] for c in desk_front.CITIES], ["KXHIGHTDAL"])
        self.assertIn("KXHIGHNY", desk_front.BLOCKED_SERIES)
        self.assertIn("KXHIGHCHI", desk_front.BLOCKED_SERIES)
        self.assertNotIn("CHI / NY", HTML)
        self.assertNotIn("KXHIGHTCHI", HTML)
        self.assertNotIn("front-city-card", HTML + JS + CSS)
        self.assertNotIn("front-thunder-mark", HTML + CSS)
        self.assertNotIn("front-raijin-slot", HTML + CSS)
        self.assertNotIn("CHI Midway", JS)
        self.assertEqual(desk_front.DALLAS["station"], "KDFW")
        self.assertEqual(desk_front.DALLAS["market"], "DFW")
        self.assertTrue(all(c["station"] != "KDAL" for c in desk_front.CITIES))
        self.assertNotIn("KXHIGHMIA", [c["series"] for c in desk_front.CITIES])
        self.assertNotIn("KXHIGHAUS", [c["series"] for c in desk_front.CITIES])
        self.assertNotIn("KXHIGHTPHX", [c["series"] for c in desk_front.CITIES])
        self.assertNotIn('{"id": "FORECAST"', FRONT)
        self.assertNotIn('{"id": "MARKET"', FRONT)
        self.assertLess(HTML.find('id="tabSide"'), HTML.find('id="tabFront"'))
        self.assertLess(HTML.find('id="tabFront"'), HTML.find('id="tabCharts"'))

    def test_bot_marks_are_pngs_no_letter_fallback(self):
        for name in ("glass.png", "pit.png", "frost.png", "bone.png", "mesh.png", "heat.png", "wx-echo.png", "cell.png", "raijin-chair.png", "raijin-up.png", "raijin-down.png", "raijin-wait.png"):
            path = BOTS / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 1000)
        self.assertIn("/static/bots/glass.png", HTML)
        self.assertIn("/static/bots/pit.png", HTML)
        self.assertIn("/static/bots/frost.png", HTML)
        self.assertIn("/static/bots/bone.png", HTML)
        self.assertIn("/static/bots/mesh.png", HTML)
        self.assertIn("frontMarkFail", JS)
        self.assertIn("frontChairImg", JS)
        self.assertIn("raijin-up.png", FRONT)
        self.assertIn("raijin-down.png", FRONT)
        self.assertIn("raijin-wait.png", FRONT)
        self.assertIn("front-mark.blank", CSS)
        self.assertNotIn("front-letter", HTML + JS + CSS)
        self.assertNotIn('textContent = "G"', JS)
        self.assertNotIn('textContent = "P"', JS)
        self.assertNotIn('textContent = "F"', JS)
        self.assertNotIn('textContent = "B"', JS)

    def test_settings_and_tutorial(self):
        self.assertIn("RAIJIN · THE FRONT", HTML)
        self.assertIn("Does not place 1H Chair locks", HTML)
        self.assertIn('title: "THE FRONT"', JS)
        self.assertIn("Raijin’s Floor — same ring as BTC / ETH", JS)
        self.assertIn("Hits count like Satoshi / Vitalik", JS)
        self.assertIn('"job": "NWS PANE"', FRONT)
        self.assertIn('"job": "THE PIT"', FRONT)
        self.assertIn('"job": "FROST KILL"', FRONT)
        self.assertIn('"job": "BONE CLIMO"', FRONT)
        self.assertIn('"job": "THE WEB"', FRONT)
        self.assertNotIn("forecast source", FRONT + JS + HTML)
        self.assertNotIn("Kalshi implied", FRONT + JS + HTML)
        self.assertNotIn("skip reason", FRONT + JS + HTML)
        self.assertNotIn("seasonal base", FRONT + JS + HTML)
        self.assertNotIn("multi-source aggregate", FRONT + JS + HTML)
        self.assertIn('{"id": "HEAT"', FRONT)
        self.assertIn('{"id": "ECHO"', FRONT)
        self.assertIn('{"id": "CELL"', FRONT)
        self.assertIn("id=\"frontSubHud\"", HTML)
        self.assertIn('id="frontHrRight"', HTML)
        self.assertIn('id="frontTape"', HTML)
        self.assertIn("LAST LOCKS", HTML)
        self.assertIn('id="frontSettingsCard"', HTML)
        self.assertIn('id="setFrontShowTab"', HTML)
        self.assertIn('id="setFrontShowChair"', HTML)
        self.assertIn('id="setFrontPaper"', HTML)
        self.assertIn('id="setFrontLive"', HTML)
        self.assertIn('id="setFrontMinConf"', HTML)
        self.assertIn('id="setFrontMaxStake"', HTML)
        self.assertIn('id="setFrontDailyLoss"', HTML)
        self.assertIn('id="setFrontNoLockFrost"', HTML)
        self.assertIn('id="setFrontSound"', HTML)
        self.assertIn('id="setFrontFadeOn"', HTML)
        self.assertIn("No city picker in v1", HTML)
        self.assertIn("function collectFrontSettings", JS)
        self.assertIn("function applyFrontSettings", JS)
        self.assertIn('id="frontBotsGuide"', HTML)
        self.assertIn("FRONT / RAIJIN", HTML)
        self.assertIn("Not mixed into WICK / TAPE", HTML)
        self.assertIn("function renderFrontBotsGuide", JS)
        self.assertIn("function frontBotMarkHtml", JS)
        self.assertNotIn("front-letter", HTML + JS + CSS)

    def test_floor_raijin_small_presence(self):
        self.assertIn('id="floorRaijin"', HTML)
        self.assertIn("floor-raijin", CSS)
        self.assertIn("function floorRaijinFit", JS)
        self.assertIn("function drawFloorRaijinChair", JS)
        self.assertIn('raijinPortrait.src = "/static/bots/raijin-chair.png"', JS)
        self.assertIn("function raijinPortraitFor", JS)
        self.assertIn('raijinImages.UP.src = "/raijin-up.jpg"', JS)
        self.assertIn("/static/bots/raijin-wait.png", HTML)
        self.assertIn('rememberChairHit(cx, cy, pr, "front")', JS)
        self.assertIn("function syncSeatSpinBtn", JS)
        self.assertIn('btn.textContent = spinning ? "SPIN" : "STILL"', JS)
        self.assertIn('id="focusFront"', HTML)
        self.assertIn('data-focus="front"', HTML)
        self.assertIn(">DWF</button>", HTML)
        self.assertIn("Focus Dallas Weather Forecast / Raijin", HTML)
        self.assertNotIn(">RAIJIN</button>", HTML)
        self.assertNotIn(">DFW</button>", HTML)
        self.assertIn("function isFrontTable", JS)
        self.assertIn("function frontTableState", JS)
        self.assertIn('bind(focusFront, "front")', JS)
        self.assertIn('setFocusTable("front")', JS)
        wire = JS.split("function wireFloorChairClicks", 1)[1].split("wireFloorChairClicks();", 1)[0]
        self.assertIn('hit.which === "front"', wire)
        self.assertIn('setFocusTable("front")', wire)
        self.assertNotIn('setMode("front")', wire)

    def test_front_paints_real_table_not_list(self):
        start = JS.find("function drawFrontTable(")
        end = JS.find("function seedFrontWx(", start)
        self.assertGreaterEqual(start, 0)
        self.assertGreater(end, start)
        body = JS[start:end]
        self.assertIn("drawHourRing(", body)
        self.assertIn("drawPacketSpoke(", body)
        self.assertIn("drawChairThink(", body)
        self.assertIn("containPortrait(raijinPortraitFor(dir)", body)
        self.assertIn("containPortrait(raijinPortrait", body)
        self.assertIn('drawPacketSpoke(x, y, end.x, end.y, col, confA, agree, fresh, "front")', JS)
        self.assertIn('"GLASS"', body)
        self.assertIn('"PIT"', body)
        self.assertIn('"FROST"', body)
        self.assertIn('"BONE"', body)
        self.assertIn('"MESH"', body)
        self.assertIn("LOCKED ", body)
        self.assertNotIn("drawLockIgnition(", body)
        self.assertNotIn("rgba(240, 193, 74", body)
        self.assertIn("drawFrontTable(ctx, w, h)", JS)
        self.assertIn("Raijin’s Floor. Dallas DFW daily high. Same ring as BTC / ETH", HTML)
        self.assertNotIn("front-city-card", HTML + JS + CSS)
        self.assertIn("id=\"frontTape\"", HTML)
        self.assertIn("LAST LOCKS", HTML)

    def test_not_behind_follower_and_no_zt(self):
        self.assertNotIn("tabFollower", HTML)
        self.assertNotIn("FOLLOWER_PASSWORD", HTML)
        self.assertNotIn("/api/follower/unlock", HTML)
        self.assertNotIn("/api/follower/order", JS)
        self.assertNotIn("follower_gate", JS)
        self.assertNotIn("ZT ·", FRONT)
        self.assertNotIn("ZT ·", HTML)
        self.assertIn("Never auto-bets", HTML)

    def test_css_and_routes(self):
        self.assertIn("body.mode-front #tabFront", CSS)
        self.assertIn("body.night-mode #tabFront", CSS)
        self.assertIn("body.mode-settings #frontView", CSS)
        self.assertIn("min-height: 56px", CSS)
        self.assertIn('@app.get("/api/front")', MAIN)
        self.assertIn('@app.post("/api/front/tap")', MAIN)
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find("/api/front"))

    def test_does_not_touch_follower_or_chair(self):
        self.assertNotIn("from backend.services.follower_gate", FRONT)
        self.assertNotIn("from backend.services.follower", FRONT)
        self.assertNotIn("desk_front", FOLLOWER)
        self.assertNotIn("desk_front", GATES)
        self.assertNotIn("desk_front", LEADER)
        self.assertIn("Does not place Chair 1H locks", FRONT)
        self.assertNotIn("KXGOLD15M", FRONT)
        self.assertNotIn("ARCADE_ASSETS = (\"BTC\", \"GOLD\")", SIDE)
        self.assertIn("ARCADE_ASSETS = (\"BTC\",)", SIDE)


class FrontWeatherTests(unittest.TestCase):
    def test_classify_modes(self):
        self.assertEqual(desk_front.classify_weather({"text": "Thunderstorm", "raw": "KDFW TS", "temp_f": 88}), "STORM")
        self.assertEqual(desk_front.classify_weather({"text": "Heavy rain", "raw": "KDFW +RA", "temp_f": 76}), "STORM")
        self.assertEqual(desk_front.classify_weather({"text": "Light rain", "raw": "KDFW -RA", "temp_f": 74}), "RAIN")
        self.assertEqual(desk_front.classify_weather({"text": "Clear", "raw": "SKC", "temp_f": 101}), "HEAT")
        self.assertEqual(desk_front.classify_weather({"text": "Clear", "raw": "CLR", "temp_f": 82}), "SUN")
        self.assertEqual(desk_front.classify_weather({"text": "Overcast", "raw": "OVC", "temp_f": 80}), "CLOUD")
        self.assertEqual(desk_front.classify_weather({"text": "Fair", "raw": "CLR", "temp_f": 70, "wind_kt": 24}), "WIND")
        self.assertIsNone(desk_front.classify_weather(None))
        self.assertIsNone(desk_front.classify_weather({}))

    def test_hold_last_mode_when_feed_dead(self):
        desk_front.reset_for_tests(Path(tempfile.mkdtemp()))
        live = desk_front.remember_weather({"text": "Clear", "raw": "CLR", "temp_f": 82, "station": "KDFW"})
        self.assertEqual(live["mode"], "SUN")
        self.assertFalse(live["held"])
        held = desk_front.remember_weather(None)
        self.assertEqual(held["mode"], "SUN")
        self.assertTrue(held["held"])
        self.assertFalse(held["live"])

    def test_live_kdfw_crt_backdrop(self):
        self.assertEqual(desk_front.DALLAS["station"], "KDFW")
        self.assertEqual(desk_front.DALLAS["market"], "DFW")
        self.assertIn("api.weather.gov/stations/KDFW/observations/latest", FRONT)
        self.assertIn("aviationweather.gov/api/data/metar?ids=KDFW", FRONT)
        self.assertIn("WX_REFRESH_S = 180.0", FRONT)
        self.assertIn("Dead feed holds last mode", FRONT)
        self.assertIn("const frontWxRefreshMs = 180000", JS)
        self.assertIn("Never invent SUN", JS)
        self.assertIn('wx === "SUN"', JS)
        self.assertIn('wx === "HEAT"', JS)
        self.assertIn('wx === "CLOUD"', JS)
        self.assertIn('wx === "RAIN"', JS)
        self.assertIn('wx === "WIND"', JS)
        self.assertIn('wx === "STORM"', JS)
        self.assertIn("rgba(255, 214, 74", JS)
        self.assertIn("wxNow === \"WIND\"", JS)
        self.assertIn("windLean", JS)
        self.assertIn("bolt-punch", JS + CSS)
        self.assertIn("/static/bots/glass.png", HTML + JS)
        self.assertIn("/static/bots/pit.png", HTML + JS)
        self.assertIn("/static/bots/frost.png", HTML + JS)
        self.assertIn("/static/bots/bone.png", HTML + JS)
        self.assertIn("FRONT / RAIJIN", HTML)
        self.assertIn("function renderFrontBotsGuide", JS)
        self.assertIn('id="frontSettingsCard"', HTML)
        self.assertIn("Raijin / THE FRONT", (ROOT / "TUTORIAL.md").read_text(encoding="utf-8"))

    def test_chair_name_is_raijin_never_blank(self):
        self.assertEqual(desk_front.CHAIR["id"], "RAIJIN")
        self.assertEqual(desk_front.CHAIR["name"], "RAIJIN")
        self.assertTrue(str(desk_front.CHAIR["name"]).strip())
        self.assertIn('"name": "RAIJIN"', FRONT)
        self.assertIn("function frontChairName(", JS)
        self.assertIn('return n || "RAIJIN"', JS)
        self.assertIn("frontChairName(chair) + \" · DFW\"", JS)
        self.assertIn("frontChairName()", JS)
        self.assertIn('id="frontChairImg" src="/raijin-wait.jpg"', HTML)
        self.assertIn(">RAIJIN<", HTML)
        self.assertNotIn("leave Chair name blank", JS + HTML + FRONT)
        self.assertEqual([c["series"] for c in desk_front.CITIES], ["KXHIGHTDAL"])
        self.assertIn("ARCADE_ASSETS = (\"BTC\",)", SIDE)

    def test_chair_face_is_thunder_knight_not_empty_or_neon(self):
        chair = BOTS / "raijin-chair.png"
        self.assertTrue(chair.is_file())
        self.assertGreater(chair.stat().st_size, 100000)
        for name in ("raijin-wait.png", "raijin-up.png", "raijin-down.png"):
            self.assertEqual(chair.read_bytes(), (BOTS / name).read_bytes(), name)
        self.assertIn('href="/static/bots/raijin-chair.png"', HTML)
        self.assertIn('id="frontChairImg" src="/raijin-wait.jpg"', HTML)
        self.assertLess(HTML.find('id="frontChair"'), HTML.find('id="frontRing"'))
        self.assertIn("#frontStageWrap > #frontChair .front-mark", CSS)
        self.assertIn("function raijinFace(", JS)
        self.assertIn('raijinPortrait.src = "/static/bots/raijin-chair.png"', JS)
        self.assertIn("containPortrait(raijinFace(", JS)
        self.assertIn("Never blank the Chair face", JS)
        self.assertIn("chairImg.src = raijinPortraitSrc(frontLockDir())", JS)
        self.assertNotIn("front-thunder-mark", HTML + CSS + JS)
        self.assertNotIn("front-raijin-slot", HTML + CSS + JS)
        self.assertNotIn("ZT ·", HTML)
        self.assertIn("SATOSHI’S COUNCIL", HTML)
        self.assertIn('src="/council-mark.png"', HTML)

    def test_raijin_eyes_swap_like_vitalik(self):
        static = ROOT / "frontend" / "static"
        for name in ("raijin-up.jpg", "raijin-down.jpg", "raijin-wait.jpg"):
            path = static / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 20000)
        self.assertNotEqual((static / "raijin-up.jpg").read_bytes(), (static / "chair-up.jpg").read_bytes())
        self.assertNotEqual((static / "raijin-down.jpg").read_bytes(), (static / "chair-down.jpg").read_bytes())
        self.assertNotEqual((static / "raijin-wait.jpg").read_bytes(), (static / "vitalik-wait.jpg").read_bytes())
        self.assertNotEqual((static / "raijin-up.jpg").read_bytes(), (static / "raijin-down.jpg").read_bytes())
        self.assertIn("const raijinImages", JS)
        self.assertIn("function raijinPortraitFor(dir)", JS)
        self.assertIn("function vitalikPortraitFor(dir)", JS)
        self.assertIn('raijinImages.UP.src = "/raijin-up.jpg"', JS)
        self.assertIn('raijinImages.DOWN.src = "/raijin-down.jpg"', JS)
        self.assertIn('raijinImages.WAIT.src = "/raijin-wait.jpg"', JS)
        self.assertNotIn('raijinImages.UP.src = "/chair-up.jpg"', JS)
        self.assertNotIn('raijinImages.UP.src = "/vitalik-up.jpg"', JS)
        self.assertIn('if (d === "UP" || d === "UP_HOLD") return raijinImages.UP', JS)
        self.assertIn('if (d === "DOWN" || d === "DOWN_HOLD") return raijinImages.DOWN', JS)
        self.assertIn("containPortrait(raijinPortraitFor(floorDir)", JS)
        self.assertIn("containPortrait(raijinPortraitFor(dir)", JS)
        self.assertIn("@app.get(\"/raijin-up.jpg\")", MAIN)
        self.assertIn("@app.get(\"/raijin-down.jpg\")", MAIN)
        self.assertIn("@app.get(\"/raijin-wait.jpg\")", MAIN)
        self.assertIn('btn.textContent = spinning ? "SPIN" : "STILL"', JS)


class FrontBoardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        desk_front.reset_for_tests(self.tmp)
        os.environ.pop("FRONT_LIVE", None)
        os.environ.pop("FRONT_KILL", None)

    async def test_dallas_only_named_seats(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory(),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 101, "wind_kt": 6},
        )
        self.assertEqual(board["city"]["station"], "KDFW")
        self.assertEqual(board["city"]["series"], "KXHIGHTDAL")
        self.assertNotIn("cards", board)
        ids = [s["id"] for s in board["seats"]]
        self.assertEqual(ids, ["GLASS", "PIT", "FROST", "BONE", "MESH"])
        self.assertEqual(board["chair"]["id"], "RAIJIN")
        self.assertEqual(board["chair"]["name"], "RAIJIN")
        self.assertTrue(str(board["chair"]["name"]).strip())
        self.assertTrue(all(s.get("dir") in ("ABOVE", "BELOW", "BETWEEN", "WAIT") for s in board["seats"]))
        self.assertTrue(all(s.get("dir") not in ("UP", "DOWN", "YES", "NO") for s in board["seats"]))
        self.assertTrue(all("vote" in s for s in board["seats"]))
        self.assertTrue(all(s["mark"].endswith(".png") for s in board["seats"]))
        self.assertTrue(board["chair"]["portrait"].endswith("raijin-chair.png"))
        self.assertEqual(board["chair"]["eye"], "UP")
        self.assertEqual(board["chair"]["lean"], "BETWEEN")
        self.assertTrue(board["chair"]["mark"].endswith("raijin-up.png"))
        self.assertEqual(board["clock"]["kind"], "kalshi")
        self.assertEqual(board["clock"]["label"], "DFW HIGH")
        self.assertEqual(board["clock"]["sub"], "settles 7:00 CT")
        self.assertIn("KXHIGHTDAL", str(board["clock"].get("ticker") or ""))
        self.assertIsNotNone(board["clock"].get("seconds_to_cli"))
        self.assertIsNotNone(board["clock"].get("cli_at"))
        self.assertIsNotNone(board["clock"].get("close_time"))
        self.assertNotEqual(board["clock"]["close_time"][:10], board["city"]["day"])
        self.assertNotEqual(str(board["clock"]["close_time"]), str(board["clock"]["cli_at"]))
        self.assertNotIn("1H", str(board["clock"].get("label") or ""))
        self.assertEqual(board["weather"]["mode"], "HEAT")
        self.assertFalse(board["follower"])
        self.assertTrue(board["status"]["paper_default"])
        self.assertIn("KXHIGHTDAL-26AUG15-B103104", [b["ticker"] for b in board["brackets"]])
        self.assertTrue(all(b["ticker"].startswith("KXHIGHTDAL") for b in board["brackets"]))
        self.assertNotIn("KXHIGHNY-26AUG15-B8485", [b["ticker"] for b in board["brackets"]])
        cities = [b["city"] for b in board["brackets"]]
        self.assertEqual(set(cities), {"DAL"})
        self.assertNotIn("NYC", cities)
        self.assertNotIn("CHI", cities)
        self.assertEqual([c["id"] for c in board["cities"]], ["DAL"])
        self.assertEqual(board["home"], "DAL")
        self.assertTrue(any(b.get("best") for b in board["brackets"]))
        self.assertEqual(next(b for b in board["brackets"] if b.get("best"))["city"], "DAL")
        self.assertEqual([v["id"] for v in board["brackets"][0]["votes"]], ["GLASS", "PIT", "FROST", "BONE", "MESH"])
        self.assertEqual(board["accuracy"]["leader"], "RAIJIN")
        self.assertIn("pending", board["accuracy"])
        self.assertTrue(all(s.get("rank") for s in board["seats"]))

    async def test_404_drops_series(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory({"missing": True}),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Overcast", "raw": "OVC", "temp_f": 80},
        )
        self.assertIn("KXHIGHTDAL", board["dropped"])
        self.assertEqual(board["brackets"], [])
        self.assertIsNone(board["best"])
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertTrue(board["chair"]["mark"].endswith("raijin-wait.png"))
        self.assertEqual([s["id"] for s in board["seats"]], ["GLASS", "PIT", "FROST", "BONE", "MESH"])

    def test_chair_eyes_up_down_wait(self):
        wait = desk_front.build_chair(None)
        self.assertEqual(wait["eye"], "WAIT")
        self.assertEqual(wait["name"], "RAIJIN")
        self.assertTrue(wait["mark"].endswith("raijin-wait.png"))
        self.assertTrue(wait["portrait"].endswith("raijin-chair.png"))
        up = desk_front.build_chair({"dont_play": False, "bracket": "103–104"})
        self.assertEqual(up["eye"], "UP")
        self.assertTrue(up["mark"].endswith("raijin-up.png"))
        skip = desk_front.build_chair({"dont_play": True, "skip": "thin book"})
        self.assertEqual(skip["eye"], "WAIT")
        self.assertTrue(skip["mark"].endswith("raijin-wait.png"))
        self.assertNotEqual(skip["eye"], "DOWN")

    async def test_inclusive_bracket_and_date_in_ticker(self):
        self.assertEqual(desk_front.date_from_ticker("KXHIGHTDAL-26AUG15-B103104"), date(2026, 8, 15))
        m = _m("KXHIGHTDAL-26AUG15-B103104")
        self.assertGreater(desk_front.forecast_p(103, m), 0.5)
        self.assertGreater(desk_front.forecast_p(104, m), 0.5)
        self.assertLess(desk_front.forecast_p(100, m), 0.3)

    async def test_paper_tap_and_live_off(self):
        ok = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=10,
            live=False,
            yes_bid=48,
            yes_ask=50,
            now=NOW,
        )
        self.assertTrue(ok["ok"], ok)
        self.assertTrue(ok["fill"]["paper"])
        self.assertFalse(ok["fill"]["live"])
        self.assertFalse(ok["fill"]["follower"])
        live = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=5,
            live=True,
            yes_bid=48,
            yes_ask=50,
            now=NOW,
        )
        self.assertFalse(live["ok"])
        self.assertIn("paper only", live["error"])
        chair = await desk_front.tap(ticker="KXBTCD-26AUG1516-T1", side="YES", stake=5, yes_bid=48, yes_ask=50)
        self.assertFalse(chair["ok"])
        self.assertIn("Chair 1H", chair["error"])

    def test_cli_parse_and_official_yes(self):
        text = "THE DALLAS-FORT WORTH CLIMATE SUMMARY FOR AUGUST 15 2026\nMAXIMUM TEMPERATURE (F)\n 103    104\n"
        self.assertEqual(desk_front.parse_cli_high(text, day=date(2026, 8, 15)), 103)
        self.assertIsNone(desk_front.parse_cli_high(text, day=date(2026, 8, 14)))
        self.assertIsNone(desk_front.parse_cli_high("MAXIMUM TEMPERATURE (F)\n 103\n"))
        love = "THE DALLAS LOVE FIELD CLIMATE SUMMARY FOR AUGUST 15 2026\nMAXIMUM TEMPERATURE (F)\n 99\n"
        self.assertIsNone(desk_front.parse_cli_high(love, station="KDFW", day=date(2026, 8, 15)))
        nyc = "THE NEW YORK CITY CENTRAL PARK CLIMATE SUMMARY FOR AUGUST 15 2026\nMAXIMUM TEMPERATURE (F)\n 84\n"
        self.assertIsNone(desk_front.parse_cli_high(nyc, station="KNYC", day=date(2026, 8, 15)))
        self.assertIsNone(desk_front.parse_cli_high(nyc, station="KDFW", day=date(2026, 8, 15)))
        m = _m("KXHIGHTDAL-26AUG15-B103104")
        self.assertTrue(desk_front.official_yes(103, market=m))
        self.assertTrue(desk_front.official_yes(104, market=m))
        self.assertFalse(desk_front.official_yes(102, market=m))
        self.assertIsNone(desk_front.official_yes(None, market=m))

    async def test_hits_pending_until_cli_not_forecast(self):
        await desk_front.build_board(
            fetch=_fetch_factory(),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 101},
        )
        ok = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=10,
            yes_bid=48,
            yes_ask=50,
            now=NOW,
        )
        self.assertTrue(ok["ok"], ok)
        self.assertEqual(ok["fill"]["result"], "OPEN")
        self.assertEqual(ok["fill"]["leader"], "RAIJIN")
        self.assertEqual(ok["fill"]["city"], "DAL")
        self.assertEqual([v["id"] for v in ok["fill"]["votes"]], ["GLASS", "PIT", "FROST", "BONE", "MESH"])
        await desk_front.settle_open_fills(nws=_nws_high_only)
        acc = desk_front.chair_accuracy()
        self.assertEqual(acc["pending"], 1)
        self.assertEqual(acc["total"], 0)
        self.assertEqual(acc["verdict"], "COLLECTING")
        n = await desk_front.settle_open_fills(cli_highs={"2026-08-15": 103})
        self.assertEqual(n, 1)
        acc = desk_front.chair_accuracy()
        self.assertEqual(acc["correct"], 1)
        self.assertEqual(acc["wrong"], 0)
        self.assertEqual(acc["pending"], 0)
        self.assertEqual(acc["accuracy_pct"], 100.0)
        tape = desk_front.lock_tape()
        self.assertEqual(tape[0]["result"], "HIT")
        self.assertEqual(tape[0]["city"], "DAL")
        self.assertTrue(tape[0]["paper"])
        recs = {r["id"]: r for r in desk_front.seat_records()}
        self.assertEqual(set(recs), {"GLASS", "PIT", "FROST", "BONE", "MESH"})
        self.assertTrue(all(r["rank"] >= 1 for r in recs.values()))
        self.assertGreaterEqual(recs["GLASS"]["n"], 1)
        miss = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=5,
            yes_bid=48,
            yes_ask=50,
            now=NOW,
        )
        await desk_front.settle_open_fills(cli_highs={"2026-08-15": 100})
        acc = desk_front.chair_accuracy()
        self.assertEqual(acc["correct"], 1)
        self.assertEqual(acc["wrong"], 1)
        self.assertEqual(miss["fill"]["result"], "MISS")
        rows = [r for r in desk_front._load_fills() if r.get("result") == "MISS"]
        self.assertEqual(len(rows), 1)

    async def test_later_cities_not_v1(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory(),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 82},
        )
        self.assertEqual([c["series"] for c in board["cities"]], ["KXHIGHTDAL"])
        self.assertNotIn("KXHIGHNY", [c["series"] for c in board["cities"]])
        self.assertNotIn("KXHIGHCHI", [c["series"] for c in board["cities"]])
        self.assertNotIn("NYC", [b["city"] for b in board["brackets"]])
        self.assertNotIn("CHI", [b["city"] for b in board["brackets"]])
        nyc = await desk_front.tap(ticker="KXHIGHNY-26AUG15-B8485", side="YES", stake=5, yes_bid=48, yes_ask=50)
        self.assertFalse(nyc["ok"])
        self.assertIn("not v1", nyc["error"])
        blocked = await desk_front.tap(ticker="KXHIGHCHI-26AUG15-B8384", side="YES", stake=5, yes_bid=48, yes_ask=50)
        self.assertFalse(blocked["ok"])
        self.assertIn("not v1", blocked["error"])

    async def test_frost_veto_no_lock(self):
        miss = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=5,
            yes_bid=48,
            yes_ask=50,
            votes=[{"id": "FROST", "dir": "SKIP"}],
        )
        self.assertFalse(miss["ok"])
        self.assertIn("FROST", miss["error"])

    async def test_arm_phrase(self):
        miss = desk_front.arm_live("nope")
        self.assertFalse(miss.get("ok"))
        with patch.dict(os.environ, {"FRONT_LIVE": "1"}):
            desk_front.reset_for_tests(self.tmp)
            ok = desk_front.arm_live("LIVE THE FRONT", now=1000.0)
            self.assertTrue(ok.get("ok"), ok)
            self.assertTrue(ok.get("arming"))
            self.assertFalse(desk_front.is_armed(1000.0))
            self.assertTrue(desk_front.is_armed(1010.0))


class FrontFocusWeatherDeskTests(unittest.TestCase):
    def test_gold_tab_letters_are_dwf_not_dfw_or_raijin(self):
        row = HTML.split('id="modeTabs"', 1)[1].split('id="tabFloor"', 1)[0]
        self.assertIn(">BTC</button>", row)
        self.assertIn(">ETH</button>", row)
        self.assertIn(">DWF</button>", row)
        self.assertNotIn(">RAIJIN</button>", row)
        self.assertNotIn(">DFW</button>", row)
        self.assertNotIn(">FRONT</button>", row)
        btn = HTML.split('id="focusFront"', 1)[1].split("</button>", 1)[0]
        self.assertIn("Focus Dallas Weather Forecast / Raijin", btn)
        self.assertNotIn("ZT", btn)
        self.assertIn('data-focus="front"', btn)

    def test_front_focus_roster_is_weather_only(self):
        self.assertIn("const FRONT_SEAT_KEYS", JS)
        self.assertIn('["glass", "pit", "frost", "bone", "mesh"]', JS)
        self.assertIn('["HEAT", "ECHO", "CELL"]', JS)
        self.assertNotIn('"heat"', JS.split("const FRONT_SEAT_KEYS", 1)[1].split(";", 1)[0])
        self.assertIn("frontLive", JS)
        draw = JS.split("function drawArt()", 1)[1].split("function renderDashboard", 1)[0]
        self.assertIn("frontLive", draw)
        self.assertIn("FRONT_SEAT_KEYS", draw)
        self.assertIn("glass: \"/static/bots/glass.png\"", JS)
        self.assertIn("pit: \"/static/bots/pit.png\"", JS)
        self.assertIn("frost: \"/static/bots/frost.png\"", JS)
        self.assertIn("bone: \"/static/bots/bone.png\"", JS)
        self.assertIn("mesh: \"/static/bots/mesh.png\"", JS)
        self.assertIn("function wxWord", JS)
        self.assertIn("function frontHighLine", JS)
        self.assertIn("KALSHI HIGH", JS)

    def test_no_1h_chip_on_front_focus(self):
        self.assertIn("function paintFrontWindowChrome", JS)
        chrome = JS.split("function paintFrontWindowChrome", 1)[1].split("function dockWindowLed", 1)[0]
        self.assertIn('ledLabel.textContent = "DFW HIGH"', chrome)
        self.assertIn('"DFW HIGH"', chrome)
        self.assertIn("settles 7:00 CT", chrome)
        self.assertIn("seconds_to_close", chrome)
        self.assertIn("charts-hero-front", JS)
        self.assertIn("window_kind: clock.close_time ? \"kalshi\" : \"cli\"", JS)
        self.assertIn("No Dallas book — waiting on DFW CLI", JS)
        self.assertNotIn("close_time: clock.cli_at", JS)
        self.assertNotIn("board.city ? board.city.day", JS)
        self.assertIn('id="wxCity"', HTML)
        self.assertIn('id="wxCliWindow"', HTML)
        self.assertIn("DALLAS", HTML)
        self.assertIn("BRACKET", HTML)
        self.assertIn("deskBook", JS)
        pair = JS.split("function drawPairCandles", 1)[1].split("function drawChartBtc()", 1)[0]
        self.assertIn("isFrontTable(focusTable)", pair)
        self.assertIn('setPairWindowChip(canvas, "1H WINDOW")', JS)
        self.assertIn('setPairWindowChip(canvas, "")', pair)
        view = JS.split("function getViewState()", 1)[1].split("function deskLockSnapshot", 1)[0]
        self.assertIn('isFrontTable(focusTable)', view)
        self.assertIn('tableState("front")', view)

    def test_above_below_never_up_down_on_front_hud(self):
        self.assertIn("function wxWord", JS)
        self.assertIn('return "ABOVE"', JS)
        self.assertIn('return "BELOW"', JS)
        self.assertIn('return "BETWEEN"', JS)
        self.assertIn("def weather_dir", FRONT)
        self.assertIn('"""HUD word for Dallas daily high. Never UP / DOWN / YES / NO."""', FRONT)
        self.assertEqual(desk_front.weather_dir("YES", strike_type="greater"), "ABOVE")
        self.assertEqual(desk_front.weather_dir("NO", strike_type="greater"), "BELOW")
        self.assertEqual(desk_front.weather_dir("YES", strike_type="between"), "BETWEEN")
        self.assertEqual(desk_front.weather_dir("NO", strike_type="between", forecast=100, floor_strike=103, cap_strike=104), "BELOW")
        self.assertEqual(desk_front.weather_dir("WAIT"), "WAIT")
        self.assertEqual(desk_front.weather_eye("ABOVE"), "UP")
        self.assertEqual(desk_front.weather_eye("BELOW"), "DOWN")
        self.assertEqual(desk_front.weather_eye("BETWEEN"), "UP")
        self.assertEqual(desk_front.weather_eye("WAIT"), "WAIT")

    def test_cli_clock_is_next_morning_not_hour(self):
        day = date(2026, 8, 15)
        cli = desk_front.cli_at_for(day)
        self.assertEqual(cli.hour, 7)
        self.assertEqual(cli.date(), date(2026, 8, 16))
        clock = desk_front.build_clock(
            day,
            {
                "strike_type": "between",
                "floor_strike": 103,
                "cap_strike": 104,
                "bracket": "103–104°F",
                "ticker": "KXHIGHTDAL-26AUG15-B103104",
                "close_time": "2026-08-16T04:00:00Z",
            },
            datetime(2026, 8, 15, 16, 5, tzinfo=timezone.utc),
            103,
        )
        self.assertEqual(clock["kind"], "kalshi")
        self.assertEqual(clock["label"], "DFW HIGH")
        self.assertEqual(clock["sub"], "settles 7:00 CT")
        self.assertEqual(clock["kalshi_high"], 104)
        self.assertEqual(clock["nws_high"], 103)
        self.assertGreater(clock["seconds_to_cli"], 3600)
        self.assertIsNotNone(clock["close_time"])
        self.assertNotEqual(str(clock["close_time"])[:10], "2026-08-15")
        self.assertNotEqual(clock["close_time"], clock["cli_at"])
        self.assertLess(clock["seconds_to_close"], clock["seconds_to_cli"])
        self.assertIsNone(desk_front.market_close_of({"close_time": "2026-08-15"}))
        self.assertNotIn("1H", clock["label"])


class MeshAndSubTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        desk_front.reset_for_tests(self.tmp)

    async def test_mesh_median_three_sources_not_glass(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory(),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 96, "wind_kt": 6},
        )
        mesh = next(s for s in board["seats"] if s["id"] == "MESH")
        glass = next(s for s in board["seats"] if s["id"] == "GLASS")
        self.assertGreaterEqual(mesh["n_sources"], 2)
        self.assertFalse(mesh["thin"])
        self.assertEqual(mesh["median"], 103)
        self.assertIn("3-SOURCE MEDIAN", mesh["call"])
        self.assertEqual(mesh["dir"], "BETWEEN")
        self.assertIn("GLASS READS 103°", glass["call"] or "")
        self.assertNotEqual(mesh["job"], glass["job"])
        self.assertTrue(mesh["mark"].endswith("mesh.png"))
        self.assertNotIn("Love", str(board.get("mesh")))
        self.assertNotIn("KDAL", str(board.get("mesh")))

    async def test_mesh_thin_on_misses_never_fakes(self):
        async def dead(url: str):
            raise TimeoutError("timeout")

        pack = await desk_front.fetch_mesh_highs(date(2026, 8, 15), nws=dead)
        self.assertTrue(pack["thin"])
        self.assertIsNone(pack["median"])
        self.assertGreaterEqual(len(pack["sources"]), 2)
        self.assertTrue(all(not s.get("ok") for s in pack["sources"] if s["id"] != "nbm"))
        self.assertIn("THIN MESH", desk_front.mesh_call_line(pack))

    def test_mesh_wide_frost_veto(self):
        mesh = desk_front.finish_mesh([
            desk_front._mesh_hit("nws", 98),
            desk_front._mesh_hit("open-meteo", 108),
        ])
        self.assertTrue(mesh["wide"])
        self.assertGreaterEqual(mesh["spread"], 4)
        skip = desk_front.skip_reason({}, 103, False, 4000, mesh=mesh)
        self.assertIn("WIDE SPLIT · SIT", skip)

    def test_heat_still_hit_and_cooked(self):
        live = desk_front.build_heat(now_f=96, nws_high=103, kalshi_high=104)
        self.assertIn("CAN WE STILL HIT 103°", live["line"])
        self.assertFalse(live["cooked"])
        cooked = desk_front.build_heat(
            now_f=105, nws_high=103, kalshi_high=104,
            strike_type="between", floor_strike=103, cap_strike=104,
        )
        self.assertEqual(cooked["line"], "DAY IS COOKED")
        self.assertTrue(cooked["blew_bracket"])
        miss = desk_front.build_heat(now_f=None)
        self.assertEqual(miss["line"], "METAR DEAD")
        self.assertFalse(miss["ok"])
        skip = desk_front.skip_reason({}, 103, False, 4000, heat=cooked)
        self.assertIn("DAY COOKED", skip)

    def test_echo_yday_feeds_bone_not_a_seat(self):
        echo = desk_front.build_echo(102, date(2026, 8, 14))
        self.assertEqual(echo["line"], "YDAY 102°")
        self.assertEqual(echo["parent"], "BONE")
        self.assertFalse(echo["vote"])
        miss = desk_front.build_echo(None)
        self.assertEqual(miss["line"], "NO YDAY CLI")
        ids = [s["id"] for s in desk_front.SEATS]
        self.assertEqual(ids, ["GLASS", "PIT", "FROST", "BONE", "MESH"])
        self.assertNotIn("ECHO", ids)
        self.assertNotIn("HEAT", ids)
        self.assertNotIn("CELL", ids)

    def test_cell_kill_and_honest_miss(self):
        kill = desk_front.build_cell({"raw": "KDFW TSRA", "text": "Thunderstorm"}, alerts_ok=True)
        self.assertTrue(kill["kill"])
        self.assertIn("CELL UP", kill["line"])
        skip = desk_front.skip_reason({}, 103, False, 4000, cell=kill)
        self.assertIn("CELL CAP", skip)
        clear = desk_front.build_cell({"raw": "KDFW CLR", "text": "Clear"}, alerts_ok=True)
        self.assertFalse(clear["kill"])
        self.assertIn("SKY CLEAR", clear["line"])
        miss = desk_front.build_cell(None, alerts_ok=False)
        self.assertEqual(miss["line"], "NO CELL FEED")
        self.assertFalse(miss["kill"])

    async def test_board_has_five_chairs_and_three_subs(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory(),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 96, "wind_kt": 6},
        )
        self.assertEqual([s["id"] for s in board["seats"]], ["GLASS", "PIT", "FROST", "BONE", "MESH"])
        self.assertEqual([s["id"] for s in board["subs"]], ["HEAT", "ECHO", "CELL"])
        self.assertTrue(all(not s.get("vote") and not s.get("chair") for s in board["subs"]))
        heat = next(s for s in board["subs"] if s["id"] == "HEAT")
        echo = next(s for s in board["subs"] if s["id"] == "ECHO")
        cell = next(s for s in board["subs"] if s["id"] == "CELL")
        self.assertIn("CAN WE STILL HIT", heat["line"])
        self.assertEqual(echo["line"], "YDAY 102°")
        self.assertIn("SKY CLEAR", cell["line"])
        glass = next(s for s in board["seats"] if s["id"] == "GLASS")
        pit = next(s for s in board["seats"] if s["id"] == "PIT")
        frost = next(s for s in board["seats"] if s["id"] == "FROST")
        bone = next(s for s in board["seats"] if s["id"] == "BONE")
        mesh = next(s for s in board["seats"] if s["id"] == "MESH")
        self.assertEqual(glass["job"], "NWS PANE")
        self.assertEqual(pit["job"], "THE PIT")
        self.assertEqual(frost["job"], "FROST KILL")
        self.assertEqual(bone["job"], "BONE CLIMO")
        self.assertEqual(mesh["job"], "THE WEB")
        self.assertEqual(glass["call"], "GLASS READS 103°")
        self.assertIn("BOOK ", pit["call"] or "")
        self.assertIn("30-YR", bone["call"] or "")
        self.assertIn("SOURCE MEDIAN", mesh["call"] or "")
        self.assertTrue(any(x["id"] == "HEAT" for x in glass["subs"]))
        self.assertTrue(any(x["id"] == "CELL" for x in frost["subs"]))
        self.assertTrue(any(x["id"] == "ECHO" for x in bone["subs"]))
        self.assertEqual(board["clock"].get("now_f"), 96)
        self.assertNotIn("1H", str(board["clock"].get("label")))
        self.assertFalse(board["follower"])

    def test_ui_subs_are_not_ring_chairs(self):
        self.assertIn("frontSubHud", HTML + JS)
        self.assertIn("FRONT_SUB_IDS", JS)
        self.assertIn("paintFrontSubs", JS)
        self.assertNotIn('data-seat="HEAT"', HTML)
        self.assertNotIn('data-seat="ECHO"', HTML)
        self.assertNotIn('data-seat="CELL"', HTML)
        keys = JS.split("const FRONT_SEAT_KEYS", 1)[1].split(";", 1)[0]
        self.assertIn("mesh", keys)
        self.assertNotIn("heat", keys)
        self.assertNotIn("echo", keys)
        self.assertNotIn("cell", keys)
        self.assertIn("wxNowTemp", HTML + JS)
        self.assertIn("wxSubStrip", HTML + JS)


if __name__ == "__main__":
    unittest.main()
