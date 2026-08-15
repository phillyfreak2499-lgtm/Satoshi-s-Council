/**
 * Satoshi’s Council – Dual-mode Blade Table
 * Screensaver Mode: High-tech cyberpunk knight / samurai Round Table
 * Dashboard Mode: armor-plate neon HUD cards
 */
window.applySettingsSnapshot = window.applySettingsSnapshot || function applySettingsSnapshotStub() {};
if (window.applySettingsSnapshot && !window.applySettingsSnapshot._real) {
  window.applySettingsSnapshot._stub = true;
}
(() => {
  const canvas = document.getElementById("roundtable");
  if (!canvas) {
    console.error("roundtable canvas missing");
  }
  const ctx = canvas ? canvas.getContext("2d") : null;

  /* ===== ADMIN (must be early — Settings tab depends on these) ===== */
  const ADMIN_PASSWORD = "5152622439";
  const ADMIN_KEY = "council_admin_unlocked";
  const DESK_KEY = "council_auth_ok";
  const ONBOARD_KEY = "council_onboarded";
  function hasOnboarded() {
    try {
      return localStorage.getItem(ONBOARD_KEY) === "1" || localStorage.getItem("council_entered") === "1";
    } catch (e) { return false; }
  }
  function markOnboarded() {
    try { localStorage.setItem(ONBOARD_KEY, "1"); } catch (e) {}
    try { localStorage.setItem("council_entered", "1"); } catch (e) {}
  }
  window.hasOnboarded = hasOnboarded;
  window.markOnboarded = markOnboarded;
  // Cold load: leftover storage must not paint privileged chrome.
  try { localStorage.removeItem(ADMIN_KEY); } catch (e) {}
  try { localStorage.removeItem(DESK_KEY); } catch (e) {}
  try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
  try { sessionStorage.removeItem(DESK_KEY); } catch (e) {}
  window.__deskUnlockedThisPage = false;
  window.__adminUnlockedThisPage = false;
  document.body.classList.add("gate-locked");
  document.body.classList.remove("admin-unlocked", "follower-unlocked");
  document.body.setAttribute("data-password-protected", "true");
  function hasDeskAuth() {
    try { return sessionStorage.getItem(DESK_KEY) === "1" && !!window.__deskUnlockedThisPage; } catch (e) { return !!window.__deskUnlockedThisPage; }
  }
  function isAdminUnlocked() {
    try { return sessionStorage.getItem(ADMIN_KEY) === "1" && !!window.__adminUnlockedThisPage; } catch (e) { return !!window.__adminUnlockedThisPage; }
  }
  function setAdminUnlocked(on) {
    try { sessionStorage.setItem(ADMIN_KEY, on ? "1" : "0"); } catch (e) {}
    try { localStorage.removeItem(ADMIN_KEY); } catch (e) {}
    if (on) window.__adminUnlockedThisPage = true;
    document.body.classList.toggle("admin-unlocked", !!on);
    if (on) {
      try { mountAdminDesk(); } catch (e) {}
    }
  }
  function mountAdminDesk() {
    const host = document.getElementById("adminDeskHost");
    const tpl = document.getElementById("adminDeskTemplate");
    if (!host || !tpl) return;
    if (host.dataset.mounted !== "1") {
      host.appendChild(tpl.content.cloneNode(true));
      host.dataset.mounted = "1";
    }
    try { wireAdminTools(); } catch (e) {}
    try { wireBrain(); } catch (e) {}
  }
  window.mountAdminDesk = mountAdminDesk;
  let pendingAdminCb = null;
  function requestAdminUnlock(cb) {
    if (isAdminUnlocked()) { if (typeof cb === "function") cb(); return; }
    pendingAdminCb = typeof cb === "function" ? cb : null;
    window.__pendingAdminUnlock = pendingAdminCb;
    const gate = document.getElementById("adminGate");
    const input = document.getElementById("adminInput");
    const err = document.getElementById("adminError");
    if (err) { err.classList.add("hidden"); err.textContent = "Wrong password"; }
    if (input) input.value = "";
    if (gate) gate.classList.remove("hidden");
    setTimeout(() => { try { input && input.focus(); } catch (e) {} }, 40);
  }
  function closeAdminGate(ok) {
    const gate = document.getElementById("adminGate");
    if (gate) gate.classList.add("hidden");
    const cb = pendingAdminCb || window.__pendingAdminUnlock;
    pendingAdminCb = null;
    window.__pendingAdminUnlock = null;
    if (ok && typeof cb === "function") cb();
    if (ok && window.__openSettingsAfterAdmin && typeof setMode === "function") {
      window.__openSettingsAfterAdmin = false;
      setMode("settings");
    }
    if (ok) {
      try { mountAdminDesk(); } catch (e) {}
      try { loadAdminDeskExtensions(); } catch (e) {}
    }
    try { syncAutoBetVisibility(); } catch (e) {}
  }

  function syncAutoBetVisibility() {
    const unlocked = isAdminUnlocked();
    document.body.classList.toggle("admin-unlocked", unlocked);
    const card = document.getElementById("autoBetCard");
    if (!card) return;
    let current = "art";
    try { current = mode; } catch (e) {}
    const show = unlocked && current === "settings";
    card.classList.toggle("hidden", !show);
    card.setAttribute("aria-hidden", show ? "false" : "true");
  }
  function wireAdminGate() {
    const submit = document.getElementById("adminSubmit");
    const cancel = document.getElementById("adminCancel");
    const input = document.getElementById("adminInput");
    const err = document.getElementById("adminError");
    if (!submit) return;
    if (submit.__wired) return;
    submit.__wired = true;
    const tryUnlock = () => {
      const val = (input && input.value) || "";
      if (val === ADMIN_PASSWORD) {
        setAdminUnlocked(true);
        if (err) err.classList.add("hidden");
        closeAdminGate(true);
      } else {
        if (err) { err.textContent = "Wrong password"; err.classList.remove("hidden"); }
      }
    };
    submit.addEventListener("click", tryUnlock);
    if (input && !input.__hotkeysSwallowed) {
      input.__hotkeysSwallowed = true;
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.key === "Enter") tryUnlock();
      }, true);
    }
    if (cancel && !cancel.__wired) {
      cancel.__wired = true;
      cancel.addEventListener("click", () => closeAdminGate(false));
    }
  }
  async function adminFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {}, { "X-Council-Admin": ADMIN_PASSWORD });
    return fetch(url, opts);
  }
  function wireAdminTools() {
    const st = () => document.getElementById("adminToolsStatus");
    const clearHit = document.getElementById("btnClearHitRate");
    const clearLog = document.getElementById("btnClearLifeLog");
    const exportBtn = document.getElementById("btnExportExcel");
    if (clearHit && !clearHit.__wired) {
      clearHit.__wired = true;
      clearHit.addEventListener("click", () => {
        requestAdminUnlock(async () => {
          if (!confirm("Reset hit-rate and the Floor Satoshi vs Vitalik scorecard? Training weights will NOT be deleted. Path-era scores will stop counting.")) return;
          try {
            const r = await adminFetch("/api/admin/clear-hit-rate", { method: "POST" });
            const data = await r.json();
            if (st()) st().textContent = data.ok ? ("Hit rate & scorecard cleared · " + (data.reset_at || "")) : ("Failed: " + (data.error || ""));
          } catch (e) {
            if (st()) st().textContent = "Clear failed: " + e;
          }
        });
      });
    }
    if (clearLog && !clearLog.__wired) {
      clearLog.__wired = true;
      clearLog.addEventListener("click", () => {
        requestAdminUnlock(async () => {
          if (!confirm("Clear lifetime log display? Training weights will NOT be deleted.")) return;
          try {
            const r = await adminFetch("/api/admin/clear-life-log", { method: "POST" });
            const data = await r.json();
            if (st()) st().textContent = data.ok ? ("Life log cleared · " + (data.reset_at || "")) : ("Failed: " + (data.error || ""));
            const log = document.getElementById("callLog");
            if (log) log.innerHTML = '<div class="call-empty">LIFETIME LOG CLEARED<br/>New settled calls will appear here</div>';
          } catch (e) {
            if (st()) st().textContent = "Clear failed: " + e;
          }
        });
      });
    }
    if (exportBtn && !exportBtn.__wired) {
      exportBtn.__wired = true;
      exportBtn.addEventListener("click", () => {
        requestAdminUnlock(() => {
          const a = document.createElement("a");
          a.href = "/api/admin/export.xlsx?admin=" + encodeURIComponent(ADMIN_PASSWORD);
          a.download = "satoshi-council-log.xlsx";
          document.body.appendChild(a);
          a.click();
          a.remove();
          if (st()) st().textContent = "Excel download started…";
        });
      });
    }
    const brainBtn = document.getElementById("btnBrainExport");
    if (brainBtn && !brainBtn.__wired) {
      brainBtn.__wired = true;
      brainBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestAdminUnlock(() => {
          const a = document.createElement("a");
          a.href = "/api/brain/export?admin=" + encodeURIComponent(ADMIN_PASSWORD);
          a.download = "satoshi-council-brain.json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          const bs = document.getElementById("brainStatus");
          if (bs) bs.textContent = "Brain download started…";
        });
      });
    }
  }
  // Expose for any late handlers
  window.isAdminUnlocked = isAdminUnlocked;
  window.requestAdminUnlock = requestAdminUnlock;
  window.ADMIN_PASSWORD = ADMIN_PASSWORD;

  /* Admin-only desk extensions are fetched after Settings unlock. Not a public route. */
  let adminExtBooted = false;
  async function loadAdminDeskExtensions() {
    if (adminExtBooted || !isAdminUnlocked()) return;
    adminExtBooted = true;
    try {
      const r = await adminFetch("/api/desk/extensions", { credentials: "same-origin" });
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.html) {
        let host = document.getElementById("deskExtensions");
        if (!host) {
          host = document.createElement("div");
          host.id = "deskExtensions";
          document.body.appendChild(host);
        }
        host.innerHTML = d.html;
      }
      if (d && d.js) {
        const s = document.createElement("script");
        s.textContent = d.js;
        document.body.appendChild(s);
      }
    } catch (e) {}
  }
  window.loadAdminDeskExtensions = loadAdminDeskExtensions;
  if (isAdminUnlocked()) {
    try { loadAdminDeskExtensions(); } catch (e) {}
  }


  const overlay = document.getElementById("dashboardOverlay");
  const modeBtn = document.getElementById("modeToggle");
  const statusDot = document.getElementById("statusDot");
  const lastUpdateEl = document.getElementById("lastUpdate");
  const decisionDir = document.getElementById("decisionDir");
  const decisionConf = document.getElementById("decisionConf");
  const decisionSummary = document.getElementById("decisionSummary");
  const decisionPhase = document.getElementById("decisionPhase");
  const decisionLock = document.getElementById("decisionLock");
  const btcPrice = document.getElementById("btcPrice");
  const fundingEl = document.getElementById("funding");
  const kalshiTicker = document.getElementById("kalshiTicker");
  const accuracyBadge = document.getElementById("accuracyBadge");
  const accuracyPct = document.getElementById("accuracyPct");
  const accuracyFrac = document.getElementById("accuracyFrac");
  const accuracyStrip = document.getElementById("accuracyStrip");
  const lawBadge = document.getElementById("lawBadge");
  const lawStatus = document.getElementById("lawStatus");
  const debateLog = document.getElementById("debateLog");
  const candleCanvas = document.getElementById("candleChart");
  const candleCtx = candleCanvas ? candleCanvas.getContext("2d") : null;
  const candlePriceTag = document.getElementById("candlePriceTag");
  const soundToggle = document.getElementById("soundToggle");
  const chartsView = document.getElementById("chartsView");
  const mainTable = document.getElementById("mainTable");
  const modeTabs = document.querySelectorAll(".mode-tab");
  let celebratePlaying = false;
  function deskCinematicOn() {
    return !!(celebratePlaying || (document.body && document.body.classList.contains("zt-cinematic")));
  }

  // Same-origin on Render (UI served by FastAPI); override via localStorage if needed
  const API_BASE =
    localStorage.getItem("council_api") ||
    (typeof location !== "undefined" && location.protocol.startsWith("http") &&
     location.port !== "5500" && location.port !== "3000"
      ? ""  // same origin — /api/state
      : "http://127.0.0.1:8000");
  // Poll faster than analysis interval so UI stays live after each cycle

  // Chair portrait (eye color by direction) — armored knight
  const chairImages = {
    UP: new Image(),
    DOWN: new Image(),
    WAIT: new Image(),
  };
  let chairImgsReady = 0;
  function _chairLoaded() {
    chairImgsReady += 1;
    // force a frame so portrait appears as soon as assets arrive
  }
  ["UP", "DOWN", "WAIT"].forEach(k => {
    chairImages[k].crossOrigin = "anonymous";
    chairImages[k].onload = _chairLoaded;
    chairImages[k].onerror = () => console.warn("Chair image failed:", k);
  });
  chairImages.UP.src = "/chair-up.jpg";
  chairImages.DOWN.src = "/chair-down.jpg";
  chairImages.WAIT.src = "/chair-wait.jpg";

  const vitalikImages = { UP: new Image(), DOWN: new Image(), WAIT: new Image() };
  vitalikImages.UP.src = "/vitalik-up.jpg";
  vitalikImages.DOWN.src = "/vitalik-down.jpg";
  vitalikImages.WAIT.src = "/vitalik-wait.jpg";
  function vitalikPortraitFor(dir) {
    const d = String(dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return vitalikImages.UP;
    if (d === "DOWN" || d === "DOWN_HOLD") return vitalikImages.DOWN;
    return vitalikImages.WAIT;
  }
  chairImages.UP_HOLD = chairImages.UP;
  chairImages.DOWN_HOLD = chairImages.DOWN;
  chairImages.SWAP = chairImages.WAIT;

  function chairPortraitFor(dir) {
    const d = (dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return chairImages.UP;
    if (d === "DOWN" || d === "DOWN_HOLD") return chairImages.DOWN;
    return chairImages.WAIT;
  }


  // Desk-code gate stays up on a cold visit. Do not strip gate-locked here.
  document.body.classList.add("gate-locked");
  document.body.classList.remove("admin-unlocked");

  let POLL_MS = Number(localStorage.getItem("council_poll_ms")) || 800;
  let beastMode = localStorage.getItem("council_beast") !== "0";
  let callSfxOn = localStorage.getItem("council_call_sfx") !== "0";
  let teamLoopsOn = localStorage.getItem("council_team_loops") !== "0";
  let pollTimer = null;

  let applyingBeastChrome = false;
  let lastSettingsSnap = null;
  function paintBeastProfileLine(s) {
    const snap = s || lastSettingsSnap || {};
    const stats = document.getElementById("beastStats");
    if (!stats) return;
    const interval = snap.analysis_interval;
    const hot = snap.analysis_interval_hot;
    const dual = snap.dual_spot;
    if (beastMode) {
      stats.textContent = interval != null
        ? `Profile BEAST · cycle ${interval}s · hot ${hot}s · dual-spot ${dual ? "ON" : "OFF"}`
        : "Profile BEAST";
    } else {
      stats.textContent = interval != null
        ? `Profile STANDARD · cycle ${interval}s · dual-spot ${dual ? "ON" : "OFF"}`
        : "Profile STANDARD";
    }
  }
  function applyBeastChrome(on) {
    const loops = document.getElementById("teamLoopToggle");
    const loopsWas = loops ? !!loops.checked : null;
    const sfx = document.getElementById("callSfxToggle");
    const sfxWas = sfx ? !!sfx.checked : null;
    beastMode = !!on;
    applyingBeastChrome = true;
    document.body.classList.toggle("beast-mode", beastMode);
    const badge = document.getElementById("beastBadge");
    if (badge) {
      badge.classList.toggle("off", !beastMode);
      badge.setAttribute("aria-pressed", beastMode ? "true" : "false");
      badge.textContent = beastMode ? "BEAST" : "STD";
      badge.title = beastMode ? "BEAST MODE on — click to switch to Standard" : "Standard mode — click for BEAST";
    }
    const tog = document.getElementById("beastToggle");
    if (tog) tog.checked = beastMode;
    localStorage.setItem("council_beast", beastMode ? "1" : "0");
    const blurb = document.getElementById("beastBlurb");
    if (blurb) {
      blurb.textContent = beastMode
        ? "Max refresh · dual spot · parallel seats · premium HUD"
        : "Balanced cadence · single spot · power-friendly";
    }
    paintBeastProfileLine(lastSettingsSnap);
    if (loops && loopsWas != null) loops.checked = loopsWas;
    if (sfx && sfxWas != null) sfx.checked = sfxWas;
    applyingBeastChrome = false;
  }

  function applySettingsSnapshot(s, opts) {
    if (!s) return;
    opts = opts || {};
    // Poll / beast POST must not paint over in-progress Settings edits.
    // Save, Reset, and first open pass localToggles or force.
    if (typeof mode !== "undefined" && mode === "settings" && !opts.localToggles && !opts.force) {
      lastSettingsSnap = s;
      return;
    }
    lastSettingsSnap = s;
    const loops = document.getElementById("teamLoopToggle");
    const loopsWas = loops ? !!loops.checked : null;
    const sfx = document.getElementById("callSfxToggle");
    const sfxWas = sfx ? !!sfx.checked : null;
    if (typeof s.beast_mode === "boolean") applyBeastChrome(s.beast_mode);
    const L = s.learning || {};
    const T = s.trading || {};
    const H = s.huddle || {};
    const U = s.ui || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    set("setPathWin", L.path_win_pct);
    set("setHoldFrac", L.hold_fraction);
    set("setNearBar", L.near_certain_bar);
    set("setFadeMinN", L.fade_min_n);
    set("setFadeWr", L.fade_wr_threshold);
    set("setFadeCap", L.fade_max_weight_share);
    set("setAntiMin", L.anti_min_tries);
    set("setAntiWr", L.anti_win_rate);
    set("setAntiCap", L.anti_max_bonus);
    set("setMinConf", T.min_confluence);
    set("setMinDirConf", T.min_directional_conf);
    set("setTopN", T.top_n_agreement);
    set("setColdN", L.cold_start_samples);
    set("setCalN", L.calibrate_samples);
    set("setExpN", L.exploit_samples);
    set("setLawWrongs", T.law_lock_after_wrongs);
    set("setLawWindows", T.law_lock_windows);
    set("setLawShadow", T.law_shadow_early_unlock_rights);
    chk("setHuddleOn", H.enabled !== false);
    set("setHuddleHour", H.hour_ct);
    set("setHuddleDur", H.duration_minutes);
    set("setHuddleRebuild", H.rebuild_limit);
    chk("setSoundOn", U.sound_enabled !== false);
    chk("setSoundUp", U.sound_up !== false);
    chk("setSoundDown", U.sound_down !== false);
    chk("setSoundSwap", U.sound_swap !== false);
    chk("setSoundBell", U.sound_bell !== false);
    chk("setBeamGlow", U.beam_glow !== false);
    set("setWatermark", U.watermark_opacity);
    const AB = s.auto_bet || {};
    if (s.auto_bet) {
      chk("setAutoBetOn", AB.enabled);
      const modeEl = document.getElementById("setAutoBetMode");
      if (modeEl && AB.mode) modeEl.value = AB.mode;
      set("setAutoBetSize", AB.size);
      chk("setAutoBetBtc", AB.btc !== false);
      chk("setAutoBetEth", AB.eth !== false);
    }
    try { syncAutoBetVisibility(); } catch (e) {}
    if (U.watermark_opacity != null) {
      document.documentElement.style.setProperty("--zt-watermark-opacity", U.watermark_opacity);
    }
    // Timing / analysis profile fields
    set("setIntervalInput", s.analysis_interval);
    set("setHotInput", s.analysis_interval_hot);
    set("setFlatInput", s.analysis_interval_flat);
    set("setPollInput", s.ui_poll_ms);
    chk("setDualInput", s.dual_spot);
    chk("setParallelInput", s.parallel_agents);
    const blurb = document.getElementById("beastBlurb");
    if (blurb && (s.blurb || typeof s.beast_mode === "boolean")) {
      blurb.textContent = s.blurb || (beastMode
        ? "Max refresh · dual spot · parallel seats · premium HUD"
        : "Balanced cadence · single spot · power-friendly");
    }
    paintBeastProfileLine(s);
    // Call voice / Team-loops are independent of BEAST. Only apply them on
    // Save/Reset — a poll or beast toggle must not silently flip the other.
    if (opts.localToggles) {
      if (typeof U.call_sfx === "boolean") {
        callSfxOn = U.call_sfx;
        try { localStorage.setItem("council_call_sfx", callSfxOn ? "1" : "0"); } catch (e) {}
        if (sfx) sfx.checked = callSfxOn;
      }
      if (typeof U.team_loops === "boolean") {
        teamLoopsOn = U.team_loops;
        try { localStorage.setItem("council_team_loops", teamLoopsOn ? "1" : "0"); } catch (e) {}
        if (loops) loops.checked = teamLoopsOn;
      }
    } else {
      if (sfx && sfxWas != null) sfx.checked = sfxWas;
      if (loops && loopsWas != null) loops.checked = loopsWas;
    }
    const map = {
      setInterval: s.analysis_interval != null ? s.analysis_interval + "s" : "—",
      setHot: s.analysis_interval_hot != null ? s.analysis_interval_hot + "s" : "—",
      setFlat: s.analysis_interval_flat != null ? s.analysis_interval_flat + "s" : "—",
      setDual: s.dual_spot ? "ON" : "OFF",
      setParallel: s.parallel_agents ? "ON" : "OFF",
      setPoll: (s.ui_poll_ms || POLL_MS) + "ms",
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
    // UI poll follows server profile unless user forced localStorage
    if (!localStorage.getItem("council_poll_ms_forced")) {
      const next = Number(s.ui_poll_ms) || (s.beast_mode ? 800 : 2500);
      if (next !== POLL_MS) {
        POLL_MS = next;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = setInterval(poll, POLL_MS);
        }
      }
    }
  }
  applySettingsSnapshot._real = true;
  window.applySettingsSnapshot = applySettingsSnapshot;

  function syncExclusiveBodyMode(next) {
    const drop = [];
    Array.prototype.forEach.call(document.body.classList, function (c) {
      if (c === "floor-mode" || (c.length > 5 && c.indexOf("mode-") === 0)) drop.push(c);
    });
    drop.forEach(function (c) { document.body.classList.remove(c); });
    if (next) document.body.classList.add("mode-" + next);
    document.body.classList.toggle("floor-mode", next === "floor");
  }
  function syncExclusiveTabActive(next) {
    document.querySelectorAll(".mode-tab, .focus-tab").forEach((btn) => {
      if (btn.id === "focusBtc" || btn.id === "focusEth" || btn.id === "btnHelp" || !btn.dataset.mode) {
        btn.classList.remove("active");
        if (btn.hasAttribute("aria-selected")) btn.setAttribute("aria-selected", "false");
        return;
      }
      const on = btn.dataset.mode === next;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function stayOnSettings() {
    const sv = document.getElementById("settingsView");
    const showing = !!(sv && !sv.classList.contains("hidden"));
    if (mode !== "settings" && !showing) return;
    if (mode !== "settings") {
      try { setMode("settings"); } catch (e) {}
      return;
    }
    if (sv) sv.classList.remove("hidden");
    syncExclusiveBodyMode("settings");
    syncExclusiveTabActive("settings");
  }

  async function readSettingsJson(r) {
    const ct = String((r && r.headers && r.headers.get("content-type")) || "").toLowerCase();
    if (!ct.includes("json")) {
      throw new Error("settings route returned HTML, not JSON");
    }
    return r.json();
  }

  async function postSettingsJson(body, path) {
    const url = path || "/api/settings/save";
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (typeof isAdminUnlocked === "function" && isAdminUnlocked() && body && body.auto_bet) {
      headers["X-Council-Admin"] = ADMIN_PASSWORD;
    }
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });
    const s = await readSettingsJson(r);
    if (!r.ok && !s) throw new Error("HTTP " + r.status);
    return s;
  }

  async function fetchSettings() {
    try {
      const r = await fetch("/api/settings", { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      return await readSettingsJson(r);
    } catch (e) {
      return null;
    }
  }

  async function setBeastMode(on) {
    const loops = document.getElementById("teamLoopToggle");
    const loopsWas = loops ? !!loops.checked : teamLoopsOn;
    const sfx = document.getElementById("callSfxToggle");
    const sfxWas = sfx ? !!sfx.checked : callSfxOn;
    applyBeastChrome(on);
    if (loops) loops.checked = loopsWas;
    if (sfx) sfx.checked = sfxWas;
    paintBeastProfileLine(lastSettingsSnap);
    try {
      const s = await postSettingsJson({ beast_mode: !!on }, "/api/settings/save");
      if (s) {
        if (mode === "settings") {
          lastSettingsSnap = s;
          applyBeastChrome(!!on);
        } else {
          applySettingsSnapshot(s);
        }
        if (loops) loops.checked = loopsWas;
        if (sfx) sfx.checked = sfxWas;
        teamLoopsOn = loopsWas;
        callSfxOn = sfxWas;
        paintBeastProfileLine(s);
        stayOnSettings();
        return s;
      }
    } catch (e) {
      console.warn("beast toggle failed", e);
    }
    applyBeastChrome(on);
    if (loops) loops.checked = loopsWas;
    if (sfx) sfx.checked = sfxWas;
    paintBeastProfileLine(lastSettingsSnap);
    stayOnSettings();
    return null;
  }



  let mode = "art"; // art | dashboard | charts
  let state = null;
  let focusTable = (function(){ try { const v = localStorage.getItem("council_focus_table"); if (v === "ethereum" || v === "bitcoin") return v; } catch(e){} return "ethereum"; })();
  try { document.body.dataset.focusTable = focusTable; } catch (e) {}
  function tableState(which) {
    if (!state) return null;
    if (state.tables && state.tables[which]) return state.tables[which];
    if (which === "bitcoin" && state.btc) return state.btc;
    if (which === "ethereum" && state.eth) return state.eth;
    if (which === "bitcoin") return state;
    return null;
  }
  function isDualMode() {
    return !!(state && (
      state.dual ||
      (state.tables && (state.tables.ethereum || state.tables.bitcoin)) ||
      (state.btc && state.eth)
    ));
  }
  /** Focused view of dual state — NEVER mutates state.tables */
  function getViewState() {
    if (!state) return null;
    const focused = tableState(focusTable);
    if (!focused) {
      return Object.assign({}, state, { _focusTable: focusTable });
    }
    const lc = focused.locked_call || (focused.decision && focused.decision.locked_call) || null;
    return Object.assign({}, state, {
      decision: focused.decision || {},
      locked_call: lc || null,
      agents: Array.isArray(focused.agents) ? focused.agents : [],
      market: focused.market || {},
      accuracy: focused.accuracy || {},
      hierarchy: focused.hierarchy || [],
      learning: focused.learning || {},
      weights: focused.weights || (focused.learning && focused.learning.weights) || {},
      _focusTable: focusTable,
    });
  }

  function deskLockSnapshot() {
    function one(t) {
      if (!t) return { locked: false, direction: "", ticker: "" };
      const lc = t.locked_call || (t.decision && t.decision.locked_call) || {};
      const d = String(lc.direction || "").toUpperCase();
      const locked = !!(lc.locked && (d === "UP" || d === "DOWN"));
      const m = t.market || {};
      return {
        locked: locked,
        direction: locked ? d : "",
        ticker: m.kalshi_ticker || m.ticker || "",
        mins_left: (t.lock_timeline && t.lock_timeline.mins_left != null)
          ? t.lock_timeline.mins_left
          : m.mins_left,
      };
    }
    return {
      focus: focusTable === "bitcoin" ? "btc" : "eth",
      btc: one(typeof tableState === "function" ? tableState("bitcoin") : state),
      eth: one(typeof tableState === "function" ? tableState("ethereum") : null),
    };
  }
  window.__deskLockSnapshot = deskLockSnapshot;


  // Rolling series for Charts tab (built from poll snapshots)
  const series = {
    odds: [],      // {t, up, down}
    delta: [],     // {t, d} price - target
    funding: [],   // {t, f}
    tape: [],      // {t, dir, conf} live lean (lock history is separate)
    accuracy: [],  // {t, pct, n, correct} finish-only, n>0 only
    max: 90,
  };
  function pushSeries(arr, point) {
    arr.push(point);
    if (arr.length > series.max) arr.shift();
  }
  let particles = [];
  let rain = [];
  let animId = null;
  let time = 0;
  let glitchUntil = 0;
  let hourSlamUntil = 0;
  let debateHistory = [];
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let _tableEmberUntil = 0;
  let _tableEmberKey = "";
  let _tableEmberDir = "WAIT";
  // Parked lock flash — expanding ring on lock. Wired by noteChairLock.
  const sealFX = {
    bitcoin: { until: 0, dir: "WAIT" },
    ethereum: { until: 0, dir: "WAIT" },
  };
  const _sealSeen = { bitcoin: "", ethereum: "" };

  // Market-open bell — one ring per new hourly window
  let soundMuted = localStorage.getItem("council_bell_muted") === "1";
  let lastWindowKey = null;       // kalshi ticker or close_time
  let lastClockBucket = null;     // fallback: floor(unix / 900)
  let audioCtx = null;
  let bellArmed = false;          // need a user gesture before AudioContext

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    bellArmed = true;
    return audioCtx;
  }

  /** Synthesized exchange-style opening bell (no sample file / no copyright). */
  function playMarketBell() {
    if (soundMuted) return;
    try {
      if (typeof window.__floorMusicDuck === "function") window.__floorMusicDuck(2200);
    } catch (e) {}
    const ctx = ensureAudio();
    if (!ctx || !bellArmed) return;
    const now = ctx.currentTime;

    // Layered partials → bright metallic ding with short decay
    const partials = [
      { f: 880,  g: 0.55, d: 1.6 },
      { f: 1318, g: 0.32, d: 1.2 },
      { f: 1760, g: 0.18, d: 0.9 },
      { f: 440,  g: 0.22, d: 2.0 },
    ];
    partials.forEach(({ f, g, d }, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(f, now);
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(3200, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(g, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + d);
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + d + 0.05);
    });

    // Soft strike transient
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.15, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    noise.connect(ng);
    ng.connect(ctx.destination);
    noise.start(now);
  }


  /** Hour-open cue: short table ember, not a full-screen grape fog. */
  function playNewMarketMist() {
    try {
      if (window.__mistCtrl && typeof window.__mistCtrl.stop === "function") {
        try { window.__mistCtrl.stop(); } catch (e) {}
      }
      const wrap = document.getElementById("marketMist");
      if (wrap) wrap.classList.remove("active");
      const d = ((state && state.decision) || {}).direction || "WAIT";
      _tableEmberDir = String(d).toUpperCase();
      _tableEmberKey = "hour:" + Date.now();
      _tableEmberUntil = Date.now() + 1600;
    } catch (e) {}
  }
  function windowKeyFromState(s) {

    const m = (s && s.market) || {};
    if (m.kalshi_ticker) return String(m.kalshi_ticker);
    if (m.close_time) return String(m.close_time);
    return null;
  }

  function clockBucket(date = new Date()) {
    // Hourly UTC buckets aligned to clock
    return Math.floor(date.getTime() / (60 * 60 * 1000));
  }

  function maybeRingForNewWindow(s) {
    const key = windowKeyFromState(s);
    const bucket = clockBucket();

    // Prefer contract/ticker change from API
    if (key) {
      if (lastWindowKey == null) {
        lastWindowKey = key; // first observe — no ring (avoid bell on page load)
        lastClockBucket = bucket;
        return;
      }
      if (key !== lastWindowKey) {
        lastWindowKey = key;
        lastClockBucket = bucket;
        try { triggerHourSlam(); } catch (e) {}
        // Skip-window: previous chair was WAIT → awkward silence; else market bell
        try {
          const lastDir = (window.__lastChairDir || "WAIT").toUpperCase();
          if (lastDir === "WAIT" || lastDir === "HOLD") {
            playSkipCricketsSfx();
          } else {
            playMarketBell();
          }
        } catch (e) {
          playMarketBell();
        }
        playNewMarketMist();
        return;
      }
    }

    // Fallback: pure clock boundary if no ticker yet
    if (lastClockBucket == null) {
      lastClockBucket = bucket;
      return;
    }
    if (bucket !== lastClockBucket) {
      lastClockBucket = bucket;
      try { triggerHourSlam(); } catch (e) {}
      playMarketBell();
      playNewMarketMist();
    }
  }


  /** Soft UI click for tutorial / buttons */
  function playSfxClick() {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(660, now);
    o.frequency.exponentialRampToValueAtTime(420, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 0.14);
  }

  /** Soft whoosh / page turn for tutorial next */
  function playSfxWhoosh() {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.28);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const e = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * e * e * 0.55;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(400, now);
    f.frequency.exponentialRampToValueAtTime(1800, now + 0.22);
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(now);
  }

  /** Deep fog drone during summon */
  function playSfxFogDrone(seconds) {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = seconds || 1.2;
    [55, 82.5, 110].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.setValueAtTime(f, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.045 - i * 0.01, now + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(now); o.stop(now + dur + 0.05);
    });
  }

  /** Ethereal chime on each summon line */
  function playSfxSummonChime(index) {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const base = 220 * Math.pow(1.25, (index || 0) % 5);
    [1, 1.5, 2].forEach((mult, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(base * mult, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.1 / (i + 1), now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1 - i * 0.15);
      o.connect(g); g.connect(ctx.destination);
      o.start(now); o.stop(now + 1.2);
    });
  }

  /** Final reveal — low gong + high sparkle */
  let lastSpokenDir = null;
  (function wireLocalSettingsToggles() {
    const sfx = document.getElementById("callSfxToggle");
    const loops = document.getElementById("teamLoopToggle");
    if (sfx) {
      sfx.checked = callSfxOn;
      if (!sfx.__wired) {
        sfx.__wired = true;
        sfx.addEventListener("click", (e) => e.stopPropagation());
        sfx.addEventListener("change", (e) => {
          e.stopPropagation();
          callSfxOn = !!sfx.checked;
          localStorage.setItem("council_call_sfx", callSfxOn ? "1" : "0");
        });
      }
    }
    if (loops) {
      loops.checked = teamLoopsOn;
      if (!loops.__wired) {
        loops.__wired = true;
        loops.addEventListener("click", (e) => e.stopPropagation());
        loops.addEventListener("change", (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          teamLoopsOn = !!loops.checked;
          localStorage.setItem("council_team_loops", teamLoopsOn ? "1" : "0");
        });
      }
    }
  })();

  /** Speak-ish synthesized call: UP / DOWN / WAIT / SWAP */
  function playCallVoice(dir) {
    try { window.__lastChairDir = dir; } catch (e) {}
    if (soundMuted || !callSfxOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const map = {
      UP: [523.25, 659.25, 783.99],
      DOWN: [392.0, 329.63, 261.63],
      UP_HOLD: [523.25, 659.25],
      DOWN_HOLD: [392.0, 329.63],
      SWAP: [440, 554.37, 440, 659.25],
      WAIT: [300, 280],
    };
    const freqs = map[dir] || map.WAIT;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, now + i * 0.11);
      g.gain.setValueAtTime(0.0001, now + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.14, now + i * 0.11 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.28);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + i * 0.11);
      o.stop(now + i * 0.11 + 0.32);
    });
  }

  function playSfxReveal() {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(98, now);
    o.frequency.exponentialRampToValueAtTime(55, now + 1.8);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 2.3);
    // sparkle
    [1320, 1760, 2090].forEach((f, i) => {
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = "sine";
      o2.frequency.setValueAtTime(f, now + 0.15 + i * 0.07);
      g2.gain.setValueAtTime(0.0001, now + 0.15 + i * 0.07);
      g2.gain.exponentialRampToValueAtTime(0.08, now + 0.18 + i * 0.07);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.9 + i * 0.1);
      o2.connect(g2); g2.connect(ctx.destination);
      o2.start(now + 0.15 + i * 0.07);
      o2.stop(now + 1.1 + i * 0.1);
    });
  }

  function syncSoundButton() {
    if (!soundToggle) return;
    soundToggle.classList.toggle("muted", soundMuted);
    soundToggle.setAttribute("aria-pressed", soundMuted ? "true" : "false");
    soundToggle.textContent = soundMuted ? "🔇 Bell" : "🔔 Bell";
    soundToggle.title = soundMuted
      ? "Unmute market open bell"
      : "Mute market open bell";
  }
  syncSoundButton();

  const AGENT_ORDER = ["candle", "volume", "momentum", "orderflow", "funding", "regime", "volatility", "oi_pressure", "streak", "odds", "strike", "session_tod", "whale", "quorum", "panic", "cheap", "spotlag", "news", "liq", "exhaust", "guardian", "law"];
  // Cool callsigns — internal keys stay the same for API/weights
  const AGENT_LABELS = {
    candle: "WICK",
    volume: "PULSE",
    momentum: "DRIFT",
    orderflow: "TAPE",
    funding: "CARRY",
    regime: "ORBIT",
    volatility: "VOLT",
    oi_pressure: "CHAIN",
    streak: "STREAK",
    odds: "ODDS",
    strike: "STRIKE",
    session_tod: "CLOCK",
    whale: "WHALE",
    quorum: "QUORUM",
    panic: "FADE",
    cheap: "CHEAP",
    spotlag: "VEL",
    exhaust: "EXHAUST",
    news: "WIRE",
    liq: "CASCADE",
    guardian: "WARDEN",
    law: "LAW",
    leader: "SATOSHI",
    chair: "SATOSHI",
  };
  const AGENT_TITLES = {
    candle: "Pattern Seer",
    volume: "Flow Reader",
    momentum: "Trend Scout",
    orderflow: "Book Walker",
    funding: "Rate Oracle",
    regime: "Regime Watch",
    volatility: "Vol Scout",
    oi_pressure: "OI Pressure",
    streak: "Path Reader",
    odds: "Kalshi Skew",
    strike: "Strike Scout",
    session_tod: "Session Clock",
    whale: "Whale Tape",
    quorum: "Floor Count",
    panic: "Panic Fade",
    cheap: "Value Side",
    spotlag: "Spot Lag",
    exhaust: "Run Fade",
    guardian: "System Guard",
    law: "Enforcer",
    leader: "The Gavel",
    chair: "Satoshi",
  };
  const SUB_LABELS = {
    body: "CORE",
    structure: "FRAME",
    pin: "PIN",
    engulf: "SWALLOW",
    marubozu: "BLADE",
    doji: "VOID",
    star: "TRINE",
    spike: "SURGE",
    dryup: "ECHO",
    rsi: "RIFT",
    macd: "SWING",
    book: "LEDGER",
    taker: "EDGE",
    rate: "YIELD",
    crowding: "SWARM",
    session: "CLOCK",
    volband: "BAND",
    binance_feed: "NODE-B",
    kalshi_feed: "NODE-K",
  };

  function labelOf(agent) {
    if (!agent) return "—";
    if (agent.display_name) return agent.display_name;
    const key = agent.agent_name || agent;
    if (AGENT_LABELS[key]) return AGENT_LABELS[key];
    if (typeof key === "string" && key.includes(".")) {
      const sid = key.split(".")[1];
      return SUB_LABELS[sid] || sid.toUpperCase();
    }
    return String(key).toUpperCase();
  }

  function titleOf(agent) {
    if (!agent) return "";
    if (agent.title) return agent.title;
    const key = agent.agent_name || agent;
    return AGENT_TITLES[key] || "";
  }

  // High-tech cyberpunk knight / samurai palette
  const CYAN = "#00e8ff";       // katana edge
  const MAGENTA = "#ff00aa";    // plasma
  const ACID = "#39ff14";       // UP jade
  const HOT_RED = "#ff2d55";    // blood-steel
  const VIOLET = "#a855f7";
  const GOLD = "#f0c14a";       // ceremonial armor

  function resize() {
    if (deskCinematicOn()) return;
    const stage = document.getElementById("tableStage");
    const maxW = Math.min(1200, (stage?.clientWidth || window.innerWidth) - 12);
    const maxH = Math.min(820, (stage?.clientHeight || window.innerHeight - 140) - 8);
    canvas.width = Math.max(320, maxW);
    canvas.height = Math.max(280, maxH);
    initRain();
    resizeCandleChart();
    drawCandleChart();
    renderHierarchy();
  }
  window.addEventListener("resize", resize);
  // Defer first resize until layout is ready
  requestAnimationFrame(resize);

  function initRain() {
    rain = [];
    const count = Math.floor((canvas.width * canvas.height) / 18000);
    for (let i = 0; i < count; i++) {
      rain.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: 0.4 + Math.random() * 1.8,
        len: 6 + Math.random() * 14,
        alpha: 0.08 + Math.random() * 0.18,
        char: Math.random() > 0.7 ? "1" : "0",
      });
    }
  }

  function displayDir(dir) {
    if (dir === "UP_HOLD") return "1/4 UP HOLD";
    if (dir === "DOWN_HOLD") return "1/4 DOWN HOLD";
    return dir || "WAIT";
  }


  // ——— Bot seat logos (circular, color outline follows call) ———
  const BOT_ICON_FILES = {
    candle: "/bots/wick.png",
    volume: "/bots/pulse.png",
    momentum: "/bots/drift.png",
    orderflow: "/bots/tape.png",
    funding: "/bots/carry.png",
    regime: "/bots/orbit.png",
    volatility: "/bots/volt.png",
    oi_pressure: "/bots/chain.png",
    streak: "/bots/streak.png",
    odds: "/bots/odds.png",
    strike: "/bots/strike.png",
    session_tod: "/bots/clock.png",
    whale: "/bots/whale.png",
    quorum: "/bots/quorum.png",
    panic: "/bots/fade.png",
    cheap: "/bots/cheap.png",
    spotlag: "/bots/vel.png",
    exhaust: "/bots/exhaust.png",
    news: "/bots/wire.png",
    liq: "/bots/cascade.png",
    guardian: "/bots/warden.png",
    law: "/bots/law.png",
  };
  const botIconCache = {}; // name -> HTMLImageElement | null
  let botIconsReady = false;

  function preloadBotIcons() {
    const keys = Object.keys(BOT_ICON_FILES);
    let left = keys.length;
    if (!left) { botIconsReady = true; return; }
    keys.forEach((k) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        botIconCache[k] = img;
        left -= 1;
        if (left <= 0) botIconsReady = true;
      };
      img.onerror = () => {
        botIconCache[k] = null;
        left -= 1;
        if (left <= 0) botIconsReady = true;
      };
      img.src = BOT_ICON_FILES[k];
    });
  }
  preloadBotIcons();

  /** Draw circular bot logo with direction-colored ring outline. */
  function drawBotIcon(name, x, y, r, dirColor, conf) {
    const img = botIconCache[name];
    const ringR = r + 2;
    // Dark plate behind
    ctx.beginPath();
    ctx.arc(x, y, ringR + 1, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(4, 8, 16, 0.95)";
    ctx.fill();

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      const d = r * 2;
      ctx.drawImage(img, x - r, y - r, d, d);
      ctx.restore();

      // Soft color wash on outline only: draw a thin inner rim in call color
      // (logo stays mostly original; ring + soft edge take the signal color)
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = dirColor;
      ctx.globalAlpha = 0.35 + Math.min(0.45, (conf || 0) / 200);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    } else {
      // fallback core while loading
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = dirColor;
      ctx.fill();
    }

    // Outer signal ring (the "outline turns the color")
    ctx.beginPath();
    ctx.arc(x, y, ringR + 1, 0, Math.PI * 2);
    ctx.strokeStyle = dirColor;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = dirColor;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Thin ceremonial gold trim outside
    ctx.beginPath();
    ctx.arc(x, y, ringR + 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(240, 193, 74, 0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }


  function colorFor(dir, conf) {
    if (dir === "UP") {
      const a = 0.4 + (conf / 100) * 0.6;
      return `rgba(57, 255, 20, ${a})`;
    }
    if (dir === "DOWN") {
      const a = 0.4 + (conf / 100) * 0.6;
      return `rgba(255, 45, 85, ${a})`;
    }
    if (dir === "SWAP") {
      const a = 0.45 + (conf / 100) * 0.5;
      return `rgba(240, 193, 74, ${a})`;
    }
    if (dir === "UP_HOLD") {
      const a = 0.35 + (conf / 100) * 0.45;
      return `rgba(57, 255, 20, ${a})`;
    }
    if (dir === "DOWN_HOLD") {
      const a = 0.35 + (conf / 100) * 0.45;
      return `rgba(255, 45, 85, ${a})`;
    }
    return `rgba(0, 232, 255, ${0.35 + (conf / 100) * 0.25})`;
  }

  function strongColor(dir) {
    if (dir === "UP" || dir === "UP_HOLD") return ACID;
    if (dir === "DOWN" || dir === "DOWN_HOLD") return HOT_RED;
    if (dir === "SWAP") return GOLD;
    return CYAN;
  }

  function spawnParticles(from, to, color) {
    for (let i = 0; i < 4; i++) {
      particles.push({
        x: from.x, y: from.y,
        tx: to.x, ty: to.y,
        life: 1,
        color,
        speed: 0.018 + Math.random() * 0.015,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  function drawHex(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + r * Math.cos(a);
      const py = y + r * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function triggerHourSlam() {
    hourSlamUntil = Date.now() + 1100;
    document.body.classList.add("hour-slam");
    const el = document.getElementById("hourSlam");
    if (el) {
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
    }
    setTimeout(() => {
      document.body.classList.remove("hour-slam");
      if (el) {
        el.hidden = true;
        el.setAttribute("aria-hidden", "true");
      }
    }, 1100);
  }

  function secondsLeftOf(m) {
    if (!m) return null;
    let secs = m.seconds_left != null ? m.seconds_left : m.time_remaining;
    if (secs == null && m.close_time) {
      secs = (new Date(m.close_time) - Date.now()) / 1000;
    }
    if (secs == null || isNaN(secs)) {
      const bucket = 3600;
      secs = bucket - ((Date.now() / 1000) % bucket);
    }
    return Math.max(0, Number(secs));
  }

  function hourFillFrac(m) {
    const secs = secondsLeftOf(m);
    if (secs == null) return 0.5;
    return 1 - Math.max(0, Math.min(1, secs / 3600));
  }

  function majorityDirOf(agents) {
    let up = 0, down = 0, wait = 0;
    (agents || []).forEach((a) => {
      if (!a || a.agent_name === "leader") return;
      const d = String(a.direction || "WAIT").toUpperCase();
      if (d === "UP" || d === "UP_HOLD") up++;
      else if (d === "DOWN" || d === "DOWN_HOLD") down++;
      else wait++;
    });
    if (up > down && up >= wait) return "UP";
    if (down > up && down >= wait) return "DOWN";
    return "WAIT";
  }

  function spokeEnd(x0, y0, x1, y1, stopR) {
    const dx = x0 - x1, dy = y0 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const r = Math.min(stopR, dist - 2);
    return { x: x1 + (dx / dist) * r, y: y1 + (dy / dist) * r };
  }

  let _tableWisps = null;

  function smokeTone(dir) {
    const d = String(dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return { r: 28, g: 118, b: 52 };
    if (d === "DOWN" || d === "DOWN_HOLD") return { r: 148, g: 22, b: 36 };
    return { r: 32, g: 78, b: 132 };
  }

  function noteTableEmber(key, dir) {
    if (!key || key === _tableEmberKey) return;
    _tableEmberKey = key;
    _tableEmberDir = String(dir || "WAIT").toUpperCase();
    _tableEmberUntil = Date.now() + 1400;
  }

  function ensureTableWisps() {
    if (_tableWisps) return _tableWisps;
    const n = reduceMotion ? 5 : 8;
    _tableWisps = [];
    for (let i = 0; i < n; i++) {
      _tableWisps.push({
        a0: (i / n) * Math.PI * 2,
        drift: 0.00006 + (i % 3) * 0.000025,
        dist: 0.76 + (i % 4) * 0.05,
        stretch: 0.19 + (i % 3) * 0.045,
        fat: 0.042 + (i % 2) * 0.018,
        phase: i * 1.7,
        waitSpeck: i === 2 || i === 6,
      });
    }
    return _tableWisps;
  }

  function drawTableSmoke(cx, cy, tableR, dir) {
    if (!ctx || !tableR) return;
    const tone = smokeTone(dir);
    const wisps = ensureTableWisps();
    ctx.save();
    // Annulus on the deck — hole for the Chair, never a room wash
    ctx.beginPath();
    ctx.arc(cx, cy + tableR * 0.10, tableR * 1.06, 0, Math.PI * 2);
    ctx.arc(cx, cy, tableR * 0.58, 0, Math.PI * 2, true);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(cx - tableR * 1.2, cy - tableR * 0.02, tableR * 2.4, tableR * 1.35);
    ctx.clip();

    for (let i = 0; i < wisps.length; i++) {
      const w = wisps[i];
      const ang = w.a0 + time * w.drift;
      const pulse = 0.84 + 0.16 * Math.sin(time * 0.00082 + w.phase);
      const x = cx + Math.cos(ang) * tableR * w.dist;
      const y = cy + tableR * 0.30 + Math.sin(ang) * tableR * w.dist * 0.36;
      const rw = tableR * w.stretch * pulse;
      const rh = tableR * w.fat * pulse;
      let cr = tone.r, cg = tone.g, cb = tone.b;
      let a = 0.10 * pulse;
      if (String(dir || "WAIT").toUpperCase() === "WAIT" && w.waitSpeck) {
        cr = 88; cg = 48; cb = 118;
        a *= 0.4;
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, rw);
      g.addColorStop(0, "rgba(" + cr + "," + cg + "," + cb + "," + a + ")");
      g.addColorStop(0.52, "rgba(" + cr + "," + cg + "," + cb + "," + (a * 0.26) + ")");
      g.addColorStop(1, "rgba(2,4,10,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rw, rh, ang * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (reduceMotion || Date.now() >= _tableEmberUntil) return;
    const span = 1400;
    const t = 1 - (_tableEmberUntil - Date.now()) / span;
    const fade = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
    if (fade <= 0.01) return;
    const ember = smokeTone(_tableEmberDir);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const u = (i / 5 + t * 0.35) % 1;
      const lift = u * tableR * 0.40;
      const wobble = Math.sin(time * 0.007 + i * 1.3) * tableR * 0.035;
      const x = cx + wobble;
      const y = cy + tableR * 0.36 - lift;
      const rad = 3 + (1 - u) * 5;
      const a = fade * 0.20 * (1 - u);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
      g.addColorStop(0, "rgba(255,168,64," + a + ")");
      g.addColorStop(0.4, "rgba(" + (ember.r + 36) + "," + (ember.g + 16) + "," + ember.b + "," + (a * 0.45) + ")");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = fade * 0.14;
    ctx.strokeStyle = "rgba(255, 186, 88, 0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx + Math.sin(time * 0.018) * 3, cy + tableR * 0.08 - t * tableR * 0.18, tableR * 0.20, tableR * 0.05, 0.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawMajorityHaze(cx, cy, r, dir) {
    drawTableSmoke(cx, cy, r, dir);
  }

  function drawHourRing(cx, cy, r, frac, color) {
    const start = -Math.PI / 2;
    const fill = Math.max(0.02, Math.min(1, frac));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(180, 210, 230, 0.14)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + Math.PI * 2 * fill);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineCap = "butt";
  }

  const _seatTick = Object.create(null);
  function markSeatTick(key, dir, conf) {
    const k = String(key || "");
    const d = String(dir || "WAIT");
    const c = Number(conf) || 0;
    const prev = _seatTick[k];
    if (!prev || prev.dir !== d || prev.conf !== c) {
      _seatTick[k] = { dir: d, conf: c, at: Date.now() };
      return true;
    }
    return (Date.now() - prev.at) < 2200;
  }

  function drawPacketSpoke(x0, y0, x1, y1, color, conf, agree, fresh) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy) || 1;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.18 + Math.min(0.32, (conf || 0) / 220);
    ctx.lineWidth = agree ? 2.8 : 1.55;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // Visual pulse stays on when Bell is muted; only reduced-motion freezes packets
    if (reduceMotion) {
      ctx.restore();
      return;
    }
    const fast = !!(agree || fresh);
    const speed = fast ? 0.0044 : 0.0019;
    const dash = 12;
    const gap = 18;
    ctx.globalAlpha = fast ? 0.82 : 0.55;
    ctx.lineWidth = agree ? 2.3 : 1.45;
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -((time * speed * dist) % (dash + gap));
    ctx.shadowColor = color;
    ctx.shadowBlur = fast ? 16 : 8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    const n = fast ? 3 : 2;
    const nx = dx / dist, ny = dy / dist;
    for (let i = 0; i < n; i++) {
      const t = ((time * speed * 0.62) + i / n) % 1;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      ctx.globalAlpha = 0.95;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = color;
      ctx.lineWidth = fast ? 3.6 : 2.5;
      ctx.beginPath();
      ctx.moveTo(x - nx * 8, y - ny * 8);
      ctx.lineTo(x + nx * 6, y + ny * 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, fast ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGameBot(name, x, y, r, dir, conf, faceAng, phase) {
    const breathe = reduceMotion ? 1 : (1 + 0.08 * Math.sin(time * 0.0042 + (phase || 0)));
    const rr = r * breathe;
    const sc = strongColor(dir);
    ctx.save();
    ctx.translate(x, y);
    if (faceAng != null) ctx.rotate(faceAng + Math.PI / 2);
    drawHex(0, 0, rr + 7);
    ctx.fillStyle = "rgba(4, 8, 16, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(240, 193, 74, 0.55)";
    ctx.lineWidth = 1.7;
    ctx.stroke();
    drawHex(0, 0, rr + 3.5);
    ctx.strokeStyle = sc;
    ctx.lineWidth = 2.6;
    ctx.shadowColor = sc;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
    try {
      drawBotIcon(name, x, y, rr, sc, conf || 0);
    } catch (e) {
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = sc;
      ctx.fill();
    }
  }

  function drawHourSlamRings(cx, cy, r) {
    if (Date.now() >= hourSlamUntil || reduceMotion) return;
    const a = Math.max(0, (hourSlamUntil - Date.now()) / 1100);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(240, 193, 74, 0.95)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r + (1 - a) * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0, 232, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7 + (1 - a) * 110, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function accRecord(acc) {
    const c = (acc && acc.correct) || 0;
    const w = (acc && acc.wrong) != null ? acc.wrong : Math.max(0, ((acc && acc.total) || 0) - c);
    return { c, w };
  }

  function scorecardFromState() {
    if (state && state.scorecard && typeof state.scorecard === "object") {
      return state.scorecard;
    }
    const btcAcc = ((typeof tableState === "function" ? tableState("bitcoin") : null) || state || {}).accuracy || {};
    const ethAcc = ((typeof tableState === "function" ? tableState("ethereum") : null) || {}).accuracy || {};
    const btc = accRecord(btcAcc);
    const sh = (ethAcc && ethAcc.eth_shadow) || {};
    const ethC = Number(sh.hits) || 0;
    const ethN = Number(sh.n) || 0;
    const ethW = sh.wrong != null ? Number(sh.wrong) || 0 : Math.max(0, ethN - ethC);
    let match = "TIED " + btc.c + "–" + ethC;
    let line = "Split night. Neither chair blinks.";
    let ahead = "tied";
    if (btc.c > ethC) {
      ahead = "satoshi";
      match = "SATOSHI LEADS " + btc.c + "–" + ethC;
      line = "Satoshi is printing. Vitalik is watching.";
    } else if (ethC > btc.c) {
      ahead = "vitalik";
      match = "VITALIK LEADS " + ethC + "–" + btc.c;
      line = "Vitalik took the night. Satoshi can chase.";
    } else if ((btc.c + btc.w + ethC + ethW) > 0 && btc.w < ethW) {
      line = "Tied on hits. Fewer scars on the BTC table.";
    } else if ((btc.c + btc.w + ethC + ethW) > 0 && ethW < btc.w) {
      line = "Tied on hits. ETH table is cleaner tonight.";
    }
    return {
      paper: true,
      ahead: ahead,
      match: match,
      line: line,
      satoshi: "SATOSHI " + btc.c + "–" + btc.w,
      vitalik: ethC + "–" + ethW + " VITALIK",
    };
  }

  function updateRivalryStrip() {
    const strip = document.getElementById("rivalryStrip");
    if (!strip) return;
    const onFloor = mode === "floor";
    strip.hidden = !onFloor;
    if (!onFloor) return;
    const sc = scorecardFromState();
    const sat = document.getElementById("rivalSat");
    const vit = document.getElementById("rivalVit");
    const lead = document.getElementById("rivalLead");
    const trash = document.getElementById("rivalTrash");
    if (sat) sat.textContent = sc.satoshi || "SATOSHI 0–0";
    if (vit) vit.textContent = sc.vitalik || "0–0 VITALIK";
    if (lead) lead.textContent = sc.match || "TIED 0–0";
    if (trash) trash.textContent = sc.line || "";
    strip.classList.remove("ahead-satoshi", "ahead-vitalik", "ahead-tied");
    strip.classList.add("ahead-" + (sc.ahead || "tied"));
  }

  function containPortrait(img, cx, cy, r) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const side = r * 2;
    const contain = Math.min(side / iw, side / ih);
    const cover = Math.max(side / iw, side / ih);
    // Fill the Chair seat; slight cover kills the empty frame without chopping the face
    const scale = contain + (cover - contain) * 0.82;
    const dw = iw * scale, dh = ih * scale;
    const faceBias = Math.min(r * 0.08, Math.max(0, (dh - side) / 2));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2 - faceBias, dw, dh);
    ctx.restore();
    return true;
  }

  function chairKeyOf(which) {
    return which === "ethereum" ? "ethereum" : "bitcoin";
  }

  function noteChairLock(which, lc) {
    const key = chairKeyOf(which);
    const side = String((lc && lc.direction) || "").toUpperCase();
    const locked = !!(lc && lc.locked && (side === "UP" || side === "DOWN"));
    const stamp = locked ? String(lc.ticker || lc.locked_at || lc.close_time || side) : "";
    if (locked && stamp && _sealSeen[key] !== stamp) {
      _sealSeen[key] = stamp;
      sealFX[key] = { until: Date.now() + 1100, dir: side };
    }
    if (!locked) _sealSeen[key] = "";
  }

  function chairThinkRate(st, dir, locked, which) {
    const sfx = sealFX[chairKeyOf(which)];
    const punching = !!(sfx && sfx.until > Date.now());
    const huddle = (st && st.huddle) || (state && state.huddle) || {};
    const raw = String(dir || "WAIT").toUpperCase();
    const wait = !locked && raw.indexOf("WAIT") >= 0;
    let rate = wait ? 0.52 : 1;
    if (huddle.in_huddle) rate = 1.65;
    else if (typeof beastMode !== "undefined" && beastMode && !wait) rate = 1.25;
    if (locked) rate = Math.max(rate, 1.15);
    if (punching) rate = 2.2;
    return rate;
  }

  function drawChairThink(cx, cy, photoR, seatR, opts) {
    // Chair thinking HUD. Fills the empty annulus from the photo out to the
    // seat circle: slow radar sweep + orbiting ticks (game HUD, not a spinner gif).
    // Portrait idle: soft glow pulse, occasional eye/ember flicker.
    // Faster when analysis is hot, punch on lock (parked lock flash).
    // WAIT hours stay ambient, not frozen. Don't cover the face.
    // Phone: keep it cheap (CSS/canvas, no huge video).
    if (!ctx || !photoR || !seatR || seatR <= photoR + 3) return;
    opts = opts || {};
    const which = opts.which;
    const dir = String(opts.dir || "WAIT").toUpperCase();
    const locked = !!opts.locked;
    const st = opts.st || {};
    const key = chairKeyOf(which);
    const phone = (typeof isPhoneDesk === "function") ? isPhoneDesk() : false;
    const rate = chairThinkRate(st, dir, locked, which);
    const wait = !locked && dir.indexOf("WAIT") >= 0;
    const sfx = sealFX[key];
    const punching = !!(sfx && sfx.until > Date.now() && !reduceMotion);
    const gold = "rgba(240, 193, 74, 0.95)";
    const hue = (locked || punching) ? gold
      : (dir === "UP" || dir === "UP_HOLD") ? "rgba(0, 255, 120, 0.75)"
      : (dir === "DOWN" || dir === "DOWN_HOLD") ? "rgba(255, 55, 90, 0.75)"
      : (which === "ethereum" ? "rgba(120, 255, 160, 0.55)" : "rgba(0, 220, 255, 0.62)");
    const inner = photoR + 3;
    const outer = seatR - 2;
    const mid = (inner + outer) / 2;
    const band = Math.max(2.5, outer - inner);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    ctx.clip();

    if (!reduceMotion) {
      const sweep = time * 0.00032 * rate;
      const span = wait ? 0.70 : 0.95;
      ctx.strokeStyle = hue;
      ctx.lineCap = "round";
      ctx.lineWidth = phone ? Math.min(5, band * 0.42) : Math.min(8, band * 0.50);
      ctx.globalAlpha = (wait ? 0.22 : 0.36) * (punching ? 1.35 : 1);
      ctx.beginPath();
      ctx.arc(cx, cy, mid, sweep, sweep + span);
      ctx.stroke();
      if (!phone) {
        ctx.globalAlpha *= 0.45;
        ctx.lineWidth *= 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, mid, sweep - 0.55, sweep);
        ctx.stroke();
      }
    }

    const n = (phone || reduceMotion) ? 6 : 12;
    const orbit = reduceMotion ? 0 : (-time * 0.00018 * rate);
    ctx.globalAlpha = wait ? 0.28 : 0.48;
    ctx.strokeStyle = hue;
    ctx.lineWidth = phone ? 1.2 : 1.6;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = orbit + (i / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const r0 = inner + 1;
      const r1 = inner + 1 + band * (i % 3 === 0 ? 0.62 : 0.40);
      ctx.moveTo(cx + c * r0, cy + s * r0);
      ctx.lineTo(cx + c * r1, cy + s * r1);
    }
    ctx.stroke();
    ctx.restore();

    const pulse = reduceMotion ? 0.7 : (0.55 + 0.45 * Math.sin(time * 0.0024 * rate));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, photoR + 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = hue;
    ctx.globalAlpha = (wait ? 0.20 : 0.32) + 0.18 * pulse;
    ctx.lineWidth = locked ? 2.4 : 1.8;
    if (!phone && !reduceMotion) {
      ctx.shadowColor = hue;
      ctx.shadowBlur = 8 + 7 * pulse;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    if (!reduceMotion && !phone) {
      const seed = key === "ethereum" ? 2.1 : 0.7;
      const phase = (time * 0.00105 * rate + seed) % (wait ? 11 : 7);
      if (phase < 0.14 || punching) {
        const eyeY = cy - photoR * 0.16;
        const spread = photoR * 0.21;
        const a = punching ? 0.55 : (0.22 + 0.35 * (1 - phase / 0.14));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.max(0, Math.min(0.6, a));
        ctx.fillStyle = (punching || locked) ? "rgba(255, 190, 80, 0.9)" : hue;
        [[-spread, 0], [spread, 0]].forEach((p) => {
          ctx.beginPath();
          ctx.arc(cx + p[0], eyeY, Math.max(1.2, photoR * 0.028), 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }
    } else if (!reduceMotion && phone && punching) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(cx, cy - photoR * 0.16, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (punching) {
      const a = Math.max(0, (sfx.until - Date.now()) / 1100);
      ctx.save();
      ctx.globalAlpha = Math.min(0.95, a + 0.2);
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(cx, cy, photoR + 6 + (1 - a) * 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }


  function resizeRoundtable() {
    if (!canvas) return;
    const stage = document.getElementById("tableStage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(320, Math.floor(rect.height));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    }
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function cssCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sx = (ctx && ctx.getTransform) ? (ctx.getTransform().a || dpr) : dpr;
    return {
      w: canvas.width / (sx || 1) || parseFloat(canvas.style.width) || 320,
      h: canvas.height / (sx || 1) || parseFloat(canvas.style.height) || 320,
    };
  }
  function lawLocked() {
    const law = (state && state.law) || {};
    return !!(law.lockdown || (law.lockdown_remaining > 0) || law.find_out_mode);
  }

  function effectiveDir(dir) {
    if (lawLocked()) return "LOCKED";
    return (dir || "WAIT").toUpperCase();
  }

  let __wasLawLocked = false;
  function maybePlayJailDoor() {
    const locked = lawLocked();
    if (locked && !__wasLawLocked) {
      playJailDoorSound();
    }
    __wasLawLocked = locked;
  }

  function playSampleSfx(url, volume) {
    try {
      if (soundMuted) return;
      ensureAudio();
      const a = new Audio(url);
      a.volume = Math.max(0, Math.min(1, volume == null ? 0.55 : volume));
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  function playJailDoorSound() {
    // Lockdown → police siren sample
    playSampleSfx("/static/sfx/lockdown-siren.mp3", 0.5);
  }

  function playWinCashSfx() {
    playSampleSfx("/static/sfx/win-cash.mp3", 0.6);
  }

  function playLoseTromboneSfx() {
    playSampleSfx("/static/sfx/lose-trombone.mp3", 0.55);
  }

  function playSkipCricketsSfx() {
    playSampleSfx("/static/sfx/skip-crickets.mp3", 0.45);
  }



  function isPhoneDesk() {
    try {
      return !!(window.matchMedia && window.matchMedia("(max-width: 480px)").matches);
    } catch (e) {
      return window.innerWidth <= 480;
    }
  }
  function floorIsSingle() {
    if (isPhoneDesk()) return true;
    const stage = document.getElementById("tableStage");
    const cssW = (stage && stage.clientWidth) || window.innerWidth || 0;
    return cssW < 720;
  }
  function syncFloorExitBtn() {
    const btn = document.getElementById("floorExitBtn");
    if (!btn) return;
    const on = mode === "floor";
    btn.hidden = !on;
    btn.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function drawDualFloor(w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(2, 4, 10, 0.22)";
    ctx.fillRect(0, 0, w, h);

    const mid = w / 2;
    ctx.strokeStyle = "rgba(0, 220, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, h * 0.08);
    ctx.lineTo(mid, h * 0.92);
    ctx.stroke();

    const tableR = Math.min(w, h) * 0.26;
    drawTableWithBots(w * 0.25, h * 0.52, tableR, "bitcoin", "SATOSHI · BTC", focusTable === "bitcoin");
    drawTableWithBots(w * 0.75, h * 0.52, tableR, "ethereum", "VITALIK · ETH", focusTable === "ethereum");
  }

  function drawTableWithBots(cx, cy, radius, which, label, focused) {
    if (focused == null) focused = true;
    ctx.save();
    if (!focused) ctx.globalAlpha = 0.42;

    const st = tableState(which) || {};
    const d = st.decision || {};
    const lc = st.locked_call || d.locked_call || null;
    const locked = !!(lc && lc.locked && lc.direction);
    const dir = locked ? String(lc.direction) : String(d.direction || "WAIT");
    const conf = locked ? (lc.confidence || d.confidence || 0) : (d.confidence || 0);
    const odds = locked && lc.entry_odds_pct != null ? Math.round(lc.entry_odds_pct) : null;
    const agents = (st.agents || []).filter(a => a && a.agent_name && a.agent_name !== "leader");
    const maj = majorityDirOf(agents);
    const gold = "rgba(240, 193, 74, 0.95)";
    const accent = locked ? gold : (which === "ethereum" ? "rgba(120, 255, 160, 0.55)" : "rgba(0, 220, 255, 0.55)");
    const pr = radius * 0.80;
    const portraitY = cy - 2;
    const ringR = radius * 1.48;
    const orbit = reduceMotion ? 0 : time * 0.00014;
    drawHourRing(cx, cy, radius * 1.72, hourFillFrac(st.market), maj === "UP" ? ACID : maj === "DOWN" ? HOT_RED : CYAN);
    drawHourSlamRings(cx, cy, radius);

    // Outer table rings (under everything)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = focused ? 2.5 : 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = locked ? "rgba(240, 193, 74, 0.2)" : (which === "ethereum" ? "rgba(120, 255, 160, 0.12)" : "rgba(0, 220, 255, 0.12)");
    ctx.lineWidth = 1;
    ctx.stroke();

    drawTableSmoke(cx, cy, radius, maj);
    if (locked) {
      noteTableEmber((which || "table") + ":" + String((lc && (lc.ticker || lc.close_time)) || dir), dir);
    }

    const n = Math.max(agents.length, 1);
    const chairLean = String(dir || "WAIT").toUpperCase();
    const botPts = [];
    agents.forEach((a, i) => {
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + orbit;
      const x = cx + Math.cos(ang) * ringR;
      const y = cy + Math.sin(ang) * ringR;
      const adir = String(a.direction || "WAIT").toUpperCase();
      let col = "rgba(0,232,255,0.95)";
      if (adir === "UP" || adir === "UP_HOLD") col = "rgba(0,255,120,0.95)";
      if (adir === "DOWN" || adir === "DOWN_HOLD") col = "rgba(255,55,90,0.95)";
      const confA = Number(a.confidence) || 50;
      const end = spokeEnd(x, y, cx, portraitY, pr + 4);
      const agree = (adir === chairLean) && (adir === "UP" || adir === "DOWN" || adir === "UP_HOLD" || adir === "DOWN_HOLD");
      const fresh = markSeatTick((which || "t") + ":" + (a.agent_name || i), adir, confA);
      drawPacketSpoke(x, y, end.x, end.y, col, confA, agree, fresh);
      ctx.globalAlpha = focused ? 1 : 0.42;
      botPts.push({ a, x, y, col, confA, name: a.agent_name || a.name || "?", ang, adir });
    });

    const img = which === "ethereum" ? vitalikPortraitFor(dir) : chairPortraitFor(dir);
    if (!containPortrait(img, cx, portraitY, pr)) {
      ctx.beginPath();
      ctx.arc(cx, portraitY, pr, 0, Math.PI * 2);
      ctx.fillStyle = "#0a1220";
      ctx.fill();
    }
    rememberChairHit(cx, portraitY, pr, which);
    // Gold ring when locked / focused, else direction color
    ctx.beginPath();
    ctx.arc(cx, portraitY, pr, 0, Math.PI * 2);
    if (locked) {
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3.2;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 14;
    } else if (focused) {
      ctx.strokeStyle = which === "ethereum" ? "rgba(120,255,160,0.9)" : "rgba(0,220,255,0.9)";
      ctx.lineWidth = 2.8;
    } else {
      ctx.strokeStyle = "rgba(200,220,255,0.35)";
      ctx.lineWidth = 2;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    try {
      noteChairLock(which, lc);
      drawChairThink(cx, portraitY, pr, radius, { which, dir, locked, st });
    } catch (e) {}

    // Labels
    ctx.textAlign = "center";
    ctx.font = "700 11px Orbitron, monospace";
    ctx.fillStyle = locked ? gold : (which === "ethereum" ? "#9dffc0" : "#7fe9ff");
    ctx.fillText(label + (focused ? " · FOCUS" : ""), cx, cy - radius - 10);

    ctx.font = "700 12px Orbitron, monospace";
    const plateY = cy + radius + 14;
    if (locked) {
      ctx.fillStyle = gold;
      ctx.fillText("LOCKED " + dir, cx, plateY);
      ctx.font = "600 10px Rajdhani, sans-serif";
      ctx.fillStyle = "#f0d78a";
      const oddsTxt = odds != null ? (" @ " + odds + "¢") : "";
      ctx.fillText((conf || "—") + (conf ? "%" : "") + oddsTxt, cx, plateY + 14);

      try {
        const q = (lc && lc.quality_score) != null ? lc.quality_score : (d && d.quality_score);
        if (q != null) {
          ctx.font = "600 9px Share Tech Mono, monospace";
          ctx.fillStyle = Number(q) >= 70 ? "#9dffc0" : (Number(q) >= 50 ? "#f0d78a" : "#ff9aa8");
          ctx.fillText("Q:" + Math.round(Number(q)), cx, plateY + 28);
        }
      } catch (e) {}
    } else {
      ctx.fillStyle = "#a8c0d8";
      ctx.fillText(dir, cx, plateY);
      ctx.font = "600 10px Rajdhani, sans-serif";
      ctx.fillStyle = "rgba(180,200,220,0.75)";
      ctx.fillText((conf || "—") + (conf ? "%" : "") + " · waiting", cx, plateY + 14);
    }

    if (!botPts.length) {
      ctx.font = "600 10px Rajdhani, sans-serif";
      ctx.fillStyle = "rgba(160,180,200,0.55)";
      ctx.fillText((which === "ethereum" ? "ETH council loading…" : "BTC council loading…"), cx, cy + radius + 44);
    } else {
      botPts.forEach((bp, i) => {
        const face = locked ? Math.atan2(portraitY - bp.y, cx - bp.x) : bp.ang;
        drawGameBot(bp.name, bp.x, bp.y, 22, bp.adir, bp.confA, face, i);
        const tag = labelOf(bp.a) || (bp.name || "?").toString();
        ctx.font = "700 10px Orbitron, monospace";
        ctx.fillStyle = "rgba(220,235,250,0.95)";
        ctx.textAlign = "center";
        ctx.fillText(String(tag).slice(0, 8), bp.x, bp.y + 34);
      });
    }

    const mkt = st.market || {};
    const series = mkt.series_ticker || mkt.ticker || which.toUpperCase();
    const strike = mkt.floor_strike != null ? mkt.floor_strike : null;
    ctx.font = "600 9px Share Tech Mono, monospace";
    ctx.fillStyle = focused ? "rgba(180,200,220,0.75)" : "rgba(140,160,180,0.45)";
    ctx.textAlign = "center";
    try {
      let ladder = String(series).slice(0, 18) + (strike != null ? (" · " + strike) : "");
      if (strike != null && isFinite(Number(strike))) {
        const s = Number(strike);
        const step = s >= 1000 ? 1000 : (s >= 100 ? 50 : 5);
        ladder = Math.round(s - step) + " · " + Math.round(s) + " · " + Math.round(s + step);
      }
      ctx.fillText(ladder, cx, cy + ringR + 28);
    } catch (e) { ctx.fillText(String(series), cx, cy + ringR + 28); }

    ctx.restore();
  }

  function drawMiniTable(cx, cy, radius, which, label) {
    const st = tableState(which) || {};
    const d = st.decision || {};
    const lc = st.locked_call || d.locked_call || null;
    const locked = !!(lc && lc.locked && lc.direction);
    const dir = locked ? lc.direction : (d.direction || "WAIT");
    const conf = locked ? (lc.confidence || d.confidence || 0) : (d.confidence || 0);
    const odds = locked && lc.entry_odds_pct != null ? Math.round(lc.entry_odds_pct) : null;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = which === "ethereum" ? "rgba(120, 255, 160, 0.35)" : "rgba(0, 220, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = which === "ethereum" ? "rgba(120, 255, 160, 0.15)" : "rgba(0, 220, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const img = which === "ethereum" ? vitalikPortraitFor(dir) : chairPortraitFor(dir);
    const pr = radius * 0.78;
    if (!containPortrait(img, cx, cy - 4, pr)) {
      ctx.beginPath();
      ctx.arc(cx, cy - 4, pr, 0, Math.PI * 2);
      ctx.fillStyle = "#0a1220";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy - 4, pr, 0, Math.PI * 2);
    ctx.strokeStyle = (dir === "UP" || dir === "UP_HOLD") ? "rgba(0,255,100,0.7)" :
                      (dir === "DOWN" || dir === "DOWN_HOLD") ? "rgba(255,40,70,0.7)" :
                      "rgba(200,220,255,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    try {
      noteChairLock(which, lc);
      drawChairThink(cx, cy - 4, pr, radius, { which, dir, locked, st });
    } catch (e) {}

    ctx.font = "700 12px Orbitron, monospace";
    ctx.fillStyle = which === "ethereum" ? "#9dffc0" : "#7fe9ff";
    ctx.textAlign = "center";
    ctx.fillText(label, cx, cy - radius - 12);

    ctx.font = "700 14px Orbitron, monospace";
    if (locked) {
      ctx.fillStyle = dir === "UP" ? "#39ff14" : "#ff2d55";
      ctx.fillText("LOCKED " + dir, cx, cy + pr + 18);
      ctx.font = "600 11px Rajdhani, sans-serif";
      ctx.fillStyle = "#d8f0ff";
      const oddsTxt = odds != null ? (" @ " + odds + "¢") : "";
      ctx.fillText(conf + "%" + oddsTxt + " · FOLLOW THIS", cx, cy + pr + 34);

      try {
        const q = (lc && lc.quality_score) != null ? lc.quality_score : (d && d.quality_score);
        if (q != null) {
          ctx.font = "600 9px Share Tech Mono, monospace";
          ctx.fillStyle = Number(q) >= 70 ? "#9dffc0" : (Number(q) >= 50 ? "#f0d78a" : "#ff9aa8");
          ctx.fillText("Q:" + Math.round(Number(q)), cx, cy + pr + 44);
        }
      } catch (e) {}
    } else {
      ctx.fillStyle = "#a8c0d8";
      ctx.fillText(dir === "WAIT" ? "WAIT" : String(dir), cx, cy + pr + 18);
      ctx.font = "600 11px Rajdhani, sans-serif";
      ctx.fillStyle = "rgba(180,200,220,0.8)";
      ctx.fillText((conf || "—") + (conf ? "%" : "") + " · one call / best odds", cx, cy + pr + 34);
    }

    const m = st.market || {};
    const px = m.price != null ? Number(m.price).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—";
    ctx.font = "10px Share Tech Mono, monospace";
    ctx.fillStyle = "rgba(160,180,200,0.7)";
    ctx.fillText(px, cx, cy + radius + 8);
  }

  let chairHits = [];
  function rememberChairHit(x, y, r, which) {
    if (mode !== "floor") return;
    chairHits.push({
      x: x,
      y: y,
      r: Math.max(28, (r || 40) + 12),
      which: which || "bitcoin",
    });
  }
  function chairHitAt(x, y) {
    for (let i = chairHits.length - 1; i >= 0; i--) {
      const h = chairHits[i];
      const dx = x - h.x;
      const dy = y - h.y;
      if (dx * dx + dy * dy <= h.r * h.r) return h;
    }
    return null;
  }

  function drawArt() {
    if (!ctx || !canvas) return;
    chairHits = [];
    resizeRoundtable();
    const sz = cssCanvasSize();
    const w = sz.w, h = sz.h;

    // Dual Floor only when the stage is wide enough — phone is always one table
    if (mode === "floor" && !floorIsSingle() && typeof isDualMode === "function" && isDualMode()) {
      drawDualFloor(w, h);
      try { drawTrailFX(ctx); } catch(e) {}
      return;
    }

    // Snapshot focused table — temporary swap, restored at end of drawArt
    const __prevState = state;
    try {
      if (typeof getViewState === "function") {
        const view = getViewState();
        if (view) state = view;
      }
    } catch (e) {}

    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) * (mode === "floor" ? 0.40 : 0.32);

    if (mode === "floor") {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(2, 4, 10, 0.22)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#02040a";
      ctx.fillRect(0, 0, w, h);
    }

    const preAgents = (state && state.agents) || [];
    const maj = majorityDirOf(preAgents);
    try {
      document.body.classList.remove("majority-up", "majority-down", "majority-wait");
      document.body.classList.add(maj === "UP" ? "majority-up" : maj === "DOWN" ? "majority-down" : "majority-wait");
      document.documentElement.style.setProperty("--hour-frac", String(hourFillFrac((state && state.market) || {})));
    } catch (e) {}
    drawHourRing(cx, cy, radius + 36, hourFillFrac((state && state.market) || {}), maj === "UP" ? ACID : maj === "DOWN" ? HOT_RED : CYAN);
    drawHourSlamRings(cx, cy, radius);

    // Digital rain (katana-edge cyan)
    ctx.font = "10px monospace";
    rain.forEach(d => {
      d.y += d.speed;
      if (d.y > h + 20) {
        d.y = -20;
        d.x = Math.random() * w;
      }
      ctx.fillStyle = `rgba(0, 232, 255, ${d.alpha})`;
      ctx.fillText(d.char, d.x, d.y);
    });

    // Armor rings: blade / plasma / gold
    for (let i = 0; i < 3; i++) {
      const rr = radius + 18 + i * 16;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      if (lawLocked()) {
        ctx.strokeStyle = i === 0
          ? "rgba(255, 120, 20, 0.55)"
          : i === 1
            ? "rgba(255, 90, 10, 0.35)"
            : "rgba(255, 60, 0, 0.2)";
      } else {
        ctx.strokeStyle = i === 0
          ? "rgba(0, 232, 255, 0.38)"
          : i === 1
            ? "rgba(240, 193, 74, 0.22)"
            : "rgba(180, 210, 230, 0.10)";
      }
      ctx.lineWidth = 1.6 - i * 0.3;
      ctx.stroke();
    }

    // Table surface — dark steel plate
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 12, 24, 0.88)";
    ctx.fill();
    if (lawLocked()) {
      ctx.strokeStyle = "rgba(255, 120, 20, 0.85)";
      ctx.shadowColor = "rgba(255, 100, 0, 0.9)";
    } else {
      ctx.strokeStyle = "rgba(0, 232, 255, 0.55)";
      ctx.shadowColor = CYAN;
    }
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Inner honor ring (gold dashed)
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 14, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(240, 193, 74, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    drawTableSmoke(cx, cy, radius, maj);
    try {
      const d0 = (state && state.decision) || {};
      const lc0 = d0.locked_call || (state && state.locked_call) || {};
      if (lc0 && lc0.locked && lc0.direction) {
        noteTableEmber(String(lc0.ticker || lc0.close_time || lc0.direction), lc0.direction);
      }
    } catch (e) {}

    // ── CENTER LOCKED CALL PLAQUE (follower-bot clear) ──
    // Table is reserved for the single GOAL CONTRACT call.
    try {
      const d = (state && state.decision) || {};
      const lc = d.locked_call || state.locked_call || {};
      const locked = !!(lc && lc.locked && lc.direction);
      const lockDir = (lc.direction || d.locked_dir || d.entry_dir || "").toUpperCase();
      if (locked && (lockDir === "UP" || lockDir === "DOWN")) {
        const conf = lc.confidence || d.confidence || 0;
        const odds = lc.entry_odds_pct != null ? Math.round(lc.entry_odds_pct) : (d.entry_up_pct != null ? Math.round(lockDir === "UP" ? d.entry_up_pct : 100 - d.entry_up_pct) : null);
        // Glow plate
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = lockDir === "UP" ? "rgba(0, 80, 40, 0.55)" : "rgba(80, 10, 20, 0.55)";
        ctx.fill();
        ctx.strokeStyle = lockDir === "UP" ? "rgba(0, 255, 140, 0.9)" : "rgba(255, 80, 100, 0.9)";
        ctx.lineWidth = 3;
        ctx.shadowColor = lockDir === "UP" ? "#00ff8c" : "#ff4060";
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Text
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 22px Orbitron, monospace";
        ctx.fillText("LOCKED " + lockDir, cx, cy - 28);
        ctx.font = "bold 14px Orbitron, monospace";
        ctx.fillStyle = "rgba(255,220,120,0.95)";
        ctx.fillText("ONE CALL · FOLLOW THIS", cx, cy - 6);
        ctx.font = "12px Orbitron, monospace";
        ctx.fillStyle = "rgba(200,230,255,0.9)";
        let sub = conf ? (conf + "%") : "";
        if (odds != null) sub += (sub ? "  ·  " : "") + odds + "¢ entry";
        ctx.fillText(sub, cx, cy + 14);
        ctx.font = "10px Orbitron, monospace";
        ctx.fillStyle = "rgba(180,200,220,0.75)";
        ctx.fillText("GOAL · best odds <80%", cx, cy + 30);
        ctx.restore();
      } else {
        // Small goal reminder when not locked
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "10px Orbitron, monospace";
        ctx.fillStyle = "rgba(0, 200, 255, 0.45)";
        ctx.fillText("GOAL · 1 window-end guess @ best odds (<80%)", cx, cy);
        ctx.restore();
      }
    } catch (e) { /* keep drawing */ }

    if (!state || !state.agents) {
      try { if (typeof __prevState !== "undefined" && __prevState) state = __prevState; } catch (e) {}
      return;
    }

    // Specialists on Floor and Table — packet lines + game-unit seats
    if (mode === "floor" || mode === "art") {
    const agents = state.agents.filter(a => a.agent_name !== "leader");
    // Round table: rank order loops the ring. Rank #1 sits at the TOP.
    // Hierarchy / listen weights / learning unchanged — only seat placement is circular again.
    const hier = (state.hierarchy || (state.learning && state.learning.hierarchy) || []);
    const ranked = hier.map(r => r.agent).filter(a => a !== "law");
    const order = ranked.length
      ? ranked.concat(AGENT_ORDER.filter(a => !ranked.includes(a) && a !== "law"))
      : AGENT_ORDER.filter(a => a !== "law");
    const n = order.length || 1;
    const positions = {};
    const rankOf = {};
    hier.forEach(r => { rankOf[r.agent] = r.rank; });

    // Sort by rank ascending so #1 is first → placed at top (-π/2), then clockwise
    const seatList = order.map((name, i) => ({
      name,
      rank: rankOf[name] != null ? rankOf[name] : (i + 1),
    }));
    seatList.sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)));

    // Bots removed from the TABLE — they live on the FLOOR (outer ring).
    // Table surface reserved for Chair + clear locked call for follower bots.
    const ringR = radius * (mode === "floor" ? 1.15 : 1.18); // outside table = floor (tighter to avoid clip)
    seatList.forEach((item, i) => {
      // Top of screen = -π/2; then clockwise around the full circle
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2 + (reduceMotion ? 0 : time * 0.00014);
      // Subtle hierarchy: top-3 sit a hair closer to the Chair (still one ring)
      const rk = item.rank;
      // Stay fully on the floor ring — no inward hierarchy pull onto the table
      const pull = 1.0;
      const rSeat = ringR * pull;
      positions[item.name] = {
        x: cx + Math.cos(angle) * rSeat,
        y: cy + Math.sin(angle) * rSeat,
        angle,
        rank: rk,
        seatIndex: i,          // 0 = top, then clockwise
        clockwiseLabel: i + 1, // 1..N around the ring
        rSeat,
        tier: rk <= 3 ? 0 : rk <= 7 ? 1 : 2,
      };
    });

    // Outer clockwise rank rail — gold ticks + # labels upright around the ring
    ctx.save();
    ctx.font = "700 10px Orbitron, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    seatList.forEach((item, i) => {
      const pos = positions[item.name];
      if (!pos) return;
      const a = pos.angle;
      const railR = ringR * 1.14;
      const lx = cx + Math.cos(a) * railR;
      const ly = cy + Math.sin(a) * railR;
      // tick toward seat
      const tx = cx + Math.cos(a) * (ringR * 1.05);
      const ty = cy + Math.sin(a) * (ringR * 1.05);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(lx, ly);
      const isTop3 = item.rank <= 3;
      if (lawLocked()) {
        ctx.strokeStyle = isTop3 ? "rgba(255, 140, 40, 0.95)" : "rgba(255, 120, 30, 0.55)";
      } else {
        ctx.strokeStyle = isTop3 ? "rgba(255, 176, 0, 0.75)" : "rgba(0, 232, 255, 0.35)";
      }
      ctx.lineWidth = isTop3 ? 2 : 1;
      ctx.stroke();
      // upright rank number (not rotated with angle)
      const label = "#" + item.rank;
      ctx.fillStyle = item.rank === 1 ? "#ffd56a" : isTop3 ? "#ffb000" : "rgba(180, 220, 255, 0.75)";
      ctx.shadowColor = item.rank === 1 ? "#ffb000" : "transparent";
      ctx.shadowBlur = item.rank === 1 ? 10 : 0;
      ctx.fillText(label, lx, ly);
      ctx.shadowBlur = 0;
    });
    // Legend: clockwise arrow near top-right of ring
    {
      const legX = cx + ringR * 0.72;
      const legY = cy - ringR * 1.22;
      ctx.font = "600 9px Orbitron, monospace";
      ctx.fillStyle = "rgba(240, 193, 74, 0.85)";
      ctx.textAlign = "left";
      ctx.fillText("RANKS ↻ CLOCKWISE", legX - 20, legY);
    }
    ctx.restore();

    // Agreement laser beams
    const dirs = {};
    agents.forEach(a => { dirs[a.agent_name] = a.direction; });
    const upAgents = order.filter(n => dirs[n] === "UP");
    const downAgents = order.filter(n => dirs[n] === "DOWN");

    /**
     * Agreement beams: intensity scales with how many seats share the side.
     * 2 aligned = soft, 5+ = hot glow, near-unanimous = max bloom.
     */
    function drawBeams(list, baseRgb, lockedOrange) {
      const n = list.length;
      if (n < 2) return;
      // 2 → ~0.25, 4 → ~0.55, 6 → ~0.8, 8+ → ~1.0
      const t = Math.min(1, (n - 2) / 6);
      const alpha = 0.22 + t * 0.55;
      const width = 1.3 + t * 2.4;
      const blur = 6 + t * 22;
      const particleChance = 0.04 + t * 0.14;
      const [r, g, b] = lockedOrange ? [255, 120, 20] : baseRgb;
      const color = "rgba(" + r + "," + g + "," + b + "," + (0.55 + t * 0.4).toFixed(2) + ")";
      const glow = "rgba(" + r + "," + g + "," + b + ",1)";

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = positions[list[i]], b = positions[list[j]];
          if (!a || !b) continue;
          // outer bloom
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = glow;
          ctx.lineWidth = width + 2.5 * t;
          ctx.globalAlpha = alpha * 0.35;
          ctx.shadowColor = glow;
          ctx.shadowBlur = blur;
          ctx.stroke();
          // core beam
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.globalAlpha = alpha;
          ctx.shadowBlur = blur * 0.5;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          if (Math.random() < particleChance) spawnParticles(a, b, color);
        }
      }
    }
    if (lawLocked()) {
      const allDir = order.filter(n => dirs[n] === "UP" || dirs[n] === "DOWN");
      if (allDir.length >= 2) drawBeams(allDir, [255, 120, 20], true);
    } else {
      if (upAgents.length >= 2) drawBeams(upAgents, [57, 255, 20], false);
      if (downAgents.length >= 2) drawBeams(downAgents, [255, 45, 85], false);
    }

    // Team loops — bots that historically win together
    if (teamLoopsOn && state.learning && Array.isArray(state.learning.top_pairs)) {
      state.learning.top_pairs.slice(0, 4).forEach((p, pi) => {
        let names = p.labels || (p.pair ? String(p.pair).split("|") : []);
        if (!Array.isArray(names)) names = [];
        names = names.filter(n => positions[n]);
        if (names.length < 2) return;
        const pts = names.map(n => positions[n]);
        ctx.beginPath();
        pts.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.strokeStyle = pi === 0 ? "rgba(240, 193, 74, 0.55)" : "rgba(168, 85, 247, 0.4)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        // soft fill
        ctx.fillStyle = pi === 0 ? "rgba(240, 193, 74, 0.06)" : "rgba(168, 85, 247, 0.05)";
        ctx.fill();
      });
    }


    const chairCore = { x: cx, y: cy };
    const chairR = Math.min(w, h) * (mode === "floor" ? 0.22 : 0.28);
    const chairStop = chairR + 6;
    const chairLean = String((state.decision && state.decision.direction) || "WAIT").toUpperCase();
    order.forEach((name, i) => {
      const pos = positions[name];
      if (!pos) return;
      const agent = agents.find(a => a.agent_name === name) || { direction: "WAIT", confidence: 0 };
      const conf = Number(agent.confidence) || 0;
      const sc = lawLocked() ? "rgba(255, 120, 20, 0.95)" : strongColor(agent.direction);
      const adir = String(agent.direction || "WAIT").toUpperCase();
      const agree = (adir === chairLean) && (adir === "UP" || adir === "DOWN" || adir === "UP_HOLD" || adir === "DOWN_HOLD");
      const fresh = markSeatTick("art:" + name, adir, conf);
      const end = spokeEnd(pos.x, pos.y, chairCore.x, chairCore.y, chairStop);
      drawPacketSpoke(pos.x, pos.y, end.x, end.y, sc, conf, agree, fresh);
      if (!reduceMotion && Math.random() < 0.03 + conf / 100 * 0.05) {
        spawnParticles(pos, end, sc);
      }
    });

    // Particles
    particles = particles.filter(p => {
      p.x += (p.tx - p.x) * p.speed;
      p.y += (p.ty - p.y) * p.speed;
      p.life -= 0.014;
      if (p.life <= 0) return false;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color.replace(")", `, ${p.life})`).replace("rgb", "rgba").replace("#", "");
      // fallback
      ctx.fillStyle = p.color.includes("rgba") ? p.color.replace(/[\d.]+\)$/, `${p.life})`) : p.color;
      ctx.globalAlpha = p.life;
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });

    // Rim bot seats — custom logos, outline color = call direction
    const now = performance.now();
    const isGlitch = now < glitchUntil;
    // Dim floor specialists slightly when Chair has locked (table is the hero)
    const _flc = (state && (state.locked_call || (state.decision && state.decision.locked_call))) || null;
    const floorLocked = !!( _flc && _flc.locked && _flc.direction && (_flc.direction === "UP" || _flc.direction === "DOWN") );
    const floorAlpha = floorLocked ? 0.55 : 1.0;

    order.forEach((name, i) => {
      const pos = positions[name];
      if (!pos) return;
      const agent = agents.find(a => a.agent_name === name) || { direction: "WAIT", confidence: 0 };
      ctx.globalAlpha = floorAlpha;
      const r = (isPhoneDesk() || mode === "floor") ? 24 : 20;
      const col = colorFor(agent.direction, agent.confidence);
      const sc = strongColor(agent.direction);
      const face = floorLocked ? Math.atan2(cy - pos.y, cx - pos.x) : pos.angle;
      drawGameBot(name, pos.x, pos.y, r, agent.direction, agent.confidence || 0, face, i);

      // Occasional glitch offset
      if (isGlitch && Math.random() < 0.3) {
        ctx.fillStyle = MAGENTA;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(pos.x - r, pos.y - 2, r * 2, 3);
        ctx.globalAlpha = 1;
      }

      // Rank badge above name (hierarchy rank · upright)
      if (pos.rank) {
        const badgeY = pos.y - r - 12;
        const top3 = pos.rank <= 3;
        // pill background
        ctx.font = "700 10px Orbitron, monospace";
        const badge = "#" + pos.rank;
        const tw = ctx.measureText(badge).width;
        const pw = tw + 10;
        const ph = 14;
        ctx.fillStyle = top3 ? "rgba(40, 28, 4, 0.85)" : "rgba(6, 16, 28, 0.85)";
        ctx.strokeStyle = top3 ? "rgba(255, 176, 0, 0.8)" : "rgba(0, 232, 255, 0.45)";
        ctx.lineWidth = 1.2;
        const bx = pos.x - pw / 2;
        const by = badgeY - ph / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, pw, ph, 4);
        else { ctx.rect(bx, by, pw, ph); }
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = pos.rank === 1 ? "#ffe08a" : top3 ? "#ffb000" : "#a8d8ff";
        ctx.shadowColor = pos.rank === 1 ? "#ffb000" : "transparent";
        ctx.shadowBlur = pos.rank === 1 ? 8 : 0;
        ctx.fillText(badge, pos.x, badgeY);
        ctx.shadowBlur = 0;
        ctx.textBaseline = "alphabetic";
      }

      // Callsign + signal
      ctx.font = "700 11px Orbitron, monospace";
      ctx.fillStyle = "#d8f0ff";
      ctx.textAlign = "center";
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 6;
      ctx.fillText(labelOf(agent.agent_name ? agent : name), pos.x, pos.y + r + 18);
      ctx.shadowBlur = 0;
      ctx.font = "8px Rajdhani, Inter, monospace";
      ctx.fillStyle = "rgba(240, 193, 74, 0.7)";
      const title = titleOf(agent.agent_name ? agent : name);
      if (title) ctx.fillText(title, pos.x, pos.y + r + 29);
      ctx.font = "9px Orbitron, monospace";
      ctx.fillStyle = sc;
      const showDir = effectiveDir(agent.direction);
      ctx.fillStyle = lawLocked() ? "rgba(255, 120, 20, 0.95)" : sc;
      ctx.fillText(lawLocked() ? "LOCKED" : `${showDir} ${agent.confidence}%`, pos.x, pos.y + r + (title ? 41 : 30));
    });
    ctx.globalAlpha = 1;

    } // end floor-only specialists
    ctx.globalAlpha = 1;

    // ===== Central Leader – CHAIR (armored portrait, eyes by direction) =====
    // Prefer locked_call so portrait matches the LOCKED plaque after the single call
    const _lc = (state.locked_call || (state.decision && state.decision.locked_call) || null);
    const _hasLock = !!( _lc && _lc.locked && _lc.direction && (_lc.direction === "UP" || _lc.direction === "DOWN") );
    const leaderDir = _hasLock ? _lc.direction : (state.decision?.direction || "WAIT");
    const leaderConf = _hasLock ? (_lc.confidence || state.decision?.confidence || 0) : (state.decision?.confidence || 0);
    const leaderPulse = reduceMotion ? 1 : (1 + 0.02 * Math.sin(time * 0.0035));
    const lr = Math.min(w, h) * (mode === "floor" ? 0.22 : 0.28) * leaderPulse;
    const scL = strongColor(leaderDir);
    const eyeGlow =
      leaderDir === "UP" || leaderDir === "UP_HOLD" ? "rgba(0, 255, 100, 0.85)" :
      leaderDir === "DOWN" || leaderDir === "DOWN_HOLD" ? "rgba(255, 40, 70, 0.85)" :
      "rgba(220, 235, 255, 0.75)";

    // Soft aura matching call
    ctx.beginPath();
    ctx.arc(cx, cy, lr + 28, 0, Math.PI * 2);
    ctx.fillStyle = colorFor(leaderDir, Math.max(leaderConf, 40)).replace(/[\d.]+\)$/, "0.12)");
    ctx.fill();

    // Outer rotating dashed ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.0004);
    ctx.beginPath();
    ctx.arc(0, 0, lr + 18, 0, Math.PI * 2);
    ctx.strokeStyle = scL;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    // Counter-rotating gold honor ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-time * 0.0006);
    ctx.beginPath();
    ctx.arc(0, 0, lr + 26, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(240, 193, 74, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const portrait = (focusTable === "ethereum") ? vitalikPortraitFor(leaderDir) : chairPortraitFor(leaderDir);
    if (!containPortrait(portrait, cx, cy, lr)) {
      ctx.beginPath();
      ctx.arc(cx, cy, lr, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(leaderDir, Math.max(leaderConf, 45));
      ctx.fill();
    }
    rememberChairHit(cx, cy, lr, focusTable === "ethereum" ? "ethereum" : "bitcoin");

    // Eye glow ring pulse (extra emphasis on call color)
    ctx.beginPath();
    ctx.arc(cx, cy, lr + 2, 0, Math.PI * 2);
    ctx.strokeStyle = eyeGlow;
    ctx.lineWidth = 3;
    ctx.shadowColor = eyeGlow;
    ctx.shadowBlur = 18 + 8 * Math.sin(time * 0.006);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Gold trim
    ctx.beginPath();
    ctx.arc(cx, cy, lr + 5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(240, 193, 74, 0.65)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    try {
      const whichChair = focusTable === "ethereum" ? "ethereum" : "bitcoin";
      noteChairLock(whichChair, _lc);
      drawChairThink(cx, cy, lr, radius, { which: whichChair, dir: leaderDir, locked: _hasLock, st: state });
    } catch (e) {}

    // Labels under portrait (don't cover the face)
    ctx.font = "700 11px Orbitron, sans-serif";
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(240, 193, 74, 0.55)";
    ctx.shadowBlur = 8;
    ctx.fillText(focusTable === "ethereum" ? "VITALIK" : "SATOSHI", cx, cy + lr + 16);
    ctx.shadowBlur = 0;
    ctx.font = "700 13px Orbitron, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = scL;
    ctx.shadowBlur = 12;
    ctx.fillText(leaderDir, cx, cy + lr + 32);
    ctx.shadowBlur = 0;
    ctx.font = "11px Orbitron, sans-serif";
    ctx.fillStyle = "#e8f4ff";
    ctx.fillText(leaderConf + "%", cx, cy + lr + 46);

        // ===== CLEAR LOCKED CALL plate for follower bots (GOAL: one call @ best odds) =====
    {
      const lc = state.locked_call || (state.decision && state.decision.locked_call) || {};
      const isLocked = !!(lc && lc.locked && lc.direction && (lc.direction === "UP" || lc.direction === "DOWN"));
      const showDir = (isLocked ? lc.direction : (leaderDir || "WAIT")).toUpperCase();
      const showConf = (lc.confidence != null ? lc.confidence : leaderConf);
      const entryOdds = lc.entry_odds_pct;
      const isDir = showDir === "UP" || showDir === "DOWN" || showDir === "UP_HOLD" || showDir === "DOWN_HOLD";
      const plateY = cy + lr + 68;
      const plateW = isLocked && isDir ? 260 : 240;
      const plateH = 38;
      ctx.beginPath();
      const rx = 8;
      ctx.moveTo(cx - plateW/2 + rx, plateY - plateH/2);
      ctx.arcTo(cx + plateW/2, plateY - plateH/2, cx + plateW/2, plateY + plateH/2, rx);
      ctx.arcTo(cx + plateW/2, plateY + plateH/2, cx - plateW/2, plateY + plateH/2, rx);
      ctx.arcTo(cx - plateW/2, plateY + plateH/2, cx - plateW/2, plateY - plateH/2, rx);
      ctx.arcTo(cx - plateW/2, plateY - plateH/2, cx + plateW/2, plateY - plateH/2, rx);
      ctx.closePath();
      ctx.fillStyle = isDir ? "rgba(0, 20, 40, 0.94)" : "rgba(10, 12, 20, 0.88)";
      ctx.fill();
      ctx.strokeStyle = isDir ? scL : "rgba(120, 140, 160, 0.55)";
      ctx.lineWidth = 2.2;
      ctx.shadowColor = isDir ? scL : "transparent";
      ctx.shadowBlur = isDir ? 16 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = "700 12px Orbitron, sans-serif";
      ctx.fillStyle = isDir ? "#ffffff" : "rgba(180, 200, 220, 0.9)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let lockLabel;
      if (isLocked && isDir) {
        const oddsPart = entryOdds != null ? ` @ ${Math.round(entryOdds)}¢` : "";
        lockLabel = `LOCKED ${showDir}${oddsPart} · ${showConf}% · FOLLOW`;
      } else {
        lockLabel = "GOAL · one guess @ best odds (<80%)";
      }
      ctx.fillText(lockLabel, cx, plateY);
    }

    // Scanline overlay on canvas itself (subtle)
    ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    try { if (typeof __prevState !== 'undefined' && __prevState) state = __prevState; } catch (e) {}
  }

  function renderDashboard() {
    const ts = (typeof tableState === "function" ? tableState(focusTable) : null) || {};
    const view = Object.assign({}, (typeof getViewState === "function" ? getViewState() : null) || state || {}, ts, { _focusTable: focusTable });
    if (!view || !Array.isArray(view.agents)) {
      overlay.innerHTML = "";
      return;
    }
    const learning = view.learning || {};
    const records = learning.records || {};
    const topPairs = learning.top_pairs || [];
    const weights = view.weights || learning.weights || {};
    const focusName = focusTable === "ethereum" ? "ETH · Vitalik" : "BTC · Satoshi";

    const pairCard = topPairs.length
      ? `<div class="agent-card pair-card">
          <div class="name">COALITIONS</div>
          <div class="title">${focusName} memory · right together</div>
          ${topPairs.slice(0, 4).map(p => {
            const labels = (p.labels || p.pair.split("|")).join(" + ");
            const pct = p.affinity != null ? Math.round(p.affinity * 100) : "—";
            return `<div class="sub-row">
              <span class="sub-name">${labels}</span>
              <span class="sub-dir" style="color:#39ff14">${pct}% · ${p.hits || 0}/${p.tries || 0}</span>
            </div>`;
          }).join("")}
        </div>`
      : "";

    const agentCards = view.agents.map(a => {
      const col = strongColor(a.direction);
      const callsign = labelOf(a);
      const title = titleOf(a);
      const rec = records[a.agent_name] || {};
      const w = weights[a.agent_name];
      const wr = rec.win_rate != null ? Math.round(rec.win_rate * 100) + "%" : "—";
      const record = rec.n ? `${rec.correct}/${rec.n}` : "0/0";
      const subHtml = (a.subs || []).map(sub => {
        const sc = strongColor(sub.direction);
        return `<div class="sub-row" style="border-color:${sc}33">
          <span class="sub-name">${labelOf(sub)}</span>
          <span class="sub-dir" style="color:${lawLocked() ? "rgba(255,120,20,0.95)" : sc}">${lawLocked() ? "LOCKED" : (sub.direction + " " + sub.confidence + "%")}</span>
        </div>`;
      }).join("");
      return `
        <div class="agent-card">
          <div class="name">${callsign}</div>
          ${title ? `<div class="title">${title}</div>` : ""}
          <div class="dir" style="color:${lawLocked() ? "rgba(255,120,20,0.95)" : col}">${lawLocked() ? "LOCKED" : (a.direction + " · " + a.confidence + "%")}</div>
          <div class="meta-row">
            <span>wt ${w != null ? Number(w).toFixed(3) : "—"}</span>
            <span>hit ${wr}</span>
            <span>${record}</span>
          </div>
          <div class="conf-bar"><div class="conf-fill" style="width:${a.confidence}%;background:${col}"></div></div>
          <div class="reason">${a.reasoning || ""}</div>
          ${subHtml ? `<div class="subs">${subHtml}</div>` : ""}
        </div>`;
    }).join("");

    overlay.innerHTML = `<div class="dash-focus-banner">${focusName}</div>` + pairCard + agentCards;
  }

  function updateLaw(law) {
    if (!lawBadge || !lawStatus) return;
    if (!law) {
      lawStatus.textContent = "OK";
      lawBadge.classList.remove("lock");
      lawBadge.title = "LAW enforcer idle";
      return;
    }
    const locked = !!law.lockdown || (law.lockdown_remaining > 0);
    document.body.classList.toggle("law-lock", locked);
    lawBadge.classList.toggle("lock", locked);
    if (locked) {
      lawStatus.textContent = `LOCK ${law.lockdown_remaining ?? 0}`;
      const findings = (law.findings || []).slice(0, 3).join(" | ") || law.reason || "diagnosing";
      lawBadge.title = `LAW lockdown · LET'S FIND OUT · ${findings}`;
    } else if ((law.wrong_streak || 0) > 0) {
      lawStatus.textContent = `WATCH ${law.wrong_streak}`;
      lawBadge.title = `Wrong streak ${law.wrong_streak}/2 – next fault triggers lockdown`;
    } else {
      lawStatus.textContent = "OK";
      lawBadge.title = "LAW enforcer · order held";
    }
  }

  let lastHydratedAcc = null;

  function accuracyIsHydrating(acc) {
    if (acc && acc.hydrating) return true;
    if (state && state.hydrating && !(acc && (Array.isArray(acc.log) || Array.isArray(acc.recent)))) {
      return true;
    }
    const summary = (state && state.decision && state.decision.summary) || "";
    const hasLogKey = !!(acc && (Array.isArray(acc.log) || Array.isArray(acc.recent)));
    if (/initializing/i.test(summary) && !hasLogKey) return true;
    return false;
  }

  function updateAccuracy(acc) {
    const detailEl = document.getElementById("accuracyDetail");
    const callLogEl = document.getElementById("callLog");
    const callLogMeta = document.getElementById("callLogMeta");
    const hydrating = accuracyIsHydrating(acc);
    const hasLogKey = !!(acc && (Array.isArray(acc.log) || Array.isArray(acc.recent)));
    const hasRows = !!(acc && (
      (Array.isArray(acc.log) && acc.log.length) ||
      (Array.isArray(acc.recent) && acc.recent.length) ||
      (Array.isArray(acc.open) && acc.open.length)
    ));
    const hasTotals = !!(acc && ((acc.total || 0) > 0 || (acc.pending || 0) > 0));
    if (hydrating && !hasRows && !hasTotals && lastHydratedAcc) {
      acc = lastHydratedAcc;
    } else if (acc && (hasLogKey || hasTotals || acc.hydrated)) {
      lastHydratedAcc = acc;
    }
    const hrPct = document.getElementById("hrPct");
    const hrCorrect = document.getElementById("hrCorrect");
    const hrWrong = document.getElementById("hrWrong");
    const hrTotal = document.getElementById("hrTotal");
    const hrPending = document.getElementById("hrPending");
    const hrL20 = document.getElementById("hrL20");
    const hrL50 = document.getElementById("hrL50");
    const hrVerdict = document.getElementById("hrVerdict");
    const logCount = document.getElementById("logCount");

    const correct = (acc && acc.correct) || 0;
    const total = (acc && acc.total) || 0;
    const wrong = (acc && acc.wrong) != null ? acc.wrong : Math.max(0, total - correct);
    const pct = acc && acc.accuracy_pct != null ? acc.accuracy_pct : null;
    const pending = (acc && acc.pending) || 0;
    const streak = (acc && acc.streak) || 0;
    const label = (acc && acc.label) || (pct != null ? `${correct}/${total} · ${pct}%` : `${correct}/${total} · —`);
    const pctText = pct != null ? `${pct}%` : "—";
    let verdict = (acc && acc.verdict) || "COLLECTING";
    if (!total) verdict = "FINISH-ONLY · WAITING ON HOUR CLOSE";

    if (accuracyPct) accuracyPct.textContent = pctText;
    if (accuracyFrac) accuracyFrac.textContent = `${correct} / ${total}`;
    if (detailEl) detailEl.textContent = (!total)
      ? ("finish-only · 0 settled hours" + (pending ? ` · ${pending} open` : ""))
      : (`${correct}✓ · ${wrong}✗` + (pending ? ` · ${pending} open` : ""));
    if (accuracyStrip) accuracyStrip.textContent = "Life " + label;
    checkWinStreakCelebrate(acc);
    if (callLogMeta) callLogMeta.textContent = label;

    if (hrPct) {
      hrPct.textContent = pctText;
      hrPct.classList.remove("cold", "bad");
      if (total === 0) hrPct.classList.add("cold");
      else if (pct != null && pct < 48) hrPct.classList.add("bad");
    }
    if (hrCorrect) hrCorrect.textContent = String(correct);
    if (hrWrong) hrWrong.textContent = String(wrong);
    if (hrTotal) hrTotal.textContent = String(total);
    if (hrPending) hrPending.textContent = String(pending);

    // Path tally: avg peak favorable move on wins (peak − entry Kalshi %)
    const hrPathAvg = document.getElementById("hrPathAvg");
    const hrEntryAvg = document.getElementById("hrEntryAvg");
    const pathWins = acc && (acc.avg_path_wins != null ? acc.avg_path_wins
      : (acc.path_tally && acc.path_tally.avg_wins));
    const entryAvg = acc && (acc.avg_entry_pct != null ? acc.avg_entry_pct
      : (acc.path_tally && acc.path_tally.avg_entry));
    if (hrPathAvg) {
      hrPathAvg.textContent = pathWins != null ? ((pathWins >= 0 ? "+" : "") + Number(pathWins).toFixed(1) + " pts") : "—";
    }
    if (hrEntryAvg) {
      hrEntryAvg.textContent = entryAvg != null ? (Number(entryAvg).toFixed(1) + "%") : "—";
    }

    const l20 = acc && acc.last_20;
    const l50 = acc && acc.last_50;
    if (hrL20) {
      hrL20.textContent = l20 && l20.accuracy_pct != null
        ? `${l20.accuracy_pct}% (${l20.correct}/${l20.total})`
        : "—";
    }
    if (hrL50) {
      hrL50.textContent = l50 && l50.accuracy_pct != null
        ? `${l50.accuracy_pct}% (${l50.correct}/${l50.total})`
        : "—";
    }
    if (hrVerdict) {
      hrVerdict.textContent = verdict;
      hrVerdict.className = "hr-verdict " + String(verdict).replace(/\s+/g, "-");
      hrVerdict.title = (acc && acc.verdict_note) || "";
    }
    if (logCount) logCount.textContent = total ? `${total} settled` : "all settled";

    if (accuracyBadge) {
      accuracyBadge.classList.remove("cold", "hot-bad");
      if (total === 0) accuracyBadge.classList.add("cold");
      else if (pct != null && pct < 48) accuracyBadge.classList.add("hot-bad");
      accuracyBadge.title = [
        `LIFETIME ${label}`,
        verdict,
        (acc && acc.verdict_note) || null,
        l20 && l20.total ? `Last 20: ${l20.correct}/${l20.total}` : null,
        streak ? `win streak ${streak}` : null,
        "Persisted in SQLite · survives restarts (with disk)",
      ].filter(Boolean).join(" · ");
    }

    if (callLogEl) {
      const openRows = (acc && acc.open) || [];
      const settledRows = (acc && (acc.log || acc.recent)) || [];
      const parts = [];

      openRows.forEach(r => {
        const tick = (r.ticker || "").replace(/^KXBTC15M-?/i, "") || "—";
        const entry = r.entry_side_pct != null ? Number(r.entry_side_pct) : (r.open_price != null ? Number(r.open_price) : null);
        const peak = r.peak_side_pct != null ? Number(r.peak_side_pct) : (r.exit_price != null ? Number(r.exit_price) : null);
        let pathPts = r.path_move_pct != null ? Number(r.path_move_pct) : null;
        if (pathPts == null && entry != null && peak != null) pathPts = Math.max(0, peak - entry);
        let pathLine = "";
        if (entry != null) {
          const eStr = entry.toFixed(1) + "%";
          const pStr = peak != null ? peak.toFixed(1) + "%" : eStr;
          const mStr = pathPts != null ? ("+" + pathPts.toFixed(1) + " pts") : "live";
          pathLine = `<span class="call-path">${eStr} → ${pStr} · ${mStr}</span>`;
        }
        parts.push(`<div class="call-row open">
          <span class="mark pend">●</span>
          <span class="call-dir">${displayDir(r.direction) || "—"}</span>
          <span class="call-out">OPEN</span>
          <span class="call-out">${r.confidence != null ? r.confidence + "%" : ""}</span>
          <span class="call-tick">${tick}</span>
          ${pathLine}
        </div>`);
      });

      settledRows.forEach(r => {
        const ok = !!r.correct;
        const when = r.settled_at
          ? new Date(r.settled_at).toLocaleString([], {
              month: "short", day: "numeric",
              hour: "2-digit", minute: "2-digit",
            })
          : "";
        const tick = (r.ticker || "").replace(/^KXBTC15M-?/i, "") || "—";
        const entry = r.entry_side_pct != null ? Number(r.entry_side_pct) : (r.open_price != null ? Number(r.open_price) : null);
        const peak = r.peak_side_pct != null ? Number(r.peak_side_pct) : (r.exit_price != null ? Number(r.exit_price) : null);
        let pathPts = r.path_move_pct != null ? Number(r.path_move_pct) : null;
        if (pathPts == null && entry != null && peak != null) pathPts = Math.max(0, peak - entry);
        let pathLine = "";
        if (entry != null || pathPts != null) {
          const eStr = entry != null ? entry.toFixed(1) + "%" : "—";
          const pStr = peak != null ? peak.toFixed(1) + "%" : "—";
          const mStr = pathPts != null ? ((pathPts >= 0 ? "+" : "") + pathPts.toFixed(1) + " pts") : "—";
          pathLine = `<span class="call-path ${ok ? "" : "miss"}">${eStr} → ${pStr} · ${mStr}</span>`;
        }
        parts.push(`<div class="call-row">
          <span class="mark ${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"}</span>
          <span class="call-dir">${displayDir(r.direction) || "—"}</span>
          <span class="call-out">→ ${r.outcome || "—"}</span>
          <span class="call-out">${when}</span>
          <span class="call-tick">${tick}</span>
          ${pathLine}
        </div>`);
      });

      const logBlock = document.getElementById("lifetimeLogBlock");
      if (!parts.length) {
        if (hydrating && !hasLogKey) {
          if (callLogEl.dataset.hydrated === "1") {
            // Keep the last painted log — cold payload is not a wipe
          } else {
            callLogEl.innerHTML = "";
            if (logBlock) logBlock.classList.add("idle");
          }
        } else {
          // 0/0: tape/baseline fills the column — do not leave a tall empty log void.
          callLogEl.innerHTML = "";
          callLogEl.dataset.hydrated = "";
          if (logBlock) logBlock.classList.add("idle");
        }
      } else {
        callLogEl.dataset.hydrated = "1";
        callLogEl.innerHTML = parts.join("");
        if (logBlock) logBlock.classList.remove("idle");
      }
    }
  }

  const _packetSeen = Object.create(null);
  function updateDebate() {
    const list = document.getElementById("signalFeed");
    const meta = document.getElementById("signalFeedMeta");
    const dirEl = document.getElementById("signalChairDir");
    const metaEl = document.getElementById("signalChairMeta");
    const lastEl = document.getElementById("signalChairLast");
    if (!list) return;
    const view = (typeof getViewState === "function" ? getViewState() : state) || state || {};
    const d = view.decision || {};
    const lc = view.locked_call || d.locked_call || {};
    const locked = !!(lc && lc.locked && lc.direction);
    const dir = String((locked ? lc.direction : (d.direction || "WAIT"))).toUpperCase();
    const m = view.market || {};
    const secs = secondsLeftOf(m);
    const mm = secs != null ? String(Math.floor(secs / 60)).padStart(2, "0") : "--";
    const ss = secs != null ? String(Math.floor(secs % 60)).padStart(2, "0") : "--";
    let pf = lc.p_finish != null ? lc.p_finish : d.p_finish;
    pf = Number(pf);
    if (Number.isFinite(pf) && pf <= 1.5) pf = pf * 100;
    const pFinish = Number.isFinite(pf) ? (Math.round(pf) + "%") : "—";
    const ev = (lc && lc.ev_cents != null) ? (Math.round(lc.ev_cents) + "¢")
      : (d.ev_cents != null) ? (Math.round(d.ev_cents) + "¢")
      : "—";
    if (dirEl) {
      dirEl.textContent = (locked ? "LOCKED " : "") + dir.replace("_HOLD", "");
      dirEl.className = "signal-chair-dir " + dir.replace("_HOLD", "");
    }
    if (metaEl) metaEl.textContent = "P(finish) " + pFinish + " · EV " + ev + " · " + mm + ":" + ss + " left";
    if (lastEl) {
      const acc = view.accuracy || (state && state.accuracy) || {};
      const settled = (acc.recent || acc.log || []).find(r => r && (r.outcome || r.y_finish));
      if (settled) {
        const side = String(settled.direction || settled.locked_call || "—").toUpperCase().replace("_HOLD", "");
        const pair = /ETH/i.test(settled.ticker || settled.asset || "") ? "ETH" : "BTC";
        const grade = settled.correct === true ? "HIT" : (settled.correct === false ? "MISS" : "SETTLED");
        lastEl.textContent = "last lock " + pair + " " + side + " · " + grade;
      } else {
        lastEl.textContent = "last lock —";
      }
    }
    const agents = (view.agents || []).filter((a) => a && a.agent_name && a.agent_name !== "leader");
    const now = Date.now();
    const packets = agents.map((a) => {
      const name = labelOf(a);
      const lean = String(a.direction || "WAIT").toUpperCase();
      const conf = a.confidence;
      const id = a.agent_name || name;
      const key = id + "|" + lean + "|" + String(conf);
      const prev = _packetSeen[id];
      if (!prev || prev.key !== key) {
        _packetSeen[id] = { key, at: now, name, dir: lean, conf };
      }
      return _packetSeen[id];
    }).sort((a, b) => b.at - a.at).slice(0, 8);
    if (meta) meta.textContent = packets.length ? (packets.length + " packets") : "awaiting";
    if (!packets.length) {
      list.innerHTML = '<li class="sf-empty">No specialist packets yet</li>';
      return;
    }
    list.innerHTML = packets.map((s) => {
      const lean = String(s.dir || "WAIT").replace("_HOLD", "");
      const fresh = (now - s.at) < 900;
      return '<li class="sf-row' + (fresh ? " sf-in" : "") + '">'
        + '<span class="sf-name">' + s.name + '</span>'
        + '<span class="sf-dir ' + lean + '">' + lean + '</span>'
        + '<span class="sf-conf">' + (s.conf != null ? s.conf + "%" : "—") + '</span>'
        + '</li>';
    }).join("");
  }

  function resizeCandleChart() {
    if (!candleCanvas || !candleCanvas.parentElement) return;
    if (deskCinematicOn()) return;
    const parent = candleCanvas.parentElement;
    const w = Math.max(180, parent.clientWidth - 8);
    const h = Math.max(200, parent.clientHeight - (parent.querySelector(".panel-head")?.offsetHeight || 36) - 8);
    if (candleCanvas.width !== w || candleCanvas.height !== h) {
      // Setting width/height clears pixels. Keep last tape if we cannot redraw.
      const raw = ((state && state.market) || {}).candles || [];
      if (raw.length < 2 && candleCanvas.dataset.hasTape === "1") return;
      candleCanvas.width = w;
      candleCanvas.height = h;
    }
  }

  
  const DISPLAY = {
    candle: "WICK", volume: "PULSE", momentum: "DRIFT", orderflow: "TAPE",
    funding: "CARRY", regime: "ORBIT", volatility: "VOLT", oi_pressure: "CHAIN",
    streak: "STREAK", odds: "ODDS", guardian: "WARDEN", law: "LAW",
  };

  function hierarchyOrder() {
    const h = (state && state.hierarchy) || (state && state.learning && state.learning.hierarchy) || [];
    if (h.length) return h.map(r => r.agent).filter(a => AGENT_ORDER.includes(a));
    return AGENT_ORDER.filter(a => a !== "law" && a !== "guardian");
  }

  function renderHierarchy() {
    const list = document.getElementById("hierarchyList");
    const meta = document.getElementById("hierarchyMeta");
    if (!list) return;
    const hier = (state && state.hierarchy) || (state && state.learning && state.learning.hierarchy) || [];
    const agents = (state && state.agents) || [];
    const byName = {};
    agents.forEach(a => { byName[a.agent_name] = a; });

    let rows = hier.length ? hier.slice() : AGENT_ORDER.filter(n => n !== "law").map((n, i) => ({
      agent: n, rank: i + 1, listen: 1, win_rate: null, correct: 0, wrong: 0, weight: 0
    }));

    // Attach live direction
    rows = rows.filter(r => r.agent !== "law");
    list.innerHTML = rows.map((r, idx) => {
      const ag = byName[r.agent] || {};
      const dir = ag.direction || "WAIT";
      const conf = ag.confidence != null ? ag.confidence : "—";
      const name = r.display_name || DISPLAY[r.agent] || r.agent.toUpperCase();
      const wr = r.win_rate != null ? `${Math.round(r.win_rate * 100)}%` : "—";
      const rec = `${r.correct || 0}/${(r.correct || 0) + (r.wrong || 0)}`;
      const listen = r.listen != null ? Math.round(r.listen * 100) : 100;
      const muted = listen < 40;
      const faded = !!(r.faded || r.invert);
      const antiPairs = (state && state.learning && state.learning.top_anti_pairs) || [];
      const isAntiWinner = antiPairs.some(p => p.winner === r.agent);
      const isAntiLoser = antiPairs.some(p => p.loser === r.agent);
      const top = (r.rank || idx + 1) <= 3;
      return `<div class="hier-row ${top ? "top" : ""} ${muted ? "muted-rank" : ""}" title="${ag.reasoning || ""}">
        <span class="hier-rank">#${r.rank || idx + 1}</span>
        <div>
          <div class="hier-name">${name}</div>
          <div class="hier-meta">${rec} · ${wr} · listen ${listen}%${faded ? " · <span class=\"fade-tag\">FADE</span>" : ""}${isAntiWinner ? " · <span class=\"anti-tag\">ANTI✓</span>" : ""}${isAntiLoser ? " · <span class=\"anti-tag anti-lose\">ANTI✗</span>" : ""}</div>
        </div>
        <span class="hier-dir ${dir}">${dir} ${conf}${conf !== "—" ? "%" : ""}</span>
      </div>`;
    }).join("");
    if (meta) meta.textContent = `${rows.length} seats · live ranks`;
  }

function drawCandleChart() {
    if (!candleCtx || !candleCanvas) return;
    if (deskCinematicOn()) return;

    const market = (state && state.market) || {};
    const raw = market.candles || [];
    const livePrice = Number(market.price);
    const kalshiTarget = Number(market.kalshi_target);

    if (raw.length < 2) {
      // Keep the last painted tape — do not clear to NO TAPE
      if (candleCanvas.dataset.hasTape === "1") return;
      resizeCandleChart();
      const w0 = candleCanvas.width;
      const h0 = candleCanvas.height;
      candleCtx.clearRect(0, 0, w0, h0);
      candleCtx.fillStyle = "rgba(2, 6, 14, 0.35)";
      candleCtx.fillRect(0, 0, w0, h0);
      candleCtx.fillStyle = "rgba(120,140,160,0.6)";
      candleCtx.font = "11px Orbitron, monospace";
      candleCtx.textAlign = "center";
      candleCtx.fillText("NO TAPE", w0 / 2, h0 / 2);
      return;
    }
    candleCanvas.dataset.hasTape = "1";
    resizeCandleChart();
    const w = candleCanvas.width;
    const h = candleCanvas.height;
    candleCtx.clearRect(0, 0, w, h);

    // subtle panel backdrop
    candleCtx.fillStyle = "rgba(2, 6, 14, 0.35)";
    candleCtx.fillRect(0, 0, w, h);

    const candles = raw.slice(-48);
    let min = Infinity, max = -Infinity;
    candles.forEach(c => {
      const lo = Number(c.l ?? c.low);
      const hi = Number(c.h ?? c.high);
      if (Number.isFinite(lo)) min = Math.min(min, lo);
      if (Number.isFinite(hi)) max = Math.max(max, hi);
    });
    // Fit current price + Kalshi target into scale
    if (Number.isFinite(livePrice)) {
      min = Math.min(min, livePrice);
      max = Math.max(max, livePrice);
    }
    if (Number.isFinite(kalshiTarget)) {
      min = Math.min(min, kalshiTarget);
      max = Math.max(max, kalshiTarget);
    }
    if (!(max > min)) {
      min -= 1; max += 1;
    }
    const pad = (max - min) * 0.08 || 1;
    min -= pad; max += pad;

    const left = 8, right = 8, top = 18, bottom = 16;
    const cw = (w - left - right) / candles.length;
    const bodyW = Math.max(2, cw * 0.55);

    // grid lines
    candleCtx.strokeStyle = "rgba(0, 232, 255, 0.06)";
    candleCtx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = top + ((h - top - bottom) * i) / 3;
      candleCtx.beginPath();
      candleCtx.moveTo(left, y);
      candleCtx.lineTo(w - right, y);
      candleCtx.stroke();
    }

    const yAt = (price) => top + (1 - (price - min) / (max - min)) * (h - top - bottom);

    candles.forEach((c, i) => {
      const o = Number(c.o ?? c.open);
      const cl = Number(c.c ?? c.close);
      const hi = Number(c.h ?? c.high);
      const lo = Number(c.l ?? c.low);
      const x = left + i * cw + cw / 2;
      const up = cl >= o;
      const col = up ? "#39ff14" : "#ff2d55";

      // wick
      candleCtx.strokeStyle = col;
      candleCtx.globalAlpha = 0.55;
      candleCtx.beginPath();
      candleCtx.moveTo(x, yAt(hi));
      candleCtx.lineTo(x, yAt(lo));
      candleCtx.stroke();

      // body
      candleCtx.globalAlpha = 0.85;
      const y1 = yAt(o);
      const y2 = yAt(cl);
      const by = Math.min(y1, y2);
      const bh = Math.max(1, Math.abs(y2 - y1));
      candleCtx.fillStyle = col;
      candleCtx.fillRect(x - bodyW / 2, by, bodyW, bh);
    });
    candleCtx.globalAlpha = 1;

    // ── Kalshi target line (floor_strike) ──
    if (Number.isFinite(kalshiTarget)) {
      const yt = yAt(kalshiTarget);
      candleCtx.save();
      candleCtx.setLineDash([5, 4]);
      candleCtx.strokeStyle = "#f0c14a";
      candleCtx.lineWidth = 1.6;
      candleCtx.shadowColor = "rgba(240, 193, 74, 0.55)";
      candleCtx.shadowBlur = 8;
      candleCtx.beginPath();
      candleCtx.moveTo(left, yt);
      candleCtx.lineTo(w - right, yt);
      candleCtx.stroke();
      candleCtx.setLineDash([]);
      candleCtx.shadowBlur = 0;
      candleCtx.font = "600 9px Orbitron, monospace";
      candleCtx.fillStyle = "#f0c14a";
      candleCtx.textAlign = "left";
      candleCtx.fillText(
        `K TARGET  ${kalshiTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        left + 2,
        Math.max(top + 10, yt - 4)
      );
      candleCtx.restore();
    }

    // ── Current price line ──
    const last = Number.isFinite(livePrice)
      ? livePrice
      : Number(candles[candles.length - 1].c ?? candles[candles.length - 1].close);
    if (Number.isFinite(last)) {
      const yp = yAt(last);
      const aboveTarget = Number.isFinite(kalshiTarget) ? last >= kalshiTarget : null;
      const priceCol = aboveTarget === null
        ? "#00e8ff"
        : aboveTarget
          ? "#39ff14"
          : "#ff2d55";

      candleCtx.save();
      candleCtx.strokeStyle = priceCol;
      candleCtx.lineWidth = 1.4;
      candleCtx.shadowColor = priceCol;
      candleCtx.shadowBlur = 10;
      candleCtx.beginPath();
      candleCtx.moveTo(left, yp);
      candleCtx.lineTo(w - right, yp);
      candleCtx.stroke();
      candleCtx.shadowBlur = 0;

      // right-edge price badge
      const label = last.toLocaleString(undefined, { maximumFractionDigits: 1 });
      candleCtx.font = "700 10px Orbitron, monospace";
      const tw = candleCtx.measureText(label).width + 8;
      const bx = w - right - tw;
      const by = Math.min(h - bottom - 2, Math.max(top + 2, yp - 7));
      candleCtx.fillStyle = "rgba(2, 6, 14, 0.85)";
      candleCtx.fillRect(bx, by, tw, 14);
      candleCtx.strokeStyle = priceCol;
      candleCtx.lineWidth = 1;
      candleCtx.strokeRect(bx, by, tw, 14);
      candleCtx.fillStyle = priceCol;
      candleCtx.textAlign = "center";
      candleCtx.fillText(label, bx + tw / 2, by + 11);
      candleCtx.restore();

      if (candlePriceTag) {
        const delta = Number.isFinite(kalshiTarget) ? last - kalshiTarget : null;
        const deltaTxt = delta == null
          ? ""
          : ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(0)} vs K`;
        candlePriceTag.textContent =
          last.toLocaleString(undefined, { maximumFractionDigits: 1 }) + deltaTxt;
      }
    }
  }

  function liveBookOdds(m) {
    /* Same live book the footer uses — never invent 0.0% from a missing print. */
    if (!m) return null;
    function pct(v) {
      if (v == null || v === "") return NaN;
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) return NaN;
      return n > 0 && n <= 1.5 ? n * 100 : n;
    }
    let up = pct(m.up_pct);
    if (!Number.isFinite(up)) up = pct(m.up_mid);
    if (!Number.isFinite(up)) up = pct(m.yes_price);
    if (!Number.isFinite(up)) up = pct(m.kalshi_yes_bid);
    if (!Number.isFinite(up)) up = pct(m.kalshi_yes_ask);
    let down = pct(m.down_pct);
    if (!Number.isFinite(down)) down = pct(m.no_price);
    if (!Number.isFinite(down) && Number.isFinite(up)) down = 100 - up;
    if (!Number.isFinite(up) || up <= 0 || up >= 100) return null;
    if (!Number.isFinite(down)) down = 100 - up;
    return { up, down };
  }

  function recordSeriesFromState(s) {
    if (!s) return;
    const t = Date.now();
    const m = s.market || {};
    const price = Number(m.price);
    const target = Number(m.kalshi_target);
    const book = liveBookOdds(m);
    if (book) pushSeries(series.odds, { t, up: book.up, down: book.down });
    if (Number.isFinite(price) && Number.isFinite(target)) {
      pushSeries(series.delta, { t, d: price - target });
    }
    function takeFunding(mm) {
      if (!mm || mm.funding == null) return;
      const f = Number(mm.funding);
      if (!Number.isFinite(f)) return;
      pushSeries(series.funding, { t, f: Math.abs(f) > 1 ? f : f * 100 });
    }
    takeFunding(m);
    if (typeof tableState === "function") {
      takeFunding((tableState("bitcoin") || {}).market);
      takeFunding((tableState("ethereum") || {}).market);
    }
    const dir = (s.decision && s.decision.direction) || "WAIT";
    const conf = (s.decision && s.decision.confidence) || 0;
    const lastTape = series.tape[series.tape.length - 1];
    if (!lastTape || lastTape.dir !== dir || lastTape.conf !== conf) {
      pushSeries(series.tape, { t, dir, conf });
    }
    const acc = s.accuracy || {};
    const n = Number(acc.total) || 0;
    // Finish-only: never invent a win rate when n=0
    if (n > 0) {
      const pct = acc.accuracy_pct != null
        ? Number(acc.accuracy_pct)
        : (acc.correct != null ? (Number(acc.correct) / n) * 100 : null);
      if (pct != null && Number.isFinite(pct)) {
        pushSeries(series.accuracy, { t, pct, n, correct: Number(acc.correct) || 0 });
      }
    }
  }

  function fitCanvas(canvas, opts) {
    if (!canvas || !canvas.parentElement) return null;
    if (deskCinematicOn()) return canvas.getContext("2d");
    const parent = canvas.parentElement;
    const head = parent.querySelector(".chart-card-head");
    const isPair = canvas.id === "chartBtc" || canvas.id === "chartEth";
    const minW = 160;
    const wantRows = (opts && opts.rows) || 0;
    const minH = isPair ? 220 : (canvas.id === "chartWeights" ? Math.max(160, wantRows * 15 + 20) : 140);
    const w = Math.max(minW, parent.clientWidth || minW);
    let h = (parent.clientHeight || 0) - (head ? head.offsetHeight : 0);
    if (h < minH) h = minH;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    return canvas.getContext("2d");
  }

  function chartFrame(ctx, w, h, titleColor) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(2, 6, 14, 0.25)";
    ctx.fillRect(0, 0, w, h);
  }

  function drawLineSeries(ctx, points, getY, color, opts = {}) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const pad = opts.pad || { l: 8, r: 8, t: 10, b: 12 };
    if (!points.length) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("COLLECTING…", w / 2, h / 2);
      return;
    }
    let min = Infinity, max = -Infinity;
    if (Number.isFinite(opts.yMin) && Number.isFinite(opts.yMax)) {
      min = opts.yMin;
      max = opts.yMax;
    } else {
      points.forEach(p => {
        const y = getY(p);
        if (Number.isFinite(y)) { min = Math.min(min, y); max = Math.max(max, y); }
      });
      if (!(max > min)) { min -= 1; max += 1; }
    }
    const span = max - min || 1;
    const yAt = (v) => pad.t + (1 - (v - min) / span) * (h - pad.t - pad.b);
    const xAt = (i) => pad.l + (i / Math.max(1, points.length - 1)) * (w - pad.l - pad.r);

    // zero / mid guide
    if (opts.zero != null && min <= opts.zero && max >= opts.zero) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(pad.l, yAt(opts.zero));
      ctx.lineTo(w - pad.r, yAt(opts.zero));
      ctx.stroke();
    }

    ctx.beginPath();
    let started = false;
    points.forEach((p, i) => {
      const v = getY(p);
      if (!Number.isFinite(v)) return;
      const x = xAt(i), y = yAt(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.width || 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // last point
    const last = points[points.length - 1];
    const lv = getY(last);
    if (Number.isFinite(lv)) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xAt(points.length - 1), yAt(lv), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function parseStampMs(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      return n < 1e12 ? n * 1000 : n;
    }
    const d = Date.parse(s);
    return Number.isFinite(d) ? d : null;
  }

  function candleOHLC(c) {
    if (!c) return null;
    let o, h, l, cl, t, v;
    if (Array.isArray(c)) {
      t = c[0]; o = Number(c[1]); h = Number(c[2]); l = Number(c[3]); cl = Number(c[4]); v = Number(c[5]);
    } else {
      o = Number(c.o != null ? c.o : c.open);
      h = Number(c.h != null ? c.h : c.high);
      l = Number(c.l != null ? c.l : c.low);
      cl = Number(c.c != null ? c.c : c.close);
      t = c.t != null ? c.t : c.open_time;
      v = Number(c.v != null ? c.v : c.volume);
    }
    if (![o, h, l, cl].every(Number.isFinite)) return null;
    if (cl <= 0 || cl > 5e6 || h <= 0 || l <= 0 || h > 5e6 || l > 5e6) return null;
    if (h > cl * 1.25 || l < cl * 0.75) return null;
    if (h < l) { const swap = h; h = l; l = swap; }
    return { o, h, l, c: cl, t, v };
  }

  function candleTimeMs(c) {
    if (!c) return null;
    return parseStampMs(c.t != null ? c.t : c.open_time);
  }

  function hourWindowMs(ts) {
    const m = (ts && ts.market) || {};
    const lc = (ts && (ts.locked_call || (ts.decision && ts.decision.locked_call))) || {};
    const close = parseStampMs(m.close_time || lc.close_time);
    if (close) return { start: close - 3600000, end: close };
    const now = Date.now();
    const start = Math.floor(now / 3600000) * 3600000;
    return { start, end: start + 3600000 };
  }

  function xAtTime(candles, tMs, pad, w) {
    if (!candles.length || tMs == null) return null;
    const cw = (w - pad.l - pad.r) / candles.length;
    let idx = 0;
    let found = false;
    for (let i = 0; i < candles.length; i++) {
      const tm = candleTimeMs(candles[i]);
      if (tm == null) continue;
      found = true;
      if (tm <= tMs) idx = i;
    }
    if (!found) return null;
    return pad.l + idx * cw + cw / 2;
  }

  function pairLock(ts) {
    if (!ts) return null;
    const lc = ts.locked_call || (ts.decision && ts.decision.locked_call) || null;
    if (lc && lc.locked && lc.direction) return lc;
    return null;
  }

  function syncChartPairTitle() {
    // Both pairs stay on screen — do not retitle BTC to ETH on focus
    const btcTitle = document.getElementById("chartPairTitle") || document.getElementById("chartBtcTitle");
    const ethTitle = document.getElementById("chartEthTitle");
    if (btcTitle) btcTitle.textContent = "BTC · 1m";
    if (ethTitle) ethTitle.textContent = "ETH · 1m";
  }

  function drawHourWindowAndLock(ctx, candles, ts, pad, w, h, yAt) {
    const win = hourWindowMs(ts);
    const x0 = xAtTime(candles, win.start, pad, w);
    const x1 = xAtTime(candles, win.end, pad, w);
    const left = x0 != null ? x0 : pad.l;
    const right = x1 != null ? x1 : (w - pad.r);
    ctx.save();
    ctx.fillStyle = "rgba(240, 193, 74, 0.14)";
    ctx.fillRect(Math.min(left, right), pad.t, Math.max(6, Math.abs(right - left)), h - pad.t - pad.b);
    ctx.strokeStyle = "rgba(240, 193, 74, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(left, pad.t);
    ctx.lineTo(left, h - pad.b);
    ctx.moveTo(right, pad.t);
    ctx.lineTo(right, h - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(240, 193, 74, 0.75)";
    ctx.font = "8px Orbitron, monospace";
    ctx.textAlign = "left";
    ctx.fillText("1H WINDOW", left + 4, pad.t + 10);
    const lc = pairLock(ts);
    const lockMs = (lc && parseStampMs(lc.locked_at)) || Date.now();
    const xLock = xAtTime(candles, lockMs, pad, w) || (w - pad.r - 8);
    ctx.strokeStyle = "#f0c14a";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#f0c14a";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(xLock, pad.t);
    ctx.lineTo(xLock, h - pad.b);
    ctx.stroke();
    ctx.shadowBlur = 0;
    let lockPx = lc ? Number(lc.entry_price != null ? lc.entry_price : lc.price) : NaN;
    if (!Number.isFinite(lockPx)) {
      let nearest = null, best = Infinity;
      candles.forEach(c => {
        const tm = candleTimeMs(c);
        if (tm == null) return;
        const d = Math.abs(tm - lockMs);
        if (d < best) { best = d; nearest = c; }
      });
      if (nearest) lockPx = Number(nearest.c);
    }
    if (Number.isFinite(lockPx) && typeof yAt === "function") {
      const y = yAt(lockPx);
      ctx.fillStyle = "#f0c14a";
      ctx.beginPath();
      ctx.moveTo(xLock, y - 5);
      ctx.lineTo(xLock + 5, y);
      ctx.lineTo(xLock, y + 5);
      ctx.lineTo(xLock - 5, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#f0c14a";
    ctx.font = "8px Orbitron, monospace";
    ctx.textAlign = "center";
    ctx.fillText("LOCK", xLock, pad.t + 22);
    ctx.restore();
  }

  function drawPairCandles(canvasId, tableKey, metaId) {
    if (deskCinematicOn()) return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ts = (typeof tableState === "function" ? tableState(tableKey) : null) || {};
    const market = ts.market || {};
    const raw = (market.candles || []).slice(-60);
    const candles = raw.map(candleOHLC).filter(Boolean);
    const target = Number(market.kalshi_target);
    const price = Number(market.price);
    const meta = document.getElementById(metaId);
    if (meta) {
      meta.textContent = Number.isFinite(price)
        ? price.toLocaleString(undefined, { maximumFractionDigits: 1 })
        : "—";
    }
    if (candles.length < 2) {
      const ctx0 = fitCanvas(canvas);
      if (!ctx0) return;
      const w0 = canvas.width, h0 = canvas.height;
      chartFrame(ctx0, w0, h0);
      ctx0.fillStyle = "rgba(120,140,160,0.5)";
      ctx0.font = "11px Orbitron";
      ctx0.textAlign = "center";
      ctx0.fillText("NO TAPE", w0 / 2, h0 / 2);
      return;
    }
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    /* Scale from the tape only so a far K TARGET cannot pin price to the floor. */
    const closes = candles.map(c => c.c).filter(n => Number.isFinite(n) && n > 0);
    let min = Math.min.apply(null, closes);
    let max = Math.max.apply(null, closes);
    const spanC = (max - min) || Math.abs(max) * 0.002 || 1;
    candles.forEach(c => {
      if (Number.isFinite(c.l) && c.l > 0 && (min - c.l) <= spanC * 2) min = Math.min(min, c.l);
      if (Number.isFinite(c.h) && c.h > 0 && (c.h - max) <= spanC * 2) max = Math.max(max, c.h);
    });
    if (Number.isFinite(price) && price > 0 && price < 5e6) {
      const mid = (min + max) / 2 || price;
      if (price >= min && price <= max || Math.abs(price - mid) / (Math.abs(mid) || 1) < 0.08) {
        min = Math.min(min, price);
        max = Math.max(max, price);
      }
    }
    let targetY = null;
    if (Number.isFinite(target) && target > 0 && target < 5e6) {
      const span0 = max - min || Math.abs(max) * 0.01 || 1;
      const grown = Math.max(max, target) - Math.min(min, target);
      if (grown <= span0 * 4) {
        min = Math.min(min, target);
        max = Math.max(max, target);
        targetY = target;
      } else {
        targetY = target < min ? min : max;
      }
    }
    const padAmt = (max - min) * 0.08 || Math.abs(max) * 0.002 || 1;
    min -= padAmt;
    max += padAmt;
    const pad = { l: 6, r: 6, t: 14, b: 10 };
    const yAt = (p) => pad.t + (1 - (p - min) / (max - min || 1)) * (h - pad.t - pad.b);
    drawHourWindowAndLock(ctx, candles, ts, pad, w, h, yAt);
    const cw = (w - pad.l - pad.r) / candles.length;
    candles.forEach((c, i) => {
      const x = pad.l + i * cw + cw / 2;
      const up = c.c >= c.o;
      const col = up ? "#39ff14" : "#ff2d55";
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(x, yAt(c.h)); ctx.lineTo(x, yAt(c.l)); ctx.stroke();
      ctx.globalAlpha = 0.9;
      const by = Math.min(yAt(c.o), yAt(c.c));
      const bh = Math.max(1, Math.abs(yAt(c.c) - yAt(c.o)));
      ctx.fillStyle = col;
      ctx.fillRect(x - Math.max(1, cw * 0.3), by, Math.max(2, cw * 0.6), bh);
    });
    ctx.globalAlpha = 1;
    if (targetY != null) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#f0c14a";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad.l, yAt(targetY)); ctx.lineTo(w - pad.r, yAt(targetY)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f0c14a";
      ctx.font = "9px Orbitron";
      ctx.textAlign = "left";
      ctx.fillText("K TARGET", pad.l + 4, Math.max(pad.t + 10, yAt(targetY) - 4));
    }
    if (Number.isFinite(price) && price > 0 && price < 5e6) {
      const py = Math.min(max, Math.max(min, price));
      const col = Number.isFinite(target) ? (price >= target ? "#39ff14" : "#ff2d55") : "#00e8ff";
      ctx.strokeStyle = col; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(pad.l, yAt(py)); ctx.lineTo(w - pad.r, yAt(py)); ctx.stroke();
    }
  }

  function drawChartBtc() {
    if (deskCinematicOn()) return;
    syncChartPairTitle();
    drawPairCandles("chartBtc", "bitcoin", "chartBtcMeta");
  }

  function drawChartEth() {
    if (deskCinematicOn()) return;
    syncChartPairTitle();
    drawPairCandles("chartEth", "ethereum", "chartEthMeta");
  }

  function drawChartVolume() {
    const canvas = document.getElementById("chartVolume");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    const candles = ((state && state.market && state.market.candles) || []).slice(-48);
    const vols = candles.map(c => Number(c.v) || 0);
    const maxV = Math.max(...vols, 1);
    const pad = { l: 6, r: 6, t: 8, b: 8 };
    const bw = (w - pad.l - pad.r) / Math.max(vols.length, 1);
    vols.forEach((v, i) => {
      const bh = (v / maxV) * (h - pad.t - pad.b);
      const x = pad.l + i * bw;
      const up = Number(candles[i].c) >= Number(candles[i].o);
      ctx.fillStyle = up ? "rgba(57,255,20,0.55)" : "rgba(255,45,85,0.55)";
      ctx.fillRect(x + 1, h - pad.b - bh, Math.max(1, bw - 2), bh);
    });
    const meta = document.getElementById("chartVolMeta");
    if (meta && vols.length) meta.textContent = `last ${vols[vols.length - 1].toFixed(2)}`;
  }

  function drawChartOdds() {
    const canvas = document.getElementById("chartOdds");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    const meta = document.getElementById("chartOddsMeta");
    const book = liveBookOdds((state && state.market) || {});
    if (book && !series.odds.length) {
      pushSeries(series.odds, { t: Date.now(), up: book.up, down: book.down });
    }
    const last = series.odds.length ? series.odds[series.odds.length - 1] : null;
    const up = book ? book.up : Number(last && last.up);
    const down = book ? book.down : (Number.isFinite(Number(last && last.down))
      ? Number(last.down)
      : (Number.isFinite(up) ? 100 - up : NaN));
    if (meta) {
      meta.textContent = (Number.isFinite(Number(up)) && Number.isFinite(Number(down)))
        ? (`UP ${Math.round(up)}% · DOWN ${Math.round(down)}%`)
        : "waiting on live book";
    }
    if (!series.odds.length) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("waiting on live book", canvas.width / 2, canvas.height / 2);
      return;
    }
    drawLineSeries(ctx, series.odds, p => p.up, "#39ff14", { zero: 50, yMin: 0, yMax: 100 });
    drawLineSeries(ctx, series.odds, p => p.down, "#ff2d55", { yMin: 0, yMax: 100 });
  }

  function drawChartDelta() {
    const canvas = document.getElementById("chartDelta");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    drawLineSeries(ctx, series.delta, p => p.d, "#f0c14a", { zero: 0 });
    const meta = document.getElementById("chartDeltaMeta");
    const last = series.delta[series.delta.length - 1];
    if (meta && last) {
      meta.textContent = `${last.d >= 0 ? "+" : ""}${last.d.toFixed(0)}`;
      meta.style.color = last.d >= 0 ? "#39ff14" : "#ff2d55";
    }
  }

  function drawChartFunding() {
    const canvas = document.getElementById("chartFunding");
    if (!canvas) return;
    const card = canvas.closest(".chart-card");
    if (!series.funding.length) {
      const mm = (state && state.market) || {};
      const f = Number(mm.funding);
      if (Number.isFinite(f)) {
        pushSeries(series.funding, { t: Date.now(), f: Math.abs(f) > 1 ? f : f * 100 });
      }
    }
    if (!series.funding.length) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    drawLineSeries(ctx, series.funding, p => p.f, "#a855f7", { zero: 0 });
    const meta = document.getElementById("chartFundMeta");
    const last = series.funding[series.funding.length - 1];
    if (meta) meta.textContent = last ? `${last.f.toFixed(4)}%` : "—";
  }

  function pairFromLockRow(r, fallback) {
    const a = String((r && r.asset) || "").toLowerCase();
    if (a === "eth" || a === "ethereum") return "ETH";
    if (a === "btc" || a === "bitcoin") return "BTC";
    const tick = String((r && r.ticker) || "");
    if (/ETH/i.test(tick)) return "ETH";
    if (/BTC/i.test(tick)) return "BTC";
    return fallback || "—";
  }

  function sideFromLockRow(r) {
    const d = String((r && (r.direction || r.locked_call || r.side)) || "").toUpperCase();
    if (d.includes("UP")) return "UP";
    if (d.includes("DOWN")) return "DOWN";
    return d || "—";
  }

  function fmtLockTime(t) {
    const ms = parseStampMs(t);
    if (ms == null) return "—";
    return new Date(ms).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function windowLabelOf(r, ts) {
    const close = (r && (r.close_time || r.window_close)) || (ts && ts.market && ts.market.close_time);
    const ms = parseStampMs(close);
    if (ms != null) {
      return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    const tick = String((r && r.ticker) || (ts && ts.market && ts.market.kalshi_ticker) || "");
    const m = tick.match(/(\d{2})(\d{2})(?!.*\d)/);
    if (m) return m[1] + ":" + m[2];
    return "1H";
  }

  function tableLean(ts) {
    const lc = pairLock(ts);
    if (lc) {
      return { side: sideFromLockRow(lc), locked: true, conf: lc.confidence };
    }
    const d = (ts && ts.decision) || {};
    const raw = String(d.direction || "WAIT").toUpperCase();
    const side = raw.includes("UP") ? "UP" : (raw.includes("DOWN") ? "DOWN" : "WAIT");
    return { side, locked: false, conf: d.confidence };
  }

  function whyThisLockLine(ts) {
    const lc = pairLock(ts);
    if (!lc) return null;
    const side = sideFromLockRow(lc);
    const conf = lc.confidence != null ? lc.confidence : "—";
    const agents = ((ts && ts.agents) || []).filter(a => a && a.agent_name && a.agent_name !== "leader" && a.agent_name !== "law");
    const allies = agents
      .filter(a => {
        const d = String(a.direction || "").toUpperCase();
        return side === "UP" ? d.includes("UP") : (side === "DOWN" ? d.includes("DOWN") : false);
      })
      .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));
    const seats = allies.slice(0, 2).map(a => (AGENT_LABELS && AGENT_LABELS[a.agent_name]) || a.agent_name);
    return { side, conf, seats };
  }

  function dockWindowLed() {
    const led = document.getElementById("windowLed");
    if (!led) return;
    if (mode === "floor") {
      const header = document.querySelector("#app > header");
      const tabs = header && header.querySelector(".mode-tabs");
      if (tabs && tabs.parentNode && led.previousElementSibling !== tabs) {
        tabs.parentNode.insertBefore(led, tabs.nextSibling);
      }
    } else {
      const col = document.getElementById("lifetimePanel");
      if (col && col.firstElementChild !== led) col.insertBefore(led, col.firstChild);
    }
  }

  function paintTableHud() {
    const list = document.getElementById("lockTapeList");
    const meta = document.getElementById("lockTapeMeta");
    const locks = (typeof collectChairLocks === "function") ? collectChairLocks() : [];
    if (list) {
      if (!locks.length) {
        list.innerHTML = '<li class="lock-tape-empty">No Chair lock this hour — waiting on Satoshi / Vitalik</li>';
      } else {
        list.innerHTML = locks.slice(0, 8).map(p => {
          const result = p.status === "OPEN"
            ? "OPEN"
            : (p.grade || p.outcome || "SETTLED");
          const conf = p.conf != null ? (p.conf + "%") : "—";
          const win = p.window || "1H";
          return `<li class="lock-tape-row ${p.status === "OPEN" ? "open" : "settled"}">`
            + `<span class="lt-pair">${p.pair}</span>`
            + `<span class="lt-side ${p.side === "UP" ? "up" : "down"}">${p.side}</span>`
            + `<span class="lt-conf">${conf}</span>`
            + `<span class="lt-win">${win}</span>`
            + `<span class="lt-res">${result}</span>`
            + `</li>`;
        }).join("");
      }
    }
    if (meta) meta.textContent = locks.length ? (locks.length + " printed") : "baseline";

    const whyCard = document.getElementById("whyLockCard");
    const whyLine = document.getElementById("whyLockLine");
    const focused = (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    let why = whyThisLockLine(focused);
    if (!why) {
      const other = focusTable === "ethereum" ? "bitcoin" : "ethereum";
      why = whyThisLockLine((typeof tableState === "function" ? tableState(other) : null) || {});
    }
    if (whyCard && whyLine) {
      if (why) {
        whyCard.classList.remove("hidden");
        const seats = (why.seats && why.seats.length)
          ? why.seats.join(" + ")
          : "council majority";
        whyLine.textContent = `${why.side} · ${why.conf}% · ${seats}`;
      } else {
        whyCard.classList.add("hidden");
        whyLine.textContent = "—";
      }
    }

    const b = tableLean((typeof tableState === "function" ? tableState("bitcoin") : null) || {});
    const e = tableLean((typeof tableState === "function" ? tableState("ethereum") : null) || {});
    const btcEl = document.getElementById("dualFightBtc");
    const ethEl = document.getElementById("dualFightEth");
    const vsEl = document.getElementById("dualFightVs");
    const fightMeta = document.getElementById("dualFightMeta");
    const strip = document.getElementById("dualFightStrip");
    function leanTxt(tag, lean) {
      const lock = lean.locked ? "LOCK " : "";
      const conf = lean.conf != null ? (" " + lean.conf + "%") : "";
      return tag + " " + lock + lean.side + conf;
    }
    if (btcEl) btcEl.textContent = leanTxt("BTC", b);
    if (ethEl) ethEl.textContent = leanTxt("ETH", e);
    let verdict = "HOLD";
    if (b.side === "UP" && e.side === "UP") verdict = "AGREE UP";
    else if (b.side === "DOWN" && e.side === "DOWN") verdict = "AGREE DOWN";
    else if ((b.side === "UP" && e.side === "DOWN") || (b.side === "DOWN" && e.side === "UP")) verdict = "FIGHT";
    if (vsEl) vsEl.textContent = verdict === "FIGHT" ? "⚔" : (verdict.indexOf("AGREE") === 0 ? "✓" : "·");
    if (fightMeta) fightMeta.textContent = verdict;
    if (strip) {
      strip.classList.toggle("agree", verdict.indexOf("AGREE") === 0);
      strip.classList.toggle("fight", verdict === "FIGHT");
    }
  }

  function collectChairLocks() {
    const items = [];
    const seen = new Set();
    function add(item) {
      if (!item || !item.side || item.side === "—") return;
      const key = [item.pair, item.side, item.status, item.ticker || item.id || item.t].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    }
    function ingestAcc(acc, fallbackPair) {
      if (!acc) return;
      const openRows = Array.isArray(acc.open) ? acc.open : [];
      const settled = acc.log || acc.recent || [];
      openRows.forEach(r => add({
        pair: pairFromLockRow(r, fallbackPair),
        side: sideFromLockRow(r),
        t: r.called_at || r.locked_at,
        status: "OPEN",
        conf: r.confidence,
        window: windowLabelOf(r),
        id: r.id,
        ticker: r.ticker,
      }));
      settled.forEach(r => add({
        pair: pairFromLockRow(r, fallbackPair),
        side: sideFromLockRow(r),
        t: r.called_at || r.settled_at,
        status: "SETTLED",
        outcome: r.outcome || r.y_finish,
        grade: r.correct === true ? "HIT" : (r.correct === false ? "MISS" : ""),
        conf: r.confidence,
        window: windowLabelOf(r),
        id: r.id,
        ticker: r.ticker,
      }));
    }
    ["bitcoin", "ethereum"].forEach(key => {
      const ts = (typeof tableState === "function" ? tableState(key) : null) || {};
      const pair = key === "ethereum" ? "ETH" : "BTC";
      const lc = pairLock(ts);
      if (lc) {
        add({
          pair,
          side: sideFromLockRow(lc),
          t: lc.locked_at,
          status: "OPEN",
          conf: lc.confidence,
          window: windowLabelOf(lc, ts),
          ticker: lc.ticker,
          id: "live:" + pair + ":" + (lc.ticker || lc.locked_at || ""),
        });
      }
      ingestAcc(ts.accuracy, pair);
    });
    ingestAcc(state && state.accuracy, null);
    items.sort((a, b) => (parseStampMs(b.t) || 0) - (parseStampMs(a.t) || 0));
    return items;
  }

  function drawChartTape() {
    const canvas = document.getElementById("chartTape");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    const locks = collectChairLocks();
    const list = document.getElementById("chartTapeList");
    const meta = document.getElementById("chartTapeMeta");
    if (!locks.length) {
      ctx.fillStyle = "rgba(120,140,160,0.7)";
      ctx.font = "10px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO CHAIR LOCKS YET", w / 2, h / 2);
      if (meta) meta.textContent = "no locks";
      if (list) {
        list.innerHTML = '<li class="chart-lock-empty">No Chair locks yet — tape waits on a lock, not live lean.</li>';
        list.classList.add("empty");
      }
      return;
    }
    if (list) list.classList.remove("empty");
    const pts = locks.slice(0, 16).reverse();
    const pad = { l: 8, r: 8, t: 14, b: 12 };
    const slot = (w - pad.l - pad.r) / Math.max(pts.length, 1);
    const barW = Math.min(10, Math.max(3, slot * 0.35));
    pts.forEach((p, i) => {
      const col = p.side === "UP" ? "#39ff14" : (p.side === "DOWN" ? "#ff2d55" : "#8aa0b8");
      const x = pad.l + i * slot + slot / 2;
      const barH = p.status === "OPEN" ? (h - pad.t - pad.b) * 0.72 : (h - pad.t - pad.b) * 0.5;
      ctx.globalAlpha = p.status === "OPEN" ? 0.9 : 0.55;
      if (p.status === "OPEN") {
        ctx.fillStyle = col;
        ctx.fillRect(x - barW / 2, h - pad.b - barH, barW, barH);
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x - barW / 2, h - pad.b - barH, barW, barH);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = "7px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText((p.pair || "")[0] + p.side[0], x, h - pad.b - barH - 3);
    });
    const last = locks[0];
    if (meta && last) {
      meta.textContent = `${last.pair} ${last.side} · ${last.status}${last.grade ? " · " + last.grade : ""}`;
    }
    if (list) {
      list.innerHTML = locks.slice(0, 10).map(p => {
        const when = fmtLockTime(p.t);
        const grade = p.status === "SETTLED"
          ? (p.grade ? p.grade : (p.outcome || "settled"))
          : "open";
        return `<li class="chart-lock-row ${p.status === "OPEN" ? "lock-open" : "lock-settled"}">`
          + `<span class="lock-pair">${p.pair}</span>`
          + `<span class="lock-side ${p.side === "UP" ? "up" : "down"}">${p.side}</span>`
          + `<span class="lock-time">${when}</span>`
          + `<span class="lock-status">${p.status === "OPEN" ? "OPEN" : "SETTLED"} · ${grade}</span>`
          + `</li>`;
      }).join("");
    }
  }

  function finishOnlyStats() {
    const btc = ((typeof tableState === "function" ? tableState("bitcoin") : null) || {}).accuracy || {};
    const eth = ((typeof tableState === "function" ? tableState("ethereum") : null) || {}).accuracy || {};
    const root = (state && state.accuracy) || {};
    let correct = 0, wrong = 0, total = 0;
    if ((btc.total || 0) + (eth.total || 0) > 0) {
      correct = (btc.correct || 0) + (eth.correct || 0);
      wrong = (btc.wrong || 0) + (eth.wrong || 0);
      total = (btc.total || 0) + (eth.total || 0);
    } else {
      correct = root.correct || 0;
      total = root.total || 0;
      wrong = root.wrong != null ? root.wrong : Math.max(0, total - correct);
    }
    if (!total) return { correct: 0, wrong: 0, total: 0, pct: null };
    if (!wrong && total) wrong = Math.max(0, total - correct);
    return { correct, wrong, total, pct: (correct / total) * 100 };
  }

  function drawChartAccuracy() {
    const canvas = document.getElementById("chartAccuracy");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    const stats = finishOnlyStats();
    const meta = document.getElementById("chartAccMeta");
    if (stats.total === 0) {
      ctx.fillStyle = "rgba(120,140,160,0.7)";
      ctx.font = "11px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("0/0 finish-only", canvas.width / 2, canvas.height / 2);
      if (meta) meta.textContent = "0/0 finish-only";
      return;
    }
    const spark = series.accuracy.filter(p => p && p.n > 0 && Number.isFinite(p.pct));
    if (spark.length) {
      drawLineSeries(ctx, spark, p => p.pct, "#39ff14", { zero: 50, yMin: 0, yMax: 100 });
    } else {
      drawLineSeries(ctx, [{ t: 0, pct: stats.pct }], p => p.pct, "#39ff14", { zero: 50, yMin: 0, yMax: 100 });
    }
    if (meta) {
      meta.textContent = `${stats.correct}/${stats.total} finish-only`;
    }
  }

  function drawChartWeights() {
    const canvas = document.getElementById("chartWeights");
    if (!canvas) return;
    const weights = (state && (state.weights || (state.learning && state.learning.weights))) || {};
    const ranked = AGENT_ORDER
      .filter(k => k !== "law")
      .map(k => ({ k, w: Number(weights[k]) || 0, label: AGENT_LABELS[k] || k }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
      .slice(0, 10);
    const ctx = fitCanvas(canvas, { rows: ranked.length });
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    if (!ranked.some(e => e.w !== 0)) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO WEIGHTS", w / 2, h / 2);
      return;
    }
    const maxW = Math.max(...ranked.map(e => Math.abs(e.w)), 0.01);
    const pad = { l: 56, r: 8, t: 6, b: 6 };
    const rowH = Math.max(14, (h - pad.t - pad.b) / ranked.length);
    ranked.forEach((e, i) => {
      const y = pad.t + i * rowH;
      const bw = (Math.abs(e.w) / maxW) * (w - pad.l - pad.r);
      ctx.fillStyle = e.w >= 0 ? "rgba(0,232,255,0.55)" : "rgba(255,45,85,0.55)";
      ctx.fillRect(pad.l, y + 2, Math.max(2, bw), Math.max(8, rowH - 4));
      ctx.fillStyle = "#c0e8ff";
      ctx.font = "8px Orbitron";
      ctx.textAlign = "right";
      ctx.fillText(e.label, pad.l - 4, y + rowH * 0.7);
      ctx.textAlign = "left";
      ctx.fillStyle = bw > 40 ? "rgba(6,8,12,0.92)" : "rgba(200,220,240,0.75)";
      ctx.fillText(e.w.toFixed(3), bw > 40 ? pad.l + 4 : pad.l + bw + 4, y + rowH * 0.7);
    });
  }

  function drawCharts() {
    if (mode !== "charts") return;
    if (deskCinematicOn()) return;
    syncChartPairTitle();
    drawChartBtc();
    drawChartEth();
    drawChartVolume();
    drawChartOdds();
    drawChartDelta();
    drawChartFunding();
    drawChartTape();
    drawChartAccuracy();
    drawChartWeights();
  }


  const BOT_GUIDE = {
    candle: { blurb: "Candle body strength, local highs/lows, short-term path. Pattern-first for hourly direction.", subs: "BODY · STRUCT · PIN · ENGULF · MARU · DOJI · STAR" },
    volume: { blurb: "Relative volume spikes and dry-ups vs price. Confirms moves when volume agrees.", subs: "SPIKE · DRYUP" },
    momentum: { blurb: "RSI + MACD-style short momentum. Continuation and soft mean-revert when stretched.", subs: "RSI · MACD" },
    orderflow: { blurb: "Taker pressure and book imbalance proxies + Kalshi mid lean.", subs: "BOOK · TAKER" },
    funding: { blurb: "Perp funding as crowding. High funding into weakness → short lean.", subs: "RATE · CROWD" },
    regime: { blurb: "Session clock + vol band. Scales Chair aggressiveness.", subs: "SESS · VOL" },
    volatility: { blurb: "Realized ATR / impulse. High-vol impulses ride; extreme stretch can soft-fade.", subs: "ATR · IMP" },
    oi_pressure: { blurb: "OI + funding path as liquidation / crowding pressure.", subs: "CROWD · PATH" },
    streak: { blurb: "Consecutive green/red candles and path microstructure.", subs: "RUN · FADE" },
    odds: { blurb: "Kalshi mid, skew, and odds velocity (how fast UP% moves).", subs: "MID · SKEW" },
    strike: { blurb: "BTC vs Kalshi strike + time left. Late window distance is the contract's real underlying.", subs: "DIST · CLOCK" },
    session_tod: { blurb: "UTC session (Asia/Europe/US) priors, weekend dampening, early vs late window.", subs: "SESS · WINDOW" },
    whale: { blurb: "Whale-tape proxy: volume spikes, range expansion, taker aggression.", subs: "SPIKE · TAKER" },
    quorum: { blurb: "Counts how many seats lean each way and learns which headcount + combinations are usually right. Competes for rank.", subs: "SIZE · COMBO · FLOOR" },
    panic: { blurb: "Research edge #1: when Kalshi mid rips ≥4pts in ~30–60s, fade the panic (mean-revert). Dominated public hourly backtests.", subs: "30S · 60S · THR" },
    cheap: { blurb: "Value seat: lean the soft side when YES or NO is ≤42¢ — recovery toward fair, not chase expensive continuation.", subs: "YES · NO · BAND" },
    spotlag: { blurb: "Binance spot velocity in bps. Kalshi often lags CEX by seconds — follow hard spot bursts in the lag window.", subs: "30S · 60S · 3M" },
    exhaust: { blurb: "After a large 1h BTC run near high/low, if 5m flips against and Kalshi is still extreme, fade continuation.", subs: "1H · 5M · YES" },
    guardian: { blurb: "Feed health only. Does not vote direction — raises caution when data is bad.", subs: "NODE-B · NODE-K" },
    news: { blurb: "Fear & Greed sentiment desk. Extreme greed soft-fades; extreme fear soft-recovers. Usually WAIT in the middle.", subs: "FNG" },
    liq: { blurb: "Liquidation-cluster proxy: volume spikes + OI pressure + short price impulse. Cascade detector.", subs: "VOL · OI" },
    law: { blurb: "Enforcer. After repeated wrong calls can lock the table into LET'S FIND OUT mode.", subs: "—" },
  };

  function renderBotsGuide() {
    const grid = document.getElementById("botsGrid");
    if (!grid) return;
    const hier = (state && state.hierarchy) || (state && state.learning && state.learning.hierarchy) || [];
    const rankMap = {};
    hier.forEach(r => { rankMap[r.agent] = r; });
    const agents = (state && state.agents) || [];
    const byName = {};
    agents.forEach(a => { byName[a.agent_name] = a; });
    grid.innerHTML = Object.keys(BOT_GUIDE).map(key => {
      const g = BOT_GUIDE[key];
      const r = rankMap[key] || {};
      const ag = byName[key] || {};
      const rank = r.rank != null ? "#" + r.rank : "—";
      const top = r.rank && r.rank <= 3;
      const name = (typeof AGENT_LABELS !== "undefined" && AGENT_LABELS[key]) || key.toUpperCase();
      const title = (typeof AGENT_TITLES !== "undefined" && AGENT_TITLES[key]) || "";
      const hits = r.correct != null ? r.correct : 0;
      const miss = r.wrong != null ? r.wrong : 0;
      const wr = r.win_rate != null ? Math.round(r.win_rate * 100) + "%" : "—";
      const listen = r.listen != null ? Math.round(r.listen * 100) + "%" : "—";
      const dir = ag.direction || "—";
      return '<article class="bot-card ' + (top ? "rank-top" : "") + '">' +
        '<div class="bot-card-head"><span class="bot-callsign">' + name + '</span><span class="bot-rank-pill">' + rank + '</span></div>' +
        '<div class="bot-title">' + title + '</div>' +
        '<div class="bot-blurb">' + g.blurb + '</div>' +
        '<div class="bot-subs">' + g.subs + '</div>' +
        '<div class="bot-stats"><span>Hits <b>' + hits + '</b></span><span>Miss <b>' + miss + '</b></span><span>WR <b>' + wr + '</b></span><span>Listen <b>' + listen + '</b></span><span class="hier-dir ' + dir + '">' + dir + '</span></div>' +
        '</article>';
    }).join("");
  }


  async function loadAutoPaper() {
    try {
      const asset = focusTable === "ethereum" ? "eth" : "btc";
      const r = await fetch("/api/paper/auto?asset=" + asset, { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      const el = document.getElementById("paperAutoSummary");
      if (el) {
        el.textContent = (asset.toUpperCase()) + " auto · " + (data.wins||0) + "W/" + (data.losses||0) + "L · PnL " + (data.pnl||0);
      }
      const list = document.getElementById("paperAutoList");
      if (list && Array.isArray(data.recent)) {
        list.innerHTML = data.recent.slice(0, 12).map(row => {
          const ok = row.correct ? "RIGHT" : "WRONG";
          const col = row.correct ? "#39ff14" : "#ff2d55";
          return '<div class="paper-auto-row" style="color:'+col+'">' + ok + " · " + (row.direction||"") + " · " + (row.ticker||"") + " · " + (row.pnl!=null?row.pnl:"") + "</div>";
        }).join("") || "<div class=\"paper-auto-row\">No finish-graded trades yet</div>";
      }
    } catch (e) {}
  }

  function renderRanksBoard() {
    const table = document.getElementById("ranksTable");
    const phaseEl = document.getElementById("ranksPhase");
    const notesEl = document.getElementById("learnNotes");
    if (!table) return;
    // Strict asset split — ranks for focused table only
    const src = (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    const hier = (src.hierarchy) || (src.learning && src.learning.hierarchy) || [];
    const agents = (src.agents) || [];
    const byName = {};
    agents.forEach(a => { byName[a.agent_name] = a; });
    if (phaseEl) {
      phaseEl.textContent = (focusTable === "ethereum" ? "ETH · Vitalik ranks (finish-only)" : "BTC · Satoshi ranks (finish-only)");
    }
    const acc = (src.accuracy) || (state && state.accuracy) || {};
    const n = acc.total || 0;
    const thr = state && state.decision && state.decision.threshold_used;
    const edge = state && state.decision && state.decision.edge_score;
    const phase = n < 15
      ? ("COLD START · " + n + " settled — Chair is loose so the council can learn. Threshold " + (thr != null ? Number(thr).toFixed(2) : "—") + ".")
      : ("LEARNED · " + n + " settled · hit " + (acc.accuracy_pct != null ? acc.accuracy_pct + "%" : "—") + " · edge score " + (edge != null ? edge : "—") + " · thr " + (thr != null ? Number(thr).toFixed(2) : "—") + ".");
    if (phaseEl) phaseEl.textContent = phase;
    const head = '<div class="rank-row head" role="row"><span>#</span><span>BOT</span><span>LIVE</span><span>HIT</span><span>MISS</span><span>WR%</span><span class="listen-col">LISTEN</span><span class="hide-sm">WT</span></div>';
    const rows = hier.filter(r => r.agent !== "law");
    const body = rows.map(r => {
      const ag = byName[r.agent] || {};
      const dir = ag.direction || "WAIT";
      const conf = ag.confidence != null ? ag.confidence : "—";
      const name = r.display_name || (AGENT_LABELS && AGENT_LABELS[r.agent]) || r.agent;
      const wr = r.win_rate != null ? Math.round(r.win_rate * 100) + "%" : "—";
      const listen = r.listen != null ? Math.round(r.listen * 100) + "%" : "—";
      const muted = (r.listen || 1) < 0.4;
      const faded = !!(r.faded || r.invert);
      const fadeNote = faded ? " <span class=\"fade-tag\">FADE " + Math.round((r.fade_strength || 0) * 100) + "%</span>" : "";
      const top = (r.rank || 99) <= 3;
      return '<div class="rank-row ' + (top ? "top " : "") + (muted ? "muted-rank" : "") + '" role="row">' +
        '<span class="rk">#' + r.rank + '</span><span class="nm">' + name + '</span>' +
        '<span class="dir-live ' + dir + '">' + dir + " " + conf + (conf !== "—" ? "%" : "") + '</span>' +
        '<span>' + (r.correct || 0) + '</span><span>' + (r.wrong || 0) + '</span><span>' + wr + fadeNote + '</span><span class="listen-col">' + listen + '</span>' +
        '<span class="hide-sm">' + (r.weight != null ? Number(r.weight).toFixed(3) : "—") + '</span></div>';
    }).join("") || '<div class="rank-empty">No rank data yet.</div>';
    table.innerHTML = head + body;
    if (notesEl) {
      const notes = (state && state.learning && state.learning.notes) || [];
      const shadow = acc.shadow && acc.shadow.label ? acc.shadow.label : null;
      let html = notes.length ? notes.map(n => "<li>" + n + "</li>").join("") : "<li>No learning notes yet.</li>";
      if (shadow) html = "<li>Shadow book: " + shadow + "</li>" + html;
      notesEl.innerHTML = html;
    }
  }


  // Live Central Time clock (America/Chicago)
  function tickClock() {
    const el = document.getElementById("liveClock");
    if (!el) return;
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      el.textContent = fmt.format(new Date()) + " CT";
    } catch (e) {
      el.textContent = new Date().toLocaleTimeString() + " CT";
    }
  }
  setInterval(tickClock, 1000);
  tickClock();

  function updateHuddle(h) {
    const badge = document.getElementById("huddleBadge");
    const status = document.getElementById("huddleStatus");
    const banner = document.getElementById("huddleBanner");
    if (!h) {
      // Keep the last chip text — a missing payload must not blank HUDDLE
      return;
    }
    if (badge) badge.classList.toggle("active", !!h.in_huddle);
    if (status) {
      if (h.in_huddle) {
        status.textContent = "IN SESSION";
      } else if (h.next_huddle_hint) {
        status.textContent = String(h.next_huddle_hint).replace("Next huddle in ", "");
        status.title = h.next_huddle_hint;
      }
      // else keep last chip — empty huddle on cold start must not wipe to —
    }
    if (banner) {
      if (h.in_huddle) {
        const act = (h.activity || []).slice(-3).join(" · ");
        const last = h.last_report;
        let body = "<b>COUNCIL HUDDLE</b> · 3–4 AM CT cool-down · reviewing day, consolidating learning, fewer noise calls.";
        if (act) body += "<br/>" + act;
        if (last && last.went_well && last.went_well.length) {
          body += "<br/>Well: " + last.went_well[0];
        }
        banner.innerHTML = body;
        banner.classList.add("show");
      } else {
        banner.classList.remove("show");
      }
    }
  }


  function updateColorTally(state) {
    const cc = (state && state.color_counts) || {};
    let up = cc.UP, down = cc.DOWN, wait = cc.WAIT, hold = cc.HOLD || 0, swap = cc.SWAP || 0;
    if (up == null && state && state.agents) {
      up = down = wait = hold = swap = 0;
      state.agents.forEach(a => {
        const d = a.direction || "WAIT";
        if (d === "UP") up++;
        else if (d === "DOWN") down++;
        else if (d === "UP_HOLD" || d === "DOWN_HOLD") hold++;
        else if (d === "SWAP") swap++;
        else wait++;
      });
    }
    up = up || 0; down = down || 0; wait = wait || 0; hold = hold || 0; swap = swap || 0;
    const total = Math.max(1, up + down + wait + hold + swap);

    const elU = document.getElementById("ctUp");
    const elD = document.getElementById("ctDown");
    const elW = document.getElementById("ctWait");
    const elQ = document.getElementById("ctQuorum");
    if (elU) elU.textContent = String(up);
    if (elD) elD.textContent = String(down);
    if (elW) elW.textContent = String(wait);
    if (elQ) {
      const q = (state && state.quorum) || (state && state.learning && state.learning.quorum) || {};
      const best = q.best_size;
      const wr = q.best_size_wr;
      const avg = q.avg_winning_size;
      if (best != null) {
        elQ.textContent = "Q best " + best + (wr != null ? " (" + Math.round(wr * 100) + "%)" : "") +
          (avg != null ? " · avg " + avg : "");
      } else {
        elQ.textContent = "Q learning…";
      }
    }

    // Left-panel BOT CHOICE COUNT (legacy hooks if present)
    const setB = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = String(n); };
    setB("bccUp", up); setB("bccDown", down); setB("bccWait", wait); setB("bccHold", hold); setB("bccSwap", swap);
    const setBar = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.style.width = Math.round((n / total) * 100) + "%";
    };
    setBar("bccUpBar", up); setBar("bccDownBar", down); setBar("bccWaitBar", wait); setBar("bccHoldBar", hold);
    const swapRow = document.getElementById("bccSwapRow");
    if (swapRow) swapRow.classList.toggle("hidden", !swap);
    const meta = document.getElementById("botChoiceMeta");
    if (meta) meta.textContent = up + "↑ · " + down + "↓ · " + wait + " wait";

    // Floating 7-segment FLOOR LED
    const pad2 = (n) => String(Math.max(0, n | 0)).padStart(2, "0");
    setB("ledUp", pad2(up));
    setB("ledDown", pad2(down));
    setB("ledWait", pad2(wait));
    setB("ledHold", pad2(hold));
    const ledQ = document.getElementById("ledQuorum");
    if (ledQ) {
      const q = (state && state.quorum) || (state && state.learning && state.learning.quorum) || {};
      if (q.best_size != null) {
        ledQ.textContent = "Q " + q.best_size + (q.best_size_wr != null ? " · " + Math.round(q.best_size_wr * 100) + "%" : "");
      } else {
        ledQ.textContent = "Q learning";
      }
    }
  }


  let paperData = null;
  let paperCalMode = "daily";

  let paperSide = "UP";

  async function fetchPaper() {
    try {
      const r = await fetch("/api/paper", { cache: "no-store" });
      if (r.ok) paperData = await r.json();
    } catch (e) {}
    return paperData;
  }

  function paperPnlPreview() {
    const stake = Number(document.getElementById("peStake")?.value || 0);
    const retEl = document.getElementById("peReturned");
    const retRaw = retEl ? String(retEl.value).trim() : "";
    const el = document.getElementById("pePnl");
    if (!el) return;
    // No fill yet — do not pre-fill a fake −$25 from stake minus empty got-back.
    if (retRaw === "") {
      el.textContent = "—";
      el.className = "";
      return;
    }
    const ret = Number(retRaw);
    if (!Number.isFinite(ret)) {
      el.textContent = "—";
      el.className = "";
      return;
    }
    const pnl = ret - (Number.isFinite(stake) ? stake : 0);
    el.textContent = (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2);
    el.className = pnl > 0 ? "pos" : (pnl < 0 ? "neg" : "");
  }

  function renderPaper() {
    const sumEl = document.getElementById("paperSummary");
    const calEl = document.getElementById("paperCalendar");
    const callsEl = document.getElementById("paperCalls");
    const meta = document.getElementById("paperCallMeta");
    const d = paperData;
    if (!sumEl) return;
    if (!d) {
      sumEl.innerHTML = "<div class='paper-card'><div class='pc-label'>LOADING</div></div>";
      return;
    }
    const s = d.summary || {};
    const card = (lab, val, sub) =>
      "<div class='paper-card'><div class='pc-label'>" + lab + "</div>" +
      "<div class='pc-val'>" + val + "</div>" +
      (sub ? "<div class='pc-sub'>" + sub + "</div>" : "") + "</div>";
    const tradesN = Number(s.trades || 0);
    const pnlStr = tradesN
      ? ((Number(s.pnl || 0) >= 0 ? "+" : "") + "$" + Number(s.pnl || 0).toFixed(2))
      : "—";
    sumEl.innerHTML =
      card("TRADES", tradesN, (s.wins || 0) + "W / " + (s.losses || 0) + "L") +
      card("STAKED", tradesN ? ("$" + Number(s.stake || 0).toFixed(2)) : "—", "total risked") +
      card("RETURNED", tradesN ? ("$" + Number(s.returned || 0).toFixed(2)) : "—", "cashed out") +
      card("P&L", pnlStr, "net");

    const cal = (d.calendar && d.calendar[paperCalMode]) || [];
    if (calEl) {
      calEl.innerHTML = cal.length
        ? cal.map(row => {
            const pnl = Number(row.pnl || 0);
            return "<div class='paper-day'><div class='pd-key'>" + row.key + "</div>" +
              "<div class='pd-n'>" + row.n + " trades</div>" +
              "<div class='pd-pnl " + (pnl > 0 ? "pos" : pnl < 0 ? "neg" : "") + "'>" +
              (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2) + "</div></div>";
          }).join("")
        : "<div class='paper-day'>No trades in this view yet.</div>";
    }

    const trades = d.trades || [];
    if (meta) meta.textContent = trades.length + " shown";
    if (callsEl) {
      const head = "<div class='paper-call-row head'><span>WHEN</span><span>SIDE</span><span>STAKE</span><span>BACK</span><span>P&L</span><span></span></div>";
      const body = trades.map(tr => {
        const pnl = Number(tr.pnl || 0);
        return "<div class='paper-call-row'>" +
          "<span>" + (tr.when_ct || "—") + "</span>" +
          "<span class='" + (tr.side === "UP" ? "pos" : "neg") + "'>" + tr.side + "</span>" +
          "<span>$" + Number(tr.stake || 0).toFixed(2) + "</span>" +
          "<span>$" + Number(tr.returned || 0).toFixed(2) + "</span>" +
          "<span class='" + (pnl > 0 ? "pos" : pnl < 0 ? "neg" : "") + "'>" +
          (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2) + "</span>" +
          "<button type='button' class='del-trade' data-id='" + tr.id + "' title='Delete'>✕</button>" +
          "</div>";
      }).join("") || "<div class='paper-call-row'>No manual trades yet — add one above.</div>";
      callsEl.innerHTML = head + body;
      callsEl.querySelectorAll(".del-trade").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          if (!id || !confirm("Delete this trade?")) return;
          await fetch("/api/paper/" + id, { method: "DELETE" });
          await fetchPaper();
          renderPaper();
        });
      });
    }
  }

  function wirePaperEntry() {
    const up = document.getElementById("peSideUp");
    const down = document.getElementById("peSideDown");
    const stake = document.getElementById("peStake");
    const ret = document.getElementById("peReturned");
    const submit = document.getElementById("peSubmit");
    if (!submit) return;
    function setSide(side) {
      paperSide = side;
      if (up) up.classList.toggle("active", side === "UP");
      if (down) down.classList.toggle("active", side === "DOWN");
    }
    if (up) up.addEventListener("click", () => setSide("UP"));
    if (down) down.addEventListener("click", () => setSide("DOWN"));
    if (stake) stake.addEventListener("input", paperPnlPreview);
    if (ret) {
      ret.setAttribute("autocomplete", "off");
      if (!ret.dataset.user) ret.value = "";
      ret.addEventListener("input", () => { ret.dataset.user = "1"; paperPnlPreview(); });
    }
    paperPnlPreview();
    submit.addEventListener("click", async () => {
      const body = {
        side: paperSide,
        stake: Number(stake?.value || 0),
        returned: Number(ret?.value || 0),
        note: document.getElementById("peNote")?.value || "",
      };
      submit.disabled = true;
      try {
        const r = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (data.ok) {
          paperData = data.journal || paperData;
          if (ret) ret.value = "";
          paperPnlPreview();
          renderPaper();
        } else {
          alert(data.error || "Could not save trade");
        }
      } catch (e) {
        alert("Save failed: " + e);
      }
      submit.disabled = false;
    });
  }


  function setMode(next) {
    if (!hasDeskAuth()) {
      document.body.classList.add("gate-locked");
      document.body.classList.remove("admin-unlocked");
      const pg = document.getElementById("passwordGate");
      if (pg) pg.classList.remove("hidden");
      return;
    }
    // Settings requires admin unlock on this page load. Do not inherit a leftover session.
    if (next === "settings") {
      const unlocked = (typeof isAdminUnlocked === "function") ? isAdminUnlocked() : false;
      if (!unlocked) {
        window.__openSettingsAfterAdmin = true;
        if (typeof requestAdminUnlock === "function") {
          requestAdminUnlock(() => {
            window.__openSettingsAfterAdmin = false;
            window.__adminUnlockedThisPage = true;
            try { mountAdminDesk(); } catch (e) {}
            setMode("settings");
          });
        }
        return;
      }
    }
    if (next === "follower" && !document.body.classList.contains("follower-unlocked")) {
      return;
    }
    try {
      if (typeof isSeatStormPlaying === "function" && isSeatStormPlaying()) {
        stopSeatStorm("desk");
      }
    } catch (e) {}
    const prevMode = mode;
    mode = next;
    // Exactly one mode-* class and one .active pill — leftover ranks+charts lit two tabs
    syncExclusiveBodyMode(mode);
    syncExclusiveTabActive(mode);
    try { syncFloorExitBtn(); } catch (e) {}
    try {
      if (typeof window.__floorMusicOnMode === "function") {
        window.__floorMusicOnMode(mode === "floor");
      }
    } catch (e) {}
    // Hierarchy only on ranks / dashboard
    document.body.classList.toggle("show-hierarchy", mode === "ranks" || mode === "dashboard");
    const botsView = document.getElementById("botsView");
    const ranksView = document.getElementById("ranksView");
    const paperView = document.getElementById("paperView");
    const settingsView = document.getElementById("settingsView");
    const followerView = document.getElementById("followerView");
    const showCharts = mode === "charts";
    const showBots = mode === "bots";
    const showRanks = mode === "ranks";
    const showPaper = mode === "paper";
    const showSettings = mode === "settings";
    const showFollower = mode === "follower";
    const showMain = mode === "art" || mode === "dashboard" || mode === "floor";
    if (chartsView) chartsView.classList.toggle("hidden", !showCharts);
    if (botsView) botsView.classList.toggle("hidden", !showBots);
    if (ranksView) ranksView.classList.toggle("hidden", !showRanks);
    if (paperView) paperView.classList.toggle("hidden", !showPaper);
    if (settingsView) settingsView.classList.toggle("hidden", !showSettings);
    if (followerView) followerView.classList.toggle("hidden", !showFollower);
    if (mainTable) mainTable.classList.toggle("hidden", !showMain);
    if (overlay) overlay.classList.toggle("hidden", mode !== "dashboard");
    try { dockWindowLed(); } catch (e) {}
    // Always redraw the round table when main view is visible (bots live on canvas)
    if (showMain) {
      try {
        requestAnimationFrame(() => {
          try { resizeRoundtable(); drawArt(); } catch (e) {}
        });
      } catch (e) {
        try { resizeRoundtable(); drawArt(); } catch (e2) {}
      }
    }
    if (mode === "dashboard") renderDashboard();
    if (mode === "bots") renderBotsGuide();
    if (mode === "ranks") renderRanksBoard();
    if (mode === "paper") {
      fetchPaper().then(() => renderPaper());
    }
    if (mode === "follower" && typeof window.renderFollower === "function") {
      try { window.renderFollower(); } catch (e) {}
    }
    if (mode === "settings" && prevMode !== "settings") {
      fetchSettings().then((s) => { if (s) applySettingsSnapshot(s, { localToggles: true }); });
    }
    try { syncAutoBetVisibility(); } catch (e) {}
    if (mode === "charts") {
      try { syncChartPairTitle(); } catch (e) {}
      // Layout after the view is visible, then draw (avoids 0×0 canvases)
      requestAnimationFrame(() => {
        try { if (chartsView) void chartsView.offsetWidth; } catch (e) {}
        requestAnimationFrame(() => { if (!deskCinematicOn()) drawCharts(); });
      });
    }
  }

  function updateUI() {
    if (!state) return;
    // Prefer focused table when dual API is present (read-only view — keep tables intact)
    const __savedTables = state.tables;
    const __savedBtc = state.btc;
    const __savedEth = state.eth;
    const __savedDual = state.dual;
    if (typeof getViewState === "function") {
      const view = getViewState();
      if (view) {
        state = view;
        // restore dual roots so next focus switch still works
        if (__savedTables) state.tables = __savedTables;
        if (__savedBtc) state.btc = __savedBtc;
        if (__savedEth) state.eth = __savedEth;
        if (__savedDual != null) state.dual = __savedDual;
      }
    }
    if (mode !== "settings") {
      if (state.system_settings) applySettingsSnapshot(state.system_settings);
      else if (typeof state.beast_mode === "boolean") applyBeastChrome(state.beast_mode);
    }
    const d = state.decision || {};
    const prevDir = decisionDir.textContent;
    // Prefer locked_call so the strip matches the plaque / portrait after the single call
    const lc = state.locked_call || d.locked_call || null;
    const hasLock = !!(lc && lc.locked && lc.direction && (lc.direction === "UP" || lc.direction === "DOWN"));
    const rawDir = hasLock ? lc.direction : (d.direction || "WAIT");
    decisionDir.textContent = lawLocked() ? "LOCKED" : (hasLock ? ("LOCKED " + lc.direction) : (d.display_direction || displayDir(rawDir)));
    decisionDir.className = "dir " + rawDir;
    // Status strip: phase + lock badge
    try {
      const sum = String(d.summary || "");
      let phase = "hold";
      if (/\bENTRY\b/i.test(sum) || (hasLock && lc.phase === "entry")) phase = "entry";
      else if (/\bFINAL\b/i.test(sum) || (hasLock && lc.phase === "final")) phase = "final";
      else if (/\bMID\b/i.test(sum) || (hasLock && lc.phase === "mid")) phase = "mid";
      else if (/Lock held/i.test(sum) || hasLock) phase = "hold";
      if (decisionPhase) {
        decisionPhase.textContent = phase === "hold" ? "HELD" : phase.toUpperCase();
        decisionPhase.className = "decision-phase phase-" + phase;
      }
      if (decisionLock) {
        decisionLock.textContent = hasLock ? "🔒 LOCKED" : (phase === "entry" ? "NEW ENTRY" : "");
        decisionLock.className = "decision-lock" + (hasLock ? " is-locked" : "");
      }
    } catch (e) { /* non-fatal */ }

    // Prefer locked confidence so strip matches plaque/portrait
    decisionConf.textContent = (hasLock && lc && lc.confidence != null)
      ? (lc.confidence + "%")
      : (d.confidence != null ? d.confidence + "%" : "—");
    decisionSummary.textContent = d.summary || "";
    if (d.regime_key) {
      decisionSummary.textContent = (decisionSummary.textContent || "") +
        (decisionSummary.textContent ? " · " : "") + "regime " + d.regime_key;
    }
    btcPrice.textContent = state.market?.price ? Number(state.market.price).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—";
    fundingEl.textContent = state.market?.funding != null ? (state.market.funding * 100).toFixed(4) + "%" : "—";
    kalshiTicker.textContent = state.market?.kalshi_ticker || "—";
    const upEl = document.getElementById("liveUpPct");
    const dnEl = document.getElementById("liveDownPct");
    const timEl = document.getElementById("windowTimer");
    const m = state.market || {};
    const book = liveBookOdds(m);
    if (upEl) upEl.textContent = book ? book.up.toFixed(1) + "%" : "—";
    if (dnEl) dnEl.textContent = book ? book.down.toFixed(1) + "%" : "—";
    if (timEl || document.getElementById("ledWindowTime")) {
      let secs = m.seconds_left != null ? m.seconds_left : m.time_remaining;
      if (secs == null && m.close_time) {
        secs = Math.max(0, Math.floor((new Date(m.close_time) - Date.now()) / 1000));
      }
      let display = "--:--";
      if (secs != null && !isNaN(secs)) {
        const s = Math.max(0, Math.floor(Number(secs)));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        display = mm + ":" + ss;
      } else {
        const now = Date.now();
        const bucket = 60 * 60 * 1000; // hourly window fallback
        const left = bucket - (now % bucket);
        const s = Math.floor(left / 1000);
        display = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
      }
      if (timEl) timEl.textContent = display;
      const ledT = document.getElementById("ledWindowTime");
      if (ledT) ledT.textContent = display;
      const ledSub = document.getElementById("ledWindowSub");
      if (ledSub) {
        const sNum = secs != null && !isNaN(secs) ? Math.max(0, Math.floor(Number(secs))) : null;
        if (sNum != null && sNum <= 60) ledSub.textContent = "FINAL MINUTE";
        else if (sNum != null && sNum <= 180) ledSub.textContent = "LATE WINDOW";
        else ledSub.textContent = "until close";
      }
      const dualSub = document.getElementById("dualWindowSub");
      if (dualSub && typeof tableState === "function") {
        function fmtLeft(st) {
          if (!st || !st.market) return "—";
          const m = st.market;
          let s = m.seconds_left != null ? m.seconds_left : m.time_remaining;
          if (s == null && m.close_time) {
            s = Math.max(0, Math.floor((new Date(m.close_time) - Date.now()) / 1000));
          }
          if (s == null || isNaN(s)) return "—";
          s = Math.max(0, Math.floor(Number(s)));
          return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
        }
        dualSub.textContent = "BTC " + fmtLeft(tableState("bitcoin")) + " · ETH " + fmtLeft(tableState("ethereum"));
      }

    }

    lastUpdateEl.textContent = state.timestamp ? new Date(state.timestamp).toLocaleTimeString() : "—";
    updateAccuracy(state.accuracy);
    try { paintTableHud(); } catch (e) {}
    updateLaw(state.law);
    if (!deskCinematicOn()) updateHuddle(state.huddle);
    try { syncChartPairTitle(); } catch (e) {}
    updateColorTally(state);
    updateDebate();
    try { updateRivalryStrip(); } catch (e) {}
    if (!deskCinematicOn()) drawCandleChart();
    renderHierarchy();
    recordSeriesFromState(state);
    if (mode === "settings") {
      const sv = document.getElementById("settingsView");
      if (sv) sv.classList.remove("hidden");
    }
    if (mode === "follower" && typeof window.renderFollower === "function") {
      try { window.renderFollower(); } catch (e) {}
    }
    if (mode === "charts" && !deskCinematicOn()) drawCharts();

    const healthy = state.health?.binance || state.health?.kalshi;
    statusDot.className = "dot " + (healthy ? "live" : "warn");

    try { syncSeatStorm(); } catch (e) {}
    try {
      if (typeof window.__afterDeskUpdate === "function") window.__afterDeskUpdate();
    } catch (e) {}

    // Market-open bell when a new hourly window/contract appears
    maybeRingForNewWindow(state);

    // Trigger brief glitch when decision changes
    if (prevDir && prevDir !== (d.direction || "WAIT")) {
      glitchUntil = performance.now() + 380;
      const nd = d.direction || "WAIT";
      if (nd !== lastSpokenDir) {
        lastSpokenDir = nd;
        playCallVoice(nd);
      }
    }
  }

  function wireBrain() {
    const file = document.getElementById("brainFile");
    const status = document.getElementById("brainStatus");
    if (!file || file.__wired) return;
    file.__wired = true;
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (!isAdminUnlocked()) {
        if (status) status.textContent = "Admin password required";
        file.value = "";
        requestAdminUnlock(() => { try { file.click(); } catch (e) {} });
        return;
      }
      if (status) status.textContent = "Importing " + f.name + "…";
      try {
        const text = await f.text();
        const brain = JSON.parse(text);
        const res = await adminFetch("/api/brain/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brain, mode: "merge" }),
        });
        const data = await res.json();
        if (data.ok || data.learning_restored) {
          const c = data.calls || {};
          if (status) status.textContent =
            "Restored · calls +" + (c.imported || 0) + " (skipped " + (c.skipped || 0) + ")";
        } else {
          if (status) status.textContent = "Import failed: " + (data.error || "unknown");
        }
      } catch (e) {
        if (status) status.textContent = "Import error: " + e;
      }
      file.value = "";
    });
  }

  function loop(ts) {
    time = ts;
    if (mode === "art" || mode === "floor") drawArt();
    if (!document.hidden) {
      animId = requestAnimationFrame(loop);
    } else {
      animId = setTimeout(() => { animId = requestAnimationFrame(loop); }, 500);
    }
  }

  async function poll() {
    try {
      const r = await fetch(`${API_BASE}/api/state`);
      if (!r.ok) throw new Error(r.status);
      state = await r.json();
      try { window.state = state; } catch (e) {}
      updateUI();
      try { maybePlayJailDoor(); } catch (e) {}
      try { if (typeof updateLightsaber === "function") updateLightsaber(state); } catch (e) {}
      try { if (typeof playOutcomeFx === "function") playOutcomeFx(state); } catch (e) {}
      if (mode === "dashboard") renderDashboard();
    } catch (e) {
      statusDot.className = "dot err";
      console.warn("Council poll failed", e);
    }
  }

  const openChartsBtn = document.getElementById("openChartsBtn");
  if (openChartsBtn) {
    openChartsBtn.addEventListener("click", () => setMode("charts"));
  }
  modeTabs.forEach(btn => {
    if (!btn.dataset.mode || btn.id === "focusBtc" || btn.id === "focusEth") return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setMode(btn.dataset.mode);
    }, true);
  });
  if (!document.__modeTabsDelegated) {
    document.__modeTabsDelegated = true;
    document.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest("#settingsView")) return;
      const btn = e.target && e.target.closest && e.target.closest(".mode-tab[data-mode]");
      if (!btn || btn.id === "focusBtc" || btn.id === "focusEth" || btn.id === "btnHelp") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setMode(btn.dataset.mode);
    }, true);
  }
  wirePaperEntry();
  document.querySelectorAll(".paper-cal-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      paperCalMode = btn.dataset.cal || "daily";
      document.querySelectorAll(".paper-cal-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderPaper();
    });
  });

  if (soundToggle) {
    soundToggle.addEventListener("click", () => {
      ensureAudio(); // unlock audio on gesture
      soundMuted = !soundMuted;
      localStorage.setItem("council_bell_muted", soundMuted ? "1" : "0");
      syncSoundButton();
      // Preview ding when unmuting so user knows it works
      if (!soundMuted) playMarketBell();
    });
  }

  // Unlock audio on first interaction anywhere (browser policy)
  const armAudioOnce = () => {
    ensureAudio();
    document.removeEventListener("pointerdown", armAudioOnce);
    document.removeEventListener("keydown", armAudioOnce);
  };
  document.addEventListener("pointerdown", armAudioOnce);
  document.addEventListener("keydown", armAudioOnce);

  // Clock-boundary watcher (covers gaps between API polls)
  setInterval(() => {
    if (!lastWindowKey) {
      maybeRingForNewWindow(state || {});
    } else {
      const bucket = clockBucket();
      if (lastClockBucket != null && bucket !== lastClockBucket) {
        lastClockBucket = bucket;
      }
    }
  }, 1000);

  function deskHotkeysBlocked(e) {
    const t = (e && e.target) || document.activeElement;
    const a = document.activeElement;
    const typing = (el) => {
      if (!el) return false;
      const tag = (el.tagName || "").toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
    };
    if (typing(t) || typing(a)) return true;
    if (t && t.closest && (t.closest("#adminGate") || t.closest("#fgGate") || t.closest("#settingsView") || t.closest("#passwordGate"))) return true;
    const admin = document.getElementById("adminGate");
    if (admin && !admin.classList.contains("hidden")) return true;
    const fol = document.getElementById("fgGate");
    if (fol && !fol.classList.contains("hidden")) return true;
    const pass = document.getElementById("passwordGate");
    if (pass && !pass.classList.contains("hidden")) return true;
    const sv = document.getElementById("settingsView");
    if (sv && !sv.classList.contains("hidden")) return true;
    if (mode === "settings") return true;
    return false;
  }

  document.addEventListener("keydown", (e) => {
    if (deskHotkeysBlocked(e)) return;
    if (e.key === "m" || e.key === "M") {
      // cycle Screensaver → Dashboard → Charts
      const order = (typeof window.__deskModeCycle === "function")
        ? window.__deskModeCycle()
        : ["art", "dashboard", "bots", "ranks", "paper", "charts", "settings"];
      const i = order.indexOf(mode);
      setMode(order[(i + 1) % order.length]);
    }
    if (e.key === "b" || e.key === "B") soundToggle && soundToggle.click();
    if (e.key === "Escape") {
      if (typeof isSeatStormPlaying === "function" && isSeatStormPlaying()) {
        e.preventDefault();
        stopSeatStorm("esc");
        return;
      }
      if (typeof window.__dismissLeaderClick === "function" && window.__dismissLeaderClick()) {
        e.preventDefault();
        return;
      }
      if (mode === "floor") setMode("art");
    }
    if (e.key === "0") setMode("floor");
    if (e.key === "1") setMode("art");
    if (e.key === "2") setMode("dashboard");
    if (e.key === "3") setMode("bots");
    if (e.key === "4") setMode("ranks");
    if (e.key === "5") setMode("paper");
    if (e.key === "6") setMode("charts");
    if (e.key === "7") setMode("settings");
    if (e.key === "x" || e.key === "X") setBeastMode(!beastMode);
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      const tag = (e.target && e.target.tagName) || "";
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        try { openTutorial(true); } catch (err) {}
      }
    }
  });

  window.addEventListener("resize", () => {
    if (deskCinematicOn()) return;
    resizeRoundtable();
    if (mode === "settings") {
      const sv = document.getElementById("settingsView");
      if (sv) sv.classList.remove("hidden");
    }
    if (mode === "charts") drawCharts();
  });


  // ——— Startup gate: Tutorial / Summon the Council ———
  // Plain-language bot cards for the tutorial (easy to skim)
  const TUT_BOTS_CORE = [
    { name: "WICK", role: "Candles", desc: "Looks at candle shapes — strong bodies, wicks, reverses." },
    { name: "PULSE", role: "Volume", desc: "Checks if volume is spiking or drying up with price." },
    { name: "DRIFT", role: "Momentum", desc: "Short-term push: is BTC still running or stretched?" },
    { name: "TAPE", role: "Order flow", desc: "Who is hitting the book — buyers or sellers?" },
    { name: "CARRY", role: "Funding", desc: "Perp funding = how crowded the long/short side is." },
    { name: "ORBIT", role: "Regime", desc: "Session + volatility — when Satoshi should be bold." },
    { name: "VOLT", role: "Volatility", desc: "How wild the range is right now." },
    { name: "CHAIN", role: "Open interest", desc: "OI pressure — squeeze / crowding risk." },
  ];
  const TUT_BOTS_EDGE = [
    { name: "STREAK", role: "Path", desc: "Runs of green/red candles and path texture." },
    { name: "ODDS", role: "Kalshi odds", desc: "Where YES/NO is priced and how fast it moves." },
    { name: "STRIKE", role: "Strike clock", desc: "BTC vs the contract strike + time left." },
    { name: "CLOCK", role: "Time of day", desc: "Asia / Europe / US hours and window phase." },
    { name: "WHALE", role: "Big flow", desc: "Large volume / aggression bursts." },
    { name: "QUORUM", role: "Crowd count", desc: "How many bots agree — and which combos win." },
    { name: "FADE", role: "Panic fade", desc: "When odds panic-move, bet the snap-back." },
    { name: "CHEAP", role: "Value", desc: "Buy the soft side when YES or NO is too cheap." },
    { name: "VEL", role: "Spot lag", desc: "Binance moves first; Kalshi often lags a few seconds." },
    { name: "EXHAUST", role: "Run fade", desc: "After a big 1h run, fade if the short trend flips." },
    { name: "WARDEN", role: "Health", desc: "Does not vote — warns when feeds are sick." },
    { name: "LAW", role: "Enforcer", desc: "Locks the table after repeated misses to re-check." },
  ];

  const TUTORIAL_SLIDES = [
    {
      mode: "art",
      target: "#tabScreensaver",
      title: "WHAT THIS IS",
      body: "A living Round Table of specialist bots watching Kalshi’s 15-minute Bitcoin market (KXBTC15M). The Chair (Satoshi) locks exactly one high-quality paper call per window — UP or DOWN — only when the chosen side offers best odds (under 80¢). Otherwise WAIT.\n\nThis is a research co-pilot. It does not place real orders.",
    },
    {
      mode: "art",
      target: "#tableStage",
      title: "GOAL CONTRACT",
      body: "1. One directional guess per 15-minute window on how the window ends.\n2. Taken only at the best available odds (chosen side < 80¢).\n3. Once locked → irreversible for that window.\n4. WAIT preferred over low-edge or noisy calls.",
    },
    {
      mode: "art",
      target: "#finalDecision",
      title: "THE PLAQUE",
      body: "The center plaque is the single source of truth when locked (LOCKED UP/DOWN @ XX¢ · FOLLOW THIS).\n\nFollower bots poll /api/state and read locked_call (or decision.locked_call). When locked_call is null, there is no active call — stay flat or WAIT.",
    },
    {
      mode: "art",
      target: "#accuracyBadge",
      title: "HIT RATE",
      body: "HIT RATE is Chair directional accuracy (WAIT excluded). Calls are graded on the Kalshi odds path, not only the final BTC print. Paper P&L is path-scaled. Only the single locked call per window is graded.",
    },
    {
      mode: "art",
      target: "#lawBadge",
      title: "LAW",
      body: "LAW is the enforcer badge after repeated misses. If LAW locks the table, wait — do not chase a new call.",
    },
    {
      mode: "art",
      target: "#modeTabs",
      title: "HOW A CALL IS MADE",
      body: "1. Specialists vote UP / DOWN / WAIT.\n2. Higher-ranked bots count more.\n3. Chair requires confluence + pair affinity.\n4. Odds gate: chosen side must be under 80¢.\n5. First firm full UP/DOWN that clears the gates becomes the single LOCKED call.\n6. After lock, the plaque is what followers and the UI follow.",
    },
    {
      mode: "floor",
      target: "#tabFloor",
      title: "FLOOR",
      body: "Floor is the immersive table. The outer ring is specialists still voting and ranking. ESC or TABLE returns to the desk.",
    },
    {
      mode: "dashboard",
      target: "#tabDashboard",
      title: "DASHBOARD",
      body: "Seat cards for the focused table. Use BTC / ETH to switch which Chair you are reading.",
    },
    {
      mode: "bots",
      target: "#tabBots",
      title: "BOTS",
      body: "Field guide for every specialist. Each seat has one job. Colors on the Floor show how they are voting live.",
    },
    {
      mode: "ranks",
      target: "#tabRanks",
      title: "RANKS",
      body: "Who the Chair trusts most. Higher-ranked bots count more when a call is made.",
    },
    {
      mode: "paper",
      target: "#tabPaper",
      title: "PAPER",
      body: "Practice scorecard. Paper-track expectancy before any size. Quality over quantity. One high-edge guess per window. This desk does not place real orders.",
    },
    {
      mode: "charts",
      target: "#tabCharts",
      title: "CHARTS",
      body: "Price and odds context for the window. Charts are research — they do not place a call.",
    },
    {
      mode: "art",
      target: "#tabSettings",
      title: "SETTINGS",
      body: "BEAST MODE, sounds, and knobs. Settings stays behind the admin lock.",
    },
    {
      mode: "art",
      target: "#btnHelp",
      title: "HELP",
      body: "Press ? anytime to replay this walkthrough. Keys: 1–7 tabs · Floor tab · X BEAST · ESC exit Floor · ? Help.",
    },
  ];

  const SUMMON_LINES = [
    "The fog gathers…",
    "Seats take their places…",
    "Odds drift in the dark…",
    "Satoshi opens his eyes…",
    "The Council is summoned.",
  ];

  function initFog() {
    const canvas = document.getElementById("gateFog") || document.getElementById("fogCanvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { alpha: true });
    let w = 0, h = 0, raf = 0, t0 = performance.now();
    let intensity = 1;

    // Video-matched purple fog: deep violet → magenta → pink-lilac
    // Sampled from cinematic: ~#2a0a3d base, #7b2d9e / #c44ec8 bloom
    const layers = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // Layer 0: ground-hugging dense fog (video floor mist)
    // Layer 1: mid volumetric billows
    // Layer 2: high thin haze + wisps
    function spawnBlob(layer) {
      const isGround = layer === 0;
      const isHigh = layer === 2;
      return {
        layer,
        x: Math.random(),
        y: isGround ? 0.55 + Math.random() * 0.5 : isHigh ? Math.random() * 0.55 : 0.25 + Math.random() * 0.55,
        r: isGround ? 0.22 + Math.random() * 0.38 : isHigh ? 0.18 + Math.random() * 0.3 : 0.2 + Math.random() * 0.35,
        vx: (Math.random() - 0.5) * (isGround ? 0.00018 : 0.00032),
        vy: isGround ? -0.00004 - Math.random() * 0.00008 : (Math.random() - 0.5) * 0.0002,
        a: isGround ? 0.14 + Math.random() * 0.12 : isHigh ? 0.05 + Math.random() * 0.06 : 0.08 + Math.random() * 0.1,
        // hue cluster around purple/magenta (280–320), slight blue-violet for depth
        hue: isHigh ? 270 + Math.random() * 25 : 285 + Math.random() * 30,
        sat: isGround ? 55 + Math.random() * 25 : 45 + Math.random() * 30,
        lit: isGround ? 28 + Math.random() * 18 : 35 + Math.random() * 22,
        phase: Math.random() * Math.PI * 2,
        breath: 0.6 + Math.random() * 0.8,
      };
    }

    for (let i = 0; i < 14; i++) layers.push(spawnBlob(0));
    for (let i = 0; i < 16; i++) layers.push(spawnBlob(1));
    for (let i = 0; i < 10; i++) layers.push(spawnBlob(2));

    function frame(now) {
      const elapsed = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);

      // Near-black stage with deep purple underglow (matches video void)
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      bg.addColorStop(0, "rgba(28, 8, 42, 0.95)");
      bg.addColorStop(0.45, "rgba(10, 4, 18, 0.98)");
      bg.addColorStop(1, "rgba(2, 1, 6, 1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Soft center magenta pool under where the Chair would sit
      const pool = ctx.createRadialGradient(w * 0.5, h * 0.52, 0, w * 0.5, h * 0.55, Math.min(w, h) * 0.42);
      pool.addColorStop(0, `rgba(160, 40, 180, ${0.12 * intensity})`);
      pool.addColorStop(0.5, `rgba(90, 20, 120, ${0.06 * intensity})`);
      pool.addColorStop(1, "transparent");
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);

      // Draw back-to-front: high haze → mid → ground (last = densest on seats)
      const order = [2, 1, 0];
      order.forEach((layerId) => {
        layers.filter((b) => b.layer === layerId).forEach((b) => {
          // slow billow + radial drift from center
          const cx = 0.5, cy = 0.48;
          const dx = b.x - cx, dy = b.y - cy;
          b.x += b.vx + Math.sin(elapsed * b.breath + b.phase) * 0.00012;
          b.y += b.vy + Math.cos(elapsed * b.breath * 0.7 + b.phase) * 0.00008;
          // gentle outward crawl
          b.x += dx * 0.000015;
          b.y += dy * 0.00001;
          if (b.x < -0.35) b.x = 1.25;
          if (b.x > 1.35) b.x = -0.25;
          if (b.y < -0.3) b.y = 1.2;
          if (b.y > 1.35) b.y = -0.15;

          const pulse = 0.85 + 0.15 * Math.sin(elapsed * b.breath + b.phase);
          const gx = b.x * w;
          const gy = b.y * h;
          const gr = b.r * Math.max(w, h) * pulse;
          const alpha = b.a * intensity * pulse;

          const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
          // Core: brighter magenta-pink like video bloom
          g.addColorStop(0, `hsla(${b.hue + 8}, ${Math.min(90, b.sat + 15)}%, ${Math.min(62, b.lit + 18)}%, ${alpha * 0.95})`);
          // Mid: deep purple body
          g.addColorStop(0.35, `hsla(${b.hue}, ${b.sat}%, ${b.lit}%, ${alpha * 0.55})`);
          // Edge: violet fade into dark
          g.addColorStop(0.7, `hsla(${b.hue - 12}, ${b.sat - 10}%, ${Math.max(12, b.lit - 10)}%, ${alpha * 0.18})`);
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        });
      });

      // Horizontal purple mist bands (video-style sheet fog)
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const yBase = h * (0.35 + i * 0.12);
        const y = yBase + Math.sin(elapsed * 0.35 + i * 1.3) * 18;
        const band = ctx.createLinearGradient(0, y - 40, 0, y + 50);
        const a = (0.04 + i * 0.012) * intensity;
        band.addColorStop(0, "transparent");
        band.addColorStop(0.4, `rgba(140, 50, 180, ${a})`);
        band.addColorStop(0.6, `rgba(90, 30, 130, ${a * 0.7})`);
        band.addColorStop(1, "transparent");
        ctx.fillStyle = band;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 24) {
          const yy = y + Math.sin(x * 0.008 + elapsed * 0.6 + i) * 14
            + Math.sin(x * 0.02 + elapsed * 1.1) * 6;
          ctx.lineTo(x, yy);
        }
        ctx.lineTo(w, y + 60);
        ctx.lineTo(0, y + 60);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Vignette — crush edges like the cinematic
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(0.65, "rgba(10, 2, 20, 0.25)");
      vig.addColorStop(1, "rgba(0, 0, 0, 0.82)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      setIntensity(v) { intensity = Math.max(0, v); },
      stop() { cancelAnimationFrame(raf); },
    };
  }


  function dismissGate(animated, land) {
    const gate = document.getElementById("summonGate");
    document.body.classList.remove("gate-locked", "gate-revealing", "tutorial-walk");
    markOnboarded();
    const dest = land || "art";
    function after() {
      try {
        if (mode !== "settings" && !window.__openSettingsAfterAdmin) setMode(dest);
      } catch (e) {}
      try { resizeRoundtable(); } catch (e) {}
      try { drawArt(); } catch (e) {}
    }
    if (!gate) { after(); return; }
    if (animated) {
      gate.classList.add("fade-out");
      setTimeout(() => { try { gate.remove(); } catch (e) {} after(); }, 900);
    } else {
      try { gate.remove(); } catch (e) {}
      after();
    }
  }

  function finishSummon(fog) {
    try { playSfxReveal(); } catch (e) {}
    try { playMarketBell(); } catch (e) {}
    const wrap = document.getElementById("summonVideoWrap");
    const vid = document.getElementById("summonVideo");
    if (vid) {
      try { vid.pause(); } catch (e) {}
    }
    if (wrap) {
      wrap.classList.add("hidden");
      wrap.classList.remove("active");
      wrap.setAttribute("aria-hidden", "true");
    }
    // exit browser fullscreen if we entered it
    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch (e) {}
    dismissGate(true, "floor");
    if (fog) fog.stop();
  }

  function runSummonSequence(fog) {
    ensureAudio();
    const gate = document.getElementById("summonGate");
    const inner = document.getElementById("gateInner");
    const tut = document.getElementById("gateTutorial");
    const status = document.getElementById("summonStatus");
    const wrap = document.getElementById("summonVideoWrap");
    const vid = document.getElementById("summonVideo");
    const skipBtn = document.getElementById("summonVideoSkip");

    if (inner) inner.classList.add("hidden");
    if (tut) tut.classList.add("hidden");
    if (status) status.classList.add("hidden");
    if (gate) gate.classList.add("summoning");
    document.body.classList.add("gate-revealing");

    // Prefer the cinematic video full-viewport
    if (vid && wrap) {
      wrap.classList.remove("hidden");
      wrap.classList.add("active");
      wrap.setAttribute("aria-hidden", "false");
      const fogBed = document.getElementById("summonFogOverlay");
      if (fogBed) fogBed.style.opacity = "0.55";
      try { vid.currentTime = 0; } catch (e) {}
      vid.muted = !!soundMuted;
      // Try true browser fullscreen on the video wrap
      const goFs = () => {
        const el = wrap;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) {
          try { req.call(el); } catch (e) {}
        }
      };
      const onEnded = () => {
        vid.removeEventListener("ended", onEnded);
        finishSummon(fog);
      };
      vid.addEventListener("ended", onEnded);
      if (skipBtn) {
        skipBtn.onclick = () => {
          vid.removeEventListener("ended", onEnded);
          finishSummon(fog);
        };
      }
      const playPromise = vid.play();
      if (playPromise && playPromise.then) {
        playPromise.then(() => {
          goFs();
          // If user had sound on, try unmute after gesture-backed play
          if (!soundMuted) {
            try { vid.muted = false; } catch (e) {}
          }
        }).catch(() => {
          // Autoplay blocked — mute and retry, still show fullscreen visual
          vid.muted = true;
          vid.play().then(goFs).catch(() => {
            // Fall back to fog text sequence
            wrap.classList.add("hidden");
            runSummonFogFallback(fog);
          });
        });
      } else {
        goFs();
      }
      return;
    }

    runSummonFogFallback(fog);
  }

  function runSummonFogFallback(fog) {
    const status = document.getElementById("summonStatus");
    const line = document.getElementById("summonLine");
    if (status) status.classList.remove("hidden");
    if (fog) fog.setIntensity(1.45);
    playSfxFogDrone(2.5);
    let i = 0;
    const step = () => {
      if (line) line.textContent = SUMMON_LINES[i] || SUMMON_LINES[SUMMON_LINES.length - 1];
      playSfxSummonChime(i);
      if (i === 0) playSfxFogDrone(1.4);
      i += 1;
      if (i < SUMMON_LINES.length) {
        setTimeout(step, 950);
      } else {
        if (fog) fog.setIntensity(0.35);
        finishSummon(fog);
      }
    };
    step();
  }

  function placeCoach(targetSel) {
    const hole = document.getElementById("coachHole");
    const card = document.getElementById("coachCard");
    if (!hole || !card) return;
    const el = targetSel ? document.querySelector(targetSel) : null;
    const pad = 8;
    let top = 80, left = 24, width = 120, height = 44;
    if (el) {
      const r = el.getBoundingClientRect();
      top = Math.max(8, r.top - pad);
      left = Math.max(8, r.left - pad);
      width = Math.min(window.innerWidth - left - 8, r.width + pad * 2);
      height = Math.min(window.innerHeight - top - 8, r.height + pad * 2);
    }
    hole.style.top = top + "px";
    hole.style.left = left + "px";
    hole.style.width = Math.max(36, width) + "px";
    hole.style.height = Math.max(28, height) + "px";
    const cardW = Math.min(420, window.innerWidth - 24);
    let cardTop = top + height + 12;
    let cardLeft = Math.min(left, window.innerWidth - cardW - 12);
    if (cardTop + 220 > window.innerHeight) cardTop = Math.max(12, top - 230);
    if (cardLeft < 12) cardLeft = 12;
    card.style.top = cardTop + "px";
    card.style.left = cardLeft + "px";
  }

  function openTutorial(fromHelp) {
    ensureAudio();
    playSfxClick();
    try { document.getElementById("helpTutorialOverlay")?.remove(); } catch (e) {}
    const overlay = document.getElementById("coachOverlay");
    const title = document.getElementById("coachTitle");
    const body = document.getElementById("coachBody");
    const stepEl = document.getElementById("coachStep");
    const next = document.getElementById("coachNext");
    const back = document.getElementById("coachBack");
    const skip = document.getElementById("coachSkip");
    if (!overlay) return;

    const prevMode = mode;
    const fromGate = !fromHelp;
    if (fromGate) {
      const sg = document.getElementById("summonGate");
      if (sg) sg.classList.add("hidden");
      document.body.classList.remove("gate-locked", "gate-revealing");
      document.body.classList.add("tutorial-walk");
    }

    overlay.hidden = false;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");

    let step = 0;
    const total = TUTORIAL_SLIDES.length;

    function closeWalk(land) {
      overlay.classList.add("hidden");
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("tutorial-walk");
      if (fromGate) {
        markOnboarded();
        dismissGate(false, land || "art");
      } else {
        try { if (prevMode && typeof setMode === "function") setMode(prevMode); } catch (e) {}
      }
    }

    function render() {
      const s = TUTORIAL_SLIDES[step] || {};
      if (s.mode && s.mode !== "settings" && typeof setMode === "function") {
        try { setMode(s.mode); } catch (e) {}
      }
      if (title) title.textContent = s.title || "";
      if (body) body.textContent = s.body || "";
      if (stepEl) stepEl.textContent = (step + 1) + " / " + total;
      if (back) back.style.visibility = step === 0 ? "hidden" : "visible";
      if (next) next.textContent = step >= total - 1 ? "Done" : "Next";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => placeCoach(s.target));
      });
    }
    render();

    if (back) {
      back.onclick = () => {
        if (step > 0) {
          step -= 1;
          playSfxWhoosh();
          render();
        }
      };
    }
    if (skip) {
      skip.onclick = () => {
        playSfxClick();
        closeWalk("art");
      };
    }
    if (next) {
      next.onclick = () => {
        if (step < total - 1) {
          step += 1;
          playSfxWhoosh();
          render();
        } else {
          playSfxClick();
          closeWalk("art");
        }
      };
    }
  }
  window.openTutorial = openTutorial;
  window.runSummonSequence = runSummonSequence;
  window.dismissGate = dismissGate;


  // BTC / ETH focus — exclusive, always wired (even if summon gate skipped)
  function wireFocusAndHelp() {
    const focusBtc = document.getElementById("focusBtc");
    const focusEth = document.getElementById("focusEth");
    if (!focusBtc && !focusEth) return;

    function applyFocusChrome() {
      const isEth = focusTable === "ethereum";
      document.body.dataset.focusTable = isEth ? "ethereum" : "bitcoin";
      if (focusBtc) {
        focusBtc.classList.remove("active", "mode-tab");
        if (isEth) focusBtc.classList.remove("focus-active");
        else focusBtc.classList.add("focus-active");
      }
      if (focusEth) {
        focusEth.classList.remove("active", "mode-tab");
        if (isEth) focusEth.classList.add("focus-active");
        else focusEth.classList.remove("focus-active");
      }
      const badge = document.getElementById("focusTableBadge");
      if (badge) badge.textContent = isEth ? "ETH · VITALIK" : "BTC · SATOSHI";
      try { syncChartPairTitle(); } catch (e) {}
    }

    function setFocusTable(which) {
      focusTable = (which === "ethereum" || which === "eth") ? "ethereum" : "bitcoin";
      try { localStorage.setItem("council_focus_table", focusTable); } catch (e) {}
      applyFocusChrome();
      try { updateUI(); } catch (e) { console.warn("focus updateUI", e); }
      try { drawArt(); } catch (e) { console.warn("focus drawArt", e); }
      try { if (mode === "ranks") renderRanksBoard(); } catch (e) {}
      try { if (mode === "dashboard") renderDashboard(); } catch (e) {}
      try { if (mode === "bots") renderBotsGuide(); } catch (e) {}
      try { if (mode === "charts" && !deskCinematicOn()) drawCharts(); } catch (e) {}
      try { if (mode === "follower" && typeof window.renderFollower === "function") window.renderFollower(); } catch (e) {}
      try { if (typeof loadAutoPaper === "function") loadAutoPaper(); } catch (e) {}
    }
    window.setFocusTable = setFocusTable;

    function bind(btn, which) {
      if (!btn || btn.__focusBound) return;
      btn.__focusBound = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setFocusTable(which);
      }, true); // capture — beat any mode-tab handler
    }
    bind(focusBtc, "bitcoin");
    bind(focusEth, "ethereum");
    applyFocusChrome();
    const floorExit = document.getElementById("floorExitBtn");
    if (floorExit && !floorExit.__wired) {
      floorExit.__wired = true;
      floorExit.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setMode("art");
      });
    }
    const focusBadge = document.getElementById("focusTableBadge");
    if (focusBadge && !focusBadge.__wired) {
      focusBadge.__wired = true;
      focusBadge.style.cursor = "pointer";
      focusBadge.title = "Floor — both tables (dual)";
      focusBadge.addEventListener("click", (e) => {
        e.preventDefault();
        if (mode === "settings") return;
        setMode("floor");
      });
    }

    const btnHelp = document.getElementById("btnHelp");
    if (btnHelp && !btnHelp.__wired) {
      btnHelp.__wired = true;
      btnHelp.addEventListener("click", () => { try { ensureAudio(); openTutorial(true); } catch (e) {} });
    }
  }
  // Allow re-wire after DOM patches
  window.__focusWired = false;

  function initSummonGate_DISABLED_OLD(){ try{ document.getElementById('summonGate')?.remove(); document.body.classList.remove('gate-locked'); }catch(e){} return; }
  function initSummonGate() {
    const gate = document.getElementById("summonGate");
    if (!gate) return;
    if (hasOnboarded()) {
      dismissGate(false, "art");
      return;
    }
    gate.classList.remove("hidden");
    const fog = initFog();
    window.__councilFog = fog;

    const btnTut = document.getElementById("btnTutorial");
    const btnSum = document.getElementById("btnSummon");
    if (btnTut && !btnTut.__wiredOnboard) {
      btnTut.__wiredOnboard = true;
      btnTut.addEventListener("click", () => { ensureAudio(); openTutorial(false); });
    }
    const btnHelp = document.getElementById("btnHelp");
    if (btnHelp && !btnHelp.__wired) {
      btnHelp.__wired = true;
      btnHelp.addEventListener("click", () => { ensureAudio(); openTutorial(true); });
    }
    if (btnSum && !btnSum.__wiredOnboard) {
      btnSum.__wiredOnboard = true;
      btnSum.addEventListener("click", () => { ensureAudio(); playSfxClick(); runSummonSequence(fog); });
    }
  }
  window.initSummonGate = initSummonGate;

  // Do not init summon / dismiss to Table before the desk-code gate.
  try { wireFocusAndHelp(); } catch (e) { console.warn('focus wire', e); }

  
  // ——— Celebrate cinematic (logo click + 5-win streak) ———
  let lastCelebratedStreak = 0; // fire once per streak milestone


  function fitVideoToScreen(vid) {
    if (!vid) return;
    try {
      vid.style.width = "100%";
      vid.style.height = "100%";
      vid.style.maxWidth = "100vw";
      vid.style.maxHeight = "100dvh";
      vid.style.objectFit = "contain";
      vid.style.objectPosition = "center center";
    } catch (e) {}
  }

  function playCelebrateVideo(reason) {
    const wrap = document.getElementById("celebrateVideoWrap");
    const vid = document.getElementById("celebrateVideo");
    const skipBtn = document.getElementById("celebrateVideoSkip");
    const fallback = document.getElementById("celebrateFallback");
    if (!wrap || !vid) return;
    if (celebratePlaying) {
      wrap.classList.remove("hidden");
      wrap.classList.add("active");
      wrap.setAttribute("aria-hidden", "false");
      if (fallback) fallback.hidden = false;
      return;
    }
    const gate = document.getElementById("summonGate");
    if (gate && document.body.classList.contains("gate-locked")) return;

    // Overlay only — Fullscreen API resizes the desk and blanks Charts / huddle
    celebratePlaying = true;
    document.body.classList.add("zt-cinematic");
    ensureAudio();
    wrap.classList.remove("hidden");
    wrap.classList.add("active");
    fitVideoToScreen(vid);
    wrap.setAttribute("aria-hidden", "false");
    if (fallback) fallback.hidden = false;
    vid.muted = !!soundMuted;
    vid.playsInline = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");

    let loadTimer = null;
    let loadGen = 0;
    const clearLoadTimer = () => {
      if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    };

    const cleanup = () => {
      celebratePlaying = false;
      document.body.classList.remove("zt-cinematic");
      clearLoadTimer();
      loadGen += 1;
      try { vid.pause(); } catch (e) {}
      wrap.classList.add("hidden");
      wrap.classList.remove("active");
      wrap.setAttribute("aria-hidden", "true");
      if (fallback) fallback.hidden = true;
      vid.onerror = null;
      vid.onloadeddata = null;
      vid.oncanplay = null;
      vid.removeEventListener("ended", onEnded);
    };
    const onEnded = () => cleanup();
    vid.addEventListener("ended", onEnded);
    if (skipBtn) skipBtn.onclick = () => cleanup();

    const keepOverlay = () => {
      wrap.classList.remove("hidden");
      wrap.classList.add("active");
      wrap.setAttribute("aria-hidden", "false");
      if (fallback) fallback.hidden = false;
    };

    const playReady = () => {
      if (!celebratePlaying) return;
      clearLoadTimer();
      const p = vid.play();
      if (p && p.then) {
        p.then(() => {
          if (fallback) fallback.hidden = true;
          if (!soundMuted) {
            try { vid.muted = false; } catch (e) {}
          }
        }).catch(() => {
          vid.muted = true;
          const p2 = vid.play();
          if (p2 && p2.then) {
            p2.then(() => { if (fallback) fallback.hidden = true; }).catch(() => keepOverlay());
          } else {
            keepOverlay();
          }
        });
      } else {
        keepOverlay();
      }
    };

    // Files that exist in this repo. /zt-celebrate.mp4 is not checked in.
    const sources = [
      "/static/video/money-closeup.mp4",
      "/zt-intro.mp4",
      "/summon-council.mp4",
      "/static/zt-intro.mp4",
      "/static/summon-council.mp4",
      "/zt-celebrate.mp4",
    ];

    let srcIdx = 0;
    const LOAD_MS = 1500;

    const tryNext = () => {
      clearLoadTimer();
      if (!celebratePlaying) return;
      if (srcIdx >= sources.length) {
        keepOverlay();
        return;
      }
      const gen = ++loadGen;
      const url = sources[srcIdx++];
      vid.onerror = null;
      vid.onloadeddata = null;
      vid.oncanplay = null;
      try { vid.pause(); } catch (e) {}
      try {
        while (vid.firstChild) vid.removeChild(vid.firstChild);
      } catch (e) {}
      vid.src = url;
      const ok = () => { if (gen !== loadGen) return; playReady(); };
      const fail = () => { if (gen !== loadGen) return; tryNext(); };
      vid.onerror = fail;
      vid.oncanplay = ok;
      vid.onloadeddata = () => { if (vid.readyState >= 2) ok(); };
      try { vid.load(); } catch (e) { tryNext(); return; }
      loadTimer = setTimeout(() => { if (gen !== loadGen) return; tryNext(); }, LOAD_MS);
    };

    // Keep preloaded <source> tags — stripping them caused a ~15s black hang.
    const gen0 = ++loadGen;
    const ok0 = () => { if (gen0 !== loadGen) return; playReady(); };
    const fail0 = () => { if (gen0 !== loadGen) return; tryNext(); };
    vid.onerror = fail0;
    vid.oncanplay = ok0;
    vid.onloadeddata = () => { if (vid.readyState >= 2) ok0(); };
    if (vid.readyState >= 2) {
      playReady();
    } else {
      try { vid.load(); } catch (e) { tryNext(); }
      loadTimer = setTimeout(() => {
        if (gen0 !== loadGen) return;
        if (vid.readyState >= 2) { playReady(); return; }
        tryNext();
      }, LOAD_MS);
    }
    if (reason === "streak") {
      try { playSfxReveal(); } catch (e) {}
    }
  }
  window.playCelebrateVideo = playCelebrateVideo;

  let leaderClickPlaying = false;
  function playLeaderClickVideo() {
    // Gesture-only Floor clip. Uses frontend/static/leader-click.mp4.
    // No title card. Portraits keep drawing underneath. Esc/click dismiss.
    const wrap = document.getElementById("leaderClickWrap");
    const vid = document.getElementById("leaderClickVideo");
    const skipBtn = document.getElementById("leaderClickSkip");
    const fallback = document.getElementById("leaderClickFallback");
    if (!wrap || !vid) return;
    if (leaderClickPlaying || celebratePlaying) return;
    if (document.body.classList.contains("gate-locked")) return;
    if (mode !== "floor") return;

    leaderClickPlaying = true;
    document.body.classList.add("leader-clip-on");
    document.body.classList.remove("zt-cinematic");
    ensureAudio();
    wrap.classList.remove("hidden");
    wrap.classList.add("active");
    wrap.setAttribute("aria-hidden", "false");
    if (fallback) {
      fallback.hidden = true;
      fallback.textContent = "";
    }
    if (typeof fitVideoToScreen === "function") {
      try { fitVideoToScreen(vid); } catch (e) {}
    }
    vid.muted = !!soundMuted;
    vid.playsInline = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    try { vid.currentTime = 0; } catch (e) {}
    try {
      if (typeof window.__floorMusicDuckHold === "function") window.__floorMusicDuckHold();
    } catch (e) {}

    const cleanup = () => {
      if (!leaderClickPlaying) return false;
      leaderClickPlaying = false;
      document.body.classList.remove("leader-clip-on");
      document.body.classList.remove("zt-cinematic");
      try { vid.pause(); } catch (e) {}
      try { vid.currentTime = 0; } catch (e) {}
      wrap.classList.add("hidden");
      wrap.classList.remove("active");
      wrap.setAttribute("aria-hidden", "true");
      if (fallback) {
        fallback.hidden = true;
        fallback.textContent = "";
      }
      try {
        if (typeof window.__floorMusicUnduck === "function") window.__floorMusicUnduck();
      } catch (e) {}
      return true;
    };
    window.__dismissLeaderClick = function () {
      if (!leaderClickPlaying) return false;
      cleanup();
      return true;
    };

    vid.onended = () => cleanup();
    if (skipBtn) skipBtn.onclick = (e) => { e.stopPropagation(); cleanup(); };
    wrap.onclick = () => cleanup();

    const sources = ["/leader-click.mp4", "/static/leader-click.mp4"];
    let srcIdx = 0;
    const playReady = () => {
      if (!leaderClickPlaying) return;
      const p = vid.play();
      if (p && p.then) {
        p.then(() => {
          if (fallback) fallback.hidden = true;
          if (!soundMuted) {
            try { vid.muted = false; } catch (e) {}
          }
        }).catch(() => {
          vid.muted = true;
          const p2 = vid.play();
          if (p2 && p2.then) p2.catch(() => {});
        });
      }
    };
    const tryNext = () => {
      if (!leaderClickPlaying) return;
      if (srcIdx >= sources.length) {
        if (fallback) fallback.hidden = true;
        return;
      }
      const url = sources[srcIdx++];
      vid.onerror = tryNext;
      vid.oncanplay = playReady;
      vid.src = url;
      try { vid.load(); } catch (e) { tryNext(); }
    };
    if (vid.readyState >= 2 && vid.currentSrc && /leader-click\.mp4/i.test(vid.currentSrc)) {
      playReady();
    } else {
      tryNext();
    }
  }
  window.playLeaderClickVideo = playLeaderClickVideo;

  function canvasCssPoint(ev) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const sz = cssCanvasSize();
    return {
      x: (ev.clientX - rect.left) * (sz.w / rect.width),
      y: (ev.clientY - rect.top) * (sz.h / rect.height),
    };
  }
  /* Seat Storm — pass-time after a Chair lock. Never auto-starts. Offer KILL TIME / PLAY only; the mini runs after a tap. Never opens Follower. Never sends Kalshi orders. Paper/live unaffected. */
  const SS_SEATS = ["WICK", "PULSE", "DRIFT", "TAPE", "CARRY", "ORBIT", "VOLT", "STREAK", "ODDS", "STRIKE"];
  const SS_DURATION_MS = 40000;
  const SS_LAST_N_SEC = 180;
  const SS_BEST_KEY = "council_seat_storm_best";
  const ss = {
    playing: false,
    seats: [],
    lit: -1,
    litUntil: 0,
    streak: 0,
    best: 0,
    endsAt: 0,
    raf: 0,
    startedAt: 0,
    _last: -1,
    tap: false,
  };

  function isSeatStormPlaying() { return !!ss.playing; }

  function ssReadBest() {
    try { return Math.max(0, parseInt(sessionStorage.getItem(SS_BEST_KEY) || "0", 10) || 0); }
    catch (_) { return 0; }
  }
  function ssWriteBest(n) {
    ss.best = Math.max(0, n | 0);
    try { sessionStorage.setItem(SS_BEST_KEY, String(ss.best)); } catch (_) {}
  }

  function ssReveal(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.classList.toggle("hidden", !on);
    el.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function ssDeskSick() {
    const s = state || {};
    if (s.sick_feed) return true;
    const bags = [s.health];
    const b = typeof tableState === "function" ? tableState("bitcoin") : null;
    const e = typeof tableState === "function" ? tableState("ethereum") : null;
    if (b && b.health) bags.push(b.health);
    if (e && e.health) bags.push(e.health);
    return bags.some((h) => {
      if (!h) return false;
      const spotOk = !!(h.binance || h.coinbase || h.spot);
      const kalshiDead = h.kalshi === false;
      return !spotOk && kalshiDead;
    });
  }

  function ssLockOf(t) {
    if (!t) return null;
    return t.locked_call || (t.decision && t.decision.locked_call) || null;
  }

  function ssWatchTables() {
    if (!state) return [];
    if (typeof isPhoneDesk === "function" && isPhoneDesk()) {
      const t = (typeof tableState === "function" ? tableState(focusTable) : null) || state;
      return t ? [t] : [];
    }
    const out = [];
    const b = typeof tableState === "function" ? tableState("bitcoin") : null;
    const e = typeof tableState === "function" ? tableState("ethereum") : null;
    if (b) out.push(b);
    if (e) out.push(e);
    if (!out.length) out.push(state);
    return out;
  }

  function ssLockedAndWaiting() {
    return ssWatchTables().some((t) => {
      const lc = ssLockOf(t);
      if (!lc || !lc.locked) return false;
      const d = String(lc.direction || "").toUpperCase();
      if (d !== "UP" && d !== "DOWN") return false;
      return secondsLeftOf(t.market) > SS_LAST_N_SEC;
    });
  }

  function ssCanOffer() {
    if (!hasDeskAuth()) return false;
    if (ss.playing) return false;
    if (lawLocked()) return false;
    if (ssDeskSick()) return false;
    if (!ssLockedAndWaiting()) return false;
    return true;
  }

  function ssHitWindowMs() {
    return Math.max(550, 1100 - ss.streak * 45);
  }

  function ssSfx(kind) {
    if (soundMuted || !callSfxOn) return;
    try {
      const ctx = ensureAudio();
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      if (kind === "hit") o.frequency.value = 880 + Math.min(ss.streak, 12) * 40;
      else if (kind === "miss") o.frequency.value = 140;
      else o.frequency.value = 220;
      g.gain.value = 0.045;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + (kind === "hit" ? 0.07 : 0.12));
    } catch (_) {}
  }

  function ssPaintHud() {
    const st = document.getElementById("ssStreak");
    const be = document.getElementById("ssBest");
    const cl = document.getElementById("ssClock");
    const pair = document.getElementById("ssPair");
    if (st) st.textContent = String(ss.streak);
    if (be) be.textContent = "BEST " + ss.best;
    if (cl) {
      const left = ss.playing ? Math.max(0, Math.ceil((ss.endsAt - Date.now()) / 1000)) : 0;
      cl.textContent = "0:" + String(left).padStart(2, "0");
    }
    if (pair) pair.textContent = focusTable === "bitcoin" ? "BTC" : "ETH";
  }

  function ssClearLit() {
    ss.seats.forEach((el) => el.classList.remove("ss-lit", "ss-miss"));
    ss.lit = -1;
    ss.litUntil = 0;
  }

  function ssPickSeat() {
    if (!ss.playing || !ss.seats.length) return;
    ssClearLit();
    let idx = Math.floor(Math.random() * ss.seats.length);
    if (ss.seats.length > 1 && ss._last === idx) idx = (idx + 1) % ss.seats.length;
    ss._last = idx;
    ss.lit = idx;
    ss.litUntil = Date.now() + ssHitWindowMs();
    ss.seats[idx].classList.add("ss-lit");
    const status = document.getElementById("ssStatus");
    if (status) status.textContent = "TAP THE LIT SEAT";
  }

  function ssMiss() {
    if (!ss.playing) return;
    const el = ss.seats[ss.lit];
    if (el) {
      el.classList.remove("ss-lit");
      el.classList.add("ss-miss");
      setTimeout(() => el.classList.remove("ss-miss"), 180);
    }
    ss.streak = 0;
    ss.lit = -1;
    ss.litUntil = 0;
    ssSfx("miss");
    ssPaintHud();
    const status = document.getElementById("ssStatus");
    if (status) status.textContent = "MISS — STREAK BROKE";
    setTimeout(() => { if (ss.playing) ssPickSeat(); }, 220);
  }

  function ssHit(idx) {
    if (!ss.playing || idx !== ss.lit) {
      if (ss.playing && ss.lit >= 0) ssMiss();
      return;
    }
    ss.streak += 1;
    if (ss.streak > ss.best) ssWriteBest(ss.streak);
    ssSfx("hit");
    ssClearLit();
    ssPaintHud();
    const status = document.getElementById("ssStatus");
    if (status) status.textContent = "HIT · STREAK " + ss.streak;
    setTimeout(() => { if (ss.playing) ssPickSeat(); }, 90);
  }

  function ssTick() {
    if (!ss.playing) return;
    if (lawLocked() || ssDeskSick()) { stopSeatStorm("blocked"); return; }
    if (!ssLockedAndWaiting()) { stopSeatStorm("close"); return; }
    if (Date.now() >= ss.endsAt) { stopSeatStorm("time"); return; }
    if (ss.lit >= 0 && Date.now() >= ss.litUntil) ssMiss();
    ssPaintHud();
    ss.raf = requestAnimationFrame(ssTick);
  }

  function ssBuildRing() {
    const ring = document.getElementById("ssRing");
    if (!ring) return;
    ring.innerHTML = "";
    ss.seats = [];
    const n = SS_SEATS.length;
    SS_SEATS.forEach((name, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-seat";
      btn.textContent = name;
      btn.setAttribute("aria-label", "Seat " + name);
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = 38;
      btn.style.left = (50 + r * Math.cos(ang)) + "%";
      btn.style.top = (50 + r * Math.sin(ang)) + "%";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ssHit(i);
      });
      ring.appendChild(btn);
      ss.seats.push(btn);
    });
  }

  function startSeatStorm() {
    if (!ss.tap) return;
    ss.tap = false;
    if (!ssCanOffer()) return;
    if (lawLocked() || ssDeskSick()) return;
    ss.best = ssReadBest();
    ss.streak = 0;
    ss.playing = true;
    ss.startedAt = Date.now();
    ss.endsAt = ss.startedAt + SS_DURATION_MS;
    ss._last = -1;
    ssReveal(document.getElementById("seatStormPlay"), true);
    ssBuildRing();
    ssPaintHud();
    const status = document.getElementById("ssStatus");
    if (status) status.textContent = "TAP THE LIT SEAT";
    syncSeatStorm();
    ssPickSeat();
    cancelAnimationFrame(ss.raf);
    ss.raf = requestAnimationFrame(ssTick);
  }

  function stopSeatStorm(reason) {
    ss.playing = false;
    cancelAnimationFrame(ss.raf);
    ss.raf = 0;
    ssClearLit();
    ssReveal(document.getElementById("seatStormPlay"), false);
    const status = document.getElementById("ssStatus");
    if (status) {
      if (reason === "close") status.textContent = "WINDOW CLOSING — WATCH THE FINISH";
      else if (reason === "time") status.textContent = "ROUND OVER";
      else status.textContent = "";
    }
    ssPaintHud();
    syncSeatStorm();
  }

  function syncSeatStorm() {
    if (ss.playing && (lawLocked() || ssDeskSick() || !ssLockedAndWaiting())) {
      stopSeatStorm(lawLocked() || ssDeskSick() ? "blocked" : "close");
      return;
    }
    if (!ss.playing) ssReveal(document.getElementById("seatStormPlay"), false);
    const offer = ssCanOffer();
    ssReveal(document.getElementById("seatStormPrompt"), !!(offer && mode === "floor"));
    ssReveal(document.getElementById("seatStormTableBtn"), !!(offer && mode === "art"));
  }

  function ssTapStart(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    ss.tap = true;
    startSeatStorm();
  }

  function initSeatStorm() {
    ss.best = ssReadBest();
    const prompt = document.getElementById("seatStormPrompt");
    const tableBtn = document.getElementById("seatStormTableBtn");
    const exit = document.getElementById("ssExit");
    if (prompt && !prompt.__ssWired) {
      prompt.__ssWired = true;
      prompt.addEventListener("click", ssTapStart);
    }
    if (tableBtn && !tableBtn.__ssWired) {
      tableBtn.__ssWired = true;
      tableBtn.addEventListener("click", ssTapStart);
    }
    if (exit && !exit.__ssWired) {
      exit.__ssWired = true;
      exit.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        stopSeatStorm("desk");
      });
    }
    syncSeatStorm();
  }

  function wireFloorChairClicks() {
    const stage = document.getElementById("tableStage");
    const targets = [canvas, stage].filter(Boolean);
    const already = targets.every((el) => el.__chairClickWired);
    if (!targets.length || already) return;
    const onMove = (e) => {
      if (!canvas) return;
      if (mode !== "floor" || leaderClickPlaying) {
        canvas.classList.remove("chair-hot");
        return;
      }
      const pt = canvasCssPoint(e);
      canvas.classList.toggle("chair-hot", !!(pt && chairHitAt(pt.x, pt.y)));
    };
    const onGesture = (e) => {
      if (mode !== "floor" || leaderClickPlaying || celebratePlaying) return;
      if (document.body.classList.contains("gate-locked")) return;
      const pt = canvasCssPoint(e);
      if (!pt || !chairHitAt(pt.x, pt.y)) return;
      e.preventDefault();
      e.stopPropagation();
      playLeaderClickVideo();
    };
    targets.forEach((el) => {
      if (el.__chairClickWired) return;
      el.__chairClickWired = true;
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onGesture);
      el.addEventListener("click", onGesture);
    });
  }
  wireFloorChairClicks();
  initSeatStorm();

  function checkWinStreakCelebrate(acc) {
    if (!acc) return;
    const streak = Number(acc.streak) || 0;
    const ztBtn = document.getElementById("ztLogoBtn");
    if (ztBtn) {
      ztBtn.classList.toggle("streak-hot", streak >= 3);
      ztBtn.title = streak >= 5
        ? `${streak} win streak! Click to replay cinematic`
        : `Cinematic · win streak ${streak}/5 for auto play`;
    }
    // 5+ win streak → fullscreen close-up money video (once per milestone)
    if (streak >= 5 && streak % 5 === 0 && streak !== lastCelebratedStreak) {
      lastCelebratedStreak = streak;
      playCelebrateVideo("streak");
    }
    if (streak === 0) lastCelebratedStreak = 0;

    // 3+ win streak → raining money on Floor background; stop on wrong (streak 0)
    try {
      if (typeof window.__setFloorMoneyRain === "function") {
        window.__setFloorMoneyRain(streak >= 3);
      }
    } catch (e) {}
  }

  // BEAST badge + settings toggle
  const beastBadge = document.getElementById("beastBadge");
  if (beastBadge) {
    beastBadge.addEventListener("click", () => setBeastMode(!beastMode));
  }
  const beastToggle = document.getElementById("beastToggle");
  if (beastToggle) {
    beastToggle.addEventListener("change", () => {
      if (applyingBeastChrome) return;
      setBeastMode(beastToggle.checked);
    });
  }
  applyBeastChrome(beastMode);
  fetchSettings().then((s) => {
    if (s) applySettingsSnapshot(s, { localToggles: true });
  });

  function wireZtCinematic(btn) {
    if (!btn || btn.__cineWired) return;
    btn.__cineWired = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.target && e.target.closest && e.target.closest("#settingsView")) return;
      if (document.body.classList.contains("mode-settings")) return;
      playCelebrateVideo("manual");
    }, true);
  }
  wireZtCinematic(document.getElementById("ztLogoBtn"));

  async function collectAndSaveSettings() {
    const num = (id, d) => {
      const el = document.getElementById(id);
      if (!el || el.value === "") return d;
      const v = Number(el.value);
      return Number.isFinite(v) ? v : d;
    };
    const on = (id) => {
      const el = document.getElementById(id);
      return el ? !!el.checked : true;
    };
    const profileKey = (document.getElementById("beastToggle") && document.getElementById("beastToggle").checked) ? "beast" : "normal";
    const body = {
      beast_mode: !!(document.getElementById("beastToggle") && document.getElementById("beastToggle").checked),
      [profileKey]: {
        analysis_interval: num("setIntervalInput", profileKey === "beast" ? 1.2 : 2.0),
        analysis_interval_hot: num("setHotInput", profileKey === "beast" ? 1.0 : 1.5),
        analysis_interval_flat: num("setFlatInput", profileKey === "beast" ? 2.5 : 3.5),
        ui_poll_ms: num("setPollInput", 800),
        dual_spot: on("setDualInput"),
        parallel_agents: on("setParallelInput"),
      },
      learning: {
        path_win_pct: num("setPathWin", 7),
        hold_fraction: num("setHoldFrac", 0.35),
        near_certain_bar: num("setNearBar", 90),
        fade_min_n: num("setFadeMinN", 20),
        fade_wr_threshold: num("setFadeWr", 0.42),
        fade_max_weight_share: num("setFadeCap", 0.18),
        anti_min_tries: num("setAntiMin", 15),
        anti_win_rate: num("setAntiWr", 0.62),
        anti_max_bonus: num("setAntiCap", 0.12),
        cold_start_samples: num("setColdN", 15),
        calibrate_samples: num("setCalN", 20),
        exploit_samples: num("setExpN", 80),
      },
      trading: {
        min_confluence: num("setMinConf", 0.42),
        min_directional_conf: num("setMinDirConf", 50),
        top_n_agreement: num("setTopN", 3),
        law_lock_after_wrongs: num("setLawWrongs", 2),
        law_lock_windows: num("setLawWindows", 1),
        law_shadow_early_unlock_rights: num("setLawShadow", 1),
      },
      huddle: {
        enabled: on("setHuddleOn"),
        hour_ct: num("setHuddleHour", 3),
        duration_minutes: num("setHuddleDur", 15),
        rebuild_limit: num("setHuddleRebuild", 400),
      },
      ui: {
        sound_enabled: on("setSoundOn"),
        sound_up: on("setSoundUp"),
        sound_down: on("setSoundDown"),
        sound_swap: on("setSoundSwap"),
        sound_bell: on("setSoundBell"),
        beam_glow: on("setBeamGlow"),
        watermark_opacity: num("setWatermark", 0.18),
        call_sfx: !!(document.getElementById("callSfxToggle") && document.getElementById("callSfxToggle").checked),
        team_loops: !!(document.getElementById("teamLoopToggle") && document.getElementById("teamLoopToggle").checked),
      },
    };
    if (isAdminUnlocked()) {
      const modeEl = document.getElementById("setAutoBetMode");
      let abMode = (modeEl && modeEl.value) || "off";
      if (abMode !== "off" && abMode !== "paper_chair" && abMode !== "follow_leaders") abMode = "off";
      body.auto_bet = {
        enabled: !!(document.getElementById("setAutoBetOn") && document.getElementById("setAutoBetOn").checked),
        mode: abMode,
        size: num("setAutoBetSize", 25),
        btc: on("setAutoBetBtc"),
        eth: on("setAutoBetEth"),
      };
    }
    const st = document.getElementById("settingsSaveStatus");
    try {
      const s = await postSettingsJson(body, "/api/settings/save");
      const applySnap = (typeof window.applySettingsSnapshot === "function")
        ? window.applySettingsSnapshot
        : function () {};
      applySnap(s, { localToggles: true });
      stayOnSettings();
      if (st) st.textContent = "Saved · " + new Date().toLocaleTimeString();
    } catch (e) {
      stayOnSettings();
      if (st) st.textContent = "Save failed: " + e;
    }
  }
  window.collectAndSaveSettings = collectAndSaveSettings;
  window.postSettingsJson = postSettingsJson;

  try { wireAdminGate(); wireAdminTools(); wireBrain(); wireFollowerGate(); } catch (e) { console.warn("admin/brain wire", e); }
  document.addEventListener("DOMContentLoaded", () => {
    try { wireAdminGate(); wireAdminTools(); wireFollowerGate(); } catch (e) {}
  });
  const btnSaveSettings = document.getElementById("btnSaveSettings");
  if (btnSaveSettings && !btnSaveSettings.__wired) {
    btnSaveSettings.__wired = true;
    btnSaveSettings.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      collectAndSaveSettings();
    });
  }
  async function resetSettingsToDefaults() {
    const st = document.getElementById("settingsSaveStatus");
    if (!confirm("Restore Settings defaults?\n\nCall voice turns back on. Cycle times, path grading, and sound knobs reset. BEAST and Team-loops each go to their own defaults — they are not tied together.")) {
      stayOnSettings();
      return;
    }
    try {
      const s = await postSettingsJson({ reset: true }, "/api/settings/reset");
      callSfxOn = true;
      teamLoopsOn = true;
      try { localStorage.setItem("council_call_sfx", "1"); } catch (e) {}
      try { localStorage.setItem("council_team_loops", "1"); } catch (e) {}
      const sfx = document.getElementById("callSfxToggle");
      if (sfx) sfx.checked = true;
      const loops = document.getElementById("teamLoopToggle");
      if (loops) loops.checked = true;
      if (typeof window.applySettingsSnapshot === "function") {
        window.applySettingsSnapshot(s, { localToggles: true });
      }
      callSfxOn = true;
      teamLoopsOn = true;
      if (sfx) sfx.checked = true;
      if (loops) loops.checked = true;
      stayOnSettings();
      if (st) st.textContent = "Defaults restored · " + new Date().toLocaleTimeString();
    } catch (e) {
      stayOnSettings();
      if (st) st.textContent = "Reset failed: " + e;
    }
  }
  window.resetSettingsToDefaults = resetSettingsToDefaults;
  const btnResetSettings = document.getElementById("btnResetSettings");
  if (btnResetSettings && !btnResetSettings.__wired) {
    btnResetSettings.__wired = true;
    btnResetSettings.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetSettingsToDefaults();
    });
  }

  window.setMode = setMode;
  window.applySettingsSnapshot = applySettingsSnapshot;

  const settingsViewEl = document.getElementById("settingsView");
  if (settingsViewEl && !settingsViewEl.__deskLocked) {
    settingsViewEl.__deskLocked = true;
    settingsViewEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
    }, true);
    settingsViewEl.addEventListener("keyup", (e) => {
      e.stopPropagation();
    }, true);
    settingsViewEl.addEventListener("click", (e) => {
      e.stopPropagation();
    }, true);
    settingsViewEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    }, true);
    settingsViewEl.addEventListener("wheel", (e) => {
      e.stopPropagation();
    }, { capture: true, passive: true });
  }

  // Default desk after unlock is Table + ETH. Cold visit stays on the desk-code gate.
  if (!hasDeskAuth()) {
    document.body.classList.add("gate-locked");
    document.body.classList.remove("admin-unlocked", "mode-art", "floor-mode");
    const pg = document.getElementById("passwordGate");
    if (pg) pg.classList.remove("hidden");
  }
  try { dockWindowLed(); } catch (e) {}
  try { paintTableHud(); } catch (e) {}
  try { syncAutoBetVisibility(); } catch (e) {}
  poll();
  pollTimer = setInterval(poll, POLL_MS);
  animId = requestAnimationFrame(loop);
})();


