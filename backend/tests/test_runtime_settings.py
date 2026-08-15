import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import runtime_settings as rs_mod
from backend.services.runtime_settings import DEFAULTS, RuntimeSettings


class RuntimeSettingsResetTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._path = Path(self._tmp.name) / "system-settings.json"
        self._path.write_text("{}", encoding="utf-8")
        self._patch = patch.object(rs_mod, "SETTINGS_PATH", self._path)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        self._tmp.cleanup()

    def test_reset_to_defaults_restores_ui_call_sfx(self):
        rs = RuntimeSettings()
        rs.apply_patch({
            "beast_mode": False,
            "ui": {"call_sfx": False, "team_loops": False, "sound_enabled": False},
            "learning": {"path_win_pct": 99},
        })
        snap = rs.reset_to_defaults()
        self.assertTrue(snap["beast_mode"])
        self.assertTrue(snap["ui"]["call_sfx"])
        self.assertTrue(snap["ui"]["team_loops"])
        self.assertTrue(snap["ui"]["sound_enabled"])
        self.assertEqual(snap["learning"]["path_win_pct"], DEFAULTS["learning"]["path_win_pct"])
        saved = json.loads(self._path.read_text(encoding="utf-8"))
        self.assertTrue(saved["ui"]["call_sfx"])
        self.assertEqual(snap["analysis_interval"], DEFAULTS["beast"]["analysis_interval"])
        self.assertGreaterEqual(snap["analysis_interval"], 1.2)

    def test_reset_flag_on_patch(self):
        rs = RuntimeSettings()
        rs.apply_patch({"beast_mode": False})
        snap = rs.apply_patch({"reset": True})
        self.assertTrue(snap["beast_mode"])
        self.assertTrue(snap["ui"]["call_sfx"])

    def test_migrates_old_factory_cadence(self):
        self._path.write_text(json.dumps({
            "beast_mode": True,
            "normal": {
                "analysis_interval": 5.0,
                "analysis_interval_hot": 3.0,
                "analysis_interval_flat": 8.0,
                "ui_poll_ms": 2500,
            },
            "beast": {
                "analysis_interval": 1.5,
                "analysis_interval_hot": 1.0,
                "analysis_interval_flat": 3.0,
                "ui_poll_ms": 800,
            },
            "ui": {"call_sfx": True},
        }), encoding="utf-8")
        rs = RuntimeSettings()
        self.assertEqual(rs.profile()["analysis_interval"], 1.2)
        self.assertEqual(rs._data["normal"]["analysis_interval"], 2.0)
        self.assertEqual(rs._data["normal"]["analysis_interval_flat"], 3.5)
        self.assertTrue(rs.ui()["call_sfx"])


class FrontSettingsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._path = Path(self._tmp.name) / "system-settings.json"
        self._path.write_text("{}", encoding="utf-8")
        self._patch = patch.object(rs_mod, "SETTINGS_PATH", self._path)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        self._tmp.cleanup()

    def test_front_defaults_paper_dallas_not_follower(self):
        rs = RuntimeSettings()
        snap = rs.snapshot()
        front = snap["front"]
        self.assertTrue(front["show_tab"])
        self.assertTrue(front["show_floor_chair"])
        self.assertTrue(front["paper_only"])
        self.assertTrue(front["dallas"])
        self.assertTrue(front["no_lock_frost_sick"])
        self.assertTrue(front["sound_on_lock"])
        self.assertTrue(front["fade_underperformers"])
        self.assertEqual(front["min_confidence"], 50)
        self.assertEqual(front["max_stake"], 25.0)
        self.assertEqual(front["daily_loss_cap"], 50.0)
        self.assertNotIn("follower", front)
        self.assertNotIn("cities", front)
        self.assertNotIn("gold", front)

    def test_front_sanitize_drops_follower_and_cities(self):
        rs = RuntimeSettings()
        snap = rs.apply_patch({
            "front": {
                "show_tab": False,
                "paper_only": False,
                "dallas": False,
                "min_confidence": 70,
                "max_stake": 10,
                "follower": True,
                "cities": ["NYC", "CHI"],
                "gold": True,
            }
        })
        front = snap["front"]
        self.assertFalse(front["show_tab"])
        self.assertTrue(front["paper_only"])
        self.assertTrue(front["dallas"])
        self.assertEqual(front["min_confidence"], 70)
        self.assertEqual(front["max_stake"], 10.0)
        self.assertNotIn("follower", front)
        self.assertNotIn("cities", front)
        self.assertNotIn("gold", front)


if __name__ == "__main__":
    unittest.main()
