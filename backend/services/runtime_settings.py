"""
Runtime system settings — survives restarts, toggable without redeploy.
BEAST MODE + full learning/trading/UI knobs for the Settings tab.
"""
from __future__ import annotations
import json
import threading
from pathlib import Path
from typing import Any, Dict
from loguru import logger

from backend.config import settings as _settings
DATA_DIR = Path(getattr(_settings, "DATA_DIR", None) or (Path(__file__).resolve().parents[2] / "data"))
SETTINGS_PATH = DATA_DIR / "system-settings.json"

# Defaults match backend/config.py intent; Settings tab can override at runtime.
DEFAULTS: Dict[str, Any] = {
    "beast_mode": True,
    "beast": {
        "analysis_interval": 1.5,
        "analysis_interval_hot": 1.0,
        "analysis_interval_flat": 3.0,
        "parallel_agents": True,
        "dual_spot": True,
        "slow_metrics_ttl": 20.0,
        "kline_limit": 90,
        "ui_poll_ms": 800,
    },
    "normal": {
        "analysis_interval": 5.0,
        "analysis_interval_hot": 3.0,
        "analysis_interval_flat": 8.0,
        "parallel_agents": True,
        "dual_spot": False,
        "slow_metrics_ttl": 45.0,
        "kline_limit": 60,
        "ui_poll_ms": 2500,
    },
    # --- Learning / grading ---
    "learning": {
        "path_win_pct": 7.0,           # full UP/DOWN path target (Kalshi pts)
        "hold_fraction": 0.35,         # HOLD target = path_win_pct * this
        "near_certain_bar": 90.0,      # entry/peak >= this → auto-win path
        "fade_min_n": 20,
        "fade_wr_threshold": 0.42,
        "fade_full_at_wr": 0.30,
        "fade_max_weight_share": 0.18,
        "anti_min_tries": 15,
        "anti_win_rate": 0.62,
        "anti_max_bonus": 0.12,
        "anti_soft_fade": 0.55,
        "cold_start_samples": 15,
        "calibrate_samples": 20,
        "exploit_samples": 80,
        "recent_form_window": 20,
        "recent_form_blend": 0.35,
        "learning_rate": 0.11,
        "learning_rate_cold": 0.16,
        "brain_auto_save": True,
    },
    # --- Call bar / risk ---
    "trading": {
        "min_confluence": 0.42,
        "min_directional_conf": 50,
        "confluence_floor": 0.28,
        "confluence_ceiling": 0.72,
        "dir_conf_floor": 44,
        "dir_conf_ceiling": 68,
        "hold_confluence_ratio": 0.45,
        "top_n_agreement": 3,
        "post_hit_cooldown_sec": 90.0,
        "post_miss_penalty_sec": 120.0,
        "post_miss_confluence_bump": 0.08,
        "law_lock_after_wrongs": 2,
        "law_lock_windows": 1,
        "law_shadow_early_unlock_rights": 1,
        "window_lock_enabled": True,
        "hysteresis_band": 14.0,
        "flip_min_conf_delta": 18.0,
        "conf_weight_power": 1.4,
        "quiet_min_directional_conf": 80.0,
        "quiet_atr_pct": 0.12,
        "quiet_volume_percentile": 25.0,
    },
    # --- Huddle ---
    "huddle": {
        "enabled": True,
        "hour_ct": 3,                  # 3 AM America/Chicago
        "duration_minutes": 15,
        "rebuild_limit": 400,
        "prune_days": 90,
        "law_bump_hours": 6,
    },
    # --- Auto-bet setup (admin Settings only). No live orders. ---
    # mode slot: off | paper_chair | follow_leaders (follow_leaders is reserved).
    "auto_bet": {
        "enabled": False,
        "mode": "off",
        "size": 25.0,
        "btc": True,
        "eth": True,
    },
    # --- UI / audio ---
    "ui": {
        "sound_enabled": True,
        "sound_up": True,
        "sound_down": True,
        "sound_swap": True,
        "sound_bell": True,
        "beam_glow": True,
        "watermark_opacity": 0.18,
        "floor_immersive_default": False,
        "show_fade_tags": True,
        "show_anti_tags": True,
        "call_sfx": True,
        "team_loops": True,
    },
}


