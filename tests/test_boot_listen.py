"""Listen-then-hydrate: /health is up before desk boot. Floor stays lock-only."""
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
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


class LifespanSourceTests(unittest.TestCase):
    def test_listen_then_hydrate_not_hydrate_then_listen(self):
        life = MAIN.split("async def lifespan", 1)[1].split("app = FastAPI", 1)[0]
        self.assertIn("create_task", life)
        self.assertIn("_boot_council", life)
        self.assertIn("HTTP listen ready", life)
        before_yield, after_yield = life.split("yield", 1)
        self.assertNotIn("await council.start()", before_yield)
        self.assertNotIn("hydrate_persisted_desk", before_yield)
        self.assertNotIn("analyze_once", before_yield)
        self.assertIn("create_task(_boot_council()", before_yield)
        self.assertLess(before_yield.find("create_task"), before_yield.find("yield") if "yield" in before_yield else len(before_yield))
        self.assertIn("council.stop()", after_yield)

    def test_boot_helper_owns_hydrate(self):
        boot = MAIN.split("async def _boot_council", 1)[1].split("async def lifespan", 1)[0]
        self.assertIn("await council.start()", boot)
        self.assertIn("HTTP stays up", boot)

    def test_health_warms_without_failing(self):
        health = MAIN.split("async def health", 1)[1].split("@app.get(\"/api/state\")", 1)[0]
        self.assertIn('status = "warming"', health)
        self.assertNotIn("HTTPException", health)
        self.assertNotIn("status_code=503", health)
        self.assertNotIn("status_code=502", health)

    def test_disk_stays_single_instance(self):
        self.assertIn("mountPath: /opt/render/project/src/data", RENDER)
        self.assertIn("sizeGB: 2", RENDER)
        self.assertIn("single-instance swap", RENDER)
        self.assertNotIn("numInstances: 2", RENDER)
        self.assertIn("Keep the disk", RENDER)
        self.assertIn("healthCheckPath: /health", RENDER)
        self.assertIn("workers 1", RENDER)

    def test_wire_boot_entry(self):
        self.assertIn("2026-08-15-boot-listen", WIRE_JS)
        self.assertIn("Boot no longer blocks the port", WIRE_JS)
        self.assertIn("Merges don’t 502 the desk. Why: Zach.", WIRE_JS)


class BootOrderTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_reachable_without_waiting_on_hydrate(self):
        hang = asyncio.Event()
        started = asyncio.Event()

        async def hanging_start():
            started.set()
            await hang.wait()

        from backend import main as m

        with patch.object(m.council, "start", hanging_start), patch.object(
            m.council, "stop", AsyncMock()
        ):
            async with asyncio.timeout(2):
                async with m.lifespan(m.app):
                    await asyncio.sleep(0)
                    self.assertTrue(started.is_set())
                    body = await m.health()
                    self.assertEqual(body["status"], "warming")
                    self.assertFalse(body["running"])
                    from httpx import ASGITransport, AsyncClient

                    transport = ASGITransport(app=m.app)
                    async with AsyncClient(transport=transport, base_url="http://test") as client:
                        r = await client.get("/health")
                    self.assertEqual(r.status_code, 200)
                    self.assertEqual(r.json()["status"], "warming")
            hang.set()

    async def test_health_ok_when_analysis_is_running(self):
        from backend import main as m

        prev = m.council.running
        m.council.running = True
        try:
            body = await m.health()
            self.assertIn(body["status"], ("ok", "degraded"))
            self.assertTrue(body["running"])
        finally:
            m.council.running = prev


class FloorStaysLightTests(unittest.TestCase):
    def test_floor_still_hides_wait_seats(self):
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("onFloor ? [] : roster", JS)
        self.assertIn("Floor is leaders only", JS)
        art = JS.split("function drawArt()", 1)[1]
        self.assertIn("if (floorLikeMode())", art)
        self.assertIn("drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable))", art)
        self.assertNotIn("full WAIT roster", JS)
        self.assertNotIn("WAIT roster to fill", JS)
        self.assertFalse(floor_seat_dir_locked("WAIT"))
        self.assertFalse(floor_seat_dir_locked("SIT"))
        self.assertTrue(floor_seat_dir_locked("UP"))
        self.assertEqual(
            [a["agent_name"] for a in floor_locked_agents([
                {"agent_name": "candle", "direction": "WAIT"},
                {"agent_name": "volume", "direction": "UP"},
                {"agent_name": "leader", "direction": "DOWN"},
            ])],
            ["volume"],
        )

    def test_attract_glow_stays_cheap(self):
        attract = JS.split("function drawFloorAttractGlow", 1)[1].split("function syncSeatSpinBtn", 1)[0]
        self.assertNotIn("createElement", attract)
        self.assertNotIn("particles.push", attract)
        self.assertIn("WAIT Floor attract: motion/glow, not extra bots", JS)


class PaperFollowerUntouchedTests(unittest.TestCase):
    def test_no_follower_or_live_changes(self):
        self.assertNotIn("_boot_council", FOLLOWER_PY)
        self.assertNotIn("_boot_council", FOLLOWER_ROUTE)
        self.assertNotIn("_boot_council", FOLLOWER_JS)
        self.assertIn("paper default · live off", JS)
        self.assertIn("Never auto-bet", JS)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT ·", HTML)
        title = HTML.split("<title>", 1)[1].split("</title>", 1)[0]
        self.assertEqual(title, "Satoshi’s Council")
        self.assertIn("def _strip_public_auto_bet(", MAIN)
        self.assertIn("Never auto-bet", JS)
        self.assertIn("paper default · live off", JS)


if __name__ == "__main__":
    unittest.main()
