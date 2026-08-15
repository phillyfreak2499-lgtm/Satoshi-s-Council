"""Floor Chair checkboxes + leftover grow. Lock-only stays. Follower OFF."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
FOLLOWER_BUNDLE = (ROOT / "frontend" / "protected" / "follower_bundle.js").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


def floor_seat_dir_locked(dir_):
    d = str(dir_ or "").upper()
    if not d or d in ("WAIT", "SIT", "—", "-", "EMPTY"):
        return False
    return d in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD")


def floor_locked_agents(agents):
    out = []
    for a in agents or []:
        if not a or not a.get("agent_name") or a.get("agent_name") == "leader" or a.get("sub"):
            continue
        if floor_seat_dir_locked(a.get("direction")):
            out.append(a)
    return out


def _dual_floor_table_r(w, h):
    want = min(w, h) * 0.26
    gap = w * 0.50
    seat_r = 22
    label_pad = 36
    max_r = max(72, (gap - 2 * (seat_r + label_pad) - 20) / (2 * 1.48))
    return min(want, max_r)


def _quad_floor_table_r(w, h):
    want = min(w, h) * 0.18
    gap_x = w * 0.44
    gap_y = h * 0.38
    seat_r = 16
    label_pad = 22
    max_rx = max(56, (gap_x - 2 * (seat_r + label_pad) - 12) / (2 * 1.42))
    max_ry = max(56, (gap_y - 2 * (seat_r + label_pad) - 12) / (2 * 1.42))
    return min(want, max_rx, max_ry)


def _floor_split_table_r(w, h, n):
    if n <= 1:
        want = min(w, h) * 0.32
        seat_r = 22
        label_pad = 36
        max_r = max(72, (min(w, h) - 2 * (seat_r + label_pad) - 24) / (2 * 1.48))
        return min(want, max_r)
    if n == 2:
        return _dual_floor_table_r(w, h)
    if n == 3:
        want = min(w, h) * 0.20
        gap_x = w / 3
        seat_r = 16
        label_pad = 22
        max_rx = max(52, (gap_x - 2 * (seat_r + label_pad) - 12) / (2 * 1.42))
        max_ry = max(52, (h * 0.70 - 2 * (seat_r + label_pad) - 12) / (2 * 1.42))
        return min(want, max_rx, max_ry)
    return _quad_floor_table_r(w, h)


def floor_chair_layout(w, h, keys, phone=False):
    """Mirror of floorChairLayout — leftover grow, straight splits."""
    keys = list(keys or [])
    n = len(keys)
    out = []
    if n <= 0:
        return out
    if phone:
        if n <= 1 or (h / n) < 200:
            out.append({"key": keys[0], "x": w * 0.50, "y": h * 0.50, "r": _floor_split_table_r(w, h, 1), "split": "one"})
            return out
        cell_h = h / n
        cell_r = _floor_split_table_r(w, cell_h, 1)
        split = "half" if n == 2 else ("thirds" if n == 3 else "fourths")
        for i, k in enumerate(keys):
            out.append({"key": k, "x": w * 0.50, "y": cell_h * (i + 0.5), "r": cell_r, "split": split})
        return out
    if n == 1:
        out.append({"key": keys[0], "x": w * 0.50, "y": h * 0.50, "r": _floor_split_table_r(w, h, 1), "split": "one"})
        return out
    if n == 2:
        rr = _floor_split_table_r(w, h, 2)
        out.append({"key": keys[0], "x": w * 0.28, "y": h * 0.50, "r": rr, "split": "half"})
        out.append({"key": keys[1], "x": w * 0.72, "y": h * 0.50, "r": rr, "split": "half"})
        return out
    if n == 3:
        rr = _floor_split_table_r(w, h, 3)
        out.append({"key": keys[0], "x": w * (1 / 6), "y": h * 0.50, "r": rr, "split": "thirds"})
        out.append({"key": keys[1], "x": w * 0.50, "y": h * 0.50, "r": rr, "split": "thirds"})
        out.append({"key": keys[2], "x": w * (5 / 6), "y": h * 0.50, "r": rr, "split": "thirds"})
        return out
    rr = _quad_floor_table_r(w, h)
    slots = {
        "bitcoin": (w * 0.28, h * 0.30),
        "ethereum": (w * 0.72, h * 0.30),
        "front": (w * 0.28, h * 0.72),
        "ats": (w * 0.72, h * 0.72),
    }
    for k in keys:
        if k in slots:
            x, y = slots[k]
            out.append({"key": k, "x": x, "y": y, "r": rr, "split": "fourths"})
    return out


def _chair_box(slot):
    pad = slot["r"] * 1.42 + 16
    return {
        "x": slot["x"] - pad,
        "y": slot["y"] - pad,
        "w": pad * 2,
        "h": pad * 2 + 20,
    }


def _rects_intersect(a, b):
    return (
        a["x"] < b["x"] + b["w"]
        and a["x"] + a["w"] > b["x"]
        and a["y"] < b["y"] + b["h"]
        and a["y"] + a["h"] > b["y"]
    )


class FloorChairToggleMarkupTests(unittest.TestCase):
    def test_toggles_on_floor_not_table(self):
        self.assertIn('id="floorChairToggles"', HTML)
        self.assertIn('data-floor-chair="bitcoin"', HTML)
        self.assertIn('data-floor-chair="ethereum"', HTML)
        self.assertIn('data-floor-chair="ats"', HTML)
        self.assertIn('data-floor-chair="front"', HTML)
        self.assertIn(">SATOSHI</span>", HTML)
        self.assertIn(">VITALIK</span>", HTML)
        self.assertIn(">ARES</span>", HTML)
        self.assertIn(">RAIJIN</span>", HTML)
        self.assertIn("function visibleFloorChairs(", JS)
        self.assertIn("function floorChairLayout(", JS)
        self.assertIn("function setFloorChairOn(", JS)
        self.assertIn("function syncFloorChairToggles(", JS)
        self.assertIn("function wireFloorChairToggles(", JS)
        self.assertIn("leftover grow", JS)
        self.assertIn("Reuse rooms / rings", JS)
        self.assertIn("body.mode-art .floor-chair-toggles", CSS)
        self.assertIn("display: none !important", CSS.split("body.mode-art .floor-chair-toggles", 1)[1][:200])
        self.assertIn("body.mode-floor .floor-chair-toggles:not([hidden])", CSS)
        self.assertIn("body.night-mode #floorChairToggles:not([hidden])", CSS)
        self.assertNotIn('id="floorChairToggles"', HTML.split('id="tabScreensaver"', 1)[1].split('id="settingsView"', 1)[0][:80])

    def test_default_all_on(self):
        self.assertIn("bitcoin: true, ethereum: true, front: true, ats: true", JS)
        checks = HTML.split('id="floorChairToggles"', 1)[1].split("</div>", 1)[0]
        self.assertEqual(checks.count("checked"), 4)


class LeftoverGrowLayoutTests(unittest.TestCase):
    def test_splits_are_one_half_thirds_fourths(self):
        keys4 = ["bitcoin", "ethereum", "front", "ats"]
        w, h = 1280, 700
        one = floor_chair_layout(w, h, ["bitcoin"], phone=False)
        self.assertEqual(len(one), 1)
        self.assertEqual(one[0]["split"], "one")
        self.assertAlmostEqual(one[0]["x"], w * 0.50)
        self.assertAlmostEqual(one[0]["y"], h * 0.50)
        self.assertGreater(one[0]["r"], floor_chair_layout(w, h, keys4)[0]["r"])

        half = floor_chair_layout(w, h, ["bitcoin", "ethereum"], phone=False)
        self.assertEqual(len(half), 2)
        self.assertEqual(half[0]["split"], "half")
        self.assertAlmostEqual(half[0]["x"], w * 0.28)
        self.assertAlmostEqual(half[1]["x"], w * 0.72)
        self.assertAlmostEqual(half[0]["y"], half[1]["y"])
        self.assertAlmostEqual(half[0]["y"], h * 0.50)

        thirds = floor_chair_layout(w, h, ["bitcoin", "ethereum", "ats"], phone=False)
        self.assertEqual(len(thirds), 3)
        self.assertEqual(thirds[0]["split"], "thirds")
        xs = [s["x"] for s in thirds]
        self.assertAlmostEqual(xs[1] - xs[0], xs[2] - xs[1])
        self.assertTrue(all(abs(s["y"] - h * 0.50) < 0.01 for s in thirds))

        fourths = floor_chair_layout(w, h, keys4, phone=False)
        self.assertEqual(len(fourths), 4)
        self.assertEqual(fourths[0]["split"], "fourths")
        by_key = {s["key"]: s for s in fourths}
        self.assertAlmostEqual(by_key["bitcoin"]["x"], w * 0.28)
        self.assertAlmostEqual(by_key["bitcoin"]["y"], h * 0.30)
        self.assertAlmostEqual(by_key["ethereum"]["x"], w * 0.72)
        self.assertAlmostEqual(by_key["ethereum"]["y"], h * 0.30)
        self.assertAlmostEqual(by_key["front"]["x"], w * 0.28)
        self.assertAlmostEqual(by_key["front"]["y"], h * 0.72)
        self.assertAlmostEqual(by_key["ats"]["x"], w * 0.72)
        self.assertAlmostEqual(by_key["ats"]["y"], h * 0.72)

    def test_splits_sit_straight_no_overlap(self):
        w, h = 1280, 700
        for keys in (
            ["bitcoin"],
            ["bitcoin", "ethereum"],
            ["bitcoin", "ethereum", "ats"],
            ["bitcoin", "ethereum", "front", "ats"],
        ):
            slots = floor_chair_layout(w, h, keys, phone=False)
            boxes = [_chair_box(s) for s in slots]
            for i, a in enumerate(boxes):
                for b in boxes[i + 1 :]:
                    self.assertFalse(
                        _rects_intersect(a, b),
                        "overlap %s vs %s for %s" % (slots[i]["key"], keys, keys),
                    )
            ys = [round(s["y"], 2) for s in slots]
            xs = [round(s["x"], 2) for s in slots]
            if len(slots) in (2, 3):
                self.assertEqual(len(set(ys)), 1, "crooked row for %s" % (keys,))
            if len(slots) == 4:
                self.assertEqual(len(set(xs)), 2)
                self.assertEqual(len(set(ys)), 2)

    def test_js_layout_matches_helper(self):
        self.assertIn("function floorChairLayout(", JS)
        self.assertIn("function floorSplitTableR(", JS)
        self.assertIn('split: "one"', JS)
        self.assertIn('split: "half"', JS)
        self.assertIn('split: "thirds"', JS)
        self.assertIn('split: "fourths"', JS)
        self.assertIn("w * 0.28", JS.split("function floorChairLayout", 1)[1][:1800])
        self.assertIn("w * 0.72", JS.split("function floorChairLayout", 1)[1][:1800])
        self.assertIn("h * 0.30", JS.split("function floorChairLayout", 1)[1][:2200])
        self.assertIn("h * 0.72", JS.split("function floorChairLayout", 1)[1][:2200])
        self.assertIn("w * (1 / 6)", JS)
        self.assertIn("w * (5 / 6)", JS)
        draw = JS.split("function drawQuadFloor", 1)[1].split("function drawTableWithBots", 1)[0]
        self.assertIn("visibleFloorChairs()", draw)
        self.assertIn("floorChairLayout(w, h, keys, phone)", draw)
        self.assertIn('drawTableWithBots(w * 0.28, h * 0.30, tableR, "bitcoin"', draw)


class FloorLockOnlyStaysTests(unittest.TestCase):
    def test_floor_lock_only_still_holds(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("hideWait ? floorLockedAgents(roster) : roster", JS)
        self.assertIn("function chairLockIsReal(", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("const floorHideWait = floorLikeMode()", art)
        self.assertIn("order = order.filter(function (n) { return locked[n]; });", art)
        self.assertNotIn("full WAIT roster", JS)
        self.assertNotIn("WAIT roster to fill", JS)
        self.assertTrue(floor_seat_dir_locked("UP"))
        self.assertTrue(floor_seat_dir_locked("DOWN_HOLD"))
        self.assertFalse(floor_seat_dir_locked("WAIT"))
        self.assertEqual(
            [a["agent_name"] for a in floor_locked_agents([
                {"agent_name": "candle", "direction": "WAIT"},
                {"agent_name": "volume", "direction": "UP"},
                {"agent_name": "leader", "direction": "DOWN"},
            ])],
            ["volume"],
        )
        real = JS.split("function chairLockIsReal", 1)[1].split("function lockStampWord", 1)[0]
        self.assertIn('side === "WAIT"', real)
        self.assertIn("return false", real)


class PhoneNoCrushTests(unittest.TestCase):
    def test_phone_stays_one_big_at_390(self):
        keys = ["bitcoin", "ethereum", "front", "ats"]
        phone = floor_chair_layout(390, 390, keys, phone=True)
        self.assertEqual(len(phone), 1)
        self.assertEqual(phone[0]["split"], "one")
        self.assertGreaterEqual(phone[0]["r"], 64)
        box = _chair_box(phone[0])
        self.assertLess(box["x"] + box["w"], 390 + 40)
        self.assertGreater(box["x"], -40)

    def test_phone_stack_when_tall_enough(self):
        half = floor_chair_layout(390, 900, ["bitcoin", "ethereum"], phone=True)
        self.assertEqual(len(half), 2)
        self.assertEqual(half[0]["split"], "half")
        self.assertAlmostEqual(half[0]["x"], half[1]["x"])
        self.assertAlmostEqual(half[0]["x"], 390 * 0.50)
        self.assertFalse(_rects_intersect(_chair_box(half[0]), _chair_box(half[1])))
        self.assertIn("h / n < 200", JS)
        self.assertIn("one big so 390 does not crush", JS)
        self.assertIn("body.phone-floor .floor-chair-toggles:not([hidden])", CSS)
        self.assertIn("flex-wrap: wrap", CSS.split("body.phone-floor .floor-chair-toggles", 1)[1][:400])


class FollowerUntouchedTests(unittest.TestCase):
    def test_follower_untouched(self):
        for blob in (FOLLOWER_PY, FOLLOWER_ROUTE, FOLLOWER_JS, FOLLOWER_BUNDLE):
            self.assertNotIn("floorChairLayout", blob)
            self.assertNotIn("floorChairToggles", blob)
            self.assertNotIn("setFloorChairOn", blob)
            self.assertNotIn("visibleFloorChairs", blob)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT ·", HTML)
        title = HTML.split("<title>", 1)[1].split("</title>", 1)[0]
        self.assertEqual(title, "Satoshi’s Council")
        self.assertNotIn("ZT ·", WIRE_JS.split("2026-08-15-floor-chairs", 1)[1][:400])


class FloorChairWireTests(unittest.TestCase):
    def test_wire_note(self):
        self.assertIn("2026-08-15-floor-chairs", WIRE_JS)
        self.assertIn("Floor Chair checkboxes, leftover grow", WIRE_JS)
        why = WIRE_JS.split("2026-08-15-floor-chairs", 1)[1][:500]
        self.assertIn("one big", why)
        self.assertIn("50/50", why)
        self.assertIn("thirds", why)
        self.assertIn("fourths", why)
        self.assertIn("Follower OFF", why)
        self.assertNotIn("ZT ·", why)


if __name__ == "__main__":
    unittest.main()
