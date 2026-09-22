import assert from "node:assert/strict";
import test from "node:test";
import { PACKAGE_SIT_SCHEDULE_SECS, shouldWriteSitReceipt } from "./shadow-sit.ts";
import { scheduledCheckpoint } from "./shadow-arms.ts";

test("the sit checkpoint is T-3 with the same 12 s grace NULL_FAV uses", () => {
  assert.deepEqual([...PACKAGE_SIT_SCHEDULE_SECS], [180]);
  assert.equal(scheduledCheckpoint(180, PACKAGE_SIT_SCHEDULE_SECS), 180);
  assert.equal(scheduledCheckpoint(169, PACKAGE_SIT_SCHEDULE_SECS), 180);
  assert.equal(scheduledCheckpoint(168, PACKAGE_SIT_SCHEDULE_SECS), null);
  assert.equal(scheduledCheckpoint(181, PACKAGE_SIT_SCHEDULE_SECS), null);
  assert.equal(scheduledCheckpoint(300, PACKAGE_SIT_SCHEDULE_SECS), null, "T-5 is NULL_FAV's fallback, not the package sit");
  assert.equal(scheduledCheckpoint(450, PACKAGE_SIT_SCHEDULE_SECS), null);
});

test("a WAIT window writes a sit only at T-3 and only once", () => {
  assert.equal(shouldWriteSitReceipt(180, false), true);
  assert.equal(shouldWriteSitReceipt(170, false), true);
  assert.equal(shouldWriteSitReceipt(180, true), false, "fill/intention/no_fill already durable");
  assert.equal(shouldWriteSitReceipt(450, false), false, "do not sit at T-7:30; the package may still speak");
  assert.equal(shouldWriteSitReceipt(300, false), false);
  assert.equal(shouldWriteSitReceipt(200, false), false);
});
