"""ETH chair + Floor Vitalik use the signed rain still. Leader jpgs cache-busted."""
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

WAIT = STATIC / "vitalik-wait.jpg"
CITY = STATIC / "vitalik-city.jpg"
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

    def test_leader_jpgs_are_cache_busted(self):
        self.assertIn('LEADER_JPG_CACHE = {"Cache-Control": "public, max-age=60, must-revalidate"}', MAIN)
        self.assertIn('ROOM_JPG_CACHE = {"Cache-Control": "public, max-age=86400"}', MAIN)
        wait_route = MAIN.split('@app.get("/vitalik-wait.jpg")', 1)[1].split("@app.get", 1)[0]
        self.assertIn("headers=LEADER_JPG_CACHE", wait_route)
        self.assertNotIn("86400", wait_route)
        city_route = MAIN.split('@app.get("/vitalik-city.jpg")', 1)[1].split("@app.get", 1)[0]
        self.assertIn("headers=ROOM_JPG_CACHE", city_route)
        for name in ("chair-wait.jpg", "raijin-wait.jpg", "oracle-wait.jpg"):
            block = MAIN.split('@app.get("/%s")' % name, 1)[1].split("@app.get", 1)[0]
            self.assertIn("headers=LEADER_JPG_CACHE", block)
        for name in ("satoshi-shrine.jpg", "ares-stadium.jpg", "raijin-dallas.jpg", "oracle-room.jpg"):
            block = MAIN.split('@app.get("/%s")' % name, 1)[1].split("@app.get", 1)[0]
            self.assertIn("headers=ROOM_JPG_CACHE", block)
        self.assertIn('chairPortrait.src = "/chair-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('vitalikPortrait.src = "/vitalik-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('raijinPortrait.src = "/raijin-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('oraclePortrait.src = "/oracle-wait.jpg" + "?v=" + LEADER_JPG_V', JS)

    def test_room_plate_stays_separate(self):
        self.assertIn('url("/vitalik-city.jpg")', CSS)
        self.assertIn('data-chair-room="vitalik"', CSS)
        self.assertNotIn("vitalik-city.jpg", JS)
        self.assertNotIn("satoshi-shrine.jpg", JS)

    def test_wire_and_no_regress(self):
        self.assertIn("2026-08-16-vitalik-rain-still", WIRE)
        self.assertIn("ETH and Floor Vitalik use the signed rain still", WIRE)
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
