"""Root aliases for stale SW + hot-path 500 softeners."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class DeskPatchFiles(unittest.TestCase):
    def test_patch_files_exist(self) -> None:
        static = ROOT / "frontend" / "static"
        for name in (
            "layout-cleanup.css",
            "focus-table.js",
            "watch-loop.js",
            "watch-loop.css",
        ):
            self.assertTrue((static / name).is_file(), name)

    def test_root_alias_routes_are_declared(self) -> None:
        src = (ROOT / "backend" / "services" / "desk_patches.py").read_text(encoding="utf-8")
        for route in (
            '"/layout-cleanup.css"',
            '"/focus-table.js"',
            '"/watch-loop.js"',
            '"/watch-loop.css"',
        ):
            self.assertIn(route, src)
        self.assertIn("def register_desk_patches", src)
        self.assertIn("def install", src)
        self.assertIn("/api/public/workspace/ensure", src)
        self.assertIn("/api/journal/cards", src)
        self.assertIn("workspace busy", src)

    def test_security_headers_installs_patches(self) -> None:
        src = (ROOT / "backend" / "services" / "security_headers.py").read_text(encoding="utf-8")
        self.assertIn("desk_patches", src)
        self.assertIn("install()", src)

    def test_cache_version_is_q(self) -> None:
        sw = (ROOT / "frontend" / "static" / "sw.js").read_text(encoding="utf-8")
        html = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn("20260830q", sw)
        self.assertIn("20260830q", html)
        self.assertNotIn("20260822f", html)
        self.assertIn("/seat.js?v=20260830q", html)
        self.assertIn("/sw.js?v=20260830q", html)

    def test_seat_js_loads_static_patches(self) -> None:
        seat = (ROOT / "frontend" / "static" / "seat.js").read_text(encoding="utf-8")
        self.assertIn("/static/layout-cleanup.css", seat)
        self.assertIn("/static/focus-table.js", seat)
        self.assertIn("/static/watch-loop.js", seat)
        self.assertIn("setFocusTable", seat)

    def test_busy_helper_and_empty_cards(self) -> None:
        from backend.services.desk_patches import _is_busy

        self.assertTrue(_is_busy(RuntimeError("database is locked")))
        self.assertFalse(_is_busy(ValueError("bad name")))


if __name__ == "__main__":
    unittest.main()