/* Settings Save fallback: persist + paint even if the desk IIFE did not export applySettingsSnapshot */
(function wireSettingsSaveFallback() {
  function paintSettingsSnapshot(s) {
    if (!s) return;
    const L = s.learning || {};
    const T = s.trading || {};
    const H = s.huddle || {};
    const U = s.ui || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    set("setPathWin", L.path_win_pct);
    set("setHoldFrac", L.hold_fraction);
    set("setNearBar", L.near_certain_bar);
    set("setFadeMinN", L.fade_min_n);
    set("setFadeWr", L.fade_wr_threshold);
    set("setFadeCap", L.fade_max_weight_share);
    set("setAntiMin", L.anti_min_tries);
    set("setAntiWr", L.anti_win_rate);
    set("setAntiCap", L.anti_max_bonus);
    set("setMinConf", T.min_confluence);
    set("setMinDirConf", T.min_directional_conf);
    set("setTopN", T.top_n_agreement);
    set("setColdN", L.cold_start_samples);
    set("setCalN", L.calibrate_samples);
    set("setExpN", L.exploit_samples);
    set("setLawWrongs", T.law_lock_after_wrongs);
    set("setLawWindows", T.law_lock_windows);
    set("setLawShadow", T.law_shadow_early_unlock_rights);
    chk("setHuddleOn", H.enabled !== false);
    set("setHuddleHour", H.hour_ct);
    set("setHuddleDur", H.duration_minutes);
    set("setHuddleRebuild", H.rebuild_limit);
    chk("setSoundOn", U.sound_enabled !== false);
    chk("setSoundUp", U.sound_up !== false);
    chk("setSoundDown", U.sound_down !== false);
    chk("setSoundSwap", U.sound_swap !== false);
    chk("setSoundBell", U.sound_bell !== false);
    chk("setBeamGlow", U.beam_glow !== false);
    set("setWatermark", U.watermark_opacity);
    const AB = s.auto_bet || {};
    if (s.auto_bet) {
      chk("setAutoBetOn", AB.enabled);
      const modeEl = document.getElementById("setAutoBetMode");
      if (modeEl && AB.mode) modeEl.value = AB.mode;
      set("setAutoBetSize", AB.size);
      chk("setAutoBetBtc", AB.btc !== false);
      chk("setAutoBetEth", AB.eth !== false);
    }
    set("setIntervalInput", s.analysis_interval);
    set("setHotInput", s.analysis_interval_hot);
    set("setFlatInput", s.analysis_interval_flat);
    set("setPollInput", s.ui_poll_ms);
    chk("setDualInput", s.dual_spot);
    chk("setParallelInput", s.parallel_agents);
    const tog = document.getElementById("beastToggle");
    if (tog && s.beast_mode != null) tog.checked = !!s.beast_mode;
  }
  if (typeof window.applySettingsSnapshot !== "function" || window.applySettingsSnapshot._stub) {
    window.applySettingsSnapshot = paintSettingsSnapshot;
  }

  async function fallbackCollectAndSave() {
    if (typeof window.collectAndSaveSettings === "function") {
      return window.collectAndSaveSettings();
    }
    const num = (id, d) => {
      const el = document.getElementById(id);
      if (!el || el.value === "") return d;
      const v = Number(el.value);
      return Number.isFinite(v) ? v : d;
    };
    const on = (id) => {
      const el = document.getElementById(id);
      return el ? !!el.checked : true;
    };
    const body = {
      beast_mode: !!(document.getElementById("beastToggle") && document.getElementById("beastToggle").checked),
      learning: {
        path_win_pct: num("setPathWin", 7),
        hold_fraction: num("setHoldFrac", 0.35),
        near_certain_bar: num("setNearBar", 90),
        fade_min_n: num("setFadeMinN", 20),
        fade_wr_threshold: num("setFadeWr", 0.42),
        fade_max_weight_share: num("setFadeCap", 0.18),
        anti_min_tries: num("setAntiMin", 15),
        anti_win_rate: num("setAntiWr", 0.62),
        anti_max_bonus: num("setAntiCap", 0.12),
        cold_start_samples: num("setColdN", 15),
        calibrate_samples: num("setCalN", 20),
        exploit_samples: num("setExpN", 80),
      },
      trading: {
        min_confluence: num("setMinConf", 0.42),
        min_directional_conf: num("setMinDirConf", 50),
        top_n_agreement: num("setTopN", 3),
        law_lock_after_wrongs: num("setLawWrongs", 2),
        law_lock_windows: num("setLawWindows", 1),
        law_shadow_early_unlock_rights: num("setLawShadow", 1),
      },
      huddle: {
        enabled: on("setHuddleOn"),
        hour_ct: num("setHuddleHour", 3),
        duration_minutes: num("setHuddleDur", 15),
        rebuild_limit: num("setHuddleRebuild", 400),
      },
      ui: {
        sound_enabled: on("setSoundOn"),
        sound_up: on("setSoundUp"),
        sound_down: on("setSoundDown"),
        sound_swap: on("setSoundSwap"),
        sound_bell: on("setSoundBell"),
        beam_glow: on("setBeamGlow"),
        watermark_opacity: num("setWatermark", 0.18),
        call_sfx: !!(document.getElementById("callSfxToggle") && document.getElementById("callSfxToggle").checked),
        team_loops: !!(document.getElementById("teamLoopToggle") && document.getElementById("teamLoopToggle").checked),
      },
    };
    const st = document.getElementById("settingsSaveStatus");
    try {
      const poster = (typeof window.postSettingsJson === "function")
        ? window.postSettingsJson
        : async function (payload) {
            const r = await fetch("/api/settings/save", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(payload || {}),
            });
            const ct = String((r.headers.get("content-type") || "")).toLowerCase();
            if (!ct.includes("json")) throw new Error("settings route returned HTML, not JSON");
            return r.json();
          };
      const s = await poster(body, "/api/settings/save");
      window.applySettingsSnapshot(s, { localToggles: true });
      if (st) st.textContent = "Saved · " + new Date().toLocaleTimeString();
    } catch (e) {
      if (st) st.textContent = "Save failed: " + e;
    }
  }

  function bindSave() {
    const btn = document.getElementById("btnSaveSettings");
    if (!btn || btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fallbackCollectAndSave();
    });
  }
  function bindReset() {
    const btn = document.getElementById("btnResetSettings");
    if (!btn || btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.resetSettingsToDefaults === "function") {
        window.resetSettingsToDefaults();
        return;
      }
      if (!confirm("Restore Settings defaults?\n\nCall voice turns back on.")) return;
      const poster = (typeof window.postSettingsJson === "function")
        ? window.postSettingsJson
        : null;
      const req = poster
        ? poster({ reset: true }, "/api/settings/reset")
        : fetch("/api/settings/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ reset: true }),
          }).then((r) => {
            const ct = String((r.headers.get("content-type") || "")).toLowerCase();
            if (!ct.includes("json")) throw new Error("settings route returned HTML, not JSON");
            return r.json();
          });
      req.then((s) => {
        const sfx = document.getElementById("callSfxToggle");
        if (sfx) sfx.checked = true;
        try { localStorage.setItem("council_call_sfx", "1"); } catch (err) {}
        if (typeof window.applySettingsSnapshot === "function") {
          window.applySettingsSnapshot(s, { localToggles: true });
        }
        const st = document.getElementById("settingsSaveStatus");
        if (st) st.textContent = "Defaults restored · " + new Date().toLocaleTimeString();
      }).catch((err) => {
        const st = document.getElementById("settingsSaveStatus");
        if (st) st.textContent = "Reset failed: " + err;
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { bindSave(); bindReset(); });
  } else {
    bindSave();
    bindReset();
  }
})();

