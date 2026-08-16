/* Every Council PR that changes the desk must append a WIRE entry. */
/* Entry shape: { id, at, title, why } — newest first. at is ISO-8601 America/Chicago. */
window.COUNCIL_WIRE = [
  {
    "id": "2026-08-16-vitalik-closeup",
    "at": "2026-08-16T05:35:00-05:00",
    "title": "Vitalik files are the close-up cuts",
    "why": "Watcher close-up Vitalik WAIT/UP/DOWN jpgs are on the desk — teal HOLD, green UP, red DOWN, dark back, no city. Same man. Name stays Vitalik. Satoshi, Ares, and Raijin chairs stay put. Desk still shows one WAIT face. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-one-face",
    "at": "2026-08-16T04:50:00-05:00",
    "title": "One face per Chair",
    "why": "Satoshi, Vitalik, Ares, Raijin, and ORACLE each keep one WAIT face. Labels carry UP/DOWN/WAIT/LOCK. Faces do not swap. Eye tints are off. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-header-still",
    "at": "2026-08-16T04:45:00-05:00",
    "title": "Header STILL sits next to mute",
    "why": "Header STILL next to mute for slow pipes. Cuts seat orbit, money rain, intro thrash, starfield, lock beams, and attract wander — same freeze the Floor already honors. Not a Floor SPIN control. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-vitalik-recenter",
    "at": "2026-08-16T04:40:00-05:00",
    "title": "Vitalik chair is a close-up face now",
    "why": "Vitalik WAIT/UP/DOWN are the signed close-up face cuts — teal HOLD, green UP, red DOWN — simple dark back, no table room. Same man. Name stays Vitalik. Satoshi, Ares, and Raijin chairs stay put. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-coinglass-1h-only",
    "at": "2026-08-16T04:25:00-05:00",
    "title": "CoinGlass Chair-healthy is 1h hist only",
    "why": "coinglass_ok is true only when a real 30m/1h hist returned numbers. 4h is the Hobbyist floor, not a 1H lock input — PR #31 stays out. No open-interest/exchange-list probe. Fail-soft + plan-wall cache. Startup still required for 1h hist. HUD Glass stays on coinglass_ok. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-coinglass-wall-tight",
    "at": "2026-08-16T04:15:00-05:00",
    "title": "CoinGlass plan wall stays latched",
    "why": "After 30m and 1h both return Upgrade plan, the desk latches a plan wall and stops re-probing — including the other table. coinglass_ok stays false — plan wall: need Startup+ for 30m/1h. Binance may still fill CARRY last-print; that does not flip the HUD Glass dot. No 4h into 1H locks. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-kill-crickets",
    "at": "2026-08-16T04:00:00-05:00",
    "title": "Cricket bed leaves the desk",
    "why": "The skip-hour cricket bed is off. No ambient cricket loop on the desk, Floor, gate, or Night. Lock, win, and lose SFX stay. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-coinglass-plan-wall",
    "at": "2026-08-16T03:55:00-05:00",
    "title": "CoinGlass plan wall stops the 30m retry",
    "why": "Hobbyist cannot do 30m/1h. After both windows return Upgrade plan, the desk caches a plan wall and stops re-probing 30m every cycle. coinglass_ok stays false — plan wall: need Startup+ for 30m/1h. No 4h heatmap into 1H locks. Binance futures stay, Oregon 451 soft-fails. HUD Glass stays not-green. Not the weather GLASS seat. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-coinglass-hud-only",
    "at": "2026-08-16T03:50:00-05:00",
    "title": "CoinGlass HUD stays; 401 chase leaves this desk",
    "why": "The HUD Glass light still matches live health — coinglass_ok=false / 401 Upgrade plan is not green. That light is not the Raijin NWS GLASS seat. This PR does not chase the CoinGlass key and does not add a 401 probe path. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-chair-table-call",
    "at": "2026-08-16T03:35:00-05:00",
    "title": "Chair tables speak LOCK / WAIT",
    "why": "The live call on each chair table is now LOCK or WAIT, a plain direction, and the strike/window — no percent, cents, or Q dump. Current Calls still lists BTC, ETH, Front, and ORA. Phone back still returns to Floor. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-current-calls",
    "at": "2026-08-16T03:20:00-05:00",
    "title": "Current Calls + punchy Chair lines",
    "why": "Each chair table now reads LOCK or WAIT, a plain direction, and the strike/window — CRT/neon, not a spreadsheet dump. A Current Calls tab lists BTC, ETH, Front, and ORA in one place. Phone back still returns to Floor. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-hour-ladder",
    "at": "2026-08-16T03:10:00-05:00",
    "title": "Hourly BTC/ETH pick the playable ladder rung",
    "why": "Hourly BTC and ETH are a strike ladder, not one binary. The desk now takes the hour’s best contract after vig — 64/36 over chalk 98/2 — then the existing 20–80 / EV / dead-book / first-10 / last-15 / BTC-leads-ETH gates still sit. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-coinglass-hud",
    "at": "2026-08-16T03:00:00-05:00",
    "title": "CoinGlass HUD light matches the miss",
    "why": "The HUD Glass dot defaulted green. Live health is coinglass_ok=false on HTTP 200 / code 401 Upgrade plan — the light is not-ok now. This is not the Raijin NWS GLASS seat. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-glass-pane",
    "at": "2026-08-16T02:50:00-05:00",
    "title": "GLASS reads the live NWS pane",
    "why": "GLASS was WAIT / NO PANE when the DAL period forecast was null even though MESH NWS and KDFW were live. The light now goes green from that NWS pane — not CoinGlass, not Open-Meteo. Front stays off the nav. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-side-parked",
    "at": "2026-08-16T02:40:00-05:00",
    "title": "Side Table leaves the desk",
    "why": "The 15m paper arcade is parked. Side is not a nav tab and not on the Floor. Oracle’s room plate is a later chair-room behind ORACLE — not this Side Table. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-ora-kit",
    "at": "2026-08-16T02:30:00-05:00",
    "title": "ORA gold tab + Oracle room plate",
    "why": "Gold tab is ORA, not GLD. Chair name stays ORACLE. Seats are SIBYL / PIT / VEIL / MARBLE. CRT/neon room plate is its own image, not baked into the face. No crypto chrome on this kit. ORACLE does not place orders. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-phone-oracle",
    "at": "2026-08-16T02:20:00-05:00",
    "title": "ORACLE sits as the fifth Floor leader",
    "why": "Floor is five equal chairs: Satoshi, Vitalik, Raijin, Ares, ORACLE. CRT/neon HUD. Face-only placeholder — no signed ORACLE portrait in the repo. SIBYL/PIT/VEIL/MARBLE roster is not parked here. ORACLE does not place orders. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-floor-clocks",
    "at": "2026-08-16T02:15:00-05:00",
    "title": "Each Floor leader keeps its own clock",
    "why": "One middle hour LED hid the real windows. BTC and ETH keep 1H. Raijin keeps DFW high. Ares keeps kick. ORACLE is WATCH. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-phone-back",
    "at": "2026-08-16T02:10:00-05:00",
    "title": "Phone views get a Floor back control",
    "why": "On a 390 phone every tab needed a way out. A 44px ← FLOOR hit sits one-handed. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-front-tab-off",
    "at": "2026-08-16T02:05:00-05:00",
    "title": "THE FRONT leaves the nav",
    "why": "Front is not a tab. Raijin stays a Floor chair. Weather table stays in the tree. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-park-intro",
    "at": "2026-08-16T02:00:00-05:00",
    "title": "SUMMON skips the parked clips",
    "why": "Zach is remaking the openings. After agree + code + SUMMON the desk stays. No clip. No fullscreen. Gate stays hidden. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-phone-gate-pact-err",
    "at": "2026-08-16T01:50:00-05:00",
    "title": "Agree-off now speaks",
    "why": "Enter or SUMMON with the pact open used to do nothing. Disabled SUMMON no longer swallows the tap. The gate now says Seal the pact first. on the error line next to agree. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-phone-gate-se",
    "at": "2026-08-16T01:40:00-05:00",
    "title": "Short phones keep SUMMON on screen",
    "why": "SE / Safari chrome at 390×667 lost SUMMON under a 36vh pad and a flex-end overlay iOS will not scroll. Short height drops the pad. Tall phones keep 36vh + flex-end on a hidden overlay, not a scroll. SUMMON is a real footer. Agree-off now says Seal the pact first. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-phone-gate-nav",
    "at": "2026-08-16T01:30:00-05:00",
    "title": "Phone gate and nav use the real device width",
    "why": "iPhone 390 had a dead side strip and SUMMON dropped under the fold and the keyboard. Body now follows 100% / 100dvw — no 375 lock. Agree + SUMMON stick to the bottom with a 44px tap row. Pact type is 16px on phone. Tab row scrolls with fade and arrows. Floor is one-handed and the leader stays tappable. Paper. Follower OFF."
  },
  {
    "id": "2026-08-16-desk-unlock-stay",
    "at": "2026-08-16T00:20:00-05:00",
    "title": "Unlock stays on the desk",
    "why": "After SUMMON the gate stays hidden; new 6s opening plays; old logo intro is gone. Leader photo click selects only — no clip. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-hit-slate-reset",
    "at": "2026-08-15T23:59:00-05:00",
    "title": "Chair hit slate reset after tape",
    "why": "90-day Kalshi tape replay merged into seat brains (3,053 hours; BTC 1,508 / ETH 1,545). WICK/STRIKE/CLOCK/DRIFT got the most. CARRY/CHAIN/CASCADE stayed empty (CoinGlass Upgrade plan). Displayed Chair hit count reset so the old 2/7 doesn’t sit on the new weights. Paper only. Follower OFF."
  },
  {
    "id": "2026-08-15-login-splash",
    "at": "2026-08-15T23:55:00-05:00",
    "title": "Login splash is the signed council table",
    "why": "Signed Satoshi-center council table behind #passwordGate. Gate chrome is dark stone + amber/cyan. Type sits over the table, not the faces. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-raijin-cowboy-face",
    "at": "2026-08-15T23:50:00-05:00",
    "title": "Raijin cowboy is face-only now",
    "why": "Cowboy face-only WAIT + Ares-style green/red eye tint; Dallas lives on the room plate."
  },
  {
    "id": "2026-08-15-satoshi-face",
    "at": "2026-08-15T23:45:00-05:00",
    "title": "Satoshi chair face swap",
    "why": "Satoshi chair is a new signed close-up (UP green / DOWN red / HOLD amber). Gold SELL cut parked, not live. Face-only, no shrine. Not Floor. Not rooms."
  },
  {
    "id": "2026-08-15-raijin-cowboy",
    "at": "2026-08-15T23:30:00-05:00",
    "title": "Raijin is now the Dallas storm cowboy",
    "why": "One signed WAIT cut; UP/DOWN eyes tint like Ares (green/red). Name stays Raijin. No Cowboys star. Not Floor. Not ORACLE."
  },
  {
    "id": "2026-08-15-vitalik-face",
    "at": "2026-08-15T23:10:00-05:00",
    "title": "Vitalik chair got a new signed face",
    "why": "UP green / DOWN red / WAIT teal. Same mapping. Not Floor. Not ORACLE."
  },
  {
    "id": "2026-08-15-floor-chairs",
    "at": "2026-08-15T23:05:00-05:00",
    "title": "Floor is leaders only + checkboxes",
    "why": "Floor shows Chairs only — Satoshi, Vitalik, Ares, Raijin. Checkboxes pick who sits; leftover grow 1 / 50-50 / thirds / fourths. No seat-bot rings, not even lock-only. Bots stay on Seats and Table. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-coinglass-miss",
    "at": "2026-08-15T22:40:00-05:00",
    "title": "CoinGlass logs the real miss",
    "why": "CoinGlass now logs the real miss + 30m/1h paths. CARRY/CHAIN/CASCADE stay dark only with a reason. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-seat-backfill",
    "at": "2026-08-15T22:30:00-05:00",
    "title": "90-day Kalshi seat backfill",
    "why": "BTC and ETH brains get settled 1h tape they never sat through. CoinGlass hist (30m then 1h) grades CARRY, CHAIN, and CASCADE when the feed answers. Merge into the live brain. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-summon-oath",
    "at": "2026-08-15T22:10:00-05:00",
    "title": "Gate now SUMMON THE COUNCIL after agree",
    "why": "Agree first, then the button reads SUMMON THE COUNCIL. Why: paper / not advice / 18+ / not Kalshi / full stake / no past score is a promise."
  },
  {
    "id": "2026-08-15-seats-tab",
    "at": "2026-08-15T22:00:00-05:00",
    "title": "Seats tab is one page",
    "why": "Bots, Ranks, and Dashboard sit together now. Same people — who they are, how they sit, the cards. One door instead of three. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-chair-rooms",
    "at": "2026-08-15T21:30:00-05:00",
    "title": "Chair rooms change the Floor",
    "why": "Zach wants the room to change with the Chair — Satoshi vault, Vitalik glass, Ares stadium — so you know who you are watching before you read a name. Seat mood and hour weather sit under the majority wisps. Paper. Follower OFF."
  },
  {
    "id": "2026-08-15-boot-listen",
    "at": "2026-08-15T21:10:00-05:00",
    "title": "Boot no longer blocks the port",
    "why": "Merges don’t 502 the desk. Why: Zach."
  },
  {
    "id": "2026-08-15-wire-tab",
    "at": "2026-08-15T20:00:00-05:00",
    "title": "WIRE tab is live",
    "why": "Desk changes now land here — past notes plus every new PR from this point."
  },
  {
    "id": "2026-08-15-hit-slate",
    "at": "2026-08-15T19:00:00-05:00",
    "title": "Hit counts will zero",
    "why": "Site hit slate resets after smarter-bots work. Bot memory stays. Don't freak when the numbers go to zero."
  },
  {
    "id": "2026-08-15-ares-72h",
    "at": "2026-08-15T18:00:00-05:00",
    "title": "Ares sits month-out tickets",
    "why": "72h kick cap. Prefer same-day/24h. Sep 18 HOU@TTU sat so a nearer book (DAL -6.5, kick in 2D) could take the chair. Paper."
  },
  {
    "id": "2026-08-15-btc-shadow",
    "at": "2026-08-15T17:00:00-05:00",
    "title": "BTC shadow is WAIT-hour paper",
    "why": "Scores directional paper during WAIT hours. Not a Chair lock. ETH gates unchanged."
  },
  {
    "id": "2026-08-15-ares-nearer",
    "at": "2026-08-15T16:00:00-05:00",
    "title": "Nearer kick beats fat leftover",
    "why": "A month-out leftover does not outrank a nearer NFL/CFB book."
  },
  {
    "id": "2026-08-15-ats-sport-chip",
    "at": "2026-08-15T15:00:00-05:00",
    "title": "Sport chip on the ATS HUD",
    "why": "Neon NFL/CFB/NBA/MLB/NHL sits next to GAME · LINE."
  },
  {
    "id": "2026-08-15-dwf-ats-desks",
    "at": "2026-08-15T14:00:00-05:00",
    "title": "DWF and ATS desks on one Ares face",
    "why": "Book clocks live. Leftover crypto HUD stays hidden on those desks."
  },
  {
    "id": "2026-08-15-ares-chair",
    "at": "2026-08-15T13:00:00-05:00",
    "title": "Ares takes the fourth Floor seat",
    "why": "One paper ticket. Follower OFF."
  },
  {
    "id": "2026-08-15-chair-band",
    "at": "2026-08-15T12:00:00-05:00",
    "title": "Chair band is 10–90¢",
    "why": "99¢ is a hard no. Sports band still 20–80."
  },
  {
    "id": "2026-08-15-city-mark",
    "at": "2026-08-15T11:00:00-05:00",
    "title": "City candle on the gate",
    "why": "Mark on gate, header, and favicon. Copy stays Satoshi’s Council."
  }
];
