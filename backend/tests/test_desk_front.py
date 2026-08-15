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
    if "/points/" in url:
        return {"properties": {"forecast": "https://api.weather.gov/gridpoints/X/1,1/forecast"}}
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
        for name in ("glass.png", "pit.png", "frost.png", "bone.png", "raijin-chair.png", "raijin-up.png", "raijin-down.png", "raijin-wait.png"):
            path = BOTS / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 1000)
        self.assertIn("/static/bots/glass.png", HTML)
        self.assertIn("/static/bots/pit.png", HTML)
        self.assertIn("/static/bots/frost.png", HTML)
        self.assertIn("/static/bots/bone.png", HTML)
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
        self.assertIn("Official/NWS high for the station.", FRONT)
        self.assertIn("Kalshi implied vs that number, after vig.", FRONT)
        self.assertIn("Veto junk book / flip / SICK / thin n.", FRONT)
        self.assertIn("Seasonal base. Low weight.", FRONT)
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
        self.assertEqual(ids, ["GLASS", "PIT", "FROST", "BONE"])
        self.assertEqual(board["chair"]["id"], "RAIJIN")
        self.assertEqual(board["chair"]["name"], "RAIJIN")
        self.assertTrue(str(board["chair"]["name"]).strip())
        self.assertTrue(all(s.get("dir") in ("UP", "DOWN", "WAIT") for s in board["seats"]))
        self.assertTrue(all("vote" in s for s in board["seats"]))
        self.assertTrue(all(s["mark"].endswith(".png") for s in board["seats"]))
        self.assertTrue(board["chair"]["portrait"].endswith("raijin-chair.png"))
        self.assertEqual(board["chair"]["eye"], "UP")
        self.assertTrue(board["chair"]["mark"].endswith("raijin-up.png"))
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
        self.assertEqual([v["id"] for v in board["brackets"][0]["votes"]], ["GLASS", "PIT", "FROST", "BONE"])
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
        self.assertEqual([s["id"] for s in board["seats"]], ["GLASS", "PIT", "FROST", "BONE"])

    def test_chair_eyes_up_down_wait(self):
        wait = desk_front.build_chair(None)
        self.assertEqual(wait["eye"], "WAIT")
        self.assertEqual(wait["name"], "RAIJIN")
        self.assertTrue(wait["mark"].endswith("raijin-wait.png"))
        self.assertTrue(wait["portrait"].endswith("raijin-chair.png"))
        up = desk_front.build_chair({"dont_play": False, "bracket": "103–104"})
        self.assertEqual(up["eye"], "UP")
        self.assertTrue(up["mark"].endswith("raijin-up.png"))
        down = desk_front.build_chair({"dont_play": True, "skip": "thin book"})
        self.assertEqual(down["eye"], "DOWN")
        self.assertTrue(down["mark"].endswith("raijin-down.png"))

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
        self.assertEqual([v["id"] for v in ok["fill"]["votes"]], ["GLASS", "PIT", "FROST", "BONE"])
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
        self.assertEqual(set(recs), {"GLASS", "PIT", "FROST", "BONE"})
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


if __name__ == "__main__":
    unittest.main()
