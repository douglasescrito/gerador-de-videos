import { animateDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, runFilm, resumeFilm, statusFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";
import { probeMedia, runCommand, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { renderMotionGraphics } from "../lib/media-pipeline/motion-graphics.mjs";

test("perfil híbrido produz texto local no master físico e resume não renderiza nem submete de novo", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-hybrid-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const originalHash = await sha256File(source);
  const candidate = suggestMasterRecipeFromBrief({ rootScopeId: "client:teste", profile: "hibrido@1", brief: {
    briefId: "hybrid:test", userBrief: "Mostre um encaixe.", objective: "Ensinar a montagem.", requiredText: ["ENCAIXE", "CONFIRA"], durationSeconds: 3, format: "16:9", projectId: "project:teste", clientId: "client:teste",
  } });
  const { executionPlan } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: path.join(root, "productions") });
  const calls = { video: 0, motion: 0 };
  const rendered = [];
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint,
    resourceBroker: createResourceBroker({ dbFile: path.join(root, "broker.sqlite") }), operations: {
      // Provider simulado já concluiu: não aguardar o polling produtivo de 5 s.
      animateDraft: (options) => animateDraft({ ...options, pollIntervalMs: 1 }),
      imageAdapter: { generate() { assert.fail("o perfil não exige imagem remota"); } },
      videoAdapter: createCookieVideoAdapter({
        async submit(options) {
          assert.match(options.prompt, /Do not introduce visible lettering/);
          await options.onBeforeSubmit({});
          const fileId = `fixture-${++calls.video}`;
          await options.onProviderHandle({ fileId, attemptId: options.attemptId });
          return { fileId };
        },
        async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
        async collect(options) { await copyFile(source, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
      }),
      generateTts() { assert.fail("perfil não ativa voz"); }, generateMusic() { assert.fail("perfil não ativa trilha"); },
      async renderMotionGraphics(options) { calls.motion++; rendered.push(options); return renderMotionGraphics(options); },
    } };
  await runFilm(options);
  await resumeFilm({ ...options, autoApprove: true });
  const status = await statusFilm({ stateFile: options.stateFile });
  assert.equal(status.status, "delivered");
  const qaReceipt = JSON.parse(await readFile(status.stages.qa.receiptFile, "utf8"));
  assert.equal(qaReceipt.parameters.requireAudio, false);
  assert.deepEqual(calls, { video: 3, motion: 2 });
  assert.deepEqual(rendered.map((entry) => entry.cards[0].text), ["ENCAIXE", "CONFIRA"]);
  for (const entry of rendered) {
    assert.match(await readFile(`${entry.outputFile}.motion.ass`, "utf8"), new RegExp(entry.cards[0].text));
    assert.notEqual(await sha256File(entry.outputFile), await sha256File(entry.videoFile));
  }
  const media = await probeMedia(status.finalFile);
  assert.ok(media.video);
  assert.ok(Math.abs(media.duration - 3) < 0.05);
  const maxLuma = async (file) => {
    const result = await runCommand("ffmpeg", ["-hide_banner", "-ss", "0.5", "-i", file, "-vf", "signalstats,metadata=print", "-frames:v", "1", "-f", "null", "-"]);
    return Number(result.stderr.match(/lavfi.signalstats.YMAX=(\d+)/)?.[1]);
  };
  assert.ok(await maxLuma(source) < 70, "fonte permanece azul uniforme");
  assert.ok(await maxLuma(status.finalFile) > 150, "glifos claros do renderer chegam ao master sobre o fundo azul");
  const finalHash = await sha256File(status.finalFile);
  await resumeFilm(options);
  assert.deepEqual(calls, { video: 3, motion: 2 });
  assert.equal(await sha256File(source), originalHash);
  assert.equal(await sha256File(status.finalFile), finalHash);
  const journal = materializeExecutionSnapshot({ dbFile: path.join(path.dirname(options.stateFile), "execution-journal.sqlite") });
  for (const id of ["motion:abertura", "motion:desenvolvimento", "assembly", "master", "qa-master", "delivery"]) assert.equal(journal.nodes[id].status, "completed", id);
  const motionTiming = journal.nodes["motion:abertura"].executionTiming.measurement;
  assert.equal(motionTiming.scope, "node");
  assert.ok(motionTiming.phaseMs["local-process"] > 0);
  assert.ok(motionTiming.phaseMs.publication != null);
  assert.ok(motionTiming.phaseMs["capacity-wait"] != null);
  assert.equal(motionTiming.remoteProcessingMs, null);
});
