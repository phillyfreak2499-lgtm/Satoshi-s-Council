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
        hits_1280 = ("WICK", "CASCADE", "CARRY", "ODDS", "STREAK")
        hits_390 = ("QUORUM", "WICK", "EXHAUST", "CLOCK", "WARDEN", "DRIFT")
        for w, h, watch in ((1280, 700, hits_1280), (1280, 620, hits_1280), (390, 390, hits_390), (390, 520, hits_390)):
            layout = _floor_hud_layout(w, h)
            hud = list(layout["nameplates"]) + list(layout["goals"])
            names = {s["name"] for s in layout["seats"]}
            for lab in watch:
                self.assertIn(lab, names, "%s missing at %sx%s" % (lab, w, h))
            for plate in hud:
                for seat in layout["seats"]:
                    self.assertFalse(
                        _rects_intersect(plate, seat),
                        "%s overlaps %s at %sx%s plate=%s seat=%s"
                        % (plate.get("text") or "HUD", seat["name"], w, h, plate, seat),
                    )

    def test_dual_tables_do_not_crush_at_1042(self):
        self.assertIn("function dualFloorTableR", JS)
        self.assertIn("do not crush at 1042", JS)
        self.assertIn('drawTableWithBots(w * 0.25, h * 0.52, tableR, "bitcoin"', JS)
        self.assertIn('drawTableWithBots(w * 0.75, h * 0.52, tableR, "ethereum"', JS)
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
    def test_cover_satoshi_emblem_hides_zt_on_chair_art(self):
        js = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
        html = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn("function coverSatoshiEmblem(cx, cy, r)", js)
        self.assertIn("gold ZT chest emblem", js)
        self.assertIn("coverSatoshiEmblem(cx, portraitY, pr)", js)
        self.assertIn("coverSatoshiEmblem(cx, cy, lr)", js)
        self.assertIn("coverSatoshiEmblem(cx, cy - 4, pr)", js)
        self.assertIn('"/chair-up.jpg"', js)
        self.assertIn('"/chair-down.jpg"', js)
        self.assertIn('"/chair-wait.jpg"', js)
        for name in ("chair-up.jpg", "chair-down.jpg", "chair-wait.jpg"):
            self.assertTrue((ROOT / "frontend" / "static" / name).is_file(), name)
        self.assertIn("Satoshi’s Council", html)
        self.assertNotIn("ZT ·", js)
        self.assertNotIn("ZT ·", html)

    def test_satoshi_chair_jpgs_have_no_gold_zt_on_chest(self):
        from PIL import Image

        def is_emblem(p):
            r, g, b = p[:3]
            if r > 140 and g > 95 and b < 100 and r > b + 50:
                return True
            if g > 100 and g > r + 30 and g > b + 15 and r < 150:
                return True
            return False

        for name in ("chair-up.jpg", "chair-down.jpg", "chair-wait.jpg"):
            im = Image.open(ROOT / "frontend" / "static" / name).convert("RGB")
            w, h = im.size
            gold = 0
            for y in range(int(h * 0.68), int(h * 0.90)):
                for x in range(int(w * 0.38), int(w * 0.62)):
                    if is_emblem(im.getpixel((x, y))):
                        gold += 1
            self.assertLess(gold, 80, "%s still has gold/ZT chest pixels (%s)" % (name, gold))


