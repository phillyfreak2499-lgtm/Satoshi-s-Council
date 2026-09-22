import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_QUIET_NOTICE,
  RESEARCH_QUIET_NOTICE_KEY,
  researchQuietNoticeHiddenOn,
} from "./research-quiet-notice.ts";

test("the notice is a measurement note, not a signal or a third hero CTA", () => {
  const text = `${RESEARCH_QUIET_NOTICE.title} ${RESEARCH_QUIET_NOTICE.body}`;
  for (const banned of [/\bbuy\b/i, /\bsignal\b/i, /\bbet\b/i, /\border\b/i, /ETH/i, /sport/i]) {
    assert.doesNotMatch(text, banned);
  }
  assert.match(text, /WAIT/);
  assert.match(text, /Paper only/);
  assert.match(text, /not an outage/);
  assert.equal(RESEARCH_QUIET_NOTICE.labHref, "/lab");
  assert.equal(RESEARCH_QUIET_NOTICE.trainingHref, "/training");
  assert.equal(RESEARCH_QUIET_NOTICE_KEY, "sc.notice.research-quiet.v1");
});

test("the overlay stays off Lab, Training, and Legal", () => {
  assert.equal(researchQuietNoticeHiddenOn("/"), false);
  assert.equal(researchQuietNoticeHiddenOn("/desk"), false);
  assert.equal(researchQuietNoticeHiddenOn("/books"), false);
  assert.equal(researchQuietNoticeHiddenOn("/lab"), true);
  assert.equal(researchQuietNoticeHiddenOn("/training"), true);
  assert.equal(researchQuietNoticeHiddenOn("/training/wick"), true);
  assert.equal(researchQuietNoticeHiddenOn("/legal"), true);
});
