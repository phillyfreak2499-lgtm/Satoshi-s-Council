import { DERIVS_FAMILY, KALSHI_SEQ_SEATS, SEAT_BY_ID, SEATS } from "./seats";
import { detectQuiet, evidenceOf, isWeekend, readWarden } from "./context";
import { recencyRate } from "./skills";
import { knnRead, walkForward } from "./memory";
import { readScalp, scalpAvg } from "./scalp";
import { binKey, calibNOf, clamp, listenCalib, mean, round, seatCalib, WARM_N, wilsonLower } from "./math";
import { holdScore } from "./stick";
import type {
  ChairResult,
  FeedHealth,
  Gate,
  Lean,
  Learner,
  SeatId,
  SeatRow,
  SeatStatus,
  Settings,
  Snapshot,
  Vote,
} from "./types";

function listenOf(rank: number): number {
  return Math.max(0.12, 0.82 ** (rank - 1));
}

function seatWilson(learner: Learner, seat: SeatId): { n: number; w: number } {
  const n = learner.seat_n[seat] ?? 0;
  const h = learner.seat_hits[seat] ?? 0;
  return { n, w: n > 0 ? wilsonLower(h, n) : 0 };
}

function healthFactor(vote: Vote): number {
  if (vote.health === "DOWN") return 0;
  if (vote.health === "STALE") return 0.6;
  if (vote.seat === "WARDEN") return 0;
  return 1;
}

function licensed(learner: Learner, vote: Vote, snap: Snapshot): number {
  if (vote.skill_used === "SIT" || vote.skill_status === "SIT") return 1;
  const card = learner.skills[vote.skill_used];
  if (!card) return 1;
  const pocket = card.pocket[snap.regime_key];
  if (!pocket || pocket.n < 8) return 1;
  const w = wilsonLower(pocket.hits, pocket.n);
  return clamp(w / 0.5, 0.22, 1.05);
}

function priorOf(seat: SeatId): number {
  return SEAT_BY_ID[seat]?.base ?? 0.06;
}

function learnedBase(learner: Learner, seat: SeatId): number {
  return learner.seat_w?.[seat] ?? priorOf(seat);
}

function last8Rate(learner: Learner, seat: SeatId): { n: number; rate: number } {
  const rec = learner.seat_recent[seat] ?? [];
  const slice = rec.slice(-8);
  return { n: slice.length, rate: slice.length ? mean(slice) : 1 };
}

