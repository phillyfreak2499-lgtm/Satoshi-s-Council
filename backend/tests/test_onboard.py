"""First-login choice, guided Tutorial from TUTORIAL.md, Summon → Floor."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
TUT = (ROOT / "TUTORIAL.md").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")


class FirstLoginChoiceTests(unittest.TestCase):
    def test_choice_screen_is_tutorial_or_summon_only(self):
        gate = HTML.split('id="summonGate"', 1)[1].split('id="coachOverlay"', 1)[0]
        self.assertIn('id="btnTutorial"', gate)
        self.assertIn("Tutorial", gate)
        self.assertIn('id="btnSummon"', gate)
        self.assertIn("Summon the Council", gate)
        self.assertNotIn("Skip the intro", gate)
        self.assertNotIn("money-closeup", gate)

    def test_password_then_choice_not_intro_video(self):
        auth = JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]
        self.assertIn("hasOnboarded", auth)
        self.assertIn("initSummonGate", auth)
        self.assertNotIn("playZtIntroThenSummonGate()", auth)
        self.assertIn("Fresh password entry → first-login choice", JS)

    def test_returning_users_skip_choice(self):
        self.assertIn("function hasOnboarded", JS)
        self.assertIn("function markOnboarded", JS)
        self.assertIn('council_onboarded', JS)
        auth = JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]
        self.assertIn("if (onboarded)", auth)
        self.assertIn('window.setMode("art")', auth)

    def test_password_still_required_cold(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertIn('sessionStorage.removeItem("council_auth_ok")', HTML)
        self.assertIn("leftover unlocked session is not the public default", JS)
        self.assertNotIn("localStorage.setItem(passKey", JS)
        self.assertNotIn("localStorage.getItem(passKey)", JS)


class SummonCinematicTests(unittest.TestCase):
    def test_video_path_is_summon_council(self):
        self.assertIn("/summon-council.mp4", HTML)
        self.assertIn("/static/summon-council.mp4", HTML)
        self.assertIn('@app.get("/summon-council.mp4")', MAIN)
        self.assertIn("_first_video(\"summon-council.mp4\")", MAIN)

    def test_summon_lands_on_floor(self):
        self.assertIn('dismissGate(true, "floor")', JS)
        self.assertIn("function runSummonSequence", JS)
        self.assertIn("summonFogOverlay", HTML)
        self.assertIn("purple", CSS.lower())


class GuidedTutorialTests(unittest.TestCase):
    def test_walks_real_ui_not_markdown_wall(self):
        self.assertIn("function placeCoach", JS)
        self.assertIn("function openTutorial", JS)
        self.assertIn('id="coachOverlay"', HTML)
        self.assertIn(".coach-hole", CSS)
        self.assertIn("tutorial-walk", CSS)
        for target in (
            "#tabScreensaver",
            "#tableStage",
            "#finalDecision",
            "#accuracyBadge",
            "#lawBadge",
            "#tabFloor",
            "#tabDashboard",
            "#tabBots",
            "#tabRanks",
            "#tabPaper",
            "#tabFront",
            "#tabCharts",
            "#tabSettings",
            "#btnHelp",
        ):
            self.assertIn(target, JS)

    def test_copy_follows_tutorial_md(self):
        self.assertIn("KXBTC15M", TUT)
        self.assertIn("KXBTC15M", JS)
        self.assertIn("research co-pilot", JS)
        self.assertIn("does not place real orders", JS)
        self.assertIn("under 80¢", JS)
        self.assertIn("locked_call", JS)
        self.assertIn("HIT RATE", JS)
        self.assertIn("WAIT excluded", JS)
        self.assertIn("15-minute", JS)
        self.assertIn("Raijin / THE FRONT", TUT)
        self.assertIn("KXHIGHTDAL", TUT)
        self.assertIn("KDFW", TUT)
        self.assertIn("not Love Field", TUT)
        self.assertIn("GLASS", TUT)
        self.assertIn("PIT", TUT)
        self.assertIn("FROST", TUT)
        self.assertIn("BONE", TUT)
        self.assertNotIn("KXGOLD15M", TUT)
        self.assertNotIn("KXHIGHNY", TUT)

    def test_help_replays_without_forcing_choice(self):
        self.assertIn("openTutorial(true)", JS)
        self.assertIn('id="btnHelp"', HTML)
        walk = JS.split("function openTutorial", 1)[1].split("window.openTutorial", 1)[0]
        self.assertIn("fromHelp", walk)
        self.assertIn("closeWalk", walk)
        self.assertNotIn("runSummonSequence", walk)


class GatePackStillPresentTests(unittest.TestCase):
    def test_cold_visit_still_gated(self):
        self.assertIn("Never start admin-unlocked", HTML)
        self.assertNotRegex(HTML, r"<body[^>]*admin-unlocked")


if __name__ == "__main__":
    unittest.main()
