import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const req = (id) =>
      id in overrides
        ? overrides[id]
        : id.startsWith(".")
          ? load(resolve(dirname(file), /\.tsx?$/.test(id) ? id : id + ".ts"))
          : require(id);
    new Function("require", "module", "exports", code)(req, mod, mod.exports);
    return mod.exports;
  };
}
const build = "a".repeat(40),
  nextBuild = "b".repeat(40);
const verification = loader()("src/lib/desk/alert-verification.server.ts");
const migration = readFileSync("migrations/0069_directional_regret.sql", "utf8");
async function fixture() {
  const pg = new PGlite();
  for (const p of [
    "0015_desk_push.sql",
    "0018_desk_push_owner.sql",
    "0066_desk_push_delivery_receipts.sql",
  ])
    await pg.exec(readFileSync("migrations/" + p, "utf8"));
  const db = async (strings, ...args) =>
    (
      await pg.query(
        strings.reduce((s, p, i) => s + p + (i < args.length ? "$" + (i + 1) : ""), ""),
        args,
      )
    ).rows;
  await pg.exec(`insert into desk_push_subs(endpoint,p256dh,auth,owner,on_call,on_settle,fails) values
 ('https://push.invalid/owner','ownerkeyAAA','ownerauthAAA',true,true,true,0),
 ('https://push.invalid/public','publickeyAAA','publicauthAAA',false,true,true,0),
 ('https://push.invalid/owner2','ownerkeyBBB','ownerauthBBB',true,true,true,0)`);
  return { pg, db };
}
const ownerInput = (action, extra = {}) => ({
  action,
  endpoint: "https://push.invalid/owner",
  ...extra,
});
const accepted = { outcome: "accepted", statusCode: 201, errorCode: null };

test("0069 creates only new tables/indexes; existing schema/rows/constraint untouched and transaction failure rolls back everything", async () => {
  const { pg } = await fixture();
  try {
    await pg.exec(
      "insert into desk_push_delivery_receipts(event_kind,event_key,subscription_id,outcome) select kind,'retained-fixture',1,'accepted' from unnest(array['call','settle','watchdog','test']) kind",
    );
    const statements = migration
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(statements.every((s) => /^create (table|index) if not exists\b/i.test(s)));
    const before = {
      receipts: (await pg.query("select * from desk_push_delivery_receipts order by id")).rows,
      subs: (await pg.query("select * from desk_push_subs order by id")).rows,
      columns: (
        await pg.query(
          "select column_name,data_type,column_default,is_nullable from information_schema.columns where table_name='desk_push_subs' order by ordinal_position",
        )
      ).rows,
      constraints: (
        await pg.query(
          "select conname,pg_get_constraintdef(oid) as def from pg_constraint where conrelid='desk_push_delivery_receipts'::regclass order by conname",
        )
      ).rows,
    };
    await pg.exec("create table _migrations(name text primary key)");
    await pg.exec("begin");
    await pg.exec(migration);
    await pg.exec("insert into _migrations values('0069_directional_regret.sql')");
    await assert.rejects(pg.exec("select 1/0"));
    await pg.exec("rollback");
    assert.equal((await pg.query("select to_regclass('desk_alert_rollout') as t")).rows[0].t, null);
    assert.equal((await pg.query("select count(*)::int as n from _migrations")).rows[0].n, 0);
    await pg.exec(migration);
    await pg.exec(migration);
    assert.deepEqual(
      (await pg.query("select * from desk_push_delivery_receipts order by id")).rows,
      before.receipts,
    );
    assert.deepEqual(
      (await pg.query("select * from desk_push_subs order by id")).rows,
      before.subs,
    );
    assert.deepEqual(
      (
        await pg.query(
          "select column_name,data_type,column_default,is_nullable from information_schema.columns where table_name='desk_push_subs' order by ordinal_position",
        )
      ).rows,
      before.columns,
    );
    assert.deepEqual(
      (
        await pg.query(
          "select conname,pg_get_constraintdef(oid) as def from pg_constraint where conrelid='desk_push_delivery_receipts'::regclass order by conname",
        )
      ).rows,
      before.constraints,
    );
    assert.equal(
      (await pg.query("select count(*)::int as n from desk_alert_rollout")).rows[0].n,
      0,
    );
    await assert.rejects(
      pg.exec(
        "insert into desk_push_delivery_receipts(event_kind,event_key,subscription_id,outcome) values('read','wrong-table',1,'accepted')",
      ),
    );
  } finally {
    await pg.close();
  }
});

