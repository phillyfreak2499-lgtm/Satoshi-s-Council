import { test } from "node:test";
import assert from "node:assert/strict";
import { GA_EVENT_NAMES, gtagEvent, gtagEventAfterSuccess, type GaEventName } from "./ga.ts";

test("final event set is exactly the three allowed names", () => {
  assert.deepEqual([...GA_EVENT_NAMES].sort(), [
    "enter_the_floor",
    "feedback_submitted",
    "paper_call_locked",
  ].sort());
  const forbidden = ["signup", "sign_up", "generate_lead", "purchase", "add_to_cart", "begin_checkout"];
  for (const bad of forbidden) {
    assert.equal((GA_EVENT_NAMES as readonly string[]).includes(bad), false, bad);
  }
});

test("gtagEvent is a no-op when gtag is missing", () => {
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = { gtag: undefined };
  assert.doesNotThrow(() => gtagEvent("enter_the_floor"));
  globalThis.window = prev;
});

test("gtagEvent forwards only the event name (no params / no PII)", () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
  };
  gtagEvent("enter_the_floor");
  gtagEvent("feedback_submitted");
  gtagEvent("paper_call_locked");
  assert.deepEqual(calls, [
    ["event", "enter_the_floor"],
    ["event", "feedback_submitted"],
    ["event", "paper_call_locked"],
  ]);
  globalThis.window = prev;
});

test("gtagEventAfterSuccess fires only after work resolves", async () => {
  const calls: unknown[][] = [];
  const prev = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
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
