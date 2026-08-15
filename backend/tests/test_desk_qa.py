"""Post-merge desk QA: settings JSON routes, gates, Floor 1H dock, paper P&L."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")


class SettingsJsonRouteTests(unittest.TestCase):
    def test_save_and_reset_routes_exist(self):
        for needle in (
            '@app.post("/api/settings")',
            '@app.post("/api/settings/save")',
            '@app.post("/api/settings/reset")',
            "def _apply_settings_body",
            "api_unknown",
        ):
            self.assertIn(needle, MAIN)
        self.assertIn("never index.html", MAIN)

    def test_client_posts_json_save_not_html(self):
        self.assertIn("/api/settings/save", JS)
        self.assertIn("/api/settings/reset", JS)
        self.assertIn("settings route returned HTML, not JSON", JS)
        self.assertIn("Accept: \"application/json\"", JS)
        self.assertIn("applySettingsSnapshot(s, { localToggles: true })", JS)


class GateColdVisitTests(unittest.TestCase):
    def test_html_starts_locked(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotRegex(HTML, r'<body[^>]*admin-unlocked')
        self.assertIn('data-password-protected="true"', HTML)
        self.assertIn('id="passwordGate"', HTML)
        self.assertNotIn('id="passwordGate" class="password-gate hidden"', HTML)
        self.assertIn('id="adminGate"', HTML)
        self.assertIn("Enter access code", HTML)
        self.assertIn("Never start admin-unlocked", HTML)
        self.assertIn('sessionStorage.removeItem("council_admin_unlocked")', HTML)
        self.assertIn('sessionStorage.removeItem("council_auth_ok")', HTML)

    def test_admin_tools_are_not_in_the_live_tree(self):
        live = HTML.split('<template id="adminDeskTemplate">')[0]
        self.assertNotIn('id="adminToolsCard"', live)
        self.assertNotIn("btnClearHitRate", live)
        self.assertIn('id="adminDeskTemplate"', HTML)
        self.assertIn("btnClearHitRate", HTML.split('<template id="adminDeskTemplate">', 1)[1])

    def test_js_requires_desk_code_and_admin_on_cold(self):
        self.assertIn('localStorage.removeItem(passKey)', JS)
        self.assertIn('localStorage.removeItem(ADMIN_KEY)', JS)
        self.assertIn("sessionStorage.removeItem(ADMIN_KEY)", JS)
        self.assertIn("sessionStorage.removeItem(passKey)", JS)
        self.assertIn("sessionStorage.removeItem(DESK_KEY)", JS)
        self.assertIn("sessionStorage.getItem(DESK_KEY)", JS)
        self.assertIn("requestAdminUnlock", JS)
        self.assertIn("if (!hasDeskAuth())", JS)
        self.assertIn("__adminUnlockedThisPage", JS)
        self.assertIn("__deskUnlockedThisPage", JS)
        self.assertIn("leftover unlocked session is not the public default", JS)
        self.assertNotIn("localStorage.setItem(passKey", JS)
        self.assertNotIn("localStorage.setItem(ADMIN_KEY", JS)
        self.assertNotIn("localStorage.getItem(passKey)", JS)


class PaperPnlPrefillTests(unittest.TestCase):
    def test_entry_does_not_hardcode_minus_25(self):
        self.assertNotIn("-$25.00", HTML)
        self.assertNotIn("−$25.00", HTML)
        self.assertRegex(HTML, r'id="pePnl">—</strong>')
        self.assertRegex(HTML, r'id="peReturned"[^>]*value=""')

    def test_preview_waits_for_got_back(self):
        self.assertIn("do not pre-fill a fake", JS)
        self.assertIn('el.textContent = "—";', JS)
        self.assertIn('if (ret) ret.value = "";', JS)
        self.assertIn('autocomplete="off"', HTML)


class FloorOneHDockTests(unittest.TestCase):
    def test_window_led_lives_inside_header_after_tabs(self):
        panel = HTML.find('id="lifetimePanel"')
        led = HTML.find('id="windowLed"')
        main = HTML.find('id="mainTable"')
        self.assertGreater(led, panel)
        self.assertGreater(led, main)
        self.assertEqual(len(re.findall(r'id="windowLed"', HTML)), 1)
        self.assertIn("function dockWindowLed", JS)

    def test_css_docks_floor_in_flow(self):
        self.assertIn("body.floor-mode #app > header #windowLed", CSS)
        self.assertIn("position: relative !important;", CSS)
        self.assertIn("COLD-LOAD GATES", CSS)


class DeskUnlockRevealTests(unittest.TestCase):
    def test_unlock_clears_html_and_body_and_reveals_app(self):
        self.assertIn("function revealAppAfterDeskUnlock", JS)
        unlock = JS.split("function revealAppAfterDeskUnlock", 1)[1].split("\n  function ", 1)[0]
        self.assertIn('document.documentElement.classList.remove("gate-locked", "gate-revealing")', unlock)
        self.assertIn('document.body.classList.remove("gate-locked", "gate-revealing")', unlock)
        self.assertIn('getElementById("passwordGate")', unlock)
        self.assertIn('classList.add("hidden")', unlock)
        self.assertIn('getElementById("app")', unlock)
        self.assertIn('setProperty("visibility", "visible", "important")', unlock)
        self.assertIn("desk-unlocked", unlock)
        auth = JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]
        self.assertIn("revealAppAfterDeskUnlock", auth)
        self.assertNotIn('document.body.classList.add("gate-locked")', auth)
        self.assertIn("html.desk-unlocked #app", CSS)
        self.assertIn("body.desk-unlocked #app", CSS)

    def test_successful_unlock_leaves_app_visible(self):
        """After a successful desk unlock, html/body are unlocked and #app is not hidden."""
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
        self.assertNotEqual(app.style.get("visibility"), "hidden")
        self.assertEqual(app.style.get("visibility"), "visible")

    def test_cold_visit_still_starts_locked(self):
        self.assertIn('document.documentElement.classList.add("gate-locked")', HTML)
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotIn('class="desk-unlocked"', HTML)
        self.assertNotRegex(HTML, r"<html[^>]*desk-unlocked")
        self.assertNotRegex(HTML, r"<body[^>]*desk-unlocked")
        self.assertIn("html.gate-locked #app", CSS)
        self.assertIn("visibility: hidden !important", CSS)


