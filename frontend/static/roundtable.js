/**
 * Satoshi’s Council – Dual-mode Blade Table
 * Screensaver Mode: High-tech cyberpunk knight / samurai Round Table
 * Dashboard Mode: armor-plate neon HUD cards
 */
(() => {
  const canvas = document.getElementById("roundtable");
  if (!canvas) {
    console.error("roundtable canvas missing");
  }
  const ctx = canvas ? canvas.getContext("2d") : null;
  const overlay = document.getElementById("dashboardOverlay");
  const modeBtn = document.getElementById("modeToggle");
  const statusDot = document.getElementById("statusDot");
  const lastUpdateEl = document.getElementById("lastUpdate");
  const decisionDir = document.getElementById("decisionDir");
  const decisionConf = document.getElementById("decisionConf");
  const decisionSummary = document.getElementById("decisionSummary");
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

  // Same-origin on Render (UI served by FastAPI); override via localStorage if needed
  const API_BASE =
    localStorage.getItem("council_api") ||
    (typeof location !== "undefined" && location.protocol.startsWith("http") &&
     location.port !== "5500" && location.port !== "3000"
      ? ""  // same origin — /api/state
      : "http://127.0.0.1:8000");
  // Poll faster than analysis interval so UI stays live after each cycle

  // Chair portrait (eye color by direction) — armored ZT knight
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
  chairImages.UP_HOLD = chairImages.UP;
  chairImages.DOWN_HOLD = chairImages.DOWN;
  chairImages.SWAP = chairImages.WAIT;

  function chairPortraitFor(dir) {
    const d = (dir || "WAIT").toUpperCase();
    if (d === "UP" || d === "UP_HOLD") return chairImages.UP;
    if (d === "DOWN" || d === "DOWN_HOLD") return chairImages.DOWN;
    return chairImages.WAIT;
  }


  // Gate disabled — enter table immediately
  try {
    localStorage.setItem("council_entered", "1");
    document.body.classList.remove("gate-locked", "gate-revealing");
    const g = document.getElementById("summonGate");
    if (g) g.remove();
  } catch (e) {}

  let POLL_MS = Number(localStorage.getItem("council_poll_ms")) || 800;
  let beastMode = localStorage.getItem("council_beast") !== "0";
  let pollTimer = null;

  function applyBeastChrome(on) {
    beastMode = !!on;
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
  }

  function applySettingsSnapshot(s) {
    if (!s) return;
    applyBeastChrome(!!s.beast_mode);
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
    if (U.watermark_opacity != null) {
      document.documentElement.style.setProperty("--zt-watermark-opacity", U.watermark_opacity);
    }
    const blurb = document.getElementById("beastBlurb");
    if (blurb) blurb.textContent = s.blurb || "";
    const stats = document.getElementById("beastStats");
    if (stats) {
      stats.textContent = s.beast_mode
        ? `Profile BEAST · cycle ${s.analysis_interval}s · hot ${s.analysis_interval_hot}s · dual-spot ${s.dual_spot ? "ON" : "OFF"}`
        : `Profile STANDARD · cycle ${s.analysis_interval}s · dual-spot ${s.dual_spot ? "ON" : "OFF"}`;
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

  async function fetchSettings() {
    try {
      const r = await fetch(API + "/api/settings");
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function setBeastMode(on) {
    try {
      const r = await fetch(API + "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beast_mode: !!on }),
      });
      if (r.ok) {
        const s = await r.json();
        applySettingsSnapshot(s);
        return s;
      }
    } catch (e) {
      console.warn("beast toggle failed", e);
    }
    applyBeastChrome(on);
    return null;
  }



  let mode = "art"; // art | dashboard | charts
  let state = null;

  // Rolling series for Charts tab (built from poll snapshots)
  const series = {
    odds: [],      // {t, up}
    delta: [],     // {t, d} price - target
    funding: [],   // {t, f}
    tape: [],      // {t, dir, conf}
    accuracy: [],  // {t, pct}
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
  let debateHistory = []; // rolling transcript so it feels like a live floor

  // Market-open bell — one ring per new 15m window
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


  /** Short purple mist burst when a new 15m market opens (~5s). */
  /**
   * Professional volumetric purple mist — particle physics.
   * Soft billows + micro-sparks + ground fog, ~5s cinematic burst on new market.
   */
  function playNewMarketMist() {
    try {
      // Stop any prior run
      if (window.__mistCtrl && typeof window.__mistCtrl.stop === "function") {
        try { window.__mistCtrl.stop(); } catch (e) {}
      }

      let wrap = document.getElementById("marketMist");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "marketMist";
        wrap.className = "market-mist";
        wrap.innerHTML = '<canvas id="marketMistCanvas"></canvas>';
        document.body.appendChild(wrap);
      }
      let canvas = document.getElementById("marketMistCanvas");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "marketMistCanvas";
        wrap.innerHTML = "";
        wrap.appendChild(canvas);
      }
      wrap.classList.add("active");
      wrap.classList.remove("fade");

      const ctx = canvas.getContext("2d", { alpha: true });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = 0, h = 0;
      function resize() {
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resize();

      // --- Particle system ---
      // Layers: 0 ground fog, 1 mid billows, 2 high wisps, 3 sparkle motes
      const blobs = [];
      const motes = [];
      const DURATION = 5200;
      const FADE_START = 2800;
      const t0 = performance.now();
      let raf = 0;
      let running = true;

      function spawnBlob(layer) {
        const ground = layer === 0;
        const high = layer === 2;
        return {
          layer,
          x: Math.random() * w,
          y: ground ? h * (0.55 + Math.random() * 0.5)
                    : high ? h * Math.random() * 0.5
                    : h * (0.2 + Math.random() * 0.65),
          // radius in px
          r: ground ? (90 + Math.random() * 160)
                    : high ? (50 + Math.random() * 110)
                    : (70 + Math.random() * 140),
          vx: (Math.random() - 0.5) * (ground ? 18 : 32),
          vy: ground ? -(8 + Math.random() * 14) : (Math.random() - 0.5) * 22,
          // turbulence seeds
          seed: Math.random() * 1000,
          phase: Math.random() * Math.PI * 2,
          breath: 0.55 + Math.random() * 0.9,
          // color in purple/magenta range
          hue: high ? 270 + Math.random() * 28 : 285 + Math.random() * 32,
          sat: ground ? 58 + Math.random() * 22 : 48 + Math.random() * 28,
          lit: ground ? 26 + Math.random() * 18 : 34 + Math.random() * 22,
          baseA: ground ? 0.16 + Math.random() * 0.12 : high ? 0.06 + Math.random() * 0.07 : 0.1 + Math.random() * 0.11,
        };
      }
      function spawnMote() {
        return {
          x: Math.random() * w,
          y: h * (0.15 + Math.random() * 0.75),
          r: 0.6 + Math.random() * 1.8,
          vx: (Math.random() - 0.5) * 40,
          vy: -(12 + Math.random() * 40),
          life: 0.4 + Math.random() * 1.2,
          age: 0,
          hue: 290 + Math.random() * 40,
        };
      }

      for (let i = 0; i < 18; i++) blobs.push(spawnBlob(0));
      for (let i = 0; i < 22; i++) blobs.push(spawnBlob(1));
      for (let i = 0; i < 14; i++) blobs.push(spawnBlob(2));
      for (let i = 0; i < 50; i++) motes.push(spawnMote());

      // Cheap multi-octave turbulence (no noise lib)
      function turb(x, y, t, seed) {
        return Math.sin(x * 0.004 + t * 0.55 + seed)
             + Math.sin(y * 0.005 - t * 0.4 + seed * 1.3) * 0.7
             + Math.sin((x + y) * 0.003 + t * 0.8 + seed * 0.5) * 0.5;
      }
      // Wind shear: horizontal wind strengthens with height (atmospheric profile)
      // height01 = 0 at floor, 1 at top of screen
      function windShear(height01, t) {
        const base = 28 + Math.sin(t * 0.35) * 10;       // slow shifting wind
        const shear = height01 * height01;               // quadratic shear aloft
        const gust = Math.sin(t * 1.7 + height01 * 4) * 12 * height01;
        return base * shear + gust;
      }

      let lastTs = t0;
      function frame(now) {
        if (!running) return;
        const elapsed = now - t0;
        const t = elapsed / 1000;
        // clamp dt so tab-throttling doesn't explode physics
        let dt = Math.min(0.033, Math.max(0.008, (now - lastTs) / 1000));
        lastTs = now;

        // envelope: ramp in 0.55s, hold, fade after FADE_START
        let env = 1;
        if (elapsed < 550) env = elapsed / 550;
        else if (elapsed > FADE_START) env = Math.max(0, 1 - (elapsed - FADE_START) / (DURATION - FADE_START));
        env = Math.min(1, Math.max(0, env));

        ctx.clearRect(0, 0, w, h);

        // --- Volumetric lighting (cheap, no raymarch) ---
        // Key light sits upper-center; shafts + in-scatter glow only
        const lx = w * 0.5 + Math.sin(t * 0.25) * w * 0.04;
        const ly = h * 0.18;
        // Soft god-ray cones (additive)
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 5; i++) {
          const ang = -0.55 + i * 0.28 + Math.sin(t * 0.4 + i) * 0.04;
          const len = h * (0.7 + (i % 2) * 0.12);
          const tipX = lx + Math.sin(ang) * len;
          const tipY = ly + Math.cos(ang) * len * 0.15 + len;
          const shaft = ctx.createLinearGradient(lx, ly, tipX, tipY);
          const a0 = (0.07 - i * 0.008) * env;
          shaft.addColorStop(0, `rgba(190, 120, 255, ${a0})`);
          shaft.addColorStop(0.45, `rgba(140, 60, 210, ${a0 * 0.35})`);
          shaft.addColorStop(1, "rgba(40, 0, 80, 0)");
          ctx.fillStyle = shaft;
          ctx.beginPath();
          // narrow triangle shaft
          const spread = 36 + i * 10;
          ctx.moveTo(lx, ly);
          ctx.lineTo(tipX - spread, tipY);
          ctx.lineTo(tipX + spread, tipY);
          ctx.closePath();
          ctx.fill();
        }
        // Bright core at light source
        const core = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.min(w, h) * 0.22);
        core.addColorStop(0, `rgba(230, 190, 255, ${0.2 * env})`);
        core.addColorStop(0.35, `rgba(160, 80, 220, ${0.1 * env})`);
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(lx, ly, Math.min(w, h) * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Deep purple underglow pool (floor bounce light)
        const pool = ctx.createRadialGradient(w * 0.5, h * 0.78, 0, w * 0.5, h * 0.75, Math.max(w, h) * 0.65);
        pool.addColorStop(0, `rgba(120, 30, 160, ${0.2 * env})`);
        pool.addColorStop(0.45, `rgba(60, 12, 90, ${0.1 * env})`);
        pool.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = pool;
        ctx.fillRect(0, 0, w, h);

        // Soft vignette
        const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.28, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
        vig.addColorStop(0, "rgba(0,0,0,0)");
        vig.addColorStop(1, `rgba(4, 0, 10, ${0.42 * env})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, w, h);

        // Billow particles — wind shear + buoyancy + turbulence
        for (const b of blobs) {
          const height01 = 1 - Math.max(0, Math.min(1, b.y / h));
          const shear = windShear(height01, t);
          const n = turb(b.x, b.y, t, b.seed);
          // accelerate toward shear wind (stronger aloft), add turb
          b.vx += ((shear - b.vx) * 0.55 + n * 14) * dt;
          b.vy += (n * 0.7 - 10 - height01 * 6) * dt; // buoyancy stronger high
          b.vx *= (1 - 0.45 * dt);
          b.vy *= (1 - 0.4 * dt);
          b.x += b.vx * dt * 55;
          b.y += b.vy * dt * 55;
          if (b.x < -b.r) b.x = w + b.r;
          if (b.x > w + b.r) b.x = -b.r;
          if (b.y < -b.r) b.y = h + b.r * 0.25;
          if (b.y > h + b.r) b.y = h * 0.55;

          const breath = 1 + Math.sin(t * b.breath + b.phase) * 0.12;
          const rr = b.r * breath;
          // volumetric lighting: brighten particles nearer the light shaft
          const dx = (b.x - lx) / w;
          const dy = (b.y - ly) / h;
          const distL = Math.sqrt(dx * dx + dy * dy);
          const light = Math.max(0, 1 - distL * 1.6);
          const a = b.baseA * env * (0.85 + 0.15 * Math.sin(t * 1.2 + b.phase));
          const litBoost = b.lit + light * 18;
          const satBoost = Math.min(90, b.sat + light * 12);
          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr);
          g.addColorStop(0, `hsla(${b.hue}, ${satBoost}%, ${litBoost + 14}%, ${a * (1 + light * 0.5)})`);
          g.addColorStop(0.42, `hsla(${b.hue}, ${b.sat}%, ${litBoost}%, ${a * 0.42})`);
          g.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.lit}%, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Micro mote sparks — also feel shear aloft
        ctx.globalCompositeOperation = "lighter";
        for (const m of motes) {
          m.age += dt;
          const height01 = 1 - Math.max(0, Math.min(1, m.y / h));
          const shear = windShear(height01, t);
          const n = turb(m.x, m.y, t, m.x * 0.01);
          m.vx += ((shear * 0.7 - m.vx) * 0.4 + n * 20) * dt;
          m.vy += (-22 + n * 10) * dt;
          m.x += m.vx * dt * 50;
          m.y += m.vy * dt * 50;
          if (m.age > m.life || m.y < -10) {
            m.x = Math.random() * w;
            m.y = h * (0.4 + Math.random() * 0.55);
            m.age = 0;
            m.life = 0.5 + Math.random() * 1.3;
            m.vx = (Math.random() - 0.5) * 40;
            m.vy = -(12 + Math.random() * 36);
          }
          const lifeA = 1 - m.age / m.life;
          // brighter near light
          const dx = (m.x - lx) / w;
          const dy = (m.y - ly) / h;
          const light = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.8);
          const a = lifeA * env * (0.45 + light * 0.4);
          ctx.fillStyle = `hsla(${m.hue}, 85%, ${65 + light * 20}%, ${a})`;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r * (1 + light * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";

        // Ground fog sheets (sheared horizontally)
        ctx.save();
        for (let i = 0; i < 4; i++) {
          const y = h * (0.58 + i * 0.1) + Math.sin(t * 0.7 + i) * 16;
          const a = (0.04 + i * 0.014) * env;
          const band = ctx.createLinearGradient(0, y - 36, 0, y + 48);
          band.addColorStop(0, "rgba(0,0,0,0)");
          band.addColorStop(0.4, `rgba(130, 40, 180, ${a})`);
          band.addColorStop(0.6, `rgba(80, 20, 120, ${a * 0.7})`);
          band.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = band;
          ctx.beginPath();
          ctx.moveTo(0, y);
          const shearOff = windShear(0.15 + i * 0.05, t) * 0.35;
          for (let x = 0; x <= w; x += 32) {
            const yy = y + Math.sin((x + shearOff) * 0.01 + t * 0.9 + i) * 11
                         + Math.sin(x * 0.022 + t * 1.2) * 5;
            ctx.lineTo(x, yy);
          }
          ctx.lineTo(w, y + 50);
          ctx.lineTo(0, y + 50);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        if (elapsed < DURATION) {
          raf = requestAnimationFrame(frame);
        } else {
          running = false;
          wrap.classList.remove("active");
          ctx.clearRect(0, 0, w, h);
        }
      }

      raf = requestAnimationFrame(frame);
      window.__mistCtrl = {
        stop() {
          running = false;
          cancelAnimationFrame(raf);
          wrap.classList.remove("active");
          try { ctx.clearRect(0, 0, w, h); } catch (e) {}
        }
      };
      // hard safety stop
      clearTimeout(window.__mistTimer2);
      window.__mistTimer2 = setTimeout(() => {
        if (window.__mistCtrl) window.__mistCtrl.stop();
      }, DURATION + 200);
    } catch (e) {
      console.warn("mist physics failed", e);
    }
  }

  function windowKeyFromState(s) {

    const m = (s && s.market) || {};
    if (m.kalshi_ticker) return String(m.kalshi_ticker);
    if (m.close_time) return String(m.close_time);
    return null;
  }

  function clockBucket(date = new Date()) {
    // 15-minute UTC buckets aligned to clock
    return Math.floor(date.getTime() / (15 * 60 * 1000));
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
        playMarketBell();
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
  let callSfxOn = localStorage.getItem("council_call_sfx") !== "0";
  let teamLoopsOn = localStorage.getItem("council_team_loops") !== "0";
  let lastSpokenDir = null;

  /** Speak-ish synthesized call: UP / DOWN / WAIT / SWAP */
  function playCallVoice(dir) {
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
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
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

  function playJailDoorSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const now = ctx.currentTime;
      // Metallic slam + rattle
      const o1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      o1.type = "square";
      o1.frequency.setValueAtTime(120, now);
      o1.frequency.exponentialRampToValueAtTime(55, now + 0.18);
      g1.gain.setValueAtTime(0.12, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      o1.connect(g1); g1.connect(ctx.destination);
      o1.start(now); o1.stop(now + 0.36);
      // Clank
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = "triangle";
      o2.frequency.setValueAtTime(380, now + 0.05);
      o2.frequency.exponentialRampToValueAtTime(90, now + 0.25);
      g2.gain.setValueAtTime(0.08, now + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      o2.connect(g2); g2.connect(ctx.destination);
      o2.start(now + 0.05); o2.stop(now + 0.42);
      // Short noise burst for bolt
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.1, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      noise.connect(ng); ng.connect(ctx.destination);
      noise.start(now);
    } catch (e) {}
  }


  function drawArt() {
    if (!ctx || !canvas) return;
    resizeRoundtable();
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) * (mode === "floor" ? 0.42 : 0.34);

    // Deep void forge
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, w, h);

    // Blade-forge haze: cyan core + blood edge + gold halo
    const haze = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius * 2.0);
    haze.addColorStop(0, "rgba(0, 50, 90, 0.5)");
    haze.addColorStop(0.35, "rgba(40, 10, 50, 0.22)");
    haze.addColorStop(0.7, "rgba(60, 20, 0, 0.08)");
    haze.addColorStop(1, "rgba(2, 4, 10, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);

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
            : "rgba(255, 0, 170, 0.14)";
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

    if (!state || !state.agents) {
      // still draw rain + rings while waiting
      return;
    }

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

    const ringR = radius * 0.92; // classic round-table radius
    seatList.forEach((item, i) => {
      // Top of screen = -π/2; then clockwise around the full circle
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      // Subtle hierarchy: top-3 sit a hair closer to the Chair (still one ring)
      const rk = item.rank;
      const pull = rk <= 1 ? 0.88 : rk <= 3 ? 0.92 : rk <= 7 ? 0.96 : 1.0;
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


    // Spokes into CHAIR — color-matched to each rim bot (looks only)
    const chairCore = { x: cx, y: cy };
    order.forEach((name, i) => {
      const pos = positions[name];
      if (!pos) return;
      const agent = agents.find(a => a.agent_name === name) || { direction: "WAIT", confidence: 0 };
      const conf = Number(agent.confidence) || 0;
      const sc = lawLocked() ? "rgba(255, 120, 20, 0.95)" : strongColor(agent.direction);
      // alpha scales with confidence so weak votes stay soft
      const alpha = 0.18 + Math.min(0.55, conf / 100 * 0.55);
      const pulse = 0.85 + 0.15 * Math.sin(time * 0.003 + i * 0.9);

      // soft outer glow line
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(chairCore.x, chairCore.y);
      ctx.strokeStyle = sc;
      ctx.lineWidth = 3.2 * pulse;
      ctx.globalAlpha = alpha * 0.35;
      ctx.shadowColor = sc;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // crisp core spoke
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(chairCore.x, chairCore.y);
      ctx.strokeStyle = sc;
      ctx.lineWidth = 1.4 * pulse;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // occasional energy particles riding the spoke toward CHAIR
      if (Math.random() < 0.04 + conf / 100 * 0.06) {
        spawnParticles(pos, chairCore, sc);
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

    order.forEach((name, i) => {
      const pos = positions[name];
      if (!pos) return;
      const agent = agents.find(a => a.agent_name === name) || { direction: "WAIT", confidence: 0 };
      const pulse = 1 + 0.06 * Math.sin(time * 0.0045 + i * 1.1);
      // Slightly larger seats so logos read cleanly
      const r = (agent.confidence > 55 ? 18 : 15) * pulse;
      const col = colorFor(agent.direction, agent.confidence);
      const sc = strongColor(agent.direction);

      // Outer bloom
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 14, 0, Math.PI * 2);
      ctx.fillStyle = col.replace(/[\d.]+\)$/, "0.12)");
      ctx.fill();

      // Logo + colored outline
      drawBotIcon(name, pos.x, pos.y, r, sc, agent.confidence || 0);

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

    // ===== Central Leader – CHAIR (armored portrait, eyes by direction) =====
    const leaderDir = state.decision?.direction || "WAIT";
    const leaderConf = state.decision?.confidence || 0;
    const leaderPulse = 1 + 0.04 * Math.sin(time * 0.0035);
    const lr = 72 * leaderPulse; // portrait radius — large center knight
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

    // Clip circle + draw armored portrait
    const portrait = chairPortraitFor(leaderDir);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, lr, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (portrait && portrait.complete && portrait.naturalWidth > 0) {
      // cover-fit portrait in circle (favor face/upper armor)
      const iw = portrait.naturalWidth;
      const ih = portrait.naturalHeight;
      const side = lr * 2;
      const scale = Math.max(side / iw, side / ih) * 1.15;
      const dw = iw * scale;
      const dh = ih * scale;
      // bias upward so helmet/eyes stay centered in the circle
      ctx.drawImage(portrait, cx - dw / 2, cy - dh * 0.38, dw, dh);
    } else {
      // fallback core while image loads
      ctx.fillStyle = colorFor(leaderDir, Math.max(leaderConf, 45));
      ctx.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);
    }
    ctx.restore();

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

    // Labels under portrait (don't cover the face)
    ctx.font = "700 11px Orbitron, sans-serif";
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(240, 193, 74, 0.55)";
    ctx.shadowBlur = 8;
    ctx.fillText("SATOSHI", cx, cy + lr + 16);
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

    // Scanline overlay on canvas itself (subtle)
    ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
  }

  function renderDashboard() {
    if (!state || !state.agents) {
      overlay.innerHTML = "";
      return;
    }
    const learning = state.learning || {};
    const records = learning.records || {};
    const topPairs = learning.top_pairs || [];
    const weights = state.weights || learning.weights || {};

    const pairCard = topPairs.length
      ? `<div class="agent-card pair-card">
          <div class="name">COALITIONS</div>
          <div class="title">Satoshi memory · right together</div>
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

    const agentCards = state.agents.map(a => {
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

    overlay.innerHTML = pairCard + agentCards;
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

  function updateAccuracy(acc) {
    const detailEl = document.getElementById("accuracyDetail");
    const callLogEl = document.getElementById("callLog");
    const callLogMeta = document.getElementById("callLogMeta");
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
    const verdict = (acc && acc.verdict) || "COLLECTING";

    if (accuracyPct) accuracyPct.textContent = pctText;
    if (accuracyFrac) accuracyFrac.textContent = `${correct} / ${total}`;
    if (detailEl) detailEl.textContent = `${correct}✓ · ${wrong}✗` + (pending ? ` · ${pending} open` : "");
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
        parts.push(`<div class="call-row open">
          <span class="mark pend">●</span>
          <span class="call-dir">${displayDir(r.direction) || "—"}</span>
          <span class="call-out">OPEN</span>
          <span class="call-out">${r.confidence != null ? r.confidence + "%" : ""}</span>
          <span class="call-tick">${tick}</span>
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
        parts.push(`<div class="call-row">
          <span class="mark ${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"}</span>
          <span class="call-dir">${displayDir(r.direction) || "—"}</span>
          <span class="call-out">→ ${r.outcome || "—"}</span>
          <span class="call-out">${when}</span>
          <span class="call-tick">${tick}</span>
        </div>`);
      });

      if (!parts.length) {
        callLogEl.innerHTML = `<div class="call-empty">LIFETIME LOG EMPTY<br/>UP / DOWN / 1/4 HOLD path-calls accumulate here<br/>Persists across sessions</div>`;
      } else {
        callLogEl.innerHTML = parts.join("");
      }
    }
  }

  function updateDebate() {
    if (!debateLog) return;
    const agents = (state && state.agents) || [];
    if (!agents.length) {
      debateLog.innerHTML = `<div class="debate-empty">AWAITING SEATS…</div>`;
      return;
    }

    // Newest arguments first; keep a short rolling history so it reads as debate
    const stamp = state.timestamp ? new Date(state.timestamp).toLocaleTimeString() : "";
    const lines = agents
      .filter(a => a.agent_name !== "leader")
      .map(a => {
        const who = labelOf(a);
        const dir = lawLocked() ? "LOCKED" : (a.direction || "WAIT");
        const said = (a.reasoning || "").trim() || `${dir} at ${a.confidence}%`;
        return { who, dir, conf: a.confidence, said, stamp };
      });

    // Prepend this round if content changed
    const fingerprint = lines.map(l => l.who + l.dir + l.said).join("|");
    if (!debateHistory.length || debateHistory[0]._fp !== fingerprint) {
      const batch = lines.map(l => ({ ...l, _fp: fingerprint }));
      debateHistory = batch.concat(debateHistory).slice(0, 40);
    }

    debateLog.innerHTML = debateHistory.map(e => `
      <div class="debate-entry dir-${e.dir}">
        <div class="who">${e.who}
          <span class="dir-tag" style="color:${strongColor(e.dir)}">${e.dir} ${e.conf != null ? e.conf + "%" : ""}</span>
        </div>
        <div class="said">${e.said}</div>
      </div>
    `).join("");
  }

  function resizeCandleChart() {
    if (!candleCanvas || !candleCanvas.parentElement) return;
    const parent = candleCanvas.parentElement;
    const w = Math.max(180, parent.clientWidth - 8);
    const h = Math.max(200, parent.clientHeight - (parent.querySelector(".panel-head")?.offsetHeight || 36) - 8);
    if (candleCanvas.width !== w || candleCanvas.height !== h) {
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
      const antiPairs = (state.learning && state.learning.top_anti_pairs) || [];
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

    if (!candleCtx || !candleCanvas) return;
    resizeCandleChart();
    const w = candleCanvas.width;
    const h = candleCanvas.height;
    candleCtx.clearRect(0, 0, w, h);

    // subtle panel backdrop
    candleCtx.fillStyle = "rgba(2, 6, 14, 0.35)";
    candleCtx.fillRect(0, 0, w, h);

    const market = (state && state.market) || {};
    const raw = market.candles || [];
    const livePrice = Number(market.price);
    const kalshiTarget = Number(market.kalshi_target);

    if (raw.length < 2) {
      candleCtx.fillStyle = "rgba(120,140,160,0.6)";
      candleCtx.font = "11px Orbitron, monospace";
      candleCtx.textAlign = "center";
      candleCtx.fillText("NO TAPE", w / 2, h / 2);
      return;
    }

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

  function recordSeriesFromState(s) {
    if (!s) return;
    const t = Date.now();
    const m = s.market || {};
    const price = Number(m.price);
    const target = Number(m.kalshi_target);
    let yes = m.kalshi_yes_bid;
    if (typeof yes === "string") yes = parseFloat(yes);
    // Kalshi may return 0-1 or 0-100
    if (Number.isFinite(yes)) {
      if (yes > 1.5) yes = yes / 100;
      pushSeries(series.odds, { t, up: yes * 100 });
    }
    if (Number.isFinite(price) && Number.isFinite(target)) {
      pushSeries(series.delta, { t, d: price - target });
    }
    if (m.funding != null && Number.isFinite(Number(m.funding))) {
      pushSeries(series.funding, { t, f: Number(m.funding) * 100 });
    }
    const dir = (s.decision && s.decision.direction) || "WAIT";
    const conf = (s.decision && s.decision.confidence) || 0;
    const lastTape = series.tape[series.tape.length - 1];
    if (!lastTape || lastTape.dir !== dir || lastTape.conf !== conf) {
      pushSeries(series.tape, { t, dir, conf });
    }
    const acc = s.accuracy || {};
    const pct = acc.pct != null ? Number(acc.pct) : (acc.rate != null ? Number(acc.rate) * 100 : null);
    if (pct != null && Number.isFinite(pct)) {
      pushSeries(series.accuracy, { t, pct });
    }
  }

  function fitCanvas(canvas) {
    if (!canvas || !canvas.parentElement) return null;
    const parent = canvas.parentElement;
    const head = parent.querySelector(".chart-card-head");
    const w = Math.max(120, parent.clientWidth);
    const h = Math.max(80, parent.clientHeight - (head ? head.offsetHeight : 0));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
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
    points.forEach(p => {
      const y = getY(p);
      if (Number.isFinite(y)) { min = Math.min(min, y); max = Math.max(max, y); }
    });
    if (!(max > min)) { min -= 1; max += 1; }
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

  function drawChartBtc() {
    const canvas = document.getElementById("chartBtc");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    const market = (state && state.market) || {};
    const candles = (market.candles || []).slice(-60);
    const target = Number(market.kalshi_target);
    const price = Number(market.price);
    if (candles.length < 2) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "11px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO TAPE", w / 2, h / 2);
      return;
    }
    let min = Infinity, max = -Infinity;
    candles.forEach(c => {
      min = Math.min(min, Number(c.l)); max = Math.max(max, Number(c.h));
    });
    if (Number.isFinite(target)) { min = Math.min(min, target); max = Math.max(max, target); }
    if (Number.isFinite(price)) { min = Math.min(min, price); max = Math.max(max, price); }
    const padAmt = (max - min) * 0.06 || 1;
    min -= padAmt; max += padAmt;
    const pad = { l: 6, r: 6, t: 12, b: 10 };
    const yAt = (p) => pad.t + (1 - (p - min) / (max - min)) * (h - pad.t - pad.b);
    const cw = (w - pad.l - pad.r) / candles.length;
    candles.forEach((c, i) => {
      const o = Number(c.o), cl = Number(c.c), hi = Number(c.h), lo = Number(c.l);
      const x = pad.l + i * cw + cw / 2;
      const up = cl >= o;
      const col = up ? "#39ff14" : "#ff2d55";
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(x, yAt(hi)); ctx.lineTo(x, yAt(lo)); ctx.stroke();
      ctx.globalAlpha = 0.9;
      const by = Math.min(yAt(o), yAt(cl));
      const bh = Math.max(1, Math.abs(yAt(cl) - yAt(o)));
      ctx.fillStyle = col;
      ctx.fillRect(x - Math.max(1, cw * 0.3), by, Math.max(2, cw * 0.6), bh);
    });
    ctx.globalAlpha = 1;
    if (Number.isFinite(target)) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#f0c14a";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad.l, yAt(target)); ctx.lineTo(w - pad.r, yAt(target)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f0c14a";
      ctx.font = "9px Orbitron";
      ctx.textAlign = "left";
      ctx.fillText("K TARGET", pad.l + 4, yAt(target) - 4);
    }
    if (Number.isFinite(price)) {
      const col = Number.isFinite(target) ? (price >= target ? "#39ff14" : "#ff2d55") : "#00e8ff";
      ctx.strokeStyle = col; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(pad.l, yAt(price)); ctx.lineTo(w - pad.r, yAt(price)); ctx.stroke();
    }
    const meta = document.getElementById("chartBtcMeta");
    if (meta) {
      meta.textContent = Number.isFinite(price)
        ? price.toLocaleString(undefined, { maximumFractionDigits: 1 })
        : "—";
    }
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
    // 50% guide
    drawLineSeries(ctx, series.odds, p => p.up, "#00e8ff", { zero: 50 });
    const meta = document.getElementById("chartOddsMeta");
    const last = series.odds[series.odds.length - 1];
    if (meta) meta.textContent = last ? `UP ${last.up.toFixed(1)}%` : "—";
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
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    drawLineSeries(ctx, series.funding, p => p.f, "#a855f7", { zero: 0 });
    const meta = document.getElementById("chartFundMeta");
    const last = series.funding[series.funding.length - 1];
    if (meta) meta.textContent = last ? `${last.f.toFixed(4)}%` : "—";
  }

  function drawChartTape() {
    const canvas = document.getElementById("chartTape");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    const pts = series.tape.slice(-24);
    if (!pts.length) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO SIGNALS YET", w / 2, h / 2);
      return;
    }
    const pad = { l: 8, r: 8, t: 12, b: 12 };
    const slot = (w - pad.l - pad.r) / pts.length;
    pts.forEach((p, i) => {
      const col = strongColor(p.dir);
      const x = pad.l + i * slot + slot / 2;
      const barH = Math.max(8, (p.conf / 100) * (h - pad.t - pad.b));
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x - slot * 0.3, h - pad.b - barH, slot * 0.6, barH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = "7px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText(p.dir[0], x, h - pad.b - barH - 3);
    });
    const meta = document.getElementById("chartTapeMeta");
    const last = pts[pts.length - 1];
    if (meta && last) meta.textContent = `${last.dir} ${last.conf}%`;
  }

  function drawChartAccuracy() {
    const canvas = document.getElementById("chartAccuracy");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    chartFrame(ctx, canvas.width, canvas.height);
    drawLineSeries(ctx, series.accuracy, p => p.pct, "#39ff14", { zero: 50 });
    const meta = document.getElementById("chartAccMeta");
    const last = series.accuracy[series.accuracy.length - 1];
    const acc = state && state.accuracy;
    if (meta) {
      meta.textContent = last
        ? `${last.pct.toFixed(0)}%`
        : (acc && acc.label) || "—";
    }
  }

  function drawChartWeights() {
    const canvas = document.getElementById("chartWeights");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    chartFrame(ctx, w, h);
    const weights = (state && (state.weights || (state.learning && state.learning.weights))) || {};
    const entries = AGENT_ORDER
      .filter(k => k !== "law")
      .map(k => ({ k, w: Number(weights[k]) || 0, label: AGENT_LABELS[k] || k }));
    if (!entries.some(e => e.w > 0)) {
      ctx.fillStyle = "rgba(120,140,160,0.5)";
      ctx.font = "10px Orbitron";
      ctx.textAlign = "center";
      ctx.fillText("NO WEIGHTS", w / 2, h / 2);
      return;
    }
    const maxW = Math.max(...entries.map(e => e.w), 0.01);
    const pad = { l: 48, r: 10, t: 8, b: 8 };
    const rowH = (h - pad.t - pad.b) / entries.length;
    entries.forEach((e, i) => {
      const y = pad.t + i * rowH;
      const bw = (e.w / maxW) * (w - pad.l - pad.r);
      ctx.fillStyle = "rgba(0,232,255,0.55)";
      ctx.fillRect(pad.l, y + 3, Math.max(2, bw), rowH - 6);
      ctx.fillStyle = "#c0e8ff";
      ctx.font = "8px Orbitron";
      ctx.textAlign = "right";
      ctx.fillText(e.label, pad.l - 4, y + rowH * 0.65);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(200,220,240,0.7)";
      ctx.fillText(e.w.toFixed(3), pad.l + bw + 4, y + rowH * 0.65);
    });
  }

  function drawCharts() {
    if (mode !== "charts") return;
    drawChartBtc();
    drawChartVolume();
    drawChartOdds();
    drawChartDelta();
    drawChartFunding();
    drawChartTape();
    drawChartAccuracy();
    drawChartWeights();
  }


  const BOT_GUIDE = {
    candle: { blurb: "Candle body strength, local highs/lows, short-term path. Pattern-first for 15m direction.", subs: "BODY · STRUCT · PIN · ENGULF · MARU · DOJI · STAR" },
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
    panic: { blurb: "Research edge #1: when Kalshi mid rips ≥4pts in ~30–60s, fade the panic (mean-revert). Dominated public 15m backtests.", subs: "30S · 60S · THR" },
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

  function renderRanksBoard() {
    const table = document.getElementById("ranksTable");
    const phaseEl = document.getElementById("ranksPhase");
    const notesEl = document.getElementById("learnNotes");
    if (!table) return;
    const hier = (state && state.hierarchy) || (state && state.learning && state.learning.hierarchy) || [];
    const agents = (state && state.agents) || [];
    const byName = {};
    agents.forEach(a => { byName[a.agent_name] = a; });
    const acc = (state && state.accuracy) || {};
    const n = acc.total || 0;
    const thr = state && state.decision && state.decision.threshold_used;
    const edge = state && state.decision && state.decision.edge_score;
    const phase = n < 15
      ? ("COLD START · " + n + " settled — Chair is loose so the council can learn. Threshold " + (thr != null ? Number(thr).toFixed(2) : "—") + ".")
      : ("LEARNED · " + n + " settled · hit " + (acc.accuracy_pct != null ? acc.accuracy_pct + "%" : "—") + " · edge score " + (edge != null ? edge : "—") + " · thr " + (thr != null ? Number(thr).toFixed(2) : "—") + ".");
    if (phaseEl) phaseEl.textContent = phase;
    const head = '<div class="rank-row head" role="row"><span>#</span><span>BOT</span><span>LIVE</span><span>HIT</span><span>MISS</span><span>WR%</span><span>LISTEN</span><span class="hide-sm">WT</span></div>';
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
        '<span>' + (r.correct || 0) + '</span><span>' + (r.wrong || 0) + '</span><span>' + wr + fadeNote + '</span><span>' + listen + '</span>' +
        '<span class="hide-sm">' + (r.weight != null ? Number(r.weight).toFixed(3) : "—") + '</span></div>';
    }).join("") || '<div class="rank-row">No rank data yet.</div>';
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
      if (status) status.textContent = "—";
      if (badge) badge.classList.remove("active");
      if (banner) banner.classList.remove("show");
      return;
    }
    if (badge) badge.classList.toggle("active", !!h.in_huddle);
    if (status) {
      status.textContent = h.in_huddle ? "IN SESSION" : (h.next_huddle_hint || "—").replace("Next huddle in ", "");
      if (!h.in_huddle && h.next_huddle_hint) {
        status.title = h.next_huddle_hint;
      }
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
    // Fallback: count from agents array
    let up = cc.UP, down = cc.DOWN, wait = cc.WAIT;
    if (up == null && state && state.agents) {
      up = down = wait = 0;
      state.agents.forEach(a => {
        if (a.direction === "UP") up++;
        else if (a.direction === "DOWN") down++;
        else wait++;
      });
    }
    const elU = document.getElementById("ctUp");
    const elD = document.getElementById("ctDown");
    const elW = document.getElementById("ctWait");
    const elQ = document.getElementById("ctQuorum");
    if (elU) elU.textContent = up != null ? up : "0";
    if (elD) elD.textContent = down != null ? down : "0";
    if (elW) elW.textContent = wait != null ? wait : "0";
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
    const ret = Number(document.getElementById("peReturned")?.value || 0);
    const pnl = ret - stake;
    const el = document.getElementById("pePnl");
    if (!el) return;
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
    sumEl.innerHTML =
      card("TRADES", s.trades ?? 0, (s.wins || 0) + "W / " + (s.losses || 0) + "L") +
      card("STAKED", "$" + Number(s.stake || 0).toFixed(2), "total risked") +
      card("RETURNED", "$" + Number(s.returned || 0).toFixed(2), "cashed out") +
      card("P&L", (Number(s.pnl || 0) >= 0 ? "+" : "") + "$" + Number(s.pnl || 0).toFixed(2), "net");

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
    if (ret) ret.addEventListener("input", paperPnlPreview);
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
          if (ret) ret.value = "0";
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
    mode = next;
    modeTabs.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    document.body.classList.toggle("floor-mode", mode === "floor");
    const botsView = document.getElementById("botsView");
    const ranksView = document.getElementById("ranksView");
    const paperView = document.getElementById("paperView");
    const settingsView = document.getElementById("settingsView");
    const showCharts = mode === "charts";
    const showBots = mode === "bots";
    const showRanks = mode === "ranks";
    const showPaper = mode === "paper";
    const showSettings = mode === "settings";
    const showMain = mode === "art" || mode === "dashboard" || mode === "floor";
    if (chartsView) chartsView.classList.toggle("hidden", !showCharts);
    if (botsView) botsView.classList.toggle("hidden", !showBots);
    if (ranksView) ranksView.classList.toggle("hidden", !showRanks);
    if (paperView) paperView.classList.toggle("hidden", !showPaper);
    if (settingsView) settingsView.classList.toggle("hidden", !showSettings);
    if (mainTable) mainTable.classList.toggle("hidden", !showMain);
    if (overlay) overlay.classList.toggle("hidden", mode !== "dashboard");
    if (mode === "floor") {
      try { resizeRoundtable(); drawArt(); } catch (e) {}
    }
    if (mode === "dashboard") renderDashboard();
    if (mode === "bots") renderBotsGuide();
    if (mode === "ranks") renderRanksBoard();
    if (mode === "paper") {
      fetchPaper().then(() => renderPaper());
    }
    if (mode === "settings") {
      fetchSettings().then(applySettingsSnapshot);
    }
    if (mode === "charts") {
      requestAnimationFrame(() => { drawCharts(); });
    }
  }

  function updateUI() {
    if (!state) return;
    if (state.system_settings) applySettingsSnapshot(state.system_settings);
    else if (typeof state.beast_mode === "boolean") applyBeastChrome(state.beast_mode);
    const d = state.decision || {};
    const prevDir = decisionDir.textContent;
    const rawDir = d.direction || "WAIT";
    decisionDir.textContent = lawLocked() ? "LOCKED" : (d.display_direction || displayDir(rawDir));
    decisionDir.className = "dir " + rawDir;
    decisionConf.textContent = (d.confidence != null ? d.confidence + "%" : "—");
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
    if (upEl) {
      const u = m.up_pct != null ? m.up_pct : m.yes_price != null ? m.yes_price : null;
      upEl.textContent = u != null ? (Number(u) <= 1 ? (Number(u) * 100).toFixed(1) : Number(u).toFixed(1)) + "%" : "—";
    }
    if (dnEl) {
      const dnp = m.down_pct != null ? m.down_pct : m.no_price != null ? m.no_price : null;
      dnEl.textContent = dnp != null ? (Number(dnp) <= 1 ? (Number(dnp) * 100).toFixed(1) : Number(dnp).toFixed(1)) + "%" : "—";
    }
    if (timEl) {
      let secs = m.seconds_left != null ? m.seconds_left : m.time_remaining;
      if (secs == null && m.close_time) {
        secs = Math.max(0, Math.floor((new Date(m.close_time) - Date.now()) / 1000));
      }
      if (secs != null && !isNaN(secs)) {
        const s = Math.max(0, Math.floor(Number(secs)));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        timEl.textContent = mm + ":" + ss;
      } else {
        // Fallback: seconds to next 15m UTC bucket
        const now = Date.now();
        const bucket = 15 * 60 * 1000;
        const left = bucket - (now % bucket);
        const s = Math.floor(left / 1000);
        timEl.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
      }
    }

    lastUpdateEl.textContent = state.timestamp ? new Date(state.timestamp).toLocaleTimeString() : "—";
    updateAccuracy(state.accuracy);
    updateLaw(state.law);
    updateHuddle(state.huddle);
    updateColorTally(state);
    updateDebate();
    drawCandleChart();
    renderHierarchy();
    recordSeriesFromState(state);
    if (mode === "settings") {
      const sv = document.getElementById("settingsView");
      if (sv) sv.classList.remove("hidden");
      fetchSettings().then(applySettingsSnapshot);
    }
    if (mode === "charts") drawCharts();

    const healthy = state.health?.binance || state.health?.kalshi;
    statusDot.className = "dot " + (healthy ? "live" : "warn");

    // Market-open bell when a new 15m window/contract appears
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

  function loop(ts) {
    time = ts;
    if (mode === "art" || mode === "floor") drawArt();
    if (!document.hidden) {
      
  // Learning brain export / import
  (function wireBrain() {
    const file = document.getElementById("brainFile");
    const status = document.getElementById("brainStatus");
    if (!file) return;
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (status) status.textContent = "Importing " + f.name + "…";
      try {
        const text = await f.text();
        const brain = JSON.parse(text);
        const res = await fetch("/api/brain/import", {
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
  })();

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
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") {
      // cycle Screensaver → Dashboard → Charts
      const order = ["art", "dashboard", "bots", "ranks", "paper", "charts", "settings"];
      const i = order.indexOf(mode);
      setMode(order[(i + 1) % order.length]);
    }
    if (e.key === "b" || e.key === "B") soundToggle && soundToggle.click();
    if (e.key === "Escape" && mode === "floor") setMode("art");
    if (e.key === "0") setMode("floor");
    if (e.key === "1") setMode("art");
    if (e.key === "2") setMode("dashboard");
    if (e.key === "3") setMode("bots");
    if (e.key === "4") setMode("ranks");
    if (e.key === "5") setMode("paper");
    if (e.key === "6") setMode("charts");
    if (e.key === "7") setMode("settings");
    if (e.key === "x" || e.key === "X") setBeastMode(!beastMode);
  });

  window.addEventListener("resize", () => {
    resizeRoundtable();
    if (mode === "settings") {
      const sv = document.getElementById("settingsView");
      if (sv) sv.classList.remove("hidden");
      fetchSettings().then(applySettingsSnapshot);
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
      title: "WHAT IS THIS?",
      body: "Satoshi’s Council is a team of specialist bots watching Bitcoin’s 15-minute Kalshi market.\n\nEach bot looks at one job (candles, volume, odds, panic…). Satoshi in the middle listens harder to bots that have been right, then makes one paper call: UP, DOWN, HOLD, or WAIT.\n\nThis is a training table — it does not place real orders for you.",
      tip: "Think of it like a war room, not a single magic indicator.",
      bots: null,
    },
    {
      title: "HOW A CALL WORKS",
      body: "1) Bots vote green (UP), red (DOWN), or neutral (WAIT).\n2) Ranked bots near Satoshi count more.\n3) Satoshi only goes full UP/DOWN when the top seats mostly agree.\n4) Weaker agreement can still make a smaller HOLD (scalp-sized) call.\n5) WAIT means “no clear edge — sit out.”",
      tip: "Fewer good calls beat lots of noisy ones.",
      bots: null,
    },
    {
      title: "CORE BOTS",
      body: "These seats read classic market structure — the “body” of the tape.",
      tip: "You do not need to memorize every name. Colors on the table show how they are voting live.",
      bots: "core",
    },
    {
      title: "EDGE & RESEARCH BOTS",
      body: "These seats lean on what public 15m Kalshi research has favored — panic fades, cheap odds, spot lag, and exhaustion.",
      tip: "FADE / CHEAP / VEL / EXHAUST are the “new school” seats from backtests.",
      bots: "edge",
    },
    {
      title: "RIGHT OR WRONG?",
      body: "A call is scored on Kalshi odds, not just the final BTC print.\n\n• Full call: odds need a solid move your way (path target).\n• HOLD: smaller move still counts.\n• Near 90%+: treated as locked-in.\n\nPaper money is scaled to that path move — like a scalp, not a full $1 contract fantasy.",
      tip: "Open the Paper tab anytime to see wins, losses, and tallies.",
      bots: null,
    },
    {
      title: "TABS YOU WILL USE",
      body: "• Table — living council map\n• Dashboard — seat cards\n• Bots — full guide for every specialist\n• Ranks — who Satoshi trusts most\n• Paper — your practice scorecard\n• Charts — price context\n• Settings — BEAST MODE (max speed) on/off",
      tip: "Press 1–7 to jump tabs. Press X to toggle BEAST.",
      bots: null,
    },
    {
      title: "YOU ARE READY",
      body: "When you hit Summon the Council, the fog lifts and the table comes alive.\n\nWatch colors change, Satoshi decide, and the lifetime log fill in. Start in BEAST if you want max refresh — or Standard on a lighter machine.\n\nWelcome to the table.",
      tip: "You can replay this tutorial later by clearing Skip in the browser (localStorage).",
      bots: null,
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
    const canvas = document.getElementById("fogCanvas");
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


  function dismissGate(animated) {
    const gate = document.getElementById("summonGate");
    document.body.classList.remove("gate-locked", "gate-revealing");
    localStorage.setItem("council_entered", "1");
    function after() {
      try { setMode("art"); } catch (e) {}
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
      wrap.setAttribute("aria-hidden", "true");
    }
    // exit browser fullscreen if we entered it
    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch (e) {}
    dismissGate(true);
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
      wrap.setAttribute("aria-hidden", "false");
      vid.currentTime = 0;
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

  function openTutorial() {
    ensureAudio();
    playSfxClick();
    const inner = document.getElementById("gateInner");
    const tut = document.getElementById("gateTutorial");
    if (inner) inner.classList.add("hidden");
    if (tut) tut.classList.remove("hidden");
    let step = 0;
    const total = TUTORIAL_SLIDES.length;
    const title = document.getElementById("tutTitle");
    const body = document.getElementById("tutBody");
    const botsEl = document.getElementById("tutBots");
    const stepEl = document.getElementById("tutStep");
    const totalEl = document.getElementById("tutTotal");
    const next = document.getElementById("tutNext");
    const back = document.getElementById("tutBack");
    if (totalEl) totalEl.textContent = String(total);

    // tip element (create once)
    let tipEl = document.getElementById("tutTip");
    if (!tipEl && body && body.parentNode) {
      tipEl = document.createElement("p");
      tipEl.id = "tutTip";
      tipEl.className = "tut-tip";
      body.parentNode.insertBefore(tipEl, botsEl || body.nextSibling);
    }

    function renderBots(kind) {
      if (!botsEl) return;
      if (!kind) {
        botsEl.innerHTML = "";
        botsEl.style.display = "none";
        return;
      }
      const list = kind === "core" ? TUT_BOTS_CORE : TUT_BOTS_EDGE;
      botsEl.style.display = "grid";
      botsEl.innerHTML = list.map(b =>
        '<div class="tut-bot"><div class="tut-bot-name">' + b.name +
        '</div><div class="tut-bot-role">' + b.role +
        '</div><div class="tut-bot-desc">' + b.desc + '</div></div>'
      ).join("");
    }

    function render() {
      const s = TUTORIAL_SLIDES[step];
      if (title) title.textContent = s.title;
      if (body) body.textContent = s.body;
      if (tipEl) tipEl.textContent = s.tip || "";
      renderBots(s.bots);
      if (stepEl) stepEl.textContent = String(step + 1);
      if (back) back.style.visibility = step === 0 ? "hidden" : "visible";
      if (next) next.textContent = step >= total - 1 ? "Summon the Council" : "Next";
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
    if (next) {
      next.onclick = () => {
        if (step < total - 1) {
          step += 1;
          playSfxWhoosh();
          render();
        } else {
          playSfxClick();
          if (tut) tut.classList.add("hidden");
          runSummonSequence(window.__councilFog || null);
        }
      };
    }
  }

  function initSummonGate_DISABLED_OLD(){ try{ document.getElementById('summonGate')?.remove(); document.body.classList.remove('gate-locked'); }catch(e){} return; }
  function initSummonGate() {
    const gate = document.getElementById("summonGate");
    if (!gate) return;
    // Returning visitors: short skip option still available; show gate once per session unless skip preferred
    const quiet = localStorage.getItem("council_skip_gate") === "1";
    if (quiet) {
      dismissGate(false);
      return;
    }
    const fog = initFog();
    window.__councilFog = fog;

    const btnTut = document.getElementById("btnTutorial");
    const btnSum = document.getElementById("btnSummon");
    const btnSkip = document.getElementById("btnSkipGate");
    if (btnTut) btnTut.addEventListener("click", () => { ensureAudio(); openTutorial(); });
    if (btnSum) btnSum.addEventListener("click", () => { ensureAudio(); playSfxClick(); runSummonSequence(fog); });
    if (btnSkip) {
      btnSkip.addEventListener("click", () => {
        ensureAudio();
        playSfxClick();
        localStorage.setItem("council_skip_gate", "1");
        if (fog) fog.stop();
        dismissGate(false);
      });
    }
  }

  initSummonGate();

  
  // ——— ZT celebrate cinematic (logo click + 5-win streak) ———
  let celebratePlaying = false;
  let lastCelebratedStreak = 0; // fire once per streak milestone

  function playCelebrateVideo(reason) {
    if (celebratePlaying) return;
    const wrap = document.getElementById("celebrateVideoWrap");
    const vid = document.getElementById("celebrateVideo");
    const skipBtn = document.getElementById("celebrateVideoSkip");
    if (!wrap || !vid) return;
    // Don't interrupt summon intro
    const gate = document.getElementById("summonGate");
    if (gate && document.body.classList.contains("gate-locked")) return;

    celebratePlaying = true;
    ensureAudio();
    wrap.classList.remove("hidden");
    wrap.setAttribute("aria-hidden", "false");
    vid.currentTime = 0;
    vid.muted = !!soundMuted;

    const cleanup = () => {
      celebratePlaying = false;
      try { vid.pause(); } catch (e) {}
      wrap.classList.add("hidden");
      wrap.setAttribute("aria-hidden", "true");
      try {
        if (document.fullscreenElement) document.exitFullscreen();
      } catch (e) {}
      vid.removeEventListener("ended", onEnded);
    };
    const onEnded = () => cleanup();
    vid.addEventListener("ended", onEnded);
    if (skipBtn) skipBtn.onclick = () => cleanup();

    const goFs = () => {
      const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen || wrap.msRequestFullscreen;
      if (req) {
        try { req.call(wrap); } catch (e) {}
      }
    };

    const tryPlay = () => {
      const p = vid.play();
      if (p && p.then) {
        p.then(() => {
          goFs();
          if (!soundMuted) {
            try { vid.muted = false; } catch (e) {}
          }
        }).catch(() => {
          vid.muted = true;
          vid.play().then(goFs).catch(() => cleanup());
        });
      } else {
        goFs();
      }
    };
    tryPlay();
    if (reason === "streak") {
      try { playSfxReveal(); } catch (e) {}
    }
  }

  function checkWinStreakCelebrate(acc) {
    if (!acc) return;
    const streak = Number(acc.streak) || 0;
    const ztBtn = document.getElementById("ztLogoBtn");
    if (ztBtn) {
      ztBtn.classList.toggle("streak-hot", streak >= 3);
      ztBtn.title = streak >= 5
        ? `ZT · ${streak} win streak! Click to replay cinematic`
        : `ZT cinematic · win streak ${streak}/5 for auto play`;
    }
    // Fire once when crossing 5, 10, 15... (every 5)
    if (streak >= 5 && streak % 5 === 0 && streak !== lastCelebratedStreak) {
      lastCelebratedStreak = streak;
      playCelebrateVideo("streak");
    }
    // Reset milestone tracker when streak breaks
    if (streak === 0) lastCelebratedStreak = 0;
  }

  // BEAST badge + settings toggle
  const beastBadge = document.getElementById("beastBadge");
  if (beastBadge) {
    beastBadge.addEventListener("click", () => setBeastMode(!beastMode));
  }
  const beastToggle = document.getElementById("beastToggle");
  if (beastToggle) {
    beastToggle.addEventListener("change", () => setBeastMode(beastToggle.checked));
  }
  applyBeastChrome(beastMode);
  fetchSettings().then((s) => {
    if (s) applySettingsSnapshot(s);
  });

  // Force clean Table view — hide any stacked info panels
  setMode("art");
  poll();
  pollTimer = setInterval(poll, POLL_MS);
  animId = requestAnimationFrame(loop);
})();


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
      },
    };
    const st = document.getElementById("settingsSaveStatus");
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const s = await r.json();
      applySettingsSnapshot(s);
      if (st) st.textContent = "Saved · " + new Date().toLocaleTimeString();
    } catch (e) {
      if (st) st.textContent = "Save failed: " + e;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btnSaveSettings");
    if (btn) btn.addEventListener("click", collectAndSaveSettings);
    const rst = document.getElementById("btnResetSettings");
    if (rst) rst.addEventListener("click", async () => {
      try {
        const r = await fetch("/api/settings");
        const s = await r.json();
        // re-fetch defaults by posting empty learning from defaults if present
        if (s.defaults) {
          await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              learning: s.defaults.learning,
              trading: s.defaults.trading,
              huddle: s.defaults.huddle,
              ui: s.defaults.ui,
            }),
          });
        }
        const s2 = await (await fetch("/api/settings")).json();
        applySettingsSnapshot(s2);
        const st = document.getElementById("settingsSaveStatus");
        if (st) st.textContent = "Defaults restored";
      } catch (e) {}
    });
  });




/* ===== LIVE UPDATE PATCH ===== */
(function () {
  const ACCESS_PASSWORD = "Nakamoto"; // primary access code
  const passKey = "council_auth_ok";

  function showAppAfterAuth() {
    const pg = document.getElementById("passwordGate");
    if (pg) pg.classList.add("hidden");
    // Play ZT intro video full-screen, then reveal summon gate
    playZtIntroThenSummonGate();
  }

  function playZtIntroThenSummonGate() {
    let wrap = document.getElementById("ztIntroWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "ztIntroWrap";
      wrap.className = "summon-video-wrap";
      wrap.innerHTML = `
        <video id="ztIntroVideo" playsinline webkit-playsinline>
          <source src="/zt-intro.mp4" type="video/mp4" />
        </video>
      `;
      document.body.appendChild(wrap);
    }
    wrap.classList.add("active");
    const vid = document.getElementById("ztIntroVideo");

    const finish = () => {
      wrap.classList.remove("active");
      if (vid) { try { vid.pause(); vid.currentTime = 0; } catch (e) {} }
      document.body.classList.remove("gate-locked");
      const sg = document.getElementById("summonGate");
      if (sg) {
        sg.classList.remove("hidden");
        sg.style.opacity = "0";
        sg.style.transition = "opacity 1.2s ease";
        requestAnimationFrame(() => { sg.style.opacity = "1"; });
      }
      try { initSummonGate(); } catch (e) { console.warn(e); }
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
    document.body.classList.remove("gate-locked");
    const sg = document.getElementById("summonGate");
    if (sg) sg.classList.remove("hidden");
    try { initSummonGate(); } catch (e) { console.warn(e); }
  }

  function initPasswordGate() {
    // Returning visitors: skip password + intro video, go to summon gate
    if (localStorage.getItem(passKey) === "1") {
      revealSummonGateOnly();
      return;
    }
    const pg = document.getElementById("passwordGate");
    const input = document.getElementById("passwordInput");
    const btn = document.getElementById("passwordSubmit");
    const err = document.getElementById("passwordError");
    if (!pg) return;
    pg.classList.remove("hidden");
    document.body.classList.add("gate-locked");
    const tryUnlock = () => {
      const v = (input && input.value) || "";
      if (v === ACCESS_PASSWORD || v === "Nakamoto" || v.toLowerCase() === "nakamoto") {
        localStorage.setItem(passKey, "1");
        if (err) err.classList.add("hidden");
        // Fresh password entry → ZT intro video → summon gate
        showAppAfterAuth();
      } else {
        if (err) err.classList.remove("hidden");
      }
    };
    if (btn) btn.addEventListener("click", tryUnlock);
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  }

  function initLogoCredit() {
    const btn = document.getElementById("ztHeaderLogo") || document.getElementById("ztLogoBtn");
    const pop = document.getElementById("creditPopup");
    if (!btn || !pop) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
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
      stars = Array.from({ length: 160 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 2 + 0.2,
        s: Math.random() * 1.8 + 0.3,
      }));
    }
    resize();
    window.addEventListener("resize", resize);
    function tick() {
      if (!document.body.classList.contains("mode-floor")) {
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
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        if (kind === "win") {
          o.frequency.value = 880; g.gain.value = 0.08;
          o.start(); o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          o.stop(ctx.currentTime + 0.26);
        } else {
          o.type = "square"; o.frequency.value = 180; g.gain.value = 0.06;
          o.start(); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
          o.stop(ctx.currentTime + 0.36);
        }
      }
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
  (function initHive-egg() {
    function wire() {
      const btn = document.getElementById("hive-egg");
      const egg = document.getElementById("hiveegg");
      const close = document.getElementById("hiveeggClose");
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