export function runChair(
  votes: Vote[],
  snap: Snapshot,
  learner: Learner,
  settings: Settings,
  lastLean: Lean = "WAIT",
): ChairResult {
  const muted = new Set(settings.mutes);
  const now = snap.as_of;
  const lockdown =
    learner.lockdown ||
    now < learner.lockdown_until ||
    (learner.lockdown_windows_left ?? 0) > 0;
  const quiet = detectQuiet(snap);
  const weekend = isWeekend(snap.as_of);
  const warden = readWarden(snap);
  const bothDown = warden.bothDown;
  const oneDown = warden.oneDown;
  const seqLost = warden.seqLost;
  const derivsDown = warden.derivsDown;
  const silent = new Set(warden.silent);

  const rankedSeats = SEATS.filter((s) => s.id !== "WARDEN")
    .map((s) => {
      const sw = seatWilson(learner, s.id);
      return { id: s.id, n: sw.n, wilson: sw.w, base: learnedBase(learner, s.id) };
    })
    .sort((a, b) => {
      if (a.n >= WARM_N && b.n >= WARM_N) return b.wilson - a.wilson;
      return b.base - a.base;
    });
  const rankOf: Record<string, number> = {};
  rankedSeats.forEach((s, i) => {
    rankOf[s.id] = i + 1;
  });

  type Acc = {
    vote: Vote;
    base: number;
    listen: number;
    w: number;
    signed: number;
    conf_w: number;
    contribution: number;
    status: SeatStatus;
    folded: boolean;
    fadeScale: number;
  };
  const accs: Acc[] = [];

  for (const vote of votes) {
    if (vote.seat === "WARDEN") continue;
    const isMuted = muted.has(vote.seat);
    const sw = seatWilson(learner, vote.seat);
    const cn = calibNOf(sw.n, learner.seat_calib_debt?.[vote.seat] ?? 0);
    let listen = listenOf(rankOf[vote.seat] ?? 10);
    if (sw.n >= WARM_N && sw.w < 0.42) listen *= 0.35;
    const card = learner.skills[vote.skill_used];
    if (card && card.last20.length >= 8) {
      const rec = recencyRate(card);
      if (rec < 0.42) listen *= 0.5;
      else if (rec > 0.62) listen = Math.min(1, listen * 1.12);
    }
    listen *= listenCalib(cn);
    const avg = scalpAvg(readScalp(learner, vote.seat).legs);
    const legsN = readScalp(learner, vote.seat).legs.length;
    if (avg != null && legsN >= 3) listen *= clamp(1 + avg / 40, 0.55, 1.45);
    const seqMute = silent.has(vote.seat);
    const hf = isMuted || seqMute ? 0 : healthFactor(vote);
    const lic = licensed(learner, vote, snap);
    let status: SeatStatus = "LIVE";
    if (isMuted) status = "MUTED";
    else if (seqMute) status = "VETO";
    else if (vote.health === "DOWN") status = "DOWN";
    else if (cn < WARM_N) status = "UNCALIBRATED";
    else if (bothDown) status = "VETO";

    const conf_w = (vote.confidence / 100) ** 1.4;
    let signed = vote.lean === "UP" ? conf_w : vote.lean === "DOWN" ? -conf_w : 0;
    const fade = learner.fade_strength[vote.seat] ?? 0;
    const rec8 = last8Rate(learner, vote.seat);
    let fadeScale = 1;
    if (vote.lean !== "WAIT" && rec8.n >= 8 && rec8.rate < 0.38) {
      signed = -signed;
      fadeScale = 0.55 + 0.45 * clamp(fade, 0, 1);
      status = "INVERT";
    }
    const w = learnedBase(learner, vote.seat) * listen * hf * lic * fadeScale;
    accs.push({
      vote,
      base: learnedBase(learner, vote.seat),
      listen,
      w,
      signed,
      conf_w,
      contribution: signed * w,
      status,
      folded: false,
      fadeScale,
    });
  }

  const foldNotes: string[] = [];
  const foldSameSide = (ids: SeatId[], label: string) => {
    const fam = accs.filter(
      (a) =>
        ids.includes(a.vote.seat) &&
        a.vote.lean !== "WAIT" &&
        a.status !== "MUTED" &&
        a.status !== "VETO" &&
        a.status !== "DOWN",
    );
    if (fam.length < 2) return;
    const side = fam[0]!.vote.lean;
    if (!fam.every((a) => a.vote.lean === side)) return;
    const loudest = fam.reduce((m, a) => (Math.abs(a.w) > Math.abs(m.w) ? a : m));
    const pileW = fam.reduce((s, a) => s + a.w, 0);
    if (pileW <= 0) return;
    const scale = loudest.w / pileW;
    for (const a of fam) {
      a.w *= scale;
      a.contribution = a.signed * a.w;
      a.folded = true;
      if (a.status === "LIVE" || a.status === "UNCALIBRATED") a.status = "FOLDED";
    }
    foldNotes.push(`${label} FOLDED`);
  };
  foldSameSide(
    accs.filter((a) => evidenceOf(a.vote.seat, snap) === "candle").map((a) => a.vote.seat),
    "candle",
  );
  foldSameSide(
    accs.filter((a) => evidenceOf(a.vote.seat, snap) === "book").map((a) => a.vote.seat),
    "book",
  );
  foldSameSide(
    accs.filter((a) => evidenceOf(a.vote.seat, snap) === "derivs").map((a) => a.vote.seat),
    "derivs",
  );

  const clockA = accs.find((a) => a.vote.seat === "CLOCK");
  if (clockA && clockA.vote.lean !== "WAIT" && clockA.status !== "MUTED" && clockA.status !== "VETO") {
    const allies = accs.filter(
      (a) =>
        a.vote.seat !== "CLOCK" &&
        a.vote.lean === clockA.vote.lean &&
        a.status !== "MUTED" &&
        a.status !== "VETO" &&
        a.status !== "DOWN",
    );
    if (!allies.length) {
      clockA.signed = 0;
      clockA.contribution = 0;
      clockA.status = "FOLDED";
      foldNotes.push("CLOCK cannot flip alone");
    }
  }

  const liveAccs = accs.filter((a) => a.status !== "MUTED");
  let sumW = liveAccs.reduce((s, a) => s + a.w, 0);
  const invertW = accs.filter((a) => a.status === "INVERT").reduce((s, a) => s + a.w, 0);
  let invertCap = "off";
  if (sumW > 0 && invertW > 0.18 * sumW) {
    const k = (0.18 * sumW) / invertW;
    for (const a of accs) {
      if (a.status === "INVERT") {
        a.w *= k;
        a.contribution = a.signed * a.w;
      }
    }
    sumW = liveAccs.reduce((s, a) => s + a.w, 0);
    invertCap = `invert pile scaled to 18% (×${k.toFixed(2)})`;
  }

  const dirAccs = liveAccs.filter((a) => a.vote.lean !== "WAIT");
  const sumWDir = dirAccs.reduce((s, a) => s + a.w, 0);
  const sitMass = sumW > 0 ? clamp((sumW - sumWDir) / sumW, 0, 1) : 0;
  let rawScore = sumWDir > 0 ? dirAccs.reduce((s, a) => s + a.signed * a.w, 0) / sumWDir : 0;

  const catSides = new Map<string, Lean>();
  for (const a of accs) {
    if (a.status === "MUTED" || a.status === "VETO" || a.vote.lean === "WAIT") continue;
    const cat = evidenceOf(a.vote.seat, snap);
    if (cat === "context") continue;
    const prev = catSides.get(cat);
    if (!prev) catSides.set(cat, a.vote.lean);
    else if (prev !== a.vote.lean) catSides.set(cat, "WAIT");
  }
  const agree = [...catSides.values()].filter((x) => x !== "WAIT");
  const upCats = agree.filter((x) => x === "UP").length;
  const dnCats = agree.filter((x) => x === "DOWN").length;
  const catAgree = Math.max(upCats, dnCats);
  let diversity = 1;
  if (catAgree >= 3) diversity = 1.12;
  else if (catAgree === 2) diversity = 1.06;
  rawScore *= diversity;

  const upMass = dirAccs.filter((a) => a.vote.lean === "UP").reduce((s, a) => s + a.w, 0);
  const dnMass = dirAccs.filter((a) => a.vote.lean === "DOWN").reduce((s, a) => s + a.w, 0);
  const sideMass = upMass + dnMass;
  const conflictFrac = sideMass > 0 ? Math.min(upMass, dnMass) / sideMass : 0;
  rawScore *= 1 - 0.7 * conflictFrac;

  const m = snap.mins_left;
  let timeFactor = 0.55;
  if (m >= 12) timeFactor = 0.55;
  else if (m >= 10) timeFactor = 0.78;
  else if (m >= 4) timeFactor = 1.15;
  else if (m > 2.2) timeFactor = 0.72;
  let agg = timeFactor;
  if (snap.spread_cents > 6) agg *= 0.85;
  const orbit = votes.find((v) => v.seat === "ORBIT");
  const orbitAgg = Number(orbit?.features.aggressiveness ?? 1);
  if (!quiet) agg *= 0.7 + 0.3 * clamp(orbitAgg, 0, 1);

  let bar = settings.adaptive_bar ? 0.3 : (settings.bar_override ?? 0.3);
  if (settings.bar_override != null && !settings.adaptive_bar) bar = settings.bar_override;
  if (quiet) bar += 0.08;
  if (weekend) bar += 0.04;
  if (learner.learn_phase === "EXPLORE") bar -= 0.04;
  if (learner.learn_phase === "EXPLOIT") bar += 0.04;

  let lawDimmer = "off";
  if (lockdown) lawDimmer = "LOCK";
  else if (learner.law_wrongs === 1) {
    bar += 0.06;
    lawDimmer = "miss-1 +0.06 bar";
  }

  const prelimConf = Math.min(92, Math.round(50 + Math.abs(rawScore) * 55));
  const key = binKey(prelimConf);
  const bin = learner.conf_bins[key] ?? { n: 0, hits: 0 };
  let tax = "none";
  let taxApplied = false;
  if (bin.n >= 12) {
    const hit = bin.hits / bin.n;
    if (hit < 0.55) {
      bar += 0.04;
      tax = `${key} bin hit ${(hit * 100).toFixed(0)}% on n=${bin.n} → cap conf + bar +0.04`;
      taxApplied = true;
    }
  }

  bar += 0.2 * sitMass;
  const knn = knnRead(learner.window_memory.tapes, snap);
  const proposed: Lean = rawScore > 0 ? "UP" : rawScore < 0 ? "DOWN" : "WAIT";
  const against = knn.against(proposed);
  let knnNote = knn.note;
  if (knn.n >= 6) {
    const bump = 0.16 * Math.max(0, against - 0.5) * 2;
    bar += bump;
    if (bump > 0.02) knnNote = `${knn.note} · cousins fade this side +${bump.toFixed(2)} bar`;
  }
  bar = clamp(bar, 0.24, 0.72);

  const alreadyIn = learner.window_memory.entry_lean && learner.window_memory.entry_lean !== "WAIT";

  const gates: Gate[] = [
    {
      id: "warden",
      label: "WARDEN: both spot and Kalshi healthy",
      pass: !bothDown,
      hard: true,
      value: `SPOT ${snap.health.spot} · KALSHI ${snap.health.kalshi} · seq ${snap.obs.gap}${
        warden.fails.length ? ` · ${warden.fails.map((f) => f.why).join("; ")}` : ""
      }`,
    },
    {
      id: "semantic",
      label: "WARDEN: prints make sense (strike, book, bars, OI)",
      pass: !warden.fails.length,
      hard: false,
      value: warden.fails.length ? warden.fails.map((f) => f.why).join("; ") : "ok",
    },
    {
      id: "seq",
      label: "Kalshi sequence continuous (book/tape seats live)",
      pass: !seqLost,
      hard: false,
      value: seqLost
        ? `${snap.obs.gap} · silent ${KALSHI_SEQ_SEATS.join("+")}`
        : "ok",
    },
    {
      id: "derivs",
      label: "Derivs live (CARRY/CHAIN/CASCADE)",
      pass: !derivsDown,
      hard: false,
      value: derivsDown ? `DOWN · silent ${DERIVS_FAMILY.join("+")}` : snap.health.derivs_source || "ok",
    },
    {
      id: "law",
      label: "LAW: not in lockdown",
      pass: !lockdown,
      hard: true,
      value: lockdown
        ? `ON ${learner.law_wrongs} wrongs · ${learner.lockdown_windows_left ?? 0} win left`
        : lawDimmer,
    },
    {
      id: "chalk",
      label: "Book not chalk (YES or NO ≥ 99¢)",
      pass: !snap.chalk,
      hard: true,
      value: `YES ${snap.yes_ask}¢ NO ${snap.no_ask}¢`,
    },
    {
      id: "leftover",
      label: "No phantom leftover (combined ask ≥ 98¢)",
      pass: snap.leftover_cents <= 2,
      hard: true,
      value: `${round(snap.leftover_cents, 1)}¢ · comb ${round(snap.combined_ask_cents, 1)}`,
    },
    {
      id: "quote",
      label: "Quote last update ≤ 25s",
      pass: snap.quote_age_s <= 25 && snap.obs.gap !== "gap" && snap.obs.gap !== "held",
      hard: snap.phase === "ENTRY" && !alreadyIn,
      value: `${snap.quote_age_s.toFixed(1)}s · print ${snap.print_age_s.toFixed(1)}s · ok ${snap.obs.last_ok_ts ? ((snap.as_of - snap.obs.last_ok_ts) / 1000).toFixed(1) : "—"}s · seq ${snap.quote_seq || "—"} · ${snap.obs.gap}`,
    },
    {
      id: "early",
      label: "Not hard-early (mins ≥ 12) unless already in",
      pass: snap.mins_left < 12 || !!alreadyIn,
      hard: true,
      value: `${snap.mins_left.toFixed(2)}m`,
    },
    {
      id: "late",
      label: "Not hard-late (mins ≤ 2.2) unless already in",
      pass: snap.mins_left > 2.2 || !!alreadyIn,
      hard: true,
      value: `${snap.mins_left.toFixed(2)}m`,
    },
    {
      id: "spread",
      label: "Spread ≤ 6¢",
      pass: snap.spread_cents <= 6,
      hard: false,
      value: `${round(snap.spread_cents, 1)}¢`,
    },
    {
      id: "quiet",
      label: "Quiet-vol floor not blocking (ATR% ≥ 0.12 or vol pct ≥ 25)",
      pass: !quiet,
      hard: false,
      value: `ATR% ${snap.atr_pct.toFixed(3)} pct ${snap.vol_percentile.toFixed(0)}`,
    },
    {
      id: "top3",
      label: "Top-3 ranks not in hard conflict",
      pass: true,
      hard: true,
      value: "",
    },
    {
      id: "bar",
      label: "|score| × aggressiveness ≥ confluence bar",
      pass: true,
      hard: true,
      value: "",
    },
  ];

  const activeSorted = [...accs]
    .filter((a) => a.status !== "MUTED")
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top3 = activeSorted.filter((a) => a.vote.lean !== "WAIT").slice(0, 3);
  let conflict = false;
  if (top3.length >= 2) {
    const hi = top3.filter((t) => t.vote.confidence >= 60);
    const sides = new Set(hi.map((t) => t.vote.lean));
    conflict = sides.has("UP") && sides.has("DOWN");
  }
  const loud60 = dirAccs.filter((a) => a.vote.confidence >= 60);
  const bothLoud =
    loud60.some((a) => a.vote.lean === "UP") && loud60.some((a) => a.vote.lean === "DOWN");
  if (conflictFrac >= 0.4 && bothLoud) conflict = true;
  gates.find((g) => g.id === "top3")!.pass = !conflict;
  gates.find((g) => g.id === "top3")!.value = conflict
    ? `frac ${conflictFrac.toFixed(2)} · ${top3.map((t) => `${t.vote.seat} ${t.vote.lean}${t.vote.confidence}`).join(" · ")}`
    : top3.map((t) => t.vote.seat).join(" · ") || "n/a";

  const vsBar = Math.abs(rawScore) * agg;
  gates.find((g) => g.id === "bar")!.pass = vsBar >= bar;
  gates.find((g) => g.id === "bar")!.value =
    `|${rawScore.toFixed(3)}| × ${agg.toFixed(2)} = ${vsBar.toFixed(3)} vs bar ${bar.toFixed(2)} (sit ${sitMass.toFixed(2)})`;

  let hardFail = gates.some((g) => g.hard && !g.pass);

  let lean: Lean = "WAIT";
  if (!hardFail && vsBar >= bar && !conflict) {
    lean = rawScore > 0 ? "UP" : rawScore < 0 ? "DOWN" : "WAIT";
  }
  if (!bothDown && !lockdown && lastLean !== "WAIT") {
    const signed = (rawScore >= 0 ? 1 : -1) * vsBar;
    lean = holdScore(lastLean, signed, bar);
  }
  if (bothDown || lockdown) lean = "WAIT";
  if (lean !== "WAIT" && knn.n >= 8 && knn.against(lean) >= 0.65) {
    lean = "WAIT";
    knnNote = `${knn.note} · abstain (cousins ${Math.round(against * 100)}% against)`;
  }

  const edge = lean === "UP" ? snap.edge_up : lean === "DOWN" ? snap.edge_down : 1;
  gates.push({
    id: "edge",
    label: "Fair vs ask after taker fee > 0",
    pass: lean === "WAIT" || edge > 0,
    hard: true,
    value: `fair ${round(snap.fair_yes, 1)}¢ · UP ${round(snap.edge_up, 1)} · DN ${round(snap.edge_down, 1)} · fee ${snap.fee_yes}/${snap.fee_no}`,
  });
  if (lean !== "WAIT" && edge <= 0) lean = "WAIT";
  gates.push({
    id: "memory",
    label: "Cousin windows do not fade this side",
    pass: lean === "WAIT" || knn.n < 8 || knn.against(lean) < 0.65,
    hard: false,
    value: knnNote,
  });
  hardFail = gates.some((g) => g.hard && !g.pass);
  const failed = gates.filter((g) => !g.pass);

  let full = prelimConf;
  if (taxApplied) {
    const hit = bin.n > 0 ? bin.hits / bin.n : 0;
    full = Math.min(full, Math.round(hit * 100));
  }
  if (oneDown && !bothDown && lean !== "WAIT") full = Math.min(full, 62);

  let conf = full;
  if (lean === "WAIT") {
    const nFail = failed.length;
    conf = clamp(70 + nFail * 3, 70, 92);
    if (bothDown) conf = 92;
  }

  const contribOrder = [...accs].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  const contribRankOf: Record<string, number> = {};
  let ci = 0;
  for (const a of contribOrder) {
    if (a.status === "MUTED" || a.status === "VETO" || a.status === "DOWN") continue;
    ci += 1;
    contribRankOf[a.vote.seat] = ci;
  }

  const rows: SeatRow[] = accs
    .map((a) => {
      const wilsonRank = rankOf[a.vote.seat] ?? 99;
      const contribRank = contribRankOf[a.vote.seat] ?? 99;
      const st = readScalp(learner, a.vote.seat);
      const calibN = calibNOf(
        learner.seat_n[a.vote.seat] ?? 0,
        learner.seat_calib_debt?.[a.vote.seat] ?? 0,
      );
      return {
        rank: contribRank,
        wilson_rank: wilsonRank,
        contrib_rank: contribRank,
        scalp_avg: scalpAvg(st.legs),
        scalp_n: st.legs.length,
        calib_n: calibN,
        calib: seatCalib(calibN),
        calls: learner.seat_calls?.[a.vote.seat] ?? 0,
        seat: a.vote.seat,
        callsign: SEAT_BY_ID[a.vote.seat].callsign,
        lean: a.vote.lean,
        conf: a.vote.confidence,
        skill_used: a.vote.skill_used,
        base_w: a.base,
        listen: a.listen,
        health: a.vote.health as FeedHealth,
        signed: a.signed,
        contribution: a.contribution,
        shadow_lean: a.vote.shadow?.lean ?? null,
        why: a.vote.reasoning,
        status: a.status,
        folded: a.folded,
      };
    })
    .sort((a, b) => {
      const pin = (s: SeatStatus) =>
        s === "MUTED" || s === "VETO" || s === "DOWN" || s === "UNCALIBRATED" ? 1 : 0;
      const dp = pin(a.status) - pin(b.status);
      if (dp) return dp;
      return Math.abs(b.contribution) - Math.abs(a.contribution);
    });

  const directional = votes.filter(
    (v) => v.seat !== "WARDEN" && !muted.has(v.seat) && v.lean !== "WAIT",
  );
  const quorum = {
    up: directional.filter((v) => v.lean === "UP").length,
    down: directional.filter((v) => v.lean === "DOWN").length,
    wait: votes.filter((v) => v.seat !== "WARDEN" && !muted.has(v.seat) && v.lean === "WAIT")
      .length,
  };

  const topSigned = [...rows]
    .filter((r) => r.lean !== "WAIT" && r.status !== "MUTED")
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);

  const parts = topSigned.map(
    (r) => `${r.seat} ${r.contribution >= 0 ? "+" : ""}${r.contribution.toFixed(3)}`,
  );
  const fadeNote = foldNotes.length ? foldNotes.join(" · ") : "no fold";
  const calc = `${parts.join(", ") || "no directional"} · ${fadeNote} · sit ${sitMass.toFixed(2)} · split ${conflictFrac.toFixed(2)} → score ${rawScore >= 0 ? "+" : ""}${rawScore.toFixed(2)} vs bar ${bar.toFixed(2)} → ${lean}`;

  const loudestDissent = rows.find(
    (r) => r.lean !== "WAIT" && lean !== "WAIT" && r.lean !== lean,
  );
  const failGate = failed[0];

  const foldedSeats = accs.filter((a) => a.folded).map((a) => a.vote.seat);
  const hypoBits: string[] = [snap.phase];
  if (foldedSeats.length) hypoBits.push(`folded ${foldNotes.join(" + ")} (${foldedSeats.join("+")})`);
  if (topSigned.length) {
    const head = topSigned[0]!;
    const opp = topSigned.filter((r) => r.lean !== head.lean);
    if (opp.length) {
      hypoBits.push(
        `${head.seat} ${head.lean} vs ${opp.map((o) => `${o.seat} ${o.lean}`).join(", ")}`,
      );
    } else {
      hypoBits.push(topSigned.map((r) => `${r.seat} ${r.lean}`).join(", "));
    }
  } else {
    hypoBits.push("no directional setup");
  }
  hypoBits.push(
    `score ${rawScore >= 0 ? "+" : ""}${rawScore.toFixed(2)} vs bar ${bar.toFixed(2)} after sit-mass ${sitMass.toFixed(2)}`,
  );
  hypoBits.push(conflict ? "table in conflict" : "top-3 not in conflict");
  const hypothesis = `${hypoBits.join(" · ")} → ${lean}`;

  const invalidate = invalidatePrint(snap, votes, failGate, conflict, !!alreadyIn);

  let size: 1 | 2 | 3 = 1;
  let size_note = "flat";
  if (lean !== "WAIT") {
    const ratio = bar > 0 ? vsBar / bar : 0;
    size = ratio >= 1.8 ? 3 : ratio >= 1.35 ? 2 : 1;
    size_note = `×${ratio.toFixed(2)} bar`;
    if (learner.graded_windows < 8) {
      size = 1;
      size_note = "uncalibrated cap · size 1";
    } else if (edge < 2) {
      size = 1;
      size_note = "thin edge vs ask · size 1";
    } else if (snap.spread_cents > 4) {
      size = 1;
      size_note = "wide spread · size 1";
    }
  } else {
    size_note = "WAIT";
  }

  return {
    lean,
    confidence: Math.round(conf),
    score: rawScore,
    bar,
    aggressiveness: agg,
    time_factor: timeFactor,
    diversity,
    sit_mass: sitMass,
    conflict_frac: conflictFrac,
    fade_fold: fadeNote,
    invert_cap: invertCap,
    tax,
    tax_applied: taxApplied,
    law_dimmer: lawDimmer,
    full_conf_raw: full,
    calc,
    gates,
    hard_fail: hardFail,
    hypothesis,
    evidence: topSigned.map(
      (r) => `${r.seat} ${r.lean} conf ${r.conf} contrib ${r.contribution.toFixed(3)} · ${r.skill_used}`,
    ),
    counter: loudestDissent
      ? `${loudestDissent.seat} ${loudestDissent.lean} ${loudestDissent.conf} — ${loudestDissent.why}`
      : failGate
        ? `gate ${failGate.label} FAIL (${failGate.value})`
        : "none printed",
    decision: `${lean} · |${Math.abs(rawScore).toFixed(2)}| vs bar ${bar.toFixed(2)} · ${lean === "WAIT" ? failed[0]?.label ?? "gates" : "confluence holds"}`,
    invalidate_if: invalidate,
    huddle_line: learner.huddle_log[0] ?? "no huddle yet",
    last_settle: learner.settle_tape[0] ?? "no settle yet",
    knn_note: knnNote,
    wait_note:
      (learner.chair_wait_n ?? 0) > 0
        ? `WAIT saved ${learner.chair_wait_good}/${learner.chair_wait_n} (both sides ≤ 0¢ after fee)`
        : "WAIT not graded yet",
    walk: walkForward(learner.wf_chair),
    quorum,
    rows,
    categories_agree: catAgree,
    size,
    size_note,
  };
}

