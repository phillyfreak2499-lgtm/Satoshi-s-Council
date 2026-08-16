"""Oracle WAIT / Floor / HUD use the signed laurel close-up. Room plate stays back."""
from __future__ import annotations

import hashlib
import struct
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from backend.main import LEADER_JPG_CACHE, app

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "frontend" / "static"
JS = (STATIC / "roundtable.js").read_text(encoding="utf-8")
CSS = (STATIC / "style.css").read_text(encoding="utf-8")
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
WIRE = (STATIC / "wire.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
ORA = (ROOT / "backend" / "services" / "desk_oracle.py").read_text(encoding="utf-8")

FACE = STATIC / "oracle-wait.jpg"
ROOM = STATIC / "oracle-room.jpg"
OLD_SPLIT_LIGHT = "84cc425921078c080b5318909c615c6e16505db8c58672d22197635868ed1dbc"


def _leader_hash() -> str:
    h = hashlib.sha256()
    for name in ("chair-wait.jpg", "vitalik-wait.jpg", "oracle-wait.jpg", "ares-wait.png"):
        h.update((STATIC / name).read_bytes())
    return h.hexdigest()[:10]


def _jpeg_size(data: bytes) -> tuple[int, int]:
    i = 2
    while i < len(data) - 8:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return int(w), int(h)
        if marker in (0xD8, 0xD9) or (0xD0 <= marker <= 0xD7):
            i += 2
            continue
        if i + 3 >= len(data):
            break
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        i += 2 + seglen
    raise AssertionError("JPEG SOF not found")


class OracleLaurelStillTests(unittest.TestCase):
    def test_wait_file_is_new_laurel_jpeg_not_old_man(self):
        self.assertTrue(FACE.is_file())
        data = FACE.read_bytes()
        self.assertTrue(data.startswith(b"\xff\xd8"))
        self.assertGreater(len(data), 20000)
        self.assertNotEqual(hashlib.sha256(data).hexdigest(), OLD_SPLIT_LIGHT)
        self.assertEqual(_jpeg_size(data), (1024, 1024))
        self.assertNotEqual(data, ROOM.read_bytes())
        self.assertTrue(ROOM.is_file())
        self.assertTrue(ROOM.read_bytes().startswith(b"\xff\xd8"))

    def test_floor_hud_load_one_wait_face(self):
        self.assertIn('oraclePortrait.src = "/oracle-wait.jpg" + "?v=" + LEADER_JPG_V', JS)
        self.assertIn('"mark": "/oracle-wait.jpg"', ORA)
        self.assertIn('"portrait": "/oracle-wait.jpg"', ORA)
        self.assertIn('const LEADER_JPG_V = "%s"' % _leader_hash(), JS)
        pick = JS.split("function chairPortraitOf", 1)[1][:400]
        self.assertIn("return oraclePortrait", pick)
        self.assertNotIn("oracle-up", JS.split("function chairPortraitOf", 1)[1][:400])
        self.assertNotIn("oracle-down", JS.split("function chairPortraitOf", 1)[1][:400])
        self.assertIn("ONE FACE PER CHAIR", JS)
        self.assertIn("Labels carry UP/DOWN/WAIT/LOCK", JS)
        self.assertNotIn("oracle-up.jpg", JS)
        self.assertNotIn("oracle-down.jpg", JS)

    def test_room_plate_stays_table_back(self):
        self.assertIn('url("/oracle-room.jpg")', CSS)
        self.assertIn('data-chair-room="oracle"', CSS)
        self.assertNotIn("oracle-room.jpg", JS.split("oraclePortrait.src", 1)[1][:400])
        self.assertIn('@app.get("/oracle-wait.jpg")', MAIN)
        self.assertIn('@app.get("/oracle-room.jpg")', MAIN)
        wait_route = MAIN.split('@app.get("/oracle-wait.jpg")', 1)[1].split("@app.get", 1)[0]
        room_route = MAIN.split('@app.get("/oracle-room.jpg")', 1)[1].split("@app.get", 1)[0]
        self.assertIn("headers=LEADER_JPG_CACHE", wait_route)
        self.assertIn("headers=ROOM_JPG_CACHE", room_route)
        self.assertNotIn("86400", wait_route)

    def test_no_glowing_eye_canvas_swap(self):
        self.assertNotIn("function drawOracleEyeTint", JS)
        self.assertNotIn("function paintOracleEyes", JS)
        hud = JS.split("function drawOracleCrtHud", 1)[1].split("function chairWindowClock", 1)[0]
        self.assertNotIn("fill(", hud)
        self.assertNotIn("drawImage", hud)

    def test_route_serves_new_face_with_short_cache(self):
        client = TestClient(app, raise_server_exceptions=True)
        resp = client.get("/oracle-wait.jpg")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("cache-control"), LEADER_JPG_CACHE["Cache-Control"])
        self.assertTrue(resp.content.startswith(b"\xff\xd8"))
        self.assertEqual(hashlib.sha256(resp.content).hexdigest(), hashlib.sha256(FACE.read_bytes()).hexdigest())
        self.assertNotEqual(hashlib.sha256(resp.content).hexdigest(), OLD_SPLIT_LIGHT)
        room = client.get("/oracle-room.jpg")
        self.assertEqual(room.status_code, 200)
        self.assertNotEqual(room.content, resp.content)

    def test_wire_mentions_face_swap(self):
        note = WIRE.split("2026-08-16-eth-slate-ares-oracle-lock", 1)[1].split(
            "2026-08-16-pattern-specialists", 1
        )[0]
        self.assertIn("/oracle-wait.jpg", note)
        self.assertIn("laurel", note)
        self.assertIn("split-light man", note)
        self.assertIn("/oracle-room.jpg stays the table back", note)
        self.assertIn("No glowing-eye canvas swaps", note)
        self.assertIn("WAIT/UP/DOWN", note)
        self.assertIn("max-age=60", note)
        self.assertNotIn("ZT", note)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertIn('src="/council-mark.png"', HTML)


if __name__ == "__main__":
    unittest.main()