test("owner two-tier verification: no public sends or legacy receipts; exact fixtures, acceptance plus display confirmation, hold/restart/new-build/rekey gates", async () => {
  const { pg, db } = await fixture();
  try {
    await pg.exec(migration);
    const sends = [];
    const send = async (sub, payload) => {
      sends.push({ sub, payload });
      return accepted;
    };
    const v = (action, extra = {}) =>
      verification.ownerVerification(db, send, build, ownerInput(action, extra));
    const before = (await pg.query("select * from desk_push_subs order by id")).rows;
    assert.equal(await verification.rolloutReady(db, build), false);
    assert.equal(await verification.rolloutReady(db, ""), false);
    assert.equal((await v("verify")).ok, false, "fixtures require acknowledgement");
    assert.equal(
      (
        await verification.ownerVerification(db, send, build, {
          action: "verify",
          endpoint: "https://push.invalid/public",
          confirm_test_fixtures: true,
        })
      ).status,
      403,
    );
    assert.equal(sends.length, 0);
    const attempt = await v("verify", { confirm_test_fixtures: true });
    assert.equal(sends.length, 2);
    assert.ok(sends.every((s) => s.sub.endpoint === "https://push.invalid/owner"));
    assert.equal(sends[0].payload.title, "PAPER POSITION BOOKED · UP");
    assert.match(sends[0].payload.body, /Paper UP position booked at 83¢/);
    assert.equal(sends[1].payload.title, "DIRECTIONAL READ ONLY · DOWN");
    assert.match(sends[1].payload.body, /75¢ ask is below the 80¢ paper floor/);
    assert.notEqual(sends[0].payload.badge, sends[1].payload.badge);
    assert.ok(sends.every((s) => s.payload.tag.startsWith("verify-")));
    assert.equal(
      await verification.rolloutReady(db, build),
      false,
      "provider acceptance cannot release",
    );
    assert.equal((await v("release", { verification_id: attempt.verification_id })).ok, false);
    assert.equal(
      (
        await verification.ownerVerification(db, send, build, {
          ...ownerInput("release", {
            verification_id: attempt.verification_id,
            confirm_device_display: true,
          }),
          endpoint: "https://push.invalid/owner2",
        })
      ).ok,
      false,
      "another device cannot approve this attempt",
    );
    assert.equal(
      (
        await v("release", {
          verification_id: attempt.verification_id,
          confirm_device_display: true,
        })
      ).held,
      false,
    );
    assert.equal(
      await verification.rolloutReady(db, build),
      true,
      "release survives process restart",
    );
    assert.equal(
      await verification.rolloutReady(db, nextBuild),
      false,
      "new deployed head must be verified again",
    );
    assert.deepEqual(
      (await pg.query("select * from desk_push_subs order by id")).rows,
      before,
      "verification never changes outage eligibility",
    );
    assert.equal(
      (await pg.query("select count(*)::int as n from desk_push_delivery_receipts")).rows[0].n,
      0,
      "test acceptance cannot become owner call readiness",
    );
    await pg.exec("update desk_push_subs set p256dh='rotatedkeyAAA' where id=1");
    assert.equal(await verification.rolloutReady(db, build), false);
    assert.equal(
      (
        await v("release", {
          verification_id: attempt.verification_id,
          confirm_device_display: true,
        })
      ).ok,
      false,
    );
    await pg.exec("update desk_push_subs set p256dh='ownerkeyAAA',owner=false where id=1");
    assert.equal(await verification.rolloutReady(db, build), false);
    await pg.exec("update desk_push_subs set owner=true,fails=8 where id=1");
    assert.equal(await verification.rolloutReady(db, build), false);
    await pg.exec("update desk_push_subs set fails=0 where id=1");
    assert.equal((await v("hold")).held, true);
    assert.equal(await verification.rolloutReady(db, build), false);
  } finally {
    await pg.close();
  }
});

