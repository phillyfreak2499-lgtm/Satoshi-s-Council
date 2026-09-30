import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("recovery pilot is explicit, bounded, source-labelled and outside the Chair mirror", async () => {
  const [pilot, engine, migration, push] = await Promise.all([
    read("src/lib/desk/recovery-pilot.ts"),
    read("src/lib/desk/server-engine.ts"),
    read("migrations/0067_desk_recovery_pilot_source.sql"),
    read("src/lib/desk/push.server.ts"),
  ]);
  assert.match(pilot, /RECOVERY_PILOT_CALLS_ENABLED === "true"/, "default off; only a literal flag enables it");
  assert.match(pilot, /RECOVERY_PILOT_MAX_CALLS_PER_DAY = 3/);
  assert.match(pilot, /RECOVERY_PILOT_MAX_ASK = 94\.9/);
  assert.match(pilot, /pilot\.losses >= 1/);
  assert.match(engine, /source: RECOVERY_PILOT_SOURCE/);
  assert.match(engine, /observeChairWaitMilestone\(snap, chair, chairOnlyCalls\(e\.callLog\)\)/,
    "pilot positions cannot emit Chair milestones");
  assert.match(engine, /const booked = chairOnlyCalls\(e\.callLog\)\.find/,
    "pilot positions cannot become Chair settlement copy or exit-policy observations");
  assert.match(engine, /recovery_pilot_enabled: recoveryPilotEnabled\(\)/,
    "activation state is persisted with the boundary");
  assert.match(engine, /await noteCall[\s\S]*recoveryPilotDecision[\s\S]*noteRecoveryPilotCall/,
    "the canonical Chair book gets first refusal");
  assert.match(pilot, /callNotificationRecipients < 1/,
    "the pilot cannot advance without an eligible call-notification recipient");
  assert.match(pilot, /callNotificationAccepted24h < 1/,
    "the pilot cannot advance without recent provider acceptance for the call channel");
  assert.match(push, /where s\.id = r\.subscription_id and s\.owner and s\.on_call and s\.fails < \$\{MAX_FAILS\}/,
    "only a currently eligible owner call subscription can satisfy recovery readiness");
  assert.match(engine, /catch \{[\s\S]*e\.alertCallSubs = 0;[\s\S]*e\.alertDelivery = null;/,
    "a failed readiness refresh clears cached pilot notification authority");
  assert.match(migration, /and entry_source is null[\s\S]*and entry_lean in/,
    "pilot fills cannot enter the booked-Chair mirror");
  assert.doesNotMatch(pilot + engine, /submitOrder|placeOrder|privateKey|wallet/i,
    "the pilot remains paper-only");
});
