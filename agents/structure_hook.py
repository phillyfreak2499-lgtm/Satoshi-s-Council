"""Wrap the existing pre-lock checklist with session/structure WAITs."""
from __future__ import annotations

from typing import Any, Tuple

from backend.agents.chair_gates import pre_lock_checklist
from backend.agents.structure_gates import (
    STRUCTURE_WHY_CODES,
    structure_from_regime,
    structure_stake_pct,
    structure_wait_code,
    structure_wait_reason,
)

_INSTALLED = False


def checklist_with_structure(
    *,
    spot_ok: bool,
    kalshi_ok: bool,
    law_locked: bool,
    chalk: bool,
    leftover_cents: Any,
    is_15m: bool,
    quiet: bool,
    hard_trigger: bool,
    families_aligned: int,
    regime_features: Any = None,
    already_locked: bool = False,
    lean: Any = None,
) -> Tuple[bool, str]:
    ok, why = pre_lock_checklist(
        spot_ok=spot_ok,
        kalshi_ok=kalshi_ok,
        law_locked=law_locked,
        chalk=chalk,
        leftover_cents=leftover_cents,
        is_15m=is_15m,
        quiet=quiet,
        hard_trigger=hard_trigger,
        families_aligned=families_aligned,
    )
    if not ok:
        return ok, why
    st = structure_from_regime(regime_features)
    extra = structure_wait_reason(
        mins_left=st["mins_left"],
        already_locked=already_locked,
        spot=st["spot"],
        strike=st["strike"],
        atr=st["atr"],
        atr_pct=st["atr_pct"],
        regime=st["regime"],
        regime_key=st["regime_key"],
        chop=st["chop"],
        midrange=st["midrange"],
        tape_side=st["tape_side"],
        buy_ratio=st["buy_ratio"],
        lean=lean,
        chalk=False,
    )
    if extra:
        return False, extra
    return True, ""


def _enrich_regime(signals: Any, regime_features: Any) -> dict:
    rf = dict(regime_features or {})
    for sig in signals or []:
        if isinstance(sig, dict):
            name = sig.get("agent_name")
            feat = sig.get("features") if isinstance(sig.get("features"), dict) else {}
        else:
            name = getattr(sig, "agent_name", None)
            raw = getattr(sig, "features", None)
            feat = raw if isinstance(raw, dict) else {}
        if name == "whale":
            rf.setdefault("buy_ratio", feat.get("buy_ratio") or feat.get("aggr_buy_ratio"))
            if isinstance(feat.get("aggr"), dict):
                rf.setdefault("aggr", feat.get("aggr"))
        if name == "liq":
            rf.setdefault("buy_ratio", feat.get("buy_ratio"))
        if name == "regime":
            rf.setdefault("chop", feat.get("chop"))
            rf.setdefault("regime", feat.get("regime") or feat.get("state") or feat.get("label"))
            rf.setdefault("midrange", feat.get("midrange"))
        if name == "session_tod":
            sess = str(feat.get("session") or "").upper()
            rf.setdefault("session", sess)
            if sess in ("US_PM", "LATE"):
                rf.setdefault("session_grade", "worse")
            elif sess == "US_AM":
                rf.setdefault("session_grade", "best")
            elif sess in ("ASIA", "EUROPE"):
                rf.setdefault("session_grade", "ok")
        if name in ("candle", "candle_btc", "candle_eth"):
            rf.setdefault("completeness", feat.get("completeness") or feat.get("pattern_completeness"))
            rf.setdefault("midrange", feat.get("midrange") or feat.get("mid_range"))
    aggr = rf.get("aggr") if isinstance(rf.get("aggr"), dict) else {}
    rf.setdefault("buy_ratio", aggr.get("buy_ratio"))
    return rf


def install_structure_gates() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    import backend.agents.chair_gates as cg
    from backend.agents.leader import Leader

    _orig_cls = cg.classify_wait_reason
    _orig_punch = cg.punch_chair_why
    _orig_syn = Leader.synthesize
    ctx = {"rf": {}, "already_locked": False}

    def wrapped_plc(
        *,
        spot_ok: bool,
        kalshi_ok: bool,
        law_locked: bool,
        chalk: bool,
        leftover_cents,
        is_15m: bool,
        quiet: bool,
        hard_trigger: bool,
        families_aligned: int,
    ):
        return checklist_with_structure(
            spot_ok=spot_ok,
            kalshi_ok=kalshi_ok,
            law_locked=law_locked,
            chalk=chalk,
            leftover_cents=leftover_cents,
            is_15m=is_15m,
            quiet=quiet,
            hard_trigger=hard_trigger,
            families_aligned=families_aligned,
            regime_features=ctx.get("rf"),
            already_locked=bool(ctx.get("already_locked")),
            lean=ctx.get("lean"),
        )

    def wrapped_cls(summary=None, decision=None, market=None):
        dec = decision if isinstance(decision, dict) else {}
        code = structure_wait_code(dec.get("checklist_veto") or summary)
        mapping = {
            "WAIT_CHOP": "chop",
            "WAIT_MIDRANGE": "midrange",
            "WAIT_TAPE": "tape",
            "WAIT_NO_CUSHION": "no_cushion",
            "WAIT_TOO_LATE": "too_late",
            "WAIT_CHALK": "chalk",
        }
        if code in mapping:
            return mapping[code]
        return _orig_cls(summary, decision, market)

    def wrapped_punch(summary, direction=None):
        code = structure_wait_code(summary)
        labels = {
            "WAIT_CHOP": "WAIT · chop",
            "WAIT_MIDRANGE": "WAIT · mid-range",
            "WAIT_TAPE": "WAIT · tape",
            "WAIT_NO_CUSHION": "WAIT · no cushion",
            "WAIT_TOO_LATE": "WAIT · too late",
            "WAIT_CHALK": "WAIT · chalk sit",
        }
        if code in labels:
            return labels[code]
        return _orig_punch(summary, direction)

    def wrapped_syn(self, signals, regime_features=None):
        rf = _enrich_regime(signals, regime_features)
        ctx["rf"] = rf
        ctx["already_locked"] = bool(
            getattr(self, "_entry_dir", None)
            or (self._active_dir() if hasattr(self, "_active_dir") else None)
            or (self._path_book_open() if hasattr(self, "_path_book_open") else False)
        )
        try:
            out = _orig_syn(self, signals, rf)
        finally:
            ctx["rf"] = {}
            ctx["already_locked"] = False
        if isinstance(out, dict):
            st = structure_from_regime(rf)
            tape = st.get("tape_side")
            lean = out.get("lean") or out.get("direction")
            out["stake_pct"] = structure_stake_pct(
                completeness=st.get("completeness"),
                tape_agrees=bool(tape and lean and str(tape).upper() in str(lean).upper()),
                zone_agrees=bool(
                    out.get("top_agree")
                    or ((out.get("families") or {}).get("families_aligned") or 0) >= 2
                ),
                session_grade=st.get("session_grade"),
            )
            out["structure_wait"] = structure_wait_code(out.get("checklist_veto"))
        return out

    cg.pre_lock_checklist = wrapped_plc
    cg.classify_wait_reason = wrapped_cls
    cg.punch_chair_why = wrapped_punch
    existing = tuple(cg.WAIT_REASON_CODES or ())
    cg.WAIT_REASON_CODES = tuple(dict.fromkeys(existing + STRUCTURE_WHY_CODES))
    Leader.synthesize = wrapped_syn
    _INSTALLED = True
