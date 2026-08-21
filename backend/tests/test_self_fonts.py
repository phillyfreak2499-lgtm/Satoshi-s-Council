"""Self-hosted latin woff2 — no Google hop for CSS + SW."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SelfFontTests(unittest.TestCase):
    def test_fonts_css_is_swap_and_local(self) -> None:
        css = (ROOT / "frontend" / "static" / "fonts.css").read_text(encoding="utf-8")
        self.assertIn("font-display: swap", css)
        self.assertIn("/fonts/orbitron-700.woff2", css)
        self.assertIn("/fonts/rajdhani-600.woff2", css)
        self.assertIn("Share Tech Mono", css)
        self.assertNotIn("fonts.googleapis", css)
        self.assertNotIn("fonts.gstatic", css)

    def test_ensure_writes_woff2_when_sidecars_present(self) -> None:
        from backend.services.self_fonts import ensure_self_fonts, FONT_HINT
        src = ROOT / "frontend" / "static" / "fonts"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            dest = root / "fonts"
            dest.mkdir()
            if src.is_dir():
                for blob in src.glob("*.b64"):
                    (dest / blob.name).write_text(blob.read_text(), encoding="utf-8")
            (root / "style.css").write_text("body{}", encoding="utf-8")
            ensure_self_fonts(root)
            self.assertTrue((root / "fonts.css").is_file())
            self.assertIn(FONT_HINT, (root / "style.css").read_text(encoding="utf-8"))
            if list(dest.glob("*.b64")):
                self.assertTrue((dest / "orbitron-700.woff2").is_file())

    def test_sw_precaches_critical_faces(self) -> None:
        sw = (ROOT / "frontend" / "static" / "sw.js").read_text(encoding="utf-8")
        self.assertIn("20260821m", sw)
        self.assertIn("/fonts.css?v=", sw)
        self.assertIn("/fonts/orbitron-700.woff2", sw)
        self.assertIn("/fonts/rajdhani-600.woff2", sw)
