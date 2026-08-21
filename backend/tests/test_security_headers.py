"""Origin sends HSTS / nosniff / referrer / frame deny / a basic CSP."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")

from backend.services.security_headers import HEADERS, apply_security_headers, CSP


class _Hdr(dict):
    def setdefault(self, k, v):
        if k not in self:
            self[k] = v
        return self[k]


class Dummy:
    def __init__(self):
        self.headers = _Hdr()


class SecurityHeaderTests(unittest.TestCase):
    def test_main_installs_middleware(self) -> None:
        self.assertIn("apply_security_headers", MAIN)
        self.assertIn("async def security_headers", MAIN)

    def test_required_headers_are_set(self) -> None:
        r = Dummy()
        apply_security_headers(r)
        self.assertEqual(r.headers["X-Frame-Options"], "DENY")
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(r.headers["Referrer-Policy"], "strict-origin-when-cross-origin")
        self.assertIn("max-age=31536000", r.headers["Strict-Transport-Security"])
        self.assertIn("frame-ancestors 'none'", r.headers["Content-Security-Policy"])
        self.assertIn("fonts.googleapis.com", CSP)
        for key in (
            "Strict-Transport-Security",
            "X-Content-Type-Options",
            "Referrer-Policy",
            "X-Frame-Options",
            "Content-Security-Policy",
        ):
            self.assertIn(key, HEADERS)

    def test_does_not_clobber_existing(self) -> None:
        r = Dummy()
        r.headers["X-Frame-Options"] = "SAMEORIGIN"
        apply_security_headers(r)
        self.assertEqual(r.headers["X-Frame-Options"], "SAMEORIGIN")


if __name__ == "__main__":
    unittest.main()