class DeskHydrateAfterUnlockTests(unittest.TestCase):
    def test_unlock_kicks_live_hour_hydrate(self):
        self.assertIn("function applyDeskState", JS)
        self.assertIn("function hydrateLiveHour", JS)
        self.assertIn("function tableHasLiveHour", JS)
        self.assertIn('fetch(`${API_BASE}/api/state`, { cache: "no-store" })', JS)
        reveal = JS.split("function revealAppAfterDeskUnlock", 1)[1].split("\n  function ", 1)[0]
        self.assertIn("hydrateLiveHour", reveal)
        auth = JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]
        self.assertIn("hydrateLiveHour", auth)
        self.assertIn('sessionStorage.removeItem("council_auth_ok")', HTML)
        self.assertIn('id="passwordGate"', HTML)

    def test_apply_fixture_paints_seats_and_1h(self):
        """Unlock then apply a fixture state → seats and 1H appear (empty ETH focus)."""
        seats = [
            {"agent_name": "candle", "direction": "WAIT", "confidence": 40},
            {"agent_name": "news", "direction": "WAIT", "confidence": 38},
            {"agent_name": "exhaust", "direction": "WAIT", "confidence": 36},
            {"agent_name": "quorum", "direction": "WAIT", "confidence": 35},
        ]
        fixture = {
            "decision": {"direction": "WAIT", "summary": "Chair WAIT"},
            "agents": seats,
            "market": {"seconds_left": 660},
            "accuracy": {"correct": 2, "total": 3, "hydrated": True},
            "btc": {
                "agents": seats,
                "market": {"seconds_left": 660},
                "accuracy": {"correct": 2, "total": 3},
            },
            "eth": {"agents": [], "market": {}},
            "dual": True,
        }
        view = _live_hour_view(fixture, "ethereum")
        names = {a["agent_name"] for a in (view.get("agents") or [])}
        self.assertIn("candle", names)
        self.assertIn("news", names)
        self.assertIn("exhaust", names)
        self.assertIn("quorum", names)
        self.assertEqual((view.get("market") or {}).get("seconds_left"), 660)
        secs = int(view["market"]["seconds_left"])
        self.assertEqual("%02d:%02d" % (secs // 60, secs % 60), "11:00")
        self.assertEqual((view.get("accuracy") or {}).get("total"), 3)
        self.assertTrue(_table_has_live_hour(view))


class FloorNameplateOverlapTests(unittest.TestCase):
    def test_fit_helper_keeps_goal_off_seat_names(self):
        self.assertIn("function floorNameplateFit", JS)
        self.assertIn("cover bottom seat names", JS)
        self.assertIn("WICK / WIRE / EXHAUST / QUORUM", JS)
        for w, h in ((1280, 700), (1280, 620), (390, 390), (390, 520)):
            radius, ring_r, lr, seat_r, nameplate_h, phone = _floor_nameplate_fit(w, h)
            plate_bottom = (lr * 0.76 + 8) if phone else (lr + 46 + 14)
            seat_inner = ring_r - seat_r
            self.assertLess(
                plate_bottom,
                seat_inner,
                "GOAL/nameplate covers seats at %sx%s" % (w, h),
            )
            cy = h / 2.0
            label_stack = 28 if phone else 42
            label_bottom = cy + ring_r + seat_r + label_stack
            self.assertLessEqual(
                label_bottom,
                h - 4,
                "outer seat labels clip at %sx%s" % (w, h),
            )

    def test_real_rects_do_not_intersect_at_1280_and_390(self):
        self.assertIn("function floorHudGeometry", JS)
        self.assertIn("window.__floorHudGeometry", JS)
        self.assertIn("dualNameY", JS)
        self.assertIn("FOCUSWICK", JS)
        self.assertIn('view === "art"', JS)
        # Live collisions this pass — not the old WICK/QUORUM watch list.
        table_hits = ("WIRE", "CASCADE")
        floor_hits = ("WIRE", "EXHAUST", "VEL", "CHEAP")
        phone_hits = ("FADE", "ORBIT", "WHALE")
        for w, h in ((1280, 700), (1280, 620)):
            table = _floor_hud_layout(w, h, "art")
            self.assertFalse(table["dual"])
            names = {s["name"] for s in table["seats"]}
            for lab in table_hits:
                self.assertIn(lab, names, "%s missing on Table %sx%s" % (lab, w, h))
            hud = list(table["nameplates"]) + list(table["goals"])
            for plate in hud:
                for seat in table["seats"]:
                    self.assertFalse(
                        _rects_intersect(plate, seat),
                        "Table %s overlaps %s at %sx%s plate=%s seat=%s"
                        % (plate.get("text") or "HUD", seat["name"], w, h, plate, seat),
                    )
            for plate in table["nameplates"]:
                for goal in table["goals"]:
                    self.assertFalse(
                        _rects_intersect(plate, goal),
                        "nameplate sits on GOAL at Table %sx%s plate=%s goal=%s" % (w, h, plate, goal),
                    )
            floor = _floor_hud_layout(w, h, "floor")
            self.assertTrue(floor["dual"])
            fnames = {s["name"] for s in floor["seats"]}
            for lab in floor_hits:
                self.assertIn(lab, fnames, "%s missing on Floor %sx%s" % (lab, w, h))
            satoshi = [p for p in floor["nameplates"] if "SATOSHI" in str(p.get("text") or "")]
            self.assertTrue(satoshi)
            raijin = [p for p in floor["nameplates"] if "RAIJIN" in str(p.get("text") or "")]
            self.assertTrue(raijin, "Raijin chair missing on Floor %sx%s" % (w, h))
            ares = [p for p in floor["nameplates"] if "ARES" in str(p.get("text") or "")]
            self.assertTrue(ares, "Ares fourth chair missing on Floor %sx%s" % (w, h))
            vitalik = [p for p in floor["nameplates"] if "VITALIK" in str(p.get("text") or "")]
            for plate in raijin:
                for other in satoshi + vitalik:
                    self.assertFalse(
                        _rects_intersect(plate, other),
                        "RAIJIN covers %s at Floor %sx%s" % (other.get("text"), w, h),
                    )
            cluster = [s for s in floor["seats"] if s["name"] in floor_hits]
            for i, a in enumerate(cluster):
                for b in cluster[i + 1 :]:
                    if a.get("table") != b.get("table"):
                        continue
                    self.assertFalse(
                        _rects_intersect(a, b),
                        "Floor %s overlaps %s at %sx%s a=%s b=%s" % (a["name"], b["name"], w, h, a, b),
                    )
                for plate in satoshi:
                    if a.get("table") and plate.get("table") and a["table"] != plate["table"]:
                        continue
                    self.assertFalse(
                        _rects_intersect(plate, a),
                        "SATOSHI · BTC overlaps %s at Floor %sx%s plate=%s seat=%s"
                        % (a["name"], w, h, plate, a),
                    )
        for w, h in ((390, 390), (390, 520)):
            phone = _floor_hud_layout(w, h, "floor")
            names = {s["name"] for s in phone["seats"]}
            for lab in phone_hits:
                self.assertIn(lab, names, "%s missing on phone %sx%s" % (lab, w, h))
            for plate in list(phone["nameplates"]) + list(phone["goals"]):
                for seat in phone["seats"]:
                    self.assertFalse(
                        _rects_intersect(plate, seat),
                        "phone %s overlaps %s at %sx%s plate=%s seat=%s"
                        % (plate.get("text") or "HUD", seat["name"], w, h, plate, seat),
                    )

    def test_dual_tables_do_not_crush_at_1042(self):
        self.assertIn("function dualFloorTableR", JS)
        self.assertIn("function floorRaijinFit", JS)
        self.assertIn("do not crush at 1042", JS)
        self.assertIn('drawTableWithBots(w * 0.28, h * 0.30, tableR, "bitcoin"', JS)
        self.assertIn('drawTableWithBots(w * 0.72, h * 0.30, tableR, "ethereum"', JS)
        self.assertIn('drawTableWithBots(w * 0.28, h * 0.72, tableR, "front"', JS)
        self.assertIn('drawTableWithBots(w * 0.72, h * 0.72, tableR, "ats"', JS)
        for w, h in ((1042, 700), (1042, 800), (1042, 620), (1280, 700)):
            layout = _floor_hud_layout(w, h)
            self.assertTrue(layout["dual"], "ETH stays Satoshi/Vitalik dual at %sx%s" % (w, h))
            btc = [s for s in layout["seats"] if s.get("table") == "btc"]
            eth = [s for s in layout["seats"] if s.get("table") == "eth"]
            self.assertTrue(btc and eth, "both councils missing at %sx%s" % (w, h))
            for a in btc:
                for b in eth:
                    self.assertFalse(
                        _rects_intersect(a, b),
                        "1042 crush: %s/%s overlaps %s/%s at %sx%s a=%s b=%s"
                        % (a["table"], a["name"], b["table"], b["name"], w, h, a, b),
                    )
            hud = list(layout["nameplates"]) + list(layout["goals"])
            for plate in hud:
                for seat in layout["seats"]:
                    self.assertFalse(
                        _rects_intersect(plate, seat),
                        "%s overlaps %s at %sx%s" % (plate.get("text") or "HUD", seat["name"], w, h),
                    )


class SatoshiChairEmblemTests(unittest.TestCase):
    def test_chair_art_may_keep_zt_crest(self):
        js = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
        html = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("function coverSatoshiEmblem", js)
        self.assertNotIn("gold ZT chest emblem", js)
        self.assertIn('"/chair-up.jpg"', js)
        self.assertIn('"/chair-down.jpg"', js)
        self.assertIn('"/chair-wait.jpg"', js)
        for name in ("chair-up.jpg", "chair-down.jpg", "chair-wait.jpg"):
            self.assertTrue((ROOT / "frontend" / "static" / name).is_file(), name)
        self.assertIn("Satoshi’s Council", html)
        self.assertIn('src="/council-mark.png"', html)
        self.assertNotIn("ZT ·", js)
        self.assertNotIn("ZT ·", html)


class FloorTableChromeOverlapTests(unittest.TestCase):
    def test_table_chip_misses_wordmark_and_focus(self):
        self.assertIn("function floorChromeFit", JS)
        self.assertIn("--floor-table-rail: 96px", CSS)
        self.assertIn("SATOSHI’S COUNCIL (1280) or ETH/BTC focus (390)", CSS)
        self.assertIn("Mid-width (~1040)", JS)
        self.assertIn("max-width: 1180px", CSS)
        self.assertIn('id="floorExitBtn"', HTML)
        self.assertIn('class="floor-exit-btn"', HTML)
        self.assertIn("TABLE", HTML.split('id="floorExitBtn"', 1)[1][:80])
        wired = JS.split("floorExit.__wired", 1)[1][:300]
        self.assertIn('setMode("art")', wired)
        for w in (1280, 1042, 1040, 390):
            fit = _floor_chrome_fit(w)
            self.assertFalse(
                _rects_intersect(fit["table"], fit["logo"]),
                "TABLE overlaps wordmark at %s" % w,
            )
            self.assertFalse(
                _rects_intersect(fit["table"], fit["focus"]),
                "TABLE overlaps ETH/BTC at %s" % w,
            )
            chips = [fit["logo"], fit["rivalry"], fit["huddle"], fit["hit"]]
            labels = ("wordmark", "PAPER/BOOKS", "HUDDLE", "HIT RATE")
            for i, a in enumerate(chips):
                for j, b in enumerate(chips):
                    if j <= i:
                        continue
                    self.assertFalse(
                        _rects_intersect(a, b),
                        "%s overlaps %s at %s a=%s b=%s" % (labels[i], labels[j], w, a, b),
                    )


class _FakeClassList:
    def __init__(self, start):
        self._s = set(start)

    def add(self, *names):
        self._s.update(names)

    def remove(self, *names):
        self._s.difference_update(names)

    def contains(self, name):
        return name in self._s


class _FakeEl:
    def __init__(self, classes):
        self.classList = _FakeClassList(classes)
        self.style = _FakeStyle()
        self.attrs = {}

    def setAttribute(self, k, v):
        self.attrs[k] = v


class _FakeStyle:
    def __init__(self):
        self._p = {}

    def setProperty(self, name, value, _priority=None):
        self._p[name] = value

    def get(self, name):
        return self._p.get(name)


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


def _table_has_live_hour(t):
    if not t or not isinstance(t, dict):
        return False
    agents = t.get("agents") or []
    has_seats = any(a and a.get("agent_name") and a.get("agent_name") != "leader" for a in agents)
    m = t.get("market") or {}
    has_window = (
        m.get("seconds_left") is not None
        or m.get("time_remaining") is not None
        or m.get("close_time")
        or m.get("mins_left") is not None
    )
    return bool(has_seats or has_window)


def _live_hour_view(state, focus="ethereum"):
    focused = state.get("eth") if focus == "ethereum" else state.get("btc")
    other = state.get("btc") if focus == "ethereum" else state.get("eth")
    if _table_has_live_hour(focused):
        live = focused
    elif _table_has_live_hour(state):
        live = state
    elif _table_has_live_hour(other):
        live = other
    else:
        live = focused or state
    return {
        "agents": live.get("agents") or state.get("agents") or [],
        "market": live.get("market") or state.get("market") or {},
        "accuracy": live.get("accuracy") or state.get("accuracy") or {},
        "decision": live.get("decision") or state.get("decision") or {},
    }


def _rects_intersect(a, b):
    if not a or not b or a["w"] <= 0 or a["h"] <= 0 or b["w"] <= 0 or b["h"] <= 0:
        return False
    return (
        a["x"] < b["x"] + b["w"]
        and a["x"] + a["w"] > b["x"]
        and a["y"] < b["y"] + b["h"]
        and a["y"] + a["h"] > b["y"]
    )


def _floor_chrome_fit(w):
    phone = w <= 480
    mid = (not phone) and w <= 1180
    table = {"x": 10, "y": 10, "w": 88, "h": 44}
    rail = 96
    header_pad = 14
    logo = (
        {"x": 0, "y": 0, "w": 0, "h": 0}
        if phone
        else {"x": header_pad + rail, "y": 8, "w": 200 if mid else 280, "h": 36}
    )
    focus = (
        {"x": header_pad + rail, "y": 10, "w": 220, "h": 44}
        if phone
        else {"x": header_pad + rail, "y": 52, "w": 220, "h": 28}
    )
    rival_w = 280 if mid else 320
    if phone:
        rivalry = {"x": 0, "y": 0, "w": 0, "h": 0}
    elif mid:
        rivalry = {"x": w / 2 - rival_w / 2, "y": 58, "w": rival_w, "h": 36}
    else:
        rivalry = {"x": w / 2 - rival_w / 2, "y": 10, "w": rival_w, "h": 32}
    huddle_w = 72 if mid else 88
    hit_w = 70 if mid else 120
    if phone:
        huddle = {"x": 0, "y": 0, "w": 0, "h": 0}
        hit = {"x": 0, "y": 0, "w": 0, "h": 0}
    else:
        huddle = {
            "x": w - 16 - hit_w - 8 - huddle_w - (36 if mid else 72),
            "y": 8,
            "w": huddle_w,
            "h": 28,
        }
        hit = {"x": w - 16 - hit_w, "y": 8, "w": hit_w, "h": 28}
    return {
        "table": table,
        "logo": logo,
        "focus": focus,
        "rivalry": rivalry,
        "huddle": huddle,
        "hit": hit,
        "phone": phone,
        "mid": mid,
        "rail": rail,
    }


def _floor_nameplate_fit(w, h):
    short = min(w, h)
    phone = w <= 420 or short <= 520
    seat_r = 18 if phone else 24
    label_stack = 28 if phone else 42
    edge_pad = 6 if phone else 10
    nameplate_h = 22 if phone else 36
    ring_mul = 1.15
    want_radius = short * 0.40
    max_ring = short * 0.5 - seat_r - label_stack - edge_pad
    radius = max(64, min(want_radius, max_ring / ring_mul))
    ring_r = radius * ring_mul
    want_lr = short * 0.22
    max_lr = max(40, ring_r - seat_r - nameplate_h - 10)
    lr_base = min(want_lr, max_lr)
    return radius, ring_r, lr_base, seat_r, nameplate_h, phone


_SEAT_LABELS = (
    "WICK", "PULSE", "DRIFT", "TAPE", "CARRY", "ORBIT", "VOLT", "CHAIN",
    "STREAK", "ODDS", "STRIKE", "CLOCK", "WHALE", "QUORUM", "FADE", "CHEAP",
    "VEL", "WIRE", "CASCADE", "EXHAUST", "WARDEN",
)


def _text_w(s, px):
    return max(8, round(len(str(s)) * px * 0.62))


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


def _floor_raijin_fit(w, h):
    phone = w <= 480 or min(w, h) <= 520
    dual = (not phone) and w >= 720
    if not dual:
        return None
    r = _dual_floor_table_r(w, h)
    mid = (not phone) and w <= 1180
    chrome_bottom = 96 if mid else 48
    photo_r = max(18, min(r * 0.20, 24))
    seat_r = photo_r * 1.26
    ring_top = h * 0.52 - r * 1.48
    y = max(chrome_bottom + seat_r + 4, min(ring_top - seat_r - 8, chrome_bottom + seat_r + 8))
    return {"x": w * 0.50, "y": y, "photoR": photo_r, "seatR": seat_r}


def _floor_hud_layout(w, h, view="floor"):
    """Mirrors floorHudGeometry — real AABBs, not a radial-only fit."""
    import math

    phone = w <= 480 or min(w, h) <= 520
    dual = view != "art" and (not phone) and w >= 720
    nameplates = []
    goals = []
    seats = []

    def add_seats(cx, cy, ring_r, seat_r, name_off, font_px, side=""):
        n = len(_SEAT_LABELS)
        for i, lab in enumerate(_SEAT_LABELS):
            ang = -math.pi / 2 + (i / n) * math.pi * 2
            sx = cx + math.cos(ang) * ring_r
            sy = cy + math.sin(ang) * ring_r
            lw = _text_w(lab, font_px)
            lx = sx + math.cos(ang) * (seat_r + name_off)
            ly = sy + math.sin(ang) * (seat_r + name_off)
            seats.append(
                {
                    "x": lx - lw / 2,
                    "y": ly - font_px / 2,
                    "w": lw,
                    "h": font_px + 4,
                    "name": lab,
                    "table": side,
                }
            )

    if dual:
        r = _quad_floor_table_r(w, h)
        pr = r * 0.80
        for cx, cy, text, side in (
            (w * 0.28, h * 0.30, "SATOSHI · BTC", "btc"),
            (w * 0.72, h * 0.30, "VITALIK · ETH", "eth"),
            (w * 0.28, h * 0.72, "RAIJIN", "front"),
            (w * 0.72, h * 0.72, "ARES", "ats"),
        ):
            name_y = cy - 2 + pr + 11
            nw = _text_w(text, 11)
            nameplates.append({"x": cx - nw / 2, "y": name_y - 11, "w": nw, "h": 14, "text": text, "table": side})
            if side in ("btc", "eth"):
                add_seats(cx, cy, r * 1.42, 16, 6, 8, side)
    elif view == "art" and not phone:
        radius = min(w, h) * 0.32
        ring_r = radius * 1.18
        lr = min(w, h) * 0.24
        cx, cy = w / 2.0, h / 2.0
        gw = 200
        plate_y = cy + lr * 0.90
        goals.append(
            {
                "x": cx - gw / 2,
                "y": plate_y - 14,
                "w": gw,
                "h": 28,
                "text": "GOAL · one guess @ best odds (10–90¢)",
            }
        )
        nw = _text_w("SATOSHI", 11)
        nameplates.append({"x": cx - nw / 2, "y": cy + lr * 0.52 - 7, "w": nw, "h": 14, "text": "SATOSHI"})
        add_seats(cx, cy, ring_r, 20, 12, 11)
    else:
        radius, ring_r, lr, seat_r, _nh, is_phone = _floor_nameplate_fit(w, h)
        cx, cy = w / 2.0, h / 2.0
        if is_phone:
            goals.append(
                {
                    "x": 8,
                    "y": 27,
                    "w": 120,
                    "h": 18,
                    "text": "GOAL · one guess @ best odds (10–90¢)",
                }
            )
            nw = _text_w("SATOSHI", 10)
            nameplates.append({"x": cx - nw / 2, "y": cy + lr * 0.50 - 8, "w": nw, "h": 12, "text": "SATOSHI"})
        else:
            gw = 200
            plate_y = cy + lr * 0.90
            goals.append(
                {
                    "x": cx - gw / 2,
                    "y": plate_y - 14,
                    "w": gw,
                    "h": 28,
                    "text": "GOAL · one guess @ best odds (10–90¢)",
                }
            )
            nw = _text_w("SATOSHI", 10)
            nameplates.append({"x": cx - nw / 2, "y": cy + lr * 0.52 - 8, "w": nw, "h": 12, "text": "SATOSHI"})
        add_seats(cx, cy, ring_r, seat_r, 8 if is_phone else 12, 9 if is_phone else 11)
    return {"phone": phone, "dual": dual, "view": view, "nameplates": nameplates, "goals": goals, "seats": seats}


class PacksNotDroppedTests(unittest.TestCase):
    def test_official_closer_still_present(self):
        gates = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
        self.assertIn("def official_y_finish", gates)
        self.assertIn("def decide_open_lock_grade", gates)
        self.assertIn("KNOWN_OFFICIAL_FINISH", gates)
        self.assertIn("KXBTCD-26AUG1415-T62999.99", gates)
        council = (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8")
        self.assertIn("learn_from_settled", council)
        self.assertIn("def collect_official_results", gates)
        self.assertIn("def kalshi_market_finalized", gates)
        self.assertIn("def event_ticker_from_kalshi_ticker", gates)
        self.assertIn("def tape_backfill_stats", gates)
        self.assertIn("def lock_time_strike", gates)
        db = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")
        self.assertIn("lock_time_strike", db)
        self.assertIn("def record_eth_shadow_pick", db)
        self.assertIn("def record_btc_shadow_pick", db)
        self.assertIn("reliability_n", db)
        self.assertIn("Never current_price vs strike", db)
        self.assertIn("every OPEN paper hour", council)
        self.assertIn("def _maybe_record_eth_shadow", council)
        self.assertIn("def _maybe_record_btc_shadow", council)
        self.assertIn("reliability_n", council)
        self.assertNotIn("tickers[:40]", council)
        self.assertIn("get_event", (ROOT / "backend" / "data" / "kalshi.py").read_text(encoding="utf-8"))
        self.assertIn("max_learn=2000", council)
        self.assertIn("def decide_open_wait_grade", gates)
        self.assertIn("def classify_wait_reason", gates)
        self.assertIn("def record_wait_sample", db)
        self.assertIn("learn_from_wait", council)
        self.assertIn("_maybe_record_wait_sample", council)

    def test_hit_rate_spot_pack_keep_list(self):
        gates = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
        for needle in (
            "def dead_book_reason",
            "def early_lock_blocked",
            "def late_spot_decisive",
            "def estimate_p_finish",
            "def eth_fades_btc_impulse",
            "def hot_chair_bin_faded",
            "def is_actually_settled",
            "def leftover_after_vig",
            "def zach_bar_reason",
            "def zach_band_skips_preferred",
            "def never_lock_near_certain",
            "def stuck_hours_open",
            "def lifetime_n_for_zach",
            "def eth_paper_lock_blocked",
            "def paper_stake_for_lock",
            "def eth_shadow_pick",
            "def btc_shadow_pick",
            "def is_eth_shadow_row",
            "def is_btc_shadow_row",
            "def floor_scorecard",
            "def book_is_unknown",
            "def explore_paper_lock_open",
            "def explore_paper_lock_ok",
        ):
            self.assertIn(needle, gates)
        leader = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
        self.assertIn("yes_ask", leader)
        self.assertIn("lock_force_allowed", leader)
        self.assertIn("60s CFB avg", leader)
        bn = (ROOT / "backend" / "data" / "binance.py").read_text(encoding="utf-8")
        self.assertIn("data-api.binance.vision", bn)
        self.assertIn("separate book", bn)
        cfb = (ROOT / "backend" / "data" / "cfbenchmarks.py").read_text(encoding="utf-8")
        self.assertIn("BRTI", cfb)
        self.assertIn("ETHUSD_RTI", cfb)
        self.assertIn("/cfbenchmarks", cfb)
        kalshi = (ROOT / "backend" / "data" / "kalshi.py").read_text(encoding="utf-8")
        self.assertIn("get_cfbenchmarks_values", kalshi)
        fund = (ROOT / "backend" / "agents" / "funding.py").read_text(encoding="utf-8")
        self.assertIn('"lock_force": False', fund)
        self.assertIn("8h", fund)
        liq = (ROOT / "backend" / "agents" / "liq.py").read_text(encoding="utf-8")
        self.assertIn("not_p_finish", liq)
        cfg = (ROOT / "backend" / "config.py").read_text(encoding="utf-8")
        self.assertIn("PLAYABLE_MID_MIN: float = 10.0", cfg)
        self.assertIn("PLAYABLE_MID_MAX: float = 90.0", cfg)
        self.assertIn("ETH_RELIABILITY_MIN_N", cfg)
        self.assertIn("Do NOT shrink the hard band to 45–55", cfg)
        gate = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
        self.assertIn("empty_lifetime", gate)
        self.assertIn("lifetime_n", (ROOT / "backend" / "main.py").read_text(encoding="utf-8"))

    def test_floor_scorecard_reuses_rivalry_strip(self):
        live = HTML.split('<template id="adminDeskTemplate">')[0]
        strip = live.split('id="rivalryStrip"', 1)[1].split('id="hourSlam"', 1)[0]
        self.assertIn('id="rivalryStrip"', live)
        self.assertIn('id="rivalBtc"', live)
        self.assertIn('id="rivalEth"', live)
        self.assertIn('id="rivalLead"', live)
        self.assertIn("PAPER", strip)
        self.assertIn("BOOKS", strip)
        self.assertIn("BTC 0–0", strip)
        self.assertIn("0–0 ETH", strip)
        self.assertIn("BTC 0 · ETH 0", strip)
        self.assertNotIn("LEADS", strip)
        self.assertNotIn("SATOSHI", strip)
        self.assertNotIn("VITALIK", strip)
        self.assertNotIn("Satoshi", strip)
        self.assertNotIn("Vitalik", strip)
        self.assertNotIn("leader vs", strip.lower())
        self.assertNotIn("Chair vs", strip)
        self.assertNotIn("btnClearHitRate", live)
        self.assertNotIn("Reset Floor scorecard", live)
        admin = HTML.split('<template id="adminDeskTemplate">', 1)[1]
        self.assertIn("Clear Hit Rate", admin)
        self.assertIn("Scorecard", admin)
        card = JS.split("function scorecardFromState", 1)[1].split("function containPortrait", 1)[0]
        self.assertIn("function updateRivalryStrip", JS)
        self.assertIn("eth_shadow", card)
        self.assertIn('"BTC " + btc.c + " · ETH "', card)
        self.assertNotIn("LEADS", card)
        self.assertNotIn("SATOSHI", card)
        self.assertNotIn("VITALIK", card)
        self.assertNotIn("Satoshi", card)
        self.assertNotIn("Vitalik", card)
        self.assertNotIn("ZT", strip)
        dual = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
        self.assertIn("floor_scorecard", dual)
        self.assertIn("scorecard", (ROOT / "backend" / "main.py").read_text(encoding="utf-8"))

    def test_follower_stays_off_public_surface(self):
        for needle in ("tabFollower", "FOLLOWER_PASSWORD", "/api/follower/unlock", "/api/follower/order"):
            self.assertNotIn(needle, HTML)
            self.assertNotIn(needle, JS)

    def test_charts_wall_has_eth_canvas(self):
        self.assertIn('id="chartEth"', HTML)
        self.assertIn("function drawChartEth()", JS)
        self.assertIn('p => p.down, "#ff2d55"', JS)

    def test_table_feed_and_pulse_present(self):
        self.assertIn("function markSeatTick", JS)
        self.assertIn('id="signalChairLast"', HTML)
        self.assertIn("const pr = radius * 0.80", JS)

    def test_dashboard_follows_eth_focus(self):
        self.assertIn("const focusName = chairTitleOf(focusTable)", JS)
        self.assertIn("dash-focus-banner", JS)
        self.assertIn("state.btc && state.eth", JS)

    def test_ranks_empty_does_not_grid_wrap(self):
        self.assertIn('class="rank-empty">No rank data yet.', JS)
        self.assertIn(".rank-empty", CSS)

    def test_floor_header_stays_up_for_1h(self):
        self.assertIn("html body.floor-mode #app > header", CSS)
        self.assertIn("position: static !important;", CSS)
        self.assertNotIn("top: 40px", CSS)

    def test_kalshi_backs_off_on_502(self):
        kalshi = (ROOT / "backend" / "data" / "kalshi.py").read_text(encoding="utf-8")
        self.assertIn("_BACKOFF_S", kalshi)
        self.assertIn("kalshi_backoff", kalshi)
        self.assertIn("502", kalshi)
        self.assertNotIn("logger.exception", (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
