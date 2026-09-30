import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// Run the actual production subscribe function and its SQL against disposable
// PostgreSQL. No live database, endpoint, credentials, or provider calls.
const source = readFileSync(new URL("../src/lib/desk/push.server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("push.server.ts", source, ts.ScriptTarget.Latest, true);
const picked = ["cleanEndpoint", "cleanKey", "subscribePush"].map((name) => {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `missing production function ${name}`);
  return declaration.getText(ast).replace(/^export /, "");
}).join("\n");
const compiled = ts.transpileModule(picked, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test("subscription upsert retains owner only for identical delivery keys", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table desk_push_subs (
      endpoint text primary key, p256dh text not null, auth text not null,
      token text, on_call boolean, on_settle boolean, ua text,
      owner boolean not null default false, last_seen timestamptz, fails int default 0
    )`);
    const db = async (strings, ...values) => {
      const sql = strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ""), "");
      return (await pg.query(sql, values)).rows;
    };
    const subscribe = new Function("sql", "TOKEN_RE", `${compiled}\nreturn subscribePush;`)(
      async () => db, /^[A-Za-z0-9\-_]{16,64}$/,
    );
    const endpoint = "https://push.invalid/disposable-test";
    const input = (p256dh = "publickeyAAA", auth = "authkeyAAA") => ({
      subscription: { endpoint, keys: { p256dh, auth } }, on_call: true, on_settle: true,
    });
    assert.equal((await subscribe(input())).prefs.owner, false, "public enrollment cannot acquire owner");
    await pg.query("update desk_push_subs set owner=true, fails=7 where endpoint=$1", [endpoint]);
    assert.equal((await subscribe(input())).prefs.owner, true, "same keys preserve authenticated enrollment");
    assert.equal((await subscribe(input("publickeyBBB"))).prefs.owner, false, "public key rotation clears owner atomically");
    assert.equal((await subscribe(input("publickeyBBB"))).prefs.owner, false, "repeated public enrollment cannot restore owner");
    await pg.query("update desk_push_subs set owner=true where endpoint=$1", [endpoint]);
    assert.equal((await subscribe(input("publickeyBBB", "authkeyBBB"))).prefs.owner, false, "auth key rotation independently clears owner");
    const row = (await pg.query("select owner,on_call,on_settle,fails from desk_push_subs")).rows[0];
    assert.deepEqual(row, { owner: false, on_call: true, on_settle: true, fails: 0 }, "public choices and normal failure reset remain intact");
  } finally {
    await pg.close();
  }
});
