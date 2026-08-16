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
  try { document.body.classList.add("front-tab-off"); } catch (e) {}

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
  document.documentElement.classList.add("gate-locked");
  document.documentElement.classList.remove("desk-unlocked");
  document.body.classList.add("gate-locked");
  document.body.classList.remove("admin-unlocked", "follower-unlocked", "desk-unlocked");
  document.body.setAttribute("data-password-protected", "true");
  function revealAppAfterDeskUnlock() {
    // Successful desk code: never leave #app hidden. Clear lock classes on
    // BOTH html and body — CSS also keys off html.gate-locked and leftover
    // gate-revealing. Hide the desk overlay and force the desk visible.
    try {
      const pg = document.getElementById("passwordGate");
      if (pg) {
        pg.classList.add("hidden");
        pg.setAttribute("aria-hidden", "true");
      }
    } catch (e) {}
    try {
      document.documentElement.classList.remove("gate-locked", "gate-revealing");
      document.body.classList.remove("gate-locked", "gate-revealing");
      document.documentElement.classList.add("desk-unlocked");
      document.body.classList.add("desk-unlocked");
    } catch (e) {}
    try {
      const app = document.getElementById("app");
      if (app) {
        app.style.setProperty("visibility", "visible", "important");
        app.style.setProperty("pointer-events", "auto", "important");
      }
    } catch (e) {}
    // First live hour after unlock — do not sit on an empty cached desk.
    try {
      if (typeof window.hydrateLiveHour === "function") window.hydrateLiveHour();
    } catch (e) {}
    try {
      if (typeof window.prefetchLeaderClickVideo === "function") window.prefetchLeaderClickVideo();
    } catch (e) {}
    try {
      if (typeof window.loadHealthStrip === "function") window.loadHealthStrip();
    } catch (e) {}
  }
  window.revealAppAfterDeskUnlock = revealAppAfterDeskUnlock;
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
          if (!confirm("Reset hit-rate and the Floor book match (BTC sized locks vs ETH shadow picks)? Training weights will NOT be deleted. Path-era scores will stop counting.")) return;
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
  ["UP", "DOWN", "WAIT"].forEach(k => {
    vitalikImages[k].crossOrigin = "anonymous";
    vitalikImages[k].onload = _chairLoaded;
    vitalikImages[k].onerror = () => console.warn("Vitalik image failed:", k);
  });
  vitalikImages.UP.src = "/vitalik-up.jpg";
  vitalikImages.DOWN.src = "/vitalik-down.jpg";
  vitalikImages.WAIT.src = "/vitalik-wait.jpg";
  function vitalikPortraitFor(dir) {
    const d = String(dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return vitalikImages.UP;
    if (d === "DOWN" || d === "DOWN_HOLD") return vitalikImages.DOWN;
    return vitalikImages.WAIT;
  }
  const raijinImages = { UP: new Image(), DOWN: new Image(), WAIT: new Image() };
  ["UP", "DOWN", "WAIT"].forEach(k => {
    raijinImages[k].crossOrigin = "anonymous";
    raijinImages[k].onload = _chairLoaded;
    raijinImages[k].onerror = () => console.warn("Raijin image failed:", k);
  });
  raijinImages.UP.src = "/raijin-up.jpg";
  raijinImages.DOWN.src = "/raijin-down.jpg";
  raijinImages.WAIT.src = "/raijin-wait.jpg";
  raijinImages.UP_HOLD = raijinImages.UP;
  raijinImages.DOWN_HOLD = raijinImages.DOWN;
  function raijinPortraitFor(dir) {
    const d = String(dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return raijinImages.UP;
    if (d === "DOWN" || d === "DOWN_HOLD") return raijinImages.DOWN;
    return raijinImages.WAIT;
  }
  function raijinPortraitSrc(dir) {
    const d = String(dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return "/raijin-up.jpg";
    if (d === "DOWN" || d === "DOWN_HOLD") return "/raijin-down.jpg";
    return "/raijin-wait.jpg";
  }
  const oraclePortrait = new Image();
  oraclePortrait.crossOrigin = "anonymous";
  oraclePortrait.src = "/oracle-wait.jpg";
  function isOracleTable(which) {
    const w = String(which != null ? which : (typeof focusTable !== "undefined" ? focusTable : "")).toLowerCase();
    return w === "oracle" || w === "sibyl";
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
  document.documentElement.classList.add("gate-locked");
  document.documentElement.classList.remove("desk-unlocked");
  document.body.classList.add("gate-locked");
  document.body.classList.remove("admin-unlocked", "desk-unlocked");

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
    try { applyFrontSettings(s.front || {}); } catch (e) {}
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
    document.body.classList.toggle("floor-mode", next === "floor" || next === "night");
    document.body.classList.toggle("night-mode", next === "night");
    const phoneFloor = (next === "floor" || next === "night") && (typeof isPhoneDesk === "function" ? isPhoneDesk() : false);
    document.body.classList.toggle("phone-floor", phoneFloor);
    try { if (typeof initModeTabsScroll === "function") initModeTabsScroll(); } catch (e) {}
  }
  function syncExclusiveTabActive(next) {
    document.querySelectorAll(".mode-tab, .focus-tab").forEach((btn) => {
      if (btn.id === "focusBtc" || btn.id === "focusEth" || btn.id === "focusFront" || btn.id === "btnHelp" || !btn.dataset.mode) {
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



  let mode = "art"; // art | seats | paper | charts | …  (bots/ranks/dashboard alias to seats)
  let state = null;
  let focusTable = (function(){ try { const v = localStorage.getItem("council_focus_table"); if (v === "ethereum" || v === "bitcoin" || v === "front" || v === "ats") return v; } catch(e){} return "ethereum"; })();
  try { document.body.dataset.focusTable = focusTable; } catch (e) {}
  function tableHasLiveHour(t) {
    if (!t || typeof t !== "object") return false;
    const agents = t.agents;
    const hasSeats = Array.isArray(agents) && agents.some(function (a) {
      return a && a.agent_name && a.agent_name !== "leader";
    });
    const m = t.market || {};
    const hasWindow = m.seconds_left != null || m.time_remaining != null
      || m.close_time || m.mins_left != null;
    return !!(hasSeats || hasWindow);
  }

  function isFrontTable(which) {
    const w = String(which != null ? which : (typeof focusTable !== "undefined" ? focusTable : "")).toLowerCase();
    return w === "front" || w === "raijin" || w === "dfw" || w === "dallas" || w === "dwf";
  }
  const FRONT_SEAT_IDS = ["GLASS", "PIT", "FROST", "BONE", "MESH"];
  const FRONT_SEAT_KEYS = ["glass", "pit", "frost", "bone", "mesh"];
  const FRONT_SUB_IDS = ["HEAT", "ECHO", "CELL"];
  function frontSeatMark(id) {
    const k = String(id || "").toLowerCase();
    if (FRONT_SEAT_KEYS.indexOf(k) >= 0) return "/static/bots/" + k + ".png";
    return "";
  }
  function isFrontSeatKey(name) {
    const k = String(name || "").toLowerCase();
    return FRONT_SEAT_KEYS.indexOf(k) >= 0;
  }
  function isFrontSubKey(name) {
    const k = String(name || "").toUpperCase();
    return FRONT_SUB_IDS.indexOf(k) >= 0;
  }
  function frontSubsOf(board) {
    if (board && Array.isArray(board.subs) && board.subs.length) return board.subs;
    const seats = (board && board.seats) || [];
    const out = [];
    seats.forEach(function (s) {
      (s && s.subs || []).forEach(function (sub) {
        if (sub && FRONT_SUB_IDS.indexOf(String(sub.id || "").toUpperCase()) >= 0) out.push(sub);
      });
    });
    const seen = {};
    return out.filter(function (s) {
      const id = String(s.id || "").toUpperCase();
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }
  function subsForParent(subs, id) {
    const want = String(id || "").toUpperCase();
    return (subs || []).filter(function (s) {
      if (!s) return false;
      if (String(s.parent || "").toUpperCase() === want) return true;
      return (s.feeds || []).some(function (f) { return String(f).toUpperCase() === want; });
    });
  }
  function wxWord(dir, strikeType, forecast, floor, cap) {
    const d = String(dir || "WAIT").toUpperCase();
    if (d === "ABOVE" || d === "BELOW" || d === "BETWEEN" || d === "WAIT") return d;
    if (d === "SKIP" || d === "CLEAR") return "WAIT";
    const kind = String(strikeType || "").toLowerCase();
    const yes = d === "YES" || d === "UP" || d === "UP_HOLD";
    const no = d === "NO" || d === "DOWN" || d === "DOWN_HOLD" || d === "OUT";
    if (!yes && !no) return "WAIT";
    if (kind === "between") {
      if (yes) return "BETWEEN";
      if (forecast != null && cap != null && Number(forecast) > Number(cap)) return "ABOVE";
      if (forecast != null && floor != null && Number(forecast) < Number(floor)) return "BELOW";
      return "BELOW";
    }
    if (kind === "less" || kind === "less_or_equal") return yes ? "BELOW" : "ABOVE";
    return yes ? "ABOVE" : "BELOW";
  }
  function wxEye(word) {
    const w = String(word || "WAIT").toUpperCase();
    if (w === "ABOVE" || w === "BETWEEN" || w === "UP" || w === "YES" || w === "UP_HOLD") return "UP";
    if (w === "BELOW" || w === "DOWN" || w === "NO" || w === "DOWN_HOLD") return "DOWN";
    return "WAIT";
  }
  function wxTone(dir) {
    const w = String(dir || "WAIT").toUpperCase();
    if (w === "ABOVE" || w === "BETWEEN" || w === "UP" || w === "UP_HOLD" || w === "YES") return "UP";
    if (w === "BELOW" || w === "DOWN" || w === "DOWN_HOLD" || w === "NO") return "DOWN";
    return "WAIT";
  }
  function frontClockOf(board) {
    return (board && board.clock) || {};
  }
  function frontHighLine(ts) {
    const m = (ts && ts.market) || {};
    const clock = m.clock || frontClockOf(typeof frontBoard !== "undefined" ? frontBoard : null);
    const kind = String(clock.strike_type || m.strike_type || "").toLowerCase();
    const lo = clock.floor_strike != null ? clock.floor_strike : m.floor_strike;
    const hi = clock.cap_strike != null ? clock.cap_strike : m.cap_strike;
    const kh = clock.kalshi_high != null ? clock.kalshi_high : m.kalshi_high;
    const nws = clock.nws_high != null ? clock.nws_high : m.nws_high;
    const bracket = clock.bracket || m.bracket;
    let head = "KALSHI HIGH —";
    if (kind === "between" && lo != null && hi != null) {
      head = "KALSHI HIGH " + Math.round(Number(lo)) + "–" + Math.round(Number(hi)) + "°F";
    } else if (kh != null && isFinite(Number(kh))) {
      head = "KALSHI HIGH " + Math.round(Number(kh)) + "°F";
    } else if (bracket) {
      head = "KALSHI HIGH " + String(bracket);
    }
    if (nws != null && isFinite(Number(nws))) {
      head += " · NWS " + Math.round(Number(nws)) + "°F";
    }
    const nowF = clock.now_f != null ? clock.now_f : m.now_f;
    if (nowF != null && isFinite(Number(nowF))) {
      head += " · NOW " + Math.round(Number(nowF)) + "°F";
    }
    return head;
  }
  function isAtsTable(which) {
    const w = String(which != null ? which : (typeof focusTable !== "undefined" ? focusTable : "")).toLowerCase();
    return w === "ats" || w === "ares" || w === "sports";
  }
  function frontTableState() {
    let board = null;
    try { board = frontBoard; } catch (e) { board = null; }
    const chair = (board && board.chair) || {};
    const seats = (board && Array.isArray(board.seats) && board.seats.length) ? board.seats : [
      { id: "GLASS", job: "NWS PANE", dir: "WAIT", call: "", n: 0, wr: null, rank: 1 },
      { id: "PIT", job: "THE PIT", dir: "WAIT", call: "", n: 0, wr: null, rank: 2 },
      { id: "FROST", job: "FROST KILL", dir: "WAIT", call: "", n: 0, wr: null, rank: 3 },
      { id: "BONE", job: "BONE CLIMO", dir: "WAIT", call: "", n: 0, wr: null, rank: 4 },
      { id: "MESH", job: "THE WEB", dir: "WAIT", call: "", n: 0, wr: null, rank: 5 },
    ];
    const acc = (board && (board.accuracy || board.chair_accuracy)) || {};
    const records = (board && board.seat_records) || seats;
    const fills = (board && board.fills) || [];
    const tape = (board && board.tape) || [];
    const best = ((board && board.brackets) || []).find(function (b) { return b && b.best; }) || {};
    const clock = frontClockOf(board);
    const strikeType = clock.strike_type || best.strike_type || "";
    const locked = fills.find(function (f) {
      const r = String((f && f.result) || "").toUpperCase();
      const side = String((f && f.side) || "").toUpperCase();
      return side !== "WAIT" && (r === "OPEN" || r === "PENDING" || (f && !f.settled && r !== "WAIT" && r !== "HIT" && r !== "MISS"));
    });
    const eye = String(chair.eye || "WAIT").toUpperCase();
    const chairLean = chair.lean || wxWord(eye === "UP" ? "YES" : (eye === "DOWN" ? "NO" : "WAIT"), strikeType, clock.nws_high, clock.floor_strike, clock.cap_strike);
    const agents = seats.filter(function (s) {
      return s && FRONT_SEAT_IDS.indexOf(String(s.id || "").toUpperCase()) >= 0;
    }).map(function (s) {
      const lean = wxWord(s.dir || s.vote, strikeType, clock.nws_high, clock.floor_strike, clock.cap_strike);
      return {
        agent_name: String(s.id || "").toLowerCase(),
        display_name: s.id,
        title: s.job || "",
        direction: lean,
        mark: s.mark || frontSeatMark(s.id),
        confidence: s.confidence != null ? s.confidence : 50,
        reasoning: s.call || "",
        summary: s.call || "",
      };
    });
    agents.unshift({
      agent_name: "leader",
      display_name: "RAIJIN",
      title: "DFW · Raijin",
      direction: chairLean,
      confidence: chair.confidence || 0,
      reasoning: chair.call || frontHighLine({ market: { clock: clock, strike_type: strikeType, floor_strike: clock.floor_strike, cap_strike: clock.cap_strike, kalshi_high: clock.kalshi_high, nws_high: clock.nws_high, bracket: clock.bracket || best.bracket } }),
      summary: chair.call || "",
    });
    const hierarchy = (records.length ? records : seats).map(function (r, i) {
      return {
        agent: String(r.id || "").toLowerCase(),
        display_name: r.id,
        correct: r.correct || 0,
        wrong: r.wrong || 0,
        n: r.n || 0,
        win_rate: r.wr,
        rank: r.rank || (i + 1),
        listen: 1,
        faded: !!r.faded,
        invert: !!r.invert,
        weight: r.weight,
      };
    });
    const log = (tape.length ? tape : fills).map(function (f) {
      const side = String(f.side || f.result || "WAIT").toUpperCase();
      return {
        direction: wxWord(f.lean || side, strikeType, clock.nws_high, clock.floor_strike, clock.cap_strike),
        outcome: f.result,
        y_finish: f.y_finish,
        correct: String(f.result || "").toUpperCase() === "HIT" ? true : (String(f.result || "").toUpperCase() === "MISS" ? false : null),
        confidence: f.confidence,
        ticker: f.ticker,
        called_at: f.at,
        settled_at: f.settled_at,
        paper_pnl: f.pnl,
        wait_reason: f.wait_reason,
      };
    });
    return {
      agents: agents,
      decision: {
        direction: chairLean,
        confidence: chair.confidence || 0,
        summary: frontHighLine({ market: { clock: clock, strike_type: strikeType, floor_strike: clock.floor_strike || best.floor_strike, cap_strike: clock.cap_strike || best.cap_strike, kalshi_high: clock.kalshi_high, nws_high: clock.nws_high, bracket: clock.bracket || best.bracket } }) + " · " + chairLean,
        locked_call: locked ? {
          locked: true,
          direction: wxWord(locked.lean || locked.side, strikeType, clock.nws_high, clock.floor_strike, clock.cap_strike),
          ticker: locked.ticker,
          confidence: locked.confidence,
        } : null,
      },
      accuracy: {
        correct: acc.correct || 0,
        total: acc.total || 0,
        wrong: acc.wrong || 0,
        accuracy_pct: acc.accuracy_pct,
        label: acc.label,
        wait_n: acc.wait_n || 0,
        wait_rate: acc.wait_rate,
        verdict: acc.verdict,
        verdict_note: acc.verdict_note,
        last_20: acc.last_20,
        last_50: acc.last_50,
        pending: acc.pending || 0,
        log: log,
        recent: log,
        open: fills.filter(function (f) { return !f.settled && String(f.result || "").toUpperCase() !== "HIT"; }),
      },
      hierarchy: hierarchy,
      locked_call: locked ? {
        locked: true,
        direction: wxWord(locked.lean || locked.side, strikeType, clock.nws_high, clock.floor_strike, clock.cap_strike),
        ticker: locked.ticker,
      } : null,
      market: {
        ticker: best.ticker || chair.ticker || clock.ticker,
        kalshi_ticker: best.ticker || chair.ticker || clock.ticker,
        series_ticker: "KXHIGHTDAL",
        strike_type: strikeType,
        floor_strike: clock.floor_strike != null ? clock.floor_strike : best.floor_strike,
        cap_strike: clock.cap_strike != null ? clock.cap_strike : best.cap_strike,
        bracket: clock.bracket || best.bracket,
        kalshi_high: clock.kalshi_high,
        nws_high: clock.nws_high,
        now_f: clock.now_f,
        temp_stale: clock.temp_stale,
        clock: clock,
        window_kind: clock.close_time ? "kalshi" : "cli",
        window_label: "DFW HIGH",
        kalshi_yes_bid: best.yes_bid,
        kalshi_yes_ask: best.yes_ask,
        up_pct: best.yes_ask,
        down_pct: best.yes_ask != null ? (100 - Number(best.yes_ask)) : null,
        seconds_left: clock.seconds_to_close != null ? clock.seconds_to_close : null,
        time_remaining: clock.seconds_to_close != null ? clock.seconds_to_close : null,
        mins_left: clock.mins_left,
        close_time: clock.close_time || best.close_time || null,
        cli_at: clock.cli_at || null,
        cli_span_s: clock.cli_span_s,
        stale: false,
      },
      leader_name: "RAIJIN",
      asset: "front",
      subs: frontSubsOf(board),
      learning: { hierarchy: hierarchy, records: hierarchy.reduce(function (m, r) { m[r.agent] = r; return m; }, {}) },
    };
  }
  function atsTableState() {
    let board = null;
    try { board = atsBoard; } catch (e) { board = null; }
    const chair = (board && board.chair) || {};
    const seats = (board && Array.isArray(board.seats) && board.seats.length) ? board.seats : [
      { id: "LINE", job: "The Kalshi book / the number.", dir: "WAIT", call: "THE NUMBER · —", n: 0 },
      { id: "STEAM", job: "Line movement.", dir: "WAIT", call: "STEAM IS QUIET", n: 0 },
      { id: "FADE", job: "Public vs sharp.", dir: "WAIT", call: "NO CROWD TO FADE", n: 0 },
      { id: "HURT", job: "Injuries / out.", dir: "WAIT", call: "HURT · SIT · DARK", n: 0 },
      { id: "ICE", job: "Veto.", dir: "WAIT", call: "ICE IS CLEAR", n: 0 },
    ];
    const subs = (board && Array.isArray(board.subs)) ? board.subs : [
      { id: "CLOCK", parent: "LINE", call: "CLOCK IS DARK" },
      { id: "FORM", parent: "FADE", call: "FORM · SIT · NO CARD" },
      { id: "WX", parent: "ICE", call: "WX · DARK" },
    ];
    const acc = (board && board.accuracy) || {};
    const tape = (board && board.tape) || [];
    const pick = (board && board.pick) || {};
    const clock = (board && board.clock) || {};
    const eye = String(chair.eye || "WAIT").toUpperCase();
    const agents = seats.map(function (s) {
      return {
        agent_name: String(s.id || "").toLowerCase(),
        display_name: s.id,
        title: s.job || "",
        direction: s.dir || "WAIT",
        confidence: s.confidence != null ? s.confidence : 50,
        reasoning: s.call || "",
        summary: s.call || "",
        mark: s.mark,
        sub: false,
      };
    });
    subs.forEach(function (s) {
      agents.push({
        agent_name: String(s.id || "").toLowerCase(),
        display_name: s.id,
        title: s.job || "",
        direction: "WAIT",
        confidence: 30,
        reasoning: s.call || "",
        summary: s.call || "",
        mark: s.mark,
        sub: true,
        parent: s.parent,
      });
    });
    agents.unshift({
      agent_name: "leader",
      display_name: "ARES",
      title: "ATS · Ares",
      direction: eye,
      confidence: chair.confidence || 0,
      reasoning: chair.call || "",
      summary: chair.call || "",
    });
    const hierarchy = seats.map(function (r, i) {
      return {
        agent: String(r.id || "").toLowerCase(),
        display_name: r.id,
        correct: r.correct || 0,
        wrong: r.wrong || 0,
        n: r.n || 0,
        win_rate: r.wr,
        rank: r.rank || (i + 1),
        listen: 1,
      };
    });
    const locked = !!(pick && pick.call && pick.call !== "WAIT" && !pick.ice);
    return {
      agents: agents,
      decision: {
        direction: eye,
        confidence: chair.confidence || 0,
        summary: chair.call || "WAIT · no game on the table",
        locked_call: locked ? {
          locked: true,
          direction: eye,
          ticker: pick.ticker,
          confidence: chair.confidence,
        } : null,
      },
      accuracy: {
        correct: acc.correct || 0,
        total: acc.total || 0,
        wrong: acc.wrong || 0,
        accuracy_pct: acc.accuracy_pct,
        label: acc.label || "ARES · ATS",
        wait_n: acc.wait_n || 0,
        verdict: acc.verdict,
        log: tape,
        recent: acc.recent || tape,
        pending: acc.pending || 0,
      },
      hierarchy: hierarchy,
      locked_call: locked ? { locked: true, direction: eye, ticker: pick.ticker } : null,
      market: {
        ticker: pick.ticker,
        kalshi_ticker: pick.ticker,
        series_ticker: pick.sport,
        close_time: pick.close_time || (clock && clock.close_time),
        clock: clock,
        window_kind: "game",
        window_label: "KICK",
        seconds_left: clock.seconds_to_kick,
        time_remaining: clock.seconds_to_kick,
        game: pick.game || clock.game,
        number: pick.number || clock.number,
        title: pick.title || clock.title,
        stale: false,
      },
      leader_name: "ARES",
      asset: "ats",
      pick: pick,
      eyes: (chair && chair.eyes) || pick.eyes,
      watch: (chair && chair.watch) || pick.watch || (board && board.watch),
      why: (chair && chair.why) || pick.why || (board && board.why),
      tug: (chair && chair.tug) || pick.tug || (board && board.tug),
      brains: (chair && chair.brains) || pick.brains || (board && board.brains),
      learning: { hierarchy: hierarchy },
    };
  }
  function oracleTableState() {
    return {
      agents: [{
        agent_name: "leader",
        display_name: "ORACLE",
        title: "CRT · Oracle",
        direction: "WAIT",
        confidence: 0,
        reasoning: "ORACLE does not place orders.",
        summary: "WATCH · no ticket",
      }],
      decision: { direction: "WAIT", confidence: 0, summary: "ORACLE does not place orders." },
      locked_call: null,
      market: { window_kind: "watch", window_label: "WATCH", seconds_left: null, time_remaining: null },
      leader_name: "ORACLE",
      asset: "oracle",
      accuracy: { correct: 0, total: 0, wrong: 0, label: "ORACLE · WATCH" },
      hierarchy: [],
    };
  }
  function tableState(which) {
    if (isOracleTable(which)) return oracleTableState();
    if (isAtsTable(which)) return atsTableState();
    if (isFrontTable(which)) return frontTableState();
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
    if (isFrontTable(focusTable)) {
      const focused = tableState("front") || frontTableState();
      return Object.assign({}, state, {
        decision: focused.decision || {},
        locked_call: focused.locked_call || null,
        agents: Array.isArray(focused.agents) ? focused.agents : [],
        market: focused.market || {},
        accuracy: focused.accuracy || {},
        hierarchy: focused.hierarchy || [],
        learning: focused.learning || {},
        weights: focused.weights || {},
        _focusTable: "front",
      });
    }
    if (isAtsTable(focusTable)) {
      const focused = tableState("ats") || atsTableState();
      return Object.assign({}, state, {
        decision: focused.decision || {},
        locked_call: focused.locked_call || null,
        agents: Array.isArray(focused.agents) ? focused.agents : [],
        market: focused.market || {},
        accuracy: focused.accuracy || {},
        hierarchy: focused.hierarchy || [],
        learning: focused.learning || {},
        weights: focused.weights || {},
        pick: focused.pick || {},
        watch: focused.watch || {},
        why: focused.why || {},
        _focusTable: "ats",
      });
    }
    if (typeof isOracleTable === "function" && isOracleTable(focusTable)) {
      const focused = tableState("oracle") || oracleTableState();
      return Object.assign({}, state, {
        decision: focused.decision || {},
        locked_call: focused.locked_call || null,
        agents: Array.isArray(focused.agents) ? focused.agents : [],
        market: focused.market || {},
        accuracy: focused.accuracy || {},
        hierarchy: focused.hierarchy || [],
        learning: focused.learning || {},
        weights: focused.weights || {},
        _focusTable: "oracle",
      });
    }
    const focused = tableState(focusTable);
    const other = (isFrontTable(focusTable) || isAtsTable(focusTable))
      ? tableState("ethereum")
      : tableState(focusTable === "bitcoin" ? "ethereum" : "bitcoin");
    // Prefer the focused table when it has seats/window. Otherwise use the
    // payload that actually has a live hour (root BTC back-compat, then sibling).
    const live = tableHasLiveHour(focused)
      ? focused
      : (tableHasLiveHour(state) ? state
        : (tableHasLiveHour(other) ? other : focused));
    if (!live) {
      return Object.assign({}, state, { _focusTable: focusTable });
    }
    const lc = live.locked_call || (live.decision && live.decision.locked_call) || null;
    return Object.assign({}, state, {
      decision: live.decision || state.decision || {},
      locked_call: lc || state.locked_call || null,
      agents: Array.isArray(live.agents) ? live.agents : (state.agents || []),
      market: live.market || state.market || {},
      accuracy: live.accuracy || state.accuracy || {},
      hierarchy: live.hierarchy || state.hierarchy || [],
      learning: live.learning || state.learning || {},
      weights: live.weights || (live.learning && live.learning.weights) || state.weights || {},
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
      focus: isAtsTable(focusTable) ? "ats" : (isFrontTable(focusTable) ? "front" : (focusTable === "bitcoin" ? "btc" : "eth")),
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
  const SEAT_ORBIT_SPEED = 0.00007; // half of the old 0.00014 fidget spin
  const SEAT_SPIN_KEY = "council_seat_spin";
  let seatOrbitFrozen = false;
  let seatOrbitHold = 0;
  let seatOrbitLastT = 0;
  try {
    seatOrbitFrozen = localStorage.getItem(SEAT_SPIN_KEY) === "0";
  } catch (e) {}
  function seatOrbitAngle() {
    // Screensaver pace. Freeze keeps the last angle so unfreeze does not jump.
    if (reduceMotion) return 0;
    if (!seatOrbitLastT) seatOrbitLastT = time;
    if (!seatOrbitFrozen) {
      const dt = Math.max(0, time - seatOrbitLastT);
      seatOrbitHold += dt * SEAT_ORBIT_SPEED;
    }
    seatOrbitLastT = time;
    return seatOrbitHold;
  }
  function floorLikeMode() {
    return mode === "floor" || mode === "night";
  }
  function floorSeatDirLocked(dir) {
    const d = String(dir || "").toUpperCase();
    if (!d || d === "WAIT" || d === "SIT" || d === "—" || d === "-" || d === "EMPTY") return false;
    return d === "UP" || d === "DOWN" || d === "UP_HOLD" || d === "DOWN_HOLD";
  }
  function floorCryptoTable(which) {
    const w = String(which || "").toLowerCase();
    return w === "bitcoin" || w === "btc" || w === "ethereum" || w === "eth";
  }
  function floorLockedAgents(agents) {
    return (agents || []).filter(function (a) {
      if (!a || !a.agent_name || a.agent_name === "leader" || a.sub) return false;
      return floorSeatDirLocked(a.direction);
    });
  }
  function floorLockedSeatLabels(side) {
    try {
      if (typeof floorLikeMode === "function" && !floorLikeMode()) return null;
      if (side && !floorCryptoTable(side)) return null;
      const key = (side === "eth" || side === "ethereum") ? "ethereum" : "bitcoin";
      const st = (typeof tableState === "function" ? tableState(key) : null) || {};
      return floorLockedAgents(st.agents || []).map(function (a) {
        return (typeof labelOf === "function" ? labelOf(a) : (a.display_name || a.agent_name || "")).toString();
      }).filter(Boolean);
    } catch (e) {
      return null;
    }
  }
  const ATTRACT_IDLE_MS = 24000;
  let _attractLastAct = 0;
  let _attractEntered = false;
  let _attractWired = false;
  function noteDeskActivity() {
    _attractLastAct = Date.now();
    _attractEntered = false;
    try { document.body.classList.remove("floor-attract"); } catch (e) {}
  }
  function attractEnterBlocked() {
    // Cabinet attract. Never steal Settings / Follower / gates / cinematics.
    // Seat Storm still never auto-starts. Never auto-bet.
    if (reduceMotion) return true;
    if (typeof hasDeskAuth === "function" && !hasDeskAuth()) return true;
    if (document.body.classList.contains("gate-locked")) return true;
    if (document.body.classList.contains("gate-revealing")) return true;
    if (mode === "settings" || mode === "follower" || mode === "night") return true;
    if (typeof deskCinematicOn === "function" && deskCinematicOn()) return true;
    if (document.body.classList.contains("leader-clip-on")) return true;
    if (typeof isSeatStormPlaying === "function" && isSeatStormPlaying()) return true;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return true;
    const blockedIds = ["adminGate", "passwordGate", "summonGate", "coachOverlay", "fgGate"];
    for (let i = 0; i < blockedIds.length; i++) {
      const el = document.getElementById(blockedIds[i]);
      if (el && !el.classList.contains("hidden") && !el.hidden) return true;
    }
    return false;
  }
  function maybeAttractEnter() {
    // Cabinet attract: idle auto-enter Floor. Not a packed WAIT roster.
    if (document.hidden) return;
    if (attractEnterBlocked()) return;
    if (mode === "floor") return;
    if (!_attractLastAct) _attractLastAct = Date.now();
    if (Date.now() - _attractLastAct < ATTRACT_IDLE_MS) return;
    _attractEntered = true;
    try { setMode("floor"); } catch (e) {}
    try { document.body.classList.add("floor-attract"); } catch (e) {}
  }
  function wireAttractIdle() {
    if (_attractWired) return;
    _attractWired = true;
    _attractLastAct = Date.now();
    const bump = function () { try { noteDeskActivity(); } catch (e) {} };
    document.addEventListener("pointerdown", bump, { passive: true });
    document.addEventListener("keydown", bump, { passive: true });
    document.addEventListener("touchstart", bump, { passive: true });
    document.addEventListener("wheel", bump, { passive: true });
  }
  function floorCameraOffset() {
    // Slow room drift. No extra haze, particles, or purple.
    if (reduceMotion || !floorLikeMode()) return { x: 0, y: 0 };
    const t = (typeof time === "number" ? time : 0) * 0.00007;
    const amp = _attractEntered ? 1.2 : 1;
    return { x: Math.sin(t) * 26 * amp, y: Math.cos(t * 0.71) * 16 * amp };
  }
  function chairBreatheScale(which, locked) {
    if (reduceMotion) return 1;
    const phase = which === "ethereum" ? 1.15 : (which === "front" ? 0.4 : (which === "ats" ? 0.85 : 0.2));
    const amt = locked ? 0.018 : 0.06;
    return 1 + amt * Math.sin((typeof time === "number" ? time : 0) * 0.0038 + phase);
  }
  function drawFloorAttractGlow(cx, cy, r, which) {
    // WAIT Floor attract: motion/glow, not extra bots or seat nodes.
    if (!ctx || !r || reduceMotion || !floorLikeMode()) return;
    const clock = (typeof time === "number" ? time : 0);
    const pulse = 0.55 + 0.45 * Math.sin(clock * 0.0021 + (which === "ethereum" ? 1.1 : 0.2));
    const hue = which === "ethereum" ? "rgba(120, 255, 160, 0.55)" : "rgba(0, 220, 255, 0.62)";
    ctx.save();
    ctx.strokeStyle = hue;
    ctx.globalAlpha = 0.16 + 0.18 * pulse;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = hue;
    ctx.shadowBlur = 10 + 8 * pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.08 + 0.03 * pulse), 0, Math.PI * 2);
    ctx.stroke();
    const n = 8;
    const orbit = clock * 0.00012;
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.22 + 0.12 * pulse;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = orbit + (i / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const r0 = r * 1.22;
      const r1 = r * (i % 2 === 0 ? 1.34 : 1.28);
      ctx.moveTo(cx + c * r0, cy + s * r0);
      ctx.lineTo(cx + c * r1, cy + s * r1);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Chair rooms + hour weather sit UNDER majority wisps. Same table, different world.
  // No weather API — range / VOLT / book spread / time-left chop already on the desk.
  const _hourWx = { level: 0, mode: "calm", motion: 1, range: 0, volt: 0, book: 0, chop: 0 };
  function chairRoomOf(which) {
    const key = (typeof chairKeyOf === "function") ? chairKeyOf(which) : String(which || "").toLowerCase();
    if (key === "ats") return "ares";
    if (key === "ethereum") return "vitalik";
    if (key === "front") return "";
    if (key === "oracle") return "";
    return "satoshi";
  }
  function chairLockIsReal(lc) {
    if (!lc || !lc.locked) return false;
    const side = String(lc.direction || "").toUpperCase();
    if (!side || side === "WAIT" || side === "SIT" || side === "HOLD" || side === "EMPTY") return false;
    return true;
  }
  function lockStampWord(dir, which) {
    const d = String(dir || "").toUpperCase();
    if (!d || d === "WAIT" || d === "SIT" || d === "HOLD") return "";
    if (typeof isAtsTable === "function" && isAtsTable(which)) {
      try {
        const pick = ((typeof tableState === "function" ? tableState("ats") : null) || {}).pick || {};
        const game = String(pick.game || pick.title || "").trim();
        const num = String(pick.number || pick.call || "").trim();
        const ticket = (game + (num ? (" " + num) : "")).trim();
        if (ticket) return ticket.slice(0, 22);
      } catch (e) {}
      return d === "UP" || d === "DOWN" ? d : d.slice(0, 12);
    }
    if (d === "UP" || d === "UP_HOLD" || d === "YES" || d === "COVER" || d === "OVER" || d === "HOME") return "UP";
    if (d === "DOWN" || d === "DOWN_HOLD" || d === "NO" || d === "NO-COVER" || d === "UNDER" || d === "AWAY") return "DOWN";
    if (d === "ABOVE" || d === "BELOW" || d === "BETWEEN") return d;
    return d.slice(0, 10);
  }
  function hourWeatherOf(st) {
    // Tie storm / still to the hour we already have. Not a fake wash.
    st = st || {};
    const m = st.market || {};
    const agents = st.agents || [];
    let rangeScore = 0;
    const candles = m.candles || [];
    if (candles.length >= 2) {
      let hi = -Infinity, lo = Infinity, last = 0;
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const h = Number(c.h != null ? c.h : c.high);
        const l = Number(c.l != null ? c.l : c.low);
        const cl = Number(c.c != null ? c.c : c.close);
        if (Number.isFinite(h)) hi = Math.max(hi, h);
        if (Number.isFinite(l)) lo = Math.min(lo, l);
        if (Number.isFinite(cl)) last = cl;
      }
      if (last > 0 && hi > lo) rangeScore = Math.min(1, ((hi - lo) / last) / 0.012);
    }
    let voltScore = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a || a.agent_name !== "volatility") continue;
      const d = String(a.direction || "").toUpperCase();
      const c = Number(a.confidence) || 0;
      if (d && d !== "WAIT" && d !== "SIT") voltScore = Math.min(1, c / 100);
      break;
    }
    const yb = Number(m.kalshi_yes_bid != null ? m.kalshi_yes_bid : m.up_pct);
    const ya = Number(m.kalshi_yes_ask);
    let bookScore = 0;
    if (Number.isFinite(yb) && Number.isFinite(ya)) bookScore = Math.min(1, Math.abs(ya - yb) / 8);
    if ((Number.isFinite(yb) && yb >= 99) || (Number.isFinite(ya) && ya >= 99)) bookScore = Math.max(bookScore, 0.55);
    let chopScore = 0;
    const secs = (typeof secondsLeftOf === "function") ? secondsLeftOf(m) : null;
    if (secs != null && secs < 720) {
      chopScore = (1 - secs / 720) * Math.max(rangeScore, voltScore, 0.25);
    }
    if (m.window_kind === "game" && secs != null && secs < 3600) {
      chopScore = Math.max(chopScore, (1 - Math.max(0, secs) / 3600) * 0.7);
    }
    const level = Math.max(0, Math.min(1, rangeScore * 0.38 + voltScore * 0.28 + bookScore * 0.18 + chopScore * 0.16));
    const modeWx = level >= 0.62 ? "wild" : (level <= 0.22 ? "dead" : "calm");
    _hourWx.level = level;
    _hourWx.mode = modeWx;
    _hourWx.motion = modeWx === "wild" ? 1.85 : (modeWx === "dead" ? 0.18 : 1);
    _hourWx.range = rangeScore;
    _hourWx.volt = voltScore;
    _hourWx.book = bookScore;
    _hourWx.chop = chopScore;
    return _hourWx;
  }
  function syncChairRoom(which, st) {
    const room = chairRoomOf(which != null ? which : (typeof focusTable !== "undefined" ? focusTable : "bitcoin"));
    const wx = hourWeatherOf(st || (typeof tableState === "function" ? tableState(which || focusTable) : null) || (typeof state !== "undefined" ? state : {}) || {});
    try {
      document.body.dataset.chairRoom = room || "";
      document.body.dataset.hourWeather = wx.mode;
      document.documentElement.style.setProperty("--hour-weather", String(wx.level));
    } catch (e) {}
    return { room: room, wx: wx };
  }
  function seatMoodOf(dir, conf) {
    const locked = (typeof floorSeatDirLocked === "function") ? floorSeatDirLocked(dir) : false;
    const c = Number(conf) || 0;
    if (!locked) return { glow: 0.14, lean: 0.84, alpha: 0.40, loud: false };
    const loud = c >= 62;
    return { glow: loud ? 1 : 0.55, lean: loud ? 1.08 : 0.96, alpha: loud ? 1 : 0.78, loud: loud };
  }
  function drawChairRoom(w, h, which, weather, cx, cy, tableR) {
    // Room wash UNDER wisps. Cheap CSS/canvas. Phone: wash only, no extra strokes.
    if (!ctx || !w || !h) return;
    const room = chairRoomOf(which);
    if (!room) return;
    const wx = weather || _hourWx;
    const storm = wx.mode === "wild" ? 1 : (wx.mode === "dead" ? 0.22 : 0.55);
    const phone = (typeof isPhoneDesk === "function") && isPhoneDesk();
    const clock = (typeof time === "number" ? time : 0);
    ctx.save();
    let clipX = 0, clipY = 0, clipW = w, clipH = h;
    if (cx != null && cy != null && tableR) {
      clipX = cx - tableR * 1.85;
      clipY = cy - tableR * 1.85;
      clipW = tableR * 3.7;
      clipH = tableR * 3.7;
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ctx.clip();
    }
    let c0, c1, c2;
    if (room === "vitalik") {
      c0 = "rgba(40, 210, 190," + (0.10 + 0.10 * storm) + ")";
      c1 = "rgba(8, 36, 42," + (0.42 + 0.10 * storm) + ")";
      c2 = "rgba(2, 10, 14, 0.55)";
    } else if (room === "ares") {
      c0 = "rgba(255, 224, 140," + (0.08 + 0.10 * storm) + ")";
      c1 = "rgba(8, 14, 28," + (0.50 + 0.08 * storm) + ")";
      c2 = "rgba(1, 4, 10, 0.62)";
    } else {
      c0 = "rgba(240, 176, 64," + (0.12 + 0.12 * storm) + ")";
      c1 = "rgba(36, 20, 6," + (0.48 + 0.10 * storm) + ")";
      c2 = "rgba(6, 3, 2, 0.58)";
    }
    const gx = (cx != null) ? cx : w * 0.50;
    const gy = (cy != null) ? (cy - (tableR || h * 0.2) * 0.35) : h * 0.18;
    const g = ctx.createRadialGradient(gx, gy, 8, gx, gy, Math.max(w, h) * 0.72);
    g.addColorStop(0, c0);
    g.addColorStop(0.42, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(clipX, clipY, clipW, clipH);
    if (phone || reduceMotion || (cx != null && tableR)) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = 0.10 + 0.10 * storm;
    if (room === "satoshi") {
      ctx.strokeStyle = "rgba(240, 186, 74, 0.55)";
      ctx.lineWidth = 1;
      const sway = Math.sin(clock * 0.0004 * (wx.motion || 1)) * 4 * storm;
      for (let i = 0; i < 3; i++) {
        const y = h * (0.22 + i * 0.18) + sway;
        ctx.beginPath();
        ctx.moveTo(w * 0.08, y);
        ctx.lineTo(w * 0.92, y);
        ctx.stroke();
      }
    } else if (room === "vitalik") {
      ctx.strokeStyle = "rgba(120, 255, 220, 0.40)";
      ctx.lineWidth = 1.2;
      const tilt = 0.08 * Math.sin(clock * 0.0003 * (wx.motion || 1));
      ctx.beginPath();
      ctx.moveTo(w * (0.18 + tilt), h * 0.08);
      ctx.lineTo(w * (0.18 + tilt), h * 0.92);
      ctx.moveTo(w * (0.82 - tilt), h * 0.08);
      ctx.lineTo(w * (0.82 - tilt), h * 0.92);
      ctx.stroke();
    } else if (room === "ares") {
      ctx.fillStyle = "rgba(255, 230, 160," + (0.05 + 0.07 * storm) + ")";
      const flick = 0.85 + 0.15 * Math.sin(clock * 0.002 * (wx.motion || 1));
      ctx.globalAlpha = (0.16 + 0.18 * storm) * flick;
      ctx.beginPath();
      ctx.moveTo(w * 0.08, 0);
      ctx.lineTo(w * 0.28, h);
      ctx.lineTo(w * 0.02, h);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w * 0.92, 0);
      ctx.lineTo(w * 0.72, h);
      ctx.lineTo(w * 0.98, h);
      ctx.closePath();
      ctx.fill();
      try { drawAresScorebug(w, h, storm); } catch (e) {}
    }
    ctx.restore();
  }
  function drawAresScorebug(w, h, storm) {
    // Part of the Ares room. Reuses sport chip + atsKickLine. Not a fourth tab.
    if (!ctx) return;
    const phone = (typeof isPhoneDesk === "function") && isPhoneDesk();
    if (phone) return;
    const ts = (typeof tableState === "function" ? tableState("ats") : null) || {};
    const pick = ts.pick || {};
    const clock = (ts.market && ts.market.clock) || ts.clock || {};
    const sport = String(pick.sport || clock.sport || "").trim().toUpperCase() || "ATS";
    const game = String(pick.game || clock.game || "NO GAME").slice(0, 18);
    const line = (typeof atsKickLine === "function")
      ? atsKickLine(pick.close_time || clock.close_time, pick.mins_left != null ? pick.mins_left : clock.mins_left)
      : "CLOCK IS DARK";
    const bw = Math.min(w * 0.62, 420);
    const bh = 28;
    const x = (w - bw) / 2;
    const y = Math.max(10, h * 0.035);
    ctx.save();
    ctx.globalAlpha = 0.82 + 0.10 * (storm || 0);
    ctx.fillStyle = "rgba(4, 10, 18, 0.78)";
    ctx.strokeStyle = "rgba(240, 193, 74, 0.70)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 4);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.font = "700 10px Orbitron, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffe27a";
    ctx.fillText(sport, x + 10, y + bh / 2);
    ctx.fillStyle = "#e8f4ff";
    ctx.fillText(game, x + 58, y + bh / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#7fe9ff";
    ctx.fillText(line, x + bw - 10, y + bh / 2);
    ctx.restore();
  }
  function syncSeatSpinBtn() {
    const btn = document.getElementById("seatSpinBtn");
    if (!btn) return;
    const on = (mode === "floor" || mode === "art") && mode !== "night";
    btn.hidden = !on;
    btn.setAttribute("aria-hidden", on ? "false" : "true");
    const spinning = !seatOrbitFrozen && !reduceMotion;
    btn.textContent = spinning ? "SPIN" : "STILL";
    btn.setAttribute("aria-pressed", spinning ? "true" : "false");
    btn.title = spinning ? "Freeze seat orbit" : "Resume seat orbit";
    btn.setAttribute("aria-label", spinning ? "Seat orbit on — click to freeze" : "Seat orbit still — click to spin");
  }
  function setSeatSpin(on) {
    seatOrbitFrozen = !on;
    try { localStorage.setItem(SEAT_SPIN_KEY, on ? "1" : "0"); } catch (e) {}
    try { syncSeatSpinBtn(); } catch (e) {}
  }
  window.setSeatSpin = setSeatSpin;
  window.seatOrbitAngle = seatOrbitAngle;
  let _tableEmberUntil = 0;
  let _tableEmberKey = "";
  let _tableEmberDir = "WAIT";
  // Parked lock flash — expanding ring on lock. Wired by noteChairLock.
  const sealFX = {
    bitcoin: { until: 0, dir: "WAIT" },
    ethereum: { until: 0, dir: "WAIT" },
    ats: { until: 0, dir: "WAIT" },
    front: { until: 0, dir: "WAIT" },
  };
  const _sealSeen = { bitcoin: "", ethereum: "", ats: "", front: "" };

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
    if (typeof isFrontTable === "function" && isFrontTable(focusTable)) return;
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
        try { beginHourCloseThenSlam(); } catch (e) { try { triggerHourSlam(); } catch (e2) {} }
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
      try { beginHourCloseThenSlam(); } catch (e) { try { triggerHourSlam(); } catch (e2) {} }
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
    leader: "CHAIR",
    chair: "CHAIR",
    line: "LINE",
    steam: "STEAM",
    fade: "FADE",
    hurt: "HURT",
    ice: "ICE",
    clock: "CLOCK",
    form: "FORM",
    wx: "WX",
    glass: "GLASS",
    pit: "PIT",
    frost: "FROST",
    bone: "BONE",
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
    chair: "The Gavel",
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

  function isEthTable(which) {
    const w = String(which != null ? which : (typeof focusTable !== "undefined" ? focusTable : "")).toLowerCase();
    return w === "ethereum" || w === "eth" || w === "vitalik";
  }
  function chairNameOf(which) {
    if (isOracleTable(which)) return "ORACLE";
    if (isAtsTable(which)) return "ARES";
    if (isFrontTable(which)) return "RAIJIN";
    return isEthTable(which) ? "VITALIK" : "SATOSHI";
  }
  function chairTitleOf(which) {
    if (isOracleTable(which)) return "CRT · Oracle";
    if (isAtsTable(which)) return "ATS · Ares";
    if (isFrontTable(which)) return "DFW · Raijin";
    return isEthTable(which) ? "ETH · Vitalik" : "BTC · Satoshi";
  }
  function chairBadgeOf(which) {
    if (isOracleTable(which)) return "CRT · ORACLE";
    if (isAtsTable(which)) return "ATS · ARES";
    if (isFrontTable(which)) return "DFW · RAIJIN";
    return isEthTable(which) ? "ETH · VITALIK" : "BTC · SATOSHI";
  }
  function chairPortraitOf(which, dir) {
    if (isOracleTable(which)) return oraclePortrait;
    if (isAtsTable(which)) return aresPortrait;
    if (isFrontTable(which)) return raijinPortraitFor(wxEye(dir));
    return isEthTable(which) ? vitalikPortraitFor(dir) : chairPortraitFor(dir);
  }

  function labelOf(agent) {
    if (!agent) return "—";
    const key = agent.agent_name || agent;
    if (key === "leader" || key === "chair") return chairNameOf(focusTable);
    if (agent.display_name) return agent.display_name;
    if (AGENT_LABELS[key]) return AGENT_LABELS[key];
    if (typeof key === "string" && key.includes(".")) {
      const sid = key.split(".")[1];
      return SUB_LABELS[sid] || sid.toUpperCase();
    }
    return String(key).toUpperCase();
  }

  function titleOf(agent) {
    if (!agent) return "";
    const key = agent.agent_name || agent;
    if (key === "leader" || key === "chair") return isAtsTable(focusTable) ? "Ares" : (isFrontTable(focusTable) ? "Raijin" : (isEthTable(focusTable) ? "Vitalik" : "Satoshi"));
    if (agent.title) return agent.title;
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
    if (typeof isFrontTable === "function" && isFrontTable(focusTable)) {
      const m = (typeof tableState === "function" ? tableState("front") : null) || {};
      const clock = (m.market && m.market.clock) || {};
      return wxWord(dir, clock.strike_type || (m.market && m.market.strike_type), clock.nws_high, clock.floor_strike, clock.cap_strike);
    }
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
    line: "/static/bots/line.png",
    steam: "/static/bots/steam.png",
    fade: "/static/bots/fade.png",
    hurt: "/static/bots/hurt.png",
    ice: "/static/bots/ice.png",
    glass: "/static/bots/glass.png",
    pit: "/static/bots/pit.png",
    frost: "/static/bots/frost.png",
    bone: "/static/bots/bone.png",
    mesh: "/static/bots/mesh.png",
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
    const img = botIconCache[String(name || "").toLowerCase()] || botIconCache[name];
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
    dir = wxTone(dir);
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
    dir = wxTone(dir);
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

  let closeRecapTimer = 0;
  let closeRecapOn = false;

  function lastHourPrint(tableKey) {
    const pair = tableKey === "ethereum" ? "ETH" : "BTC";
    const ts = (typeof tableState === "function" ? tableState(tableKey) : null) || {};
    const acc = ts.accuracy || {};
    const open = Array.isArray(acc.open) && acc.open.length ? acc.open[0] : null;
    const log = (acc.log || acc.recent || [])[0] || null;
    const lc = (typeof pairLock === "function") ? pairLock(ts) : null;
    const row = open || lc || log;
    const lean = (typeof tableLean === "function") ? tableLean(ts) : { side: "WAIT", locked: false };
    if (!row) {
      return { pair: pair, side: lean.side || "WAIT", result: lean.locked ? "OPEN" : (lean.side === "WAIT" ? "WAIT" : "OPEN"), pnl: null };
    }
    const y = String(row.y_finish || "").toUpperCase();
    const reason = String(row.settle_reason || "");
    const official = (y === "UP" || y === "DOWN") && (reason === "finish_match" || reason === "finish_miss");
    const side = (typeof sideFromLockRow === "function") ? sideFromLockRow(row) : (row.direction || lean.side || "WAIT");
    if (!official) {
      return { pair: pair, side: side || "WAIT", result: "OPEN", pnl: null };
    }
    const hit = row.correct === true || row.correct === 1;
    return {
      pair: pair,
      side: side || "WAIT",
      result: hit ? "HIT" : "MISS",
      pnl: row.paper_pnl != null ? Number(row.paper_pnl) : (row.pnl != null ? Number(row.pnl) : null),
    };
  }

  function formatCloseLine(chair, print) {
    const side = print.side || "WAIT";
    const res = print.result || "OPEN";
    let paid = "OPEN";
    if (res === "WAIT") paid = "WAIT";
    else if (res === "OPEN") paid = "OPEN";
    else if (print.pnl != null && isFinite(print.pnl)) {
      paid = (print.pnl >= 0 ? "+$" : "-$") + Math.abs(print.pnl).toFixed(2);
    } else {
      paid = res;
    }
    return chair + " · " + (print.pair || "") + " " + side + " · " + paid;
  }

  function fillCloseRecap() {
    const sat = document.getElementById("closeSatoshi");
    const vit = document.getElementById("closeVitalik");
    const books = document.getElementById("closeBooks");
    const b = lastHourPrint("bitcoin");
    const e = lastHourPrint("ethereum");
    if (sat) sat.textContent = formatCloseLine("SATOSHI", b);
    if (vit) vit.textContent = formatCloseLine("VITALIK", e);
    const sc = (typeof scorecardFromState === "function") ? scorecardFromState() : {};
    if (books) books.textContent = "BOOKS · " + (sc.match || "BTC 0 · ETH 0");
  }

  function hideCloseRecap() {
    closeRecapOn = false;
    if (closeRecapTimer) {
      try { clearTimeout(closeRecapTimer); } catch (e) {}
      closeRecapTimer = 0;
    }
    const el = document.getElementById("closeRecap");
    if (el) {
      el.classList.add("hidden");
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("close-recap-on");
  }

  function finishHourClose() {
    hideCloseRecap();
    try { triggerHourSlam(); } catch (e) {}
  }

  function dismissCloseRecap() {
    if (!closeRecapOn) return false;
    finishHourClose();
    return true;
  }
  window.__dismissCloseRecap = dismissCloseRecap;

  function beginHourCloseThenSlam() {
    const onFloor = (typeof floorLikeMode === "function") ? floorLikeMode() : (mode === "floor");
    if (!onFloor) {
      try { triggerHourSlam(); } catch (e) {}
      return;
    }
    fillCloseRecap();
    closeRecapOn = true;
    const el = document.getElementById("closeRecap");
    if (el) {
      el.classList.remove("hidden");
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("close-recap-on");
    if (closeRecapTimer) {
      try { clearTimeout(closeRecapTimer); } catch (e) {}
    }
    closeRecapTimer = setTimeout(finishHourClose, 8000);
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
      if (m.window_kind === "cli" || m.window_kind === "kalshi" || m.window_kind === "game"
          || m.series_ticker === "KXHIGHTDAL"
          || /KX(NFL|NCAAF|NBA|MLB|NHL)/i.test(String(m.series_ticker || m.ticker || ""))) {
        return null;
      }
      const bucket = 3600;
      secs = bucket - ((Date.now() / 1000) % bucket);
    }
    return Math.max(0, Number(secs));
  }

  function hourFillFrac(m) {
    const secs = secondsLeftOf(m);
    if (secs == null) return 0.5;
    if (m && (m.window_kind === "cli" || m.series_ticker === "KXHIGHTDAL")) {
      const span = Number(m.cli_span_s) || (31 * 3600);
      return 1 - Math.max(0, Math.min(1, secs / span));
    }
    return 1 - Math.max(0, Math.min(1, secs / 3600));
  }

  function majorityDirOf(agents) {
    let up = 0, down = 0, wait = 0;
    (agents || []).forEach((a) => {
      if (!a || a.agent_name === "leader") return;
      const d = wxTone(a.direction);
      if (d === "UP") up++;
      else if (d === "DOWN") down++;
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

  function drawTableSmoke(cx, cy, tableR, dir, weather) {
    if (!ctx || !tableR) return;
    const tone = smokeTone(dir);
    const wisps = ensureTableWisps();
    const motion = (weather && weather.motion != null) ? weather.motion : (_hourWx.motion || 1);
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
      const ang = w.a0 + time * w.drift * motion;
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
      try { bumpChairPulse(pulseKeyFromTick(k), 0.55); } catch (e) {}
      return true;
    }
    return (Date.now() - prev.at) < 2200;
  }

  function drawPacketSpoke(x0, y0, x1, y1, color, conf, agree, fresh, which) {
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
    const clock = chairPulseTime(which);
    ctx.globalAlpha = fast ? 0.82 : 0.55;
    ctx.lineWidth = agree ? 2.3 : 1.45;
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -((clock * speed * dist) % (dash + gap));
    ctx.shadowColor = color;
    ctx.shadowBlur = fast ? 16 : 8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    const phoneCheap = (typeof isPhoneDesk === "function") && isPhoneDesk();
    if (phoneCheap) {
      // Phone: one rate per chair, no per-segment sparkle
      ctx.restore();
      return;
    }
    const n = fast ? 3 : 2;
    const nx = dx / dist, ny = dy / dist;
    for (let i = 0; i < n; i++) {
      const t = ((clock * speed * 0.62) + i / n) % 1;
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
    const mood = seatMoodOf(dir, conf);
    const breathe = reduceMotion ? 1 : (1 + 0.08 * Math.sin(time * 0.0042 + (phase || 0)));
    const rr = r * breathe * mood.lean;
    const sc = strongColor(dir);
    ctx.save();
    ctx.globalAlpha = mood.alpha;
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
    ctx.shadowBlur = mood.loud ? 22 : (8 + 10 * mood.glow);
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
    const match = "BTC " + btc.c + " · ETH " + ethC;
    let line = "Even books. Waiting on the next finish.";
    let ahead = "tied";
    if (btc.c > ethC) {
      ahead = "btc";
      line = "BTC book ahead on finishes.";
    } else if (ethC > btc.c) {
      ahead = "eth";
      line = "ETH book ahead on finishes.";
    } else if ((btc.c + btc.w + ethC + ethW) > 0 && btc.w < ethW) {
      line = "Even finishes. BTC book has fewer misses.";
    } else if ((btc.c + btc.w + ethC + ethW) > 0 && ethW < btc.w) {
      line = "Even finishes. ETH book has fewer misses.";
    }
    const frontAcc = ((typeof tableState === "function" ? tableState("front") : null) || {}).accuracy || {};
    const fr = accRecord(frontAcc);
    return {
      paper: true,
      kind: "books",
      ahead: ahead,
      match: match,
      line: line,
      btc_text: "BTC " + btc.c + "–" + btc.w,
      eth_text: ethC + "–" + ethW + " ETH",
      front_text: "DFW " + fr.c + "–" + fr.w,
      ats_text: (function () {
        const acc = ((typeof tableState === "function" ? tableState("ats") : null) || {}).accuracy || {};
        return "ATS " + (acc.correct || 0) + "–" + (acc.wrong || 0);
      })(),
    };
  }

  function updateRivalryStrip() {
    const strip = document.getElementById("rivalryStrip");
    if (!strip) return;
    const onFloor = mode === "floor";
    strip.hidden = !onFloor;
    if (!onFloor) return;
    const sc = scorecardFromState();
    const btcEl = document.getElementById("rivalBtc");
    const ethEl = document.getElementById("rivalEth");
    const lead = document.getElementById("rivalLead");
    const trash = document.getElementById("rivalTrash");
    if (btcEl) btcEl.textContent = sc.btc_text || "BTC 0–0";
    if (ethEl) ethEl.textContent = sc.eth_text || "0–0 ETH";
    if (lead) lead.textContent = sc.match || "BTC 0 · ETH 0";
    if (trash) trash.textContent = sc.line || "";
    strip.classList.remove("ahead-btc", "ahead-eth", "ahead-tied");
    strip.classList.add("ahead-" + (sc.ahead || "tied"));
  }

  function containPortrait(img, cx, cy, r) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const side = r * 2;
    const cover = Math.max(side / iw, side / ih);
    // object-fit: cover — fill the seat circle. No empty photo annulus.
    // Nudge up so a cover crop keeps the face in the circle.
    const scale = cover;
    const dw = iw * scale, dh = ih * scale;
    const extraY = Math.max(0, (dh - side) / 2);
    const faceBias = Math.min(r * 0.12, extraY * 0.35);
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
    if (isOracleTable(which)) return "oracle";
    if (isAtsTable(which)) return "ats";
    if (isFrontTable(which)) return "front";
    return isEthTable(which) ? "ethereum" : "bitcoin";
  }

  function noteChairLock(which, lc) {
    const key = chairKeyOf(which);
    if (!sealFX[key]) sealFX[key] = { until: 0, dir: "WAIT" };
    const side = String((lc && lc.direction) || "").toUpperCase();
    const locked = chairLockIsReal(lc);
    const stamp = locked ? String(lc.ticker || lc.locked_at || lc.close_time || side) : "";
    if (locked && stamp && _sealSeen[key] !== stamp) {
      _sealSeen[key] = stamp;
      sealFX[key] = { until: Date.now() + 1100, dir: side };
    }
    if (!locked) _sealSeen[key] = "";
  }

  const _chairPulse = { bitcoin: null, ethereum: null, front: null };
  let _newsPulseSig = "";
  function pulseKeyOf(which) {
    const w = String(which || "").toLowerCase();
    if (w === "front" || w === "raijin") return "front";
    if (w === "ethereum" || w === "eth" || (typeof isEthTable === "function" && isEthTable(which))) return "ethereum";
    return "bitcoin";
  }
  function pulseKeyFromTick(key) {
    const k = String(key || "");
    if (k.indexOf("front:") === 0) return "front";
    if (k.indexOf("ethereum") === 0) return "ethereum";
    if (k.indexOf("bitcoin") === 0) return "bitcoin";
    if (k.indexOf("art:") === 0) return pulseKeyOf(typeof focusTable !== "undefined" ? focusTable : "bitcoin");
    return pulseKeyOf(k.split(":")[0]);
  }
  function ensureChairPulse(which) {
    const key = pulseKeyOf(which);
    if (_chairPulse[key]) return _chairPulse[key];
    const seed = key === "ethereum" ? 0.61 : (key === "front" ? 0.93 : 0.17);
    _chairPulse[key] = {
      key: key,
      t: seed * 4000,
      at: 0,
      hz: 0.55 + seed * 0.35,
      target: 0.55 + seed * 0.35,
      heat: 0,
      burstLeft: 0,
      burstAcc: 0,
      lullUntil: 0,
      lastAct: 0,
      lastPx: null,
      lastLock: "",
      wxSig: "",
      walkAt: 0,
    };
    return _chairPulse[key];
  }
  function bumpChairPulse(which, amount) {
    const p = ensureChairPulse(which);
    p.lastAct = Date.now();
    p.heat = Math.min(2.6, p.heat + Math.max(0.08, Number(amount) || 0.2));
    if (p.burstLeft <= 0 && (typeof time !== "number" || time >= p.lullUntil) && Math.random() < 0.62) {
      p.burstLeft = 2 + (Math.random() < 0.4 ? 1 : 0);
      p.burstAcc = 0;
    }
  }
  function stepChairPulse(which, now) {
    // Each Chair has its own pulse clock. Packets, not a metronome.
    const p = ensureChairPulse(which);
    now = (now != null) ? now : (typeof time === "number" ? time : 0);
    if (!p.at) p.at = now;
    const dt = Math.max(0, Math.min(48, now - p.at));
    p.at = now;
    p.heat *= Math.pow(0.5, dt / 820);
    if (p.burstLeft > 0) {
      p.hz = 4.2 + Math.random() * 1.4;
      p.burstAcc += dt;
      if (p.burstAcc >= (1000 / Math.max(4, p.hz))) {
        p.burstAcc = 0;
        p.burstLeft -= 1;
        if (p.burstLeft <= 0) p.lullUntil = now + 380 + Math.random() * 820;
      }
    } else if (p.lullUntil > now) {
      p.hz = 0.34 + Math.random() * 0.18;
    } else {
      if (!p.walkAt || now - p.walkAt > 220 + Math.random() * 260) {
        p.walkAt = now;
        p.target += (Math.random() - 0.5) * 0.16;
      }
      const quiet = (Date.now() - (p.lastAct || 0)) > 1400;
      if (quiet) p.target = Math.max(0.32, Math.min(1.05, p.target));
      else p.target = Math.max(0.45, Math.min(3.2, p.target + p.heat * 0.9));
      const want = Math.max(0.32, Math.min(5.6, p.target + p.heat * 1.8));
      p.hz += (want - p.hz) * 0.14;
    }
    p.hz = Math.max(0.32, Math.min(5.6, p.hz));
    p.t += dt * (p.hz / 2.72);
    return p;
  }
  function stepAllChairPulses(now) {
    stepChairPulse("bitcoin", now);
    stepChairPulse("ethereum", now);
    stepChairPulse("front", now);
  }
  function chairPulseTime(which) {
    return ensureChairPulse(which).t;
  }
  function tasteChairActivity(which) {
    const key = pulseKeyOf(which);
    const p = ensureChairPulse(key);
    if (key === "front") {
      const wx = (typeof frontBoard !== "undefined" && frontBoard && frontBoard.weather) || {};
      const sig = [wx.mode || "", wx.raw || wx.text || "", wx.held ? "1" : "0"].join("|");
      if (p.wxSig && sig !== p.wxSig && (wx.mode || wx.raw || wx.text)) bumpChairPulse("front", 0.85);
      p.wxSig = sig;
      return;
    }
    const st = (typeof tableState === "function" ? tableState(key) : null) || (key === "bitcoin" ? state : null);
    if (!st) return;
    const px = Number((st.market || {}).price);
    if (Number.isFinite(px) && p.lastPx != null && px !== p.lastPx) {
      const d = Math.abs(px - p.lastPx) / Math.max(1, Math.abs(p.lastPx));
      bumpChairPulse(key, Math.min(1.15, 0.22 + d * 48));
    }
    if (Number.isFinite(px)) p.lastPx = px;
    const lc = st.locked_call || (st.decision && st.decision.locked_call) || {};
    const lockKey = [lc.locked ? "1" : "0", lc.direction || "", lc.ticker || ""].join("|");
    if (p.lastLock && p.lastLock !== lockKey) bumpChairPulse(key, 0.95);
    p.lastLock = lockKey;
  }

  function chairThinkRate(st, dir, locked, which) {
    stepChairPulse(which);
    tasteChairActivity(which);
    const p = ensureChairPulse(which);
    const sfx = sealFX[chairKeyOf(which)];
    const punching = !!(sfx && sfx.until > Date.now());
    const huddle = (st && st.huddle) || (state && state.huddle) || {};
    const raw = String(dir || "WAIT").toUpperCase();
    const wait = !locked && raw.indexOf("WAIT") >= 0;
    let rate = p.hz / 1.15;
    if (wait) rate = Math.min(rate, 0.72);
    if (huddle.in_huddle) rate = Math.max(rate, 1.65);
    else if (typeof beastMode !== "undefined" && beastMode && !wait) rate = Math.max(rate, 1.25);
    if (locked) rate = Math.max(rate, 1.15);
    if (punching) rate = Math.max(rate, 2.2);
    return Math.max(0.32, Math.min(5.6, rate));
  }
  function pulseRate(st, dir, locked, which) {
    // pulse-rate: WAIT ambient, lean 1×, huddle/lock faster, punch 2.2×.
    return chairThinkRate(st, dir, locked, which);
  }

  function thinkingRingAllowed(which) {
    // Satoshi / Vitalik only. Ares and Front stay game / weather.
    return floorCryptoTable(which);
  }
  function thinkingRingFrac(st) {
    return hourFillFrac((st && st.market) || {});
  }
  function drawThinkingRing(cx, cy, photoR, seatR, opts) {
    // 1H cook ring around Satoshi / Vitalik. Same neon / saber language.
    // Cheap annulus stroke on the existing portrait ring. No extra images.
    if (!ctx || !photoR || !seatR || seatR <= photoR + 3) return;
    opts = opts || {};
    if (!thinkingRingAllowed(opts.which)) return;
    const frac = Math.max(0.02, Math.min(1, thinkingRingFrac(opts.st)));
    const dir = String(opts.dir || "WAIT").toUpperCase();
    const locked = !!opts.locked;
    const phone = (typeof isPhoneDesk === "function") ? isPhoneDesk() : false;
    const inner = photoR + 3;
    const outer = seatR - 2;
    const mid = (inner + outer) / 2;
    const hue = locked ? "rgba(240, 193, 74, 0.95)"
      : (dir === "UP" || dir === "UP_HOLD") ? "rgba(0, 255, 120, 0.82)"
      : (dir === "DOWN" || dir === "DOWN_HOLD") ? "rgba(255, 55, 90, 0.82)"
      : (String(opts.which || "") === "ethereum" ? "rgba(120, 255, 160, 0.70)" : "rgba(0, 220, 255, 0.78)");
    const start = -Math.PI / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    ctx.clip();
    ctx.strokeStyle = "rgba(180, 210, 230, 0.16)";
    ctx.lineWidth = phone ? 3.2 : 4.6;
    ctx.beginPath();
    ctx.arc(cx, cy, mid, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hue;
    ctx.lineCap = "round";
    ctx.lineWidth = phone ? 3.6 : 5.2;
    ctx.globalAlpha = 0.88;
    if (!phone && !reduceMotion) {
      ctx.shadowColor = hue;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, mid, start, start + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
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
    const rate = pulseRate(st, dir, locked, which);
    const clock = chairPulseTime(which);
    const wait = !locked && dir.indexOf("WAIT") >= 0;
    const sfx = sealFX[key];
    const punching = !!(sfx && sfx.until > Date.now() && !reduceMotion);
    try { drawThinkingRing(cx, cy, photoR, seatR, opts); } catch (e) {}
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
      const sweep = clock * 0.00032;
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
    const orbit = reduceMotion ? 0 : (-clock * 0.00018);
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

    const pulse = reduceMotion ? 0.7 : (0.55 + 0.45 * Math.sin(clock * 0.0024));
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
      const phase = (clock * 0.00105 + seed) % (wait ? 11 : 7);
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
      // Lock is a punch — hard hit, not a fade.
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3.4;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, photoR + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawLockIgnition(cx, cy, photoR, which) {
    // Fat lock saber: hard hit on Chair LOCK (~1s), then stays OFF. Not a fade.
    // Green UP / red DOWN / sports ticket. Next to the portrait — not over the face or seat labels.
    // Don't fire on WAIT.
    if (!ctx || !photoR) return;
    const key = chairKeyOf(which);
    const sfx = sealFX[key];
    if (!sfx || !(sfx.until > Date.now())) return;
    const dir = String(sfx.dir || "").toUpperCase();
    const word = lockStampWord(dir, which);
    if (!word) return;
    if (dir === "WAIT" || dir === "SIT" || dir === "HOLD") return;
    const left = sfx.until - Date.now();
    const t = 1 - Math.max(0, Math.min(1, left / 1100));
    let grow = 1;
    let alpha = 0.98;
    if (!reduceMotion) {
      if (t < 0.08) {
        grow = 1;
        alpha = 1;
      } else if (t < 0.88) {
        grow = 1;
        alpha = 1;
      } else {
        grow = 1;
        alpha = t < 0.94 ? 1 : 0;
      }
    } else {
      alpha = left > 80 ? 0.95 : 0;
    }
    const tone = (typeof wxTone === "function") ? wxTone(dir) : (dir === "UP" || dir === "UP_HOLD" ? "UP" : (dir === "DOWN" || dir === "DOWN_HOLD" ? "DOWN" : "WAIT"));
    const up = tone === "UP" || word === "UP";
    const glow = up ? "rgba(57, 255, 20, 0.9)" : "rgba(255, 45, 85, 0.9)";
    const core = up ? "rgba(210, 255, 200, 0.98)" : "rgba(255, 214, 220, 0.98)";
    const dualFloor = floorLikeMode() && typeof floorIsSingle === "function" && !floorIsSingle();
    const side = (dualFloor && key === "bitcoin") ? -1 : 1;
    const gap = Math.max(16, photoR * 0.22);
    const x = cx + side * (photoR + gap);
    const hiltY = cy + photoR * 0.36;
    const full = Math.min(photoR * 1.42, 118);
    const len = full * grow;
    const thick = Math.max(14, Math.min(22, photoR * 0.24));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    ctx.strokeStyle = glow;
    ctx.lineWidth = thick;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(x, hiltY);
    ctx.lineTo(x, hiltY - len);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(5, thick * 0.36);
    ctx.beginPath();
    ctx.moveTo(x, hiltY);
    ctx.lineTo(x, hiltY - len);
    ctx.stroke();
    ctx.fillStyle = "rgba(18, 14, 10, 0.95)";
    ctx.fillRect(x - thick * 0.42, hiltY - 2, thick * 0.84, 7);
    ctx.restore();
    // Stamp slams the call onto the table. One beat. Not a fade.
    drawLockStamp(cx, cy, photoR, which, word, glow, alpha, t);
  }
  function drawLockStamp(cx, cy, photoR, which, word, glow, alpha, t) {
    // Stamp slams the call onto the table. One beat. Not a fade.
    if (!ctx || !word || alpha <= 0) return;
    const phone = (typeof isPhoneDesk === "function") && isPhoneDesk();
    const slam = (!reduceMotion && t < 0.10) ? (1.18 - t * 1.6) : 1;
    const tw = Math.min(photoR * (phone ? 1.55 : 1.85), word.length > 8 ? 168 : 118) * slam;
    const th = (phone ? 22 : 28) * slam;
    const y = cy + photoR * 0.92;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, y);
    ctx.rotate(reduceMotion ? 0 : (-0.04 + (t < 0.08 ? 0.08 : 0)));
    ctx.fillStyle = "rgba(8, 10, 14, 0.92)";
    ctx.strokeStyle = glow || "rgba(240, 193, 74, 0.95)";
    ctx.lineWidth = 3.2;
    ctx.shadowColor = glow || "rgba(240, 193, 74, 0.8)";
    ctx.shadowBlur = phone ? 0 : 14;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-tw / 2, -th / 2, tw, th, 5);
    else ctx.rect(-tw / 2, -th / 2, tw, th);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff6d8";
    ctx.font = "700 " + (phone ? 11 : 13) + "px Orbitron, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(word).slice(0, 22), 0, 1);
    ctx.restore();
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

  // Floor Chair leftover grow. Reuse rooms / rings. Scale the visible set.
  const FLOOR_CHAIR_KEYS = ["bitcoin", "ethereum", "front", "ats", "oracle"];
  const FLOOR_CHAIR_STORE = "council_floor_chairs";
  function loadFloorChairOn() {
    const on = { bitcoin: true, ethereum: true, front: true, ats: true, oracle: true };
    try {
      const raw = localStorage.getItem(FLOOR_CHAIR_STORE);
      if (!raw) return on;
      const o = JSON.parse(raw);
      FLOOR_CHAIR_KEYS.forEach(function (k) {
        if (o && typeof o[k] === "boolean") on[k] = o[k];
      });
    } catch (e) {}
    if (!FLOOR_CHAIR_KEYS.some(function (k) { return on[k]; })) on.bitcoin = true;
    return on;
  }
  let floorChairOn = loadFloorChairOn();
  function visibleFloorChairs() {
    return FLOOR_CHAIR_KEYS.filter(function (k) { return floorChairOn[k] !== false; });
  }
  function floorChairLabelOf(which) {
    if (which === "ethereum") return chairNameOf("ethereum") + " · ETH";
    if (which === "front") return chairNameOf("front") + " · DWF";
    if (which === "ats") return chairNameOf("ats") + " · ATS";
    if (which === "oracle") return chairNameOf("oracle") + " · CRT";
    return chairNameOf("bitcoin") + " · BTC";
  }
  function floorSplitTableR(w, h, n) {
    if (n <= 1) {
      const want = Math.min(w, h) * 0.32;
      const seatR = 22;
      const labelPad = 36;
      const maxR = Math.max(72, (Math.min(w, h) - 2 * (seatR + labelPad) - 24) / (2 * 1.48));
      return Math.min(want, maxR);
    }
    if (n === 2) return dualFloorTableR(w, h);
    if (n === 3) {
      const want = Math.min(w, h) * 0.20;
      const gapX = w / 3;
      const seatR = 16;
      const labelPad = 22;
      const maxRx = Math.max(52, (gapX - 2 * (seatR + labelPad) - 12) / (2 * 1.42));
      const maxRy = Math.max(52, (h * 0.70 - 2 * (seatR + labelPad) - 12) / (2 * 1.42));
      return Math.min(want, maxRx, maxRy);
    }
    return quadFloorTableR(w, h);
  }
  function floorChairLayout(w, h, keys, phone) {
    keys = keys || visibleFloorChairs();
    const n = keys.length;
    phone = !!phone;
    const out = [];
    if (n <= 0) return out;
    // Phone: one big so 390 does not crush. Stack only when each cell is tall enough.
    if (phone) {
      if (n <= 1 || h / n < 200) {
        let focusKey = keys[0];
        try {
          const cur = chairKeyOf(focusTable);
          if (keys.indexOf(cur) >= 0) focusKey = cur;
        } catch (e) {}
        out.push({ key: focusKey, x: w * 0.50, y: h * 0.50, r: floorSplitTableR(w, h, 1), split: "one" });
        return out;
      }
      const cellH = h / n;
      const cellR = floorSplitTableR(w, cellH, 1);
      const split = n === 2 ? "half" : (n === 3 ? "thirds" : (n === 4 ? "fourths" : "fifths"));
      for (let i = 0; i < n; i++) {
        out.push({ key: keys[i], x: w * 0.50, y: cellH * (i + 0.5), r: cellR, split: split });
      }
      return out;
    }
    if (n === 1) {
      out.push({ key: keys[0], x: w * 0.50, y: h * 0.50, r: floorSplitTableR(w, h, 1), split: "one" });
      return out;
    }
    if (n === 2) {
      const rr = floorSplitTableR(w, h, 2);
      out.push({ key: keys[0], x: w * 0.28, y: h * 0.50, r: rr, split: "half" });
      out.push({ key: keys[1], x: w * 0.72, y: h * 0.50, r: rr, split: "half" });
      return out;
    }
    if (n === 3) {
      const rr = floorSplitTableR(w, h, 3);
      out.push({ key: keys[0], x: w * (1 / 6), y: h * 0.50, r: rr, split: "thirds" });
      out.push({ key: keys[1], x: w * 0.50, y: h * 0.50, r: rr, split: "thirds" });
      out.push({ key: keys[2], x: w * (5 / 6), y: h * 0.50, r: rr, split: "thirds" });
      return out;
    }
    if (n === 4) {
      const rr = quadFloorTableR(w, h);
      const slots = [
        { key: "bitcoin", x: w * 0.28, y: h * 0.30 },
        { key: "ethereum", x: w * 0.72, y: h * 0.30 },
        { key: "front", x: w * 0.28, y: h * 0.72 },
        { key: "ats", x: w * 0.72, y: h * 0.72 },
      ];
      keys.forEach(function (k) {
        const slot = slots.filter(function (s) { return s.key === k; })[0];
        if (slot) out.push({ key: k, x: slot.x, y: slot.y, r: rr, split: "fourths" });
      });
      return out;
    }
    const rr = pentaFloorTableR(w, h);
    const slots5 = [
      { x: w * 0.20, y: h * 0.30 },
      { x: w * 0.50, y: h * 0.30 },
      { x: w * 0.80, y: h * 0.30 },
      { x: w * 0.32, y: h * 0.72 },
      { x: w * 0.68, y: h * 0.72 },
    ];
    keys.forEach(function (k, i) {
      const slot = slots5[i];
      if (slot) out.push({ key: k, x: slot.x, y: slot.y, r: rr, split: "fifths" });
    });
    return out;
  }
  function setFloorChairOn(key, on) {
    key = chairKeyOf(key);
    if (FLOOR_CHAIR_KEYS.indexOf(key) < 0) return visibleFloorChairs();
    const next = Object.assign({}, floorChairOn);
    next[key] = !!on;
    if (!FLOOR_CHAIR_KEYS.some(function (k) { return next[k]; })) next[key] = true;
    floorChairOn = next;
    try { localStorage.setItem(FLOOR_CHAIR_STORE, JSON.stringify(floorChairOn)); } catch (e) {}
    const vis = visibleFloorChairs();
    try {
      if (vis.indexOf(chairKeyOf(focusTable)) < 0 && vis[0] && typeof window.setFocusTable === "function") {
        window.setFocusTable(vis[0]);
      }
    } catch (e) {}
    try { syncFloorChairToggles(); } catch (e) {}
    try { if (typeof drawArt === "function") drawArt(); } catch (e) {}
    return vis;
  }
  function syncFloorChairToggles() {
    const el = document.getElementById("floorChairToggles");
    if (!el) return;
    const on = (typeof floorLikeMode === "function") ? floorLikeMode() : (mode === "floor" || mode === "night");
    el.hidden = !on;
    el.setAttribute("aria-hidden", on ? "false" : "true");
    el.querySelectorAll("input[data-floor-chair]").forEach(function (inp) {
      const k = inp.getAttribute("data-floor-chair");
      inp.checked = floorChairOn[k] !== false;
    });
    try { document.body.dataset.floorChairs = String(visibleFloorChairs().length); } catch (e) {}
  }
  window.__floorChairLayout = floorChairLayout;
  window.__visibleFloorChairs = visibleFloorChairs;
  window.__setFloorChairOn = setFloorChairOn;
  function syncFloorExitBtn() {
    const btn = document.getElementById("floorExitBtn");
    if (!btn) return;
    const on = mode === "floor";
    btn.hidden = !on || mode === "night";
    btn.setAttribute("aria-hidden", on ? "false" : "true");
  }
  function syncPhoneBackBtn() {
    const btn = document.getElementById("phoneBackBtn");
    if (!btn) return;
    const phone = typeof isPhoneDesk === "function" && isPhoneDesk();
    const show = !!(phone && mode !== "floor" && typeof hasDeskAuth === "function" && hasDeskAuth());
    btn.hidden = !show;
    btn.setAttribute("aria-hidden", show ? "false" : "true");
    btn.textContent = "← FLOOR";
  }
  function wirePhoneBackBtn() {
    const btn = document.getElementById("phoneBackBtn");
    if (!btn || btn.__wiredBack) return;
    btn.__wiredBack = true;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      try { setMode("floor"); } catch (err) {}
    });
  }

  function pentaFloorTableR(w, h) {
    const want = Math.min(w, h) * 0.15;
    const gapX = w * 0.30;
    const gapY = h * 0.38;
    const seatR = 14;
    const labelPad = 20;
    const maxRx = Math.max(48, (gapX - 2 * (seatR + labelPad) - 10) / (2 * 1.42));
    const maxRy = Math.max(48, (gapY - 2 * (seatR + labelPad) - 10) / (2 * 1.42));
    return Math.min(want, maxRx, maxRy);
  }
  function dualFloorTableR(w, h) {
    // Satoshi/Vitalik stay dual. Shrink the rings so they do not crush at 1042.
    const want = Math.min(w, h) * 0.26;
    const gap = w * 0.50;
    const seatR = 22;
    const labelPad = 36;
    const maxR = Math.max(72, (gap - 2 * (seatR + labelPad) - 20) / (2 * 1.48));
    return Math.min(want, maxR);
  }

  function floorRaijinFit(w, h) {
    // Smaller third Floor chair. Dual only. Phone tucks the HUD chip.
    // Keep off GOAL, WIRE/EXHAUST/CASCADE, and SATOSHI/VITALIK nameplates.
    const phone = w <= 480 || Math.min(w, h) <= 520;
    const dual = !phone && w >= 720;
    if (!dual) return { show: "chip", phone: phone, dual: false };
    const R = dualFloorTableR(w, h);
    const mid = !phone && w <= 1180;
    const chromeBottom = mid ? 96 : 48;
    const photoR = Math.max(18, Math.min(R * 0.20, 24));
    const seatR = photoR * 1.26;
    const ringTop = h * 0.52 - R * 1.48;
    const y = Math.max(chromeBottom + seatR + 4, Math.min(ringTop - seatR - 8, chromeBottom + seatR + 8));
    return { show: "chair", x: w * 0.50, y: y, photoR: photoR, seatR: seatR, dual: true, phone: false };
  }

  const raijinPortrait = new Image();
  raijinPortrait.src = "/raijin-wait.jpg";
  const aresPortrait = new Image();
  aresPortrait.src = "/static/ares-chair.png";
  aresPortrait.onerror = function () {
    try { aresPortrait.removeAttribute("crossOrigin"); } catch (e) {}
    aresPortrait.src = "/static/ares-wait.png";
  };
  function aresEyeColors(eyes) {
    const e = eyes || {};
    const mode = String(e.mode || "wait").toLowerCase();
    let a = e.primary || "#F5B942";
    let b = e.secondary || a;
    if (mode === "over") { a = "#FF6A1A"; b = "#FFC14A"; }
    if (mode === "under") { a = "#3DE0FF"; b = "#00E8FF"; }
    if (mode === "wait") { a = "#F5B942"; b = "#F5B942"; }
    return { mode: mode, a: a, b: b };
  }
  function paintAresEyes(eyes) {
    const face = document.getElementById("aresFace");
    const cols = aresEyeColors(eyes);
    /* One portrait only: canvas aresPortrait + drawAresEyeTint. Never unhide the HTML overlay. */
    if (face) {
      face.hidden = true;
      face.setAttribute("aria-hidden", "true");
    }
    try {
      document.body.style.setProperty("--ares-eye-a", cols.a);
      document.body.style.setProperty("--ares-eye-b", cols.b);
    } catch (e) {}
    return cols;
  }
  function drawAresEyeTint(cx, cy, pr, eyes) {
    const cols = aresEyeColors(eyes);
    const y = cy - pr * 0.08;
    const dx = pr * 0.18;
    const rx = pr * 0.09;
    const ry = pr * 0.055;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    [["l", -dx], ["r", dx]].forEach(function (pair) {
      ctx.beginPath();
      ctx.ellipse(cx + pair[1], y, rx, ry, 0, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx + pair[1], y, 0, cx + pair[1], y, rx);
      g.addColorStop(0, cols.a);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.shadowColor = cols.a;
      ctx.shadowBlur = 10;
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, pr + 2, 0, Math.PI * 2);
    ctx.strokeStyle = cols.a;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.shadowColor = cols.b;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
  }
  function raijinEyeColors(dir) {
    const d = (typeof wxEye === "function") ? wxEye(dir) : String(dir || "WAIT").toUpperCase();
    if (d === "UP") return { mode: "up", a: "#39ff14", b: "#00ff78" };
    if (d === "DOWN") return { mode: "down", a: "#ff3b5c", b: "#ff1a4a" };
    return { mode: "wait", a: "#FFFFFF", b: "#E8F4FF" };
  }
  function paintRaijinEyes(dir) {
    const cols = raijinEyeColors(dir);
    const overlay = document.getElementById("raijinFace");
    /* One portrait only: canvas cowboy + drawRaijinEyeTint. Never unhide a stacked HTML face. */
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    const chair = document.getElementById("frontChair");
    if (chair) chair.setAttribute("data-eye", cols.mode);
    try {
      document.body.style.setProperty("--raijin-eye-a", cols.a);
      document.body.style.setProperty("--raijin-eye-b", cols.b);
    } catch (e) {}
    return cols;
  }
  function drawRaijinEyeTint(cx, cy, pr, dir) {
    const cols = raijinEyeColors(dir);
    /* WAIT keeps the signed white storm glow. Do not turn WAIT gold. */
    if (cols.mode === "wait") return cols;
    /* Soft feather on the glowing sockets only. Do not recolor hat or coat. */
    const y = cy - pr * 0.10;
    const dx = pr * 0.16;
    const rx = pr * 0.09;
    const ry = pr * 0.055;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    [["l", -dx], ["r", dx]].forEach(function (pair) {
      ctx.beginPath();
      ctx.ellipse(cx + pair[1], y, rx, ry, 0, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx + pair[1], y, 0, cx + pair[1], y, rx);
      g.addColorStop(0, cols.a);
      g.addColorStop(0.55, cols.b);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.shadowColor = cols.a;
      ctx.shadowBlur = 12;
      ctx.fill();
    });
    ctx.restore();
    return cols;
  }
  function drawPublicTug(cx, cy, radius, tug) {
    // Floor visual only. FADE one way, STEAM the other. Does not override Chair gates.
    if (!tug || tug.visual_only === false) return;
    const fade = String((tug && tug.fade) || "SIT").toUpperCase();
    const steam = String((tug && tug.steam) || "SIT").toUpperCase();
    if (fade === "SIT" && steam === "SIT") return;
    const y = cy + radius * 0.18;
    const x0 = cx - radius * 0.52;
    const x1 = cx + radius * 0.52;
    let lean = Number(tug && tug.lean);
    if (!isFinite(lean)) lean = 0;
    lean = Math.max(-1, Math.min(1, lean));
    const knot = cx + lean * radius * 0.38;
    ctx.save();
    ctx.globalAlpha = 0.92;
    const grad = ctx.createLinearGradient(x0, y, x1, y);
    grad.addColorStop(0, "rgba(255,80,110,0.85)");
    grad.addColorStop(0.5, "rgba(240,193,74,0.75)");
    grad.addColorStop(1, "rgba(0,232,255,0.85)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(knot, y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "#f0c14a";
    ctx.shadowColor = "#f0c14a";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = "700 7px Orbitron, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ff6a7a";
    ctx.fillText("FADE " + fade.slice(0, 8), x0, y - 7);
    ctx.textAlign = "right";
    ctx.fillStyle = "#7fe9ff";
    ctx.fillText("STEAM " + steam.slice(0, 8), x1, y - 7);
    ctx.restore();
  }
  raijinPortrait.onerror = function () {
    // Same signed Dallas storm cowboy. No CORS, no neon mark, never leave the Chair empty.
    try { raijinPortrait.removeAttribute("crossOrigin"); } catch (e) {}
    raijinPortrait.src = "/raijin-wait.jpg";
  };
  function frontLockDir() {
    const data = (typeof frontBoard !== "undefined" && frontBoard) || {};
    const chair = data.chair || {};
    const tape = Array.isArray(data.tape) ? data.tape : [];
    const open = tape.find(function (p) { return String(p.result || "").toUpperCase() === "OPEN"; });
    if (open) return (String(open.side || "").toUpperCase() === "NO" || String(open.side || "").toUpperCase() === "DOWN") ? "DOWN" : "UP";
    if (typeof frontLeanOf === "function") return frontLeanOf(chair.eye);
    const eye = String(chair.eye || "WAIT").toUpperCase();
    if (eye === "UP" || eye === "YES") return "UP";
    if (eye === "DOWN" || eye === "NO") return "DOWN";
    return "WAIT";
  }
  function raijinFace(dir) {
    const pic = raijinPortraitFor(dir != null ? dir : frontLockDir());
    if (pic && pic.complete && pic.naturalWidth) return pic;
    const el = document.getElementById("frontChairImg");
    if (el && el.complete && el.naturalWidth) return el;
    const chip = document.querySelector("#floorRaijin img");
    if (chip && chip.complete && chip.naturalWidth) return chip;
    if (raijinPortrait.complete && raijinPortrait.naturalWidth) return raijinPortrait;
    return pic || el || raijinPortrait;
  }

  function drawFloorRaijinChair(w, h) {
    if (document.body.classList.contains("front-chair-off")) return;
    const fit = floorRaijinFit(w, h);
    if (!fit || fit.show !== "chair") return;
    const cx = fit.x, cy = fit.y, pr = fit.photoR, sr = fit.seatR;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, sr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 220, 255, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const floorDir = frontLockDir();
    if (!containPortrait(raijinPortraitFor(floorDir), cx, cy, pr)) {
      if (!containPortrait(raijinPortrait, cx, cy, pr)) {
        containPortrait(raijinFace(floorDir), cx, cy, pr);
      }
    }
    try { drawRaijinEyeTint(cx, cy, pr, floorDir); paintRaijinEyes(floorDir); } catch (e) {}
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 220, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
    try {
      drawChairThink(cx, cy, pr, sr, { which: "front", dir: floorDir, locked: floorDir === "UP" || floorDir === "DOWN", st: {} });
    } catch (e) {}
    ctx.font = "700 8px Orbitron, monospace";
    ctx.fillStyle = "#7fe9ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(frontChairName(), cx, cy + pr + 3);
    ctx.restore();
    rememberChairHit(cx, cy, pr, "front");
  }

  function quadFloorTableR(w, h) {
    // Four equal chairs. Raijin is a full quadrant, not a chip.
    const want = Math.min(w, h) * 0.18;
    const gapX = w * 0.44;
    const gapY = h * 0.38;
    const seatR = 16;
    const labelPad = 22;
    const maxRx = Math.max(56, (gapX - 2 * (seatR + labelPad) - 12) / (2 * 1.42));
    const maxRy = Math.max(56, (gapY - 2 * (seatR + labelPad) - 12) / (2 * 1.42));
    return Math.min(want, maxRx, maxRy);
  }

  function drawDualFloor(w, h) {
    drawQuadFloor(w, h);
  }

  function drawQuadFloor(w, h) {
    ctx.clearRect(0, 0, w, h);
    try { syncChairRoom(focusTable, tableState(focusTable) || state); } catch (e) {}
    try { drawChairRoom(w, h, focusTable, _hourWx); } catch (e) {}
    ctx.fillStyle = "rgba(2, 4, 10, 0.10)";
    ctx.fillRect(0, 0, w, h);

    const cam = floorCameraOffset();
    ctx.save();
    ctx.translate(cam.x, cam.y);

    const keys = visibleFloorChairs();
    const phone = typeof isPhoneDesk === "function" && isPhoneDesk();
    const slots = floorChairLayout(w, h, keys, phone);
    const n = slots.length;

    ctx.strokeStyle = "rgba(0, 220, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (n === 4 && !phone) {
      ctx.moveTo(w / 2, h * 0.08);
      ctx.lineTo(w / 2, h * 0.92);
      ctx.moveTo(w * 0.08, h / 2);
      ctx.lineTo(w * 0.92, h / 2);
    } else if (n === 2 && !phone) {
      ctx.moveTo(w / 2, h * 0.08);
      ctx.lineTo(w / 2, h * 0.92);
    } else if (n === 3 && !phone) {
      ctx.moveTo(w / 3, h * 0.08);
      ctx.lineTo(w / 3, h * 0.92);
      ctx.moveTo((2 * w) / 3, h * 0.08);
      ctx.lineTo((2 * w) / 3, h * 0.92);
    }
    ctx.stroke();

    const focus = String(focusTable || "");
    if (n === 4 && !phone) {
      const tableR = quadFloorTableR(w, h);
      drawTableWithBots(w * 0.28, h * 0.30, tableR, "bitcoin", chairNameOf("bitcoin") + " · BTC", !isEthTable(focus) && !isFrontTable(focus) && !isAtsTable(focus) && !isOracleTable(focus));
      drawTableWithBots(w * 0.72, h * 0.30, tableR, "ethereum", chairNameOf("ethereum") + " · ETH", isEthTable(focus) && !isFrontTable(focus) && !isAtsTable(focus) && !isOracleTable(focus));
      drawTableWithBots(w * 0.28, h * 0.72, tableR, "front", chairNameOf("front") + " · DWF", isFrontTable(focus));
      drawTableWithBots(w * 0.72, h * 0.72, tableR, "ats", chairNameOf("ats") + " · ATS", isAtsTable(focus));
    } else {
      slots.forEach(function (s) {
        const focused = chairKeyOf(focus) === s.key;
        drawTableWithBots(s.x, s.y, s.r, s.key, floorChairLabelOf(s.key), focused);
      });
    }
    ctx.restore();
    try { paintFloorLeaderClocks(w, h, slots); } catch (e) {}
  }

  function drawOracleCrtHud(cx, cy, pr) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, pr + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 232, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255, 80, 200, 0.55)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, pr + 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 80, 200, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function chairWindowClock(key) {
    const st = (typeof tableState === "function" ? tableState(key) : null) || {};
    const m = st.market || {};
    let secs = m.seconds_left != null ? m.seconds_left : m.time_remaining;
    if (secs == null && m.close_time) {
      const ms = Date.parse(m.close_time);
      if (Number.isFinite(ms)) secs = (ms - Date.now()) / 1000;
    }
    let label = "1H";
    if (key === "front") label = m.window_label || "DFW";
    else if (key === "ats") label = m.window_label || "KICK";
    else if (key === "oracle") label = "WATCH";
    let display = "—";
    if (secs != null && !isNaN(secs)) {
      const s = Math.max(0, Math.floor(Number(secs)));
      display = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }
    return { label: label, display: display };
  }

  function paintFloorLeaderClocks(w, h, slots) {
    const host = document.getElementById("floorLeaderClocks");
    if (!host) return;
    const on = (typeof floorLikeMode === "function") ? floorLikeMode() : (mode === "floor");
    host.hidden = !on || mode === "night";
    if (host.hidden) return;
    const stage = document.getElementById("tableStage") || document.getElementById("roundtable");
    const sw = (stage && stage.clientWidth) || w || 1;
    const sh = (stage && stage.clientHeight) || h || 1;
    const vis = {};
    (slots || []).forEach(function (s) { vis[s.key] = s; });
    host.querySelectorAll("[data-floor-clock]").forEach(function (el) {
      const key = el.getAttribute("data-floor-clock");
      const slot = vis[key];
      if (!slot) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const clock = chairWindowClock(key);
      const win = el.querySelector(".flc-win");
      const time = el.querySelector("[data-flc-time]");
      if (win) win.textContent = clock.label;
      if (time) time.textContent = clock.display;
      el.style.left = ((slot.x / sw) * 100) + "%";
      el.style.top = (((slot.y + slot.r * 0.92) / sh) * 100) + "%";
    });
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
    const roster = (st.agents || []).filter(a => a && a.agent_name && a.agent_name !== "leader" && !a.sub);
    const onFloor = (typeof floorLikeMode === "function" ? floorLikeMode() : (mode === "floor"));
    // Floor is leaders only. No seat-bot rings — not even lock-only. Bots stay on Seats and Table.
    const agents = onFloor ? [] : roster;
    const maj = majorityDirOf(roster);
    const wx = hourWeatherOf(st);
    const gold = "rgba(240, 193, 74, 0.95)";
    const accent = locked ? gold : (which === "ethereum" ? "rgba(120, 255, 160, 0.55)" : "rgba(0, 220, 255, 0.55)");
    const chairMood = seatMoodOf(dir, conf);
    const pr = radius * 0.80 * chairBreatheScale(which, locked) * (0.92 + 0.08 * chairMood.lean);
    const portraitY = cy - 2;
    const ringR = radius * 1.48;
    const orbit = seatOrbitAngle();
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

    try { drawChairRoom(radius * 4, radius * 4, which, wx, cx, cy, radius); } catch (e) {}
    drawTableSmoke(cx, cy, radius, maj, wx);
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
      if (adir === "UP" || adir === "UP_HOLD" || adir === "COVER" || adir === "OVER" || adir === "HOME") col = "rgba(0,255,120,0.95)";
      if (adir === "DOWN" || adir === "DOWN_HOLD" || adir === "NO-COVER" || adir === "UNDER" || adir === "AWAY") col = "rgba(255,55,90,0.95)";
      const confA = Number(a.confidence) || 50;
      const end = spokeEnd(x, y, cx, portraitY, pr + 4);
      const agree = (adir === chairLean) && (adir !== "WAIT");
      const fresh = markSeatTick((which || "t") + ":" + (a.agent_name || i), adir, confA);
      drawPacketSpoke(x, y, end.x, end.y, col, confA, agree, fresh, which);
      ctx.globalAlpha = focused ? 1 : 0.42;
      botPts.push({ a, x, y, col, confA, name: a.agent_name || a.name || "?", ang, adir });
    });

    const img = chairPortraitOf(which, dir);
    if (!containPortrait(img, cx, portraitY, pr)) {
      ctx.beginPath();
      ctx.arc(cx, portraitY, pr, 0, Math.PI * 2);
      ctx.fillStyle = "#0a1220";
      ctx.fill();
    }
    if (which === "ats" || (typeof isAtsTable === "function" && isAtsTable(which))) {
      try { drawAresEyeTint(cx, portraitY, pr, (st && st.eyes) || {}); } catch (e) {}
    }
    if (typeof isFrontTable === "function" && isFrontTable(which)) {
      try { drawRaijinEyeTint(cx, portraitY, pr, dir); paintRaijinEyes(dir); } catch (e) {}
    }
    if (typeof isOracleTable === "function" && isOracleTable(which)) {
      try { drawOracleCrtHud(cx, portraitY, pr); } catch (e) {}
    }
    rememberChairHit(cx, portraitY, pr, which);
    // Gold ring when locked / focused, else direction color
    ctx.beginPath();
    ctx.arc(cx, portraitY, pr, 0, Math.PI * 2);
    if (locked) {
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3.2;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 10 + 12 * chairMood.glow;
    } else if (focused) {
      ctx.strokeStyle = which === "ethereum" ? "rgba(120,255,160,0.9)" : "rgba(0,220,255,0.9)";
      ctx.lineWidth = 2.8;
      ctx.globalAlpha = chairMood.alpha;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = chairMood.loud ? 16 : 6;
    } else {
      ctx.strokeStyle = "rgba(200,220,255,0.35)";
      ctx.lineWidth = 2;
      ctx.globalAlpha = chairMood.alpha;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = focused ? 1 : 0.42;
    try {
      noteChairLock(which, lc);
      drawChairThink(cx, portraitY, pr, radius, { which, dir, locked, st });
      drawLockIgnition(cx, portraitY, pr, which);
    } catch (e) {}

    // Labels
    ctx.textAlign = "center";
    ctx.font = "700 11px Orbitron, monospace";
    ctx.fillStyle = locked ? gold : (which === "ethereum" ? "#9dffc0" : "#7fe9ff");
    // Inside the table, under the portrait — not in the top-arc seat ring (FOCUSWICK).
    const dualNameY = portraitY + pr + 11;
    ctx.fillText(label || (chairNameOf(which) + (isEthTable(which) ? " · ETH" : " · BTC")), cx, dualNameY);

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
    if (which === "ats" || (typeof isAtsTable === "function" && isAtsTable(which))) {
      const watch = (st && st.watch) || {};
      const wline = String(watch.line || "WATCH · DARK · NO LISTING");
      ctx.font = "700 8px Orbitron, monospace";
      ctx.fillStyle = watch.listed ? "#f0c14a" : "rgba(127,233,255,0.85)";
      ctx.fillText(wline, cx, plateY + (locked ? 28 : 28));
      try { drawPublicTug(cx, cy, radius, st && st.tug); } catch (e) {}
    }

    if (onFloor) {
      drawFloorAttractGlow(cx, cy, radius, which);
    } else if (!botPts.length) {
      if (!roster.length) {
        ctx.font = "600 10px Rajdhani, sans-serif";
        ctx.fillStyle = "rgba(160,180,200,0.55)";
        ctx.fillText((which === "ethereum" ? "ETH council loading…" : "BTC council loading…"), cx, cy + radius + 44);
      }
    } else {
      botPts.forEach((bp, i) => {
        const face = locked ? Math.atan2(portraitY - bp.y, cx - bp.x) : bp.ang;
        drawGameBot(bp.name, bp.x, bp.y, 22, bp.adir, bp.confA, face, i);
        const tag = labelOf(bp.a) || (bp.name || "?").toString();
        const outA = Math.atan2(bp.y - cy, bp.x - cx);
        ctx.font = "700 9px Orbitron, monospace";
        ctx.fillStyle = "rgba(220,235,250,0.95)";
        ctx.textAlign = "center";
        ctx.fillText(String(tag).slice(0, 8), bp.x + Math.cos(outA) * 16, bp.y + Math.sin(outA) * 16);
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

    const img = chairPortraitOf(which, dir);
    const pr = radius * 0.78;
    if (!containPortrait(img, cx, cy - 4, pr)) {
      ctx.beginPath();
      ctx.arc(cx, cy - 4, pr, 0, Math.PI * 2);
      ctx.fillStyle = "#0a1220";
      ctx.fill();
    }
    if (typeof isFrontTable === "function" && isFrontTable(which)) {
      try { drawRaijinEyeTint(cx, cy - 4, pr, dir); paintRaijinEyes(dir); } catch (e) {}
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
    ctx.fillText(label || (chairNameOf(which) + (isEthTable(which) ? " · ETH" : " · BTC")), cx, cy - radius - 12);

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
    if (mode !== "floor" && mode !== "art") return;
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

  function floorChromeFit(w) {
    // TABLE HUD chip vs SATOSHI’S COUNCIL wordmark (1280) and ETH/BTC (390).
    // Mid-width (~1040) drops PAPER/BOOKS + huddle/hit so they do not crush.
    // CSS --floor-table-rail reserves the left slot; rects must not intersect.
    const phone = w <= 480;
    const mid = !phone && w <= 1180;
    const table = { x: 10, y: 10, w: 88, h: 44 };
    const rail = 96;
    const headerPad = 14;
    const logo = phone
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: headerPad + rail, y: 8, w: mid ? 200 : 280, h: 36 };
    const focus = phone
      ? { x: headerPad + rail, y: 10, w: 220, h: 44 }
      : { x: headerPad + rail, y: 52, w: 220, h: 28 };
    const rivalW = mid ? 280 : 320;
    const rivalry = phone
      ? { x: 0, y: 0, w: 0, h: 0 }
      : mid
        ? { x: w / 2 - rivalW / 2, y: 58, w: rivalW, h: 36 }
        : { x: w / 2 - rivalW / 2, y: 10, w: rivalW, h: 32 };
    const huddleW = mid ? 72 : 88;
    const hitW = mid ? 70 : 120;
    const huddle = phone
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: w - 16 - hitW - 8 - huddleW - (mid ? 36 : 72), y: 8, w: huddleW, h: 28 };
    const hit = phone
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: w - 16 - hitW, y: 8, w: hitW, h: 28 };
    return { table, logo, focus, rivalry, huddle, hit, phone, mid, rail };
  }

  function floorNameplateFit(w, h) {
    // Keep GOAL strip + Chair nameplate inside the table so they do not
    // cover bottom seat names (WICK / WIRE / EXHAUST / QUORUM) at 1280 or 390.
    // Phone GOAL docks at the top rail (not a wide bar through the ring).
    const short = Math.min(w, h);
    const phone = !!(typeof isPhoneDesk === "function" && isPhoneDesk()) || w <= 420 || short <= 520;
    const seatR = phone ? 18 : 24;
    const labelStack = phone ? 28 : 42;
    const edgePad = phone ? 6 : 10;
    const nameplateH = phone ? 22 : 36;
    const ringMul = 1.15;
    const wantRadius = short * 0.40;
    const maxRing = short * 0.5 - seatR - labelStack - edgePad;
    const radius = Math.max(64, Math.min(wantRadius, maxRing / ringMul));
    const ringR = radius * ringMul;
    const wantLr = short * 0.22;
    const maxLr = Math.max(40, ringR - seatR - nameplateH - 10);
    const lrBase = Math.min(wantLr, maxLr);
    return { radius, ringR, lrBase, seatR, labelStack, nameplateH, phone, ringMul };
  }

  function floorHudGeometry(w, h, view) {
    // Real AABBs: 1280 Table GOAL vs WIRE/CASCADE, Floor dual vs SATOSHI · BTC,
    // phone 390 GOAL vs FADE/ORBIT/WHALE. view = "art" | "floor".
    view = view || "floor";
    const phone = w <= 480 || Math.min(w, h) <= 520;
    const dual = view !== "art" && !phone && w >= 720;
    const labels = ["WICK", "PULSE", "DRIFT", "TAPE", "CARRY", "ORBIT", "VOLT", "CHAIN", "STREAK", "ODDS", "STRIKE", "CLOCK", "WHALE", "QUORUM", "FADE", "CHEAP", "VEL", "WIRE", "CASCADE", "EXHAUST", "WARDEN"];
    const out = { phone: phone, dual: dual, view: view, nameplates: [], goals: [], seats: [] };
    function tw(s, px) { return Math.max(8, Math.round(String(s).length * px * 0.62)); }
    function addSeats(cx, cy, ringR, seatR, nameOff, fontPx, side, labs) {
      const list = Array.isArray(labs) ? labs : labels;
      const n = list.length;
      if (!n) return;
      list.forEach(function (lab, i) {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const sx = cx + Math.cos(ang) * ringR;
        const sy = cy + Math.sin(ang) * ringR;
        const lw = tw(lab, fontPx);
        const lx = sx + Math.cos(ang) * (seatR + nameOff);
        const ly = sy + Math.sin(ang) * (seatR + nameOff);
        out.seats.push({ x: lx - lw / 2, y: ly - fontPx / 2, w: lw, h: fontPx + 4, name: lab, table: side || "" });
      });
    }
    if (dual) {
      const keys = (typeof visibleFloorChairs === "function") ? visibleFloorChairs() : ["bitcoin", "ethereum", "front", "ats"];
      if (keys.length === 4) {
        const R = (typeof quadFloorTableR === "function" ? quadFloorTableR(w, h) : dualFloorTableR(w, h));
        const pr = R * 0.80;
        const chairs = [
          [w * 0.28, h * 0.30, "SATOSHI · BTC", "btc"],
          [w * 0.72, h * 0.30, "VITALIK · ETH", "eth"],
          [w * 0.28, h * 0.72, "RAIJIN", "front"],
          [w * 0.72, h * 0.72, "ARES", "ats"],
        ];
        chairs.forEach(function (pair) {
          const cx = pair[0];
          const cy = pair[1];
          const t = pair[2];
          const side = pair[3];
          const nameY = cy - 2 + pr + 11;
          const nw = tw(t, 11);
          out.nameplates.push({ x: cx - nw / 2, y: nameY - 11, w: nw, h: 14, text: t, table: side });
          // Floor is leaders only — no seat-bot rings on Floor HUD.
        });
      } else {
        const slots = floorChairLayout(w, h, keys, false);
        slots.forEach(function (s) {
          const t = s.key === "bitcoin" ? "SATOSHI · BTC" : (s.key === "ethereum" ? "VITALIK · ETH" : (s.key === "front" ? "RAIJIN" : "ARES"));
          const side = s.key === "bitcoin" ? "btc" : (s.key === "ethereum" ? "eth" : s.key);
          const pr = s.r * 0.80;
          const nameY = s.y - 2 + pr + 11;
          const nw = tw(t, 11);
          out.nameplates.push({ x: s.x - nw / 2, y: nameY - 11, w: nw, h: 14, text: t, table: side });
          // Floor leftover grow — chairs only, no seat-bot rings.
        });
      }
    } else if (view === "art" && !phone) {
      const radius = Math.min(w, h) * 0.32;
      const ringR = radius * 1.18;
      const lr = Math.min(w, h) * 0.24;
      const cx = w / 2, cy = h / 2;
      const goal = "GOAL · one guess @ best odds (10–90¢)";
      const gw = 200;
      const plateY = cy + lr * 0.90;
      out.goals.push({ x: cx - gw / 2, y: plateY - 14, w: gw, h: 28, text: goal });
      const nw = tw("SATOSHI", 11);
      out.nameplates.push({ x: cx - nw / 2, y: cy + lr * 0.52 - 7, w: nw, h: 14, text: "SATOSHI" });
      addSeats(cx, cy, ringR, 20, 12, 11);
    } else {
      const fit = floorNameplateFit(w, h);
      const cx = w / 2, cy = h / 2;
      const lr = fit.lrBase;
      if (fit.phone) {
        const goal = "GOAL · one guess @ best odds (10–90¢)";
        out.goals.push({ x: 8, y: 27, w: 120, h: 18, text: goal });
        const nw = tw("SATOSHI", 10);
        out.nameplates.push({ x: cx - nw / 2, y: cy + lr * 0.50 - 8, w: nw, h: 12, text: "SATOSHI" });
      } else {
        const goal = "GOAL · one guess @ best odds (10–90¢)";
        const gw = 200;
        const plateY = cy + lr * 0.90;
        out.goals.push({ x: cx - gw / 2, y: plateY - 14, w: gw, h: 28, text: goal });
        const nw = tw("SATOSHI", 10);
        out.nameplates.push({ x: cx - nw / 2, y: cy + lr * 0.52 - 8, w: nw, h: 12, text: "SATOSHI" });
      }
      if (view === "art") {
        addSeats(cx, cy, fit.ringR, fit.seatR, fit.phone ? 8 : 12, fit.phone ? 9 : 11, "", null);
      }
    }
    return out;
  }
  window.__floorHudGeometry = floorHudGeometry;

  function drawArt() {
    if (!ctx || !canvas) return;
    chairHits = [];
    resizeRoundtable();
    const sz = cssCanvasSize();
    const w = sz.w, h = sz.h;

    // Dual Floor only when the stage is wide enough — phone is always one table
    if (floorLikeMode() && !floorIsSingle() && typeof isDualMode === "function" && isDualMode()) {
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

    const cam = floorCameraOffset();
    const cx = w / 2 + cam.x, cy = h / 2 + cam.y;
    const floorFit = floorLikeMode() ? floorNameplateFit(w, h) : null;
    const radius = floorFit ? floorFit.radius : Math.min(w, h) * (floorLikeMode() ? 0.40 : 0.32);

    if (floorLikeMode()) {
      ctx.clearRect(0, 0, w, h);
      try { syncChairRoom(focusTable, state); } catch (e) {}
      try { drawChairRoom(w, h, focusTable, _hourWx); } catch (e) {}
      ctx.fillStyle = "rgba(2, 4, 10, 0.10)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#02040a";
      ctx.fillRect(0, 0, w, h);
    }

    const preAgents = (state && state.agents) || [];
    const maj = majorityDirOf(preAgents);
    const hourWx = hourWeatherOf(state);
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

    drawTableSmoke(cx, cy, radius, maj, hourWx);
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
      if (locked && lockDir && lockDir !== "WAIT") {
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
        ctx.fillText(isFrontTable(focusTable) ? frontHighLine(state) : "ONE CALL · FOLLOW THIS", cx, cy - 6);
        ctx.font = "12px Orbitron, monospace";
        ctx.fillStyle = "rgba(200,230,255,0.9)";
        let sub = conf ? (conf + "%") : "";
        if (odds != null) sub += (sub ? "  ·  " : "") + odds + "¢ entry";
        ctx.fillText(sub, cx, cy + 14);
        ctx.font = "10px Orbitron, monospace";
        ctx.fillStyle = "rgba(180,200,220,0.75)";
        ctx.fillText(
          isFrontTable(focusTable)
            ? "GOAL · DFW HIGH · CLI"
            : (isAtsTable(focusTable) ? "GOAL · one ticket · paper" : "GOAL · best odds 10–90¢"),
          cx, cy + 30
        );
        ctx.restore();
      } else {
        // Small goal reminder when not locked
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "10px Orbitron, monospace";
        ctx.fillStyle = "rgba(0, 200, 255, 0.45)";
        ctx.fillText(
          isFrontTable(focusTable)
            ? (frontHighLine(state) + " · CLI")
            : (isAtsTable(focusTable) ? "GOAL · one ticket @ 20–80¢" : "GOAL · 1 window-end guess @ best odds (10–90¢)"),
          cx, cy
        );
        ctx.restore();
      }
    } catch (e) { /* keep drawing */ }

    if (!state || !state.agents) {
      try { if (typeof __prevState !== "undefined" && __prevState) state = __prevState; } catch (e) {}
      return;
    }

    // Floor is leaders only. Seat-bot rings stay on Table / Seats — not the Floor.
    if (floorLikeMode()) {
      drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable));
    } else if (mode === "art") {
    let agents = state.agents.filter(a => a.agent_name !== "leader" && !a.sub);
    const floorHideWait = false;
    // Round table: rank order loops the ring. Rank #1 sits at the TOP.
    // Hierarchy / listen weights / learning unchanged — only seat placement is circular again.
    const hier = (state.hierarchy || (state.learning && state.learning.hierarchy) || []);
    const ranked = hier.map(r => r.agent).filter(a => a !== "law");
    const liveNames = agents.map(a => a.agent_name).filter(n => n && n !== "leader");
    const ethLive = typeof isEthTable === "function" && isEthTable(focusTable) && liveNames.length;
    const atsLive = typeof isAtsTable === "function" && isAtsTable(focusTable) && liveNames.length;
    const frontLive = typeof isFrontTable === "function" && isFrontTable(focusTable);
    const frontNames = FRONT_SEAT_KEYS.filter(function (k) { return liveNames.indexOf(k) >= 0; });
    let order = frontLive
      ? (frontNames.length ? frontNames : FRONT_SEAT_KEYS.slice())
      : (ethLive || atsLive)
      ? (ranked.length
          ? ranked.filter(a => liveNames.indexOf(a) >= 0).concat(liveNames.filter(a => ranked.indexOf(a) < 0 && a !== "law"))
          : liveNames.filter(a => a !== "law"))
      : (ranked.length
          ? ranked.concat(AGENT_ORDER.filter(a => !ranked.includes(a) && a !== "law"))
          : AGENT_ORDER.filter(a => a !== "law"));
    if (floorHideWait) {
      const locked = {};
      agents.forEach(function (a) { if (a && a.agent_name) locked[a.agent_name] = true; });
      order = order.filter(function (n) { return locked[n]; });
    }
    if (floorHideWait && !order.length) {
      drawFloorAttractGlow(cx, cy, radius, chairKeyOf(focusTable));
    }
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

    // Seat-bot rings live on Table / Seats. Floor is leaders only.
    const ringR = radius * (mode === "floor" ? 1.15 : 1.18); // outside table = floor (tighter to avoid clip)
    seatList.forEach((item, i) => {
      // Top of screen = -π/2; then clockwise around the full circle
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2 + seatOrbitAngle();
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
    // Table Chair box is a notch under Floor so Satoshi/Vitalik don't eat the panel.
    // Floor stays large via floorFit.lrBase / 0.22. Cover-fill still fills the circle.
    const chairR = floorFit ? floorFit.lrBase : Math.min(w, h) * (mode === "floor" ? 0.22 : 0.24);
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
      drawPacketSpoke(pos.x, pos.y, end.x, end.y, sc, conf, agree, fresh, focusTable);
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
      const r = floorFit ? floorFit.seatR : ((isPhoneDesk() || mode === "floor") ? 24 : 20);
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
        const badgeY = pos.y - r - (floorFit && floorFit.phone ? 8 : 12);
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

      // Callsign + signal — keep inside the canvas; phone skips the subtitle
      const compact = !!(floorFit && floorFit.phone);
      const nameOff = compact ? 14 : 18;
      const titleOff = 29;
      const dirOff = compact ? 26 : (titleOf(agent.agent_name ? agent : name) ? 41 : 30);
      const labelY = Math.min(h - 6, pos.y + r + nameOff);
      ctx.font = compact ? "700 9px Orbitron, monospace" : "700 11px Orbitron, monospace";
      ctx.fillStyle = "#d8f0ff";
      ctx.textAlign = "center";
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 6;
      ctx.fillText(labelOf(agent.agent_name ? agent : name), pos.x, labelY);
      ctx.shadowBlur = 0;
      ctx.font = "8px Rajdhani, Inter, monospace";
      ctx.fillStyle = "rgba(240, 193, 74, 0.7)";
      const title = compact ? "" : titleOf(agent.agent_name ? agent : name);
      if (title) ctx.fillText(title, pos.x, Math.min(h - 6, pos.y + r + titleOff));
      ctx.font = compact ? "8px Orbitron, monospace" : "9px Orbitron, monospace";
      ctx.fillStyle = sc;
      const showDir = effectiveDir(agent.direction);
      ctx.fillStyle = lawLocked() ? "rgba(255, 120, 20, 0.95)" : sc;
      ctx.fillText(lawLocked() ? "LOCKED" : `${showDir} ${agent.confidence}%`, pos.x, Math.min(h - 6, pos.y + r + dirOff));
    });
    ctx.globalAlpha = 1;
    if (frontLive) {
      const subs = frontSubsOf(typeof frontBoard !== "undefined" ? frontBoard : null);
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = "700 10px Orbitron, monospace";
      const hudY = Math.max(18, h - 42);
      let hx = 16;
      FRONT_SUB_IDS.forEach(function (id) {
        const row = subs.find(function (s) { return String(s.id || "").toUpperCase() === id; });
        const line = id + "  " + ((row && row.line) || "—");
        const tone = (row && row.tone) || "miss";
        ctx.fillStyle = tone === "kill" || tone === "cooked" ? "#ffb000" : (tone === "miss" ? "rgba(160,180,200,0.7)" : "#7fe9ff");
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fillText(line, hx, hudY);
        hx += ctx.measureText(line).width + 22;
      });
      ctx.restore();
    }

    } // end floor-only specialists
    ctx.globalAlpha = 1;

    // ===== Central Leader – CHAIR (armored portrait, eyes by direction) =====
    // Prefer locked_call so portrait matches the LOCKED plaque after the single call
    const _lc = (state.locked_call || (state.decision && state.decision.locked_call) || null);
    const _hasLock = !!( _lc && _lc.locked && _lc.direction && (_lc.direction === "UP" || _lc.direction === "DOWN" || _lc.direction === "ABOVE" || _lc.direction === "BELOW" || _lc.direction === "BETWEEN") );
    const leaderDir = _hasLock ? _lc.direction : (state.decision?.direction || "WAIT");
    const leaderConf = _hasLock ? (_lc.confidence || state.decision?.confidence || 0) : (state.decision?.confidence || 0);
    const waitFloor = floorLikeMode() && !_hasLock;
    const chairMood = seatMoodOf(leaderDir, leaderConf);
    const leaderPulse = reduceMotion ? 1 : (1 + (waitFloor ? 0.055 : 0.02) * Math.sin(time * 0.0035));
    const lr = (floorFit ? floorFit.lrBase : Math.min(w, h) * (mode === "floor" ? 0.22 : 0.24)) * leaderPulse * (0.90 + 0.10 * chairMood.lean);
    const scL = strongColor(leaderDir);
    const eyeGlow =
      leaderDir === "UP" || leaderDir === "UP_HOLD" || leaderDir === "COVER" || leaderDir === "OVER" || leaderDir === "HOME" ? "rgba(0, 255, 100, 0.85)" :
      leaderDir === "DOWN" || leaderDir === "DOWN_HOLD" || leaderDir === "NO-COVER" || leaderDir === "UNDER" || leaderDir === "AWAY" ? "rgba(255, 40, 70, 0.85)" :
      "rgba(220, 235, 255, 0.75)";

    // Soft aura matching call — loud seats glow, WAIT Chair leans back
    ctx.save();
    ctx.globalAlpha = chairMood.alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, lr + 28, 0, Math.PI * 2);
    ctx.fillStyle = colorFor(leaderDir, Math.max(leaderConf, 40)).replace(/[\d.]+\)$/, (0.08 + 0.10 * chairMood.glow) + ")");
    ctx.fill();
    ctx.restore();

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

    const portrait = chairPortraitOf(focusTable, leaderDir);
    if (!containPortrait(portrait, cx, cy, lr)) {
      ctx.beginPath();
      ctx.arc(cx, cy, lr, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(leaderDir, Math.max(leaderConf, 45));
      ctx.fill();
    }
    if (typeof isAtsTable === "function" && isAtsTable(focusTable)) {
      try {
        const eyes = ((typeof tableState === "function" ? tableState("ats") : null) || {}).eyes || {};
        drawAresEyeTint(cx, cy, lr, eyes);
        paintAresEyes(eyes);
      } catch (e) {}
    }
    if (typeof isFrontTable === "function" && isFrontTable(focusTable)) {
      try { drawRaijinEyeTint(cx, cy, lr, leaderDir); paintRaijinEyes(leaderDir); } catch (e) {}
    }
    rememberChairHit(cx, cy, lr, chairKeyOf(focusTable));

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
      const whichChair = chairKeyOf(focusTable);
      noteChairLock(whichChair, _lc);
      drawChairThink(cx, cy, lr, radius, { which: whichChair, dir: wxEye(leaderDir), locked: _hasLock, st: state });
      if (!isFrontTable(focusTable)) drawLockIgnition(cx, cy, lr, whichChair);
    } catch (e) {}

    // Labels under portrait — tucked to the rim so GOAL / nameplate stay
    // inside the seat ring (do not cover WICK / WIRE / EXHAUST / QUORUM).
    const hudTight = !!(floorFit && (mode === "floor" || mode === "night"));
    const phoneHud = !!(floorFit && floorFit.phone);
    const nameY = phoneHud ? (cy + lr * 0.50) : (cy + lr * 0.52);
    const dirY = phoneHud ? (cy + lr * 0.64) : (cy + lr * 0.64);
    const confY = phoneHud ? (cy + lr * 0.76) : (cy + lr * 0.74);
    ctx.font = hudTight ? "700 10px Orbitron, sans-serif" : "700 11px Orbitron, sans-serif";
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(240, 193, 74, 0.55)";
    ctx.shadowBlur = 8;
    ctx.fillText(chairNameOf(focusTable), cx, nameY);
    ctx.shadowBlur = 0;
    ctx.font = hudTight ? "700 12px Orbitron, sans-serif" : "700 13px Orbitron, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = scL;
    ctx.shadowBlur = 12;
    ctx.fillText(isFrontTable(focusTable) ? displayDir(leaderDir) : leaderDir, cx, dirY);
    ctx.shadowBlur = 0;
    ctx.font = hudTight ? "10px Orbitron, sans-serif" : "11px Orbitron, sans-serif";
    ctx.fillStyle = "#e8f4ff";
    ctx.fillText(leaderConf + "%", cx, confY);

        // ===== CLEAR LOCKED CALL plate for follower bots (GOAL: one call @ best odds) =====
    {
      const lc = state.locked_call || (state.decision && state.decision.locked_call) || {};
      const isLocked = !!(lc && lc.locked && lc.direction && (lc.direction === "UP" || lc.direction === "DOWN" || lc.direction === "ABOVE" || lc.direction === "BELOW" || lc.direction === "BETWEEN"));
      const showDir = (isLocked ? lc.direction : (leaderDir || "WAIT")).toUpperCase();
      const showConf = (lc.confidence != null ? lc.confidence : leaderConf);
      const entryOdds = lc.entry_odds_pct;
      const isDir = showDir === "UP" || showDir === "DOWN" || showDir === "UP_HOLD" || showDir === "DOWN_HOLD"
        || showDir === "ABOVE" || showDir === "BELOW" || showDir === "BETWEEN";
      const plateY = phoneHud ? 36 : (cy + lr * 0.90);
      const plateW = phoneHud ? 120 : (hudTight ? (isLocked && isDir ? 220 : 200) : (isLocked && isDir ? 220 : 200));
      const plateH = phoneHud ? 18 : 28;
      const plateX = phoneHud ? 68 : cx;
      ctx.beginPath();
      const rx = 8;
      ctx.moveTo(plateX - plateW/2 + rx, plateY - plateH/2);
      ctx.arcTo(plateX + plateW/2, plateY - plateH/2, plateX + plateW/2, plateY + plateH/2, rx);
      ctx.arcTo(plateX + plateW/2, plateY + plateH/2, plateX - plateW/2, plateY + plateH/2, rx);
      ctx.arcTo(plateX - plateW/2, plateY + plateH/2, plateX - plateW/2, plateY - plateH/2, rx);
      ctx.arcTo(plateX - plateW/2, plateY - plateH/2, plateX + plateW/2, plateY - plateH/2, rx);
      ctx.closePath();
      ctx.fillStyle = isDir ? "rgba(0, 20, 40, 0.94)" : "rgba(10, 12, 20, 0.88)";
      ctx.fill();
      ctx.strokeStyle = isDir ? scL : "rgba(120, 140, 160, 0.55)";
      ctx.lineWidth = 2.2;
      ctx.shadowColor = isDir ? scL : "transparent";
      ctx.shadowBlur = isDir ? 16 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = phoneHud ? "700 8px Orbitron, sans-serif" : "700 12px Orbitron, sans-serif";
      ctx.fillStyle = isDir ? "#ffffff" : "rgba(180, 200, 220, 0.9)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let lockLabel;
      if (isFrontTable(focusTable)) {
        lockLabel = isLocked
          ? (displayDir(showDir) + " · " + frontHighLine(state))
          : (frontHighLine(state) + " · CLI");
      } else if (isLocked && isDir) {
        const oddsPart = entryOdds != null ? ` @ ${Math.round(entryOdds)}¢` : "";
        lockLabel = `LOCKED ${showDir}${oddsPart} · ${showConf}% · FOLLOW`;
      } else {
        lockLabel = "GOAL · one guess @ best odds (10–90¢)";
      }
      ctx.fillText(lockLabel, plateX, plateY);
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
    const focusName = chairTitleOf(focusTable);

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

    const frontDash = typeof isFrontTable === "function" && isFrontTable(focusTable);
    const dashAgents = frontDash
      ? view.agents.filter(function (a) {
          return a && (a.agent_name === "leader" || isFrontSeatKey(a.agent_name));
        })
      : view.agents;
    const agentCards = dashAgents.map(a => {
      const col = strongColor(a.direction);
      const callsign = labelOf(a);
      const title = titleOf(a);
      const rec = records[a.agent_name] || {};
      const w = weights[a.agent_name];
      const wr = rec.win_rate != null ? Math.round(rec.win_rate * 100) + "%" : "—";
      const record = rec.n ? `${rec.correct}/${rec.n}` : "0/0";
      const shown = frontDash ? displayDir(a.direction) : a.direction;
      const markSrc = a.mark || frontSeatMark(a.agent_name);
      const markHtml = (frontDash && markSrc)
        ? '<img class="dash-seat-mark" src="' + markSrc + '" alt="" width="28" height="28">'
        : "";
      const wxKids = frontDash ? subsForParent(view.subs || frontSubsOf(typeof frontBoard !== "undefined" ? frontBoard : null), a.display_name || a.agent_name) : [];
      const subHtml = frontDash ? wxKids.map(function (sub) {
        return '<div class="sub-row front-sub-row"><span class="sub-name">' + String(sub.id || "") + '</span><span class="sub-dir">' + String(sub.line || "—") + "</span></div>";
      }).join("") : (a.subs || []).map(sub => {
        const sc = strongColor(sub.direction);
        return `<div class="sub-row" style="border-color:${sc}33">
          <span class="sub-name">${labelOf(sub)}</span>
          <span class="sub-dir" style="color:${lawLocked() ? "rgba(255,120,20,0.95)" : sc}">${lawLocked() ? "LOCKED" : (sub.direction + " " + sub.confidence + "%")}</span>
        </div>`;
      }).join("");
      return `
        <div class="agent-card">
          <div class="name">${markHtml}${callsign}</div>
          ${title ? `<div class="title">${title}</div>` : ""}
          <div class="dir" style="color:${lawLocked() ? "rgba(255,120,20,0.95)" : col}">${lawLocked() ? "LOCKED" : (shown + " · " + a.confidence + "%")}</div>
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

    overlay.innerHTML = `<div class="dash-focus-banner">${focusName}${frontDash ? (" · " + frontHighLine(view)) : ""}</div>` + pairCard + agentCards;
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
    if (!total) verdict = (typeof isFrontTable === "function" && isFrontTable(focusTable))
      ? "FINISH-ONLY · WAITING ON DFW CLI"
      : "FINISH-ONLY · WAITING ON HOUR CLOSE";

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

    let rows = hier.length ? hier.slice() : (isFrontTable(focusTable) ? FRONT_SEAT_KEYS : AGENT_ORDER.filter(n => n !== "law")).map((n, i) => ({
      agent: n, rank: i + 1, listen: 1, win_rate: null, correct: 0, wrong: 0, weight: 0
    }));

    // Attach live direction
    rows = rows.filter(r => r.agent !== "law");
    list.innerHTML = rows.map((r, idx) => {
      const ag = byName[r.agent] || {};
      const dir = ag.direction || "WAIT";
      const conf = ag.confidence != null ? ag.confidence : "—";
      const name = r.display_name || DISPLAY[r.agent] || (isFrontSeatKey(r.agent) ? String(r.agent).toUpperCase() : r.agent.toUpperCase());
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
        <span class="hier-dir ${wxTone(dir)}">${(isFrontTable(focusTable) ? displayDir(dir) : dir)} ${conf}${conf !== "—" ? "%" : ""}</span>
      </div>`;
    }).join("");
    if (meta) meta.textContent = `${rows.length} seats · live ranks`;
  }

function drawCandleChart() {
    if (!candleCtx || !candleCanvas) return;
    if (deskCinematicOn()) return;
    if (typeof isFrontTable === "function" && isFrontTable(focusTable)) return;

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
    function raw(v) {
      if (v == null || v === "") return NaN;
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) return NaN;
      return n;
    }
    let up = raw(m.up_pct);
    if (!Number.isFinite(up)) up = raw(m.up_mid);
    if (!Number.isFinite(up)) up = raw(m.yes_price);
    if (!Number.isFinite(up)) up = raw(m.kalshi_yes_bid);
    if (!Number.isFinite(up)) up = raw(m.kalshi_yes_ask);
    let down = raw(m.down_pct);
    if (!Number.isFinite(down)) down = raw(m.no_price);
    if (!Number.isFinite(down) && Number.isFinite(up) && up <= 1.5) down = 1 - up;
    const upPct = Number.isFinite(up) && up > 1.5;
    const downPct = Number.isFinite(down) && down > 1.5;
    if (upPct || downPct) {
      /* 0.5 / 99.5 stays 0.5 / 99.5 — do not turn 0.5 into 50. */
    } else if (Number.isFinite(up) && Number.isFinite(down)) {
      const s = up + down;
      if (s > 0.85 && s < 1.15) {
        up = up * 100;
        down = down * 100;
      } else {
        up = up * 100;
        down = 100 - up;
      }
    } else {
      if (Number.isFinite(up)) up = up * 100;
      if (Number.isFinite(down)) down = down * 100;
    }
    if (!Number.isFinite(down) && Number.isFinite(up)) down = 100 - up;
    if (!Number.isFinite(up) && Number.isFinite(down)) up = 100 - down;
    if (Number.isFinite(up) && Number.isFinite(down) && Math.abs(up + down - 100) > 2) {
      if (up > 0 && up < 100) down = 100 - up;
      else if (down > 0 && down < 100) up = 100 - down;
    }
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
    const focusM = (typeof tableState === "function" && typeof focusTable !== "undefined")
      ? ((tableState(focusTable) || {}).market || m)
      : m;
    const focusBook = liveBookOdds(focusM);
    const useBook = focusBook || book;
    if (useBook) pushSeries(series.odds, { t, up: useBook.up, down: useBook.down });
    const focusPx = Number((focusM || {}).price);
    const focusTgt = Number((focusM || {}).kalshi_target);
    if (Number.isFinite(focusPx) && Number.isFinite(focusTgt)) {
      pushSeries(series.delta, { t, d: focusPx - focusTgt });
    } else if (Number.isFinite(price) && Number.isFinite(target)) {
      pushSeries(series.delta, { t, d: price - target });
    }
    function takeFunding(mm) {
      const pct = realFundingPct(mm);
      if (pct == null) return;
      pushSeries(series.funding, { t, f: pct });
    }
    takeFunding(m);
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
    const minH = isPair ? 220 : (canvas.id === "chartWeights" ? Math.max(160, Math.min(220, wantRows * 15 + 20)) : 160);
    const maxH = 220;
    /* Never let a canvas grow with data points — cap to the card (~160–220). */
    const w = Math.min(1400, Math.max(minW, parent.clientWidth || minW));
    let h = (parent.clientHeight || 0) - (head ? head.offsetHeight : 0);
    if (h < minH) h = minH;
    if (h > maxH) h = maxH;
    const noFeed = parent.classList.contains("no-feed");
    const compact = !isPair && (!!(opts && opts.compact) || noFeed || canvas.id === "chartTape");
    if (compact) {
      const cap = canvas.id === "chartTape" ? 36 : 32;
      h = Math.max(28, Math.min(cap, maxH));
    }
    h = Math.min(h, maxH);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = w + "px";
    canvas.style.maxWidth = "100%";
    canvas.style.height = h + "px";
    canvas.style.maxHeight = maxH + "px";
    canvas.style.flex = "0 0 auto";
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
      ctx.fillText(opts.emptyLabel || "no feed", w / 2, h / 2);
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
    if (opts.dot !== false && Number.isFinite(lv) && lv >= min && lv <= max) {
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
    // Both pair titles stay in the DOM — the inactive hero is hidden, not retitled.
    const btcTitle = document.getElementById("chartPairTitle") || document.getElementById("chartBtcTitle");
    const ethTitle = document.getElementById("chartEthTitle");
    if (btcTitle) btcTitle.textContent = "BTC · 1m";
    if (ethTitle) ethTitle.textContent = "ETH · 1m";
  }
  function syncChartHero() {
    const eth = (typeof isEthTable === "function") ? isEthTable(focusTable) : (focusTable === "ethereum");
    const front = typeof isFrontTable === "function" && isFrontTable(focusTable);
    const ats = typeof isAtsTable === "function" && isAtsTable(focusTable);
    document.body.classList.toggle("charts-hero-eth", !!eth && !front && !ats);
    document.body.classList.toggle("charts-hero-btc", !eth && !front && !ats);
    document.body.classList.toggle("charts-hero-front", !!front);
    document.body.classList.toggle("charts-hero-ats", !!ats);
    const atsTape = document.getElementById("atsChartTape");
    if (atsTape) atsTape.hidden = !ats;
    try {
      if (!front && !ats) document.body.dataset.focusTable = eth ? "ethereum" : "bitcoin";
    } catch (e) {}
    const btcCard = document.querySelector(".chart-card.chart-pair-btc");
    const ethCard = document.querySelector(".chart-card.chart-pair-eth");
    if (btcCard) {
      btcCard.classList.toggle("chart-hero-off", !!eth || !!front || !!ats);
      btcCard.hidden = !!eth || !!front || !!ats;
    }
    if (ethCard) {
      ethCard.classList.toggle("chart-hero-off", !eth || !!front || !!ats);
      ethCard.hidden = !eth || !!front || !!ats;
    }
    document.querySelectorAll(".chart-card.chart-crypto-odds, .chart-card.chart-crypto-delta, .chart-card.chart-crypto-funding").forEach(function (card) {
      card.classList.toggle("chart-hero-off", !!front || !!ats);
      card.hidden = !!front || !!ats;
    });
  }
  function setChartNoFeed(canvas, empty) {
    const card = canvas && canvas.closest ? canvas.closest(".chart-card") : null;
    if (card) card.classList.toggle("no-feed", !!empty);
  }
  function setPairHeadChip(canvas, cls, text) {
    const card = canvas && canvas.closest ? canvas.closest(".chart-card") : null;
    if (!card) return;
    let chip = card.querySelector("." + cls);
    if (!text) {
      if (chip) chip.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement("span");
      chip.className = cls;
      const head = card.querySelector(".chart-card-head");
      if (head) head.appendChild(chip);
    }
    chip.textContent = text;
  }
  function setPairTargetChip(canvas, text) {
    setPairHeadChip(canvas, "chart-ktarget-chip", text);
  }
  function setPairWindowChip(canvas, text) {
    const card = canvas && canvas.closest ? canvas.closest(".chart-card") : null;
    const head = card && card.querySelector(".chart-card-head");
    if (!head) return;
    let chip = head.querySelector(".chart-window-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "chart-window-chip";
      const title = head.querySelector("#chartPairTitle, #chartEthTitle") || head.firstElementChild;
      if (title && title.nextSibling) head.insertBefore(chip, title.nextSibling);
      else head.insertBefore(chip, head.firstChild ? head.firstChild.nextSibling : null);
    }
    if (!text) {
      if (chip) chip.remove();
      return;
    }
    chip.textContent = text;
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
    /* 1H WINDOW lives on the card head — not fillText at pad.t+10 inside the plot. */
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
    const deskBook = (typeof isAtsTable === "function" && isAtsTable(focusTable))
      || (typeof isFrontTable === "function" && isFrontTable(focusTable));
    if (deskBook) {
      setPairWindowChip(canvas, "");
      setPairTargetChip(canvas, "");
      return;
    }
    setPairWindowChip(canvas, "1H WINDOW");
    if (candles.length < 2) {
      setPairTargetChip(canvas, "");
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
    candles.forEach(c => {
      if (Number.isFinite(c.l) && c.l > 0) min = Math.min(min, c.l);
      if (Number.isFinite(c.h) && c.h > 0) max = Math.max(max, c.h);
    });
    if (Number.isFinite(price) && price > 0 && price < 5e6) {
      min = Math.min(min, price);
      max = Math.max(max, price);
    }
    const padAmt = (max - min) * 0.08 || Math.abs(max) * 0.002 || 1;
    min -= padAmt;
    max += padAmt;
    let targetY = null;
    let targetChip = "";
    if (Number.isFinite(target) && target > 0 && target < 5e6) {
      if (target >= min && target <= max) {
        targetY = target;
      } else {
        /* Off-scale: chip the head. Do not draw an edge line pinned to min/max. */
        const delta = Number.isFinite(price) ? (price - target) : (max - target);
        targetChip = "K TARGET " + Math.round(target) + " · " + (delta >= 0 ? "+" : "") + Math.round(delta);
        targetY = null;
      }
    }
    setPairTargetChip(canvas, targetChip);
    const pad = { l: 8, r: 10, t: 40, b: 10 };
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
    if (targetY != null && targetY >= min && targetY <= max) {
      const ty = yAt(targetY);
      if (ty >= pad.t && ty <= h - pad.b) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#f0c14a";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(pad.l, ty); ctx.lineTo(w - pad.r, ty); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#f0c14a";
        ctx.font = "9px Orbitron";
        ctx.textAlign = "right";
        ctx.fillText("K TARGET", w - pad.r - 4, Math.min(h - pad.b - 2, Math.max(pad.t + 12, ty - 4)));
      }
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
    syncChartHero();
    drawPairCandles("chartBtc", "bitcoin", "chartBtcMeta");
  }

  function drawChartEth() {
    if (deskCinematicOn()) return;
    syncChartPairTitle();
    syncChartHero();
    drawPairCandles("chartEth", "ethereum", "chartEthMeta");
  }

  function drawChartVolume() {
    const canvas = document.getElementById("chartVolume");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    const ts = (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    const candles = ((ts.market && ts.market.candles) || (state && state.market && state.market.candles) || []).slice(-48);
    const vols = candles.map(c => Number(c.v != null ? c.v : c.volume) || 0);
    setChartNoFeed(canvas, !vols.length);
    if (!vols.length) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("no feed", w / 2, h / 2);
      return;
    }
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
    const ts = (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    const book = liveBookOdds((ts.market) || (state && state.market) || {});
    if (book && !series.odds.length) {
      pushSeries(series.odds, { t: Date.now(), up: book.up, down: book.down });
    }
    const last = series.odds.length ? series.odds[series.odds.length - 1] : null;
    const up = book ? book.up : Number(last && last.up);
    const down = book ? book.down : (Number.isFinite(Number(last && last.down))
      ? Number(last.down)
      : (Number.isFinite(up) ? 100 - up : NaN));
    if (meta) {
      if (Number.isFinite(Number(up)) && Number.isFinite(Number(down))) {
        const coarse = Math.abs(up - Math.round(up)) < 0.05 && Math.abs(down - Math.round(down)) < 0.05;
        meta.textContent = coarse
          ? (`UP ${Math.round(up)}% · DOWN ${Math.round(down)}%`)
          : (`UP ${Number(up).toFixed(1)}% · DOWN ${Number(down).toFixed(1)}%`);
      } else {
        meta.textContent = "waiting on live book";
      }
    }
    if (!series.odds.length) {
      setChartNoFeed(canvas, true);
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("waiting on live book", canvas.width / 2, canvas.height / 2);
      return;
    }
    setChartNoFeed(canvas, false);
    const bookPts = series.odds.filter(p => Number.isFinite(p.up) && Number.isFinite(p.down) && Math.abs(p.up + p.down - 100) <= 8);
    const pts = bookPts.length ? bookPts : series.odds;
    drawLineSeries(ctx, pts, p => p.up, "#39ff14", { zero: 50, yMin: 0, yMax: 100, dot: false });
    drawLineSeries(ctx, pts, p => p.down, "#ff2d55", { yMin: 0, yMax: 100, dot: false });
  }

  function drawChartDelta() {
    const canvas = document.getElementById("chartDelta");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    const pts = series.delta.slice(-36);
    const meta = document.getElementById("chartDeltaMeta");
    const last = pts[pts.length - 1];
    if (!pts.length) {
      setChartNoFeed(canvas, true);
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("no feed", canvas.width / 2, canvas.height / 2);
      if (meta) meta.textContent = "no feed";
      return;
    }
    setChartNoFeed(canvas, false);
    const recent = pts.slice(-12).map(p => p.d).filter(Number.isFinite);
    let lo = Math.min.apply(null, recent);
    let hi = Math.max.apply(null, recent);
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const mid = (lo + hi) / 2;
    const span = (hi - lo) || 1;
    const live = last && Number.isFinite(last.d) ? last.d : mid;
    const off = Math.abs(live - mid) > span * 3;
    if (!off && Number.isFinite(live)) {
      lo = Math.min(lo, live);
      hi = Math.max(hi, live);
    }
    const padAmt = (hi - lo) * 0.12 || 1;
    drawLineSeries(ctx, pts, p => p.d, "#00e8ff", { zero: 0, yMin: lo - padAmt, yMax: hi + padAmt });
    if (meta && last) {
      meta.textContent = (off ? "K Δ " : "") + `${last.d >= 0 ? "+" : ""}${last.d.toFixed(0)}`;
      meta.style.color = last.d >= 0 ? "#39ff14" : "#ff2d55";
    }
  }

  function realFundingPct(mm) {
    if (!mm || mm.funding == null || mm.funding === "") return null;
    const raw = mm.funding;
    if (raw === 0 || raw === "0" || raw === "0.0" || raw === "0.0000" || raw === "0.0000%") return null;
    const f = Number(raw);
    if (!Number.isFinite(f) || f === 0) return null;
    const pct = Math.abs(f) > 1 ? f : f * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < 1e-4) return null;
    return pct;
  }

  function drawChartFunding() {
    const canvas = document.getElementById("chartFunding");
    if (!canvas) return;
    const card = canvas.closest(".chart-card");
    const mm = (state && state.market) || {};
    /* Never push Number(mm.funding) when it is 0 / 0.0000% / null. */
    if (mm.funding == null || mm.funding === "" || Number(mm.funding) === 0) {
      if (card) card.hidden = true;
      return;
    }
    const live = realFundingPct(mm);
    if (live == null) {
      if (card) card.hidden = true;
      return;
    }
    if (!series.funding.some(p => Math.abs(p.f) >= 1e-4)) {
      pushSeries(series.funding, { t: Date.now(), f: live });
    }
    series.funding = series.funding.filter(p => p && Math.abs(Number(p.f)) >= 1e-4);
    const last = series.funding.length ? series.funding[series.funding.length - 1] : null;
    if (!last) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    drawLineSeries(ctx, series.funding, p => p.f, "#a855f7", { zero: 0 });
    const meta = document.getElementById("chartFundMeta");
    if (meta) meta.textContent = `${last.f.toFixed(4)}%`;
  }

  function pairFromLockRow(r, fallback) {
    const a = String((r && r.asset) || "").toLowerCase();
    if (a === "eth" || a === "ethereum") return "ETH";
    if (a === "btc" || a === "bitcoin") return "BTC";
    if (a === "ats" || a === "ares" || a === "sports") return "ATS";
    if (a === "front" || a === "dfw") return "DFW";
    const tick = String((r && r.ticker) || "");
    if (/ETH/i.test(tick)) return "ETH";
    if (/BTC/i.test(tick)) return "BTC";
    if (/KX(NFL|NCAAF|NBA|MLB|NHL)/i.test(tick)) return "ATS";
    return fallback || "—";
  }

  function sideFromLockRow(r) {
    const d = String((r && (r.direction || r.locked_call || r.side || r.lean)) || "").toUpperCase();
    if (d.includes("ABOVE")) return "ABOVE";
    if (d.includes("BELOW")) return "BELOW";
    if (d.includes("BETWEEN")) return "BETWEEN";
    if (d === "COVER" || d === "NO-COVER" || d === "OVER" || d === "UNDER" || d === "HOME" || d === "AWAY") return d;
    if (d && d !== "WAIT" && d !== "YES" && d !== "NO" && !d.includes("UP") && !d.includes("DOWN") && d.length <= 5) return d;
    if (d.includes("UP")) return "UP";
    if (d.includes("DOWN")) return "DOWN";
    if (d === "YES" || d === "NO") return wxWord(d, r && r.strike_type, null, r && r.floor_strike, r && r.cap_strike);
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
    const tick = String((r && r.ticker) || (ts && ts.market && (ts.market.kalshi_ticker || ts.market.ticker)) || "");
    const frontish = /KXHIGHTDAL/i.test(tick) || (ts && (ts.asset === "front" || ts._focusTable === "front"))
      || (typeof isFrontTable === "function" && isFrontTable(focusTable) && ts && ts.market && ts.market.window_kind === "cli");
    if (frontish) {
      const d = tick.match(/(\d{2})([A-Z]{3})(\d{2})/);
      if (d) return d[2] + " " + d[3];
      const day = (ts && ts.market && ts.market.clock && ts.market.clock.day) || "";
      if (day) {
        const parts = String(day).split("-");
        if (parts.length === 3) return parts[1] + "/" + parts[2];
      }
      return "CLI";
    }
    const atsish = /KX(NFL|NCAAF|NBA|MLB|NHL)/i.test(tick) || (ts && (ts.asset === "ats" || ts._focusTable === "ats"))
      || (typeof isAtsTable === "function" && isAtsTable(focusTable) && ts && ts.market && ts.market.window_kind === "game");
    if (atsish) return "KICK";
    const close = (r && (r.close_time || r.window_close)) || (ts && ts.market && ts.market.close_time);
    const ms = parseStampMs(close);
    if (ms != null) {
      return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
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
    if (raw === "COVER" || raw === "NO-COVER" || raw === "OVER" || raw === "UNDER" || raw === "HOME" || raw === "AWAY") {
      return { side: raw, locked: false, conf: d.confidence };
    }
    if (raw && raw !== "WAIT" && raw !== "YES" && raw !== "NO" && !raw.includes("UP") && !raw.includes("DOWN") && raw.length <= 5) {
      return { side: raw, locked: false, conf: d.confidence };
    }
    const side = raw.includes("UP") ? "UP" : (raw.includes("DOWN") ? "DOWN" : "WAIT");
    return { side, locked: false, conf: d.confidence };
  }

  function whyThisLockLine(ts) {
    const lc = pairLock(ts);
    if (!lc) return null;
    const side = sideFromLockRow(lc);
    const conf = lc.confidence != null ? lc.confidence : "—";
    const agents = ((ts && ts.agents) || []).filter(a => a && a.agent_name && a.agent_name !== "leader" && a.agent_name !== "law" && !a.sub);
    const allies = agents
      .filter(a => {
        const d = String(a.direction || "").toUpperCase();
        if (side === "UP") return d.includes("UP");
        if (side === "DOWN") return d.includes("DOWN");
        return d === side;
      })
      .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));
    const seats = allies.slice(0, 2).map(a => (AGENT_LABELS && AGENT_LABELS[a.agent_name]) || a.display_name || a.agent_name);
    return { side, conf, seats };
  }

  function fmtCliLeft(secs) {
    if (secs == null || isNaN(secs)) return "--:--";
    const s = Math.max(0, Math.floor(Number(secs)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h >= 1) return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }
  function atsKickLine(closeTime, minsLeft) {
    let secs = null;
    if (minsLeft != null && !isNaN(Number(minsLeft))) secs = Number(minsLeft) * 60;
    if (secs == null && closeTime) {
      const ms = Date.parse(closeTime);
      if (Number.isFinite(ms)) secs = (ms - Date.now()) / 1000;
    }
    if (secs == null || isNaN(secs)) return "CLOCK IS DARK";
    if (secs <= 0) return "THEY'RE OFF";
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (hrs >= 48) return "KICK IN " + Math.floor(hrs / 24) + "D";
    if (hrs >= 1) return "KICK IN " + hrs + "H " + String(mins).padStart(2, "0") + "M";
    return "KICK IN " + String(mins).padStart(2, "0") + "M";
  }
  function paintAtsGameStrip(ts) {
    const strip = document.getElementById("atsGameStrip");
    const nameEl = document.getElementById("atsGameName");
    const lineEl = document.getElementById("atsGameLine");
    const sportEl = document.getElementById("atsSportChip");
    const ats = typeof isAtsTable === "function" && isAtsTable(focusTable);
    if (strip) strip.hidden = !ats;
    if (sportEl) sportEl.hidden = !ats;
    if (!ats) return;
    const view = ts || (typeof tableState === "function" ? tableState("ats") : null) || {};
    const pick = view.pick || {};
    const clock = (view.market && view.market.clock) || view.clock || {};
    const game = pick.game || clock.game || "NO GAME";
    const number = pick.number || clock.number || pick.title || "NO LINE";
    const sport = String(pick.sport || clock.sport || "").trim().toUpperCase();
    if (nameEl) nameEl.textContent = game;
    if (lineEl) lineEl.textContent = number;
    if (sportEl) {
      const hasBook = !!(pick.ticker || pick.game || pick.title || pick.number || clock.game);
      sportEl.textContent = sport || (hasBook ? "WAIT" : "NO BOOK");
      sportEl.setAttribute("data-live", sport ? "on" : "off");
    }
  }
  function paintFrontWindowChrome() {
    const front = typeof isFrontTable === "function" && isFrontTable(focusTable);
    const ats = typeof isAtsTable === "function" && isAtsTable(focusTable);
    const ledLabel = document.getElementById("ledWindowLabel");
    const ledT = document.getElementById("ledWindowTime");
    const ledSub = document.getElementById("ledWindowSub");
    const dualSub = document.getElementById("dualWindowSub");
    const wxStrip = document.getElementById("wxHighStrip");
    const wxSubs = document.getElementById("wxSubStrip");
    const atsStrip = document.getElementById("atsGameStrip");
    const atsSport = document.getElementById("atsSportChip");
    const kh = document.getElementById("wxKalshiHigh");
    const nh = document.getElementById("wxNwsHigh");
    const cityEl = document.getElementById("wxCity");
    const cliEl = document.getElementById("wxCliWindow");
    if (wxStrip) wxStrip.hidden = !front;
    if (wxSubs) wxSubs.hidden = !front;
    if (atsStrip) atsStrip.hidden = !ats;
    if (atsSport) atsSport.hidden = !ats;
    if (dualSub) dualSub.hidden = !!ats;
    if (front) {
      if (ledLabel) ledLabel.textContent = "DFW HIGH";
      const ts = (typeof tableState === "function" ? tableState("front") : null) || {};
      const m = ts.market || {};
      const clock = m.clock || {};
      let secs = clock.seconds_to_close;
      if (secs == null && m.mins_left != null) secs = Number(m.mins_left) * 60;
      if (secs == null && (clock.close_time || m.close_time)) {
        const ms = Date.parse(clock.close_time || m.close_time);
        if (Number.isFinite(ms)) secs = (ms - Date.now()) / 1000;
      }
      const display = secs == null || isNaN(secs) ? "--:--" : fmtCliLeft(secs);
      if (ledT) ledT.textContent = display;
      const timEl = document.getElementById("windowTimer");
      if (timEl) timEl.textContent = display;
      if (ledSub) ledSub.textContent = "settles 7:00 CT";
      if (dualSub) {
        dualSub.hidden = false;
        const tick = m.kalshi_ticker || clock.ticker || "KXHIGHTDAL";
        const br = clock.bracket || m.bracket || "";
        dualSub.textContent = "DALLAS · " + String(tick) + (br ? (" · " + br) : "");
      }
      if (cityEl) cityEl.textContent = "DFW";
      if (cliEl) cliEl.textContent = "7:00 CT";
      if (kh) {
        const kind = String(clock.strike_type || m.strike_type || "").toLowerCase();
        if (kind === "between" && m.floor_strike != null && m.cap_strike != null) {
          kh.textContent = Math.round(Number(m.floor_strike)) + "–" + Math.round(Number(m.cap_strike)) + "°F";
        } else if (clock.kalshi_high != null) {
          kh.textContent = Math.round(Number(clock.kalshi_high)) + "°F";
        } else {
          kh.textContent = clock.bracket || "—";
        }
      }
      if (nh) nh.textContent = clock.nws_high != null ? (Math.round(Number(clock.nws_high)) + "°F") : "—";
      const nowEl = document.getElementById("wxNowTemp");
      if (nowEl) {
        if (clock.now_f != null && isFinite(Number(clock.now_f))) {
          nowEl.textContent = Math.round(Number(clock.now_f)) + "°F" + (clock.temp_stale ? " · STALE" : "");
        } else {
          nowEl.textContent = clock.temp_stale ? "STALE" : "—";
        }
      }
      if (wxSubs) {
        wxSubs.hidden = !front;
        const subs = frontSubsOf((typeof frontBoard !== "undefined" ? frontBoard : null) || ts);
        FRONT_SUB_IDS.forEach(function (id) {
          const el = wxSubs.querySelector('[data-wx-sub="' + id + '"]');
          const row = subs.find(function (s) { return String(s.id || "").toUpperCase() === id; });
          if (el) {
            el.textContent = id + " " + ((row && row.line) || "—");
            el.setAttribute("data-tone", (row && row.tone) || "miss");
          }
        });
      }
      const upEl = document.getElementById("liveUpPct");
      const dnEl = document.getElementById("liveDownPct");
      if (upEl) upEl.textContent = displayDir((ts.decision && ts.decision.direction) || "WAIT");
      if (dnEl) dnEl.textContent = clock.bracket || "CLI";
      return true;
    }
    if (ats) {
      const ts = (typeof tableState === "function" ? tableState("ats") : null) || {};
      const pick = ts.pick || {};
      const m = ts.market || {};
      const clock = m.clock || ts.clock || {};
      const line = clock.line || atsKickLine(
        pick.close_time || clock.close_time || m.close_time,
        pick.mins_left != null ? pick.mins_left : (clock.mins_left != null ? clock.mins_left : m.mins_left)
      );
      if (ledLabel) ledLabel.textContent = "CLOCK";
      if (ledT) ledT.textContent = line;
      const timEl = document.getElementById("windowTimer");
      if (timEl) timEl.textContent = line;
      if (ledSub) {
        const sport = String(pick.sport || clock.sport || "").trim().toUpperCase();
        const game = pick.game || clock.game || "the game";
        ledSub.textContent = sport ? (sport + " · " + game) : game;
      }
      if (dualSub) {
        dualSub.hidden = true;
        dualSub.textContent = "";
      }
      try { paintAtsGameStrip(ts); } catch (e) {}
      return true;
    }
    if (ledLabel) ledLabel.textContent = "1H WINDOW";
    if (atsStrip) atsStrip.hidden = true;
    if (atsSport) atsSport.hidden = true;
    return false;
  }
  function dockWindowLed() {
    const led = document.getElementById("windowLed");
    if (!led) return;
    if (mode === "floor" && mode !== "night") {
      const header = document.querySelector("#app > header");
      const shell = header && header.querySelector(".mode-tabs-shell");
      const tabs = header && header.querySelector(".mode-tabs");
      const after = shell || tabs;
      if (after && after.parentNode && led.previousElementSibling !== after) {
        after.parentNode.insertBefore(led, after.nextSibling);
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
        list.innerHTML = isFrontTable(focusTable)
          ? '<li class="lock-tape-empty">No Dallas book — waiting on DFW CLI</li>'
          : (isAtsTable(focusTable)
            ? '<li class="lock-tape-empty">No Chair lock this hour — waiting on Ares</li>'
            : '<li class="lock-tape-empty">No Chair lock this hour — waiting on Satoshi / Vitalik / Raijin / Ares</li>');
      } else {
        list.innerHTML = locks.slice(0, 8).map(p => {
          const result = p.status === "OPEN"
            ? "OPEN"
            : (p.grade || p.outcome || "SETTLED");
          const conf = p.conf != null ? (p.conf + "%") : "—";
          const win = p.window || "1H";
          return `<li class="lock-tape-row ${p.status === "OPEN" ? "open" : "settled"}">`
            + `<span class="lt-pair">${p.pair}</span>`
            + `<span class="lt-side ${wxTone(p.side) === "UP" ? "up" : (wxTone(p.side) === "DOWN" ? "down" : "")}">${isFrontTable(focusTable) ? displayDir(p.side) : p.side}</span>`
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
    if (!why && typeof isAtsTable === "function" && isAtsTable(focusTable)) {
      const d = (focused && focused.decision) || {};
      const dir = String(d.direction || "WAIT").toUpperCase();
      why = { side: dir === "WAIT" ? "WAIT" : dir, conf: d.confidence, seats: [], wait: dir === "WAIT", summary: d.summary };
    }
    if (!why && !(typeof isAtsTable === "function" && isAtsTable(focusTable)) && !(typeof isFrontTable === "function" && isFrontTable(focusTable))) {
      const other = focusTable === "ethereum" ? "bitcoin" : "ethereum";
      why = whyThisLockLine((typeof tableState === "function" ? tableState(other) : null) || {});
    }
    if (whyCard && whyLine) {
      if (why) {
        whyCard.classList.remove("hidden");
        if (why.wait || why.side === "WAIT") {
          whyLine.textContent = why.summary || "WAIT · no game on the table";
        } else {
          const seats = (why.seats && why.seats.length)
            ? why.seats.join(" + ")
            : (typeof isAtsTable === "function" && isAtsTable(focusTable) ? "one game · paper" : "council majority");
          whyLine.textContent = `${why.side} · ${why.conf}% · ${seats}`;
        }
        if (typeof isAtsTable === "function" && isAtsTable(focusTable)) {
          const whyAts = (focused && focused.why) || {};
          const watch = (focused && focused.watch) || {};
          const extra = [whyAts.line, whyAts.strip, watch.line].filter(Boolean);
          if (extra.length) whyLine.textContent = extra.join(" · ");
        }
      } else {
        whyCard.classList.add("hidden");
        whyLine.textContent = "—";
      }
    }

    const fightCard = document.getElementById("dualFightCard");
    const deskBook = (typeof isAtsTable === "function" && isAtsTable(focusTable))
      || (typeof isFrontTable === "function" && isFrontTable(focusTable));
    if (fightCard) fightCard.hidden = !!deskBook;
    if (deskBook) return;
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
        close_time: r.close_time || r.window_close,
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
        close_time: r.close_time || r.window_close,
        id: r.id,
        ticker: r.ticker,
      }));
    }
    ["bitcoin", "ethereum", "front", "ats"].forEach(key => {
      const ts = (typeof tableState === "function" ? tableState(key) : null) || {};
      const pair = key === "ats" ? "ATS" : (key === "front" ? "DFW" : (key === "ethereum" ? "ETH" : "BTC"));
      const lc = pairLock(ts);
      if (lc) {
        add({
          pair,
          side: sideFromLockRow(lc),
          t: lc.locked_at,
          status: "OPEN",
          conf: lc.confidence,
          window: windowLabelOf(lc, ts),
          close_time: lc.close_time || (ts.market && ts.market.close_time),
          window_close: lc.window_close,
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
    if (!canvas) return;
    const locks = collectChairLocks();
    const list = document.getElementById("chartTapeList");
    const meta = document.getElementById("chartTapeMeta");
    setChartNoFeed(canvas, !locks.length);
    const ctx = fitCanvas(canvas, { compact: true });
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    if (!locks.length) {
      ctx.fillStyle = "rgba(120,140,160,0.7)";
      ctx.font = "10px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO CHAIR LOCKS YET", w / 2, h / 2);
      if (meta) meta.textContent = "no locks";
      if (list) {
        list.innerHTML = '<li class="chart-lock-empty">NO CHAIR LOCKS YET</li>';
        list.classList.add("empty");
      }
      return;
    }
    if (list) list.classList.remove("empty");
    const pts = locks.slice(0, 16).reverse();
    const pad = { l: 6, r: 6, t: 4, b: 4 };
    const slot = (w - pad.l - pad.r) / Math.max(pts.length, 1);
    const barW = Math.min(8, Math.max(3, slot * 0.45));
    pts.forEach((p, i) => {
      const hit = p.grade === "HIT";
      const miss = p.grade === "MISS";
      const col = hit ? "#39ff14" : (miss ? "#ff2d55" : (p.side === "UP" ? "#39ff14" : (p.side === "DOWN" ? "#ff2d55" : "#8aa0b8")));
      const x = pad.l + i * slot + slot / 2;
      const barH = h - pad.t - pad.b;
      ctx.globalAlpha = p.status === "OPEN" ? 0.9 : 0.55;
      ctx.fillStyle = col;
      ctx.fillRect(x - barW / 2, pad.t, barW, barH);
      ctx.globalAlpha = 1;
    });
    const last = locks[0];
    if (meta && last) {
      const chair = last.pair === "ETH" ? "VITALIK" : "SATOSHI";
      meta.textContent = `${chair} ${last.side} · ${last.status}${last.grade ? " · " + last.grade : ""}`;
    }
    if (list) {
      list.innerHTML = locks.slice(0, 8).map(p => {
        const when = windowLabelOf(p);
        const chair = p.pair === "ETH" ? "VITALIK" : "SATOSHI";
        const mark = p.grade === "HIT" ? "HIT" : (p.grade === "MISS" ? "MISS" : (p.status === "OPEN" ? "OPEN" : "SETTLED"));
        return `<li class="chart-lock-row ${p.status === "OPEN" ? "lock-open" : "lock-settled"}">`
          + `<span class="lock-time">${when}</span>`
          + `<span class="lock-chair">${chair}</span>`
          + `<span class="lock-side ${p.side === "UP" ? "up" : (p.side === "DOWN" ? "down" : "wait")}">${p.side}</span>`
          + `<span class="lock-status">${mark}</span>`
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
    if (!canvas) return;
    const stats = finishOnlyStats();
    const acc = (state && state.accuracy) || {};
    const focusAcc = ((typeof tableState === "function" ? tableState(focusTable) : null) || {}).accuracy || {};
    let hits = stats.correct;
    let total = stats.total;
    let pct = stats.pct;
    let tag = "finish-only";
    if (total === 0 && (Number(focusAcc.total) || 0) > 0) {
      hits = Number(focusAcc.correct) || Number(focusAcc.hits) || 0;
      total = Number(focusAcc.total) || 0;
      pct = total ? (hits / total) * 100 : null;
      tag = "header";
    } else if (total === 0 && (Number(acc.total) || 0) > 0) {
      hits = Number(acc.correct) || Number(acc.hits) || 0;
      total = Number(acc.total) || 0;
      pct = acc.accuracy_pct != null ? Number(acc.accuracy_pct) : (total ? (hits / total) * 100 : null);
      tag = "header";
    }
    if (total === 0) {
      const frac = (document.getElementById("accuracyFrac") || {}).textContent || "";
      const parsed = frac.match(/(\d+)\s*\/\s*(\d+)/);
      if (parsed && Number(parsed[2]) > 0) {
        hits = Number(parsed[1]);
        total = Number(parsed[2]);
        pct = (hits / total) * 100;
        tag = "header";
      }
    }
    const meta = document.getElementById("chartAccMeta");
    setChartNoFeed(canvas, total === 0);
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    if (total === 0) {
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
    } else if (Number.isFinite(pct)) {
      drawLineSeries(ctx, [{ t: Date.now() - 60000, pct }, { t: Date.now(), pct }], p => p.pct, "#39ff14", { zero: 50, yMin: 0, yMax: 100 });
    }
    if (meta) {
      meta.textContent = `${hits}/${total} ${tag}` + (Number.isFinite(pct) ? ` · ${Math.round(pct)}%` : "");
    }
  }

  function drawChartWeights() {
    const canvas = document.getElementById("chartWeights");
    if (!canvas) return;
    const weights = (state && (state.weights || (state.learning && state.learning.weights))) || {};
    const ranked = AGENT_ORDER
      .filter(k => k !== "law")
      .map(k => ({ k, w: Number(weights[k]) || 0, label: AGENT_LABELS[k] || k }))
      .filter(e => Math.abs(e.w) >= 1e-4)
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
      .slice(0, 10);
    setChartNoFeed(canvas, !ranked.length);
    const ctx = fitCanvas(canvas, { rows: ranked.length });
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    if (!ranked.length) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO WEIGHTS", w / 2, h / 2);
      return;
    }
    const cols = ranked.length > 4 ? 2 : 1;
    const rows = Math.ceil(ranked.length / cols);
    const pad = { l: 6, r: 8, t: 6, b: 6 };
    const colW = (w - pad.l - pad.r) / cols;
    const rowH = Math.max(16, (h - pad.t - pad.b) / rows);
    const maxW = Math.max(...ranked.map(e => Math.abs(e.w)), 0.01);
    ranked.forEach((e, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x0 = pad.l + col * colW;
      const y = pad.t + row * rowH;
      ctx.fillStyle = "#c0e8ff";
      ctx.font = "7px Orbitron, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${e.label} ${e.w >= 0 ? "+" : ""}${e.w.toFixed(2)}`, x0, y + 9);
      const barMax = Math.max(12, colW - 8);
      const bw = Math.max(8, (barMax * Math.abs(e.w)) / maxW);
      ctx.fillStyle = e.w >= 0 ? "rgba(0,232,255,0.55)" : "rgba(255,45,85,0.55)";
      ctx.fillRect(x0, y + 11, bw, Math.max(4, rowH - 14));
    });
  }

  function drawCharts() {
    if (mode !== "charts") return;
    if (deskCinematicOn()) return;
    syncChartHero();
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

  function botGuideMarkHtml(key, name) {
    // Same /bots/*.png map Floor seats use. Letter fallback if a file is missing.
    const letter = String(name || key || "?").replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase() || "?";
    const src = (typeof BOT_ICON_FILES !== "undefined" && BOT_ICON_FILES[key]) || "";
    const letterSpan = '<span class="bot-mark-letter" aria-hidden="true">' + letter + '</span>';
    if (!src) return '<span class="bot-mark-wrap no-art">' + letterSpan + '</span>';
    return '<span class="bot-mark-wrap">' +
      '<img class="bot-mark" src="' + src + '" alt="" width="40" height="40" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-art\');" />' +
      letterSpan +
      '</span>';
  }

  function frontBotMarkHtml(id, mark) {
    const letter = String(id || "?").replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase() || "?";
    const src = mark || "";
    const letterSpan = '<span class="bot-mark-letter" aria-hidden="true">' + letter + "</span>";
    if (!src) return '<span class="bot-mark-wrap no-art">' + letterSpan + "</span>";
    return '<span class="bot-mark-wrap">' +
      '<img class="bot-mark" src="' + src + '" alt="" width="40" height="40" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-art\');" />' +
      letterSpan +
      "</span>";
  }
  function renderFrontBotsGuide(data) {
    const grid = document.getElementById("frontBotsGrid");
    if (!grid) return;
    const fallback = [
      { id: "GLASS", job: "NWS PANE", mark: "/static/bots/glass.png" },
      { id: "PIT", job: "THE PIT", mark: "/static/bots/pit.png" },
      { id: "FROST", job: "FROST KILL", mark: "/static/bots/frost.png" },
      { id: "BONE", job: "BONE CLIMO", mark: "/static/bots/bone.png" },
      { id: "MESH", job: "THE WEB", mark: "/static/bots/mesh.png" },
    ];
    const seats = ((data && data.seats) || []).filter(function (s) {
      return s && (s.id === "GLASS" || s.id === "PIT" || s.id === "FROST" || s.id === "BONE" || s.id === "MESH");
    });
    const chair = (data && data.chair) || {
      id: "RAIJIN",
      name: "RAIJIN",
      job: "Weather chair. Hits count like Satoshi / Vitalik. Does not lock the 1H Chair.",
      mark: "/raijin-wait.jpg",
    };
    chair.name = frontChairName(chair);
    const rows = [chair].concat(seats.length ? seats : fallback);
    grid.innerHTML = rows.map(function (s) {
      const n = s.n != null ? s.n : 0;
      const wr = s.wr != null ? (Math.round(Number(s.wr) * 100) + "%") : "—";
      const rank = s.rank ? ("#" + s.rank) : "—";
      const faded = s.faded ? " faded" : "";
      const callsign = (s.id === "RAIJIN") ? frontChairName(s) : String(s.id || "");
      const face = (s.id === "RAIJIN") ? raijinPortraitSrc((s && s.eye) || frontLockDir()) : s.mark;
      const kids = (s.id === "RAIJIN") ? [] : subsForParent(frontSubsOf(data), s.id);
      const subHtml = kids.length ? ('<div class="front-sub-under">' + kids.map(function (sub) {
        return '<div class="front-sub-row" data-tone="' + String(sub.tone || "") + '">' +
          (sub.mark ? '<img src="' + sub.mark + '" alt="">' : '<span class="front-sub-mark"></span>') +
          "<b>" + String(sub.id || "") + "</b><span>" + String(sub.line || "—") + "</span></div>";
      }).join("") + "</div>") : "";
      return '<article class="bot-card front-bot-card' + faded + '" data-front-seat="' + String(s.id || "") + '">' +
        '<div class="bot-card-head">' + frontBotMarkHtml(callsign, face) +
        '<span class="bot-callsign">' + callsign + "</span>" +
        '<span class="bot-rank-pill">' + rank + "</span></div>" +
        '<div class="bot-blurb">' + String(s.job || "") + "</div>" +
        '<div class="bot-stats"><span>n <b>' + n + "</b></span><span>WR <b>" + wr + "</b></span><span>Rank <b>" + rank + "</b></span></div>" +
        subHtml +
        "</article>";
    }).join("");
  }
  function renderBotsGuide() {
    if (typeof isAtsTable === "function" && isAtsTable(focusTable)) {
      const grid = document.getElementById("botsGrid");
      if (!grid) return;
      const ts = (typeof tableState === "function" ? tableState("ats") : null) || {};
      const seats = (ts.agents || []).filter(function (a) { return a && a.agent_name && a.agent_name !== "leader" && !a.sub; });
      const blurbs = {
        line: "The Kalshi book / the number.",
        steam: "Line movement. When the number runs, say so.",
        fade: "Public vs sharp. Fade the loud side.",
        hurt: "Injuries / out.",
        ice: "Veto. 99¢ chalk, empty book, stale, too early, no depth.",
      };
      grid.innerHTML = seats.map(function (a) {
        const key = String(a.agent_name || "").toLowerCase();
        const name = a.display_name || key.toUpperCase();
        const dir = a.direction || "WAIT";
        return '<article class="bot-card">' +
          '<div class="bot-card-head">' + botGuideMarkHtml(key, name) + '<span class="bot-callsign">' + name + '</span></div>' +
          '<div class="bot-blurb">' + (blurbs[key] || a.title || "") + '</div>' +
          '<div class="bot-subs">' + (key === "line" ? "CLOCK under LINE" : key === "fade" ? "FORM under FADE" : key === "ice" ? "WX under ICE" : "Seat") + '</div>' +
          '<div class="bot-stats"><span class="hier-dir ' + dir + '">' + dir + '</span></div>' +
          '</article>';
      }).join("");
      try { renderAtsBotsGuide(atsBoard); } catch (e) {}
      return;
    }
    if (typeof isFrontTable === "function" && isFrontTable(focusTable)) {
      try { renderFrontBotsGuide(typeof frontBoard !== "undefined" ? frontBoard : null); } catch (e) {}
      const grid = document.getElementById("botsGrid");
      if (grid) {
        grid.hidden = true;
        grid.innerHTML = "";
      }
      const hero = document.querySelector("#botsView .info-hero p");
      if (hero) hero.textContent = "Five chairs. GLASS is the pane. MESH is the web. PIT is the book. FROST kills. BONE is old bones. HEAT / ECHO / CELL feed them. They do not vote.";
      return;
    }
    const botsGrid = document.getElementById("botsGrid");
    if (botsGrid) botsGrid.hidden = false;
    const heroP = document.querySelector("#botsView .info-hero p");
    if (heroP && /Dallas daily high/.test(heroP.textContent || "")) {
      heroP.innerHTML = "Each seat reads its own lane + its sub-bots. The Chair only listens as hard as their <b>rank</b> allows. Right calls climb the ladder; wrong calls get quieter until they earn back.";
    }
    try { renderFrontBotsGuide(frontBoard); } catch (e) {}
    if (!frontBoard) {
      try {
        if (typeof frontApi === "function") {
          frontApi("/api/front").then(function (r) { return r && r.ok ? r.json() : null; }).then(function (data) {
            if (data) renderFrontBotsGuide(data);
          }).catch(function () { renderFrontBotsGuide(null); });
        }
      } catch (e) { renderFrontBotsGuide(null); }
    }
    const grid = document.getElementById("botsGrid");
    if (!grid) return;
    const hier = (state && state.hierarchy) || (state && state.learning && state.learning.hierarchy) || [];
    const rankMap = {};
    hier.forEach(r => { rankMap[r.agent] = r; });
    const agents = (state && state.agents) || [];
    const byName = {};
    agents.forEach(a => { byName[a.agent_name] = a; });
    let guideKeys = Object.keys(BOT_GUIDE);
    if (typeof isEthTable === "function" && isEthTable(focusTable) && agents.length) {
      const live = {};
      agents.forEach(a => { if (a && a.agent_name) live[a.agent_name] = true; });
      live.volatility = true;
      live.exhaust = true;
      guideKeys = guideKeys.filter(k => live[k]);
    }
    grid.innerHTML = guideKeys.map(key => {
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
        '<div class="bot-card-head">' + botGuideMarkHtml(key, name) + '<span class="bot-callsign">' + name + '</span><span class="bot-rank-pill">' + rank + '</span></div>' +
        '<div class="bot-title">' + title + '</div>' +
        '<div class="bot-blurb">' + g.blurb + '</div>' +
        '<div class="bot-subs">' + g.subs + '</div>' +
        '<div class="bot-stats"><span>Hits <b>' + hits + '</b></span><span>Miss <b>' + miss + '</b></span><span>WR <b>' + wr + '</b></span><span>Listen <b>' + listen + '</b></span><span class="hier-dir ' + dir + '">' + dir + '</span></div>' +
        '</article>';
    }).join("");
  }


  async function loadAutoPaper() {
    try {
      if (typeof isAtsTable === "function" && isAtsTable(focusTable)) {
        const acc = ((typeof tableState === "function" ? tableState("ats") : null) || {}).accuracy || {};
        const el = document.getElementById("paperAutoSummary");
        if (el) el.textContent = "ATS paper · " + (acc.correct || 0) + "W/" + (acc.wrong || 0) + "L · WAIT " + (acc.wait_n || 0);
        const list = document.getElementById("paperAutoList");
        if (list) {
          const rows = acc.recent || acc.log || [];
          list.innerHTML = rows.slice(0, 12).map(function (row) {
            return '<div class="paper-auto-row">' + (row.side || row.direction || "WAIT") + " · " + (row.ticker || "") + " · " + (row.result || row.outcome || "") + "</div>";
          }).join("") || "<div class=\"paper-auto-row\">No Ares fills yet</div>";
        }
        return;
      }
      if (typeof isFrontTable === "function" && isFrontTable(focusTable)) {
        const acc = ((typeof tableState === "function" ? tableState("front") : null) || {}).accuracy || {};
        const el = document.getElementById("paperAutoSummary");
        if (el) el.textContent = "DFW paper · " + (acc.correct || 0) + "W/" + (acc.wrong || 0) + "L · WAIT " + (acc.wait_n || 0);
        const list = document.getElementById("paperAutoList");
        if (list) {
          const rows = acc.recent || acc.log || [];
          list.innerHTML = rows.slice(0, 12).map(function (row) {
            return '<div class="paper-auto-row">' + (row.direction || "WAIT") + " · " + (row.ticker || "") + " · " + (row.outcome || "") + "</div>";
          }).join("") || "<div class=\"paper-auto-row\">No Front fills yet</div>";
        }
        return;
      }
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

  function paintFloorCrawl() {
    const wrap = document.getElementById("floorCrawl");
    const track = document.getElementById("floorCrawlTrack");
    if (!wrap || !track) return;
    const show = floorLikeMode();
    wrap.hidden = !show;
    wrap.setAttribute("aria-hidden", show ? "false" : "true");
    if (!show) return;
    const chips = [];
    function addChip(pair, side) {
      const raw = String(pair || "").toUpperCase();
      const p = raw === "ETH" || raw === "ETHEREUM" ? "ETH"
        : (raw === "ATS" || raw === "ARES" ? "ATS"
          : (raw === "DFW" || raw === "FRONT" ? "DFW" : "BTC"));
      const s = side && side !== "—" ? String(side).toUpperCase() : "";
      if (!floorSeatDirLocked(s)) return;
      const shown = s === "UP_HOLD" ? "UP" : (s === "DOWN_HOLD" ? "DOWN" : s);
      const chip = p + " " + shown;
      if (chips.indexOf(chip) < 0) chips.push(chip);
    }
    try {
      const b = tableLean((typeof tableState === "function" ? tableState("bitcoin") : null) || {});
      const e = tableLean((typeof tableState === "function" ? tableState("ethereum") : null) || {});
      if (b && b.locked) addChip("BTC", b.side);
      if (e && e.locked) addChip("ETH", e.side);
    } catch (err) {}
    try {
      const locks = (typeof collectChairLocks === "function") ? collectChairLocks() : [];
      locks.forEach(function (p) {
        if (chips.length >= 5) return;
        addChip(p.pair, p.side);
      });
    } catch (err) {}
    if (!chips.length) {
      track.textContent = "";
      wrap.hidden = true;
      wrap.setAttribute("aria-hidden", "true");
      return;
    }
    const line = chips.slice(0, 5).join(" · ");
    track.textContent = line + " · " + line;
  }

  function chairWhyLineText(ts) {
    const view = ts || (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    const d = view.decision || {};
    const m = view.market || {};
    const h = view.health || (state && state.health) || {};
    const lc = view.locked_call || d.locked_call || {};
    const rawDir = String((lc && lc.direction) || d.direction || "WAIT").toUpperCase();
    const sportsLock = !!(lc && lc.locked && rawDir && rawDir !== "WAIT" && !/^(UP|DOWN)/.test(rawDir));
    const locked = !!(lc && lc.locked && lc.direction && (/UP|DOWN/.test(String(lc.direction).toUpperCase()) || sportsLock));
    const raw = String((locked ? lc.direction : (d.direction || "WAIT"))).toUpperCase();
    const side = (raw === "COVER" || raw === "NO-COVER" || raw === "OVER" || raw === "UNDER" || raw === "HOME" || raw === "AWAY" || (raw && raw !== "WAIT" && raw !== "YES" && raw !== "NO" && !raw.includes("UP") && !raw.includes("DOWN") && raw.length <= 5))
      ? raw
      : (raw.indexOf("UP") >= 0 ? "UP" : (raw.indexOf("DOWN") >= 0 ? "DOWN" : "WAIT"));
    const yb = m.kalshi_yes_bid != null ? Number(m.kalshi_yes_bid) : (m.up_pct != null ? Number(m.up_pct) : null);
    const ya = m.kalshi_yes_ask != null ? Number(m.kalshi_yes_ask) : null;
    const down = yb != null ? (100 - yb) : (m.down_pct != null ? Number(m.down_pct) : null);
    const ev = lc.ev_cents != null ? Number(lc.ev_cents) : (d.ev_cents != null ? Number(d.ev_cents) : null);
    const stale = !!(m.stale || h.stale || (h.quote_age_s != null && Number(h.quote_age_s) > 20));
    const empty = !(m.kalshi_ticker || m.ticker) || (yb == null && ya == null);
    const wall99 = (yb != null && yb >= 99) || (down != null && down >= 99) || (ya != null && ya >= 99);
    const evBit = (ev != null && isFinite(ev)) ? ("EV " + (ev >= 0 ? "+" : "") + Math.round(ev) + "¢") : "";
    if (typeof isFrontTable === "function" && isFrontTable(focusTable)) {
      const lean = displayDir(locked ? lc.direction : (d.direction || "WAIT"));
      return frontHighLine(view) + " · " + lean + (empty ? " · no Dallas book" : "");
    }
    if (locked) {
      const extras = [];
      if (!empty && !wall99) extras.push("book has size");
      if (evBit) extras.push(evBit);
      return extras.length ? ("LOCK " + side + " · " + extras.join(", ")) : ("LOCK " + side);
    }
    const bits = ["WAIT"];
    if (wall99 && down != null && down >= 99) bits.push("DOWN is 99¢, no edge");
    else if (wall99 && yb != null && yb >= 99) bits.push("UP is 99¢, no edge");
    else if (wall99) bits.push("≥99¢ wall, no edge");
    else if (empty) bits.push("empty book");
    else if (stale) bits.push("stale quote");
    else if (ev != null && ev <= 0) bits.push("no edge");
    else if (/dead book/i.test(String(d.summary || ""))) bits.push("dead book");
    else if (evBit) bits.push(evBit);
    else bits.push("no edge");
    return bits.slice(0, 3).join(" · ");
  }

  function paintAtsWhy(ts) {
    const wrap = document.getElementById("atsWhy");
    const line = document.getElementById("atsWhyLine");
    const strip = document.getElementById("atsWhyStrip");
    const ats = typeof isAtsTable === "function" && isAtsTable(focusTable);
    const show = ats && (mode === "art" || mode === "floor" || mode === "night");
    if (wrap) wrap.hidden = !show;
    if (!show) return;
    const view = ts || (typeof tableState === "function" ? tableState("ats") : null) || {};
    const why = view.why || (view.pick && view.pick.why) || {};
    if (line) line.textContent = String(why.line || "WHY · DARK · NO GAME ON THE TABLE");
    if (strip) strip.textContent = String(why.strip || "LINE SIT · STEAM SIT · FADE SIT · HURT DARK · ICE DARK");
  }

  function paintAtsWatch(ts) {
    const el = document.getElementById("atsWatch");
    if (!el) return;
    const ats = typeof isAtsTable === "function" && isAtsTable(focusTable);
    const show = ats && (mode === "art" || mode === "floor" || mode === "night");
    el.hidden = !show;
    if (!show) return;
    const view = ts || (typeof tableState === "function" ? tableState("ats") : null) || {};
    const watch = view.watch || (view.pick && view.pick.watch) || {};
    el.textContent = String(watch.line || "WATCH · DARK · NO GAME ON THE TABLE");
    el.dataset.listed = watch.listed ? "1" : "0";
  }

  function paintChairWhy() {
    const el = document.getElementById("chairWhy");
    if (!el) return;
    const show = mode === "art" || mode === "floor" || mode === "night";
    el.hidden = !show;
    if (!show) return;
    const ts = (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    if (typeof isAtsTable === "function" && isAtsTable(focusTable)) {
      const why = ts.why || (ts.pick && ts.pick.why) || {};
      el.textContent = String(why.line || chairWhyLineText(ts));
    } else {
      el.textContent = chairWhyLineText(ts);
    }
    try { paintAtsWhy(ts); } catch (e) {}
    try { paintAtsWatch(ts); } catch (e) {}
  }

  function paintPhoneScore() {
    const el = document.getElementById("phoneScore");
    if (!el) return;
    const phoneFloor = (typeof isPhoneDesk === "function" && isPhoneDesk()) && (mode === "floor" || mode === "night");
    el.hidden = !phoneFloor;
    if (!phoneFloor) return;
    const sc = (typeof scorecardFromState === "function") ? scorecardFromState() : {};
    const eth = focusTable === "ethereum";
    const front = typeof isFrontTable === "function" && isFrontTable(focusTable);
    const ats = typeof isAtsTable === "function" && isAtsTable(focusTable);
    const oracle = typeof isOracleTable === "function" && isOracleTable(focusTable);
    el.textContent = oracle ? "ORACLE · WATCH" : (ats ? (sc.ats_text || "ATS 0–0") : (front ? (sc.front_text || "DFW 0–0") : (eth ? (sc.eth_text || "0–0 ETH") : (sc.btc_text || "BTC 0–0"))));
    el.setAttribute("aria-label", "Flip focused Chair");
  }

  function paintHealthStrip(data) {
    const strip = document.getElementById("healthStrip");
    if (!strip) return;
    const unlocked = (typeof hasDeskAuth === "function") ? hasDeskAuth() : true;
    strip.hidden = !unlocked;
    if (!unlocked || !data) return;
    function setDot(id, ok) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("down", !ok);
      el.classList.toggle("up", !!ok);
    }
    const kalshi = data.kalshi_ok != null ? !!data.kalshi_ok : !!(data.kalshi_btc_ok !== false);
    setDot("healthKalshi", kalshi);
    setDot("healthSpot", !!data.spot_ok);
    setDot("healthGlass", !!data.coinglass_ok);
    const ageEl = document.getElementById("healthAge");
    const age = data.quote_age_s != null ? data.quote_age_s : data.state_age_s;
    if (ageEl) ageEl.textContent = (age != null && isFinite(Number(age))) ? (Math.round(Number(age)) + "s") : "—";
  }

  async function loadHealthStrip() {
    try {
      const r = await fetch((typeof API_BASE === "string" ? API_BASE : "") + "/health", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      paintHealthStrip(await r.json());
    } catch (e) {
      paintHealthStrip({ kalshi_ok: false, spot_ok: false, coinglass_ok: false, quote_age_s: null });
    }
  }
  window.loadHealthStrip = loadHealthStrip;

  function fmtP(p) {
    if (p == null || p === "") return "—";
    const n = Number(p);
    if (!isFinite(n)) return "—";
    return (n <= 1 ? Math.round(n * 100) : Math.round(n)) + "%";
  }
  function fmtEv(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(1) + "¢";
  }
  function fmtPnl(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2);
  }

  async function loadChairTape() {
    const table = document.getElementById("tapeTable");
    const meta = document.getElementById("tapeMeta");
    const calib = document.getElementById("tapeCalib");
    if (typeof isAtsTable === "function" && isAtsTable(focusTable)) {
      try { if (typeof loadAtsTable === "function") await loadAtsTable(); } catch (e) {}
      const acc = ((typeof tableState === "function" ? tableState("ats") : null) || {}).accuracy || {};
      const rows = acc.log || acc.recent || [];
      if (meta) meta.textContent = rows.length ? (rows.length + " Ares prints") : "honest empty";
      if (calib) calib.innerHTML = '<div class="calib-empty">Ares grades on the official finish — one game, paper only.</div>';
      if (table) {
        if (!rows.length) {
          table.innerHTML = '<div class="tape-empty">No Ares paper locks yet. WAIT is a print.</div>';
        } else {
          const head = '<div class="tape-row head"><span>GAME</span><span>ASSET</span><span>SIDE</span><span>KIND</span><span>LEFTOVER</span><span>ODDS</span><span>RESULT</span><span>P&L</span></div>';
          const body = rows.map(function (row) {
            const res = row.result || "OPEN";
            const cls = res === "HIT" ? "hit" : (res === "MISS" ? "miss" : "open");
            return '<div class="tape-row ' + cls + '">'
              + '<span>' + (row.number || row.title || row.game || "—") + '</span>'
              + '<span>ATS</span>'
              + '<span>' + (row.side || "WAIT") + '</span>'
              + '<span>' + (row.kind || "—") + '</span>'
              + '<span>' + (row.leftover != null ? (Number(row.leftover).toFixed(1) + "¢") : "—") + '</span>'
              + '<span>' + (row.mid != null ? Math.round(Number(row.mid)) + "¢" : "—") + '</span>'
              + '<span class="tape-res">' + res + '</span>'
              + '<span>' + (res === "OPEN" ? "—" : (row.pnl != null ? row.pnl : "—")) + '</span>'
              + '</div>';
          }).join("");
          table.innerHTML = head + body;
        }
      }
      return;
    }
    try {
      const r = await fetch((typeof API_BASE === "string" ? API_BASE : "") + "/api/tape", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (meta) meta.textContent = rows.length ? (rows.length + " hours") : "honest empty";
      if (calib) {
        const buckets = Array.isArray(data.calibration) ? data.calibration : [];
        calib.innerHTML = buckets.map(function (b) {
          const pred = b.predicted != null ? Math.round(b.predicted * 100) + "%" : "—";
          const hit = b.realized != null ? Math.round(b.realized * 100) + "%" : "—";
          const gap = b.gap != null && b.n ? (b.gap < 0 ? "miss" : "ok") : "";
          return '<div class="calib-bucket ' + gap + '"><span class="cb-lab">' + b.bucket + '</span>'
            + '<span class="cb-pred">said ' + pred + '</span>'
            + '<span class="cb-hit">hit ' + hit + '</span>'
            + '<span class="cb-n">n=' + (b.n || 0) + '</span></div>';
        }).join("") || '<div class="calib-empty">No graded hours yet — calibration waits on official finishes.</div>';
      }
      if (table) {
        if (!rows.length) {
          table.innerHTML = '<div class="tape-empty">No Chair locks in the last 24 hours.</div>';
        } else {
          const head = '<div class="tape-row head"><span>WINDOW</span><span>ASSET</span><span>SIDE</span><span>P(FINISH)</span><span>EV</span><span>ODDS</span><span>RESULT</span><span>P&L</span></div>';
          const body = rows.map(function (row) {
            const res = row.result || "OPEN";
            const cls = res === "HIT" ? "hit" : (res === "MISS" ? "miss" : "open");
            return '<div class="tape-row ' + cls + '">'
              + '<span>' + (row.window || "1H") + '</span>'
              + '<span>' + String(row.asset || "").toUpperCase() + '</span>'
              + '<span class="side-' + String(row.side || "").toLowerCase() + '">' + (row.side || "—") + '</span>'
              + '<span>' + fmtP(row.p_finish) + '</span>'
              + '<span>' + fmtEv(row.ev_cents) + '</span>'
              + '<span>' + (row.odds != null ? Math.round(row.odds) + "¢" : "—") + '</span>'
              + '<span class="tape-res">' + res + '</span>'
              + '<span>' + (res === "OPEN" ? "—" : fmtPnl(row.pnl)) + '</span>'
              + '</div>';
          }).join("");
          table.innerHTML = head + body;
        }
      }
    } catch (e) {
      if (table) table.innerHTML = '<div class="tape-empty">Tape feed quiet — try again.</div>';
      if (meta) meta.textContent = "offline";
    }
  }

  function renderBookSide(bodyId, flagId, side) {
    const body = document.getElementById(bodyId);
    const flag = document.getElementById(flagId);
    if (!side) {
      if (body) body.textContent = "No book yet.";
      if (flag) flag.textContent = "empty";
      return;
    }
    if (flag) {
      flag.textContent = side.flag || (side.empty ? "empty book" : "live");
      flag.className = "book-flag" + (side.flag ? " warn" : "");
    }
    if (!body) return;
    const row = function (lab, val) {
      return '<div class="book-kv"><span>' + lab + '</span><b>' + val + '</b></div>';
    };
    const cents = function (v) { return v != null ? Math.round(Number(v)) + "¢" : "—"; };
    const sz = function (v) { return v != null ? String(Math.round(Number(v))) : "—"; };
    body.innerHTML =
      row("BID", cents(side.yes_bid)) +
      row("ASK", cents(side.yes_ask)) +
      row("SIZE", sz(side.yes_bid_sz) + " / " + sz(side.no_bid_sz)) +
      row("SPREAD", side.spread != null ? side.spread + "¢" : "—") +
      row("MID", cents(side.mid)) +
      row("DEPTH", sz(side.yes_depth) + " yes · " + sz(side.no_depth) + " no") +
      row("WINDOW", side.window || "—") +
      (side.ticker ? row("TICKER", side.ticker) : "");
  }

  async function loadKalshiBook() {
    try {
      const r = await fetch((typeof API_BASE === "string" ? API_BASE : "") + "/api/book", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      renderBookSide("bookBtcBody", "bookBtcFlag", data.satoshi);
      renderBookSide("bookEthBody", "bookEthFlag", data.vitalik);
    } catch (e) {
      renderBookSide("bookBtcBody", "bookBtcFlag", { flag: "empty book", empty: true });
      renderBookSide("bookEthBody", "bookEthFlag", { flag: "empty book", empty: true });
    }
  }

  async function loadBrainRecap() {
    const head = document.getElementById("brainHeadline");
    const louder = document.getElementById("brainLouder");
    const faded = document.getElementById("brainFaded");
    const sat = document.getElementById("brainSatoshi");
    const vit = document.getElementById("brainVitalik");
    const notes = document.getElementById("brainNotes");
    try {
      const r = await fetch((typeof API_BASE === "string" ? API_BASE : "") + "/api/brain/recap", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      if (head) head.textContent = data.empty ? (data.note || "No huddle recap yet") : (data.headline || "Last huddle");
      function list(el, rows, emptyTxt) {
        if (!el) return;
        if (!rows || !rows.length) {
          el.innerHTML = "<li class=\"brain-empty\">" + emptyTxt + "</li>";
          return;
        }
        el.innerHTML = rows.map(function (s) {
          const wr = s.win_rate != null ? (" · " + Math.round(Number(s.win_rate) * 100) + "%") : "";
          return "<li><b>" + (s.seat || "—") + "</b> <span>" + (s.table || "") + wr + (s.note ? " · " + s.note : "") + "</span></li>";
        }).join("");
      }
      list(louder, data.louder, "No seat got louder.");
      list(faded, data.faded, "No seat got faded.");
      if (sat) {
        const s = data.satoshi || {};
        sat.textContent = "SATOSHI · " + (s.note || "—");
      }
      if (vit) {
        const v = data.vitalik || {};
        vit.textContent = "VITALIK · " + (v.note || "—");
      }
      if (notes) {
        const bits = [].concat(data.went_well || [], data.went_poor || [], data.patterns || []);
        notes.innerHTML = bits.slice(0, 8).map(function (n) { return "<li>" + n + "</li>"; }).join("")
          || "<li>Honest empty — wait for the 3:00 AM CT huddle.</li>";
      }
    } catch (e) {
      if (head) head.textContent = "Brain feed quiet";
    }
  }

  async function loadDeskNews() {
    const coming = document.getElementById("newsComing");
    const breaking = document.getElementById("newsBreaking");
    const liq = document.getElementById("newsLiq");
    try {
      const r = await fetch((typeof API_BASE === "string" ? API_BASE : "") + "/api/news", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      if (liq) {
        if (data.liq_burst) {
          liq.textContent = data.liq_burst;
          liq.classList.remove("hidden");
        } else {
          liq.classList.add("hidden");
        }
      }
      if (coming) {
        const rows = data.coming_up || [];
        coming.innerHTML = rows.length
          ? rows.map(function (e) {
              return '<li><b>' + (e.kind || "PRINT") + '</b> ' + (e.title || "")
                + '<span class="news-eta">' + (e.eta || "") + ' · ' + (e.when_ct || "") + '</span></li>';
            }).join("")
          : '<li class="news-empty">No upcoming print loaded.</li>';
      }
      if (breaking) {
        const rows = data.breaking || [];
        const newsSig = rows.map(function (h) { return h.title || ""; }).join("|") + "|" + (data.liq_burst || "");
        if (newsSig && newsSig !== _newsPulseSig) {
          _newsPulseSig = newsSig;
          if (rows.length || data.liq_burst) {
            try { bumpChairPulse("bitcoin", 0.42); bumpChairPulse("ethereum", 0.42); } catch (e) {}
          }
        }
        breaking.innerHTML = rows.length
          ? rows.map(function (h) {
              const cls = (h.stale ? "stale" : "fresh") + (h.heat ? " heat" : "");
              return '<li class="' + cls + '"><b>' + (h.source || "") + '</b> ' + (h.title || "")
                + '<span class="news-eta">' + (h.when_ct || "") + (h.heat ? " · this hour" : "") + '</span></li>';
            }).join("")
          : '<li class="news-empty">No recent headline.</li>';
      }
    } catch (e) {
      if (coming) coming.innerHTML = '<li class="news-empty">Calendar feed quiet.</li>';
      if (breaking) breaking.innerHTML = '<li class="news-empty">Headline feed quiet.</li>';
    }
  }

  const WIRE_SEEN_KEY = "council_wire_seen";

  function wireEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wireEntries() {
    const raw = window.COUNCIL_WIRE;
    return Array.isArray(raw) ? raw.slice() : [];
  }

  function newestWire(entries) {
    const rows = entries || wireEntries();
    return rows[0] || null;
  }

  function readWireSeen() {
    try {
      const raw = localStorage.getItem(WIRE_SEEN_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      return { id: String(o.id || ""), at: String(o.at || "") };
    } catch (e) {
      return null;
    }
  }

  function wireIsUnread(entries) {
    const rows = entries || wireEntries();
    if (!rows.length) return false;
    const seen = readWireSeen();
    if (!seen || !seen.id) return true;
    const newest = newestWire(rows);
    if (!newest) return false;
    if (newest.id && newest.id !== seen.id) return true;
    if (newest.at && seen.at && String(newest.at) > String(seen.at)) return true;
    return false;
  }

  function markWireSeen(entries) {
    const newest = newestWire(entries || wireEntries());
    if (!newest) return;
    try {
      localStorage.setItem(WIRE_SEEN_KEY, JSON.stringify({ id: newest.id || "", at: newest.at || "" }));
    } catch (e) {}
  }

  function formatWireDate(iso) {
    try {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return String(iso || "");
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(d);
    } catch (e) {
      return String(iso || "");
    }
  }

  function syncWireHot(entries) {
    const tab = document.getElementById("tabWire");
    if (!tab) return;
    const hot = (typeof mode === "undefined" || mode !== "wire") && wireIsUnread(entries || wireEntries());
    tab.classList.toggle("wire-hot", hot);
    tab.setAttribute("data-wire-hot", hot ? "1" : "0");
  }

  function paintWireLog() {
    const list = document.getElementById("wireList");
    if (!list) return;
    const rows = wireEntries();
    if (!rows.length) {
      list.innerHTML = '<li class="wire-empty">No desk notes yet.</li>';
      return;
    }
    list.innerHTML = rows.map(function (e) {
      return '<li class="wire-item">'
        + '<h3 class="wire-title">' + wireEsc(e.title) + '</h3>'
        + '<p class="wire-why">' + wireEsc(e.why) + '</p>'
        + '<time class="wire-date" datetime="' + wireEsc(e.at) + '">' + wireEsc(formatWireDate(e.at)) + '</time>'
        + '</li>';
    }).join("");
  }

  function loadDeskWire() {
    paintWireLog();
    markWireSeen(wireEntries());
    syncWireHot();
  }

  const SCHOOL_KEY = "council_school_v1";
  const SCHOOL_SNAP = {
    strike: 100000,
    seconds_left: 1840,
    candles: [
      { o: 99920, h: 100040, l: 99880, c: 100010 },
      { o: 100010, h: 100120, l: 99980, c: 100080 },
      { o: 100080, h: 100160, l: 100020, c: 100040 },
      { o: 100040, h: 100090, l: 99950, c: 99970 },
      { o: 99970, h: 100020, l: 99890, c: 99940 },
    ],
    book: { yes_bid: 48, yes_ask: 50, yes_sz: 22, no_bid: 51, no_sz: 18 },
  };
  const SCHOOL_TF = ["True", "False"];
  const SCHOOL_LESSONS = [
    { id: "hour", n: 1, title: "The hour", minutes: 6, idea: "Kalshi is not “is Bitcoin going up forever.” It is one window.", body: ["Kalshi is not “is Bitcoin going up forever.” It is one window. A strike is the line. UP means finish above it when the clock hits zero. DOWN means finish below. Forty minutes left is a different game than four. The Chair only has to be right at the bell, not the whole hour."], board: "window", callout: "A strike is the line.", quiz: [{ q: "This desk is guessing the next year of Bitcoin.", choices: SCHOOL_TF, answer: 1 }, { q: "UP means finish above the strike at the end of the hour.", choices: SCHOOL_TF, answer: 0 }, { q: "Time left does not change the trade.", choices: SCHOOL_TF, answer: 1 }] },
    { id: "candle", n: 2, title: "Reading the candle", minutes: 7, idea: "The body is where price spent the time. The wick is the rejected poke.", body: ["The body is where price spent the time. The wick is the rejected poke. A long upper wick into the strike and a close back under it is not strength. It is a failed break. Watch close vs strike, not the loudest wick."], board: "candle", callout: "Watch close vs strike, not the loudest wick.", quiz: [{ q: "The wick is more important than the close.", choices: SCHOOL_TF, answer: 1 }, { q: "A long upper wick that closes back under the strike is a failed break.", choices: SCHOOL_TF, answer: 0 }, { q: "The body shows where price actually spent the time.", choices: SCHOOL_TF, answer: 0 }] },
    { id: "book", n: 3, title: "The book", minutes: 8, idea: "Bid is what people will pay. Ask is what they will sell.", body: ["Bid is what people will pay. Ask is what they will sell. Size is whether that price is real. If DOWN is 99¢, the market already thinks it is over. Buying that is paying a dollar to maybe win a penny. That is why the Chair WAITs. An empty book is the same: no one there to take the other side."], board: "book", callout: "If DOWN is 99¢, the market already thinks it is over.", quiz: [{ q: "A 99¢ DOWN is a great lock because it is almost sure.", choices: SCHOOL_TF, answer: 1 }, { q: "Size tells you if the price is actually there.", choices: SCHOOL_TF, answer: 0 }, { q: "An empty book is a reason to WAIT.", choices: SCHOOL_TF, answer: 0 }] },
    { id: "edge", n: 4, title: "Odds vs P(finish)", minutes: 8, idea: "Odds are the market’s price. P(finish) is the Chair’s guess you finish on that side.", body: ["Odds are the market’s price. P(finish) is the Chair’s guess you finish on that side. EV is the gap after the spread. If the Chair says 62% and DOWN costs 99¢, there is no edge. If it says 62% and UP costs 48¢ with size, that is a conversation. Never lock just because a seat is loud."], board: "edge", callout: "If the Chair says 62% and DOWN costs 99¢, there is no edge.", quiz: [{ q: "A high Chair confidence is enough to lock.", choices: SCHOOL_TF, answer: 1 }, { q: "EV is P(finish) versus the price you actually pay, after spread.", choices: SCHOOL_TF, answer: 0 }, { q: "Market odds and Chair P(finish) are the same number.", choices: SCHOOL_TF, answer: 1 }] },
    { id: "seats", n: 5, title: "The seats", minutes: 6, idea: "WICK reads the candle. TAPE reads the flow. CARRY reads funding. CLOCK reads the session.", body: ["WICK reads the candle. TAPE reads the flow. CARRY reads funding. CLOCK reads the session. They vote. The Chair only listens as hard as their rank. A hot seat with a bad record gets quieter. You are not picking a favorite bot. You are watching who earned the mic."], board: "seats", callout: "The Chair only listens as hard as their rank.", quiz: [{ q: "The loudest seat should decide the lock.", choices: SCHOOL_TF, answer: 1 }, { q: "Rank is how hard the Chair hears that seat.", choices: SCHOOL_TF, answer: 0 }, { q: "WICK, TAPE, CARRY, and CLOCK each watch a different lane.", choices: SCHOOL_TF, answer: 0 }] },
  ];
  let schoolLessons = SCHOOL_LESSONS.slice();
  let schoolOpenId = null;
  let schoolQIndex = 0;
  let schoolAnswered = false;

  function schoolWeekId() {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", week: "numeric", year: "numeric" });
      const parts = fmt.formatToParts(new Date());
      const y = (parts.find(function (p) { return p.type === "year"; }) || {}).value;
      const w = (parts.find(function (p) { return p.type === "week"; }) || {}).value;
      if (y && w) return y + "-W" + String(w).padStart(2, "0");
    } catch (e) {}
    const d = new Date();
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    return t.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
  }
  function loadSchoolProgress() {
    try {
      const raw = localStorage.getItem(SCHOOL_KEY);
      const p = raw ? JSON.parse(raw) : {};
      if (!p || typeof p !== "object") return { done: [], current: "hour", q: 0, week: { id: schoolWeekId(), n: 0 } };
      if (!Array.isArray(p.done)) p.done = [];
      if (!p.week || p.week.id !== schoolWeekId()) p.week = { id: schoolWeekId(), n: 0 };
      return p;
    } catch (e) {
      return { done: [], current: "hour", q: 0, week: { id: schoolWeekId(), n: 0 } };
    }
  }
  function saveSchoolProgress(p) {
    try { localStorage.setItem(SCHOOL_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function schoolById(id) {
    return schoolLessons.find(function (l) { return l.id === id; }) || schoolLessons[0];
  }
  function schoolNextId(done) {
    const have = done || [];
    for (let i = 0; i < schoolLessons.length; i++) {
      if (have.indexOf(schoolLessons[i].id) < 0) return schoolLessons[i].id;
    }
    return schoolLessons[0].id;
  }
  function schoolUnlocked(id, done) {
    const idx = schoolLessons.findIndex(function (l) { return l.id === id; });
    if (idx <= 0) return true;
    return (done || []).indexOf(schoolLessons[idx - 1].id) >= 0;
  }

  function schoolLiveMarket() {
    const ts = (typeof tableState === "function" ? tableState(focusTable) : null) || state || {};
    return ts.market || (state && state.market) || {};
  }
  function schoolLiveBook() {
    const m = schoolLiveMarket();
    const yb = m.kalshi_yes_bid != null ? Number(m.kalshi_yes_bid) : (m.up_pct != null ? Number(m.up_pct) : null);
    const ya = m.kalshi_yes_ask != null ? Number(m.kalshi_yes_ask) : null;
    if (yb == null && ya == null) return null;
    return {
      yes_bid: yb,
      yes_ask: ya,
      yes_sz: m.kalshi_yes_bid_sz != null ? m.kalshi_yes_bid_sz : null,
      no_bid: yb != null ? Math.round((100 - yb) * 10) / 10 : null,
      live: true,
    };
  }
  function paintSchoolBoard(kind) {
    const canvas = document.getElementById("schoolBoard");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 220;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW, h = cssH;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(2, 6, 14, 0.92)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0, 232, 255, 0.18)";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const m = schoolLiveMarket();
    const liveCandles = (m.candles || []).slice(-16);
    const candles = liveCandles.length >= 3 ? liveCandles : SCHOOL_SNAP.candles;
    const strike = Number(m.kalshi_target) || SCHOOL_SNAP.strike;
    const secs = m.seconds_left != null ? Number(m.seconds_left) : SCHOOL_SNAP.seconds_left;
    const live = liveCandles.length >= 3;

    function drawCandles(callouts) {
      const pad = { l: 36, r: 10, t: 18, b: 16 };
      const rows = candles.map(function (c) {
        return { o: Number(c.o != null ? c.o : c.open), h: Number(c.h != null ? c.h : c.high), l: Number(c.l != null ? c.l : c.low), c: Number(c.c != null ? c.c : c.close) };
      }).filter(function (c) { return isFinite(c.o) && isFinite(c.c); });
      if (!rows.length) return;
      let min = Math.min.apply(null, rows.map(function (c) { return Math.min(c.l, c.c, strike); }));
      let max = Math.max.apply(null, rows.map(function (c) { return Math.max(c.h, c.c, strike); }));
      const span = (max - min) || 1;
      min -= span * 0.08; max += span * 0.08;
      const yAt = function (p) { return pad.t + (1 - (p - min) / (max - min || 1)) * (h - pad.t - pad.b); };
      ctx.strokeStyle = "rgba(240, 193, 74, 0.7)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, yAt(strike)); ctx.lineTo(w - pad.r, yAt(strike)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(240, 193, 74, 0.85)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "left";
      ctx.fillText("STRIKE", pad.l, yAt(strike) - 4);
      const cw = (w - pad.l - pad.r) / rows.length;
      rows.forEach(function (c, i) {
        const x = pad.l + i * cw + cw / 2;
        const up = c.c >= c.o;
        ctx.strokeStyle = up ? "#39ff14" : "#ff2d55";
        ctx.beginPath(); ctx.moveTo(x, yAt(c.h)); ctx.lineTo(x, yAt(c.l)); ctx.stroke();
        const by = Math.min(yAt(c.o), yAt(c.c));
        const bh = Math.max(2, Math.abs(yAt(c.c) - yAt(c.o)));
        ctx.fillStyle = up ? "rgba(57,255,20,0.85)" : "rgba(255,45,85,0.85)";
        ctx.fillRect(x - Math.max(2, cw * 0.28), by, Math.max(4, cw * 0.56), bh);
      });
      if (callouts) {
        const last = rows[rows.length - 1];
        ctx.fillStyle = "rgba(232,244,255,0.8)";
        ctx.font = "11px Rajdhani, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("body", w - pad.r, Math.min(yAt(last.o), yAt(last.c)) - 2);
        ctx.fillText("wick", w - pad.r, yAt(last.h) + 10);
      }
      ctx.fillStyle = "rgba(180,200,220,0.55)";
      ctx.font = "10px Orbitron, monospace";
      ctx.textAlign = "left";
      ctx.fillText(live ? "LIVE / LAST HOUR" : "STILL · last hour", pad.l, h - 4);
    }

    if (kind === "window") {
      drawCandles(false);
      ctx.fillStyle = "rgba(57,255,20,0.75)";
      ctx.font = "12px Orbitron, monospace";
      ctx.textAlign = "right";
      ctx.fillText("UP", w - 12, 22);
      ctx.fillStyle = "rgba(255,45,85,0.8)";
      ctx.fillText("DOWN", w - 12, h - 20);
      const mm = Math.max(0, Math.floor(secs / 60));
      const ss = Math.max(0, Math.floor(secs % 60));
      ctx.fillStyle = "#e8f4ff";
      ctx.font = "13px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("THIS WINDOW · " + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0"), w / 2, 16);
    } else if (kind === "candle") {
      drawCandles(true);
    } else if (kind === "book") {
      const liveB = schoolLiveBook();
      const b = liveB || SCHOOL_SNAP.book;
      const wall = (b.yes_bid != null && b.yes_bid >= 99) || (b.no_bid != null && b.no_bid >= 99);
      function bar(y, label, px, sz, col) {
        ctx.fillStyle = "rgba(200,220,240,0.7)";
        ctx.font = "12px Orbitron, monospace";
        ctx.textAlign = "left";
        ctx.fillText(label, 16, y + 12);
        const ww = Math.max(8, ((px || 0) / 100) * (w - 160));
        ctx.fillStyle = col;
        ctx.fillRect(90, y, ww, 18);
        ctx.fillStyle = "#e8f4ff";
        ctx.fillText((px != null ? Math.round(px) + "¢" : "—") + (sz != null ? " × " + sz : ""), 96 + ww, y + 13);
      }
      bar(36, "BID", b.yes_bid, b.yes_sz, "rgba(57,255,20,0.55)");
      bar(70, "ASK", b.yes_ask, null, "rgba(0,232,255,0.45)");
      bar(104, "NO", b.no_bid, b.no_sz, "rgba(255,45,85,0.45)");
      ctx.fillStyle = wall ? "#ffb000" : "rgba(200,220,240,0.7)";
      ctx.font = "13px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText(wall ? "99¢ WALL · WAIT" : ((liveB ? "LIVE BOOK" : "STILL · BOOK") + " · size is the truth"), w / 2, h - 16);
    } else if (kind === "edge") {
      const d = ((typeof tableState === "function" ? tableState(focusTable) : null) || state || {}).decision || {};
      const p = d.p_finish != null ? Number(d.p_finish) : 0.62;
      const pPct = p <= 1 ? p * 100 : p;
      const ask = (schoolLiveBook() || SCHOOL_SNAP.book).yes_ask || 70;
      ctx.fillStyle = "rgba(200,220,240,0.75)";
      ctx.font = "12px Orbitron, monospace";
      ctx.textAlign = "left";
      ctx.fillText("P(FINISH)  " + Math.round(pPct) + "%", 20, 40);
      ctx.fillRect(20, 50, Math.max(8, (pPct / 100) * (w - 40)), 16);
      ctx.fillText("ASK / ODDS  " + Math.round(ask) + "¢", 20, 96);
      ctx.fillStyle = "rgba(0,232,255,0.45)";
      ctx.fillRect(20, 106, Math.max(8, (ask / 100) * (w - 40)), 16);
      const ev = pPct - ask;
      ctx.fillStyle = ev > 0 ? "#39ff14" : "#ffb000";
      ctx.font = "14px Orbitron, monospace";
      ctx.fillText(ev > 0 ? ("EDGE after spread · +" + ev.toFixed(0) + "¢") : "NO EDGE · WAIT", 20, 160);
    } else if (kind === "seats") {
      const seats = ["WICK", "TAPE", "CARRY", "CLOCK"];
      const lines = ["candles", "book / prints", "funding", "session"];
      seats.forEach(function (name, i) {
        const x = 16 + i * ((w - 20) / 4);
        ctx.fillStyle = "rgba(0, 232, 255, 0.08)";
        ctx.fillRect(x, 28, (w - 40) / 4 - 8, h - 56);
        ctx.fillStyle = "#e8f4ff";
        ctx.font = "14px Orbitron, monospace";
        ctx.textAlign = "center";
        ctx.fillText(name, x + ((w - 40) / 4 - 8) / 2, 70);
        ctx.fillStyle = "rgba(180,200,220,0.7)";
        ctx.font = "12px Rajdhani, sans-serif";
        ctx.fillText(lines[i], x + ((w - 40) / 4 - 8) / 2, 96);
      });
      ctx.fillStyle = "rgba(240,193,74,0.8)";
      ctx.font = "11px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("CHAIR LISTENS AS HARD AS RANK", w / 2, h - 16);
    }
  }

  function paintSchoolHome() {
    const p = loadSchoolProgress();
    const nxt = schoolNextId(p.done);
    const les = schoolById(nxt);
    const cont = document.getElementById("schoolContinue");
    const streak = document.getElementById("schoolStreak");
    const list = document.getElementById("schoolList");
    const nWeek = (p.week && p.week.n) || 0;
    if (streak) streak.textContent = nWeek + " lesson" + (nWeek === 1 ? "" : "s") + " this week";
    if (cont) {
      cont.textContent = ((p.done || []).length ? "CONTINUE · " : "START · ") + les.title;
      cont.dataset.lesson = les.id;
    }
    if (list) {
      list.innerHTML = schoolLessons.map(function (l) {
        const done = (p.done || []).indexOf(l.id) >= 0;
        const open = schoolUnlocked(l.id, p.done);
        return '<li class="' + (done ? "done" : (open ? "open" : "locked")) + '">'
          + '<button type="button" class="school-pick" data-lesson="' + l.id + '" ' + (open ? "" : "disabled") + ">"
          + '<span class="school-n">' + l.n + "</span> " + l.title
          + '<span class="school-min">' + l.minutes + " min</span>"
          + (done ? '<span class="school-done">IN</span>' : (open ? "" : '<span class="school-lock">WAIT</span>'))
          + "</button></li>";
      }).join("");
    }
  }

  function showSchoolQuiz() {
    const les = schoolById(schoolOpenId);
    const quiz = (les && les.quiz) || [];
    const item = quiz[schoolQIndex];
    const qEl = document.getElementById("schoolQ");
    const box = document.getElementById("schoolChoices");
    const grade = document.getElementById("schoolGrade");
    const next = document.getElementById("schoolNextQ");
    schoolAnswered = false;
    if (!item) return;
    if (qEl) qEl.textContent = (schoolQIndex + 1) + " / " + quiz.length + " · " + item.q;
    if (grade) { grade.hidden = true; grade.textContent = ""; grade.classList.remove("right", "wrong"); }
    if (next) next.hidden = true;
    if (box) {
      box.innerHTML = item.choices.map(function (c, i) {
        const lab = (i === 0 ? "A" : "B") + " · " + c;
        return '<button type="button" class="school-choice" data-i="' + i + '">' + lab + "</button>";
      }).join("");
    }
  }

  function openSchoolLesson(id) {
    const p = loadSchoolProgress();
    if (!schoolUnlocked(id, p.done)) return;
    const les = schoolById(id);
    schoolOpenId = les.id;
    schoolQIndex = (p.current === les.id && p.q != null && p.done.indexOf(les.id) < 0) ? Number(p.q) || 0 : 0;
    p.current = les.id;
    p.q = schoolQIndex;
    saveSchoolProgress(p);
    const wrap = document.getElementById("schoolLesson");
    const list = document.getElementById("schoolList");
    const cont = document.getElementById("schoolContinue");
    if (wrap) wrap.classList.remove("hidden");
    if (list) list.classList.add("hidden");
    if (cont) cont.hidden = true;
    const title = document.getElementById("schoolTitle");
    const mins = document.getElementById("schoolMins");
    const idea = document.getElementById("schoolIdea");
    const body = document.getElementById("schoolBody");
    const call = document.getElementById("schoolCallout");
    if (title) title.textContent = les.title;
    if (mins) mins.textContent = les.minutes + " min";
    if (idea) idea.textContent = les.idea;
    if (body) body.innerHTML = (les.body || []).map(function (t) { return "<p>" + t + "</p>"; }).join("");
    if (call) call.textContent = les.callout || "";
    try { paintSchoolBoard(les.board || "window"); } catch (e) {}
    showSchoolQuiz();
  }

  function closeSchoolLesson() {
    schoolOpenId = null;
    const wrap = document.getElementById("schoolLesson");
    const list = document.getElementById("schoolList");
    const cont = document.getElementById("schoolContinue");
    if (wrap) wrap.classList.add("hidden");
    if (list) list.classList.remove("hidden");
    if (cont) cont.hidden = false;
    paintSchoolHome();
  }

  function finishSchoolLesson() {
    const p = loadSchoolProgress();
    if (schoolOpenId && p.done.indexOf(schoolOpenId) < 0) {
      p.done.push(schoolOpenId);
      if (!p.week || p.week.id !== schoolWeekId()) p.week = { id: schoolWeekId(), n: 0 };
      p.week.n = (Number(p.week.n) || 0) + 1;
    }
    p.current = schoolNextId(p.done);
    p.q = 0;
    saveSchoolProgress(p);
    closeSchoolLesson();
  }
  window.__finishSchoolLesson = finishSchoolLesson;

  function gradeSchoolChoice(i) {
    const les = schoolById(schoolOpenId);
    const item = ((les && les.quiz) || [])[schoolQIndex];
    if (!item || schoolAnswered) return;
    schoolAnswered = true;
    const ok = Number(i) === Number(item.answer);
    const grade = document.getElementById("schoolGrade");
    const next = document.getElementById("schoolNextQ");
    const box = document.getElementById("schoolChoices");
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll(".school-choice"), function (btn) {
        const idx = Number(btn.getAttribute("data-i"));
        btn.disabled = true;
        if (idx === item.answer) btn.classList.add("right");
        if (idx === Number(i) && !ok) btn.classList.add("wrong");
      });
    }
    if (grade) {
      grade.hidden = false;
      grade.classList.toggle("right", ok);
      grade.classList.toggle("wrong", !ok);
      grade.textContent = (ok ? "RIGHT · " : "WRONG · ") + (item.why || "");
    }
    if (next) {
      next.hidden = false;
      next.textContent = schoolQIndex >= ((les.quiz || []).length - 1) ? "IN · NEXT" : "NEXT";
    }
    const p = loadSchoolProgress();
    p.current = schoolOpenId;
    p.q = schoolQIndex;
    saveSchoolProgress(p);
  }
  window.__gradeSchoolChoice = gradeSchoolChoice;

  function schoolAdvance() {
    const les = schoolById(schoolOpenId);
    const n = ((les && les.quiz) || []).length;
    if (schoolQIndex >= n - 1) {
      finishSchoolLesson();
      return;
    }
    schoolQIndex += 1;
    const p = loadSchoolProgress();
    p.current = schoolOpenId;
    p.q = schoolQIndex;
    saveSchoolProgress(p);
    showSchoolQuiz();
  }

  function wireSchool() {
    const root = document.getElementById("schoolView");
    if (!root || root.__wired) return;
    root.__wired = true;
    const cont = document.getElementById("schoolContinue");
    if (cont) cont.addEventListener("click", function () {
      openSchoolLesson(cont.dataset.lesson || "hour");
    });
    const back = document.getElementById("schoolBack");
    if (back) back.addEventListener("click", function () { closeSchoolLesson(); });
    const next = document.getElementById("schoolNextQ");
    if (next) next.addEventListener("click", function () { schoolAdvance(); });
    root.addEventListener("click", function (e) {
      const pick = e.target && e.target.closest ? e.target.closest(".school-pick") : null;
      if (pick && pick.dataset.lesson) {
        openSchoolLesson(pick.dataset.lesson);
        return;
      }
      const ch = e.target && e.target.closest ? e.target.closest(".school-choice") : null;
      if (ch && ch.dataset.i != null) gradeSchoolChoice(ch.dataset.i);
    });
  }

  async function loadSchool() {
    wireSchool();
    try {
      const r = await fetch((typeof API_BASE === "string" ? API_BASE : "") + "/api/school", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (data && Array.isArray(data.lessons) && data.lessons.length) schoolLessons = data.lessons;
      }
    } catch (e) {}
    paintSchoolHome();
    if (schoolOpenId) {
      try { paintSchoolBoard((schoolById(schoolOpenId) || {}).board || "window"); } catch (err) {}
    }
  }
  window.loadSchool = loadSchool;

  let sideBoard = null;
  let sideStake = 5;
  let sideFocus = "BTC";
  let sidePollTimer = 0;
  let sideClockTimer = 0;
  let sideLastStamp = {};
  let sideWired = false;

  function sideApi(path, opt) {
    const base = typeof API_BASE === "string" ? API_BASE : "";
    return fetch(base + path, opt || { cache: "no-store" });
  }
  function sideFmtClock(secs) {
    if (secs == null || !isFinite(secs)) return "--:--";
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }
  function sideCents(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return Math.round(n) + "¢";
  }
  function playSidePunch() {
    try {
      const flash = document.createElement("div");
      flash.className = "side-flash";
      document.body.appendChild(flash);
      setTimeout(function () { try { flash.remove(); } catch (e) {} }, 320);
    } catch (e) {}
    if (typeof soundMuted !== "undefined" && soundMuted) return;
    try {
      const ctx = ensureAudio();
      if (!ctx) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(70, now + 0.16);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(now); o.stop(now + 0.24);
    } catch (e) {}
  }
  function sidePhoneOne() {
    return !!(typeof isPhoneDesk === "function" && isPhoneDesk()) || (window.innerWidth || 0) <= 480;
  }
  function wireSideTable() {
    if (sideWired) return;
    sideWired = true;
    document.querySelectorAll(".side-step").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sideStake = Number(btn.getAttribute("data-size") || 5);
        document.querySelectorAll(".side-step").forEach(function (b) {
          b.classList.toggle("on", Number(b.getAttribute("data-size")) === sideStake);
        });
      });
    });
    const armBtn = document.getElementById("sideArmBtn");
    const killBtn = document.getElementById("sideKillBtn");
    if (armBtn) {
      armBtn.addEventListener("click", async function () {
        const phrase = (document.getElementById("sideArmPhrase") || {}).value || "";
        try {
          const r = await sideApi("/api/side/arm", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ phrase: phrase }),
          });
          const data = await r.json();
          paintSideArm(data);
        } catch (e) {}
      });
    }
    if (killBtn) {
      killBtn.addEventListener("click", async function () {
        try {
          const r = await sideApi("/api/side/kill", {
            method: "POST",
            headers: { Accept: "application/json" },
          });
          const data = await r.json();
          paintSideArm(data);
          loadSideTable();
        } catch (e) {}
      });
    }
  }
  function paintSideArm(st) {
    const badge = document.getElementById("sideModeBadge");
    const armSt = document.getElementById("sideArmStatus");
    const live = !!(st && st.armed && !st.killed);
    if (badge) {
      badge.textContent = live ? "LIVE" : "PAPER";
      badge.classList.toggle("live", live);
      badge.classList.toggle("paper", !live);
    }
    if (armSt) {
      if (!st) { armSt.textContent = ""; return; }
      if (st.killed) armSt.textContent = "killed · paper only";
      else if (st.armed) armSt.textContent = "armed · taps are live on this tab";
      else if (st.arming) armSt.textContent = "arming · " + Math.ceil(st.arm_delay_s || 0) + "s";
      else if (st.error) armSt.textContent = st.error;
      else armSt.textContent = "paper default · live off";
    }
  }
  function sideTapeDots(tape) {
    const rows = Array.isArray(tape) ? tape.slice(0, 8) : [];
    return '<div class="side-tape">' + rows.map(function (t) {
      return '<span class="side-dot ' + String((t && t.result) || "") + '"></span>';
    }).join("") + "</div>";
  }
  function sideCardHtml(card, punch) {
    if (!card) return "";
    const dont = !!card.dont_play;
    const secs = card.secs_left;
    const next = !!(card.next_arms && secs != null && secs <= 20);
    const why = card.why || "";
    return '<article class="side-card' + (dont ? " dont-play" : "") + (punch ? " side-punch" : "") + '" data-ticker="' + String(card.ticker || "") + '">' +
      '<div class="side-card-head"><span class="side-asset">' + String(card.asset || card.title || "") + '</span>' +
      '<span class="side-strike">' + (card.strike != null ? ("strike " + card.strike) : (card.minutes ? (card.minutes + "m") : "")) + "</span></div>" +
      '<div class="side-count' + (next ? " next-arm" : "") + '">' + sideFmtClock(secs) + (next ? " · NEXT" : "") + "</div>" +
      '<div class="side-odds"><span class="yes">YES ' + sideCents(card.yes_ask) + '</span><span class="no">NO ' + sideCents(card.no_ask) + "</span></div>" +
      sideTapeDots(card.tape) +
      '<div class="side-actions">' +
      '<button type="button" class="side-yes" data-side="YES"' + (dont ? " disabled" : "") + ">YES</button>" +
      '<button type="button" class="side-no" data-side="NO"' + (dont ? " disabled" : "") + ">NO</button>" +
      "</div>" +
      (why ? '<div class="side-flag">' + why + "</div>" : "") +
      "</article>";
  }
  function paintSideBoard(data) {
    sideBoard = data || sideBoard;
    if (!sideBoard) return;
    const st = sideBoard.status || {};
    paintSideArm(st);
    const feed = document.getElementById("sideFeedStatus");
    const arcade = Array.isArray(sideBoard.arcade) ? sideBoard.arcade : [];
    const extras = Array.isArray(sideBoard.extras) ? sideBoard.extras : [];
    const pills5 = Array.isArray(sideBoard.pills_5m) ? sideBoard.pills_5m : [];
    if (feed) {
      feed.textContent = arcade.length ? (arcade.length + " open · 15m") : "no open 15m";
    }
    const clock = document.getElementById("sideClock");
    const focusCard = arcade.find(function (c) { return c.asset === sideFocus; }) || arcade[0];
    if (clock) clock.textContent = sideFmtClock(focusCard && focusCard.secs_left);
    const pillBox = document.getElementById("sidePills");
    if (pillBox) {
      const names = arcade.map(function (c) { return c.asset; }).concat(extras.map(function (c) { return c.asset; }));
      const uniq = [];
      names.forEach(function (n) { if (n && uniq.indexOf(n) < 0) uniq.push(n); });
      pillBox.innerHTML = uniq.map(function (n) {
        return '<button type="button" class="side-pill' + (n === sideFocus ? " on" : "") + '" data-asset="' + n + '">' + n + " 15M</button>";
      }).join("") + pills5.map(function (n) {
        return '<button type="button" class="side-pill" data-asset="' + n + '" data-min="5">' + n + " 5M</button>";
      }).join("");
      pillBox.querySelectorAll(".side-pill").forEach(function (btn) {
        btn.addEventListener("click", function () {
          sideFocus = btn.getAttribute("data-asset") || "BTC";
          paintSideBoard(sideBoard);
        });
      });
    }
    const box = document.getElementById("sideArcade");
    if (box) {
      const cards = sidePhoneOne()
        ? (arcade.concat(extras)).filter(function (c) { return c.asset === sideFocus; }).slice(0, 1)
        : arcade.concat(extras);
      const show = cards.length ? cards : arcade.slice(0, 1);
      box.innerHTML = show.map(function (c) {
        const key = String(c.ticker || c.asset);
        const stamp = ((c.tape && c.tape[0]) || {}).result || "";
        const punch = stamp && sideLastStamp[key] && sideLastStamp[key] !== stamp;
        if (stamp) sideLastStamp[key] = stamp;
        else if (!sideLastStamp[key]) sideLastStamp[key] = stamp;
        return sideCardHtml(c, punch);
      }).join("") || '<p class="side-flag">No open 15m books.</p>';
      if (!sidePhoneOne() && Array.isArray(sideBoard.parked) && sideBoard.parked.length) {
        box.innerHTML += '<article class="side-card parked"><div class="side-card-head">PARKED</div><div class="side-flag">empty</div></article>';
      }
      box.querySelectorAll(".side-card").forEach(function (el) {
        if (el.classList.contains("side-punch")) playSidePunch();
        const ticker = el.getAttribute("data-ticker");
        const card = show.find(function (c) { return String(c.ticker) === ticker; }) || focusCard;
        el.querySelectorAll("button[data-side]").forEach(function (btn) {
          btn.addEventListener("click", function () { tapSide(card, btn.getAttribute("data-side")); });
        });
      });
    }
    const hotBox = document.getElementById("sideHot");
    if (hotBox) {
      const hot = Array.isArray(sideBoard.hot) ? sideBoard.hot : [];
      hotBox.innerHTML = hot.map(function (h) {
        const left = sideFmtClock(h.secs_left);
        const vol = h.volume != null ? Math.round(Number(h.volume)).toLocaleString() : "—";
        return '<div class="side-hot-row" data-ticker="' + String(h.ticker || "") + '">' +
          '<div><div class="side-hot-title">' + String(h.title || h.ticker || "") + "</div>" +
          '<div class="side-hot-meta">YES ' + sideCents(h.yes_ask) + " · NO " + sideCents(h.no_ask) + " · vol " + vol + " · " + left + "</div></div>" +
          (h.why ? '<div class="side-hot-meta">' + h.why + "</div>" : "") +
          '<div class="side-hot-taps">' +
          '<button type="button" class="yes" data-side="YES"' + (h.dont_play ? " disabled" : "") + ">YES</button>" +
          '<button type="button" class="no" data-side="NO"' + (h.dont_play ? " disabled" : "") + ">NO</button>" +
          "</div></div>";
      }).join("") || '<p class="side-hot-meta">No liquid open books.</p>';
      hotBox.querySelectorAll(".side-hot-row").forEach(function (row) {
        const ticker = row.getAttribute("data-ticker");
        const card = hot.find(function (h) { return String(h.ticker) === ticker; });
        row.querySelectorAll("button[data-side]").forEach(function (btn) {
          btn.addEventListener("click", function () { tapSide(card, btn.getAttribute("data-side")); });
        });
      });
    }
    const fills = document.getElementById("sideFills");
    if (fills) {
      const rows = Array.isArray(sideBoard.fills) ? sideBoard.fills : [];
      fills.innerHTML = rows.map(function (f) {
        return '<div class="side-fill">' + (f.paper ? "PAPER" : "LIVE") + " " + (f.side || "") + " " + (f.ticker || "") +
          " · $" + (f.stake || "") + " @ " + sideCents(f.fill_cents) + " · " + (f.result || "OPEN") +
          (f.pnl != null ? (" · " + f.pnl) : "") + "</div>";
      }).join("");
    }
    const whyEl = document.getElementById("sideWhy");
    if (whyEl) whyEl.textContent = (focusCard && focusCard.why) || "";
  }
  async function tapSide(card, side) {
    if (!card || !card.ticker) return;
    const st = (sideBoard && sideBoard.status) || {};
    const live = !!(st.armed && !st.killed && st.live_allowed);
    const why = document.getElementById("sideWhy");
    try {
      const r = await sideApi("/api/side/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ticker: card.ticker,
          side: side,
          stake: sideStake,
          live: live,
          yes_bid: card.yes_bid,
          yes_ask: card.yes_ask,
          secs_left: card.secs_left,
          sick: !!card.dont_play,
        }),
      });
      const data = await r.json();
      if (why) why.textContent = data && data.ok ? ((live ? "LIVE" : "PAPER") + " " + side + " · " + (card.ticker || "")) : ((data && data.error) || "tap refused");
      if (data && data.ok) playSidePunch();
      loadSideTable();
    } catch (e) {
      if (why) why.textContent = "tap failed";
    }
  }
  async function loadSideTable() {
    wireSideTable();
    try {
      const r = await sideApi("/api/side");
      if (r.ok) {
        const data = await r.json();
        paintSideBoard(data);
      }
    } catch (e) {}
    if (sidePollTimer) clearInterval(sidePollTimer);
    if (sideClockTimer) clearInterval(sideClockTimer);
    sidePollTimer = setInterval(function () {
      if (mode !== "side") return;
      sideApi("/api/side").then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        if (data) paintSideBoard(data);
      }).catch(function () {});
    }, 6000);
    sideClockTimer = setInterval(function () {
      if (mode !== "side" || !sideBoard) return;
      const arcade = (sideBoard.arcade || []).concat(sideBoard.extras || []);
      arcade.forEach(function (c) {
        if (c && c.secs_left != null) c.secs_left = Math.max(0, Number(c.secs_left) - 1);
      });
      (sideBoard.hot || []).forEach(function (h) {
        if (h && h.secs_left != null) h.secs_left = Math.max(0, Number(h.secs_left) - 1);
      });
      paintSideBoard(sideBoard);
    }, 1000);
  }
  window.loadSideTable = loadSideTable;

  window.frontMarkFail = function (img) {
    if (!img) return;
    // Never blank the Chair face. Never invent a neon mark.
    if (img.id === "frontChairImg") {
      const wrap = img.closest ? img.closest(".front-mark") : img.parentElement;
      if (wrap) wrap.classList.remove("blank");
      img.src = raijinPortraitSrc(frontLockDir());
      return;
    }
    const wrap = img.closest ? img.closest(".front-mark") : img.parentElement;
    if (wrap) wrap.classList.add("blank");
    try { img.removeAttribute("src"); } catch (e) {}
    img.alt = "";
  };

  let frontBoard = null;
  let frontStake = 5;
  let frontPollTimer = 0;
  let frontWxRaf = 0;
  let frontWxBits = [];
  let frontWxT = 0;
  let frontLastMode = "";
  let frontWired = false;
  let frontBoltUntil = 0;
  const frontWxRefreshMs = 180000; // live KDFW METAR/NWS every few minutes. Dead feed holds last mode.

  function frontApi(path, opt) {
    const base = typeof API_BASE === "string" ? API_BASE : "";
    return fetch(base + path, opt || { cache: "no-store" });
  }
  function frontCents(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return Math.round(n) + "¢";
  }
  function frontWr(seat) {
    const n = seat && seat.n != null ? Number(seat.n) : 0;
    const wr = seat && seat.wr != null ? Math.round(Number(seat.wr) * 100) + "%" : "—";
    return n + "/" + wr;
  }
  function wireFrontTable() {
    if (frontWired) return;
    frontWired = true;
    document.querySelectorAll(".front-step").forEach(function (btn) {
      btn.addEventListener("click", function () {
        frontStake = Number(btn.getAttribute("data-size") || 5);
        document.querySelectorAll(".front-step").forEach(function (b) {
          b.classList.toggle("on", Number(b.getAttribute("data-size")) === frontStake);
        });
      });
    });
    const armBtn = document.getElementById("frontArmBtn");
    const killBtn = document.getElementById("frontKillBtn");
    if (armBtn) {
      armBtn.addEventListener("click", async function () {
        const phrase = (document.getElementById("frontArmPhrase") || {}).value || "";
        try {
          const r = await frontApi("/api/front/arm", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ phrase: phrase }),
          });
          paintFrontArm(await r.json());
        } catch (e) {}
      });
    }
    if (killBtn) {
      killBtn.addEventListener("click", async function () {
        try {
          const r = await frontApi("/api/front/kill", { method: "POST", headers: { Accept: "application/json" } });
          paintFrontArm(await r.json());
          loadFrontTable();
        } catch (e) {}
      });
    }
  }
  function paintFrontArm(st) {
    const badge = document.getElementById("frontModeBadge");
    const armSt = document.getElementById("frontArmStatus");
    const live = !!(st && st.armed && !st.killed);
    if (badge) {
      badge.textContent = live ? "LIVE" : "PAPER";
      badge.classList.toggle("live", live);
      badge.classList.toggle("paper", !live);
    }
    if (armSt) {
      if (!st) { armSt.textContent = ""; return; }
      if (st.killed) armSt.textContent = "killed · paper only";
      else if (st.armed) armSt.textContent = "armed · taps are live on this tab";
      else if (st.arming) armSt.textContent = "arming · " + Math.ceil(st.arm_delay_s || 0) + "s";
      else if (st.error) armSt.textContent = st.error;
      else armSt.textContent = "paper default · live off";
    }
  }
  function paintFrontGuide(data) {
    const box = document.getElementById("frontGuide");
    if (!box) return;
    const seats = ((data && data.seats) || []).slice();
    if (data && data.chair) seats.unshift(data.chair);
    box.innerHTML = seats.map(function (s) {
      const isChair = !!(s && (s.id === "RAIJIN" || (data && data.chair && s.id && s.id === data.chair.id)));
      const mark = isChair ? raijinPortraitSrc((s && s.eye) || frontLockDir()) : String((s && s.mark) || "");
      const label = isChair ? frontChairName(s) : String((s && (s.name || s.id)) || "");
      return '<article class="front-guide-card" data-seat="' + String((s && s.id) || "") + '">' +
        '<span class="front-mark"><img src="' + mark + '" alt="" onerror="window.frontMarkFail&&frontMarkFail(this)"></span>' +
        "<div><h3>" + label + "</h3>" +
        "<p>" + String((s && s.job) || "") + "</p>" +
        '<div class="nw">' + frontWr(s) + (s && s.rank ? (" · #" + s.rank) : "") + (s && s.call ? (" · " + s.call) : "") + "</div></div></article>";
    }).join("");
  }
  function paintFrontBook(data) {
    const box = document.getElementById("frontBook");
    if (!box) return;
    const rows = Array.isArray(data && data.brackets) ? data.brackets : [];
    if (!rows.length) {
      const dropped = ((data && data.dropped) || []).join(" ");
      box.innerHTML = '<p class="side-flag">' + (dropped ? ("series dropped · " + dropped) : "No open DFW book.") + "</p>";
      return;
    }
    const best = rows.find(function (b) { return b.best; }) || rows[0];
    const dont = !!(best && best.dont_play);
    const open = ((data && data.tape) || []).some(function (p) { return String(p.result || "").toUpperCase() === "OPEN"; });
    box.innerHTML = '<article class="front-bet best' + (dont ? " dont-play" : "") + '" data-ticker="' + String(best.ticker || "") + '">' +
      '<div class="front-bet-head"><span>' + (open ? "LOCKED" : "BEST") + " · " + String(best.bracket || "") + "</span><span>" + (best.confidence != null ? (best.confidence + "%") : "—") + "</span></div>" +
      "<div>YES " + frontCents(best.yes_ask) + " · NO " + frontCents(best.no_ask) + (best.volume != null ? (" · n " + Math.round(best.volume)) : "") + "</div>" +
      (best.skip ? '<div class="side-flag">' + best.skip + "</div>" : "") +
      '<button type="button" class="yes" data-side="YES"' + (dont ? " disabled" : "") + ">YES</button>" +
      '<button type="button" class="no" data-side="NO"' + (dont ? " disabled" : "") + ">NO</button>" +
      "</article>";
    box.querySelectorAll(".front-bet").forEach(function (el) {
      const ticker = el.getAttribute("data-ticker");
      const card = rows.find(function (b) { return String(b.ticker) === ticker; });
      el.querySelectorAll("button[data-side]").forEach(function (btn) {
        btn.addEventListener("click", function () { tapFront(card, btn.getAttribute("data-side")); });
      });
    });
  }
  function paintFrontScore(data) {
    const acc = (data && data.accuracy) || {};
    const pct = acc.accuracy_pct;
    const right = acc.correct != null ? acc.correct : 0;
    const wrong = acc.wrong != null ? acc.wrong : 0;
    const pending = acc.pending != null ? acc.pending : 0;
    const elPct = document.getElementById("frontHrPct");
    const elRight = document.getElementById("frontHrRight");
    const elWrong = document.getElementById("frontHrWrong");
    const elPending = document.getElementById("frontHrPending");
    const elVerdict = document.getElementById("frontHrVerdict");
    if (elPct) elPct.textContent = pct != null ? (pct + "%") : "—";
    if (elRight) elRight.textContent = String(right);
    if (elWrong) elWrong.textContent = String(wrong);
    if (elPending) elPending.textContent = String(pending);
    if (elVerdict) elVerdict.textContent = acc.verdict || "COLLECTING";
    const tape = document.getElementById("frontTape");
    if (tape) {
      const rows = Array.isArray(data && data.tape) ? data.tape : [];
      if (!rows.length) {
        tape.innerHTML = '<li class="lock-tape-empty">No Raijin lock — waiting on DFW CLI</li>';
      } else {
        tape.innerHTML = rows.map(function (p) {
          const res = String(p.result || "OPEN").toUpperCase();
          const pnl = p.pnl == null ? "" : ((Number(p.pnl) >= 0 ? "+" : "") + "$" + Number(p.pnl).toFixed(2));
          return '<li class="lock-tape-row ' + (res === "OPEN" ? "open" : "settled") + '">' +
            '<span class="lt-pair">' + String(p.city || "DAL") + "</span>" +
            '<span class="lt-win">' + String(p.bracket || "—") + "</span>" +
            '<span class="lt-conf">' + (p.best ? "BEST" : "lock") + "</span>" +
            '<span class="lt-res">' + res + "</span>" +
            '<span class="lt-side">' + (p.paper ? "PAPER " : "") + pnl + "</span>" +
            "</li>";
        }).join("");
      }
    }
  }
  function paintFrontSeats(data) {
    const chairCall = document.getElementById("frontChairCall");
    if (chairCall) {
      const lean = (data.chair && data.chair.lean) || wxWord(data.chair && data.chair.eye, data.clock && data.clock.strike_type, data.clock && data.clock.nws_high, data.clock && data.clock.floor_strike, data.clock && data.clock.cap_strike);
      const high = frontHighLine({ market: { clock: data.clock || {}, strike_type: data.clock && data.clock.strike_type, floor_strike: data.clock && data.clock.floor_strike, cap_strike: data.clock && data.clock.cap_strike, kalshi_high: data.chair && data.chair.kalshi_high, nws_high: data.clock && data.clock.nws_high, bracket: data.chair && data.chair.bracket } });
      chairCall.textContent = high + " · " + lean;
    }
    const chairImg = document.getElementById("frontChairImg");
    if (chairImg) {
      chairImg.src = raijinPortraitSrc(frontLockDir());
    }
    try { paintRaijinEyes(frontLockDir()); } catch (e) {}
    (data.seats || []).forEach(function (s) {
      const el = document.querySelector('.front-call[data-call="' + s.id + '"]');
      if (el) el.textContent = s.call || "—";
    });
    paintFrontSubs(data);
  }
  function paintFrontSubs(data) {
    const subs = frontSubsOf(data);
    FRONT_SUB_IDS.forEach(function (id) {
      const row = subs.find(function (s) { return String(s.id || "").toUpperCase() === id; });
      const line = document.querySelector('[data-sub-line="' + id + '"]');
      const wrap = document.querySelector('.front-sub[data-sub="' + id + '"]');
      if (line) line.textContent = (row && row.line) || "—";
      if (wrap) wrap.setAttribute("data-tone", (row && row.tone) || "miss");
    });
  }
  function paintFrontBoard(data) {
    frontBoard = data || frontBoard;
    if (!frontBoard) return;
    paintFrontArm(frontBoard.status || {});
    const wx = (frontBoard.weather && frontBoard.weather.mode) || "";
    const held = !!(frontBoard.weather && frontBoard.weather.held);
    const badge = document.getElementById("frontWxBadge");
    if (badge) badge.textContent = wx ? ("WX · " + wx + (held ? " · HOLD" : " · KDFW")) : "WX · HOLD";
    const wrap = document.getElementById("frontStageWrap");
    if (wrap) wrap.setAttribute("data-wx", wx || "");
    const feed = document.getElementById("frontFeedStatus");
    const n = ((frontBoard.brackets || []).length);
    if (feed) {
      feed.textContent = n ? (n + " DFW brackets · KXHIGHTDAL") : ((frontBoard.dropped || []).length ? "series dropped" : "no open DFW book");
    }
    try { tasteChairActivity("front"); bumpChairPulse("front", 0.12); } catch (e) {}
    paintFrontSeats(frontBoard);
    paintFrontBook(frontBoard);
    paintFrontGuide(frontBoard);
    paintFrontScore(frontBoard);
    const fills = document.getElementById("frontFills");
    if (fills) {
      fills.innerHTML = (frontBoard.fills || []).map(function (f) {
        return '<div class="side-fill">' + (f.paper ? "PAPER" : "LIVE") + " " + (f.side || "") + " " + (f.ticker || "") +
          " · $" + (f.stake || "") + " @ " + frontCents(f.fill_cents) + " · " + (f.result || "OPEN") + "</div>";
      }).join("");
    }
    const why = document.getElementById("frontWhy");
    const best = (frontBoard.brackets || []).find(function (b) { return b.best; });
    if (why) why.textContent = (best && (best.skip || best.bracket)) || "";
    document.querySelectorAll("#frontView .front-mark img").forEach(function (img) {
      if (img.id === "frontChairImg") {
        img.src = raijinPortraitSrc(frontLockDir());
        return;
      }
      if (img.complete && !img.naturalWidth) window.frontMarkFail(img);
    });
    startFrontWx(wx);
    if (typeof focusTable !== "undefined" && isFrontTable(focusTable)) {
      try { paintFrontWindowChrome(); } catch (e) {}
      try { if (mode === "art" || mode === "floor") drawArt(); } catch (e) {}
      try { if (isSeatsMode(mode)) paintSeatsPage(); } catch (e) {}
      try { paintTableHud(); } catch (e) {}
    }
  }
  const frontSeatImgs = {};
  ["glass", "pit", "frost", "bone", "mesh"].forEach(function (id) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "/static/bots/" + id + ".png";
    frontSeatImgs[id.toUpperCase()] = img;
  });
  function frontChairName(chair) {
    const n = String((chair && (chair.name || chair.id)) || "RAIJIN").trim();
    return n || "RAIJIN";
  }
  function frontLeanOf(raw) {
    const d = String(raw || "WAIT").toUpperCase();
    if (d === "UP" || d === "YES" || d === "ABOVE" || d === "BETWEEN") return "UP";
    if (d === "DOWN" || d === "NO" || d === "SKIP" || d === "BELOW") return "DOWN";
    return "WAIT";
  }
  function drawFrontTable(wxCtx, w, h) {
    if (!wxCtx || !w || !h) return;
    const prev = ctx;
    ctx = wxCtx;
    try {
      const data = frontBoard || {};
      const chair = data.chair || {};
      const seats = Array.isArray(data.seats) ? data.seats : [];
      const tape = Array.isArray(data.tape) ? data.tape : [];
      const open = tape.find(function (p) { return String(p.result || "").toUpperCase() === "OPEN"; });
      const locked = !!open;
      const dir = locked
        ? (String(open.side || "").toUpperCase() === "NO" ? "DOWN" : "UP")
        : frontLeanOf(chair.eye);
      const conf = chair.confidence != null ? chair.confidence : 0;
      const cx = w / 2;
      const cy = h / 2;
      const short = Math.min(w, h);
      const radius = short * 0.28;
      const pr = radius * 0.80;
      const ringR = radius * 1.48;
      const portraitY = cy - 2;
      const accent = locked ? "rgba(0, 220, 255, 0.95)" : "rgba(0, 220, 255, 0.55)";
      const nowCt = new Date();
      const frac = ((nowCt.getHours() % 24) + nowCt.getMinutes() / 60) / 24;
      drawHourRing(cx, cy, radius * 1.72, frac, dir === "UP" ? ACID : dir === "DOWN" ? HOT_RED : CYAN);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 220, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const named = ["GLASS", "PIT", "FROST", "BONE", "MESH"].map(function (id) {
        return seats.find(function (s) { return s.id === id; }) || { id: id, dir: "WAIT", call: "—" };
      });
      const n = named.length;
      const orbit = (typeof seatOrbitAngle === "function") ? seatOrbitAngle() : 0;
      const wrapEl = document.getElementById("frontStageWrap");
      const wxNow = String((data.weather && data.weather.mode) || (wrapEl && wrapEl.getAttribute("data-wx")) || "").toUpperCase();
      const windLean = wxNow === "WIND" ? -0.10 : 0;
      named.forEach(function (s, i) {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + orbit;
        const x = cx + Math.cos(ang) * ringR;
        const y = cy + Math.sin(ang) * ringR;
        const adir = frontLeanOf(s.dir || s.vote);
        let col = "rgba(0,232,255,0.95)";
        if (adir === "UP") col = "rgba(0,255,120,0.95)";
        if (adir === "DOWN") col = "rgba(255,55,90,0.95)";
        const confA = Number(s.n) || 50;
        const end = spokeEnd(x, y, cx, portraitY, pr + 4);
        const agree = (adir === dir) && (adir === "UP" || adir === "DOWN");
        const fresh = markSeatTick("front:" + s.id, adir, confA);
        drawPacketSpoke(x, y, end.x, end.y, col, confA, agree, fresh, "front");
        const face = locked ? Math.atan2(portraitY - y, cx - x) : ang;
        if (wxNow === "SUN") {
          ctx.save();
          ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
          ctx.beginPath();
          ctx.ellipse(x - 18, y + 22, 16, 5, -0.35, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.translate(x, y);
        if (windLean) ctx.rotate(windLean);
        ctx.translate(-x, -y);
        const mark = frontSeatImgs[s.id];
        if (!containPortrait(mark, x, y, 22)) {
          drawGameBot(s.id, x, y, 22, adir, confA, face, i);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 22, 0, Math.PI * 2);
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
        ctx.font = "700 9px Orbitron, monospace";
        ctx.fillStyle = "rgba(220,235,250,0.95)";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const outA = Math.atan2(y - cy, x - cx);
        ctx.fillText(s.id, x + Math.cos(outA) * 16, y + Math.sin(outA) * 16);
        ctx.restore();
      });
      if (!containPortrait(raijinPortraitFor(dir), cx, portraitY, pr)) {
        if (!containPortrait(raijinPortrait, cx, portraitY, pr)) {
          containPortrait(raijinFace(dir), cx, portraitY, pr);
        }
      }
      try { drawRaijinEyeTint(cx, portraitY, pr, dir); paintRaijinEyes(dir); } catch (e) {}
      const chairMark = document.querySelector("#frontStageWrap > #frontChair .front-mark");
      if (chairMark) {
        chairMark.style.width = (pr * 2) + "px";
        chairMark.style.height = (pr * 2) + "px";
      }
      ctx.beginPath();
      ctx.arc(cx, portraitY, pr, 0, Math.PI * 2);
      ctx.strokeStyle = locked ? "rgba(0,220,255,0.95)" : "rgba(0,220,255,0.9)";
      ctx.lineWidth = locked ? 3.2 : 2.8;
      ctx.stroke();
      try {
        drawChairThink(cx, portraitY, pr, radius, { which: "front", dir: dir, locked: locked, st: {} });
      } catch (e) {}
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = "700 11px Orbitron, monospace";
      ctx.fillStyle = "#7fe9ff";
      ctx.fillText(frontChairName(chair) + " · DFW", cx, portraitY + pr + 11);
      ctx.font = "700 12px Orbitron, monospace";
      const plateY = cy + radius + 14;
      const wxDir = wxWord(dir, (data.clock && data.clock.strike_type) || (open && open.strike_type), data.clock && data.clock.nws_high, data.clock && data.clock.floor_strike, data.clock && data.clock.cap_strike);
      const highLine = frontHighLine({ market: { clock: data.clock || {}, strike_type: data.clock && data.clock.strike_type, floor_strike: data.clock && data.clock.floor_strike, cap_strike: data.clock && data.clock.cap_strike, kalshi_high: data.clock && data.clock.kalshi_high, nws_high: data.clock && data.clock.nws_high, bracket: open && open.bracket || chair.bracket } });
      if (locked) {
        ctx.fillStyle = "#7fe9ff";
        ctx.fillText("LOCKED " + wxDir, cx, plateY);
        ctx.font = "600 10px Rajdhani, sans-serif";
        ctx.fillStyle = "rgba(180,200,220,0.85)";
        ctx.fillText(highLine + " · paper", cx, plateY + 14);
      } else {
        ctx.fillStyle = "#a8c0d8";
        ctx.fillText(wxDir, cx, plateY);
        ctx.font = "600 10px Rajdhani, sans-serif";
        ctx.fillStyle = "rgba(180,200,220,0.75)";
        ctx.fillText(highLine + " · " + (chair.bracket || "waiting on DFW CLI"), cx, plateY + 14);
      }
    } finally {
      ctx = prev;
    }
  }
  function seedFrontWx(w, h, mode) {
    frontWxBits = [];
    const n = mode === "RAIN" || mode === "STORM" ? 90 : (mode === "WIND" ? 70 : 36);
    for (let i = 0; i < n; i++) {
      frontWxBits.push({
        x: Math.random() * w,
        y: Math.random() * h,
        s: 0.6 + Math.random() * 2.4,
        a: 0.08 + Math.random() * 0.22,
        l: 8 + Math.random() * 18,
      });
    }
  }
  function drawFrontWxFrame() {
    const canvas = document.getElementById("frontWx");
    if (!canvas || mode !== "front") {
      frontWxRaf = 0;
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const wrap = document.getElementById("frontStageWrap");
    const w = canvas.clientWidth || 920;
    const h = canvas.clientHeight || 620;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      seedFrontWx(w, h, (wrap && wrap.getAttribute("data-wx")) || "");
    }
    const wx = (wrap && wrap.getAttribute("data-wx")) || "";
    frontWxT += 1;
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, w, h);
    // CRT/neon KDFW backdrop. Never invent SUN when the feed is dead.
    if (wx === "SUN") {
      const g = ctx.createRadialGradient(w * 0.78, h * 0.10, 4, w * 0.42, h * 0.42, w * 0.85);
      g.addColorStop(0, "rgba(255, 214, 74, 0.92)");
      g.addColorStop(0.18, "rgba(255, 176, 40, 0.42)");
      g.addColorStop(0.42, "rgba(0, 232, 255, 0.22)");
      g.addColorStop(1, "rgba(2, 4, 10, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255, 210, 80, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.78, h * 0.10);
      ctx.lineTo(w * 0.18, h * 0.92);
      ctx.stroke();
      ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
      ctx.beginPath();
      ctx.ellipse(w * 0.38, h * 0.86, w * 0.34, 22, -0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (wx === "HEAT") {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255, 70, 10, 0.28)");
      g.addColorStop(0.45, "rgba(180, 40, 0, 0.22)");
      g.addColorStop(1, "rgba(60, 12, 0, 0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255, 120, 30, 0.22)";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        const y = (h * 0.12) + i * 26 + Math.sin((frontWxT + i * 12) / 14) * 8;
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 12) ctx.lineTo(x, y + Math.sin((x + frontWxT * 2.4 + i * 20) / 16) * 7);
        ctx.stroke();
      }
    } else if (wx === "CLOUD") {
      ctx.fillStyle = "rgba(70, 84, 98, 0.28)";
      ctx.fillRect(0, 0, w, h);
      const drift = (frontWxT * 0.08) % (w + 220);
      ctx.fillStyle = "rgba(120, 130, 140, 0.20)";
      ctx.beginPath();
      ctx.ellipse(drift - 90, h * 0.24, 120, 34, 0, 0, Math.PI * 2);
      ctx.ellipse(drift + 50, h * 0.32, 96, 26, 0, 0, Math.PI * 2);
      ctx.ellipse(drift + 160, h * 0.22, 80, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 232, 255, 0.08)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.45, h * 0.18);
      ctx.lineTo(w * 0.52, h * 0.36);
      ctx.lineTo(w * 0.48, h * 0.36);
      ctx.lineTo(w * 0.58, h * 0.56);
      ctx.stroke();
    } else if (wx === "RAIN" || wx === "STORM") {
      ctx.fillStyle = wx === "STORM" ? "rgba(8, 12, 28, 0.62)" : "rgba(6, 14, 24, 0.40)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = wx === "STORM" ? "rgba(0, 232, 255, 0.38)" : "rgba(0, 232, 255, 0.28)";
      ctx.lineWidth = 1.1;
      frontWxBits.forEach(function (d) {
        d.x += d.s * 0.85;
        d.y += d.s * 2.4;
        if (d.y > h + 10) { d.y = -10; d.x = Math.random() * w; }
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 7, d.y + d.l);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      const sheen = ctx.createLinearGradient(0, h * 0.68, 0, h);
      sheen.addColorStop(0, "rgba(0, 232, 255, 0)");
      sheen.addColorStop(0.55, "rgba(0, 232, 255, 0.08)");
      sheen.addColorStop(1, "rgba(0, 232, 255, 0.20)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, h * 0.68, w, h * 0.32);
      if (wx === "STORM") {
        const flash = (Date.now() < frontBoltUntil) || (frontWxT % 180 === 0);
        if (frontWxT % 180 === 0) frontBoltUntil = Date.now() + 160;
        if (flash) {
          ctx.fillStyle = "rgba(220, 240, 255, 0.28)";
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = "rgba(0, 232, 255, 0.98)";
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(w * 0.52, h * 0.04);
          ctx.lineTo(w * 0.46, h * 0.30);
          ctx.lineTo(w * 0.56, h * 0.34);
          ctx.lineTo(w * 0.40, h * 0.78);
          ctx.stroke();
          ctx.lineWidth = 1;
          if (wrap) wrap.classList.add("bolt-punch");
        } else if (wrap) wrap.classList.remove("bolt-punch");
      }
    } else if (wx === "WIND") {
      ctx.strokeStyle = "rgba(0, 232, 255, 0.26)";
      ctx.lineWidth = 1.2;
      frontWxBits.forEach(function (d) {
        d.x += d.s * 3.6;
        if (d.x > w + 20) { d.x = -20; d.y = Math.random() * h; }
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.l * 2.6, d.y);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "rgba(0, 232, 255, 0.018)";
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    drawFrontTable(ctx, w, h);
    frontWxRaf = requestAnimationFrame(drawFrontWxFrame);
  }
  function startFrontWx(mode) {
    if (mode && mode !== frontLastMode) {
      if (frontLastMode) {
        try { bumpChairPulse("front", 0.85); } catch (e) {}
      }
      frontLastMode = mode;
      const canvas = document.getElementById("frontWx");
      if (canvas) seedFrontWx(canvas.clientWidth || 920, canvas.clientHeight || 620, mode);
    }
    if (!frontWxRaf) frontWxRaf = requestAnimationFrame(drawFrontWxFrame);
  }
  async function tapFront(card, side) {
    if (!card || !card.ticker) return;
    const st = (frontBoard && frontBoard.status) || {};
    const live = !!(st.armed && !st.killed && st.live_allowed);
    const why = document.getElementById("frontWhy");
    try {
      const r = await frontApi("/api/front/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ticker: card.ticker,
          side: side,
          stake: frontStake,
          live: live,
          yes_bid: card.yes_bid,
          yes_ask: card.yes_ask,
          sick: !!card.dont_play,
          votes: card.votes || [],
          bracket: card.bracket,
          best: !!card.best,
          strike_type: card.strike_type,
          floor_strike: card.floor_strike,
          cap_strike: card.cap_strike,
        }),
      });
      const data = await r.json();
      if (why) why.textContent = data && data.ok ? ((live ? "LIVE" : "PAPER") + " " + side + " · " + (card.ticker || "")) : ((data && data.error) || "tap refused");
      if (data && data.ok) {
        const soundEl = document.getElementById("setFrontSound");
        const master = document.getElementById("setSoundOn");
        if ((!soundEl || soundEl.checked) && (!master || master.checked)) {
          try { playCallVoice(String(side || "").toUpperCase() === "NO" ? "DOWN" : "UP"); } catch (e) {}
        }
      }
      loadFrontTable();
    } catch (e) {
      if (why) why.textContent = "tap failed";
    }
  }
  async function loadFrontTable() {
    wireFrontTable();
    try {
      const r = await frontApi("/api/front");
      if (r.ok) paintFrontBoard(await r.json());
    } catch (e) {}
    if (frontPollTimer) clearInterval(frontPollTimer);
    frontPollTimer = setInterval(function () {
      if (mode !== "front" && mode !== "floor" && focusTable !== "front") return;
      frontApi("/api/front").then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        if (data) paintFrontBoard(data);
      }).catch(function () {});
    }, 20000); // book. Live KDFW weather refresh is frontWxRefreshMs / WX_REFRESH_S.
  }
  window.loadFrontTable = loadFrontTable;

  let atsBoard = null;
  let atsPollTimer = null;
  async function loadAtsTable() {
    try {
      const r = await fetch("/api/ats", { cache: "no-store", headers: { Accept: "application/json" } });
      if (r.ok) {
        atsBoard = await r.json();
        try { paintAresEyes((atsBoard.chair && atsBoard.chair.eyes) || (atsBoard.pick && atsBoard.pick.eyes)); } catch (e) {}
        try { renderAtsBotsGuide(atsBoard); } catch (e) {}
        try { paintAtsChartTape(atsBoard); } catch (e) {}
        try { paintAtsWhy(atsBoard); } catch (e) {}
        try { paintAtsWatch(atsBoard); } catch (e) {}
        try { if (typeof updateUI === "function") updateUI(); } catch (e) {}
        try { if (typeof drawArt === "function") drawArt(); } catch (e) {}
      }
    } catch (e) {}
    if (atsPollTimer) clearInterval(atsPollTimer);
    atsPollTimer = setInterval(function () {
      if (mode !== "art" && mode !== "floor" && !isSeatsMode(mode) && focusTable !== "ats") return;
      fetch("/api/ats", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        if (!data) return;
        atsBoard = data;
        try { paintAresEyes((data.chair && data.chair.eyes) || (data.pick && data.pick.eyes)); } catch (e) {}
        try { renderAtsBotsGuide(data); } catch (e) {}
        try { paintAtsChartTape(data); } catch (e) {}
        try { paintAtsWhy(data); } catch (e) {}
        try { paintAtsWatch(data); } catch (e) {}
      }).catch(function () {});
    }, 20000);
  }
  window.loadAtsTable = loadAtsTable;
  function renderAtsBotsGuide(data) {
    const grid = document.getElementById("atsBotsGrid");
    if (!grid) return;
    const fallback = [
      { id: "LINE", job: "The Kalshi book / the number.", mark: "/static/bots/line.png" },
      { id: "STEAM", job: "Line movement.", mark: "/static/bots/steam.png" },
      { id: "FADE", job: "Public vs sharp.", mark: "/static/bots/fade.png" },
      { id: "HURT", job: "Injuries / out.", mark: "/static/bots/hurt.png" },
      { id: "ICE", job: "Veto. 99¢ chalk, empty book, stale, too early, no depth.", mark: "/static/bots/ice.png" },
    ];
    const seats = ((data && data.seats) || fallback);
    const chair = (data && data.chair) || { id: "ARES", name: "ARES", job: "Sports chair. One game.", mark: "/static/ares-chair.png" };
    const subs = ((data && data.subs) || [
      { id: "CLOCK", parent: "LINE", call: "Time to kick / tip / first pitch." },
      { id: "FORM", parent: "FADE", call: "ATS / record." },
      { id: "WX", parent: "ICE", call: "Outdoor weather that moves a total or spread." },
    ]);
    const rows = [chair].concat(seats);
    grid.innerHTML = rows.map(function (s) {
      const callsign = (s.id === "ARES" || s.name === "ARES") ? "ARES" : String(s.id || "");
      const face = (callsign === "ARES") ? "/static/ares-chair.png" : s.mark;
      const kids = subs.filter(function (sub) { return sub.parent === s.id; }).map(function (sub) {
        return '<div class="ats-sub">' + sub.id + " · " + String(sub.call || sub.job || "") + "</div>";
      }).join("");
      return '<article class="bot-card front-bot-card" data-ats-seat="' + callsign + '">' +
        '<div class="bot-card-head">' + frontBotMarkHtml(callsign, face) +
        '<span class="bot-callsign">' + callsign + "</span></div>" +
        '<div class="bot-blurb">' + String(s.job || s.call || "") + "</div>" +
        kids +
        "</article>";
    }).join("");
  }
  function paintAtsChartTape(data) {
    const line = document.getElementById("atsChartLine");
    const meta = document.getElementById("atsChartMeta");
    const pick = (data && data.pick) || {};
    const chair = (data && data.chair) || {};
    const watch = (data && data.watch) || chair.watch || pick.watch || {};
    const why = (data && data.why) || chair.why || pick.why || {};
    if (line) line.textContent = (chair.call || pick.number || "WAIT · no game on the table") + " · " + (why.line || "WHY · DARK") + " · " + (watch.line || "WATCH · DARK · NO LISTING");
    if (meta) meta.textContent = (pick.sport || "ATS") + (pick.kind ? (" · " + pick.kind) : "");
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
    const acc = (src.accuracy) || (state && state.accuracy) || {};
    const n = acc.total || 0;
    const thr = state && state.decision && state.decision.threshold_used;
    const edge = state && state.decision && state.decision.edge_score;
    const phase = n < 15
      ? ("COLD START · " + n + " settled — Chair is loose so the council can learn. Threshold " + (thr != null ? Number(thr).toFixed(2) : "—") + ".")
      : ("LEARNED · " + n + " settled · hit " + (acc.accuracy_pct != null ? acc.accuracy_pct + "%" : "—") + " · edge score " + (edge != null ? edge : "—") + " · thr " + (thr != null ? Number(thr).toFixed(2) : "—") + ".");
    if (phaseEl) phaseEl.textContent = chairTitleOf(focusTable) + " ranks (finish-only) · " + phase;
    const head = '<div class="rank-row head" role="row"><span>#</span><span>BOT</span><span>LIVE</span><span>HIT</span><span>MISS</span><span>WR%</span><span class="listen-col">LISTEN</span><span class="hide-sm">WT</span></div>';
    const rows = hier.filter(r => r.agent !== "law");
    const body = rows.map(r => {
      const ag = byName[r.agent] || {};
      const dir = ag.direction || "WAIT";
      const conf = ag.confidence != null ? ag.confidence : "—";
      const name = (r.agent === "leader" || r.agent === "chair")
        ? chairNameOf(focusTable)
        : (r.display_name || (AGENT_LABELS && AGENT_LABELS[r.agent]) || r.agent);
      const markSrc = isFrontSeatKey(r.agent) ? frontSeatMark(r.agent) : "";
      const markHtml = markSrc ? '<img class="rank-mark" src="' + markSrc + '" alt="" width="22" height="22">' : "";
      const wr = r.win_rate != null ? Math.round(r.win_rate * 100) + "%" : "—";
      const listen = r.listen != null ? Math.round(r.listen * 100) + "%" : "—";
      const muted = (r.listen || 1) < 0.4;
      const faded = !!(r.faded || r.invert);
      const fadeNote = faded ? " <span class=\"fade-tag\">FADE " + Math.round((r.fade_strength || 0) * 100) + "%</span>" : "";
      const top = (r.rank || 99) <= 3;
      return '<div class="rank-row ' + (top ? "top " : "") + (muted ? "muted-rank" : "") + '" role="row">' +
        '<span class="rk">#' + r.rank + '</span><span class="nm">' + markHtml + name + '</span>' +
        '<span class="dir-live ' + wxTone(dir) + '">' + (isFrontTable(focusTable) ? displayDir(dir) : dir) + " " + conf + (conf !== "—" ? "%" : "") + '</span>' +
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


  function aliasDeskMode(next) {
    const n = String(next || "").toLowerCase();
    if (n === "bots" || n === "ranks" || n === "dashboard") return "seats";
    return n;
  }
  function isSeatsMode(m) {
    return aliasDeskMode(m) === "seats";
  }
  function modeFromHash(hash) {
    const raw = String(hash == null ? (typeof location !== "undefined" ? location.hash : "") : hash)
      .replace(/^#/, "")
      .split(/[/?&]/)[0]
      .toLowerCase();
    if (!raw) return null;
    return aliasDeskMode(raw);
  }
  function syncModeHash(next) {
    try {
      if (typeof history === "undefined" || !history.replaceState) return;
      const want = "#" + String(next || "art");
      if ((location.hash || "") !== want) history.replaceState(null, "", want);
    } catch (e) {}
  }
  function applyHashMode() {
    const dest = modeFromHash(typeof location !== "undefined" ? location.hash : "");
    if (dest && typeof setMode === "function") {
      try { setMode(dest); } catch (e) {}
      return dest;
    }
    return null;
  }
  window.aliasDeskMode = aliasDeskMode;
  window.modeFromHash = modeFromHash;
  window.applyHashMode = applyHashMode;

  function paintSeatsPage() {
    try { renderBotsGuide(); } catch (e) {}
    try { renderRanksBoard(); } catch (e) {}
    try { renderDashboard(); } catch (e) {}
  }

  function setMode(next) {
    next = aliasDeskMode(next);
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
    if (next === "night" && mode === "night") {
      next = "art";
    }
    if (next === "follower" && !document.body.classList.contains("follower-unlocked")) {
      return;
    }
    if (next === "front" && document.body.classList.contains("front-tab-off")) {
      next = "art";
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
    try { syncPhoneBackBtn(); } catch (e) {}
    try { syncFloorChairToggles(); } catch (e) {}
    try { syncSeatSpinBtn(); } catch (e) {}
    try { if (typeof window.applyFocusChrome === "function") window.applyFocusChrome(); } catch (e) {}
    try {
      if (typeof window.__floorMusicOnMode === "function") {
        window.__floorMusicOnMode(mode === "floor" || mode === "night");
      }
    } catch (e) {}
    // Hierarchy on Seats (old ranks / dashboard)
    document.body.classList.toggle("show-hierarchy", isSeatsMode(mode));
    const seatsView = document.getElementById("seatsView");
    const botsView = document.getElementById("botsView");
    const ranksView = document.getElementById("ranksView");
    const paperView = document.getElementById("paperView");
    const settingsView = document.getElementById("settingsView");
    const followerView = document.getElementById("followerView");
    const tapeView = document.getElementById("tapeView");
    const bookView = document.getElementById("bookView");
    const brainView = document.getElementById("brainView");
    const newsView = document.getElementById("newsView");
    const wireView = document.getElementById("wireView");
    const schoolView = document.getElementById("schoolView");
    const sideView = document.getElementById("sideView");
    const frontView = document.getElementById("frontView");
    const showCharts = mode === "charts";
    const showSeats = isSeatsMode(mode);
    const showBots = showSeats;
    const showRanks = showSeats;
    const showPaper = mode === "paper";
    const showSettings = mode === "settings";
    const showFollower = mode === "follower";
    const showTape = mode === "tape";
    const showBook = mode === "book";
    const showBrain = mode === "brain";
    const showNews = mode === "news";
    const showWire = mode === "wire";
    const showSchool = mode === "school";
    const showSide = mode === "side";
    const showFront = mode === "front";
    const showMain = mode === "art" || mode === "floor" || mode === "night";
    if (chartsView) chartsView.classList.toggle("hidden", !showCharts);
    if (seatsView) seatsView.classList.toggle("hidden", !showSeats);
    if (botsView) botsView.classList.toggle("hidden", !showBots);
    if (ranksView) ranksView.classList.toggle("hidden", !showRanks);
    if (paperView) paperView.classList.toggle("hidden", !showPaper);
    if (settingsView) settingsView.classList.toggle("hidden", !showSettings);
    if (followerView) followerView.classList.toggle("hidden", !showFollower);
    if (tapeView) tapeView.classList.toggle("hidden", !showTape);
    if (bookView) bookView.classList.toggle("hidden", !showBook);
    if (brainView) brainView.classList.toggle("hidden", !showBrain);
    if (newsView) newsView.classList.toggle("hidden", !showNews);
    if (wireView) wireView.classList.toggle("hidden", !showWire);
    if (schoolView) schoolView.classList.toggle("hidden", !showSchool);
    if (sideView) sideView.classList.toggle("hidden", !showSide);
    if (frontView) frontView.classList.toggle("hidden", !showFront);
    if (mainTable) mainTable.classList.toggle("hidden", !showMain);
    if (overlay) overlay.classList.toggle("hidden", !showSeats);
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
    if (showSeats) paintSeatsPage();
    if (mode === "paper") {
      fetchPaper().then(() => renderPaper());
    }
    if (mode === "tape") loadChairTape();
    if (mode === "book") loadKalshiBook();
    if (mode === "brain") loadBrainRecap();
    if (mode === "news") loadDeskNews();
    if (mode === "wire") loadDeskWire();
    if (mode === "school") loadSchool();
    if (mode === "side") loadSideTable();
    if (mode === "front") loadFrontTable();
    if (typeof isAtsTable === "function" && isAtsTable(focusTable) && (mode === "art" || mode === "floor" || isSeatsMode(mode) || mode === "charts" || mode === "tape" || mode === "paper")) {
      try { loadAtsTable(); } catch (e) {}
    }
    if (mode === "follower" && typeof window.renderFollower === "function") {
      try { window.renderFollower(); } catch (e) {}
    }
    if (mode === "settings" && prevMode !== "settings") {
      fetchSettings().then((s) => { if (s) applySettingsSnapshot(s, { localToggles: true }); });
    }
    try { syncAutoBetVisibility(); } catch (e) {}
    if (mode === "floor" || mode === "art" || mode === "night") {
      try { prefetchLeaderClickVideo(); } catch (e) {}
    }
    try { paintFloorCrawl(); } catch (e) {}
    try { paintChairWhy(); } catch (e) {}
    try { paintPhoneScore(); } catch (e) {}
    if (mode === "charts") {
      try { syncChartHero(); } catch (e) {}
      try { syncChartPairTitle(); } catch (e) {}
      // Layout after the view is visible, then draw (avoids 0×0 canvases)
      requestAnimationFrame(() => {
        try { if (chartsView) void chartsView.offsetWidth; } catch (e) {}
        requestAnimationFrame(() => { if (!deskCinematicOn()) drawCharts(); });
      });
    }
    try { syncModeHash(mode); } catch (e) {}
  }

  function applyDeskState(payload) {
    if (!payload || typeof payload !== "object") return false;
    state = payload;
    try { window.state = state; } catch (e) {}
    try { updateUI(); } catch (e) { console.warn("applyDeskState updateUI", e); }
    try { paintTableHud(); } catch (e) {}
    try { paintFloorCrawl(); } catch (e) {}
    try { paintChairWhy(); } catch (e) {}
    try { paintPhoneScore(); } catch (e) {}
    try { dockWindowLed(); } catch (e) {}
    try {
      tasteChairActivity("bitcoin");
      tasteChairActivity("ethereum");
      bumpChairPulse("bitcoin", 0.16);
      bumpChairPulse("ethereum", 0.16);
    } catch (e) {}
    try {
      if (mode === "art" || mode === "floor") drawArt();
    if (mode === "night") drawArt();
    } catch (e) {}
    const view = (typeof getViewState === "function") ? getViewState() : state;
    return tableHasLiveHour(view || state);
  }
  window.applyDeskState = applyDeskState;

  async function hydrateLiveHour() {
    try {
      const r = await fetch(`${API_BASE}/api/state`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const payload = await r.json();
      applyDeskState(payload);
    } catch (e) {
      console.warn("hydrateLiveHour failed", e);
    }
    try {
      if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
    } catch (e) {}
  }
  window.hydrateLiveHour = hydrateLiveHour;

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
    const prevDir = decisionDir ? decisionDir.textContent : "";
    // Prefer locked_call so the strip matches the plaque / portrait after the single call
    const lc = state.locked_call || d.locked_call || null;
    const hasLock = !!(lc && lc.locked && lc.direction && (lc.direction === "UP" || lc.direction === "DOWN" || lc.direction === "ABOVE" || lc.direction === "BELOW" || lc.direction === "BETWEEN"));
    const rawDir = hasLock ? lc.direction : (d.direction || "WAIT");
    if (decisionDir) {
      const shown = displayDir(rawDir);
      decisionDir.textContent = lawLocked() ? "LOCKED" : (hasLock ? ("LOCKED " + shown) : (d.display_direction || shown));
      decisionDir.className = "dir " + wxTone(rawDir);
    }
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
    if (decisionConf) {
      decisionConf.textContent = (hasLock && lc && lc.confidence != null)
        ? (lc.confidence + "%")
        : (d.confidence != null ? d.confidence + "%" : "—");
    }
    if (decisionSummary) {
      decisionSummary.textContent = d.summary || "";
      if (d.regime_key) {
        decisionSummary.textContent = (decisionSummary.textContent || "") +
          (decisionSummary.textContent ? " · " : "") + "regime " + d.regime_key;
      }
    }
    if (btcPrice) btcPrice.textContent = state.market?.price ? Number(state.market.price).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—";
    if (fundingEl) fundingEl.textContent = state.market?.funding != null ? (state.market.funding * 100).toFixed(4) + "%" : "—";
    if (kalshiTicker) kalshiTicker.textContent = state.market?.kalshi_ticker || "—";
    const upEl = document.getElementById("liveUpPct");
    const dnEl = document.getElementById("liveDownPct");
    const timEl = document.getElementById("windowTimer");
    const m = state.market || {};
    const book = liveBookOdds(m);
    if (upEl) upEl.textContent = book ? book.up.toFixed(1) + "%" : "—";
    if (dnEl) dnEl.textContent = book ? book.down.toFixed(1) + "%" : "—";
    let deskChrome = false;
    try { deskChrome = !!paintFrontWindowChrome(); } catch (e) { deskChrome = false; }
    if (deskChrome) {
      /* Front CLI / ATS kick — do not stamp the crypto 1H hour clock. */
    } else if (timEl || document.getElementById("ledWindowTime")) {
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
      const ledLabel = document.getElementById("ledWindowLabel");
      if (ledLabel) ledLabel.textContent = "1H WINDOW";
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
      const wxStrip = document.getElementById("wxHighStrip");
      if (wxStrip) wxStrip.hidden = true;
    }

    if (lastUpdateEl) lastUpdateEl.textContent = state.timestamp ? new Date(state.timestamp).toLocaleTimeString() : "—";
    updateAccuracy(((typeof tableState === "function" ? tableState(focusTable) : null) || state || {}).accuracy || state.accuracy);
    try { paintTableHud(); } catch (e) {}
    try {
      if (typeof floorLikeMode === "function" && floorLikeMode() && typeof paintFloorLeaderClocks === "function") {
        const canvas = document.getElementById("roundtable");
        const keys = (typeof visibleFloorChairs === "function") ? visibleFloorChairs() : [];
        const w = canvas ? canvas.width : 0;
        const h = canvas ? canvas.height : 0;
        const slots = (typeof floorChairLayout === "function") ? floorChairLayout(w, h, keys, typeof isPhoneDesk === "function" && isPhoneDesk()) : [];
        paintFloorLeaderClocks(w, h, slots);
      }
    } catch (e) {}
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
    if (statusDot) statusDot.className = "dot " + (healthy ? "live" : "warn");

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
    try { stepAllChairPulses(ts); } catch (e) {}
    try { maybeAttractEnter(); } catch (e) {}
    if (mode === "art" || mode === "floor") drawArt();
    if (mode === "night") drawArt();
    if (!document.hidden) {
      animId = requestAnimationFrame(loop);
    } else {
      animId = setTimeout(() => { animId = requestAnimationFrame(loop); }, 500);
    }
  }

  async function poll() {
    try {
      const r = await fetch(`${API_BASE}/api/state`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const payload = await r.json();
      applyDeskState(payload);
      try { loadHealthStrip(); } catch (e) {}
      try { maybePlayJailDoor(); } catch (e) {}
      try { if (typeof updateLightsaber === "function") updateLightsaber(state); } catch (e) {}
      try { if (typeof playOutcomeFx === "function") playOutcomeFx(state); } catch (e) {}
      if (isSeatsMode(mode)) paintSeatsPage();
    } catch (e) {
      if (statusDot) statusDot.className = "dot err";
      console.warn("Council poll failed", e);
    }
  }
  window.poll = poll;

  const openChartsBtn = document.getElementById("openChartsBtn");
  if (openChartsBtn) {
    openChartsBtn.addEventListener("click", () => setMode("charts"));
  }
  modeTabs.forEach(btn => {
    if (!btn.dataset.mode || btn.id === "focusBtc" || btn.id === "focusEth" || btn.id === "focusFront") return;
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
      if (!btn || btn.id === "focusBtc" || btn.id === "focusEth" || btn.id === "focusFront" || btn.id === "btnHelp") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setMode(btn.dataset.mode);
    }, true);
  }
  function initModeTabsScroll() {
    const scroller = document.getElementById("modeTabs");
    const prev = document.getElementById("modeTabsPrev");
    const next = document.getElementById("modeTabsNext");
    if (!scroller || !prev || !next) return;
    const sync = () => {
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const x = scroller.scrollLeft;
      const overflow = max > 8;
      prev.setAttribute("aria-disabled", (!overflow || x <= 4) ? "true" : "false");
      next.setAttribute("aria-disabled", (!overflow || x >= max - 4) ? "true" : "false");
      scroller.classList.toggle("tabs-overflow", overflow);
      scroller.classList.toggle("tabs-at-start", x <= 4);
      scroller.classList.toggle("tabs-at-end", !overflow || x >= max - 4);
    };
    if (!scroller.__tabScrollWired) {
      scroller.__tabScrollWired = true;
      prev.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        scroller.scrollBy({ left: -Math.max(120, scroller.clientWidth * 0.7), behavior: "smooth" });
      });
      next.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        scroller.scrollBy({ left: Math.max(120, scroller.clientWidth * 0.7), behavior: "smooth" });
      });
      scroller.addEventListener("scroll", sync, { passive: true });
      window.addEventListener("resize", sync);
    }
    sync();
  }
  try { initModeTabsScroll(); } catch (e) {}
  window.initModeTabsScroll = initModeTabsScroll;
  if (!window.__seatsHashWired) {
    window.__seatsHashWired = true;
    window.addEventListener("hashchange", function () {
      try { applyHashMode(); } catch (e) {}
    });
  }
  const seatsCardsToggle = document.getElementById("seatsCardsToggle");
  if (seatsCardsToggle && !seatsCardsToggle.__wired) {
    seatsCardsToggle.__wired = true;
    seatsCardsToggle.addEventListener("click", function () {
      const on = !document.body.classList.contains("seats-cards-off");
      document.body.classList.toggle("seats-cards-off", on);
      seatsCardsToggle.setAttribute("aria-pressed", on ? "false" : "true");
      seatsCardsToggle.textContent = on ? "CARDS OFF" : "CARDS ON";
    });
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
        : ["art", "seats", "paper", "tape", "book", "brain", "news", "wire", "charts", "settings"];
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
      if (typeof window.__dismissDeskIntro === "function" && window.__dismissDeskIntro()) {
        e.preventDefault();
        return;
      }
      if (typeof window.__dismissLeaderClick === "function" && window.__dismissLeaderClick()) {
        e.preventDefault();
        return;
      }
      if (typeof window.__dismissCloseRecap === "function" && window.__dismissCloseRecap()) {
        e.preventDefault();
        return;
      }
      if (mode === "floor" || mode === "night") setMode("art");
    }
    if (e.key === "0") setMode("floor");
    if (e.key === "1") setMode("art");
    if (e.key === "2") setMode("seats");
    if (e.key === "3") setMode("seats");
    if (e.key === "4") setMode("seats");
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
    try { syncExclusiveBodyMode(mode); } catch (e) {}
    try { paintPhoneScore(); } catch (e) {}
    try { paintChairWhy(); } catch (e) {}
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
    { name: "ORBIT", role: "Regime", desc: "Session + volatility — when the Chair should be bold." },
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
      body: "A living Round Table of specialist bots watching Kalshi’s 15-minute Bitcoin market (KXBTC15M) and the Ethereum table. The Chair (Satoshi on BTC, Vitalik on ETH) locks exactly one high-quality paper call per window — UP or DOWN — only when the book is inside 10–90¢ (never 99¢ chalk). Otherwise WAIT.\n\nThis is a research co-pilot. It does not place real orders.",
    },
    {
      mode: "art",
      target: "#tableStage",
      title: "GOAL CONTRACT",
      body: "1. One directional guess per 15-minute window on how the window ends.\n2. Taken only at the best available odds (book inside 10–90¢).\n3. Once locked → irreversible for that window.\n4. WAIT preferred over low-edge or noisy calls.",
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
      body: "1. Specialists vote UP / DOWN / WAIT.\n2. Higher-ranked bots count more.\n3. Chair requires confluence + pair affinity.\n4. Odds gate: book must be inside 10–90¢. Never play 99¢ chalk.\n5. First firm full UP/DOWN that clears the gates becomes the single LOCKED call.\n6. After lock, the plaque is what followers and the UI follow.",
    },
    {
      mode: "floor",
      target: "#tabFloor",
      title: "FLOOR",
      body: "Floor is four equal chairs: Satoshi, Vitalik, Raijin, Ares. Tap a Chair to focus that table. The strip is a paper match score. Reset is in Settings. ESC or TABLE returns to the desk.",
    },
    {
      mode: "seats",
      target: "#tabSeats",
      title: "SEATS",
      body: "Same people, one page. Field guide (who they are), rank board (how they sit), live cards (the lean). BTC / ETH / ATS / DWF switch which Chair you are reading. Old #bots #ranks #dashboard links land here.",
    },
    {
      mode: "paper",
      target: "#tabPaper",
      title: "PAPER",
      body: "Practice scorecard. Paper-track expectancy before any size. Quality over quantity. One high-edge guess per window. This desk does not place real orders.",
    },
    {
      mode: "front",
      target: "#tabFront",
      title: "THE FRONT",
      body: "Raijin / THE FRONT. Raijin is the weather Chair. Raijin’s Floor — same ring as BTC / ETH, not a list.\n\nDallas daily high only (KXHIGHTDAL, DFW / KDFW — not Love Field). Date lives in the ticker. Settles on NWS CLI the next morning.\n\nSeats: GLASS (NWS PANE) · MESH (THE WEB) · PIT (THE PIT) · FROST (FROST KILL) · BONE (BONE CLIMO). Subs: HEAT · ECHO · CELL. They feed. They do not vote.\n\nHits count like Satoshi / Vitalik. Paper first. Small third chair on the shared Floor. Full-size ring on the Front tab. Does not place 1H Chair locks.",
    },
    {
      mode: "art",
      target: "#focusAts",
      title: "ARES / ATS",
      body: "Ares is the sports Chair. One ticket. You do not pick the slate.\n\nGold tab ATS. Calls are COVER / NO-COVER, HOME / AWAY or the team, OVER / UNDER. WAIT stays WAIT.\n\nSeats: LINE · STEAM · FADE · HURT · ICE. CLOCK / FORM / WX are subs under a parent — not a sixth ring seat.\n\nGates: ONE TICKET · KEY NUMBERS · SIT AFTER KICK · SPORT BRAINS · PUBLIC TUG (floor visual only, does not override gates).\n\nPaper only. Follower off. Empty book is UNKNOWN, not DEAD. Sports band 20–80. 10–90 is crypto only.",
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
      body: "BEAST MODE, sounds, and knobs. RAIJIN / THE FRONT is its own block — show the Front tab, the equal Floor chair, paper default, WX stake / daily loss, FROST / SICK no-lock, and fade underperformers. It is not Follower. Settings stays behind the admin lock.",
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
    document.documentElement.classList.remove("gate-locked", "gate-revealing");
    document.body.classList.remove("gate-locked", "gate-revealing", "tutorial-walk");
    try { revealAppAfterDeskUnlock(); } catch (e) {}
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
    // Parked cinematic. Go straight to the desk. No clip. No fullscreen.
    try { finishSummon(fog); } catch (e) { try { dismissGate(false, "floor"); } catch (e2) {} }
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
      document.documentElement.classList.remove("gate-locked", "gate-revealing");
      document.body.classList.remove("gate-locked", "gate-revealing");
      document.body.classList.add("tutorial-walk");
      try { revealAppAfterDeskUnlock(); } catch (e) {}
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
    const focusFront = document.getElementById("focusFront");
    if (!focusBtc && !focusEth && !focusFront) return;

    function applyFocusChrome() {
      const isEth = isEthTable(focusTable);
      const isFront = isFrontTable(focusTable);
      const isAts = typeof isAtsTable === "function" && isAtsTable(focusTable);
      const isOracle = typeof isOracleTable === "function" && isOracleTable(focusTable);
      document.body.dataset.focusTable = isOracle ? "oracle" : (isAts ? "ats" : (isFront ? "front" : (isEth ? "ethereum" : "bitcoin")));
      try { syncChairRoom(focusTable, (typeof tableState === "function" ? tableState(focusTable) : null) || state); } catch (e) {}
      if (focusBtc) {
        focusBtc.classList.remove("active", "mode-tab");
        if (isEth || isFront || isAts || isOracle) focusBtc.classList.remove("focus-active");
        else focusBtc.classList.add("focus-active");
      }
      if (focusEth) {
        focusEth.classList.remove("active", "mode-tab");
        if (isEth && !isFront && !isAts && !isOracle) focusEth.classList.add("focus-active");
        else focusEth.classList.remove("focus-active");
      }
      if (focusFront) {
        focusFront.classList.remove("active", "mode-tab");
        if (isFront) focusFront.classList.add("focus-active");
        else focusFront.classList.remove("focus-active");
      }
      const focusAts = document.getElementById("focusAts");
      if (focusAts) {
        focusAts.classList.remove("active", "mode-tab");
        if (isAts) focusAts.classList.add("focus-active");
        else focusAts.classList.remove("focus-active");
      }
      const badge = document.getElementById("focusTableBadge");
      if (badge) {
        badge.textContent = chairBadgeOf(focusTable);
        badge.setAttribute("aria-label", chairTitleOf(focusTable));
      }
      const stage = document.getElementById("roundtable");
      if (stage) {
        const dual = (typeof mode !== "undefined" && floorLikeMode() && typeof floorIsSingle === "function" && !floorIsSingle());
        stage.setAttribute("aria-label", dual
          ? "Floor — Satoshi BTC, Vitalik ETH, Raijin DFW, Ares ATS, ORACLE"
          : (isOracle ? "ORACLE watch table" : (isAts ? "Ares ATS table" : (isFront ? "Raijin DFW table" : (isEth ? "Vitalik ETH table" : "Satoshi BTC table")))));
      }
      try { syncChartPairTitle(); } catch (e) {}
      try { paintFrontWindowChrome(); } catch (e) {}
    }

    function setFocusTable(which) {
      const w = String(which || "").toLowerCase();
      if (w === "oracle" || w === "crt") focusTable = "oracle";
      else if (w === "ats" || w === "ares" || w === "sports") focusTable = "ats";
      else if (w === "front" || w === "raijin" || w === "dfw" || w === "dallas" || w === "dwf") focusTable = "front";
      else if (w === "ethereum" || w === "eth" || w === "vitalik") focusTable = "ethereum";
      else focusTable = "bitcoin";
      try { localStorage.setItem("council_focus_table", focusTable); } catch (e) {}
      if (focusTable === "front") {
        try { if (typeof loadFrontTable === "function") loadFrontTable(); } catch (e) {}
        try { if (mode === "front") setMode("art"); } catch (e) {}
      }
      if (focusTable === "ats") {
        try { if (typeof loadAtsTable === "function") loadAtsTable(); } catch (e) {}
        try { paintAresEyes(((typeof tableState === "function" ? tableState("ats") : null) || {}).eyes); } catch (e) {}
      } else {
        try { paintAresEyes({ mode: "wait" }); } catch (e) {}
      }
      applyFocusChrome();
      try { updateUI(); } catch (e) { console.warn("focus updateUI", e); }
      try { drawArt(); } catch (e) { console.warn("focus drawArt", e); }
      try { if (isSeatsMode(mode)) paintSeatsPage(); } catch (e) {}
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
    window.applyFocusChrome = applyFocusChrome;
    bind(focusBtc, "bitcoin");
    bind(focusEth, "ethereum");
    bind(focusFront, "front");
    const focusAts = document.getElementById("focusAts");
    bind(focusAts, "ats");
    applyFocusChrome();
    try { if (typeof loadAtsTable === "function") loadAtsTable(); } catch (e) {}
    const floorExit = document.getElementById("floorExitBtn");
    if (floorExit && !floorExit.__wired) {
      floorExit.__wired = true;
      floorExit.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setMode("art");
      });
    }
    const closeRecap = document.getElementById("closeRecap");
    if (closeRecap && !closeRecap.__wired) {
      closeRecap.__wired = true;
      closeRecap.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.__dismissCloseRecap === "function") window.__dismissCloseRecap();
      });
    }
    const phoneScore = document.getElementById("phoneScore");
    if (phoneScore && !phoneScore.__wired) {
      phoneScore.__wired = true;
      phoneScore.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const order = ["ethereum", "bitcoin", "front", "ats", "oracle"];
        const idx = order.indexOf(focusTable);
        const next = order[(idx + 1) % order.length];
        if (typeof setFocusTable === "function") setFocusTable(next);
        try { paintPhoneScore(); } catch (err) {}
        try { paintChairWhy(); } catch (err) {}
      });
    }
    const stage = document.getElementById("tableStage");
    if (stage && !stage.__phoneFlipWired) {
      stage.__phoneFlipWired = true;
      let sx = null;
      stage.addEventListener("touchstart", function (e) {
        if (!e.changedTouches || !e.changedTouches[0]) return;
        sx = e.changedTouches[0].clientX;
      }, { passive: true });
      stage.addEventListener("touchend", function (e) {
        if (sx == null || !e.changedTouches || !e.changedTouches[0]) return;
        if (typeof isPhoneDesk === "function" && !isPhoneDesk()) return;
        if (mode !== "floor" && mode !== "night") return;
        const dx = e.changedTouches[0].clientX - sx;
        sx = null;
        if (Math.abs(dx) < 48) return;
        const next = dx < 0 ? "ethereum" : "bitcoin";
        if (typeof setFocusTable === "function") setFocusTable(next);
        try { paintPhoneScore(); } catch (err) {}
        try { paintChairWhy(); } catch (err) {}
      }, { passive: true });
    }
    const seatSpin = document.getElementById("seatSpinBtn");
    if (seatSpin && !seatSpin.__wired) {
      seatSpin.__wired = true;
      seatSpin.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setSeatSpin(seatOrbitFrozen);
      });
    }
    try { syncSeatSpinBtn(); } catch (e) {}
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
  function prefetchLeaderClickVideo() {
    // Unused. Leader photo click selects the leader. File may stay on disk.
    return;
  }
  window.prefetchLeaderClickVideo = prefetchLeaderClickVideo;

  function playLeaderClickVideo() {
    // Unused. Leader photo click selects the leader. No overlay clip.
    return;
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
    if (pair) pair.textContent = isFrontTable(focusTable) ? "DFW" : (focusTable === "bitcoin" ? "BTC" : "ETH");
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
      if (mode !== "floor" && mode !== "art") {
        canvas.classList.remove("chair-hot");
        return;
      }
      const pt = canvasCssPoint(e);
      canvas.classList.toggle("chair-hot", !!(pt && chairHitAt(pt.x, pt.y)));
    };
    const onGesture = (e) => {
      if ((mode !== "floor" && mode !== "art") || celebratePlaying) return;
      if (document.body.classList.contains("gate-locked")) return;
      const pt = canvasCssPoint(e);
      const hit = pt && chairHitAt(pt.x, pt.y);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      if (hit.which === "front") {
        try { setFocusTable("front"); } catch (err) {}
      } else {
        try { setFocusTable(hit.which); } catch (err) {}
      }
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
  function wireFloorChairToggles() {
    const el = document.getElementById("floorChairToggles");
    if (!el || el.__wired) return;
    el.__wired = true;
    el.addEventListener("change", function (e) {
      const inp = e.target;
      if (!inp || !inp.getAttribute) return;
      const k = inp.getAttribute("data-floor-chair");
      if (!k) return;
      setFloorChairOn(k, inp.checked);
    });
    syncFloorChairToggles();
  }
  wireFloorChairToggles();
  wirePhoneBackBtn();
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

  function collectFrontSettings() {
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
    return {
      show_tab: on("setFrontShowTab"),
      show_floor_chair: on("setFrontShowChair"),
      paper_only: true,
      min_confidence: num("setFrontMinConf", 50),
      max_stake: num("setFrontMaxStake", 25),
      daily_loss_cap: num("setFrontDailyLoss", 50),
      no_lock_frost_sick: on("setFrontNoLockFrost"),
      sound_on_lock: on("setFrontSound"),
      fade_underperformers: on("setFrontFadeOn"),
      fade_min_n: num("setFrontFadeMinN", 20),
      fade_wr_threshold: num("setFrontFadeWr", 0.42),
      dallas: true,
    };
  }
  function applyFrontSettings(F) {
    F = F || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    chk("setFrontShowTab", F.show_tab !== false);
    chk("setFrontShowChair", F.show_floor_chair !== false);
    const paper = document.getElementById("setFrontPaper");
    const live = document.getElementById("setFrontLive");
    if (paper) paper.checked = true;
    if (live) { live.checked = false; live.disabled = true; }
    set("setFrontMinConf", F.min_confidence);
    set("setFrontMaxStake", F.max_stake);
    set("setFrontDailyLoss", F.daily_loss_cap);
    chk("setFrontNoLockFrost", F.no_lock_frost_sick !== false);
    chk("setFrontSound", F.sound_on_lock !== false);
    chk("setFrontFadeOn", F.fade_underperformers !== false);
    set("setFrontFadeMinN", F.fade_min_n);
    set("setFrontFadeWr", F.fade_wr_threshold);
    chk("setFrontDallas", true);
    const dallas = document.getElementById("setFrontDallas");
    if (dallas) dallas.disabled = true;
    document.body.classList.add("front-tab-off");
    document.body.classList.toggle("front-chair-off", F.show_floor_chair === false);
    if (F.show_tab === false && typeof mode !== "undefined" && mode === "front") {
      try { setMode("art"); } catch (e) {}
    }
  }
  window.collectFrontSettings = collectFrontSettings;
  window.applyFrontSettings = applyFrontSettings;

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
      front: collectFrontSettings(),
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

  const floorRaijinBtn = document.getElementById("floorRaijin");
  if (floorRaijinBtn && !floorRaijinBtn.__wired) {
    floorRaijinBtn.__wired = true;
    floorRaijinBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      try { setFocusTable("front"); } catch (err) {}
    });
  }

  window.setMode = setMode;
  try { syncWireHot(); } catch (e) {}
  window.__deskModeCycle = function () {
    return ["art", "seats", "paper", "tape", "book", "night", "brain", "news", "wire", "school", "side", "charts", "settings"];
  };
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
  if (chartsView && !chartsView.__deskWheel) {
    chartsView.__deskWheel = true;
    chartsView.addEventListener("wheel", (e) => {
      e.stopPropagation();
      const room = chartsView.scrollHeight - chartsView.clientHeight;
      if (room <= 1) return;
      const prev = chartsView.scrollTop;
      chartsView.scrollTop += e.deltaY;
      if (chartsView.scrollTop !== prev) e.preventDefault();
    }, { capture: true, passive: false });
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
  try { wireAttractIdle(); } catch (e) {}
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
    if (typeof window.applyFrontSettings === "function") {
      try { window.applyFrontSettings(s.front || {}); } catch (e) {}
    } else {
      const F = s.front || {};
      chk("setFrontShowTab", F.show_tab !== false);
      chk("setFrontShowChair", F.show_floor_chair !== false);
      set("setFrontMinConf", F.min_confidence);
      set("setFrontMaxStake", F.max_stake);
      set("setFrontDailyLoss", F.daily_loss_cap);
      chk("setFrontNoLockFrost", F.no_lock_frost_sick !== false);
      chk("setFrontSound", F.sound_on_lock !== false);
      chk("setFrontFadeOn", F.fade_underperformers !== false);
      set("setFrontFadeMinN", F.fade_min_n);
      set("setFrontFadeWr", F.fade_wr_threshold);
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
      front: (typeof window.collectFrontSettings === "function") ? window.collectFrontSettings() : {
        show_tab: on("setFrontShowTab"),
        show_floor_chair: on("setFrontShowChair"),
        paper_only: true,
        min_confidence: num("setFrontMinConf", 50),
        max_stake: num("setFrontMaxStake", 25),
        daily_loss_cap: num("setFrontDailyLoss", 50),
        no_lock_frost_sick: on("setFrontNoLockFrost"),
        sound_on_lock: on("setFrontSound"),
        fade_underperformers: on("setFrontFadeOn"),
        fade_min_n: num("setFrontFadeMinN", 20),
        fade_wr_threshold: num("setFrontFadeWr", 0.42),
        dallas: true,
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

  const DESK_INTRO_KEY = "council_desk_intro_played";

  function prefetchDeskIntroVideo() {
    // Parked. Zach is remaking the clips. Do not warm or play.
  }

  function playDeskUnlockIntro() {
    // Parked. After SUMMON go straight to the desk. No clip. No fullscreen.
    try { if (typeof window.revealAppAfterDeskUnlock === "function") window.revealAppAfterDeskUnlock(); } catch (e) {}
  }
  window.playDeskUnlockIntro = playDeskUnlockIntro;
  window.prefetchDeskIntroVideo = prefetchDeskIntroVideo;
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && window.__deskIntroPlaying) {
      e.preventDefault();
      if (typeof window.__dismissDeskIntro === "function") window.__dismissDeskIntro();
    }
  });

  function showAppAfterAuth() {
    if (typeof window.revealAppAfterDeskUnlock === "function") {
      window.revealAppAfterDeskUnlock();
    }
    document.body.classList.remove("admin-unlocked");
    const onboarded = (typeof window.hasOnboarded === "function") ? window.hasOnboarded() : false;
    if (onboarded) {
      const sg = document.getElementById("summonGate");
      if (sg) sg.classList.add("hidden");
      try {
        const dest = (typeof window.modeFromHash === "function" && window.modeFromHash(location.hash)) || "art";
        if (typeof window.setMode === "function") window.setMode(dest);
      } catch (e) {}
      try { if (typeof window.hydrateLiveHour === "function") window.hydrateLiveHour(); } catch (e) {}
      return;
    }
    // First-login choice overlays the desk. Do not re-lock html/body —
    // a leftover html.gate-locked would keep #app visibility:hidden.
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
    if (initPasswordGate.__wired) return;
    initPasswordGate.__wired = true;
    // Never skip the desk code from leftover storage. Cold tab / hard refresh
    // must see the access overlay. A leftover unlocked session is not the public default.
    try { localStorage.removeItem(passKey); } catch (e) {}
    try { sessionStorage.removeItem(passKey); } catch (e) {}
    try { localStorage.removeItem("council_admin_unlocked"); } catch (e) {}
    try { sessionStorage.removeItem("council_admin_unlocked"); } catch (e) {}
    window.__deskUnlockedThisPage = false;
    document.body.classList.remove("admin-unlocked", "desk-unlocked");
    document.documentElement.classList.remove("desk-unlocked");
    const pg = document.getElementById("passwordGate");
    const input = document.getElementById("passwordInput");
    const btn = document.getElementById("passwordSubmit");
    const err = document.getElementById("passwordError");
    const agree = document.getElementById("gateAgree");
    if (!pg) return;
    pg.classList.remove("hidden");
    document.documentElement.classList.add("gate-locked");
    document.body.classList.add("gate-locked");
    document.body.classList.remove("admin-unlocked");
    document.body.setAttribute("data-password-protected", "true");
    const syncDeskGateSummon = () => {
      const sealed = !!(agree && agree.checked);
      if (btn) {
        btn.disabled = !sealed;
        btn.textContent = "SUMMON THE COUNCIL";
        btn.setAttribute("aria-disabled", sealed ? "false" : "true");
      }
      if (sealed && err && err.textContent === "Seal the pact first.") {
        err.classList.add("hidden");
      }
      return sealed;
    };
    const tryUnlock = () => {
      if (!syncDeskGateSummon()) {
        if (err) {
          err.textContent = "Seal the pact first.";
          err.classList.remove("hidden");
        }
        return;
      }
      const v = (input && input.value) || "";
      if (v === ACCESS_PASSWORD || v === "Nakamoto" || v.toLowerCase() === "nakamoto") {
        try { sessionStorage.setItem(passKey, "1"); } catch (e) {}
        try { localStorage.removeItem(passKey); } catch (e) {}
        window.__deskUnlockedThisPage = true;
        if (err) err.classList.add("hidden");
        // Fresh password entry → first-login choice, or the desk if already onboarded
        showAppAfterAuth();
      } else {
        if (err) {
          err.textContent = "Wrong password";
          err.classList.remove("hidden");
        }
      }
    };
    if (agree) agree.addEventListener("change", syncDeskGateSummon);
    syncDeskGateSummon();
    if (btn) btn.addEventListener("click", tryUnlock);
    const summonHit = document.getElementById("gateSummonHit");
    if (summonHit) {
      summonHit.addEventListener("click", function (e) {
        if (btn && btn.disabled) {
          e.preventDefault();
          tryUnlock();
        }
      });
    }
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
    try { prefetchDeskIntroVideo(); } catch (e) {}
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
        st.y += st.z * 0.72;
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

  // Thin always-on DOM saber is retired. Lock punch is canvas drawLockIgnition.
    window.updateLightsaber = function updateLightsaber() {
    const wrap = document.getElementById("lightsaberWrap");
    if (wrap) {
      wrap.classList.add("hidden");
      wrap.setAttribute("aria-hidden", "true");
    }
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
    try { if (typeof window.revealAppAfterDeskUnlock === "function") window.revealAppAfterDeskUnlock(); } catch (e) {}
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
        document.documentElement.classList.remove("gate-locked", "gate-revealing");
        document.body.classList.remove("gate-locked", "gate-revealing");
        try { if (typeof window.revealAppAfterDeskUnlock === "function") window.revealAppAfterDeskUnlock(); } catch (e) {}
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
          if (!confirm("Reset hit-rate and the Floor book match (BTC sized locks vs ETH shadow picks)? Training weights will NOT be deleted. Path-era scores will stop counting.")) return;
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
