import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const openDbs = new Set();

test.afterEach(async () => {
  for (const pg of openDbs) await pg.close();
  openDbs.clear();
});

function loadHelper(sql) {
  const exports = {};
  const source = ts.transpileModule(read("src/lib/desk/openai-capture-job.server.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (key) => {
      if (key === "@/lib/db") return { getSql: async () => sql };
      if (key === "node:crypto") return { createHash };
      throw new Error(`unexpected dependency ${key}`);
    },
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    String,
  });
  return exports;
}

async function fixture() {
  const pg = new PGlite();
  openDbs.add(pg);
  await pg.exec(read("migrations/0052_openai_capture_jobs.sql"));
  const sql = async (strings, ...values) => {
    let query = "";
    for (let i = 0; i < strings.length; i++) {
      query += strings[i];
      if (i < values.length) query += `$${i + 1}`;
    }
    return (await pg.query(query, values)).rows;
  };
  return { pg, sql, jobs: loadHelper(sql) };
}

test("Shadow scans durable recovery before relying on the live frame", () => {
  const observer = read("src/lib/desk/openai-shadow.server.ts");
  assert.match(observer, /const RECOVERY_SCAN_MS = 15_000/);
  const start = observer.indexOf("async function captureOnce");
  const end = observer.indexOf("export function ensureOpenAIShadowObserver", start);
  const capture = observer.slice(start, end);
  const recovery = capture.indexOf("await nextRecoverableOpenAIJob");
  const frame = capture.indexOf('await import("./server-engine")');
  assert.ok(recovery >= 0 && frame >= 0 && recovery < frame, "durable recovery must precede a fresh live-frame read");
  assert.match(capture, /Date\.now\(\) - st\.lastRecoveryScanAt >= RECOVERY_SCAN_MS/);
});

test("packet hash is stable across jsonb key reordering", async () => {
  const { jobs } = await fixture();
  const a = { z: 1, a: { y: 2, x: [3, { b: 4, a: 5 }] } };
  const b = { a: { x: [3, { a: 5, b: 4 }], y: 2 }, z: 1 };
  assert.equal(jobs.openAICaptureHash(a), jobs.openAICaptureHash(b));
});

const base = (patch = {}) => {
  const close = Date.parse("2099-01-01T00:15:00Z");
  return {
    study: "OPENAI_SHADOW_V1",
    version: 1,
    ticker: "KXBTC15M-99JAN010015-15",
    close_ms: close,
    frozen_ms: close - 445_000,
    secs_left: 445,
    prompt_version: "market-aware-v1",
    model: "gpt-test",
    input_hash: "hash-a",
    input_packet: { protocol: "OPENAI_SHADOW_V1", market: { yes_mid: 60 }, council: [] },
    market_p: 0.6,
    fair_p: 0.62,
    chair_lean: "WAIT",
    yes_ask: 61,
    no_ask: 40,
    build_sha: "abc123",
    ...patch,
  };
};

test("first frozen packet wins and a lease prevents duplicate model requests", async () => {
  const { jobs } = await fixture();
  const first = await jobs.freezeOpenAICaptureJob(base());
  const second = await jobs.freezeOpenAICaptureJob(
    base({ input_hash: "hash-b", input_packet: { protocol: "later-frame" } }),
  );
  assert.equal(first.input_hash, "hash-a");
  assert.equal(second.input_hash, "hash-a");
  assert.equal(second.input_packet.protocol, "OPENAI_SHADOW_V1");

  const claimed = await jobs.claimOpenAICaptureJob(first);
  assert.ok(claimed);
  assert.equal(claimed.attempts, 1);
  assert.equal(await jobs.claimOpenAICaptureJob(first), null, "active lease blocks a second caller");
});

