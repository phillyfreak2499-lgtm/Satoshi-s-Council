import assert from "node:assert/strict";
import { test } from "node:test";
import { readFillPair, READ_FILL_TIP } from "./read-fill.ts";
import { sitStreakLine } from "./chamber-sit-digest.ts";
import { SIT_IS_THE_CALL } from "./chair-words.ts";

test("WAIT with no book fill stays two columns", () => {
  const pair = readFillPair("WAIT", { kind: "wait" });
  assert.equal(pair.read, "WAIT");
  assert.equal(pair.fill, "no fill");
  assert.match(pair.fillDetail, /No recorded paper position/);
});

test("a booked row keeps the current read separate from the fill", () => {
  const pair = readFillPair("WAIT", { kind: "booked", lean: "UP", cents: 81, ask: 80 });
  assert.equal(pair.read, "WAIT");
  assert.equal(pair.fill, "UP held");
  assert.equal(pair.fillDetail, "81¢ entry");
});

test("the tip never merges read and fill", () => {
  assert.match(READ_FILL_TIP, /can disagree/);
  assert.doesNotMatch(READ_FILL_TIP, /signal service/i);
});

test("sit digest names the streak without calling the room broken", () => {
  assert.equal(sitStreakLine(1), SIT_IS_THE_CALL);
  assert.match(sitStreakLine(5), /sat 5 consecutive windows/);
  assert.match(sitStreakLine(5), /Sitting this window is the call/);
  assert.doesNotMatch(sitStreakLine(5), /nobody on the floor is speaking/i);
});
