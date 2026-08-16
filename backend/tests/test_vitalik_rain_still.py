"""ETH/Vitalik + Front/Raijin use the signed rain stills. Leader jpgs cache-busted."""
from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "frontend" / "static"
JS = (STATIC / "roundtable.js").read_text(encoding="utf-8")
CSS = (STATIC / "style.css").read_text(encoding="utf-8")
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
WIRE = (STATIC / "wire.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
FRONT = (ROOT / "backend" / "services" / "desk_front.py").read_text(encoding="utf-8")
ATS = (ROOT / "backend" / "services" / "desk_ats.py").read_text(encoding="utf-8")
ORA = (ROOT / "backend" / "services" / "desk_oracle.py").read_text(encoding="utf-8")

WAIT = STATIC / "vitalik-wait.jpg"
CITY = STATIC / "vitalik-city.jpg"
RAIJIN = STATIC / "raijin-wait.jpg"
DALLAS = STATIC / "raijin-dallas.jpg"
LEADER_HASH = hashlib.sha256(WAIT.read_bytes()).hexdigest()[:10]


class VitalikRainStillTests(unittest.TestCase):
    def test_signed_wait_is_rain_still_not_city(self):
        self.assertTrue(WAIT.is_file())
        self.assertTrue(CITY.is_file())
        wait = WAIT.read_bytes()
        city = CITY.read_bytes()
        self.assertTrue(wait.startswith(b"\xff\xd8"))
        self.assertTrue(city.startswith(b"\xff\xd8"))
        self.assertGreater(len(wait), 20000)
        self.assertGreater(len(city), 20000)
        self.assertNotEqual(wait, city)
        self.assertNotEqual(wait, (STATIC / "vitalik-up.jpg").read_bytes())
        self.assertNotEqual(wait, (STATIC / "vitalik-down.jpg").read_bytes())

    def test_raijin_wait_is_rain_still_not_dallas_or_helmet(self):
        self.assertTrue(RAIJIN.is_file())
        self.assertTrue(DALLAS.is_file())
        rain = RAIJIN.read_bytes()
        dallas = DALLAS.read_bytes()
        self.assertTrue(rain.startswith(b"\xff\xd8"))
        self.assertTrue(dallas.startswith(b"\xff\xd8"))
        self.assertGreater(len(rain), 20000)
        self.assertNotEqual(rain, dallas)
        self.assertNotEqual(rain, WAIT.read_bytes())
        helmet = STATIC / "bots" / "raijin-chair.png"
        self.assertTrue(helmet.is_file())
        self.assertNotEqual(rain, helmet.read_bytes())
        self.assertNotEqual(rain, (STATIC / "bots" / "raijin-wait.png").read_bytes())

    def test_eth_and_floor_use_one_wait_face(self):
        self.assertIn('vitalikPortrait.src = "/vitalik-wait.jpg"', JS)
        self.assertIn('"?v=" + LEADER_JPG_V', JS)
        self.assertIn('const LEADER_JPG_V = "%s"' % LEADER_HASH, JS)
        self.assertNotIn('vitalikPortrait.src = "/vitalik-up.jpg"', JS)
        self.assertNotIn('vitalikPortrait.src = "/vitalik-down.jpg"', JS)
        self.assertNotIn("vitalik-city.jpg", JS)
        pick = JS.split("function chairPortraitOf", 1)[1][:360]
        self.assertIn("return isEthTable(which) ? vitalikPortrait : chairPortrait", pick)
        self.assertIn("function vitalikPortraitFor(dir) { return vitalikPortrait; }", JS)
        self.assertIn('drawTableWithBots(w * 0.72, h * 0.30, tableR, "ethereum"', JS)
        self.assertIn("const img = chairPortraitOf(which, dir)", JS)
        self.assertIn("const portrait = chairPortraitOf(focusTable, leaderDir)", JS)
        self.assertIn("ONE FACE PER CHAIR", JS)
        self.assertIn("Labels carry UP/DOWN/WAIT/LOCK", JS)

    def test_satoshi_ares_oracle_use_signed_wait(self):
        self.assertIn('chairPortrait.src = "/chair-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertNotIn('chairPortrait.src = "/chair-up.jpg"', JS)
        self.assertNotIn('chairPortrait.src = "/chair-down.jpg"', JS)
        self.assertIn('aresPortrait.src = "/static/ares-wait.png" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('function aresPortraitSrc(dir) { return "/static/ares-wait.png" + "?v=" + LEADER_JPG_V; }', JS)
        self.assertNotIn('aresPortrait.src = "/static/ares-chair.png"', JS)
        self.assertIn('id="aresChairImg" src="/static/ares-wait.png?v=', HTML)
        self.assertIn('"mark": "/static/ares-wait.png"', ATS)
        self.assertIn('"portrait": "/static/ares-wait.png"', ATS)
        self.assertIn('oraclePortrait.src = "/oracle-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('"mark": "/oracle-wait.jpg"', ORA)
        self.assertIn('"portrait": "/oracle-wait.jpg"', ORA)
        pick = JS.split("function chairPortraitOf", 1)[1][:400]
        self.assertIn("return oraclePortrait", pick)
        self.assertIn("return aresPortrait", pick)
        self.assertIn("return isEthTable(which) ? vitalikPortrait : chairPortrait", pick)

    def test_front_and_floor_raijin_use_signed_wait(self):
        self.assertIn('raijinPortrait.src = "/raijin-wait.jpg"', JS)
        self.assertIn('function raijinPortraitFor(dir) { return raijinPortrait; }', JS)
        self.assertIn('function raijinPortraitSrc(dir) { return "/raijin-wait.jpg" + "?v=" + LEADER_JPG_V; }', JS)
        self.assertNotIn('raijinPortrait.src = "/raijin-up.jpg"', JS)
        self.assertNotIn('raijinPortrait.src = "/raijin-down.jpg"', JS)
        self.assertNotIn("/static/bots/raijin-chair.png", JS)
        self.assertNotIn('"/static/bots/raijin-wait.png"', JS + FRONT)
        pick = JS.split("function chairPortraitOf", 1)[1][:400]
        self.assertIn("return raijinPortrait", pick)
        self.assertIn("containPortrait(raijinPortraitFor(floorDir)", JS)
        self.assertIn("containPortrait(raijinPortraitFor(dir)", JS)
        self.assertIn("chairImg.src = raijinPortraitSrc()", JS)
        self.assertIn('id="frontChairImg" src="/raijin-wait.jpg?v=', HTML)
        self.assertIn('id="floorRaijin"', HTML)
        self.assertIn('"/raijin-wait.jpg"', FRONT)
        self.assertIn('"portrait": signed', FRONT)
        self.assertNotIn("WAIT cowboy", FRONT)
        self.assertNotIn("raijin-dallas.jpg", JS)

    def test_leader_jpgs_are_cache_busted(self):
        self.assertIn('LEADER_JPG_CACHE = {"Cache-Control": "public, max-age=60, must-revalidate"}', MAIN)
        self.assertIn('ROOM_JPG_CACHE = {"Cache-Control": "public, max-age=86400"}', MAIN)
        wait_route = MAIN.split('@app.get("/vitalik-wait.jpg")', 1)[1].split("@app.get", 1)[0]
        self.assertIn("headers=LEADER_JPG_CACHE", wait_route)
        self.assertNotIn("86400", wait_route)
        city_route = MAIN.split('@app.get("/vitalik-city.jpg")', 1)[1].split("@app.get", 1)[0]
        self.assertIn("headers=ROOM_JPG_CACHE", city_route)
        for name in ("chair-wait.jpg", "raijin-wait.jpg", "oracle-wait.jpg", "ares-wait.png"):
            block = MAIN.split('@app.get("/%s")' % name, 1)[1].split("@app.get", 1)[0]
            self.assertIn("headers=LEADER_JPG_CACHE", block)
        # Leftover from live #45: JS uses /static/ares-wait.png, which the
        # StaticFiles mount served as 200 with no Cache-Control. Dedicated
        # routes must win the prefix (registered before app.mount("/static")).
        mount_at = MAIN.index('app.mount("/static"')
        static_wait_at = MAIN.index('@app.get("/static/ares-wait.png")')
        static_chair_at = MAIN.index('@app.get("/static/ares-chair.png")')
        self.assertLess(static_wait_at, mount_at)
        self.assertLess(static_chair_at, mount_at)
        static_block = MAIN[min(static_wait_at, static_chair_at):mount_at]
        self.assertGreaterEqual(static_block.count("headers=LEADER_JPG_CACHE"), 2)
        self.assertIn("class _StaticLeaderCache", MAIN)
        self.assertIn('_StaticLeaderCache(directory=str(STATIC_DIR))', MAIN)
        self.assertIn('aresPortrait.src = "/static/ares-wait.png" + "?v=" + LEADER_JPG_V', JS)
        for name in ("satoshi-shrine.jpg", "ares-stadium.jpg", "raijin-dallas.jpg", "oracle-room.jpg"):
            block = MAIN.split('@app.get("/%s")' % name, 1)[1].split("@app.get", 1)[0]
            self.assertIn("headers=ROOM_JPG_CACHE", block)
        self.assertIn('chairPortrait.src = "/chair-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('vitalikPortrait.src = "/vitalik-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('raijinPortrait.src = "/raijin-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('oraclePortrait.src = "/oracle-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('aresPortrait.src = "/static/ares-wait.png" + "?v=" + LEADER_JPG_V', JS)

    def test_static_ares_stills_send_short_cache_over_http(self):
        from starlette.routing import Mount
        from starlette.testclient import TestClient

        from backend.main import LEADER_JPG_CACHE, app

        wait_i = chair_i = mount_i = None
        for i, route in enumerate(app.routes):
            path = getattr(route, "path", None)
            if path == "/static/ares-wait.png":
                wait_i = i
            elif path == "/static/ares-chair.png":
                chair_i = i
            elif isinstance(route, Mount) and path == "/static":
                mount_i = i
        self.assertIsNotNone(wait_i)
        self.assertIsNotNone(chair_i)
        self.assertIsNotNone(mount_i)
        self.assertLess(wait_i, mount_i)
        self.assertLess(chair_i, mount_i)
        want = LEADER_JPG_CACHE["Cache-Control"]
        client = TestClient(app, raise_server_exceptions=True)
        for path in ("/static/ares-wait.png", "/static/ares-chair.png", "/ares-wait.png"):
            resp = client.get(path)
            self.assertEqual(resp.status_code, 200, path)
            self.assertEqual(resp.headers.get("cache-control"), want, path)
            self.assertGreater(len(resp.content), 20000, path)
        css = client.get("/static/style.css")
        self.assertEqual(css.status_code, 200)
        self.assertNotEqual(css.headers.get("cache-control"), want)

    def test_room_plate_stays_separate(self):
        self.assertIn('url("/vitalik-city.jpg")', CSS)
        self.assertIn('data-chair-room="vitalik"', CSS)
        self.assertIn('url("/raijin-dallas.jpg")', CSS)
        self.assertIn('data-chair-room="raijin"', CSS)
        self.assertIn('url("/satoshi-shrine.jpg")', CSS)
        self.assertIn('url("/ares-stadium.jpg")', CSS)
        self.assertIn('url("/oracle-room.jpg")', CSS)
        self.assertNotIn("vitalik-city.jpg", JS)
        self.assertNotIn("raijin-dallas.jpg", JS)
        self.assertNotIn("satoshi-shrine.jpg", JS)
        self.assertNotIn("ares-stadium.jpg", JS)
        self.assertNotIn("oracle-room.jpg", JS)

    def test_wire_and_no_regress(self):
        self.assertIn("2026-08-16-vitalik-rain-still", WIRE)
        self.assertIn("All five chairs use the signed WAIT stills", WIRE)
        self.assertIn("/chair-wait.jpg", WIRE)
        self.assertIn("/vitalik-wait.jpg", WIRE)
        self.assertIn("/raijin-wait.jpg", WIRE)
        self.assertIn("/static/ares-wait.png", WIRE)
        self.assertIn("/oracle-wait.jpg", WIRE)
        self.assertIn("no cowboy hat", WIRE)
        self.assertIn("cache-busted", WIRE)
        self.assertIn("Paper. Follower OFF.", WIRE)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertIn('src="/council-mark.png"', HTML)
        self.assertNotIn("ZT ·", HTML)
        self.assertIn(">STILL</button>", HTML)
        self.assertIn("#passwordGate.password-gate:not(.hidden)", CSS)
        gate = CSS.split("#passwordGate.password-gate:not(.hidden)", 1)[1].split("}", 1)[0]
        self.assertIn("display: flex !important", gate)
        hidden = CSS.split("#passwordGate.password-gate.hidden", 1)[1][:280]
        self.assertIn("display: none !important", hidden)
        util = CSS.split("Ensure hidden utility always wins", 1)[1].split("}", 1)[0]
        self.assertIn(".hidden {", util)
        self.assertIn("display: none !important", util)
        self.assertNotIn("comma-flex", CSS)
        ora = JS.split("ORACLE_SEAT_MARKS", 1)[1][:400]
        self.assertIn("SIBYL", ora)
        self.assertIn("PIT", ora)
        self.assertIn("VEIL", ora)
        self.assertIn("MARBLE", ora)
        self.assertNotIn("Pattern Apprentice", JS + HTML + WIRE)
        self.assertNotIn("FOLLOWER_LIVE", JS)
        self.assertIn("2026-08-16-kill-crickets", WIRE)
        self.assertIn("2026-08-16-oracle-can-call", WIRE)
        self.assertIn("2026-08-16-header-still", WIRE)


if __name__ == "__main__":
    unittest.main()
