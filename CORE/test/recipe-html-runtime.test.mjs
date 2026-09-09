import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe, preflightMasterRecipeBytes } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, runFilm, resumeFilm, statusFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { animateDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import { createLocalAssetRuntime } from "../lib/media-pipeline/local-asset-use.mjs";
import { renderHtmlMotionPilot } from "../lib/media-pipeline/html-motion-pilot.mjs";
import { assembleFilm } from "../lib/media-pipeline/film-assembly.mjs";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";
import { probeMedia, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { governedLocalAssetFixture } from "./fixtures/governed-sfx.mjs";
import { createCliContext } from "../lib/cli/context.mjs";
import { executar as executeRunCommand } from "../lib/cli/commands/run.mjs";
import { executar as executeResumeCommand } from "../lib/cli/commands/resume.mjs";

test("receita HTML usa documento governado no master e revalida direitos na retomada sem renderizar de novo", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-html-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.mp4");
  const documentFile = path.join(root, "graphic.html");
  const documentSource = '<div id="graphic" style="background:red;width:80px;height:80px;color:white;font-size:12px"></div><script>window.__setFrame=(frame,total,scene)=>{document.querySelector("#graphic").textContent=scene.text;};</script>';
  await writeFile(documentFile, documentSource);
  await runFfmpeg(["-f", "lavfi", "-i", "color=blue:s=320x180:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const governed = await governedLocalAssetFixture({ root, file: documentFile, mediaType: "text/html", mediaKind: "document", role: "graphics-document" });
  const authorizeLocalAssets = await createLocalAssetRuntime(governed.context, { coreRoot: path.join(root, "workspace", "CORE") });
  const { recipe } = suggestMasterRecipeFromBrief({ rootScopeId: "client:teste", profile: "hibrido@1", brief: {
    briefId: "html:test", userBrief: "Mostre um encaixe.", objective: "Ensinar a montagem.", requiredText: ["ENCAIXE", "CONFIRA"], durationSeconds: 3, format: "16:9", projectId: "project:teste", clientId: "client:teste",
  } });
  recipe.assets.push(governed.asset);
  recipe.graphics.scenes[0].renderer = "html-canvas@1";
  recipe.graphics.scenes[0].documentAssetId = governed.asset.id;
  const { executionPlan, resolved } = inspectMasterRecipe(JSON.stringify(recipe));
  assert.equal((await preflightMasterRecipeBytes(resolved)).status, "blocked");
  assert.equal((await preflightMasterRecipeBytes(resolved, { authorizeLocalAssets })).status, "ready");
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: path.join(root, "productions") });
  let videoCalls = 0;
  let htmlCalls = 0;
  let htmlRenders = 0;
  let failAssembly = true;
  let htmlFile;
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint,
    resourceBroker: createResourceBroker({ dbFile: path.join(root, "broker.sqlite") }), operations: {
      authorizeLocalAssets,
      animateDraft: (options) => animateDraft({ ...options, pollIntervalMs: 1 }),
      videoAdapter: createCookieVideoAdapter({
        async submit(options) { await options.onBeforeSubmit({}); const fileId = `fixture-${++videoCalls}`; await options.onProviderHandle({ fileId, attemptId: options.attemptId }); return { fileId }; },
        async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
        async collect(options) { await copyFile(source, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
      }),
      async renderHtmlMotion(options) {
        htmlCalls++; htmlFile = options.outputFile;
        const result = await renderHtmlMotionPilot(options);
        if (!result.recoveredPublication) htmlRenders++;
        if (htmlCalls === 1) { await rm(result.receiptFile); throw new Error("fixture: recibo HTML interrompido"); }
        return result;
      },
      async assembleFilm(options) { if (failAssembly) { failAssembly = false; throw new Error("fixture: montagem interrompida"); } return assembleFilm(options); },
    } };
  await assert.rejects(runFilm({ ...options, operations: { ...options.operations, authorizeLocalAssets: undefined } }), /HTML exige --asset-context/);
  assert.equal(videoCalls, 0);
  const stateBytesBeforeIntake = await readFile(options.stateFile);
  const contextFile = path.join(root, "asset-context.json");
  await writeFile(contextFile, JSON.stringify(governed.context));
  let sessionCalls = 0;
  for (const [command, executeCommand] of [["run", executeRunCommand], ["resume", executeResumeCommand]]) {
    const cli = await createCliContext([command, "--state", options.stateFile, "--confirm-fingerprint", options.confirmFingerprint]);
    const context = { ...cli, options: cli.parse(cli.args), cookieRuntime: async () => { sessionCalls++; throw new Error("SESSION_MUST_NOT_LOAD"); } };
    await assert.rejects(executeCommand(context), /HTML exige --asset-context/);
    await assert.rejects(executeCommand({ ...context, options: { ...context.options, "asset-context": path.join(root, "missing.json") } }), /ENOENT/);
    const invalidFlag = command === "run" ? "confirm-concept-pilot" : "auto-approve";
    await assert.rejects(executeCommand({ ...context, options: { ...context.options, [invalidFlag]: "invalid" } }), /true|false|boolean/i);
    governed.changeRights({ permissions: { reuse: "denied" } });
    await assert.rejects(executeCommand({ ...context, options: { ...context.options, "asset-context": contextFile } }), /reuse.*denied|denied.*reuse|direito|permitido/i);
    governed.changeRights({ permissions: { reuse: "allowed" } });
  }
  assert.equal(sessionCalls, 0, "falha de entrada ou direito deve anteceder a sessão");
  assert.deepEqual(await readFile(options.stateFile), stateBytesBeforeIntake, "preflight não escreve no estado");
  await runFilm(options);
  await assert.rejects(resumeFilm(options), /fixture: recibo HTML interrompido/);
  assert.equal(htmlCalls, 1);
  const publishedHash = await sha256File(htmlFile);
  governed.changeRights({ permissions: { reuse: "denied" } });
  await assert.rejects(resumeFilm(options), /reuse.*denied|denied.*reuse|direito|permitido/i);
  assert.equal(htmlCalls, 1, "direito revogado bloqueia antes da recuperação do recibo");
  governed.changeRights({ permissions: { reuse: "allowed" } });
  await assert.rejects(resumeFilm(options), /fixture: montagem interrompida/);
  assert.equal(videoCalls, 3);
  assert.equal(htmlCalls, 2);
  assert.equal(htmlRenders, 1);
  const htmlHash = await sha256File(htmlFile);
  assert.equal(htmlHash, publishedHash);
  const receipt = JSON.parse(await readFile(`${htmlFile}.receipt.json`, "utf8"));
  assert.equal(receipt.parameters.onScreenText, "ENCAIXE");
  assert.equal(receipt.inputs.find(input => input.role === "graphics-document").hash.value, governed.asset.sha256);
  governed.changeRights({ permissions: { reuse: "denied" } });
  await assert.rejects(resumeFilm(options), /reuse.*denied|denied.*reuse|direito|permitido/i);
  assert.equal(htmlCalls, 2);
  governed.changeRights({ permissions: { reuse: "allowed" } });
  await resumeFilm(options);
  const status = await statusFilm({ stateFile: options.stateFile });
  assert.equal(status.status, "delivered");
  const assemblyReceipt = JSON.parse(await readFile(status.stages.assembly.receiptFile, "utf8"));
  assert.ok(assemblyReceipt.metadata.pipeline.parentReceiptIds.includes(receipt.id), "montagem encadeia o recibo do gráfico consumido");
  assert.equal(htmlCalls, 2);
  assert.equal(videoCalls, 3);
  assert.equal(await sha256File(htmlFile), htmlHash);
  const media = await probeMedia(status.finalFile);
  assert.ok(media.video);
  assert.ok(Math.abs(media.duration - 3) < 0.05);
  const raw = path.join(root, "master-frame.rgb");
  await runFfmpeg(["-i", status.finalFile, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const pixels = await readFile(raw);
  const at = (x, y) => [...pixels.subarray((y * media.video.width + x) * 3, (y * media.video.width + x) * 3 + 3)];
  assert.ok(at(Math.floor(media.video.width / 8), Math.floor(media.video.height / 4))[0] > 180, "grafismo do documento está fisicamente no master");
  assert.ok(at(Math.floor(media.video.width * 0.625), Math.floor(media.video.height * 0.667))[2] > 180, "vídeo permanece no restante do frame");
  const journal = materializeExecutionSnapshot({ dbFile: path.join(path.dirname(options.stateFile), "execution-journal.sqlite") });
  assert.equal(journal.nodes["html-motion:abertura"].status, "completed");
  await resumeFilm(options);
  assert.equal(htmlCalls, 2);
  assert.equal(htmlRenders, 1);
  assert.equal(videoCalls, 3);
});