test("failed/expired/unrecorded verification cannot release, and retesting revokes an earlier release", async () => {
  const { pg, db } = await fixture();
  try {
    await pg.exec(migration);
    let n = 0;
    const partial = await verification.ownerVerification(
      db,
      async () =>
        ++n === 1 ? accepted : { outcome: "failed", statusCode: 500, errorCode: "fixture" },
      build,
      ownerInput("verify", { confirm_test_fixtures: true }),
    );
    const release = (id) =>
      verification.ownerVerification(
        db,
        async () => accepted,
        build,
        ownerInput("release", { verification_id: id, confirm_device_display: true }),
      );
    assert.equal((await release(partial.verification_id)).ok, false);
    const good = await verification.ownerVerification(
      db,
      async () => accepted,
      build,
      ownerInput("verify", { confirm_test_fixtures: true }),
    );
    await pg.query(
      "update desk_alert_verification_attempts set expires_at=now()-interval '1 second' where id=$1",
      [good.verification_id],
    );
    assert.equal((await release(good.verification_id)).ok, false);
    const current = await verification.ownerVerification(
      db,
      async () => accepted,
      build,
      ownerInput("verify", { confirm_test_fixtures: true }),
    );
    assert.equal((await release(current.verification_id)).held, false);
    const failedSql = async (strings, ...args) => {
      if (strings.join("").includes("insert into desk_alert_verification_receipts"))
        throw Error("DB fixture failure");
      return db(strings, ...args);
    };
    await assert.rejects(
      verification.ownerVerification(
        failedSql,
        async () => accepted,
        build,
        ownerInput("verify", { confirm_test_fixtures: true }),
      ),
    );
    assert.equal(
      await verification.rolloutReady(db, build),
      false,
      "retest closes gate before a receipt failure",
    );
  } finally {
    await pg.close();
  }
});