/* ===== LIVE UPDATE PATCH ===== */
(function () {
  const ACCESS_PASSWORD = "Nakamoto"; // primary access code
  const passKey = "council_auth_ok";

  function showAppAfterAuth() {
    const pg = document.getElementById("passwordGate");
    if (pg) pg.classList.add("hidden");
    document.body.classList.remove("admin-unlocked");
    const onboarded = (typeof window.hasOnboarded === "function") ? window.hasOnboarded() : false;
    if (onboarded) {
      document.body.classList.remove("gate-locked", "gate-revealing");
      const sg = document.getElementById("summonGate");
      if (sg) sg.classList.add("hidden");
      try { if (typeof window.setMode === "function") window.setMode("art"); } catch (e) {}
      return;
    }
    document.body.classList.add("gate-locked");
    const sg = document.getElementById("summonGate");
    if (sg) sg.classList.remove("hidden");
    try { if (typeof window.initSummonGate === "function") window.initSummonGate(); } catch (e) {}
    try { if (typeof wireFocusAndHelp === "function") wireFocusAndHelp(); } catch (e) {}
  }

  function playZtIntroThenSummonGate() {
    let wrap = document.getElementById("ztIntroWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "ztIntroWrap";
      wrap.className = "summon-video-wrap";
      wrap.innerHTML = `
        <video id="ztIntroVideo" playsinline webkit-playsinline>
          <source src="/static/video/money-closeup.mp4" type="video/mp4" />
        </video>
      `;
      document.body.appendChild(wrap);
    }
    wrap.classList.add("active");
    const vid = document.getElementById("ztIntroVideo");

    const finish = () => {
      wrap.classList.remove("active");
      if (vid) { try { vid.pause(); vid.currentTime = 0; } catch (e) {} }
      // Keep the desk hidden until Summon / Tutorial is dismissed.
      document.body.classList.add("gate-locked");
      document.body.classList.remove("admin-unlocked");
      const sg = document.getElementById("summonGate");
      if (sg) {
        sg.classList.remove("hidden");
        sg.style.opacity = "0";
        sg.style.transition = "opacity 1.2s ease";
        requestAnimationFrame(() => { sg.style.opacity = "1"; });
      }
      try { initSummonGate(); } catch (e) { console.warn(e); }
      try { wireFocusAndHelp(); } catch (e) { console.warn(e); }
    };

    if (!vid) { finish(); return; }
    vid.muted = false;
    vid.volume = 0.9;
    const onEnd = () => { vid.removeEventListener("ended", onEnd); finish(); };
    vid.addEventListener("ended", onEnd);
    // Safety timeout
    setTimeout(() => {
      if (vid && !vid.ended && vid.currentTime < 1) finish();
    }, 14000);
    const p = vid.play();
    if (p && p.catch) {
      p.catch(() => finish());
    }
  }
  window.playZtIntroThenSummonGate = playZtIntroThenSummonGate;

  function revealSummonGateOnly() {
    const pg = document.getElementById("passwordGate");
    if (pg) pg.classList.add("hidden");
    document.body.classList.add("gate-locked");
    document.body.classList.remove("admin-unlocked");
    const sg = document.getElementById("summonGate");
    if (sg) sg.classList.remove("hidden");
    try { initSummonGate(); } catch (e) { console.warn(e); }
      try { wireFocusAndHelp(); } catch (e) { console.warn(e); }
  }

  function initPasswordGate() {
    // Never skip the desk code from leftover storage. Cold tab / hard refresh
    // must see the access overlay. A leftover unlocked session is not the public default.
    try { localStorage.removeItem(passKey); } catch (e) {}
    try { sessionStorage.removeItem(passKey); } catch (e) {}
    try { localStorage.removeItem("council_admin_unlocked"); } catch (e) {}
    try { sessionStorage.removeItem("council_admin_unlocked"); } catch (e) {}
    window.__deskUnlockedThisPage = false;
    document.body.classList.remove("admin-unlocked");
    const pg = document.getElementById("passwordGate");
    const input = document.getElementById("passwordInput");
    const btn = document.getElementById("passwordSubmit");
    const err = document.getElementById("passwordError");
    if (!pg) return;
    pg.classList.remove("hidden");
    document.body.classList.add("gate-locked");
    document.body.classList.remove("admin-unlocked");
    document.body.setAttribute("data-password-protected", "true");
    const tryUnlock = () => {
      const v = (input && input.value) || "";
      if (v === ACCESS_PASSWORD || v === "Nakamoto" || v.toLowerCase() === "nakamoto") {
        try { sessionStorage.setItem(passKey, "1"); } catch (e) {}
        try { localStorage.removeItem(passKey); } catch (e) {}
        window.__deskUnlockedThisPage = true;
        if (err) err.classList.add("hidden");
        // Fresh password entry → first-login choice, or the desk if already onboarded
        showAppAfterAuth();
      } else {
        if (err) err.classList.remove("hidden");
      }
    };
    if (btn) btn.addEventListener("click", tryUnlock);
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  }

  function initLogoCredit() {
    const btn = document.getElementById("ztHeaderLogo");
    const pop = document.getElementById("creditPopup");
    if (!btn || !pop) return;
    if (btn.__creditWired) return;
    btn.__creditWired = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pop.classList.toggle("hidden");
      setTimeout(() => pop.classList.add("hidden"), 3200);
    });
  }

  // Starfield for Floor mode
  function initStarfield() {
    let canvas = document.getElementById("starfield");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "starfield";
      document.body.prepend(canvas);
    }
    const ctx = canvas.getContext("2d");
    let stars = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 240 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 2 + 0.2,
        s: Math.random() * 1.8 + 0.3,
      }));
    }
    resize();
    window.addEventListener("resize", resize);
    function tick() {
      if (!document.body.classList.contains("mode-floor") && !document.body.classList.contains("floor-mode")) {
        requestAnimationFrame(tick);
        return;
      }
      ctx.fillStyle = "rgba(2,4,10,0.35)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        st.y += st.z * 1.4;
        if (st.y > canvas.height) {
          st.y = 0;
          st.x = Math.random() * canvas.width;
        }
        ctx.beginPath();
        ctx.fillStyle = `hsla(${200 + st.z * 40}, 90%, ${60 + st.z * 15}%, ${0.5 + st.z * 0.25})`;
        ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    tick();
  }

  // Lightsaber from Chair confidence
    window.updateLightsaber = function updateLightsaber(state) {
    const bar = document.getElementById("lightsaberBar");
    const lab = document.getElementById("lightsaberLabel");
    if (!bar || !lab) return;
    const conf = Math.max(0, Math.min(100, Number((state && state.decision && state.decision.confidence) || (state && state.confidence) || 0)));
    const dir = String((state && state.decision && state.decision.direction) || (state && state.direction) || "WAIT").toUpperCase();
    const pct = conf;
    lab.textContent = pct + "%";
    // Height scales with confidence
    bar.style.height = Math.max(28, Math.round(40 + pct * 1.1)) + "px";

    bar.classList.remove("red", "up", "lit", "wait-blade");
    if (dir === "UP" || dir === "UP_HOLD") {
      bar.classList.add("up", "lit");
      bar.style.background = "";
    } else if (dir === "DOWN" || dir === "DOWN_HOLD" || dir === "SWAP") {
      bar.classList.add("red");
      bar.style.background = "";
    } else {
      bar.classList.add("wait-blade");
      bar.style.background = "";
    }

    // Kylo Ren unstable sparks — denser when high confidence / directional
    try {
      let sparks = document.getElementById("lightsaberSparks");
      if (!sparks) {
        sparks = document.createElement("div");
        sparks.id = "lightsaberSparks";
        sparks.className = "lightsaber-sparks";
        bar.appendChild(sparks);
      }
      // throttle particle spawn
      const now = Date.now();
      if (!window.__lsSparkAt) window.__lsSparkAt = 0;
      const interval = dir === "WAIT" ? 220 : 90;
      if (now - window.__lsSparkAt < interval) return;
      window.__lsSparkAt = now;
      const n = dir === "WAIT" ? 1 : (pct > 70 ? 3 : 2);
      for (let i = 0; i < n; i++) {
        const s = document.createElement("span");
        s.className = "ls-spark";
        const y = 8 + Math.random() * 84; // along blade
        const side = Math.random() < 0.5 ? -1 : 1;
        s.style.left = "50%";
        s.style.top = y + "%";
        s.style.setProperty("--sx", (side * (6 + Math.random() * 16)) + "px");
        s.style.setProperty("--sy", (-8 - Math.random() * 18) + "px");
        sparks.appendChild(s);
        setTimeout(() => { try { s.remove(); } catch (e) {} }, 600);
      }
      // keep DOM light
      while (sparks.children.length > 18) sparks.removeChild(sparks.firstChild);
    } catch (e) {}
  }

  // Cha-ching / warning on graded outcomes
  let lastGraded = null;
  window.playOutcomeFx = function playOutcomeFx(state) {
    const acc = state && state.accuracy;
    if (!acc) return;
    const key = `${acc.correct}|${acc.wrong}|${acc.total}`;
    if (lastGraded === null) { lastGraded = key; return; }
    if (key === lastGraded) return;
    const prev = lastGraded.split("|").map(Number);
    lastGraded = key;
    const [pc, pw] = prev;
    let kind = null;
    if ((acc.correct || 0) > pc) kind = "win";
    else if ((acc.wrong || 0) > pw) kind = "lose";
    if (!kind) return;
    let el = document.getElementById("sfxFlash");
    if (!el) {
      el = document.createElement("div");
      el.id = "sfxFlash";
      el.className = "sfx-flash";
      document.body.appendChild(el);
    }
    el.className = "sfx-flash show " + kind;
    el.textContent = kind === "win" ? "💰" : "⚠️";
    try {
      if (kind === "win") playWinCashSfx();
      else playLoseTromboneSfx();
    } catch (e) {}
    try {
      if (typeof window.__onGradedOutcome === "function") window.__onGradedOutcome(kind, acc);
    } catch (e) {}
    setTimeout(() => el.classList.remove("show"), 700);
  }

  const _origApply = window.applyState || null;
  // Hook poll updates if applyCouncilState exists
  const hook = () => {
    if (typeof window.applyCouncilState === "function" && !window.__lsHooked) {
      const orig = window.applyCouncilState;
      window.applyCouncilState = function (s) {
        orig(s);
        try { updateLightsaber(s); playOutcomeFx(s); } catch (e) {}
      };
      window.__lsHooked = true;
    }
  };
  setInterval(hook, 1000);

  document.addEventListener("DOMContentLoaded", () => {
    initPasswordGate();
    initLogoCredit();
    initStarfield();
  });
  // Also run immediately if DOM ready
  if (document.readyState !== "loading") {
    initPasswordGate();
    initLogoCredit();
    initStarfield();
  }
})();



