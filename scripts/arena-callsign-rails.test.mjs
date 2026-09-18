/**
 * Arena callsign moderation — rails.
 *
 * The server is the law: a blocked callsign is refused before the engine or
 * the database is touched, on create and on rename. No public surface prints
 * a blocked or hidden callsign, and a callsign still warming up reaches only
 * its own token. The admin can hide one callsign without a wipe. The guard's
 * denylist is encoded, so no source file carries a term.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("the guard's denylist is stored as character codes, never as words", () => {
  const src = read("src/lib/desk/callsign-guard.ts");
  for (const name of ["CONTAINS", "WHOLE"]) {
    const block = src.slice(src.indexOf(`const ${name}: readonly string[] = [`), src.indexOf("].map(decode)", src.indexOf(`const ${name}`)));
    const body = block.slice(block.indexOf("= [") + 3);
    assert.match(body, /^[\s\d,[\]]+$/, `${name} holds only numbers`);
    assert.ok((body.match(/\[/g) ?? []).length >= 5, `${name} has entries`);
  }
  assert.match(src, /String\.fromCharCode\(\.\.\.codes\)/);
  assert.doesNotMatch(src, /console\.|logger|fetch\(|node:/, "pure and silent");
  assert.match(src, /export const CALLSIGN_REJECT = "that callsign is not allowed — pick another";/);
  assert.match(src, /export const CALLSIGN_PUBLIC_LABEL = "paper";/);
});

test("the write path refuses a blocked callsign before the engine or the database, on create and on rename", () => {
  const src = read("src/lib/desk/arena.server.ts");
  assert.match(src, /import \{ CALLSIGN_RE, callsignVerdict, isBlocked, normalize, publicLabel \} from "\.\/callsign-guard";/);
  const verdictAt = src.indexOf("const verdict = callsignVerdict(input.name);");
  const engineAt = src.indexOf('await import("./server-engine")');
  const dbAt = src.indexOf("const db = await sql();", src.indexOf("export async function placeCall"));
  assert.ok(verdictAt > 0 && verdictAt < engineAt && verdictAt < dbAt, "verdict first, then engine, then database");
  assert.match(src, /if \(!verdict\.ok\) return \{ ok: false, error: verdict\.error, status: verdict\.status \};/);
  assert.match(src, /const name = verdict\.name;/, "the same verdict feeds create and rename");
  assert.match(src, /CALLSIGN_RE\.test\(s\) && !isBlocked\(s\) \? s : null/, "cleanName never returns a blocked name");
  assert.doesNotMatch(src, /console\.(log|warn|error)/, "nothing rejected is logged");
});

test("no public surface prints a blocked or hidden callsign, and a warming row reaches only its owner", () => {
  const arena = read("src/lib/desk/arena.server.ts");
  const rows = arena.slice(arena.indexOf("async function humanRows"), arena.indexOf("async function deskRows"));
  assert.match(rows, /and p\.hidden_at is null/, "hidden players never leave the database as rows");
  assert.match(rows, /rows\.filter\(\(r\) => !isBlocked\(r\.name\)\)/, "and a blocked name is dropped even if it were stored");
  assert.match(rows, /mapped\.filter\(\(r\) => r\.warming && r\.me\)/, "warming rows only for the owning token");
  assert.doesNotMatch(rows, /mapped\.filter\(\(r\) => r\.warming\)\]/, "no public warming rows");
  assert.match(arena, /select name, hidden_at from desk_players where token = \$\{token\}/);
  assert.match(arena, /name: publicLabel\(player\[0\]!\.name, \{ hidden: player\[0\]!\.hidden_at != null \}\)/, "me.name goes through the label");
  const digest = arena.slice(arena.indexOf("export async function arenaDigestLine"));
  assert.match(digest, /and p\.hidden_at is null/, "the digest never counts a hidden player");
  assert.match(digest, /top \$\{publicLabel\(a\.top_name\)\}/, "the digest's top name goes through the label");
  const pit = read("src/lib/desk/pit.server.ts");
  assert.match(pit, /import \{ publicLabel \} from "\.\/callsign-guard";/);
  assert.match(pit, /name: publicLabel\(t\.name, \{ hidden: t\.hidden_at != null \}\)/, "the rack's me goes through the label");
  const pub = read("src/lib/desk/arena-public.ts");
  assert.match(pub, /rackFor\(null\), arenaSummary\(null\)/, "the public snapshot carries no token, so it carries no warming row");
});

test("the admin can hide one callsign without a wipe, and the wipe stays the confirmed last resort", () => {
  const route = read("server/routes/arena/hide.post.ts");
  assert.match(route, /if \(!adminKeyOk\(raw\?\.key\)\) return json\(401/);
  assert.match(route, /hideCallsign\(raw\?\.name\)/);
  assert.doesNotMatch(route, /resetArena|delete from/, "hiding never wipes");
  assert.doesNotMatch(route, /error: err/, "no raw error, no echoed name");
  const arena = read("src/lib/desk/arena.server.ts");
  const hide = arena.slice(arena.indexOf("export async function hideCallsign"), arena.indexOf("export async function resetArena"));
  assert.match(hide, /update desk_players set name = \$\{label\}, hidden_at = now\(\), hidden_reason = 'policy'/);
  assert.match(hide, /`paper-\$\{hex\.slice\(0, 4\)\}`, `paper-\$\{hex\.slice\(0, 8\)\}`/, "collision-safe label");
  assert.doesNotMatch(hide, /delete from|desk_human_calls/, "locks stay");
  const panel = read("src/components/desk/ArenaAdminPanel.tsx");
  assert.match(panel, /Hide one callsign/);
  assert.match(panel, /fetch\("\/arena\/hide"/);
  assert.match(panel, /window\.confirm\("Delete every Arena callsign and paper lock\?/, "the wipe is still confirmed");
});

test("the one-shot migration hides by hash, keeps every lock, and deletes nothing", () => {
  const sql = read("migrations/0043_desk_players_hidden.sql").replace(/^\s*--.*$/gm, "");
  assert.match(sql, /alter table desk_players add column if not exists hidden_at timestamptz;/);
  assert.match(sql, /alter table desk_players add column if not exists hidden_reason text;/);
  assert.match(sql, /md5\(/, "terms are matched by hash");
  assert.doesNotMatch(sql, /delete from|drop table|truncate/i, "no wipe");
  assert.doesNotMatch(sql, /desk_human_calls/, "locks are not touched");
  assert.match(sql, /'paper-' \|\| case/, "the neutral label");
  assert.match(sql, /left\(l\.hex, 8\)/, "collision-safe");
  assert.match(sql, /where p\.token = l\.token and p\.hidden_at is null/, "idempotent");
  const values = sql.slice(sql.indexOf("values"), sql.indexOf("),\nnorm as"));
  assert.match(values, /^[\s\w(),']*$/, "hash rows only");
  assert.doesNotMatch(values, /'(?!sub'|whole')[a-z]{4,}'/, "no plain word in the hash rows beyond the kind tags");
});

test("the client forms mirror the guard, and the house rule is stated in /legal and the Arena glossary", () => {
  const pit = read("src/components/desk/PitRoom.tsx");
  assert.match(pit, /import \{ CALLSIGN_RE, CALLSIGN_REJECT, isBlocked \} from "@\/lib\/desk\/callsign-guard";/);
  assert.match(pit, /if \(isBlocked\(v\)\) setErr\(CALLSIGN_REJECT\);/);
  const panel = read("src/components/desk/ArenaPanel.tsx");
  assert.match(panel, /if \(isBlocked\(v\)\) \{\s*setErr\(CALLSIGN_REJECT\);/);
  const rule = "The desk can hide a callsign that breaks house rules. Paper results";
  assert.ok(read("src/routes/legal.tsx").includes(rule));
  assert.ok(read("src/lib/desk/glossary.ts").includes(rule + " stay on the private record."));
  assert.match(read("package.json"), /src\/lib\/desk\/callsign-guard\.test\.ts/);
});