test("a pre-close result becomes durable before final ledger completion", async () => {
  const { jobs } = await fixture();
  const frozen = await jobs.freezeOpenAICaptureJob(base());
  const claimed = await jobs.claimOpenAICaptureJob(frozen);
  assert.ok(claimed);

  const saved = await jobs.saveOpenAICaptureResult(claimed, {
    result: {
      p_up: 0.64,
      side: "UP",
      conviction: 70,
      regime: "trend",
      strongest_evidence: ["ret15"],
      contradictions: [],
      data_quality: "GOOD",
      would_abstain: false,
    },
    response_id: "resp_1",
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    latency_ms: 900,
  });
  assert.equal(saved, true);

  const ready = await jobs.readOpenAICaptureJob(
    frozen.study,
    frozen.version,
    frozen.ticker,
    frozen.close_ms,
  );
  assert.equal(ready.status, "result_ready");
  assert.equal(ready.result.side, "UP");
  assert.ok(ready.result_ms < ready.close_ms);

  await jobs.completeOpenAICaptureJob(ready);
  const complete = await jobs.readOpenAICaptureJob(
    ready.study,
    ready.version,
    ready.ticker,
    ready.close_ms,
  );
  assert.equal(complete.status, "completed");
  assert.equal(await jobs.nextRecoverableOpenAIJob(ready.study, ready.version), null);
});

test("recovery expires unfulfilled past jobs but keeps pre-close answers finalizable", async () => {
  const { pg, jobs } = await fixture();
  const pastClose = new Date(Date.now() - 60_000);
  const frozen = new Date(pastClose.getTime() - 445_000);
  const created = new Date(pastClose.getTime() - 440_000);
  const resultAt = new Date(pastClose.getTime() - 30_000);

  await pg.query(
    `insert into desk_openai_capture_jobs
      (study,version,ticker,close_time,frozen_at,secs_left,prompt_version,model,input_hash,input_packet,
       market_p,fair_p,chair_lean,yes_ask,no_ask,status,created_at)
     values ('OPENAI_SHADOW_V1',1,'PENDING-PAST',$1,$2,445,'market-aware-v1','gpt-test','p',
             '{"protocol":"OPENAI_SHADOW_V1"}'::jsonb,.5,.5,'WAIT',51,50,'pending',$3)`,
    [pastClose.toISOString(), frozen.toISOString(), created.toISOString()],
  );

  await pg.query(
    `insert into desk_openai_capture_jobs
      (study,version,ticker,close_time,frozen_at,secs_left,prompt_version,model,input_hash,input_packet,
       market_p,fair_p,chair_lean,yes_ask,no_ask,status,result,response_id,result_at,latency_ms,created_at)
     values ('OPENAI_SHADOW_V1',1,'READY-PAST',$1,$2,445,'market-aware-v1','gpt-test','r',
             '{"protocol":"OPENAI_SHADOW_V1"}'::jsonb,.5,.5,'WAIT',51,50,'result_ready',
             '{"p_up":0.6,"side":"UP"}'::jsonb,'resp',$3,100,$4)`,
    [pastClose.toISOString(), frozen.toISOString(), resultAt.toISOString(), created.toISOString()],
  );

  const recovered = await jobs.nextRecoverableOpenAIJob("OPENAI_SHADOW_V1", 1);
  assert.equal(recovered.ticker, "READY-PAST", "stored pre-close answer survives a process restart after close");

  const expired = await pg.query(
    "select status from desk_openai_capture_jobs where ticker='PENDING-PAST'",
  );
  assert.equal(expired.rows[0].status, "expired");
});

test("database structurally refuses market data inside a blind packet", async () => {
  const { pg } = await fixture();
  const close = new Date("2099-01-01T00:15:00Z");
  const frozen = new Date(close.getTime() - 445_000);
  await assert.rejects(
    pg.query(
      `insert into desk_openai_capture_jobs
        (study,version,ticker,close_time,frozen_at,secs_left,prompt_version,model,input_hash,input_packet,
         market_p,fair_p,chair_lean,yes_ask,no_ask)
       values ('OPENAI_BLIND_V1',1,'BLIND-BAD',$1,$2,445,'blind-marketless-v1','gpt-test','x',
               '{"market":{"yes_mid":60}}'::jsonb,.6,.6,'WAIT',61,40)`,
      [close.toISOString(), frozen.toISOString()],
    ),
  );
});
