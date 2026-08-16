"""Visible product name is Satoshi’s Council only — no ZT copy or monogram."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
STALE_JS = (ROOT / "frontend" / "js" / "roundtable.js").read_text(encoding="utf-8")
STALE_CSS = (ROOT / "frontend" / "css" / "style.css").read_text(encoding="utf-8")


class VisibleZtStripTests(unittest.TestCase):
    def test_no_slash_zt_stub(self):
        for blob in (HTML, JS, CSS):
            self.assertNotIn("/ ZT", blob)
            self.assertNotIn("title-zt", blob)
            self.assertNotIn("ZT CINEMATIC", blob)
            self.assertNotIn('alt="ZT"', blob)
            self.assertNotIn("Play ZT", blob)
            self.assertNotIn("ZT cinematic", blob)
            self.assertNotIn("ZT ·", blob)

    def test_title_and_og_are_council_only(self):
        self.assertIn("<title>Satoshi’s Council</title>", HTML)
        self.assertIn('property="og:title" content="Satoshi’s Council"', HTML)
        self.assertIn('name="description" content="Satoshi’s Council"', HTML)
        self.assertIn('property="og:image" content="/council-mark.png"', HTML)
        self.assertIn('name="twitter:image" content="/council-mark.png"', HTML)
        self.assertNotIn("Satoshi’s Council / ZT", HTML)
        self.assertNotIn("SATOSHI’S COUNCIL / ZT", HTML)

    def test_visible_marks_use_hex_not_zt_logo(self):
        # Slots stay /council-mark.png; the PICTURE is the isolated gold floor mark.
        self.assertIn('src="/council-mark.png"', HTML)
        self.assertGreaterEqual(HTML.count('src="/council-mark.png"'), 5)
        self.assertNotIn('src="/zt-logo.jpg"', HTML)
        self.assertIn('id="ztWatermark"', HTML)
        wm = HTML.split('id="ztWatermark"', 1)[1][:180]
        self.assertNotIn("zt-logo", wm)
        self.assertNotIn("src=", wm.split(">", 1)[0])
        self.assertIn('src="/council-mark.png"', wm)
        mark = ROOT / "frontend" / "static" / "council-mark.png"
        jpg = ROOT / "frontend" / "static" / "zt-logo.jpg"
        self.assertTrue(mark.is_file())
        self.assertTrue(jpg.is_file())
        raw = mark.read_bytes()
        self.assertEqual(raw[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(raw[12:16], b"IHDR")
        mw = int.from_bytes(raw[16:20], "big")
        mh = int.from_bytes(raw[20:24], "big")
        self.assertEqual(mw, mh)
        self.assertGreaterEqual(mw, 512)
        # Isolated black-ground mark — not the wide city / chamber-floor plate.
        self.assertGreater(mark.stat().st_size, 200_000)
        self.assertLess(mark.stat().st_size, 1_400_000)
        self.assertGreater(jpg.stat().st_size, 80_000)
        self.assertEqual(jpg.read_bytes()[:2], b"\xff\xd8")
        fav = (ROOT / "frontend" / "static" / "favicon.svg").read_text(encoding="utf-8")
        self.assertIn("<svg", fav)
        self.assertIn("data:image/png;base64,", fav)
        self.assertNotIn("#39ff14", fav)
        self.assertNotIn('stroke="#f0c14a"', fav)
        self.assertNotIn('stroke="#00e8ff"', fav)
        self.assertNotIn("gold ZT", CSS)
        self.assertIn("body.floor-mode .zt-watermark", CSS)
        self.assertIn("body.mode-floor .zt-watermark", CSS)
        ico = ROOT / "frontend" / "static" / "favicon.ico"
        self.assertTrue(ico.is_file())
        self.assertGreater(ico.stat().st_size, 200)

    def test_logo_labels_have_no_zt(self):
        self.assertIn('aria-label="Satoshi’s Council"', HTML)
        self.assertIn('aria-label="Play cinematic"', HTML)
        self.assertNotIn('aria-label="ZT', HTML)
        self.assertNotIn('title="Created by Zachery Teas"', HTML)
        self.assertIn(">CINEMATIC</div>", HTML)
        self.assertNotIn("ZT CINEMATIC", HTML)

    def test_stale_tree_has_no_visible_zt_titles(self):
        self.assertNotIn("ZT ·", STALE_JS)
        self.assertNotIn("ZT cinematic", STALE_JS)
        self.assertNotIn(".title-zt", STALE_CSS)


if __name__ == "__main__":
    unittest.main()
