import assert from "node:assert/strict";
import test from "node:test";
import { contextualizeQaWarnings, evaluateQaGate, parseDetectionLog } from "../lib/media-pipeline/qa.mjs";

test("parser de QA reconhece black, freeze, silêncio e loudness", () => {
  const parsed = parseDetectionLog(`
    black_start:1.0 black_end:2.5 black_duration:1.5
    freeze_start: 3.0
    freeze_end: 5.0 | freeze_duration: 2.0
    silence_start: 6.0
    silence_end: 7.5 | silence_duration: 1.5
    I: -14.2 LUFS
    Peak: -1.1 dBFS
  `);
  assert.deepEqual(parsed.black[0], { start: 1, end: 2.5, duration: 1.5 });
  assert.deepEqual(parsed.freezes[0], { start: 3, end: 5, duration: 2 });
  assert.deepEqual(parsed.silence[0], { start: 6, end: 7.5, duration: 1.5 });
  assert.equal(parsed.integratedLufs, -14.2);
  assert.equal(parsed.truePeakDb, -1.1);
});

test("gate QA bloqueia warnings por padrão e permite política warn", () => {
  const report = { warnings: ["duration_mismatch", "audio_missing"] };
  assert.deepEqual(evaluateQaGate(report).blockingWarnings, ["duration_mismatch", "audio_missing"]);
  assert.equal(evaluateQaGate(report).status, "blocked");
  assert.equal(evaluateQaGate(report, { mode: "warn" }).status, "warning");
  assert.deepEqual(evaluateQaGate(report, { blockingWarnings: ["duration_mismatch"] }).blockingWarnings, ["duration_mismatch"]);
});

test("dip-to-black terminal planejado continua registrado, mas não bloqueia o gate", () => {
  const report = {
    warnings: ["black_interval"],
    probe: { duration: 55.125 },
    detections: { black: [{ start: 53.958333, end: 55.083333, duration: 1.125 }] },
  };
  const contextual = contextualizeQaWarnings(report, { allowedTerminalBlackSeconds: 3 });
  assert.deepEqual(contextual.warnings, []);
  assert.equal(contextual.contextualAllowances[0].reason, "intentional-terminal-dip-to-black");
  assert.equal(evaluateQaGate({ ...report, warnings: contextual.warnings }).status, "pass");

  const middleBlack = contextualizeQaWarnings({
    ...report,
    detections: { black: [{ start: 20, end: 21.5, duration: 1.5 }] },
  }, { allowedTerminalBlackSeconds: 3 });
  assert.deepEqual(middleBlack.warnings, ["black_interval"]);
  assert.equal(middleBlack.contextualAllowances.length, 0);
});

test("pico mínimo pré-master é tolerado sem relaxar o QA do master", () => {
  const report = {
    warnings: ["audio_clipping"],
    probe: { duration: 10 },
    detections: { black: [], truePeakDb: 0.1 },
  };
  const preMaster = contextualizeQaWarnings(report, { allowedPreMasterTruePeakDb: 0.5 });
  assert.deepEqual(preMaster.warnings, []);
  assert.equal(preMaster.contextualAllowances[0].reason, "pre-master-true-peak-tolerance");
  assert.deepEqual(contextualizeQaWarnings(report).warnings, ["audio_clipping"]);
  assert.deepEqual(
    contextualizeQaWarnings({ ...report, detections: { black: [], truePeakDb: 0.6 } }, { allowedPreMasterTruePeakDb: 0.5 }).warnings,
    ["audio_clipping"],
  );
});
