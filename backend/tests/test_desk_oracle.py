"""ORA gold tab kit. Chair ORACLE. Seats SIBYL/PIT/VEIL/MARBLE. No Apollo. No GLD."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
ROOM = ROOT / "frontend" / "static" / "oracle-room.jpg"
FACE = ROOT / "frontend" / "static" / "oracle-wait.jpg"


def _wire_rows() -> list[dict]:
    m = re.search(r"window\.COUNCIL_WIRE\s*=\s*(\[[\s\S]*?\]);", WIRE_JS)
    return json.loads(m.group(1))


class OraGoldTabTests(unittest.TestCase):
    def test_ora_tab_not_gld(self):
        row = HTML.split('id="modeTabs"', 1)[1].split('id="tabFloor"', 1)[0]
        self.assertIn('id="focusOra"', row)
        self.assertIn('data-focus="oracle"', row)
        self.assertIn(">ORA</button>", row)
        self.assertIn("Focus ORACLE / CRT", row)
        self.assertNotIn(">GLD</button>", HTML)
        self.assertNotIn('id="focusGld"', HTML)
        self.assertNotIn('data-focus="gld"', HTML)
        self.assertNotIn("APOLLO", HTML)
        self.assertNotIn('id="focusApollo"', HTML)
        self.assertIn('bind(focusOra, "oracle")', JS)
        self.assertIn('#focusOra.focus-active', CSS)
        self.assertIn('body[data-focus-table="oracle"] #focusBtc.focus-active', CSS)

    def test_chair_name_stays_oracle(self):
        self.assertIn('return "ORACLE"', JS.split("function chairNameOf", 1)[1][:240])
        self.assertIn(">ORACLE</span>", HTML)
        self.assertNotIn(">GLD</span>", HTML.split('id="floorChairToggles"', 1)[1].split("</div>", 1)[0])


class OraSeatTests(unittest.TestCase):
    def test_sibyl_pit_veil_marble_no_apollo(self):
        self.assertIn('ORACLE_SEAT_IDS = ["SIBYL", "PIT", "VEIL", "MARBLE"]', JS)
        self.assertIn("THE READ", JS)
        self.assertIn("THE WELL", JS)
        self.assertIn("THE MASK", JS)
        self.assertIn("THE SLAB", JS)
        self.assertIn('id="oracleBotsGuide"', HTML)
        self.assertIn("SIBYL · PIT · VEIL · MARBLE", HTML)
        self.assertNotIn("APOLLO", JS.split("ORACLE_SEAT_IDS", 1)[1][:200])
        note = WIRE_JS.split("2026-08-16-ora-kit", 1)[1].split("2026-08-16-phone-oracle", 1)[0]
        self.assertIn("SIBYL", note)
        self.assertIn("MARBLE", note)
        self.assertIn("function renderOracleBotsGuide", JS)
        self.assertIn("ORACLE does not place orders", JS)


class OraRoomPlateTests(unittest.TestCase):
    def test_room_image_separate_from_face(self):
        self.assertTrue(ROOM.is_file())
        self.assertGreater(ROOM.stat().st_size, 20_000)
        self.assertTrue(FACE.is_file())
        self.assertNotEqual(ROOM.read_bytes(), FACE.read_bytes())
        self.assertNotEqual(ROOM.stat().st_size, FACE.stat().st_size)
        head = ROOM.read_bytes()[:3]
        self.assertEqual(head, b"\xff\xd8\xff")
        self.assertIn("/oracle-room.jpg", CSS)
        self.assertIn("/oracle-wait.jpg", JS)
        self.assertIn('@app.get("/oracle-room.jpg")', MAIN)
        self.assertIn('if (key === "oracle") return "oracle"', JS)
        self.assertIn('room === "oracle"', JS)
        self.assertIn('data-chair-room="oracle"', CSS)
        self.assertNotIn("/oracle-room.jpg", JS.split("oraclePortrait.src", 1)[1][:200])


class OraHudKitTests(unittest.TestCase):
    def test_crt_hud_hides_crypto(self):
        self.assertIn('id="oraWhy"', HTML)
        self.assertIn('id="oraWatch"', HTML)
        self.assertIn('id="oraWatchStrip"', HTML)
        self.assertIn("function paintOraWhy", JS)
        self.assertIn("function paintOraWatch", JS)
        self.assertIn('ledLabel.textContent = "WATCH"', JS)
        hide = CSS.split('body[data-focus-table="oracle"] #stripBtcPx', 1)[1][:400]
        self.assertIn("#stripEthPx", hide)
        self.assertIn(".odds-live", hide)
        self.assertIn('body[data-focus-table="oracle"] .chart-card.chart-crypto-odds', CSS)
        self.assertNotIn("spreadsheet", JS.split("function oracleTableState", 1)[1][:800].lower())


class OraGateStillCleanTests(unittest.TestCase):
    def test_no_comma_flex(self):
        self.assertNotIn("#passwordGate.password-gate,", CSS)
        for _m in re.finditer(r"#passwordGate\.password-gate\s*\{", CSS):
            self.fail("bare #passwordGate.password-gate { must not exist")
        self.assertIn("#passwordGate.password-gate:not(.hidden)", CSS)
        hidden = CSS.split("#passwordGate.password-gate.hidden", 1)[1].split("}", 1)[0]
        self.assertIn("display: none !important", hidden)


class OraWireTests(unittest.TestCase):
    def test_newest_is_ora_kit(self):
        rows = _wire_rows()
        self.assertEqual(rows[0]["id"], "2026-08-16-ora-kit")
        self.assertIn("ORA", rows[0]["why"])
        self.assertIn("GLD", rows[0]["why"])
        self.assertIn("SIBYL", rows[0]["why"])
        self.assertIn("Paper", rows[0]["why"])
        self.assertIn("Follower OFF", rows[0]["why"])
        self.assertNotIn("ZT", rows[0]["title"])
        self.assertNotIn("ZT", rows[0]["why"])
        ats = [r["at"] for r in rows]
        self.assertEqual(ats, sorted(ats, reverse=True))


if __name__ == "__main__":
    unittest.main()
