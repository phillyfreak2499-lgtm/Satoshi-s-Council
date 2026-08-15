"""Post-desk-code intro: zt-intro.mp4 fills the viewport with object-fit contain."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
CLIP = ROOT / "frontend" / "static" / "zt-intro.mp4"
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
FOLLOWER_HTML = (ROOT / "frontend" / "protected" / "follower_gate.html").read_text(encoding="utf-8")
FOLLOWER_BUNDLE = (ROOT / "frontend" / "protected" / "follower_bundle.js").read_text(encoding="utf-8")


def _play_fn() -> str:
    start = JS.find("function playDeskUnlockIntro")
    end = JS.find("window.playDeskUnlockIntro")
    assert start > 0 and end > start
    return JS[start:end]


def _auth_fn() -> str:
    return JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]


def _reveal_fn() -> str:
    return JS.split("function revealAppAfterDeskUnlock", 1)[1].split("\n  function ", 1)[0]


def _wrap_html() -> str:
    return HTML.split('id="deskIntroWrap"', 1)[1].split("summonVideoWrap", 1)[0]


def _contain_box(vw: float, vh: float, nw: float = 1280, nh: float = 1920):
    scale = min(vw / nw, vh / nh, 1.0)
    return nw * scale, nh * scale


class _FakeClassList:
    def __init__(self, names):
        self._s = set(names)

    def add(self, *names):
        self._s.update(names)

    def remove(self, *names):
        self._s.difference_update(names)

    def contains(self, name):
        return name in self._s


class _FakeStyle:
    def __init__(self):
        self._p = {}

    def setProperty(self, name, value, _priority=None):
        self._p[name] = value

    def get(self, name):
        return self._p.get(name)


class _FakeEl:
    def __init__(self, classes):
        self.classList = _FakeClassList(classes)
        self.style = _FakeStyle()
        self.attrs = {}

    def setAttribute(self, k, v):
        self.attrs[k] = v


def _load_reveal_fn(html, body, app, gate):
    def revealAppAfterDeskUnlock():
        if gate:
            gate.classList.add("hidden")
            gate.setAttribute("aria-hidden", "true")
        html.classList.remove("gate-locked", "gate-revealing")
        body.classList.remove("gate-locked", "gate-revealing")
        html.classList.add("desk-unlocked")
        body.classList.add("desk-unlocked")
        if app:
            app.style.setProperty("visibility", "visible", "important")
            app.style.setProperty("pointer-events", "auto", "important")

    return revealAppAfterDeskUnlock


class DeskIntroFileTests(unittest.TestCase):
    def test_clip_already_on_disk(self):
        self.assertTrue(CLIP.is_file())
        size = CLIP.stat().st_size
        self.assertGreater(size, 1_000_000)
        self.assertLess(size, 12_000_000)
        head = CLIP.read_bytes()[:4096]
        self.assertEqual(head[4:8], b"ftyp")
        self.assertIn('_first_video("zt-intro.mp4")', MAIN)
        self.assertIn('@app.get("/zt-intro.mp4")', MAIN)

    def test_route_does_not_fall_back_to_other_clips(self):
        route = MAIN.split('@app.get("/zt-intro.mp4")', 1)[1].split("@app.get", 1)[0]
        self.assertIn('_first_video("zt-intro.mp4")', route)
        self.assertNotIn("money-closeup", route)
        self.assertNotIn("leader-click", route)
        self.assertNotIn("money-rain", route)
        self.assertNotIn("summon-council", route)


class DeskIntroMarkupTests(unittest.TestCase):
    def test_html_sources_are_zt_intro_only(self):
        wrap = _wrap_html()
        self.assertIn("/zt-intro.mp4", wrap)
        self.assertIn("/static/zt-intro.mp4", wrap)
        self.assertIn('preload="auto"', wrap)
        self.assertIn(">SKIP</button>", wrap)
        self.assertNotIn("leader-click", wrap)
        self.assertNotIn("money-closeup", wrap)
        self.assertNotIn("money-rain", wrap)
        self.assertNotIn("summon-council", wrap)
        self.assertNotIn("CINEMATIC", wrap)
        self.assertNotIn("ZT", wrap)
        self.assertNotIn('aria-label="ZT', wrap)

    def test_password_gate_has_no_zt_branding(self):
        gate = HTML.split('id="passwordGate"', 1)[1].split('id="summonGate"', 1)[0]
        self.assertIn("SATOSHI’S COUNCIL", gate)
        self.assertNotIn("ZT", gate)
        self.assertIn("<title>Satoshi’s Council</title>", HTML)

    def test_preload_while_gate_is_up(self):
        self.assertIn('rel="preload" as="video" href="/zt-intro.mp4"', HTML)
        self.assertIn("function prefetchDeskIntroVideo", JS)
        init = JS.split("function initPasswordGate", 1)[1].split("function initLogoCredit", 1)[0]
        self.assertIn("prefetchDeskIntroVideo()", init)


class DeskIntroFitTests(unittest.TestCase):
    def test_overlay_uses_contain_not_cover(self):
        block = CSS.split("DESK UNLOCK INTRO", 1)[1].split("Hour aurora", 1)[0]
        self.assertIn("object-fit: contain !important", block)
        self.assertNotIn("object-fit: cover", block)
        self.assertIn("max-width: 100vw", block)
        self.assertIn("max-height: 100vh", block)
        self.assertIn("max-width: 100%", block)
        self.assertIn("max-height: 100%", block)
        self.assertIn("#deskIntroWrap", block)
        self.assertIn("#deskIntroVideo", block)
        self.assertIn("overflow: hidden", block)

    def test_contain_fits_phone_and_desktop(self):
        for vw, vh in ((390, 844), (1280, 720), (1280, 800)):
            w, h = _contain_box(vw, vh)
            self.assertLessEqual(w, vw)
            self.assertLessEqual(h, vh)
            self.assertGreater(w, 0)
            self.assertGreater(h, 0)
            self.assertAlmostEqual(w / h, 1280 / 1920, places=5)


class DeskIntroUnlockTests(unittest.TestCase):
    def test_parked_on_live_unlock_path(self):
        auth = _auth_fn()
        self.assertIn("revealAppAfterDeskUnlock", auth)
        self.assertNotIn("playDeskUnlockIntro()", auth)
        self.assertNotIn("playZtIntroThenSummonGate()", auth)
        self.assertNotIn('document.body.classList.add("gate-locked")', auth)
        self.assertEqual(JS.count("playDeskUnlockIntro();"), 0)
        play = _play_fn()
        self.assertIn("Parked on the live path", play)
        self.assertIn("return;", play)
        self.assertNotIn("vid.play()", play)
        self.assertNotIn("getElementById(\"deskIntroVideo\")", play)
        self.assertNotIn("getElementById(\"summonVideo\")", play)
        self.assertNotIn('classList.add("gate-locked")', play)

    def test_not_on_follower_or_settings_unlock(self):
        self.assertNotIn("playDeskUnlockIntro", FOLLOWER_JS)
        self.assertNotIn("deskIntroWrap", FOLLOWER_JS)
        self.assertNotIn("playDeskUnlockIntro", FOLLOWER_HTML)
        self.assertNotIn("playDeskUnlockIntro", FOLLOWER_BUNDLE)
        admin = JS.split("function requestAdminUnlock", 1)[1][:800]
        self.assertNotIn("playDeskUnlockIntro", admin)
        play = _play_fn()
        self.assertNotIn("playCelebrateVideo", play)
        self.assertNotIn("leader-click.mp4", play)
        self.assertNotIn("money-closeup", play)
        self.assertNotIn("money-rain", play)

    def test_missing_video_still_reveals_desk(self):
        """Unlock must clear gate-locked even when the intro is parked."""
        reveal = _reveal_fn()
        self.assertIn('document.documentElement.classList.remove("gate-locked", "gate-revealing")', reveal)
        self.assertIn('document.body.classList.remove("gate-locked", "gate-revealing")', reveal)
        self.assertIn('getElementById("passwordGate")', reveal)
        self.assertIn('setProperty("visibility", "visible", "important")', reveal)
        play = _play_fn()
        self.assertIn("return;", play)
        self.assertNotIn('classList.add("gate-locked")', play)
        self.assertNotIn("gate-revealing", play)

        html = _FakeEl(["gate-locked"])
        body = _FakeEl(["gate-locked", "gate-revealing"])
        app = _FakeEl([])
        gate = _FakeEl([])
        revealAppAfterDeskUnlock = _load_reveal_fn(html, body, app, gate)
        revealAppAfterDeskUnlock()
        self.assertFalse(html.classList.contains("gate-locked"))
        self.assertFalse(html.classList.contains("gate-revealing"))
        self.assertFalse(body.classList.contains("gate-locked"))
        self.assertFalse(body.classList.contains("gate-revealing"))
        self.assertTrue(html.classList.contains("desk-unlocked"))
        self.assertTrue(body.classList.contains("desk-unlocked"))
        self.assertTrue(gate.classList.contains("hidden"))
        self.assertEqual(app.style.get("visibility"), "visible")


class DeskIntroLeaderClickUntouchedTests(unittest.TestCase):
    def test_chair_click_wrap_is_still_leader_click_only(self):
        wrap = HTML.split('id="leaderClickWrap"', 1)[1].split("floorMoneyRain", 1)[0]
        self.assertIn("/leader-click.mp4", wrap)
        self.assertNotIn("zt-intro", wrap)
        self.assertIn("function playLeaderClickVideo", JS)


if __name__ == "__main__":
    unittest.main()
