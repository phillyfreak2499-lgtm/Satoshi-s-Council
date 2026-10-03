import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const implementation = [...readdirSync(new URL("../src/lib/spot-lab/", import.meta.url)).filter(name => !name.endsWith(".test.ts")).map(name => `src/lib/spot-lab/${name}`), "src/routes/lab.spot.tsx", "src/routes/lab_.spot.tsx", "server/plugins/spot-lab.ts", "migrations/0077_spot_signal_lab_v1.sql"];
test("spot lab cannot reference public decision internals, financial execution or credentials", () => {
  const forbidden = /\b(?:desk_ledger|desk_hour_ledger|desk_lab_\w*|chair|learner|seats?|bots?|follower|wallet|withdraw\w*|deposit\w*)\b|(?:api[_-]?key|secret[_-]?key|private[_-]?key)|\b(?:signTransaction|createOrder|submitOrder|placeOrder|goLive)\b|\/(?:orders?|sign|wallet|withdraw|deposit)\b/i;
  for(const path of implementation) {
    const content = read(path);assert.doesNotMatch(content,forbidden,path);
    const urls=content.match(/https?:\/\/[^"'\s)]+/g)??[];
    for(const url of urls)assert.equal(url,"https://api.exchange.coinbase.com/products/BTC-USD/ticker",path);
    for(const match of content.matchAll(/(?:from\s*|import\s*\()\s*["'](@\/[^"']+)["']/g))assert.ok(match[1]==="@/lib/db" || match[1].startsWith("@/lib/spot-lab/"),`${path}: ${match[1]}`);
  }
  for(const name of ["signal-v1.ts","ledger.ts"])assert.doesNotMatch(read(`src/lib/spot-lab/${name}`),/Date\.now|Math\.random|\bfetch\s*\(|\bdb\b|@\/lib\/db/);
  assert.match(read("src/lib/spot-lab/signal-v1.ts"),/AUTHORITY = "none"/);
});
test("protected files cannot depend on this lab or its tables; hidden surface is not linked", () => {
  const paths=["src/lib/desk/server-engine.ts","src/lib/desk/chair.ts","src/lib/desk/learner.ts","src/lib/desk/books.server.ts","src/routes/lab.tsx","src/routes/__root.tsx","src/routes/faq.tsx","src/components/desk/LabRoom.tsx","src/routes/books.tsx","src/routes/floor.tsx","src/routes/chamber.tsx","src/lib/desk/navigation.ts","src/lib/desk/site.server.ts","server/routes/sitemap.xml.get.ts","render.yaml","Procfile","startup.sh"];
  for(const path of paths)if(existsSync(new URL(`../${path}`,import.meta.url)))assert.doesNotMatch(read(path),/spot-lab|spot_prices_1m|paper_spot_trades|spot_signal_versions|\/lab\/spot/,path);
  assert.match(read("src/routes/lab_.spot.tsx"),/noindex, nofollow/);
  assert.match(read("src/routes/lab.spot.tsx"),/Paper research — not financial advice\. Signals only\./);
  assert.match(read("src/routes/lab_.spot.tsx"),/createFileRoute\("\/lab_\/spot"\)/);
  assert.match(read("server/plugins/spot-lab.ts"),/if \(process\.env\.SPOT_LAB !== "1"\) return/);
  assert.doesNotMatch(read("server/plugins/spot-lab.ts"),/\bawait\b/);
});
test("migration creates only isolated tables, no views/FKs or seed trades", () => {
  const migration=read("migrations/0077_spot_signal_lab_v1.sql");
  assert.deepEqual([...migration.matchAll(/create table if not exists (\w+)/gi)].map(m=>m[1]),["spot_prices_1m","paper_spot_trades","spot_signal_versions"]);
  assert.doesNotMatch(migration,/\breferences\b|\bcreate\s+(?:or\s+replace\s+)?view\b/i);
  const schema=migration.split("create or replace function")[0];
  assert.doesNotMatch(schema,/insert\s+into\s+paper_spot_trades/i);
  assert.match(schema,/insert into spot_signal_versions.*spot-signal-v1.*active/i);
});
test("spot lab math, causal timing, real SQL and fail-open contracts actually execute", () => {
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.DATABASE_URL;delete env.SPOT_LAB;
  const result=spawnSync(process.execPath,["--experimental-strip-types","--test","src/lib/spot-lab/spot-lab.test.ts"],{encoding:"utf8",env,timeout:90000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/tests 23\b/,"all 23 lab contracts must run");
});