class FloorTableChromeOverlapTests(unittest.TestCase):
    def test_table_chip_misses_wordmark_and_focus(self):
        self.assertIn("function floorChromeFit", JS)
        self.assertIn("--floor-table-rail: 96px", CSS)
        self.assertIn("SATOSHI’S COUNCIL (1280) or ETH/BTC focus (390)", CSS)
        self.assertIn('id="floorExitBtn"', HTML)
        self.assertIn('class="floor-exit-btn"', HTML)
        self.assertIn("TABLE", HTML.split('id="floorExitBtn"', 1)[1][:80])
        wired = JS.split("floorExit.__wired", 1)[1][:300]
        self.assertIn('setMode("art")', wired)
        for w in (1280, 390):
            fit = _floor_chrome_fit(w)
            self.assertFalse(
                _rects_intersect(fit["table"], fit["logo"]),
                "TABLE overlaps wordmark at %s" % w,
            )
            self.assertFalse(
                _rects_intersect(fit["table"], fit["focus"]),
                "TABLE overlaps ETH/BTC at %s" % w,
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
    table = {"x": 10, "y": 10, "w": 88, "h": 44}
    rail = 96
    header_pad = 14
    logo = (
        {"x": 0, "y": 0, "w": 0, "h": 0}
        if phone
        else {"x": header_pad + rail, "y": 8, "w": 280, "h": 36}
    )
    focus = (
        {"x": header_pad + rail, "y": 10, "w": 220, "h": 44}
        if phone
        else {"x": header_pad + rail, "y": 52, "w": 220, "h": 28}
    )
    return {"table": table, "logo": logo, "focus": focus, "phone": phone, "rail": rail}


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


def _floor_hud_layout(w, h):
    """Mirrors floorHudGeometry — real AABBs, not a radial-only fit."""
    import math

    phone = w <= 480 or min(w, h) <= 520
    dual = (not phone) and w >= 720
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
            ly = sy + seat_r + name_off
            seats.append(
                {
                    "x": sx - lw / 2,
                    "y": ly - font_px,
                    "w": lw,
                    "h": font_px + 4,
                    "name": lab,
                    "table": side,
                }
            )

    if dual:
        r = _dual_floor_table_r(w, h)
        pr = r * 0.80
        cy = h * 0.52
        portrait_y = cy - 2
        name_y = portrait_y + pr + 11
        for cx, text, side in (
            (w * 0.25, "SATOSHI · BTC · FOCUS", "btc"),
            (w * 0.75, "VITALIK · ETH", "eth"),
        ):
            nw = _text_w(text, 11)
            nameplates.append({"x": cx - nw / 2, "y": name_y - 11, "w": nw, "h": 14, "text": text, "table": side})
            add_seats(cx, cy, r * 1.48, 22, 12, 10, side)
    else:
        radius, ring_r, lr, seat_r, _nh, is_phone = _floor_nameplate_fit(w, h)
        cx, cy = w / 2.0, h / 2.0
        if is_phone:
            gw = min(w - 118, 260)
            goals.append(
                {
                    "x": 108,
                    "y": 8,
                    "w": gw,
                    "h": 22,
                    "text": "GOAL · one guess @ best odds (<80%)",
                }
            )
            nw = _text_w("SATOSHI", 10)
            nameplates.append({"x": cx - nw / 2, "y": cy + lr * 0.50 - 8, "w": nw, "h": 12, "text": "SATOSHI"})
        else:
            gw = 200
            plate_y = cy + lr + 46
            goals.append(
                {
                    "x": cx - gw / 2,
                    "y": plate_y - 14,
                    "w": gw,
                    "h": 28,
                    "text": "GOAL · one guess @ best odds (<80%)",
                }
            )
            nw = _text_w("SATOSHI", 10)
            nameplates.append({"x": cx - nw / 2, "y": cy + lr + 10 - 8, "w": nw, "h": 12, "text": "SATOSHI"})
        add_seats(cx, cy, ring_r, seat_r, 14 if is_phone else 18, 9 if is_phone else 11)
    return {"phone": phone, "dual": dual, "nameplates": nameplates, "goals": goals, "seats": seats}


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
        self.assertIn("reliability_n", db)
        self.assertIn("Never current_price vs strike", db)
        self.assertIn("every OPEN paper hour", council)
        self.assertIn("def _maybe_record_eth_shadow", council)
        self.assertIn("reliability_n", council)
        self.assertNotIn("tickers[:40]", council)
        self.assertIn("get_event", (ROOT / "backend" / "data" / "kalshi.py").read_text(encoding="utf-8"))
        self.assertIn("max_learn=2000", council)

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
            "def is_eth_shadow_row",
            "def floor_scorecard",
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
        self.assertIn("PLAYABLE_MID_MIN: float = 20.0", cfg)
        self.assertIn("PLAYABLE_MID_MAX: float = 80.0", cfg)
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