function invalidatePrint(
  snap: Snapshot,
  votes: Vote[],
  failGate: Gate | undefined,
  conflict: boolean,
  alreadyIn: boolean,
): string {
  if (snap.leftover_cents > 2) return "if combined ask prints below 98¢ (stale leftover)";
  if (snap.edge_up <= 0 && snap.edge_down <= 0) return "if both sides have no edge vs ask after fee";
  if (snap.chalk || snap.yes_ask >= 96 || snap.no_ask >= 96) {
    return "if book goes chalk (YES or NO ≥ 99¢)";
  }
  if (snap.quote_age_s > 15) return "if quote age > 25s";
  if (snap.mins_left <= 3 && !alreadyIn) return "if clock prints ≤ 2.2m left";
  const strike = votes.find((v) => v.seat === "STRIKE" && v.lean !== "WAIT");
  if (strike) return "if spot reprints through strike";
  const book = votes.find(
    (v) => (v.seat === "FADE" || v.seat === "ODDS" || v.seat === "CHEAP") && v.lean !== "WAIT",
  );
  if (book) return "if YES mid rips +8¢ in 60s";
  if (failGate) return `if ${failGate.label} stays failed`;
  if (conflict) return "if top-3 stay in conflict";
  return "if |score|×agg drops under the bar";
}