test("real paper/read dispatch is held until owner verification; watchdog still reaches owner; read receipts use only new table", async () => {
  const old = process.env.RENDER_GIT_COMMIT;
  process.env.RENDER_GIT_COMMIT = build;
  const { pg, db } = await fixture();
  try {
    await pg.exec(migration);
    await pg.exec(
      "insert into desk_push_keys(id,public_key,private_key) values('vapid','fixture-public','fixture-private'); insert into desk_push_read_prefs values(2,true)",
    );
    const sends = [];
    const push = loader({
      "@/lib/db": { getSql: async () => db },
      "web-push": {
        default: {
          sendNotification: async (sub, payload) => {
            sends.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
            return { statusCode: 201 };
          },
        },
      },
    })("src/lib/desk/push.server.ts");
    assert.deepEqual(await push.pushPrefsFor("https://push.invalid/owner"), {
      on_call: true,
      on_settle: true,
      owner: true,
      on_read: false,
    });
    assert.equal(
      (await push.setOwnerPush("https://push.invalid/owner", true)).prefs.on_read,
      false,
    );
    const flush = () => new Promise((r) => setTimeout(r, 30));
    push.notifyCall("UP", 83, 5, "held");
    await push.notifyDirectionalRead("DOWN", "below floor", Date.now() + 300000, "held");
    await flush();
    assert.equal(sends.length, 0);
    push.notifyWatchdog({
      title: "Existing watchdog fixture",
      body: "fixture",
      tag: "watchdog-fixture",
    });
    await flush();
    assert.equal(sends.length, 2, "both owner watchdog subscribers remain reachable during hold");
    assert.ok(sends.every((s) => s.endpoint !== "https://push.invalid/public"));
    const attempt = await push.ownerAlertVerification(
      ownerInput("verify", { confirm_test_fixtures: true }),
    );
    assert.equal(attempt.held, true);
    assert.equal(sends.length, 4, "exactly two fixtures, one owner device");
    assert.equal(
      (
        await push.ownerAlertVerification(
          ownerInput("release", {
            verification_id: attempt.verification_id,
            confirm_device_display: true,
          }),
        )
      ).held,
      false,
    );
    push.notifyCall("UP", 83, 5, "released");
    await flush();
    assert.equal(sends.filter((s) => s.payload.tag === "call-released").length, 3);
    await push.notifyDirectionalRead(
      "DOWN",
      "75¢ ask is below the 80¢ paper floor",
      Date.now() + 300000,
      "released",
    );
    assert.equal(sends.filter((s) => s.payload.tag === "read-released-DOWN").length, 1);
    assert.equal(
      (
        await pg.query(
          "select count(*)::int as n from desk_push_delivery_receipts where event_kind='read'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await pg.query("select count(*)::int as n from desk_directional_read_receipts")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await pg.query(
          "select count(*)::int as n from desk_push_delivery_receipts where event_kind='call'",
        )
      ).rows[0].n,
      3,
    );
    await push.ownerAlertVerification(ownerInput("hold"));
    const count = sends.length;
    push.notifyCall("DOWN", 85, 5, "held-again");
    await flush();
    assert.equal(sends.length, count);
    const brokenPush = loader({
      "@/lib/db": {
        getSql: async () => {
          throw Error("SQL unavailable");
        },
      },
      "web-push": {
        default: {
          sendNotification: async () => {
            throw Error("must not send");
          },
        },
      },
    })("src/lib/desk/push.server.ts");
    brokenPush.notifyCall("UP", 83, 5, "failed-proof");
    await brokenPush.notifyDirectionalRead(
      "DOWN",
      "below floor",
      Date.now() + 300000,
      "failed-proof",
    );
    await flush();
    assert.equal(
      sends.length,
      count,
      "missing durable proof fails closed for both production tiers",
    );
  } finally {
    await pg.close();
    if (old === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = old;
  }
});

test("verification route rejects missing/wrong admin key before invoking any push path", async () => {
  const old = process.env.DESK_ADMIN_KEY;
  process.env.DESK_ADMIN_KEY = "fixture-admin";
  try {
    let calls = 0;
    const route = loader({
      "../../../src/lib/desk/admin.server": { adminKeyOk: (k) => k === "fixture-admin" },
      "../../../src/lib/desk/push.server": {
        ownerAlertVerification: async () => {
          calls++;
          return { ok: true, held: true };
        },
      },
    })("server/routes/api/alert-verification.post.ts").default;
    for (const key of [undefined, "wrong"])
      assert.equal(
        (
          await route({
            req: new Request("https://example.invalid", {
              method: "POST",
              body: JSON.stringify({ key, action: "verify" }),
            }),
          })
        ).status,
        401,
      );
    assert.equal(calls, 0);
    assert.equal(
      (
        await route({
          req: new Request("https://example.invalid", {
            method: "POST",
            body: JSON.stringify({ key: "fixture-admin", action: "status" }),
          }),
        })
      ).status,
      200,
    );
    assert.equal(calls, 1);
    delete process.env.DESK_ADMIN_KEY;
    assert.equal(
      (await route({ req: new Request("https://example.invalid", { method: "POST", body: "{}" }) }))
        .status,
      503,
    );
  } finally {
    if (old === undefined) delete process.env.DESK_ADMIN_KEY;
    else process.env.DESK_ADMIN_KEY = old;
  }
});

function shape(n) {
  if (ts.isParenthesizedExpression(n)) return shape(n.expression);
  const children = [];
  ts.forEachChild(n, (c) => {
    children.push(shape(c));
  });
  return [
    n.kind,
    ts.isIdentifier(n) ||
    ts.isStringLiteral(n) ||
    ts.isNumericLiteral(n) ||
    ts.isTemplateLiteralToken(n)
      ? n.text
      : null,
    children,
  ];
}
test("outage trigger and delivery semantics are unchanged from pre-PR production; owner hold controls are hidden from public rendering", () => {
  // Pin the pre-PR source: this commit exists in CI checkout history only after fetch.
  // Store hashes of the production AST instead of requiring git history in a shallow CI checkout.
  const baseline = JSON.parse(readFileSync("scripts/fixtures/alert-outage-baseline.json", "utf8"));
  const hash = require("node:crypto").createHash;
  for (const { path, names } of baseline.functions) {
    const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const [name, digest] of Object.entries(names)) {
      const n = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
      const allowed = Array.isArray(digest) ? digest : [digest];
      assert.ok(
        allowed.includes(
          hash("sha256")
            .update(JSON.stringify(shape(n)))
            .digest("hex"),
        ),
        name,
      );
    }
  }
  const ui = loader({
    "@/lib/desk/push": {
      pushSupported: () => true,
      pushPermission: () => "granted",
      currentPrefs: async () => null,
      needsHomeScreen: () => false,
    },
    "@/lib/desk/engine": { getAdminKey: () => null },
    "./Tip": { Tip: () => null },
  })("src/components/desk/AlertsPanel.tsx");
  const React = require("react"),
    { renderToStaticMarkup } = require("react-dom/server");
  const publicHtml = renderToStaticMarkup(
    React.createElement(ui.AlertsPanel, { ownerMode: false }),
  );
  const ownerHtml = renderToStaticMarkup(React.createElement(ui.AlertsPanel, { ownerMode: true }));
  assert.doesNotMatch(
    publicHtml,
    /Test both tiers on this owner device|Confirm display and release subscriber tiers/,
  );
  assert.match(ownerHtml, /Test both tiers on this owner device/);
  assert.match(ownerHtml, /filled BOOKED square versus hollow READ ONLY diamond/);
});

