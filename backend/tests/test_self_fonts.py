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
        self.assertIn("/fonts/share-tech-mono-400.woff2", css)
        self.assertIn("Share Tech Mono", css)
        # Rajdhani has no shipped woff2 source; referencing it would 404 on
        # every load. It must NOT appear in fonts.css — its font-family usages
        # fall back through their stacks instead.
        self.assertNotIn("rajdhani-", css.lower())
        self.assertNotIn("fonts.googleapis", css)
        self.assertNotIn("fonts.gstatic", css)

    def test_dojo_head_is_local(self) -> None:
        html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
        self.assertIn("/fonts.css", html)
        self.assertIn("/fonts/orbitron-700.woff2", html)
        self.assertNotIn("fonts.googleapis", html)
        self.assertNotIn("fonts.gstatic", html)
        self.assertNotIn("family=Inter", html)

    def test_ensure_writes_woff2_when_sidecars_present(self) -> None:
        from backend.services.self_fonts import ensure_self_fonts, FONT_HINT, FONT_FILES
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
            blobs = list(dest.glob("*.b64"))
            if blobs:
                self.assertTrue((dest / "orbitron-700.woff2").is_file())
            # Only the sidecars the repo actually ships must decode. Rajdhani has
            # no woff2 source and falls back gracefully, so it is not required.
            names = {p.name for p in src.glob("*.b64")}
            self.assertIn("orbitron-700.woff2.b64", names)

    def test_sw_precaches_critical_faces(self) -> None:
        sw = (ROOT / "frontend" / "static" / "sw.js").read_text(encoding="utf-8")
        self.assertIn("20260830d", sw)
        # SW precaches the stylesheet at its real route and maps the Google-font
        # hosts to the self-hosted faces it ships.
        self.assertIn("/static/fonts.css?v=", sw)
        self.assertIn("/static/fonts/orbitron-700.woff2", sw)
        self.assertIn("/static/fonts/share-tech-mono-400.woff2", sw)
