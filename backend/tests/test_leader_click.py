"""Floor Satoshi/Vitalik portrait clicks play the existing leader-click.mp4."""
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
        self.assertGreater(CLIP.stat().st_size, 1_000_000)
        self.assertIn('_first_video("leader-click.mp4")', MAIN)
        self.assertIn('@app.get("/leader-click.mp4")', MAIN)

    def test_html_sources_are_leader_click_only(self):
        wrap = HTML.split('id="leaderClickWrap"', 1)[1].split("floorMoneyRain", 1)[0]
        self.assertIn("/leader-click.mp4", wrap)
        self.assertIn("/static/leader-click.mp4", wrap)
        self.assertNotIn("zt-intro", wrap)
        self.assertNotIn("money-closeup", wrap)
        self.assertNotIn("CINEMATIC", wrap)
        self.assertNotIn("ZT", wrap)
        self.assertIn(">Close</button>", wrap)


class LeaderClickGestureTests(unittest.TestCase):
    def test_floor_satoshi_and_vitalik_register_hits(self):
        self.assertIn("function rememberChairHit", JS)
        self.assertIn('if (mode !== "floor") return;', JS.split("function rememberChairHit", 1)[1][:120])
        self.assertIn('rememberChairHit(cx, portraitY, pr, which)', JS)
        self.assertIn('drawTableWithBots(w * 0.25, h * 0.52, tableR, "bitcoin", chairNameOf("bitcoin") + " · BTC"', JS)
        self.assertIn('drawTableWithBots(w * 0.75, h * 0.52, tableR, "ethereum", chairNameOf("ethereum") + " · ETH"', JS)
        self.assertIn("rememberChairHit(cx, cy, lr, chairKeyOf(focusTable))", JS)

    def test_gesture_only_from_chair_hit(self):
        wire = _wire_fn()
        self.assertIn("chairHitAt", wire)
        self.assertIn("playLeaderClickVideo()", wire)
        self.assertIn("pointerup", wire)
        play = _play_fn()
        self.assertIn('if (mode !== "floor") return;', play)
        before = JS.split("function playLeaderClickVideo", 1)[0]
        self.assertNotIn("playLeaderClickVideo();", before)

    def test_esc_and_click_dismiss(self):
        self.assertIn("window.__dismissLeaderClick", JS)
        self.assertIn('if (typeof window.__dismissLeaderClick === "function" && window.__dismissLeaderClick())', JS)
        play = _play_fn()
        self.assertIn("wrap.onclick = () => cleanup();", play)
        self.assertIn("skipBtn.onclick", play)
        self.assertNotIn('setMode("art")', play)
        self.assertNotIn('setMode("floor")', play)


class LeaderClickExperienceTests(unittest.TestCase):
    def test_ducks_floor_music_no_zt_title(self):
        play = _play_fn()
        self.assertIn("__floorMusicDuckHold", play)
        self.assertIn("__floorMusicUnduck", play)
        self.assertIn("leader-clip-on", play)
        self.assertIn('document.body.classList.remove("zt-cinematic")', play)
        self.assertNotIn('document.body.classList.add("zt-cinematic")', play)
        self.assertNotIn("CINEMATIC", play)
        self.assertNotIn("ZT", play)
        wrap = HTML.split('id="leaderClickWrap"', 1)[1].split("floorMoneyRain", 1)[0]
        self.assertNotIn("CINEMATIC", wrap)

    def test_portraits_keep_drawing(self):
        loop = JS.split("function loop(ts)", 1)[1].split("async function poll", 1)[0]
        self.assertIn('if (mode === "art" || mode === "floor") drawArt();', loop)
        self.assertNotIn("leaderClickPlaying", loop)
        self.assertNotIn("deskCinematicOn()", loop)
        draw = JS.split("function drawArt()", 1)[1].split("function drawDualFloor", 1)[0]
        self.assertNotIn("if (leaderClickPlaying) return;", draw)
        self.assertIn("pointer-events: auto !important;", CSS)
        self.assertIn("body.leader-clip-on #leaderClickWrap", CSS)
        self.assertIn("#leaderClickFallback", CSS)


if __name__ == "__main__":
    unittest.main()