test("subscriber settlements require exact-build owner device verification, fail closed and stop after rekey", async()=>{
 const old=process.env.RENDER_GIT_COMMIT;process.env.RENDER_GIT_COMMIT=build;const {pg,db}=await fixture();
 try{
  await pg.exec(migration);await pg.exec("insert into desk_push_keys(id,public_key,private_key) values('vapid','fixture-public','fixture-private')");
  const sends=[];const overrides={"@/lib/db":{getSql:async()=>db},"web-push":{default:{sendNotification:async(sub,payload)=>{sends.push({endpoint:sub.endpoint,payload:JSON.parse(payload)});return{statusCode:201};}}}};
  const push=loader(overrides)("src/lib/desk/push.server.ts");const flush=()=>new Promise(r=>setTimeout(r,50));const chair={entry:83,settle:100,ev:15};
  push.notifySettle("held-settle","UP",chair,new Map());await flush();assert.equal(sends.length,0);
  const attempt=await push.ownerAlertVerification(ownerInput("verify",{confirm_test_fixtures:true}));assert.equal(sends.length,2);
  push.notifySettle("unconfirmed-settle","UP",chair,new Map());await flush();assert.equal(sends.length,2);
  await push.ownerAlertVerification(ownerInput("release",{verification_id:attempt.verification_id,confirm_device_display:true}));
  push.notifySettle("verified-settle","UP",chair,new Map());await flush();assert.equal(sends.filter(s=>s.payload.tag==="settle-verified-settle").length,3);
  assert.equal((await pg.query("select count(*)::int n from desk_push_delivery_receipts where event_kind='settle'")).rows[0].n,3);
  process.env.RENDER_GIT_COMMIT=nextBuild;const next=loader(overrides)("src/lib/desk/push.server.ts");const before=sends.length;next.notifySettle("next-build-held","UP",chair,new Map());await flush();assert.equal(sends.length,before);
  await pg.exec("update desk_push_subs set p256dh='rekeyed-device' where endpoint='https://push.invalid/owner'");push.notifySettle("rekey-held","UP",chair,new Map());await flush();assert.equal(sends.length,before);
  const broken=loader({...overrides,"@/lib/db":{getSql:async()=>{throw Error("SQL unavailable");}}})("src/lib/desk/push.server.ts");broken.notifySettle("sql-held","UP",chair,new Map());await flush();assert.equal(sends.length,before);
 }finally{await pg.close();if(old===undefined)delete process.env.RENDER_GIT_COMMIT;else process.env.RENDER_GIT_COMMIT=old;}
});
