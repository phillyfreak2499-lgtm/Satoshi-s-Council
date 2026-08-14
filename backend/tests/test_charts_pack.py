"""Charts HUD pack: dual pair canvases, both odds, lock tape, finish-only."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
DB = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")


class ChartsMarkupTests(unittest.TestCase):
    def test_both_pair_canvases_present(self):
        self.assertIn('id="chartBtc"', HTML)
        self.assertIn('id="chartEth"', HTML)
        self.assertIn('id="chartEthTitle"', HTML)
        self.assertIn("BTC · 1m", HTML)
        self.assertIn("ETH · 1m", HTML)
        self.assertIn('id="chartBtcMeta"', HTML)
        self.assertIn('id="chartEthMeta"', HTML)

    def test_odds_tape_hitrate_labels(self):
        self.assertIn("KALSHI ODDS", HTML)
        self.assertIn("UP — · DOWN —", HTML)
        self.assertIn("COUNCIL TAPE", HTML)
        self.assertIn('id="chartTapeList"', HTML)
        self.assertIn("HIT RATE · FINISH-ONLY", HTML)
        self.assertIn('id="chartAccMeta">0/0', HTML)
        self.assertIn("SEAT WEIGHTS", HTML)

    def test_paper_tab_still_present(self):
        self.assertIn('id="tabPaper"', HTML)
        self.assertIn('id="paperView"', HTML)
        self.assertIn('id="tabCharts"', HTML)


class ChartsJsTests(unittest.TestCase):
    def test_draws_eth_and_btc_from_table_state(self):
        self.assertIn('function drawChartEth()', JS)
        self.assertIn('function drawPairCandles(', JS)
        self.assertIn('drawPairCandles("chartBtc", "bitcoin", "chartBtcMeta")', JS)
        self.assertIn('drawPairCandles("chartEth", "ethereum", "chartEthMeta")', JS)
        self.assertIn("drawChartEth();", JS)
        self.assertIn("tableState(tableKey)", JS)

    def test_titles_stay_both_pairs(self):
        self.assertIn('btcTitle.textContent = "BTC · 1m"', JS)
        self.assertIn('ethTitle.textContent = "ETH · 1m"', JS)
        self.assertNotIn('pairTitle.textContent = eth ? "ETH · 1m" : "BTC · 1m"', JS)

    def test_odds_plots_up_and_down(self):
        self.assertIn('p => p.up, "#39ff14"', JS)
        self.assertIn('p => p.down, "#ff2d55"', JS)
        self.assertIn("UP ${Math.round(up)}% · DOWN ${Math.round(down)}%", JS)
        self.assertNotIn('drawLineSeries(ctx, series.odds, p => p.up, "#00e8ff"', JS)

    def test_tape_is_chair_locks(self):
        self.assertIn("function collectChairLocks()", JS)
        self.assertIn("NO CHAIR LOCKS YET", JS)
        self.assertIn("SETTLED", JS)
        self.assertIn("OPEN", JS)

    def test_hit_rate_finish_only_zero(self):
        self.assertIn("function finishOnlyStats()", JS)
        self.assertIn("0/0 finish-only", JS)
        self.assertIn("never invent a win rate when n=0", JS)
        self.assertIn("finish_only", DB)

    def test_window_and_lock_marks(self):
        self.assertIn("function drawHourWindowAndLock", JS)
        self.assertIn("1H WINDOW", JS)
        self.assertIn('fillText("LOCK"', JS)
        self.assertIn("K TARGET", JS)

    def test_fit_canvas_has_real_height(self):
        self.assertIn("const minH = isPair ? 220", JS)
        self.assertIn("if (h < minH) h = minH", JS)
        self.assertIn('canvas.style.width = w + "px"', JS)
        self.assertIn("opts.rows", JS)

    def test_live_book_odds_rejects_missing_zero(self):
        self.assertIn("function liveBookOdds", JS)
        self.assertIn("never invent 0.0% from a missing print", JS)
        self.assertIn("n === 0) return NaN", JS)
        self.assertIn("const book = liveBookOdds(m);", JS)
        self.assertNotIn("UP 0.0%", JS)

    def test_candle_ohlc_and_tape_scale(self):
        self.assertIn("function candleOHLC", JS)
        self.assertIn("Scale from the tape only", JS)
        self.assertIn("h > cl * 1.25 || l < cl * 0.75", JS)

    def test_accuracy_zero_is_finish_only_not_collecting(self):
        start = JS.find("function drawChartAccuracy()")
        end = JS.find("function drawChartWeights()", start)
        acc = JS[start:end]
        self.assertIn("0/0 finish-only", acc)
        self.assertNotIn("COLLECTING", acc)

    def test_funding_hides_empty_card(self):
        self.assertIn("function drawChartFunding", JS)
        self.assertIn("card.hidden = true", JS)
        start = JS.find("function drawChartFunding()")
        end = JS.find("function pairFromLockRow", start)
        fund = JS[start:end]
        self.assertNotIn("COLLECTING", fund)

    def test_weights_fit_rows(self):
        self.assertIn("fitCanvas(canvas, { rows: ranked.length })", JS)
        self.assertIn(".slice(0, 10)", JS)

    def test_charts_tab_layouts_then_draws(self):
        self.assertIn("Layout after the view is visible, then draw", JS)
        self.assertIn("void chartsView.offsetWidth", JS)
        self.assertRegex(
            JS,
            r"requestAnimationFrame\(\(\) => \{\s*try \{ if \(chartsView\) void chartsView\.offsetWidth",
        )


class ChartsCssTests(unittest.TestCase):
    def test_canvases_not_zero_height(self):
        self.assertIn("min-height: 140px", CSS)
        self.assertIn("min-height: 220px", CSS)
        self.assertIn("#chartEth", CSS)
        self.assertIn("CHARTS HUD", CSS)

    def test_mobile_charts_scroll_stacked(self):
        self.assertIn("body.mode-charts #chartsView.charts-view:not(.hidden)", CSS)
        self.assertIn("overflow-y: auto !important", CSS)
        self.assertIn(".charts-pairs", CSS)

    def test_1280_pairs_side_by_side(self):
        self.assertIn("grid-template-columns: 1fr 1fr !important", CSS)
        self.assertIn(".chart-card.chart-pair-eth", CSS)

    def test_open_charts_btn_hidden_charts_tab_stays(self):
        self.assertIn("#openChartsBtn", CSS)
        self.assertIn("#openChartsBtn.open-charts-btn", CSS)
        btn = CSS.split("#openChartsBtn,")[-1][:180]
        self.assertIn("display: none !important", btn)
        self.assertIn('id="tabCharts"', HTML)
        self.assertIn('id="chartsView"', HTML)

    def test_floor_led_not_fixed_top_40(self):
        self.assertNotIn("top: 40px", CSS)
        self.assertIn("html body.floor-mode #app > header #windowLed.led-float.led-window", CSS)
        self.assertIn("top: auto !important", CSS)


class NoRegressionTests(unittest.TestCase):
    def test_cold_visit_still_gated(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotRegex(HTML, r"<body[^>]*admin-unlocked")
        self.assertIn("Never start admin-unlocked", HTML)
        self.assertIn('sessionStorage.removeItem("council_admin_unlocked")', HTML)

    def test_settings_save_still_json(self):
        self.assertIn("/api/settings/save", JS)
        self.assertIn("applySettingsSnapshot(s, { localToggles: true })", JS)
        self.assertIn('@app.post("/api/settings/save")', MAIN)

    def test_official_closer_still_present(self):
        self.assertIn("def official_y_finish", GATES)
        self.assertIn("KNOWN_OFFICIAL_FINISH", GATES)
        self.assertIn("KXBTCD-26AUG1415-T62999.99", GATES)

    def test_follower_stays_off_public_surface(self):
        for needle in ("tabFollower", "FOLLOWER_PASSWORD", "/api/follower/unlock", "/api/follower/order"):
            self.assertNotIn(needle, HTML)
            self.assertNotIn(needle, JS)


if __name__ == "__main__":
    unittest.main()
