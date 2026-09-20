import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GA_EVENT_NAMES,
  GA_MEASUREMENT_ID,
  gtagEvent,
  gtagEventAfterSuccess,
  gtagPageView,
  type GaEventName,
} from "./ga.ts";

test("final event set is exactly the four allowed names", () => {
  assert.deepEqual([...GA_EVENT_NAMES].sort(), [
    "enter_the_floor",
    "feedback_submitted",
    "paper_call_locked",
    "character_voice_played",
  ].sort());
  const forbidden = ["signup", "sign_up", "generate_lead", "purchase", "add_to_cart", "begin_checkout"];
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
