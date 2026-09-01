"""Root robots/manifest routes resolve, and the legal pages carry no draft brackets."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEGAL = (ROOT / "frontend" / "static" / "legal.html").read_text(encoding="utf-8")
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")


class PublicRouteTests(unittest.IsolatedAsyncioTestCase):
    async def _get(self, path):
        from httpx import ASGITransport, AsyncClient

        from backend import main as m

        transport = ASGITransport(app=m.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    async def test_robots_txt_at_root(self):
        r = await self._get("/robots.txt")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/plain", r.headers.get("content-type", ""))
        self.assertIn("Disallow: /api/", r.text)
        self.assertIn("User-agent: *", r.text)

    async def test_manifest_at_root(self):
        r = await self._get("/manifest.webmanifest")
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/manifest+json", r.headers.get("content-type", ""))
        body = r.json()
        self.assertEqual(body.get("name"), "Satoshi's Council")
        self.assertTrue(body.get("icons"))

    async def test_manifest_json_alias(self):
        r = await self._get("/manifest.json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/manifest+json", r.headers.get("content-type", ""))


class LegalFilledTests(unittest.TestCase):
    def test_no_draft_brackets_left(self):
        self.assertNotIn("<mark>[", LEGAL)
        self.assertNotIn("Option B", LEGAL)

    def test_operator_and_law_filled(self):
        self.assertIn("Zachery Teas", LEGAL)
        self.assertIn("State of Texas", LEGAL)
        self.assertIn("phillyfreak2499@gmail.com", LEGAL)


class HeadManifestTests(unittest.TestCase):
    def test_index_links_manifest_and_theme(self):
        self.assertIn('rel="manifest"', HTML)
        self.assertIn("/manifest.webmanifest", HTML)
        self.assertIn('name="theme-color"', HTML)
        self.assertIn("#0b1220", HTML)


if __name__ == "__main__":
    unittest.main()
