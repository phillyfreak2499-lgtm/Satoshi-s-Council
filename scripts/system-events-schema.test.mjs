/**
 * Phase 1A schema: desk_system_events applies, is idempotent, insert-once,
 * and the public reader never returns a private row.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "migrations");

async function files() {
  return (await readdir(MIGRATIONS, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

async function freshDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  return new PGlite();
}

async function applyAll(db) {
  for (const name of await files()) {
    const sql = await readFile(join(MIGRATIONS, name), "utf8");
    await db.exec(sql);
  }
}

test("0030 is in the migration directory", async () => {
  const names = await files();
  assert.ok(names.includes("0030_desk_system_events.sql"));
});

test("desk_system_events exists after apply, and apply is idempotent", async () => {
  const db = await freshDb();
  await applyAll(db);
  await applyAll(db);
  const { rows } = await db.query(
    "select table_name from information_schema.tables where table_name = 'desk_system_events'",
  );
  assert.equal(rows.length, 1);
  await db.close();
});

test("valid insert, duplicate event_key does not duplicate, invalid type/character rejected", async () => {
  const db = await freshDb();
  await applyAll(db);
  const ins = `insert into desk_system_events
    (event_key, event_type, character, occurred_at, source_type, source_id, payload, public)
    values ($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7)
    on conflict (event_key) do nothing`;
  await db.query(ins, [
    "desk-update:demo-1",
    "DESK_UPDATE",
    "DESK",
    "2026-09-12T19:00:00Z",
    "desk_update",
    "demo-1",
    true,
  ]);
  await db.query(ins, [
    "desk-update:demo-1",
    "DESK_UPDATE",
    "DESK",
    "2026-09-12T20:00:00Z",
    "desk_update",
    "demo-1-again",
    true,
  ]);
  const all = await db.query("select count(*)::int as n from desk_system_events");
  assert.equal(all.rows[0].n, 1);

  await assert.rejects(
    db.query(ins, ["bad-type", "CHAIR_VIBES", "DESK", "2026-09-12T19:00:00Z", "desk_update", "x", true]),
  );
  await assert.rejects(
    db.query(ins, ["bad-char", "DESK_UPDATE", "PIT_CREW", "2026-09-12T19:00:00Z", "desk_update", "x", true]),
  );
  await db.close();
});

test("public reader excludes private events and orders newest first", async () => {
  const db = await freshDb();
  await applyAll(db);
  const ins = `insert into desk_system_events
    (event_key, event_type, character, occurred_at, source_type, source_id, payload, public)
    values ($1,'DESK_UPDATE','DESK',$2,'desk_update',$1,'{}'::jsonb,$3)`;
  await db.query(ins, ["pub-old", "2026-09-12T18:00:00Z", true]);
  await db.query(ins, ["priv", "2026-09-12T19:00:00Z", false]);
  await db.query(ins, ["pub-new", "2026-09-12T20:00:00Z", true]);
  const { rows } = await db.query(
    `select event_key from desk_system_events where public = true order by occurred_at desc, id desc`,
  );
  assert.deepEqual(
    rows.map((r) => r.event_key),
    ["pub-new", "pub-old"],
  );
  await db.close();
});
