(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { workspace: null };
  const clean = (value, fallback = "—") => value == null || value === "" ? fallback : String(value);
  const dateText = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? "time unavailable" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
  const showNotice = (text, kind = "") => { const notice = $("#notice"); notice.className = `notice ${kind}`; notice.textContent = text; };
  async function request(url, options) { const response = await fetch(url, { credentials: "same-origin", ...options }); let data = {}; try { data = await response.json(); } catch (_) {} if (!response.ok || data.ok === false) throw new Error(data.error || "The workspace could not complete that request."); return data; }
  async function ensure(displayName) { return request("/api/public/workspace/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: displayName || undefined }) }); }
  function textElement(tag, text, className) { const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node; }
  function addDetail(card, label, value) { const line = document.createElement("p"); line.className = "entry-detail"; const strong = document.createElement("strong"); strong.textContent = `${label}: `; line.append(strong, document.createTextNode(clean(value))); card.append(line); }
  function renderEntries(entries) {
    const host = $("#entryList"); host.replaceChildren();
    if (!entries.length) { host.append(textElement("div", "Your first clean WAIT, thesis, or review belongs here. Start small and make it specific.", "entry-empty")); return; }
    entries.forEach((entry) => {
      const card = document.createElement("article"); card.className = `entry-card ${entry.status === "reviewed" ? "is-reviewed" : ""}`;
      const top = document.createElement("div"); top.className = "entry-card-top";
      top.append(textElement("span", clean(entry.asset).toUpperCase(), "entry-asset"), textElement("span", entry.status === "reviewed" ? "REFLECTED" : "OPEN", "entry-status")); card.append(top);
      card.append(textElement("p", `${clean(entry.stance).replaceAll("_", " ")} · ${clean(entry.horizon)} · ${clean(entry.confluence_score, 0)} / 4 confluence`, "entry-meta"));
      card.append(textElement("h3", clean(entry.thesis)));
      addDetail(card, "Invalidation", entry.invalidation); if (entry.evidence) addDetail(card, "Evidence", entry.evidence); if (entry.next_review_at) addDetail(card, "Next review", dateText(entry.next_review_at));
      if (entry.reflection) addDetail(card, "Reflection", entry.reflection);
      if (entry.status !== "reviewed") {
        const details = document.createElement("details"); details.className = "reflection-box"; const summary = document.createElement("summary"); summary.textContent = "Add a process reflection";
        const textarea = document.createElement("textarea"); textarea.maxLength = 1200; textarea.placeholder = "What did you learn? Did you follow the review plan?";
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Save reflection";
        button.addEventListener("click", async () => { try { const reflection = textarea.value.trim(); if (!reflection) throw new Error("Write a short reflection before closing the record."); await request(`/api/public/workspace/journal/${encodeURIComponent(entry.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reflection }) }); showNotice("Reflection saved. Closing the loop is a process win.", "success"); await refresh(); } catch (error) { showNotice(error.message, "error"); } });
        details.append(summary, textarea, button); card.append(details);
      } host.append(card);
    });
  }
  function renderReviews(reviews) { const host = $("#reviewList"); host.replaceChildren(); if (!reviews.length) { host.append(textElement("div", "No weekly review yet. Four honest checks are more useful than a score you cannot explain.", "entry-empty")); return; } reviews.forEach((review) => { const card = document.createElement("article"); card.className = "review-history"; card.append(textElement("span", clean(review.week_key)), textElement("strong", `${clean(review.score, 0)}% process score`)); const completed = [review.horizon_named && "horizon", review.invalidation_named && "invalidation", review.review_honored && "review", review.wait_respected && "wait"].filter(Boolean); card.append(textElement("p", completed.length ? `Checked: ${completed.join(", ")}.` : "No checks marked yet.")); if (review.note) card.append(textElement("p", review.note)); host.append(card); }); }
  function render(workspace) { state.workspace = workspace; const account = workspace.account || {}; const process = workspace.process || {}; $("#accountName").textContent = account.display_name || "This browser's workspace"; $("#displayName").value = account.display_name || ""; $("#tierLabel").textContent = `${clean(account.tier, "free").toUpperCase()} tier`;
    $("#reviewScore").textContent = process.latest_weekly_score == null ? "—" : `${process.latest_weekly_score}%`; $("#entryCount").textContent = clean(process.entries, 0); $("#journalLimit").textContent = `${clean(workspace.journal_limit, 10)} records on this tier`; $("#completionRate").textContent = process.review_completion_pct == null ? "—" : `${process.review_completion_pct}%`; $("#entryHeading").textContent = `${clean(process.entries, 0)} / ${clean(workspace.journal_limit, 10)} records`;
    renderEntries(workspace.entries || []); renderReviews(workspace.reviews || []);
  }
  async function refresh() { const data = await request("/api/public/workspace"); render(data); }
  $("#nameForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const response = await ensure($("#displayName").value.trim()); $("#accountName").textContent = response.account.display_name || "This browser's workspace"; showNotice("Workspace name saved in this browser.", "success"); await refresh(); } catch (error) { showNotice(error.message, "error"); } });
  $("#confluence").addEventListener("input", (event) => { $("#confluenceText").textContent = `${event.target.value} of 4`; });
  $("#journalForm").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const body = Object.fromEntries(form.entries()); body.confluence_score = Number(body.confluence_score || 0); try { await request("/api/public/workspace/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); event.currentTarget.reset(); $("#confluenceText").textContent = "0 of 4"; showNotice("Paper record saved. The next win is keeping the review appointment.", "success"); await refresh(); } catch (error) { showNotice(error.message, "error"); } });
  $("#reviewForm").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const body = Object.fromEntries(form.entries()); ["horizon_named", "invalidation_named", "review_honored", "wait_respected"].forEach((key) => { body[key] = form.get(key) === "on"; }); try { await request("/api/public/workspace/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); showNotice("Weekly review saved. Honest process feedback compounds.", "success"); await refresh(); } catch (error) { showNotice(error.message, "error"); } });
  (async () => { try { const result = await ensure(); showNotice(result.notice || "Free workspace ready."); await refresh(); } catch (error) { showNotice(error.message, "error"); } })();
})();
