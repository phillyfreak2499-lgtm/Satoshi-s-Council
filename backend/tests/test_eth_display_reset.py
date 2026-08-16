"""ETH displayed-slate reset: wipe Vitalik 0–5 / eth_shadow only. 15m BTC hits stay."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.agents.chair_gates import floor_scorecard
from backend.config import settings
from backend.storage.db import (
    ETH_DISPLAY_RESET_AT,
    ETH_DISPLAY_RESET_ID,
    PerformanceStore,
    WindowCall,
)

ROOT = Path(__file__).resolve().parents[2]
DB = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")
COUNCIL = (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8")
ADAPTIVE = (ROOT / "backend" / "learning" / "adaptive.py").read_text(encoding="utf-8")
WIRE = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")

OLD = "2026-08-15T12:00:00+00:00"
NEW = "2026-08-16T14:00:00+00:00"


def _row(
    *,
    ticker: str,
    asset: str,
    correct: int,
    shadow: int = 0,
    when: str = OLD,
    direction: str = "UP",
) -> WindowCall:
    hit = int(correct) == 1
    fifteen = str(ticker).upper().startswith("KXBTC15M")
    return WindowCall(
        ticker=ticker,
        direction=direction,
        confidence=70,
        called_at=when,
        settled_at=when,
        actual_outcome="PATH" if fifteen else ("UP" if (direction == "UP") == hit else "DOWN"),
        y_finish="UP" if (direction == "UP") == hit else "DOWN",
        correct=None if fifteen else (1 if hit else 0),
        settle_reason="path_pnl" if fifteen else ("finish_match" if hit else "finish_miss"),
        paper_stake=0.0 if shadow else 10.0,
        paper_pnl=(12.0 if hit else -10.0) if fifteen else 0.0,
        asset=asset,
        shadow=shadow,
        open_price=48.0,
    )


class EthDisplayResetContractTests(unittest.TestCase):
    def test_soft_mark_not_brain_wipe(self):
        self.assertIn("ETH_DISPLAY_RESET_ID", DB)
        self.assertIn("def ensure_eth_display_reset", DB)
        self.assertIn("eth_display_reset.json", DB)
        self.assertIn("Does not touch council-learning", DB)
        self.assertIn("ensure_eth_display_reset", COUNCIL)
        self.assertIn("council-learning-", ADAPTIVE)
        self.assertNotIn("clear_hit_rate()", COUNCIL.split("ensure_eth_display_reset", 1)[1][:400])
        note = WIRE.split("2026-08-16-eth-slate-ares-oracle-lock", 1)[1].split(
            "2026-08-16-pattern-specialists", 1
        )[0]
        self.assertIn("BTC 5–3 stays", note)
        self.assertIn("eth_shadow", note)
        self.assertIn("Bot memory", note)
        self.assertIn("/oracle-wait.jpg", note)
        self.assertIn("laurel", note)
        self.assertIn("split-light man", note)
        self.assertNotIn("ZT", note)


class EthDisplayResetStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.data = root / "data"
        self.data.mkdir()
        fd, db_path = tempfile.mkstemp(suffix=".db", dir=self.tmp.name)
        os.close(fd)
        self.db_url = f"sqlite+aiosqlite:///{db_path}"
        self.brain = self.data / "council-learning-eth.json"
        self.brain.write_text(
            json.dumps({"weights": {"candle_eth": 0.22, "volume": 0.11}, "updates": 17}),
            encoding="utf-8",
        )
        self.btc_brain = self.data / "council-learning-btc.json"
        self.btc_brain.write_text(
            json.dumps({"weights": {"candle_btc": 0.19}, "updates": 44}),
            encoding="utf-8",
        )
        self.btc15m_brain = self.data / "council-learning-btc15m.json"
        self.btc15m_brain.write_text(
            json.dumps({"weights": {"candle_btc": 0.21}, "updates": 12}),
            encoding="utf-8",
        )
        self._patch = patch.multiple(settings, DATA_DIR=str(self.data), DATABASE_URL=self.db_url)
        self._patch.start()
        self.store = PerformanceStore()
        await self.store.init()

    async def asyncTearDown(self):
        await self.store.close()
        self._patch.stop()
        self.tmp.cleanup()

    async def _seed_slate(self) -> None:
        async with self.store.Session() as session:
            for i in range(5):
                session.add(_row(
                    ticker=f"KXBTC15M-26AUG15{10 + i:02d}00-00",
                    asset="btc",
                    correct=1,
                    when=OLD,
                ))
            for i in range(3):
                session.add(_row(
                    ticker=f"KXBTC15M-26AUG15{20 + i:02d}00-00",
                    asset="btc",
                    correct=0,
                    direction="DOWN",
                    when=OLD,
                ))
            for i in range(5):
                session.add(_row(
                    ticker=f"KXBTCD-26AUG15{10 + i:02d}-T63000.00",
                    asset="btc",
                    correct=1,
                    when=OLD,
                ))
            for i in range(3):
                session.add(_row(
                    ticker=f"KXBTCD-26AUG15{20 + i:02d}-T63000.00",
                    asset="btc",
                    correct=0,
                    direction="DOWN",
                    when=OLD,
                ))
            for i in range(5):
                session.add(_row(
                    ticker=f"KXETHD-26AUG15{10 + i:02d}-T2400.00",
                    asset="eth",
                    correct=0,
                    direction="UP",
                    when=OLD,
                ))
            for i in range(5):
                session.add(_row(
                    ticker=f"KXETHD-26AUG15{30 + i:02d}-T2400.00",
                    asset="eth",
                    correct=1,
                    shadow=1,
                    when=OLD,
                ))
            await session.commit()

    async def test_eth_wipe_leaves_btc_and_brain(self):
        await self._seed_slate()
        before_btc = await self.store.get_accuracy(asset="btc")
        before_eth = await self.store.get_accuracy(asset="eth")
        self.assertEqual(before_btc["correct"], 5)
        self.assertEqual(before_btc["wrong"], 3)
        self.assertEqual(before_eth["correct"], 0)
        self.assertEqual(before_eth["wrong"], 5)
        self.assertEqual((before_eth.get("eth_shadow") or {}).get("n"), 5)
        self.assertEqual((before_eth.get("eth_shadow") or {}).get("hits"), 5)

        out = await self.store.ensure_eth_display_reset()
        self.assertTrue(out["ok"])
        self.assertEqual(out["id"], ETH_DISPLAY_RESET_ID)
        self.assertEqual(out["reset_at"], ETH_DISPLAY_RESET_AT)
        mark = json.loads((self.data / "eth_display_reset.json").read_text(encoding="utf-8"))
        self.assertEqual(mark["id"], ETH_DISPLAY_RESET_ID)
        self.assertFalse(mark.get("follower"))
        self.assertFalse(mark.get("live"))

        btc = await self.store.get_accuracy(asset="btc")
        eth = await self.store.get_accuracy(asset="eth")
        self.assertEqual(btc["correct"], 5)
        self.assertEqual(btc["wrong"], 3)
        self.assertEqual(btc["total"], 8)
        self.assertEqual(eth["correct"], 0)
        self.assertEqual(eth["wrong"], 0)
        self.assertEqual(eth["total"], 0)
        self.assertEqual((eth.get("eth_shadow") or {}).get("n"), 0)
        self.assertEqual((eth.get("eth_shadow") or {}).get("hits"), 0)
        sc = floor_scorecard(btc, eth)
        self.assertEqual(sc["btc_text"], "BTC 5–3")
        self.assertEqual(sc["eth_text"], "0–0 ETH")
        self.assertEqual((sc.get("eth_shadow") or {}).get("correct"), 0)

        again = await self.store.ensure_eth_display_reset()
        self.assertFalse(again["wrote"])
        brain = json.loads(self.brain.read_text(encoding="utf-8"))
        self.assertEqual(brain["updates"], 17)
        self.assertEqual(brain["weights"]["candle_eth"], 0.22)
        btc_brain = json.loads(self.btc_brain.read_text(encoding="utf-8"))
        self.assertEqual(btc_brain["updates"], 44)
        btc15m = json.loads(self.btc15m_brain.read_text(encoding="utf-8"))
        self.assertEqual(btc15m["updates"], 12)
        self.assertEqual(btc15m["weights"]["candle_btc"], 0.21)

    async def test_new_eth_hits_after_mark_still_count(self):
        await self._seed_slate()
        await self.store.ensure_eth_display_reset()
        async with self.store.Session() as session:
            session.add(_row(
                ticker="KXETHD-26AUG1615-T2500.00",
                asset="eth",
                correct=1,
                when=NEW,
            ))
            await session.commit()
        eth = await self.store.get_accuracy(asset="eth")
        self.assertEqual(eth["correct"], 1)
        self.assertEqual(eth["wrong"], 0)
        self.assertEqual(eth["total"], 1)
        btc = await self.store.get_accuracy(asset="btc")
        self.assertEqual(btc["correct"], 5)
        self.assertEqual(btc["wrong"], 3)


if __name__ == "__main__":
    unittest.main()
