"""Self-hosted latin woff2 — no Google hop on the packed desk."""
from __future__ import annotations

import base64
import gzip
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _desk_html() -> str:
    parts = [(ROOT / "frontend" / "static" / f"desk-{i}.b64").read_text() for i in range(12)]
    raw = gzip.decompress(base64.b64decode("".join(parts).encode("ascii")))
    return raw.decode("utf-8")


class SelfFontTests(unittest.TestCase):
    def test_fonts_css_is_swap_and_local(self) -> None:
        css = (ROOT / "frontend" / "static" / "fonts.css").read_text(encoding="utf-8")
        self.assertIn("font-display: swap", css)
        self.assertIn("/fonts/orbitron-700.woff2", css)
        self.assertIn("/fonts/rajdhani-600.woff2", css)
        self.assertIn("Share Tech Mono", css)
        self.assertNotIn("fonts.googleapis", css)
        self.assertNotIn("fonts.gstatic", css)

    def test_desk_does_not_call_google_fonts(self) -> None:
        html = _desk_html()
        self.assertNotIn("fonts.googleapis", html)
        self.assertNotIn("fonts.gstatic", html)
        self.assertIn("/fonts/orbitron-700.woff2", html)
        self.assertIn("/fonts.css?v=20260821m", html)
        self.assertIn('rel="preload" as="font"', html)

    def test_ensure_writes_woff2(self) -> None:
        from backend.services.self_fonts import ensure_self_fonts, FONT_HINT
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "style.css").write_text("body{}", encoding="utf-8")
            ensure_self_fonts(root)
            self.assertTrue((root / "fonts" / "orbitron-700.woff2").is_file())
            self.assertGreater((root / "fonts" / "orbitron-700.woff2").stat().st_size, 1000)
            self.assertTrue((root / "fonts.css").is_file())
            self.assertIn(FONT_HINT, (root / "style.css").read_text(encoding="utf-8"))

    def test_sw_precaches_critical_faces(self) -> None:
        sw = (ROOT / "frontend" / "static" / "sw.js").read_text(encoding="utf-8")
        self.assertIn("20260821m", sw)
        self.assertIn("/fonts.css?v=", sw)
        self.assertIn("/fonts/orbitron-700.woff2", sw)
        self.assertIn("/fonts/rajdhani-600.woff2", sw)
