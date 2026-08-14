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

    def test_reset_flag_on_patch(self):
        rs = RuntimeSettings()
        rs.apply_patch({"beast_mode": False})
        snap = rs.apply_patch({"reset": True})
        self.assertTrue(snap["beast_mode"])
        self.assertTrue(snap["ui"]["call_sfx"])


if __name__ == "__main__":
    unittest.main()