/* ===== SUMMON VIDEO + FOG REVEAL ===== */
(function () {
  function playSummonVideoThenReveal() {
    if (typeof window.runSummonSequence === "function") {
      window.runSummonSequence(window.__councilFog || null);
      return;
    }
    const gate = document.getElementById("summonGate");
    if (gate) {
      gate.classList.add("summoning");
      gate.classList.remove("hidden");
    }
    document.body.classList.add("gate-revealing");

    // Fullscreen video layer
    let wrap = document.getElementById("summonVideoWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "summonVideoWrap";
      wrap.className = "summon-video-wrap";
      wrap.innerHTML = `
        <video id="summonVideo" playsinline webkit-playsinline>
          <source src="/summon-council.mp4" type="video/mp4" />
        </video>
        <div id="summonFogOverlay" class="summon-fog-overlay"></div>
      `;
      document.body.appendChild(wrap);
    }
    wrap.classList.add("active");
    const vid = document.getElementById("summonVideo");
    fitVideoToScreen(vid);
    const fog = document.getElementById("summonFogOverlay");
    if (fog) fog.style.opacity = "0.85";

    const finish = () => {
      if (fog) {
        fog.style.transition = "opacity 2.8s ease";
        fog.style.opacity = "0";
      }
      setTimeout(() => {
        wrap.classList.remove("active");
        if (vid) { try { vid.pause(); vid.currentTime = 0; } catch (e) {} }
        if (gate) {
          gate.classList.add("fade-out");
          setTimeout(() => { try { gate.remove(); } catch (e) {} }, 900);
        }
        document.body.classList.remove("gate-locked", "gate-revealing");
        try {
          if (typeof finishSummon === "function") finishSummon(null);
        } catch (e) {}
      }, 2800);
    };

    if (!vid) { finish(); return; }
    vid.muted = false;
    vid.volume = 0.85;
    const onEnd = () => { vid.removeEventListener("ended", onEnd); finish(); };
    vid.addEventListener("ended", onEnd);
    // Safety timeout if video stalls
    setTimeout(() => {
      if (!vid.ended && vid.currentTime < 1) finish();
    }, 18000);
    const p = vid.play();
    if (p && p.catch) {
      p.catch(() => {
        // Autoplay blocked — still show fog reveal
        finish();
      });
    }
  }

  // Hook Summon button after DOM ready
  function wireSummonBtn() {
    const btn = document.getElementById("btnSummon");
    if (!btn || btn.__wiredVideo) return;
    btn.__wiredVideo = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { if (typeof ensureAudio === "function") ensureAudio(); } catch (err) {}
      playSummonVideoThenReveal();
    }, true);
  }
  document.addEventListener("DOMContentLoaded", wireSummonBtn);
  if (document.readyState !== "loading") setTimeout(wireSummonBtn, 200);
  setInterval(wireSummonBtn, 1500);

  // Also expose
  window.playSummonVideoThenReveal = playSummonVideoThenReveal;
})();

