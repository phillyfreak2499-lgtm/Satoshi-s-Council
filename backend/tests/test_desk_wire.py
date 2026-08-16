"""WIRE tab: desk log of what changed and why."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


def _wire_entries() -> list[dict]:
    m = re.search(r"window\.COUNCIL_WIRE\s*=\s*(\[[\s\S]*?\]);", WIRE_JS)
    if not m:
        raise AssertionError("COUNCIL_WIRE array not found")
    return json.loads(m.group(1))


class WireMarkupTests(unittest.TestCase):
    def test_tab_and_view(self):
        self.assertIn('id="tabWire"', HTML)
        self.assertIn('data-mode="wire"', HTML)
        self.assertIn(">WIRE</button>", HTML)
        self.assertIn('id="wireView"', HTML)
        self.assertIn('id="wireList"', HTML)
        self.assertIn("<h2>WIRE</h2>", HTML)
        self.assertNotIn("Changelog", HTML)
        self.assertNotIn(">Updates</button>", HTML)
        self.assertIn("Satoshi’s Council", HTML.split('id="wireView"', 1)[1][:400])
        self.assertNotIn("ZT ·", HTML.split('id="wireView"', 1)[1][:800])
        self.assertIn("Paper. Follower OFF.", HTML)
        self.assertLess(HTML.find('id="tabNews"'), HTML.find('id="tabWire"'))
        self.assertLess(HTML.find('id="tabWire"'), HTML.find('id="tabSchool"'))
        self.assertIn('src="/wire.js"', HTML)

    def test_js_unread_and_mode(self):
        self.assertIn("council_wire_seen", JS)
        self.assertIn("function loadDeskWire()", JS)
        self.assertIn("function syncWireHot(", JS)
        self.assertIn("function markWireSeen(", JS)
        self.assertIn("function wireIsUnread(", JS)
        self.assertIn("localStorage.setItem(WIRE_SEEN_KEY", JS)
        self.assertIn("localStorage.getItem(WIRE_SEEN_KEY)", JS)
        self.assertIn('mode === "wire"', JS)
        self.assertIn('"wire"', JS)
        self.assertIn("America/Chicago", JS.split("function formatWireDate", 1)[1][:400])
        self.assertIn("function loadDeskWire()", JS)
        cycle = JS.split("window.__deskModeCycle", 1)[1][:400]
        self.assertIn('"wire"', cycle)

    def test_css_hot_and_chrome(self):
        self.assertIn("#tabWire.wire-hot", CSS)
        self.assertIn("wire-hot-pulse", CSS)
        self.assertIn("body.mode-wire #tabWire", CSS)
        self.assertIn("body.night-mode #tabWire", CSS)
        self.assertIn("body.phone-floor #tabWire", CSS)
        self.assertIn(".wire-list", CSS)
        self.assertIn(".wire-title", CSS)


class WireLogTests(unittest.TestCase):
    def test_comment_and_shape(self):
        first = WIRE_JS.lstrip().splitlines()[0]
        self.assertIn("Every Council PR that changes the desk must append a WIRE entry.", first)
        self.assertIn("{ id, at, title, why }", WIRE_JS)
        rows = _wire_entries()
        self.assertGreaterEqual(len(rows), 9)
        self.assertEqual(rows[0]["id"], "2026-08-16-hour-ladder")
        self.assertIn("ladder", rows[0]["title"])
        self.assertIn("64/36", rows[0]["why"])
        self.assertIn("Paper", rows[0]["why"])
        self.assertIn("Follower OFF", rows[0]["why"])
        self.assertNotIn("ZT", rows[0]["title"])
        self.assertNotIn("ZT", rows[0]["why"])
        glass_hud = next(r for r in rows if r["id"] == "2026-08-16-coinglass-hud")
        self.assertIn("CoinGlass", glass_hud["title"])
        self.assertIn("Upgrade plan", glass_hud["why"])
        self.assertIn("not the Raijin NWS GLASS", glass_hud["why"])
        pane = next(r for r in rows if r["id"] == "2026-08-16-glass-pane")
        self.assertIn("NWS pane", pane["why"])
        side = next(r for r in rows if r["id"] == "2026-08-16-side-parked")
        self.assertIn("Side", side["title"])
        self.assertIn("parked", side["why"])
        self.assertIn("not this Side Table", side["why"])
        ids = [r["id"] for r in rows]
        self.assertIn("2026-08-16-desk-unlock-stay", ids)
        self.assertIn("2026-08-15-hit-slate-reset", ids)
        self.assertLess(ids.index("2026-08-16-desk-unlock-stay"), ids.index("2026-08-15-hit-slate-reset"))
        hit = next(r for r in rows if r["id"] == "2026-08-15-hit-slate-reset")
        self.assertIn("3,053 hours", hit["why"])
        self.assertIn("old 2/7", hit["why"])
        self.assertIn("Paper only", hit["why"])
        self.assertIn("Follower OFF", hit["why"])
        for row in rows:
            self.assertEqual(set(row), {"id", "at", "title", "why"})
            self.assertTrue(row["id"])
            self.assertTrue(row["at"])
            self.assertTrue(row["title"])
            self.assertTrue(row["why"])
            self.assertNotIn("\n", row["why"])
        ats = [r["at"] for r in rows]
        self.assertEqual(ats, sorted(ats, reverse=True))

    def test_seed_facts(self):
        blob = WIRE_JS
        self.assertIn("72h", blob)
        self.assertIn("HOU@TTU", blob)
        self.assertIn("DAL -6.5", blob)
        self.assertIn("BTC shadow", blob)
        self.assertIn("ETH gates unchanged", blob)
        self.assertIn("NFL/CFB", blob)
        self.assertIn("NFL/CFB/NBA/MLB/NHL", blob)
        self.assertIn("GAME · LINE", blob)
        self.assertIn("fourth Floor seat", blob)
        self.assertIn("Follower OFF", blob)
        self.assertIn("10–90", blob)
        self.assertIn("99¢", blob)
        self.assertIn("20–80", blob)
        self.assertIn("Satoshi’s Council", blob)
        self.assertIn("hit slate", blob.lower())
        self.assertIn("Bot memory stays", blob)
        self.assertNotIn("KX", blob)
        self.assertNotIn("ZT ·", blob)
        self.assertNotIn("Changelog", blob)
        self.assertIn("2026-08-16-desk-unlock-stay", blob)
        self.assertIn("Unlock stays on the desk", blob)
        self.assertIn("After SUMMON the gate stays hidden", blob)
        self.assertIn("new 6s opening plays", blob)
        self.assertIn("old logo intro is gone", blob)
        self.assertIn("Leader photo click selects only", blob)
        self.assertIn("2026-08-15-hit-slate-reset", blob)
        self.assertIn("Chair hit slate reset after tape", blob)
        self.assertIn("3,053 hours", blob)
        self.assertIn("BTC 1,508 / ETH 1,545", blob)
        self.assertIn("WICK/STRIKE/CLOCK/DRIFT", blob)
        self.assertIn("CARRY/CHAIN/CASCADE stayed empty", blob)
        self.assertIn("CoinGlass Upgrade plan", blob)
        self.assertIn("old 2/7", blob)
        self.assertIn("Paper only", blob)
        self.assertIn("2026-08-15-login-splash", blob)
        self.assertIn("Login splash is the signed council table", blob)
        self.assertIn("dark stone + amber/cyan", blob)
        self.assertIn("Type sits over the table, not the faces", blob)
        self.assertIn("2026-08-15-raijin-cowboy-face", blob)
        self.assertIn("Raijin cowboy is face-only now", blob)
        self.assertIn("Cowboy face-only WAIT + Ares-style green/red eye tint; Dallas lives on the room plate.", blob)
        self.assertIn("2026-08-15-satoshi-face", blob)
        self.assertIn("Satoshi chair face swap", blob)
        self.assertIn("UP green / DOWN red / HOLD amber", blob)
        self.assertIn("Gold SELL cut parked, not live", blob)
        self.assertIn("Not Floor. Not rooms.", blob)
        self.assertIn("2026-08-15-raijin-cowboy", blob)
        self.assertIn("Raijin is now the Dallas storm cowboy", blob)
        self.assertIn("One signed WAIT cut; UP/DOWN eyes tint like Ares (green/red)", blob)
        self.assertIn("Name stays Raijin. No Cowboys star. Not Floor. Not ORACLE.", blob)
        self.assertIn("2026-08-15-vitalik-face", blob)
        self.assertIn("Vitalik chair got a new signed face", blob)
        self.assertIn("UP green / DOWN red / WAIT teal", blob)
        self.assertIn("Not Floor. Not ORACLE.", blob)
        self.assertIn("2026-08-15-floor-chairs", blob)
        self.assertIn("Floor is leaders only + checkboxes", blob)

    def test_route_and_signed_untouched(self):
        self.assertIn('@app.get("/wire.js")', MAIN)
        self.assertIn("function atsKickLine(", JS)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn("ats-sport-chip", CSS)
        self.assertIn('id="atsSportChip"', HTML)
        self.assertIn("def decide_open_lock_grade", GATES)
        council = (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8")
        self.assertIn("btc_shadow", council)
        self.assertNotIn("from backend.services.desk_wire", GATES)


if __name__ == "__main__":
    unittest.main()
