#!/usr/bin/env node
/** Manual code-preparation artifact. Default is an offline, zero-write preview. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { VENUE_PAUSE_REGISTRATION } from "../src/lib/desk/venue-pause-registration.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
type Manifest = { sources: { path: string; sha256: string }[]; entries: unknown[] };
type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export function checkedManifest() {
  const dir = resolve(root, "docs/ledger-repair");
  const bytes = readFileSync(resolve(dir, "venue-pause-manifest.json"));
  if (digest(bytes) !== VENUE_PAUSE_REGISTRATION.manifest_sha256) throw new Error("manifest hash mismatch");
  const manifest = JSON.parse(bytes.toString()) as Manifest;
  for (const source of manifest.sources) {
    const path = resolve(dir, source.path);
    if (!path.startsWith(`${dir}/evidence/`) || digest(readFileSync(path)) !== source.sha256) throw new Error("evidence hash mismatch");
  }
  // The reviewed manifest and executable registration must remain identical.
  if (JSON.stringify(manifest.entries) !== JSON.stringify(VENUE_PAUSE_REGISTRATION.entries)) throw new Error("registration mismatch");
  return manifest;
}

export function parseApproval(argv: string[]) {
  let apply = false, integrity = false, dryRun = false, approval = "", hash = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--apply-integrity-effect") integrity = true;
    else if (arg === "--owner-approval-id" || arg === "--manifest-sha256") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing ${arg} value`);
      if (arg === "--owner-approval-id") approval = value.trim(); else hash = value;
    } else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (apply && (!approval || hash !== VENUE_PAUSE_REGISTRATION.manifest_sha256)) throw new Error("execution needs explicit owner approval ID and exact reviewed manifest hash");
  if (apply && dryRun) throw new Error("dry run cannot be combined with execution");
  if (integrity && !apply) throw new Error("integrity effect requires separately approved execution");
  return { apply, integrity, approval, hash };
}

/** One transaction, insert-only, with read-back equality. No grading consumers. */
export async function appendClassifications(db: Db, approval: string, integrity: boolean) {
  checkedManifest();
  if (!approval.trim()) throw new Error("owner approval ID required");
  const effect = integrity ? "EXCLUDE_FROM_MISSING_CONTRACT_COUNT" : "NONE";
  const expected = VENUE_PAUSE_REGISTRATION;
  await db.query("begin");
  try {
    const identity = await db.query("select current_database() as name");
    if (identity.rows[0]?.name !== expected.database) throw new Error("wrong database");
    const existing = await db.query("select close_time from public.desk_ledger where close_time = any($1::timestamptz[])", [expected.entries.map((e) => e.close_time)]);
    if (existing.rows.length) throw new Error("a reviewed interval now has a ledger row; stop for owner review");
    await db.query(readFileSync(resolve(root, "docs/sql/manual/ledger_window_classifications.sql"), "utf8"));
    for (const entry of expected.entries) {
      await db.query("insert into public.desk_window_classifications (close_ms,manifest_sha256,classification,reason,record,owner_approval_id,integrity_effect) values ($1,$2,'NO_CONTRACT','VENUE_PAUSE',$3::jsonb,$4,$5) on conflict do nothing",
        [entry.close_ms, expected.manifest_sha256, JSON.stringify(entry), approval, effect]);
      const verified = await db.query("select record, owner_approval_id from public.desk_window_classifications where close_ms=$1 and manifest_sha256=$2 and integrity_effect=$3", [entry.close_ms, expected.manifest_sha256, effect]);
      const row = verified.rows[0];
      if (!row || row.owner_approval_id !== approval || JSON.stringify(sort(row.record)) !== JSON.stringify(sort(entry))) throw new Error("classification conflict or read-back failure");
    }
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)]));
  return value;
}

async function main() {
  const options = parseApproval(process.argv.slice(2));
  const manifest = checkedManifest();
  if (!options.apply) {
    console.log(JSON.stringify({ state: "PROPOSED_NOT_EXECUTED", database_connected: false, writes: 0, intervals: manifest.entries.length, manifest_sha256: VENUE_PAUSE_REGISTRATION.manifest_sha256, integrity_effect: "NONE" }));
    return;
  }
  // No env-file load, migration bootstrap or local database fallback.
  if (!process.env.DATABASE_URL) throw new Error("secure DATABASE_URL required");
  const { Client } = await import("pg");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await appendClassifications(db, options.approval, options.integrity);
    console.log(JSON.stringify({ state: "APPENDED", intervals: manifest.entries.length, manifest_sha256: options.hash, integrity_effect: options.integrity ? "EXCLUDE_FROM_MISSING_CONTRACT_COUNT" : "NONE" }));
  } finally { await db.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("classification refused or failed; no credential details logged"); process.exitCode = 1; });
}
