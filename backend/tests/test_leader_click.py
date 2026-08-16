"""Floor/Table leader photo click selects the leader. No overlay clip."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
CLIP = ROOT / "frontend" / "static" / "leader-click.mp4"


def _play_fn() -> str:
    start = JS.find("function playLeaderClickVideo")
    end = JS.find("window.playLeaderClickVideo")
    assert start > 0 and end > start
    return JS[start:end]


def _wire_fn() -> str:
    start = JS.find("function wireFloorChairClicks")
    end = JS.find("wireFloorChairClicks();")
    assert start > 0 and end > start
    return JS[start:end]


class LeaderClickFileTests(unittest.TestCase):
    def test_clip_already_on_disk_not_a_new_upload(self):
        self.assertTrue(CLIP.is_file())
        size = CLIP.stat().st_size
        self.assertGreater(size, 1_000_000)
        self.assertLess(size, 8_000_000)
        head = CLIP.read_bytes()[:4096]
        self.assertEqual(head[4:8], b"ftyp")
        self.assertIn(b"moov", head)
        self.assertIn('_first_video("leader-click.mp4")', MAIN)
        self.assertIn('@app.get("/leader-click.mp4")', MAIN)

    def test_html_sources_are_leader_click_only(self):
        wrap = HTML.split('id="leaderClickWrap"', 1)[1].split("floorMoneyRain", 1)[0]
        self.assertIn("/leader-click.mp4", wrap)
        self.assertIn("/static/leader-click.mp4", wrap)
        self.assertIn('preload="metadata"', wrap)
        self.assertNotIn('preload="none"', wrap)
        self.assertNotIn("zt-intro", wrap)
        self.assertNotIn("money-closeup", wrap)
        self.assertNotIn("CINEMATIC", wrap)
        self.assertNotIn("ZT", wrap)
        self.assertIn(">Close</button>", wrap)


class LeaderClickGestureTests(unittest.TestCase):
    def test_floor_satoshi_and_vitalik_register_hits(self):
        self.assertIn("function rememberChairHit", JS)
        hit = JS.split("function rememberChairHit", 1)[1][:180]
        self.assertIn('if (mode !== "floor" && mode !== "art") return;', hit)
        self.assertIn('rememberChairHit(cx, portraitY, pr, which)', JS)
        self.assertIn('drawTableWithBots(w * 0.28, h * 0.30, tableR, "bitcoin", chairNameOf("bitcoin") + " · BTC"', JS)
        self.assertIn('drawTableWithBots(w * 0.72, h * 0.30, tableR, "ethereum", chairNameOf("ethereum") + " · ETH"', JS)
        self.assertIn('drawTableWithBots(w * 0.28, h * 0.72, tableR, "front", chairNameOf("front") + " · DWF"', JS)
        self.assertIn('drawTableWithBots(w * 0.72, h * 0.72, tableR, "ats", chairNameOf("ats") + " · ATS"', JS)
        self.assertIn("rememberChairHit(cx, cy, lr, chairKeyOf(focusTable))", JS)

    def test_gesture_selects_leader_no_clip(self):
        wire = _wire_fn()
        self.assertIn("chairHitAt", wire)
        self.assertIn("setFocusTable(hit.which)", wire)
        self.assertIn("pointerup", wire)
        self.assertIn('mode !== "art"', wire)
        self.assertNotIn("playLeaderClickVideo()", wire)
        play = _play_fn()
        self.assertIn("return;", play)
        self.assertNotIn("vid.play()", play)
        self.assertNotIn("leader-click.mp4", play)
        self.assertNotIn("zt-intro", play)
        self.assertNotIn("summon-council", play)
        self.assertNotIn("requestFullscreen", play)
        self.assertEqual(JS.count("playLeaderClickVideo();"), 0)

    def test_esc_dismiss_unused_when_clip_parked(self):
        play = _play_fn()
        self.assertNotIn("vid.play()", play)
        self.assertNotIn('setMode("art")', play)
        self.assertNotIn('setMode("floor")', play)


class LeaderClickExperienceTests(unittest.TestCase):
    def test_file_stays_unused_not_replaced_by_opening(self):
        wrap = HTML.split('id="leaderClickWrap"', 1)[1].split("floorMoneyRain", 1)[0]
        self.assertIn("/leader-click.mp4", wrap)
        self.assertNotIn("zt-intro", wrap)
        self.assertNotIn("CINEMATIC", wrap)
        self.assertNotIn("ZT", wrap)
        play = _play_fn()
        self.assertNotIn("zt-intro", play)
        self.assertNotIn("CINEMATIC", play)
        self.assertNotIn("ZT", play)

    def test_portraits_keep_drawing(self):
        loop = JS.split("function loop(ts)", 1)[1].split("async function poll", 1)[0]
        self.assertIn('if (mode === "art" || mode === "floor") drawArt();', loop)
        self.assertNotIn("deskCinematicOn()", loop)
        draw = JS.split("function drawArt()", 1)[1].split("function drawDualFloor", 1)[0]
        self.assertNotIn("if (leaderClickPlaying) return;", draw)
        self.assertIn("pointer-events: auto !important;", CSS)


if __name__ == "__main__":
    unittest.main()