AUTO_BET_MODES = ("off", "paper_chair", "follow_leaders")


def _sanitize_auto_bet(patch: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only known auto-bet knobs. Never store API keys or secrets."""
    if not isinstance(patch, dict):
        return {}
    out: Dict[str, Any] = {}
    if "enabled" in patch:
        out["enabled"] = bool(patch["enabled"])
    if "mode" in patch:
        mode = str(patch.get("mode") or "off").strip().lower()
        out["mode"] = mode if mode in AUTO_BET_MODES else "off"
    if "size" in patch:
        try:
            out["size"] = max(0.0, min(10000.0, float(patch["size"])))
        except Exception:
            pass
    if "btc" in patch:
        out["btc"] = bool(patch["btc"])
    if "eth" in patch:
        out["eth"] = bool(patch["eth"])
    return out


def _deep_merge(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in (overlay or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


class RuntimeSettings:
    def __init__(self):
        self._lock = threading.Lock()
        self._data: Dict[str, Any] = json.loads(json.dumps(DEFAULTS))  # deep copy
        self._load()

    def _load(self) -> None:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            if SETTINGS_PATH.exists():
                raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self._data = _deep_merge(DEFAULTS, raw)
        except Exception as e:
            logger.warning(f"Runtime settings load failed: {e}")

    def save(self) -> None:
        with self._lock:
            try:
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                SETTINGS_PATH.write_text(
                    json.dumps(self._data, indent=2),
                    encoding="utf-8",
                )
            except Exception as e:
                logger.warning(f"Runtime settings save failed: {e}")

    @property
    def beast_mode(self) -> bool:
        return bool(self._data.get("beast_mode", True))

    def set_beast_mode(self, on: bool) -> Dict[str, Any]:
        with self._lock:
            self._data["beast_mode"] = bool(on)
        self.save()
        logger.info(f"BEAST MODE → {'ON' if on else 'OFF'}")
        return self.snapshot()

    def profile(self) -> Dict[str, Any]:
        key = "beast" if self.beast_mode else "normal"
        return dict(self._data.get(key) or DEFAULTS[key])

    def get(self, name: str, default: Any = None) -> Any:
        """Profile-level get (beast/normal cadence keys)."""
        return self.profile().get(name, default)

    def learning(self) -> Dict[str, Any]:
        return dict(self._data.get("learning") or DEFAULTS["learning"])

    def trading(self) -> Dict[str, Any]:
        return dict(self._data.get("trading") or DEFAULTS["trading"])

    def huddle(self) -> Dict[str, Any]:
        return dict(self._data.get("huddle") or DEFAULTS["huddle"])

    def ui(self) -> Dict[str, Any]:
        return dict(self._data.get("ui") or DEFAULTS["ui"])

    def auto_bet(self) -> Dict[str, Any]:
        return dict(self._data.get("auto_bet") or DEFAULTS["auto_bet"])

    def knobs(self, section: str, key: str, default: Any = None) -> Any:
        """Read a nested knob with fallback to DEFAULTS then `default`."""
        sec = self._data.get(section) or DEFAULTS.get(section) or {}
        if key in sec:
            return sec[key]
        return (DEFAULTS.get(section) or {}).get(key, default)

    def update_section(self, section: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        if section not in ("learning", "trading", "huddle", "ui", "beast", "normal", "auto_bet"):
            raise ValueError(f"Unknown section: {section}")
        with self._lock:
            cur = dict(self._data.get(section) or DEFAULTS.get(section) or {})
            for k, v in (patch or {}).items():
                if v is None:
                    continue
                # coerce numbers
                if isinstance(cur.get(k), bool) or isinstance(DEFAULTS.get(section, {}).get(k), bool):
                    cur[k] = bool(v) if not isinstance(v, bool) else v
                elif isinstance(cur.get(k), int) or isinstance(DEFAULTS.get(section, {}).get(k), int):
                    try:
                        cur[k] = int(float(v))
                    except Exception:
                        continue
                elif isinstance(cur.get(k), float) or isinstance(DEFAULTS.get(section, {}).get(k), float):
                    try:
                        cur[k] = float(v)
                    except Exception:
                        continue
                else:
                    cur[k] = v
            self._data[section] = cur
        self.save()
        return self.snapshot()

    def reset_to_defaults(self) -> Dict[str, Any]:
        """Replace runtime settings with factory DEFAULTS and persist."""
        with self._lock:
            self._data = json.loads(json.dumps(DEFAULTS))
        self.save()
        logger.info("Runtime settings reset to factory defaults")
        return self.snapshot()

    def apply_patch(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """Apply a partial settings body from the Settings tab."""
        if not isinstance(body, dict):
            return self.snapshot()
        if body.get("reset") is True or body.get("reset_defaults") is True:
            return self.reset_to_defaults()
        if "beast_mode" in body:
            self.set_beast_mode(bool(body["beast_mode"]))
        for sec in ("learning", "trading", "huddle", "ui", "beast", "normal", "auto_bet"):
            if isinstance(body.get(sec), dict):
                patch = body[sec]
                if sec == "auto_bet":
                    patch = _sanitize_auto_bet(patch)
                self.update_section(sec, patch)
        # flat aliases for convenience
        flat_map = {
            "path_win_pct": ("learning", "path_win_pct"),
            "hold_fraction": ("learning", "hold_fraction"),
            "fade_min_n": ("learning", "fade_min_n"),
            "fade_wr_threshold": ("learning", "fade_wr_threshold"),
            "anti_min_tries": ("learning", "anti_min_tries"),
            "anti_win_rate": ("learning", "anti_win_rate"),
            "min_confluence": ("trading", "min_confluence"),
            "min_directional_conf": ("trading", "min_directional_conf"),
            "huddle_hour_ct": ("huddle", "hour_ct"),
            "huddle_duration_minutes": ("huddle", "duration_minutes"),
            "sound_enabled": ("ui", "sound_enabled"),
            "ui_poll_ms": None,  # profile-level
        }
        for k, target in flat_map.items():
            if k not in body:
                continue
            if target is None and k == "ui_poll_ms":
                key = "beast" if self.beast_mode else "normal"
                self.update_section(key, {"ui_poll_ms": body[k]})
            elif target:
                self.update_section(target[0], {target[1]: body[k]})
        return self.snapshot()

    def snapshot(self) -> Dict[str, Any]:
        p = self.profile()
        return {
            "beast_mode": self.beast_mode,
            "profile": "beast" if self.beast_mode else "normal",
            "analysis_interval": p.get("analysis_interval"),
            "analysis_interval_hot": p.get("analysis_interval_hot"),
            "analysis_interval_flat": p.get("analysis_interval_flat"),
            "parallel_agents": p.get("parallel_agents"),
            "dual_spot": p.get("dual_spot"),
            "slow_metrics_ttl": p.get("slow_metrics_ttl"),
            "kline_limit": p.get("kline_limit"),
            "ui_poll_ms": p.get("ui_poll_ms"),
            "learning": self.learning(),
            "trading": self.trading(),
            "huddle": self.huddle(),
            "ui": self.ui(),
            "auto_bet": self.auto_bet(),
            "label": "BEAST MODE" if self.beast_mode else "STANDARD",
            "blurb": (
                "Max refresh · dual spot · parallel seats · premium HUD"
                if self.beast_mode
                else "Balanced cadence · single spot · power-friendly"
            ),
            "defaults": {
                "beast_mode": DEFAULTS["beast_mode"],
                "beast": DEFAULTS["beast"],
                "normal": DEFAULTS["normal"],
                "learning": DEFAULTS["learning"],
                "trading": DEFAULTS["trading"],
                "huddle": DEFAULTS["huddle"],
                "ui": DEFAULTS["ui"],
                "auto_bet": DEFAULTS["auto_bet"],
            },
        }


# Singleton
runtime_settings = RuntimeSettings()
