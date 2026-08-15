/* HELP tab — desk tickets to Zach. Not a spreadsheet. No accounts. */
(function () {
  let picked = "";

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, ok) {
    const el = $("helpStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("help-ok", !!ok);
    el.classList.toggle("help-err", !!msg && !ok);
  }

  function syncKindButtons() {
    document.querySelectorAll(".help-kind").forEach(function (btn) {
      const on = btn.getAttribute("data-kind") === picked;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function wireForm() {
    const form = $("helpForm");
    if (!form || form.dataset.wired === "1") return;
    form.dataset.wired = "1";
    document.querySelectorAll(".help-kind").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        const k = (btn.getAttribute("data-kind") || "").toUpperCase();
        picked = picked === k ? "" : k;
        syncKindButtons();
      });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      sendTicket();
    });
    const send = $("helpSend");
    if (send) {
      send.addEventListener("click", function (e) {
        e.preventDefault();
        sendTicket();
      });
    }
  }

  async function sendTicket() {
    const input = $("helpText");
    const text = input ? String(input.value || "").trim() : "";
    setStatus("");
    const send = $("helpSend");
    if (send) send.disabled = true;
    try {
      const r = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kind: picked, text: text }),
      });
      let data = {};
      try { data = await r.json(); } catch (e) { data = {}; }
      if (data && data.ok) {
        if (input) input.value = "";
        picked = "";
        syncKindButtons();
        setStatus("Filed. Zach has it.", true);
      } else {
        setStatus("Could not send.", false);
      }
    } catch (e) {
      setStatus("Could not send.", false);
    }
    if (send) send.disabled = false;
  }

  function loadHelpDesk() {
    wireForm();
    setStatus("");
    try {
      const input = $("helpText");
      if (input) input.focus();
    } catch (e) {}
  }

  function helpEsc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function paintAdminList(tickets) {
    const list = $("helpAdminList");
    if (!list) return;
    const rows = Array.isArray(tickets) ? tickets : [];
    if (!rows.length) {
      list.innerHTML = '<li class="help-admin-empty">No tickets yet.</li>';
      return;
    }
    list.innerHTML = rows.map(function (t) {
      const kind = helpEsc(t.kind || "—");
      const when = helpEsc(t.time || t.at || "");
      const text = helpEsc(t.text || "");
      return '<li class="help-admin-item">'
        + '<span class="help-admin-kind">' + kind + "</span>"
        + '<p class="help-admin-text">' + text + "</p>"
        + '<time class="help-admin-time">' + when + "</time>"
        + "</li>";
    }).join("");
  }

  async function fetchAdminTickets() {
    const list = $("helpAdminList");
    if (!list) return;
    const fetcher = (typeof window.adminFetch === "function")
      ? window.adminFetch
      : function (url) { return fetch(url, { credentials: "same-origin" }); };
    try {
      const r = await fetcher("/api/admin/help");
      if (!r || !r.ok) {
        list.innerHTML = '<li class="help-admin-empty">Could not load.</li>';
        return;
      }
      const data = await r.json();
      paintAdminList(data && data.tickets);
    } catch (e) {
      list.innerHTML = '<li class="help-admin-empty">Could not load.</li>';
    }
  }

  function wireHelpAdmin() {
    const list = $("helpAdminList");
    if (!list) return;
    if (list.dataset.wired === "1") {
      fetchAdminTickets();
      return;
    }
    list.dataset.wired = "1";
    const refresh = $("helpAdminRefresh");
    if (refresh && !refresh.__wired) {
      refresh.__wired = true;
      refresh.addEventListener("click", function (e) {
        e.preventDefault();
        fetchAdminTickets();
      });
    }
    fetchAdminTickets();
  }

  window.loadHelpDesk = loadHelpDesk;
  window.wireHelpAdmin = wireHelpAdmin;

  function boot() {
    wireForm();
    const host = $("adminDeskHost");
    if (host && !host.__helpWatch) {
      host.__helpWatch = true;
      try {
        new MutationObserver(function () { wireHelpAdmin(); }).observe(host, { childList: true, subtree: true });
      } catch (e) {}
    }
    wireHelpAdmin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
