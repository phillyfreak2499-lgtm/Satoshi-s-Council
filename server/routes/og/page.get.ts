/** Stable, page-specific PNG cards; no database or upstream feed needed. */
const PAGES: Record<string, [string, string]> = {
  "/": ["THE FLOOR", "LIVE BITCOIN / 15-MINUTE PAPER RESEARCH"],
  "/books": ["THE BOOKS", "RECORDED RESULTS / FEES / DATA COVERAGE"],
  "/board": ["THE BOARD", "COUNCIL UPDATES / IDEAS / FEEDBACK"],
  "/chamber": ["THE CHAMBER", "RECORDED EVENTS / EVIDENCE / UTC"],
  "/training": ["CHOOSE YOUR COACH", "COUNCIL SPECIALISTS / GUIDED PAPER PRACTICE"],
  "/training/tape": ["TAPE TRAINING DESK", "RESTING SIZE / BOOK PRESSURE / PAPER PRACTICE"],
  "/training/drift": ["DRIFT TRAINING DESK", "5M / 15M / 30M MOMENTUM ALIGNMENT"],
  "/training/wick": ["WICK TRAINING DESK", "CLOSED CANDLES / SIX SCREENS / YOUR PACE"],
  "/lab": ["THE LAB", "FROZEN EXPERIMENTS / MATCHED EVIDENCE"],
  "/arena": ["THE ARENA", "YOUR PAPER CALL / THE ROOM / THE CHAIR"],
  "/about": ["MEET THE COUNCIL", "21 SEATS / 18 VOTE / 3 PIT CREW"],
  "/faq": ["QUESTIONS & ANSWERS", "HOW THE PAPER RESEARCH DESK WORKS"],
  "/legal": ["PAPER ONLY", "NO LIVE ORDERS / NO FINANCIAL ADVICE"],
};

export default async function pageCard(event: { url: URL }) {
  const page = PAGES[event.url.searchParams.get("page") ?? "/"];
  if (!page) return new Response("not found", { status: 404 });
  const { raster, fillRect, fitText, encodePng, INK } = await import("../../../src/lib/desk/og.server");
  const card = raster(1200, 630);
  fillRect(card, 48, 54, 1104, 4, INK.gold);
  fitText(card, 52, 96, "SATOSHI'S COUNCIL", INK.gold, 6, 1096);
  fitText(card, 52, 235, page[0], INK.fg, 12, 1096);
  fitText(card, 52, 380, page[1], INK.fg, 4, 1096);
  fitText(card, 52, 540, "BITCOIN ONLY / PAPER ONLY / NOT FINANCIAL ADVICE", INK.gold, 3, 1096);
  const png = encodePng(card);
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}
