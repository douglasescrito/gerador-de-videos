import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createScheduleController } from "../lib/media-pipeline/schedule-controller.mjs";

const allowed = { status: "ready", blockers: [] };
const digest = "a".repeat(64);

test("schedule colapsa atraso em um catch-up idempotente e mantém lineage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schedule-controller-"));
  try {
    let now = new Date("2026-08-13T12:00:00.000Z");
    const controller = createScheduleController({ dbFile: path.join(root, "runtime.sqlite"), ownerNonce: "scheduler-a", clock: () => now });
    const input = { scheduleId: "example-daily", dueFireTimes: ["2026-08-10T12:00:00Z", "2026-08-11T12:00:00Z", "2026-08-12T12:00:00Z"], productionId: "prod-12", clientId: "example-client", directorId: "flat-2d", recipeHash: digest, planFingerprint: digest, admission: allowed };
    const claimed = controller.claimDue(input);
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.cycle.plannedFireAt, "2026-08-12T12:00:00.000Z");
    assert.equal(claimed.cycle.collapsedMissed, 2);
    assert.equal(claimed.cycle.dispatch.applicationService, "recipe dispatch");
    assert.equal(controller.claimDue(input).cycle.reused, true);
    controller.start(claimed.cycle.cycleKey, { journalFile: "execution-journal.sqlite" });
    assert.equal(controller.complete(claimed.cycle.cycleKey, { receiptId: "receipt:final" }).status, "completed");
    now = new Date("2026-08-14T12:00:00.000Z");
    const stale = controller.claimDue({ ...input, dueFireTimes: ["2026-08-11T12:00:00Z"] });
    assert.equal(stale.status, "collapsed-stale");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("schedule não cria nova produção com voo ou ambiguidade pendentes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schedule-block-"));
  try {
    const controller = createScheduleController({ dbFile: path.join(root, "runtime.sqlite"), ownerNonce: "scheduler-a", clock: () => new Date("2026-08-13T12:00:00Z") });
    const base = { scheduleId: "daily", dueFireTimes: ["2026-08-13T11:00:00Z"], productionId: "p1", clientId: "example-client", directorId: "flat-2d", recipeHash: digest, planFingerprint: digest, admission: allowed };
    const first = controller.claimDue(base);
    assert.equal(first.status, "claimed");
    const inFlight = controller.claimDue({ ...base, dueFireTimes: ["2026-08-13T11:30:00Z"], productionId: "p2" });
    assert.deepEqual(inFlight.blockers, ["production_already_in_flight"]);
    const ambiguous = controller.claimDue({ ...base, scheduleId: "other", pendingAmbiguous: true });
    assert.deepEqual(ambiguous.blockers, ["reconcile_ambiguous_attempt_first"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
