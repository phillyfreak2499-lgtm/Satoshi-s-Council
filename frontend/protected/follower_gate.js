/* Admin-gated three-lock form. Not shipped in the public document. */
(function () {
  if (window.__fgBooted) return;
  window.__fgBooted = true;

  function $(id) { return document.getElementById(id); }

  function showErr() {
    const err = $("fgError");
    if (!err) return;
    err.textContent = "Wrong password";
    err.classList.remove("hidden");
  }

  function clearFields() {
    const a = $("fgPw1");
    const b = $("fgPw2");
    const c = $("fgPw3");
    if (a) { a.value = ""; a.disabled = false; }
    if (b) { b.value = ""; b.disabled = true; }
    if (c) { c.value = ""; c.disabled = true; }
  }

  function syncSeq() {
    const a = $("fgPw1");
    const b = $("fgPw2");
    const c = $("fgPw3");
    const has1 = !!(a && String(a.value || "").length);
    const has2 = !!(b && String(b.value || "").length);
    if (b) b.disabled = !has1;
    if (c) c.disabled = !(has1 && has2);
  }

  function hideGate() {
    const gate = $("fgGate");
    if (gate) gate.classList.add("hidden");
    clearFields();
  }

  function showGate() {
    const gate = $("fgGate");
    const err = $("fgError");
    if (err) { err.classList.add("hidden"); err.textContent = "Wrong password"; }
    clearFields();
    if (gate) gate.classList.remove("hidden");
    setTimeout(function () {
      try { $("fgPw1") && $("fgPw1").focus(); } catch (e) {}
    }, 40);
  }

  async function loadBundle() {
    if (document.getElementById("followerBundleScript")) return;
    try {
      const r = await fetch("/api/follower/bundle", { credentials: "same-origin" });
      if (!r.ok) return;
      const html = await r.text();
      let host = document.getElementById("followerBundleHost");
      if (!host) {
        host = document.createElement("div");
        host.id = "followerBundleHost";
        document.body.appendChild(host);
      }
      host.innerHTML = html;
    } catch (e) {
      return;
    }
    const s = document.createElement("script");
    s.id = "followerBundleScript";
    s.src = "/api/follower/bundle.js";
    document.body.appendChild(s);
    const btn = $("deskExtBtn");
    if (btn) btn.classList.add("hidden");
  }

  async function alreadyOpen() {
    try {
      const r = await fetch("/api/follower/status", { credentials: "same-origin" });
      if (!r.ok) return false;
      const d = await r.json();
      return !!(d && d.ok);
    } catch (e) {
      return false;
    }
  }

  async function tryUnlock() {
    const a = $("fgPw1");
    const b = $("fgPw2");
    const c = $("fgPw3");
    const submit = $("fgSubmit");
    const err = $("fgError");
    if (err) err.classList.add("hidden");
    if (submit) submit.disabled = true;
    try {
      const r = await fetch("/api/follower/unlock", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p1: (a && a.value) || "",
          p2: (b && b.value) || "",
          p3: (c && c.value) || "",
        }),
      });
      let data = {};
      try { data = await r.json(); } catch (e) { data = {}; }
      clearFields();
      if (data && data.ok) {
        hideGate();
        loadBundle();
      } else {
        showErr();
        setTimeout(function () { try { a && a.focus(); } catch (e) {} }, 20);
      }
    } catch (e) {
      clearFields();
      showErr();
    }
    if (submit) submit.disabled = false;
  }

  function placeOpener() {
    const btn = $("deskExtBtn");
    const tabs = document.querySelector(".mode-tabs");
    if (!btn || !tabs || btn.__placed) return;
    btn.__placed = true;
    const settings = $("tabSettings");
    if (settings && settings.parentNode === tabs) {
      tabs.insertBefore(btn, settings);
    } else {
      tabs.appendChild(btn);
    }
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      alreadyOpen().then(function (ok) {
        if (ok) loadBundle();
        else showGate();
      });
    });
  }

  function wireGate() {
    const submit = $("fgSubmit");
    const cancel = $("fgCancel");
    const a = $("fgPw1");
    const b = $("fgPw2");
    const c = $("fgPw3");
    if (!submit || submit.__wired) return;
    submit.__wired = true;
    submit.addEventListener("click", tryUnlock);
    [a, b, c].forEach(function (el, idx) {
      if (!el) return;
      el.addEventListener("input", syncSeq);
      el.addEventListener("keydown", function (e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (idx === 0 && b) { syncSeq(); if (!b.disabled) b.focus(); return; }
        if (idx === 1 && c) { syncSeq(); if (!c.disabled) c.focus(); return; }
        tryUnlock();
      }, true);
    });
    if (cancel) cancel.addEventListener("click", hideGate);
  }

  placeOpener();
  wireGate();
  alreadyOpen().then(function (ok) {
    if (ok) loadBundle();
  });
})();
