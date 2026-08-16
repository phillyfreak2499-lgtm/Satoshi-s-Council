"""Floor WAIT faces are signed no-glow close-ups. Paper. Follower OFF."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "frontend" / "static"
JS = (STATIC / "roundtable.js").read_text(encoding="utf-8")
CSS = (STATIC / "style.css").read_text(encoding="utf-8")
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
WIRE = (STATIC / "wire.js").read_text(encoding="utf-8")

FACES = (
    ("chair-wait.jpg", b"\xff\xd8"),
    ("vitalik-wait.jpg", b"\xff\xd8"),
    ("raijin-wait.jpg", b"\xff\xd8"),
    ("oracle-wait.jpg", b"\xff\xd8"),
    ("ares-wait.png", b"\x89PNG"),
    ("ares-chair.png", b"\x89PNG"),
)


class FloorNonglowWaitTests(unittest.TestCase):
    def test_five_wait_faces_are_on_disk(self):
        blobs = {}
        for name, magic in FACES:
            path = STATIC / name
            self.assertTrue(path.is_file(), name)
            data = path.read_bytes()
            blobs[name] = data
            self.assertGreater(len(data), 20000, name)
            self.assertTrue(data.startswith(magic), name)
        unique = [blobs[n] for n, _ in FACES if n != "ares-chair.png"]
        self.assertEqual(len(set(unique)), 5)
        self.assertEqual(blobs["ares-wait.png"], blobs["ares-chair.png"])
        self.assertNotEqual(blobs["raijin-wait.jpg"], blobs["vitalik-wait.jpg"])

    def test_one_wait_face_no_up_down_swap(self):
        self.assertIn('chairPortrait.src = "/chair-wait.jpg"', JS)
        self.assertIn('vitalikPortrait.src = "/vitalik-wait.jpg"', JS)
        self.assertIn('raijinPortrait.src = "/raijin-wait.jpg"', JS)
        self.assertIn('oraclePortrait.src = "/oracle-wait.jpg"', JS)
        self.assertIn('aresPortrait.src = "/static/ares-chair.png"', JS)
        self.assertNotIn('chairPortrait.src = "/chair-up.jpg"', JS)
        self.assertNotIn('vitalikPortrait.src = "/vitalik-up.jpg"', JS)
        self.assertNotIn('raijinPortrait.src = "/raijin-up.jpg"', JS)
        self.assertIn("ONE FACE PER CHAIR", JS)
        self.assertIn("Labels carry UP/DOWN/WAIT/LOCK", JS)

    def test_canvas_eye_tints_do_not_paint(self):
        ares = JS.split("function drawAresEyeTint", 1)[1].split("function raijinEyeColors", 1)[0]
        rai = JS.split("function drawRaijinEyeTint", 1)[1].split("function drawPublicTug", 1)[0]
        self.assertIn("return aresEyeColors(eyes)", ares)
        self.assertIn("return raijinEyeColors(dir)", rai)
        for blob in (ares, rai):
            self.assertNotIn("fill(", blob)
            self.assertNotIn("stroke(", blob)
            self.assertNotIn("globalCompositeOperation", blob)
        paint_a = JS.split("function paintAresEyes", 1)[1].split("function drawAresEyeTint", 1)[0]
        paint_r = JS.split("function paintRaijinEyes", 1)[1].split("function drawRaijinEyeTint", 1)[0]
        self.assertIn("No canvas eye tint", paint_a)
        self.assertIn("No canvas eye tint", paint_r)
        self.assertIn("face.hidden = true", paint_a)
        self.assertIn("overlay.hidden = true", paint_r)

    def test_wait_css_has_no_bloom(self):
        wait_dir = CSS.split(".dir.WAIT", 1)[1].split("}", 1)[0]
        self.assertNotIn("0 0 12px rgba(0, 232, 255", wait_dir)
        self.assertIn("text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85)", wait_dir)
        lock = CSS.split('.chair-why[data-status="LOCK"][data-dir="UP"]', 1)[1].split(".chair-why[data-status=\"WAIT\"]", 1)[0]
        self.assertIn("0 0 12px rgba(57, 255, 20", lock)
        why_wait = CSS.split('.chair-why[data-status="WAIT"]', 1)[1].split("}", 1)[0]
        self.assertNotIn("0 0 12px rgba(0, 232, 255", why_wait)
        self.assertIn("0 1px 8px rgba(0, 0, 0, 0.9)", why_wait)
        maj = CSS.split("body.majority-wait.floor-mode::before", 1)[1].split("}", 1)[0]
        self.assertIn("content: none !important", maj)
        self.assertIn("background: none !important", maj)
        self.assertIn("filter: none !important", maj)
        self.assertIn("if (_hasLock)", JS.split("Lock punch ring only", 1)[1][:200])
        self.assertIn("WAIT CSS bloom is off", WIRE)
        self.assertIn("Lock punch stays", WIRE)

    def test_wire_and_no_regress(self):
        self.assertIn("2026-08-16-floor-nonglow-wait", WIRE)
        self.assertIn("Floor WAIT faces swapped to signed no-glow close-ups", WIRE)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertIn('src="/council-mark.png"', HTML)
        self.assertIn(">STILL</button>", HTML)
        self.assertIn("2026-08-16-kill-crickets", WIRE)
        self.assertIn("2026-08-16-oracle-can-call", WIRE)
        self.assertIn("#passwordGate.password-gate.hidden", CSS)
        hidden = CSS.split("#passwordGate.password-gate.hidden", 1)[1][:280]
        self.assertIn("display: none !important", hidden)
        self.assertNotIn("satoshi-shrine.jpg", JS)
        self.assertNotIn("vitalik-city.jpg", JS)
        self.assertNotIn("ares-stadium.jpg", JS)
        self.assertNotIn("raijin-dallas.jpg", JS)


if __name__ == "__main__":
    unittest.main()
