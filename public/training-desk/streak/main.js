const CASES = [
  {
    id: "A",
    title: "Young run",
    chips: ["UP", "UP", "DOWN", "UP", "UP", "UP"],
    book: "YES mid 62¢ · book UP",
    setup: "continue_young",
    answer: "UP",
    obs: "Three official UPs in a row. The live YES book is still on that side.",
    why: "Ride the young official streak only while the book still pays that side. Lean UP. Do not book a fill from this screen.",
    notes: [
      "Official streak: 3 UP. That is young — not extended.",
      "YES book agrees with the streak side.",
      "Setup name: continue_young.",
      "Printed lean can be UP. That is still not a fill.",
      "Invalidate if the YES book breaks to the NO side.",
    ],
    tape: "STREAK does not read Bitcoin versus the strike. It reads official chips, then asks whether the YES book has already quit the run.",
  },
  {
    id: "B",
    title: "Extended fade",
    chips: ["DOWN", "DOWN", "DOWN", "DOWN", "DOWN", "DOWN"],
    book: "YES mid 28¢ · book DOWN",
    setup: "fade_extended",
    answer: "UP",
    obs: "Six official DOWNs. The book is still paying the same side. STREAK looks for the run that has gone too far.",
    why: "Six chips is extended. Fade the tired side. Lean UP. The chair still has to clear ask, fee, and time.",
    notes: [
      "Official streak: 6 DOWN. Threshold for extended is ≥5.",
      "YES book has not broken. The run is still being paid.",
      "Setup name: fade_extended.",
      "Printed lean can be UP — against the streak, not with it.",
      "Invalidate if a new official chip ends the streak.",
    ],
    tape: "An extended official streak is not proof the next window continues. STREAK’s fade is a lean against the tired side.",
  },
  {
    id: "C",
    title: "Book already broke it",
    chips: ["UP", "UP", "UP"],
    book: "YES mid 31¢ · book DOWN",
    setup: "live_break",
    answer: "WAIT",
    obs: "The official chips are still a young UP streak. The live YES book has already flipped against them.",
    why: "Young streak, but the book already quit. STREAK sits. WAIT is the call.",
    notes: [
      "Official streak: 3 UP.",
      "YES book does not agree. That is a live break.",
      "Setup name: live_break.",
      "Printed seat decision: WAIT.",
    ],
    tape: "History is not live agreement. If the YES book has already left a young streak, STREAK does not ride a corpse.",
  },
  {
    id: "D",
    title: "Alternating chop",
    chips: ["UP", "DOWN", "UP", "DOWN", "UP", "DOWN"],
    book: "YES mid 49¢ · no side",
    setup: "alt_chop",
    answer: "WAIT",
    obs: "The last six official chips alternate. There is no streak to ride and nothing clean to fade.",
    why: "No streak. No fade. No book agreement. If you cannot name the setup, the read is WAIT.",
    notes: [
      "Last chips alternate. No streak length worth naming.",
      "YES book is mid. It is not confirming a side.",
      "Setup name: alt_chop.",
      "Printed seat decision: WAIT.",
    ],
    tape: "Alternating official results are not a pattern you trade. STREAK needs a named setup. This tape does not have one.",
  },
];

const ASK = {
  "What is a chip?":
    "One official Kalshi settlement for a closed 15-minute window. STREAK reads chips, not candles.",
  "Why does the YES book matter?":
    "The YES book is whether the settled streak is still being paid. If it has flipped against a young run, the streak is broken.",
  "When do you ride?":
    "Young official streak — about 2 to 4 — and the YES mid still on that side. Continue is a lean, not a fill.",
  "When do you fade?":
    "Official streak of 5 or more, book still on that side. Fade the tired run. Still a lean.",
  "What would change your mind?":
    "No named setup, alternating chips, or a book that already broke the streak. WAIT is the honest print.",
};

let current = 0;
let voiceOn = false;
const $ = (id) => document.getElementById(id);
function chipsHtml(chips) {
  return chips.map((c) => `<span class="chip ${c}">${c === "UP" ? "UP" : "DN"}</span>`).join("");
}
function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}
function paint(i) {
  current = i;
  const c = CASES[i];
  $("obs-chips").innerHTML = chipsHtml(c.chips);
  $("challenge-chips").innerHTML = chipsHtml(c.chips);
  $("tape-chips").innerHTML = chipsHtml(c.chips);
  $("practice-chips").innerHTML = chipsHtml(c.chips);
  $("read-copy").textContent = c.obs;
  $("read-preview").textContent = `${c.title} · ${c.setup}`;
  $("challenge-stamp").textContent = `Tape ${c.id} · ${c.title} · ${c.book}`;
  $("tape-copy").textContent = c.tape;
  $("tape-preview").textContent = `${c.book} · ${c.setup}`;
  $("note-decision").textContent = c.setup;
  $("note-location").textContent = c.book;
  $("note-excerpt").textContent = c.obs;
  $("notes-content").innerHTML = `<ul>${c.notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
  $("practice-meta").textContent = `${c.title} · ${c.book} · setup ${c.setup}`;
  $("challenge-result").textContent = "";
  $("practice-result").textContent = "";
  $("coach-line").textContent = c.obs;
}
function grade(targetId, pick) {
  const c = CASES[current];
  const note = pick === c.answer ? `STREAK agrees: ${c.answer}. ${c.why}` : `STREAK’s print is ${c.answer}. ${c.why}`;
  $(targetId).textContent = note;
  $("coach-line").textContent = note;
  speak(note);
}
function openDialog(id) {
  $(id)?.showModal();
}
document.querySelectorAll("dialog .close").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest("dialog")?.close());
});
$("why").addEventListener("click", () => openDialog("read-dialog"));
$("challenge").addEventListener("click", () => openDialog("challenge-dialog"));
$("open-chat").addEventListener("click", () => openDialog("chat-dialog"));
$("focus").addEventListener("click", () => openDialog("tape-dialog"));
$("notes").addEventListener("click", () => openDialog("notes-dialog"));
$("practice").addEventListener("click", () => openDialog("practice-dialog"));
document.querySelectorAll("#challenge-dialog [data-call]").forEach((btn) => {
  btn.addEventListener("click", () => grade("challenge-result", btn.dataset.call));
});
document.querySelectorAll("#practice-dialog [data-call]").forEach((btn) => {
  btn.addEventListener("click", () => grade("practice-result", btn.dataset.call));
});
const caseBox = $("case-buttons");
CASES.forEach((c, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = `${c.id} · ${c.title}`;
  b.addEventListener("click", () => paint(i));
  caseBox.appendChild(b);
});
document.querySelectorAll("#chat-dialog [data-question]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const q = btn.dataset.question;
    const a = ASK[q] || "If you cannot name the setup, the read is WAIT.";
    const log = $("chat-history");
    log.insertAdjacentHTML("beforeend", `<p><strong>You</strong> ${q}</p><p><strong>STREAK</strong> ${a}</p>`);
    $("chat-preview").textContent = a;
    $("coach-line").textContent = a;
    speak(a);
  });
});
$("sound").addEventListener("click", () => {
  voiceOn = !voiceOn;
  $("sound").textContent = voiceOn ? "VOICE ON" : "VOICE OFF";
  $("sound").setAttribute("aria-pressed", String(voiceOn));
  if (!voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
});
const keys = $("keyboard-keys");
if (keys) {
  for (let i = 0; i < 28; i += 1) {
    keys.appendChild(document.createElement("i"));
  }
}
paint(0);
