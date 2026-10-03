import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  GA_EVENT_NAMES,
  GA_MEASUREMENT_ID,
  GA_BOOTSTRAP_SCRIPT,
  suppressGaForAgent,
  gtagEvent,
  gtagEventAfterSuccess,
  gtagPageView,
  type GaEventName,
} from "./ga.ts";

test("explicit bots are suppressed; desktop, mobile and direct users remain eligible", () => {
  for (const ua of [
    "Googlebot/2.1",
    "Mozilla/5.0 HeadlessChrome/130",
    "python-requests/2.32",
    "curl/8.0",
    "GPTBot/1.0",
    "ELB-HealthChecker/2.0",
    "kalshi-bot-access",
    "Example crawler",
  ]) {
    assert.equal(suppressGaForAgent(ua), true, ua);
  }
  for (const ua of [
    undefined,
    "",
    "Mozilla/5.0 Chrome/130.0 Safari/537.36",
    "Mozilla/5.0 (iPhone) Version/18 Mobile Safari/604.1",
    "Mozilla/5.0 (Android 16; SM-F946U) Chrome/130.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Android; CUBOT) Firefox/130",
  ]) {
    assert.equal(suppressGaForAgent(ua), false, ua);
  }
});

test("bootstrap never loads Google or queues hits for bot UA or webdriver", () => {
  for (const navigator of [
    { userAgent: "HeadlessChrome/130", webdriver: false },
    { userAgent: "Chrome/130", webdriver: true },
  ]) {
    const window: Record<string, unknown> = {};
    runInNewContext(GA_BOOTSTRAP_SCRIPT, {
      window,
      navigator,
      document: { head: { appendChild: () => assert.fail("bot loaded Google") } },
    });
    assert.equal(window.__scGa4Blocked, true);
    assert.equal(window.dataLayer, undefined);
    assert.equal(window.gtag, undefined);
  }
});

test("human bootstrap retains loader, measurement ID and explicit page-view config", () => {
  const window: Record<string, unknown> = {};
  const scripts: Array<{ src: string }> = [];
  runInNewContext(GA_BOOTSTRAP_SCRIPT, {
    window,
    navigator: { userAgent: "Mozilla/5.0 Chrome/130 Safari/537.36", webdriver: false },
    document: {
      createElement: () => ({ dataset: {} }),
      head: { appendChild: (script: { src: string }) => scripts.push(script) },
    },
  });
  assert.equal(window.__scGa4Blocked, false);
  assert.equal(window.__scGa4Configured, true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`);
  const queue = window.dataLayer as Array<ArrayLike<unknown>>;
  assert.equal(queue.length, 2);
  assert.equal(queue[1][0], "config");
  assert.equal(queue[1][1], GA_MEASUREMENT_ID);
  assert.equal((queue[1][2] as { send_page_view: boolean }).send_page_view, false);
});

test("SSR suppression marker prevents helper repair and all event emissions", () => {
  const prev = globalThis.window;
  const calls: unknown[][] = [];
  // @ts-expect-error test shim
  globalThis.window = { __scGa4Blocked: true, gtag: (...args: unknown[]) => calls.push(args) };
  try {
    gtagPageView("/");
    for (const name of GA_EVENT_NAMES) gtagEvent(name);
    assert.deepEqual(calls, []);
    assert.equal(window.dataLayer, undefined);
    assert.equal(window.__scGa4LastPageView, undefined);
  } finally {
    globalThis.window = prev;
  }
});

test("final event set is exactly the four allowed names", () => {
  assert.deepEqual(
    [...GA_EVENT_NAMES].sort(),
    ["enter_the_floor", "feedback_submitted", "paper_call_locked", "character_voice_played"].sort(),
  );
  const forbidden = [
    "signup",
    "sign_up",
    "generate_lead",
    "purchase",
    "add_to_cart",
    "begin_checkout",
  ];
  for (const bad of forbidden) {
    assert.equal((GA_EVENT_NAMES as readonly string[]).includes(bad), false, bad);
  }
});

test("gtagEvent repairs a missing gtag queue instead of dropping the event", () => {
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = { dataLayer: [] };

  assert.doesNotThrow(() => gtagEvent("enter_the_floor"));

  assert.equal(typeof globalThis.window.gtag, "function");
  const queue = globalThis.window.dataLayer as unknown[][];
  assert.equal(queue.length, 3);
  assert.equal(queue[0]?.[0], "js");
  assert.ok(queue[0]?.[1] instanceof Date);
  assert.deepEqual(queue[1], ["config", GA_MEASUREMENT_ID, { send_page_view: false }]);
  assert.deepEqual(queue[2], ["event", "enter_the_floor"]);

  globalThis.window = prev;
});

test("gtagEvent forwards only the event name (no params / no PII)", () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };
  gtagEvent("enter_the_floor");
  gtagEvent("feedback_submitted");
  gtagEvent("paper_call_locked");
  gtagEvent("character_voice_played");
  assert.deepEqual(calls, [
    ["event", "enter_the_floor"],
    ["event", "feedback_submitted"],
    ["event", "paper_call_locked"],
    ["event", "character_voice_played"],
  ]);
  globalThis.window = prev;
});

test("gtagPageView emits once per current route key and allows later navigation", () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };

  gtagPageView("/board");
  gtagPageView("/board");
  gtagPageView("/desk?tab=floor");
  gtagPageView("/board");

  assert.deepEqual(calls, [
    ["event", "page_view"],
    ["event", "page_view"],
    ["event", "page_view"],
  ]);
  globalThis.window = prev;
});

test("gtagEventAfterSuccess fires feedback_submitted exactly once after success", async () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };
  let ran = 0;
  await gtagEventAfterSuccess("feedback_submitted", async () => {
    ran += 1;
  });
  assert.equal(ran, 1);
  assert.deepEqual(calls, [["event", "feedback_submitted"]]);
  globalThis.window = prev;
});

test("gtagEventAfterSuccess fires paper_call_locked exactly once after success", async () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };
  let ran = false;
  await gtagEventAfterSuccess("paper_call_locked", async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.deepEqual(calls, [["event", "paper_call_locked"]]);
  globalThis.window = prev;
});

test("gtagEventAfterSuccess does not fire when work rejects", async () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };
  await assert.rejects(
    () =>
      gtagEventAfterSuccess("feedback_submitted", async () => {
        throw new Error("post failed");
      }),
    /post failed/,
  );
  assert.deepEqual(calls, []);
  globalThis.window = prev;
});

test("gtagEvent never throws even if gtag throws", () => {
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: () => {
      throw new Error("gtag broke");
    },
  };
  assert.doesNotThrow(() => gtagEvent("enter_the_floor"));
  globalThis.window = prev;
});

test("no auto paper_call_locked without an explicit success helper call", () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    __scGa4Configured: true,
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };
  // Importing / defining names must not emit.
  const name: GaEventName = "paper_call_locked";
  assert.equal(name, "paper_call_locked");
  assert.deepEqual(calls, []);
  globalThis.window = prev;
});
