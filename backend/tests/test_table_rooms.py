"""Signed table-room plates sit behind Floor/Table. Faces stay close-up. Paper. Follower OFF."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "frontend" / "static"
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
JS = (STATIC / "roundtable.js").read_text(encoding="utf-8")
CSS = (STATIC / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
WIRE = (STATIC / "wire.js").read_text(encoding="utf-8")

ROOMS = (
    ("satoshi-shrine.jpg", "satoshi"),
    ("vitalik-city.jpg", "vitalik"),
    ("ares-stadium.jpg", "ares"),
    ("raijin-dallas.jpg", "raijin"),
)
FACES = (
    "chair-wait.jpg",
    "vitalik-wait.jpg",
    "raijin-wait.jpg",
    "bots/raijin-chair.png",
    "ares-chair.png",
    "oracle-wait.jpg",
)


class TableRoomPlateTests(unittest.TestCase):
    def test_plates_are_jpeg_not_faces(self):
        face_bytes = [(STATIC / name).read_bytes() for name in FACES]
        for name, _room in ROOMS:
            path = STATIC / name
            self.assertTrue(path.is_file(), name)
            data = path.read_bytes()
            self.assertGreater(len(data), 20000, name)
            self.assertEqual(data[:2], b"\xff\xd8", name)
            for fb in face_bytes:
                self.assertNotEqual(data, fb, name)

    def test_css_sits_behind_floor_and_table(self):
        for name, room in ROOMS:
            self.assertIn('url("/%s")' % name, CSS)
            self.assertIn('data-chair-room="%s"' % room, CSS)
            self.assertIn('body.floor-mode[data-chair-room="%s"]' % room, CSS)
            self.assertIn('body.mode-art[data-chair-room="%s"]' % room, CSS)
            self.assertIn('body.night-mode[data-chair-room="%s"]' % room, CSS)
        self.assertIn("body.phone-floor[data-chair-room=\"satoshi\"]", CSS)
        self.assertIn("max-width: 480px", CSS.split("body.phone-floor[data-chair-room=\"satoshi\"]", 1)[0][-200:])

    def test_not_baked_into_faces(self):
        self.assertNotIn("satoshi-shrine.jpg", JS)
        self.assertNotIn("vitalik-city.jpg", JS)
        self.assertNotIn("ares-stadium.jpg", JS)
        self.assertNotIn("raijin-dallas.jpg", JS)
        self.assertIn('vitalikPortrait.src = "/vitalik-wait.jpg"', JS)
        self.assertIn('chairPortrait.src = "/chair-wait.jpg"', JS)
        self.assertIn('raijinPortrait.src = "/static/bots/raijin-chair.png"', JS)
        self.assertIn('return "raijin"', JS.split("function chairRoomOf", 1)[1][:400])

    def test_routes_and_wire(self):
        for name, _room in ROOMS:
            self.assertIn('@app.get("/%s")' % name, MAIN)
        self.assertIn("2026-08-16-table-room-plates", WIRE)
        self.assertIn("behind Floor/Table", WIRE)
        self.assertIn("Faces stay close-up", WIRE)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("room-satoshi.jpg", CSS)
        self.assertNotIn("room-vitalik.jpg", CSS)

    def test_gate_css_untouched(self):
        self.assertIn("#passwordGate.password-gate:not(.hidden)", CSS)
        self.assertIn("#passwordGate.password-gate.hidden", CSS)
        self.assertNotIn("comma-flex", CSS)
        hidden = CSS.split("#passwordGate.password-gate.hidden", 1)[1][:280]
        self.assertIn("display: none !important", hidden)
        self.assertIn("visibility: hidden !important", hidden)


if __name__ == "__main__":
    unittest.main()
