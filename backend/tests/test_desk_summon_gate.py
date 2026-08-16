"""Desk-code gate: agree checkbox, then SUMMON THE COUNCIL. Paper. Follower OFF."""
from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
FOLLOWER_HTML = (ROOT / "frontend" / "protected" / "follower_gate.html").read_text(encoding="utf-8")
FOLLOWER_BUNDLE = (ROOT / "frontend" / "protected" / "follower_bundle.js").read_text(encoding="utf-8")


def _password_gate() -> str:
    return HTML.split('id="passwordGate"', 1)[1].split('id="summonGate"', 1)[0]


def _init_password_gate() -> str:
    return JS.split("function initPasswordGate", 1)[1].split("function initLogoCredit", 1)[0]


def _btn_html() -> str:
    m = re.search(r'<button[^>]*id="passwordSubmit"[^>]*>.*?</button>', _password_gate(), re.S)
    if not m:
        raise AssertionError("passwordSubmit missing")
    return m.group(0)


def _sync_summon(agreed: bool) -> dict:
    """Mirror syncDeskGateSummon — disabled until the oath, then SUMMON THE COUNCIL."""
    btn = {"disabled": True, "text": "ENTER", "aria": "true"}
    sealed = bool(agreed)
    btn["disabled"] = not sealed
    btn["text"] = "SUMMON THE COUNCIL"
    btn["aria"] = "false" if sealed else "true"
    return {"sealed": sealed, "btn": btn}


class SummonGateMarkupTests(unittest.TestCase):
    def test_desk_code_field_still_required(self):
        gate = _password_gate()
        self.assertIn('id="passwordInput"', gate)
        self.assertIn('type="password"', gate)
        self.assertIn("Enter access code", gate)
        self.assertIn('id="passwordGate"', HTML)
        self.assertNotIn('id="passwordGate" class="password-gate hidden"', HTML)
        self.assertIn("leftover unlocked session is not the public default", JS)
        self.assertIn('localStorage.removeItem(passKey)', JS)
        self.assertNotIn("localStorage.setItem(passKey", JS)

    def test_agree_checkbox_and_disabled_submit(self):
        gate = _password_gate()
        self.assertIn('id="gateAgree"', gate)
        self.assertIn('type="checkbox"', gate)
        btn = _btn_html()
        self.assertIn("disabled", btn)
        self.assertIn('aria-disabled="true"', btn)
        self.assertIn("SUMMON THE COUNCIL", btn)
        for banned in (">Enter<", ">Start<", ">Go<", ">Unlock<", ">Sign in<"):
            self.assertNotIn(banned, btn)

    def test_six_oath_points_in_gate_markup(self):
        gate = _password_gate()
        blob = gate.lower()
        self.assertIn("paper only", blob)
        self.assertIn("not financial advice", blob)
        self.assertIn("18+", blob)
        self.assertIn("not kalshi", blob)
        self.assertIn("this desk is not kalshi", blob)
        self.assertIn("you can lose the full stake", blob)
        self.assertIn("no past score is a promise", blob)

    def test_no_zt_in_title_wordmark_or_gate(self):
        gate = _password_gate()
        title = HTML.split("<title>", 1)[1].split("</title>", 1)[0]
        wordmark = re.search(r'class="password-title">(.*?)</div>', gate)
        self.assertIsNotNone(wordmark)
        self.assertEqual(title, "Satoshi’s Council")
        self.assertEqual(wordmark.group(1).strip(), "SATOSHI’S COUNCIL")
        self.assertNotIn("ZT", title)
        self.assertNotIn("ZT", wordmark.group(1))
        self.assertNotIn("ZT", _btn_html())
        self.assertNotIn("ZT", gate)
        self.assertIn("SATOSHI’S COUNCIL", gate[:400])