// ——— Hive easter egg (subtle, for true fans) ———
(function initHiveEgg() {
  function wire() {
    const btn = document.getElementById("hiveBtn");
    const egg = document.getElementById("hiveEgg");
    const close = document.getElementById("hiveEggClose");
    
    if (!btn || !egg) return;

    const open = () => {
      egg.classList.remove("hidden");
      document.body.classList.add("hive-open");
    };

    const shut = () => {
      egg.classList.add("hidden");
      document.body.classList.remove("hive-open");
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target && e.target.closest && e.target.closest("#settingsView")) return;
      if (document.body.classList.contains("mode-settings")) return;
      if (e.currentTarget !== btn) return;
      open();
    });

    if (close) close.addEventListener("click", shut);

    egg.addEventListener("click", (e) => {
      if (e.target === egg) shut();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !egg.classList.contains("hidden")) shut();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();



/* ===== ADMIN PASSWORD + SELECTIVE CLEARS + EXCEL ===== */
(function () {
  const ADMIN_PASSWORD = "5152622439";
  const ADMIN_KEY = "council_admin_unlocked";
  try { localStorage.removeItem(ADMIN_KEY); } catch (e) {}
  try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
  document.body.classList.remove("admin-unlocked");

  window.isAdminUnlocked = function isAdminUnlocked() {
    try { return sessionStorage.getItem(ADMIN_KEY) === "1" && !!window.__adminUnlockedThisPage; } catch (e) { return !!window.__adminUnlockedThisPage; }
  };
  function setAdminUnlocked(on) {
    try { sessionStorage.setItem(ADMIN_KEY, on ? "1" : "0"); } catch (e) {}
    try { localStorage.removeItem(ADMIN_KEY); } catch (e) {}
    if (on) window.__adminUnlockedThisPage = true;
    document.body.classList.toggle("admin-unlocked", !!on);
    if (on) {
      try { if (typeof window.mountAdminDesk === "function") window.mountAdminDesk(); } catch (e) {}
    }
  }

  let pendingAdminCb = null;

  window.requestAdminUnlock = function requestAdminUnlock(cb) {
    if (isAdminUnlocked()) { if (cb) cb(); return; }
    pendingAdminCb = cb || null;
    const gate = document.getElementById("adminGate");
    const input = document.getElementById("adminInput");
    const err = document.getElementById("adminError");
    if (err) err.classList.add("hidden");
    if (input) { input.value = ""; }
    if (gate) gate.classList.remove("hidden");
    setTimeout(() => { try { input && input.focus(); } catch (e) {} }, 50);
  };

  function closeAdminGate(ok) {
    const gate = document.getElementById("adminGate");
    if (gate) gate.classList.add("hidden");
    const cb = pendingAdminCb || window.__pendingAdminUnlock;
    pendingAdminCb = null;
    window.__pendingAdminUnlock = null;
    if (ok && typeof cb === "function") cb();
    if (ok) {
      window.__adminUnlockedThisPage = true;
      try { if (typeof window.mountAdminDesk === "function") window.mountAdminDesk(); } catch (e) {}
    }
    if (ok && window.__openSettingsAfterAdmin && typeof window.setMode === "function") {
      window.__openSettingsAfterAdmin = false;
      window.setMode("settings");
    }
  }

  function wireAdminGate() {
    const submit = document.getElementById("adminSubmit");
    const cancel = document.getElementById("adminCancel");
    const input = document.getElementById("adminInput");
    const err = document.getElementById("adminError");
    if (submit && !submit.__wired) {
      submit.__wired = true;
      const tryUnlock = () => {
        const val = (input && input.value) || "";
        if (val === ADMIN_PASSWORD) {
          setAdminUnlocked(true);
          if (err) err.classList.add("hidden");
          closeAdminGate(true);
        } else {
          if (err) { err.textContent = "Wrong password"; err.classList.remove("hidden"); }
        }
      };
      submit.addEventListener("click", tryUnlock);
      if (input && !input.__hotkeysSwallowed) {
        input.__hotkeysSwallowed = true;
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (e.key === "Enter") tryUnlock();
        }, true);
      }
    }
    if (cancel && !cancel.__wired) {
      cancel.__wired = true;
      cancel.addEventListener("click", () => closeAdminGate(false));
    }
  }

  async function adminFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {}, { "X-Council-Admin": ADMIN_PASSWORD });
    return fetch(url, opts);
  }

  function wireAdminTools() {
    const st = () => document.getElementById("adminToolsStatus");
    const clearHit = document.getElementById("btnClearHitRate");
    const clearLog = document.getElementById("btnClearLifeLog");
    const exportBtn = document.getElementById("btnExportExcel");

    if (clearHit && !clearHit.__wired) {
      clearHit.__wired = true;
      clearHit.addEventListener("click", () => {
        requestAdminUnlock(async () => {
          if (!confirm("Reset hit-rate and the Floor Satoshi vs Vitalik scorecard? Training weights will NOT be deleted. Path-era scores will stop counting.")) return;
          try {
            const r = await adminFetch("/api/admin/clear-hit-rate", { method: "POST" });
            const data = await r.json();
            if (st()) st().textContent = data.ok ? "Hit rate & scorecard cleared · " + (data.reset_at || "") : ("Failed: " + (data.error || ""));
            // Refresh UI accuracy display
            try {
              const s = await (await fetch("/api/state")).json();
              if (window.state !== undefined) { /* poll will refresh */ }
            } catch (e) {}
          } catch (e) {
            if (st()) st().textContent = "Clear failed: " + e;
          }
        });
      });
    }
    if (clearLog && !clearLog.__wired) {
      clearLog.__wired = true;
      clearLog.addEventListener("click", () => {
        requestAdminUnlock(async () => {
          if (!confirm("Clear lifetime log display? Training weights will NOT be deleted.")) return;
          try {
            const r = await adminFetch("/api/admin/clear-life-log", { method: "POST" });
            const data = await r.json();
            if (st()) st().textContent = data.ok ? "Life log cleared · " + (data.reset_at || "") : ("Failed: " + (data.error || ""));
            const log = document.getElementById("callLog");
            if (log) log.innerHTML = `<div class="call-empty">LIFETIME LOG CLEARED<br/>New settled calls will appear here</div>`;
          } catch (e) {
            if (st()) st().textContent = "Clear failed: " + e;
          }
        });
      });
    }
    if (exportBtn && !exportBtn.__wired) {
      exportBtn.__wired = true;
      exportBtn.addEventListener("click", () => {
        requestAdminUnlock(() => {
          // Trigger download with admin header via hidden form-like navigation
          const a = document.createElement("a");
          a.href = "/api/admin/export.xlsx?admin=" + encodeURIComponent(ADMIN_PASSWORD);
          a.download = "satoshi-council-log.xlsx";
          document.body.appendChild(a);
          a.click();
          a.remove();
          if (st()) st().textContent = "Excel download started…";
        });
      });
    }
    const brainBtn = document.getElementById("btnBrainExport");
    if (brainBtn && !brainBtn.__wired) {
      brainBtn.__wired = true;
      brainBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestAdminUnlock(() => {
          const a = document.createElement("a");
          a.href = "/api/brain/export?admin=" + encodeURIComponent(ADMIN_PASSWORD);
          a.download = "satoshi-council-brain.json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          const bs = document.getElementById("brainStatus");
          if (bs) bs.textContent = "Brain download started…";
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireAdminGate();
    wireAdminTools();
  });
  if (document.readyState !== "loading") {
    setTimeout(() => { wireAdminGate(); wireAdminTools(); }, 200);
  }
})();



