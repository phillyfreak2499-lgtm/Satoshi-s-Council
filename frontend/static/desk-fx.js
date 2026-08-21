/* Desk extras that used to live under roundtable.js.
   Settings save fallback, hive egg, floor music, money rain.
   Loaded after roundtable.js. Keep this file boring and parse-checked. */
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
  const passKey = "council_auth_ok";

  const DESK_INTRO_KEY = "council_desk_intro_played";

  function prefetchDeskIntroVideo() {
    // Parked. Zach is remaking the clips. Do not warm or play.
  }

  function playDeskUnlockIntro() {
    if (document.body && document.body.classList.contains("reduce-motion")) return;
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
    try { markOnboarded(); } catch (e) {}
    try { if (window.CouncilSeat) CouncilSeat.lockSeat(); } catch (e) {}
    window.__deskUnlockedThisPage = true;
    try { sessionStorage.setItem(DESK_KEY, "1"); } catch (e) {}
    if (typeof window.revealAppAfterDeskUnlock === "function") {
      window.revealAppAfterDeskUnlock();
    }
    document.body.classList.remove("admin-unlocked");
    const sg = document.getElementById("summonGate");
    if (sg) sg.classList.add("hidden");
    try {
      const dest = defaultLandMode() || "stream";
      if (typeof window.setMode === "function") window.setMode(dest);
      else if (typeof setMode === "function") setMode(dest);
    } catch (e) {}
    try { if (typeof window.hydrateLiveHour === "function") window.hydrateLiveHour(); } catch (e) {}
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

    if (!vid || (document.body && document.body.classList.contains("reduce-motion"))) { finish(); return; }
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
    try { localStorage.removeItem("council_admin_unlocked"); } catch (e) {}
    try { sessionStorage.removeItem("council_admin_unlocked"); } catch (e) {}
    window.__adminUnlockedThisPage = false;
    document.body.classList.remove("admin-unlocked");
    if (window.CouncilSeat && CouncilSeat.isLocked()) {
      window.__deskUnlockedThisPage = true;
      try { sessionStorage.setItem(passKey, "1"); } catch (e) {}
      const pg0 = document.getElementById("passwordGate");
      if (pg0) pg0.classList.add("hidden");
      showAppAfterAuth();
      return;
    }
    const pg = document.getElementById("passwordGate");
    const btn = document.getElementById("passwordSubmit");
    const err = document.getElementById("passwordError");
    const agree = document.getElementById("gateAgree");
    if (!pg) return;
    pg.classList.remove("hidden");
    document.documentElement.classList.add("gate-locked");
    document.body.classList.add("gate-locked");
    document.body.classList.remove("admin-unlocked");
    document.body.setAttribute("data-password-protected", "true");
    if (agree) agree.checked = false;
    const syncDeskGateSummon = () => {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("disabled");
        btn.textContent = "SUMMON THE COUNCIL";
        btn.setAttribute("aria-disabled", "false");
      }
      if (err) err.classList.add("hidden");
      return true;
    };
    const tryUnlock = () => {
      if (agree && !agree.checked) {
        if (err) { err.textContent = "Check the oath first."; err.classList.remove("hidden"); }
        return;
      }
      if (tryUnlock.__busy) return;
      tryUnlock.__busy = true;
      fetch("/api/desk/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oath: true }),
      }).then((r) => r.json().catch(function () { return {}; })).then(function (d) {
        if (!d || !d.ok) {
          if (err) { err.textContent = "Oath failed. Try again."; err.classList.remove("hidden"); }
          return;
        }
        try { sessionStorage.setItem(passKey, "1"); } catch (e) {}
        try { localStorage.setItem("council_onboarded", "1"); } catch (e) {}
        window.__deskUnlockedThisPage = true;
        showAppAfterAuth();
      }).catch(function () {
        if (err) { err.textContent = "Oath failed. Try again."; err.classList.remove("hidden"); }
      }).finally(function () {
        tryUnlock.__busy = false;
      });
    };
    if (agree) agree.addEventListener("change", syncDeskGateSummon);
    syncDeskGateSummon();
    if (btn) {
      btn.addEventListener("click", function (e) { e.preventDefault(); tryUnlock(); });
      btn.addEventListener("pointerup", function (e) { e.preventDefault(); tryUnlock(); }, { passive: false });
    }
    const summonHit = document.getElementById("gateSummonHit");
    if (summonHit) {
      // Always unlock from the hit pad. Samsung ignores clicks on disabled
      // buttons; the pad used to no-op when the button was already live.
      summonHit.addEventListener("click", function (e) {
        e.preventDefault();
        tryUnlock();
      });
      summonHit.addEventListener("pointerup", function (e) {
        e.preventDefault();
        tryUnlock();
      }, { passive: false });
    }
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
      const still = document.body.classList.contains("reduce-motion");
      if (!document.body.classList.contains("mode-floor") && !document.body.classList.contains("floor-mode")) {
        if (still) setTimeout(tick, 800);
        else requestAnimationFrame(tick);
        return;
      }
      ctx.fillStyle = "rgba(2,4,10,0.35)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        if (!still) {
          st.y += st.z * 0.72;
          if (st.y > canvas.height) {
            st.y = 0;
            st.x = Math.random() * canvas.width;
          }
        }
        ctx.beginPath();
        ctx.fillStyle = `hsla(${200 + st.z * 40}, 90%, ${60 + st.z * 15}%, ${0.5 + st.z * 0.25})`;
        ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
        ctx.fill();
      }
      if (still) setTimeout(tick, 800);
      else requestAnimationFrame(tick);
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
      src.src = "/static/video/money-closeup.mp4";
      src.type = "video/mp4";
      vid.appendChild(src);
      wrap.appendChild(vid);
      document.body.appendChild(wrap);
    }
    return { wrap, vid: vid || document.getElementById("floorMoneyRainVideo") };
  }

  function motionStill() {
    return !!(document.body && document.body.classList.contains("reduce-motion"));
  }

  function startRain() {
    if (motionStill()) return;
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
    if (on && !motionStill()) startRain();
    else stopRain();
  };

  // Re-evaluate when entering/leaving floor mode
  const prev = window.__floorMusicOnMode;
  window.__floorMusicOnMode = function (isFloor) {
    if (typeof prev === "function") {
      try { prev(isFloor); } catch (e) {}
    }
    if (isFloor && active && !motionStill()) {
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