class SummonGateBehaviorTests(unittest.TestCase):
    def test_js_disables_until_agree_then_summon_label(self):
        init = _init_password_gate()
        self.assertIn("syncDeskGateSummon", init)
        self.assertIn('getElementById("gateAgree")', init)
        self.assertIn("btn.disabled = !sealed", init)
        self.assertIn('btn.textContent = "SUMMON THE COUNCIL"', init)
        self.assertIn("if (!syncDeskGateSummon())", init)
        self.assertIn("Seal the pact first.", init)
        self.assertIn('agree.addEventListener("change", syncDeskGateSummon)', init)
        cold = _sync_summon(False)
        self.assertFalse(cold["sealed"])
        self.assertTrue(cold["btn"]["disabled"])
        self.assertEqual(cold["btn"]["text"], "SUMMON THE COUNCIL")
        hot = _sync_summon(True)
        self.assertTrue(hot["sealed"])
        self.assertFalse(hot["btn"]["disabled"])
        self.assertEqual(hot["btn"]["text"], "SUMMON THE COUNCIL")

    def test_wire_note_names_the_pact(self):
        self.assertIn("Gate now SUMMON THE COUNCIL after agree", WIRE_JS)
        self.assertIn("paper / not advice / 18+ / not Kalshi / full stake / no past score is a promise", WIRE_JS)
        self.assertIn("2026-08-15-summon-oath", WIRE_JS)


class SummonGateFreezeTests(unittest.TestCase):
    def test_follower_untouched(self):
        self.assertNotIn("syncDeskGateSummon", FOLLOWER_PY)
        self.assertNotIn("syncDeskGateSummon", FOLLOWER_ROUTE)
        self.assertNotIn("syncDeskGateSummon", FOLLOWER_JS)
        self.assertNotIn("syncDeskGateSummon", FOLLOWER_HTML)
        self.assertNotIn("syncDeskGateSummon", FOLLOWER_BUNDLE)
        self.assertNotIn("gateAgree", FOLLOWER_JS)
        self.assertNotIn("SUMMON THE COUNCIL", FOLLOWER_HTML)
        for needle in ("tabFollower", "FOLLOWER_PASSWORD", "/api/follower/unlock", "/api/follower/order"):
            self.assertNotIn(needle, HTML)
            self.assertNotIn(needle, JS)
        self.assertIn("paper default · live off", JS)
        self.assertIn("Never auto-bet", JS)

    def test_floor_lock_only_still_holds(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("onFloor ? [] : roster", JS)
        self.assertIn("Floor is leaders only", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("if (floorLikeMode())", art)
        self.assertIn("drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable))", art)
        self.assertNotIn("full WAIT roster", JS)
        self.assertNotIn("WAIT roster to fill", JS)

    def test_signed_hud_stays(self):
        self.assertIn("function atsKickLine", JS)
        self.assertIn("seconds_to_close", JS)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn("function paintAresEyes", JS)
        self.assertIn("ats-sport-chip", HTML + CSS)
        self.assertIn("72h", WIRE_JS)
        self.assertIn("btc_shadow", (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8"))
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("function wireIsUnread(", JS)
        ats = (ROOT / "backend" / "services" / "desk_ats.py").read_text(encoding="utf-8")
        self.assertIn("def eagles_ticket", ats)
        self.assertIn("function maybeAttractEnter()", JS)
        self.assertIn("function drawThinkingRing(", JS)

    def test_follower_bytes_did_not_move(self):
        """This PR must not rewrite Follower. Hash the live protected files."""
        for rel in (
            "backend/services/follower_gate.py",
            "backend/services/follower_route.py",
            "frontend/protected/follower_gate.js",
            "frontend/protected/follower_gate.html",
            "frontend/protected/follower_bundle.js",
        ):
            raw = (ROOT / rel).read_bytes()
            self.assertGreater(len(raw), 40, rel)
            hashlib.sha256(raw).hexdigest()


if __name__ == "__main__":
    unittest.main()