/* ===== FLOOR MODE BACKGROUND MUSIC (only in Floor) ===== */
(function initFloorMusic() {
  const TRACKS = [
    "/static/music/floor/01-transmission.mp3",
    "/static/music/floor/02-metaphor-mood-maze.mp3",
    "/static/music/floor/03-take-me-somewhere-else.mp3",
    "/static/music/floor/04-evacuate.mp3",
    "/static/music/floor/05-eclectic-dream.mp3",
    "/static/music/floor/06-killjoy.mp3",
    "/static/music/floor/07-midnight-drift.mp3",
    "/static/music/floor/08-in-drive.mp3",
    "/static/music/floor/09-smoke-me.mp3",
  ];
  const VOL_KEY = "council_floor_music_vol";
  const MUTE_KEY = "council_floor_music_muted";
  let idx = 0;
  let audio = null;
  let active = false;
  let muted = localStorage.getItem(MUTE_KEY) !== "0";
  if (localStorage.getItem(MUTE_KEY) == null) {
    try { localStorage.setItem(MUTE_KEY, "1"); } catch (e) {}
  }
  let vol = Number(localStorage.getItem(VOL_KEY));
  if (!(vol >= 0 && vol <= 1)) vol = 0.28;

  function ensureAudio() {
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audio.loop = false;
      audio.volume = muted ? 0 : vol;
      audio.addEventListener("ended", () => {
        idx = (idx + 1) % TRACKS.length;
        playCurrent();
      });
      audio.addEventListener("error", () => {
        // Skip broken track
        idx = (idx + 1) % TRACKS.length;
        setTimeout(playCurrent, 400);
      });
    }
    return audio;
  }

  function playCurrent() {
    if (!active || muted) return;
    const a = ensureAudio();
    const src = TRACKS[idx % TRACKS.length];
    if (!a.src.endsWith(src.split("/").pop())) {
      a.src = src;
    }
    a.volume = muted ? 0 : vol;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stopMusic() {
    active = false;
    if (audio) {
      try { audio.pause(); } catch (e) {}
    }
  }

  function startMusic() {
    active = true;
    if (muted) return;
    playCurrent();
  }

  window.__floorMusicOnMode = function (isFloor) {
    if (isFloor) startMusic();
    else stopMusic();
  };

  window.__floorMusicDuck = function (ms) {
    if (!audio || muted || !active) return;
    try { audio.volume = Math.min(vol, 0.04); } catch (e) {}
    const hold = Math.max(400, Number(ms) || 2200);
    setTimeout(() => {
      if (audio && !muted) {
        try { audio.volume = vol; } catch (e) {}
      }
    }, hold);
  };

  window.__floorMusicDuckHold = function () {
    if (!audio || muted || !active) return;
    try { audio.volume = Math.min(vol, 0.04); } catch (e) {}
  };
  window.__floorMusicUnduck = function () {
    if (audio && !muted) {
      try { audio.volume = vol; } catch (e) {}
    }
  };

  window.__floorMusicToggleMute = function () {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (audio) audio.volume = muted ? 0 : vol;
    if (muted) {
      if (audio) try { audio.pause(); } catch (e) {}
    } else if (active) {
      playCurrent();
    }
    const btn = document.getElementById("floorMusicBtn");
    if (btn) {
      btn.textContent = muted ? "🔇 Floor" : "🎵 Floor";
      btn.setAttribute("aria-pressed", muted ? "false" : "true");
      btn.title = muted ? "Floor music muted — click to play" : "Floor music on — click to mute";
    }
    return muted;
  };

  function wireBtn() {
    let btn = document.getElementById("floorMusicBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "floorMusicBtn";
      btn.type = "button";
      btn.className = "floor-music-btn";
      btn.textContent = muted ? "🔇 Floor" : "🎵 Floor";
      btn.title = muted ? "Floor music muted — click to play" : "Floor music on — click to mute";
      btn.setAttribute("aria-pressed", muted ? "false" : "true");
      // Prefer header controls
      const controls = document.querySelector("header .controls") || document.querySelector("header");
      if (controls) controls.appendChild(btn);
      else document.body.appendChild(btn);
    }
    if (!btn.__wired) {
      btn.__wired = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        window.__floorMusicToggleMute();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", wireBtn);
  if (document.readyState !== "loading") setTimeout(wireBtn, 200);
})();



/* ===== Floor money rain (3+ win streak) + graded outcome hook ===== */
(function initFloorMoneyRain() {
  let active = false;
  let lastKind = null;

  function ensureEls() {
    let wrap = document.getElementById("floorMoneyRain");
    let vid = document.getElementById("floorMoneyRainVideo");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "floorMoneyRain";
      wrap.className = "floor-money-rain hidden";
      wrap.setAttribute("aria-hidden", "true");
      vid = document.createElement("video");
      vid.id = "floorMoneyRainVideo";
      vid.playsInline = true;
      vid.muted = true;
      vid.loop = true;
      const src = document.createElement("source");
      src.src = "/static/video/money-rain.mp4";
      src.type = "video/mp4";
      vid.appendChild(src);
      wrap.appendChild(vid);
      document.body.appendChild(wrap);
    }
    return { wrap, vid: vid || document.getElementById("floorMoneyRainVideo") };
  }

  function startRain() {
    const { wrap, vid } = ensureEls();
    if (!wrap || !vid) return;
    active = true;
    wrap.classList.remove("hidden");
    wrap.classList.add("active");
    wrap.setAttribute("aria-hidden", "false");
    // Only play when Floor mode is on
    if (document.body.classList.contains("floor-mode")) {
      try {
        vid.currentTime = 0;
        const p = vid.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
  }

  function stopRain() {
    const { wrap, vid } = ensureEls();
    active = false;
    if (wrap) {
      wrap.classList.remove("active");
      wrap.classList.add("hidden");
      wrap.setAttribute("aria-hidden", "true");
    }
    if (vid) {
      try { vid.pause(); } catch (e) {}
    }
  }

  window.__setFloorMoneyRain = function (on) {
    if (on) startRain();
    else stopRain();
  };

  // Re-evaluate when entering/leaving floor mode
  const prev = window.__floorMusicOnMode;
  window.__floorMusicOnMode = function (isFloor) {
    if (typeof prev === "function") {
      try { prev(isFloor); } catch (e) {}
    }
    if (isFloor && active) {
      const vid = document.getElementById("floorMoneyRainVideo");
      if (vid) {
        const p = vid.play();
        if (p && p.catch) p.catch(() => {});
      }
      const wrap = document.getElementById("floorMoneyRain");
      if (wrap) {
        wrap.classList.remove("hidden");
        wrap.classList.add("active");
      }
    } else if (!isFloor) {
      const vid = document.getElementById("floorMoneyRainVideo");
      if (vid) try { vid.pause(); } catch (e) {}
      const wrap = document.getElementById("floorMoneyRain");
      if (wrap) wrap.classList.remove("active");
    }
  };

  // On wrong call → hard stop rain
  window.__onGradedOutcome = function (kind, acc) {
    lastKind = kind;
    if (kind === "lose") {
      stopRain();
      lastCelebratedStreak = 0;
    }
  };
})();


/* Sound lives inside the desk IIFE. Do not stub Bell here — Floor music ducks under it. */
