import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { animateDraft, approveDraft, authorizeDraftHumanReplacements, bindDraftNarrationTimings, createDraftState, draftScenes, overrideDraftSceneQa, qaDraftScenes, readDraftState, reconcileDraftScene, recoverDraftPreProviderFailure, validateDraftSpec } from "../lib/media-pipeline/draft-workflow.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";

test("draft exige aprovação persistente antes de animar", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-"));
  try {
    const imageCalls = [];
    const imageAdapter = {
      async generate(options) {
        imageCalls.push(options);
        await mkdir(path.dirname(options.outputFile), { recursive: true });
        await writeFile(options.outputFile, "image");
        const receiptFile = `${options.outputFile}.receipt.json`;
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "image", role: "keyframe" });
        const receipt = createStageReceipt({ operation: "test-image", provider: "test", stage: "draft", artifacts: [artifact] });
        await writeStageReceipt(receiptFile, receipt);
        return { file: options.outputFile, receiptFile, receipt };
      },
    };
    const spec = {
      name: "filme-teste",
      outRoot: dir,
      scenes: [{ id: "abertura", prompt: "Uma ponte.", motionPrompt: "A câmera avança.", style: "aquarela-2d" }],
    };
    const state = await draftScenes({ spec, imageAdapter });
    assert.equal(state.status, "awaiting_approval");
    assert.equal(imageCalls.length, 1);
    assert.match(imageCalls[0].prompt, /watercolor/i);
    assert.ok(imageCalls[0].prompt.endsWith("Uma ponte."));

    const videoAdapter = {
      async generate(options) {
        assert.ok(options.attemptId);
        await options.onProviderHandle({ attemptId: options.attemptId, fileId: "file-1", interactionId: "interaction-1", expirationTime: "2099-01-01T00:00:00.000Z" });
        await writeFile(options.outputFile, "video");
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "video", role: "video" });
        const receipt = createStageReceipt({ operation: "test-video", provider: "test", stage: "animate", artifacts: [artifact] });
        await writeStageReceipt(options.receiptFile, receipt);
        return { file: options.outputFile, receiptFile: options.receiptFile, receipt, interactionId: "interaction-1", fileId: "file-1" };
      },
    };
    await assert.rejects(() => animateDraft({ draftFile: state.stateFile, videoAdapter }), /budget|generate|obrigatório|Nenhuma|draft exige/i);
    const approved = await approveDraft({ draftFile: state.stateFile });
    assert.equal(approved.status, "approved");
    const delivered = await animateDraft({ draftFile: state.stateFile, videoAdapter, budget: 1 });
    assert.equal(delivered.status, "delivered");
    assert.equal((await readDraftState(state.stateFile)).scenes[0].interactionId, "interaction-1");
    assert.equal((await readDraftState(state.stateFile)).scenes[0].fileId, "file-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("text_to_video usa cartão local para aprovação e não envia keyframe ao Omni", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-text-video-"));
  try {
    const draft = await draftScenes({
      spec: {
        name: "texto-direto",
        outRoot: dir,
        scenes: [{ id: "abertura", prompt: "Formas azuis se conectam.", motionPrompt: "As formas avançam e se conectam.", generationTask: "text_to_video" }],
      },
    });
    assert.equal(draft.status, "awaiting_approval");
    assert.ok(draft.scenes[0].keyframeFile.endsWith(".svg"));
    assert.match(await readFile(draft.scenes[0].keyframeFile, "utf8"), /TEXT → VIDEO/);
    await approveDraft({ draftFile: draft.stateFile });
    let videoCalls = 0;
    const delivered = await animateDraft({
      draftFile: draft.stateFile,
      budget: 1,
      videoAdapter: {
        async generate(options) {
          videoCalls += 1;
          assert.equal(options.task, "text_to_video");
          assert.deepEqual(options.images, []);
          assert.deepEqual(options.executionInputReceipts, []);
          assert.match(options.prompt, /formas avançam/i);
          await options.onProviderHandle({ attemptId: options.attemptId, fileId: "text-video-file" });
          await writeFile(options.outputFile, "video");
          const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "video", role: "video" });
          const receipt = createStageReceipt({ operation: "test-text-video", provider: "test", stage: "animate", artifacts: [artifact] });
          await writeStageReceipt(options.receiptFile, receipt);
          return { file: options.outputFile, receiptFile: options.receiptFile, receipt, fileId: "text-video-file" };
        },
      },
    });
    assert.equal(videoCalls, 1);
    assert.equal(delivered.status, "delivered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("onScreenText vira tipografia nativa Omni; overlay local exige local-gc explícito", () => {
  const native = validateDraftSpec({
    name: "tipografia-nativa",
    scenes: [{ id: "cena", prompt: "Formas azuis.", motionPrompt: "As formas avançam.", onScreenText: "PRESENÇA", generationTask: "text_to_video" }],
  });
  assert.equal(native.scenes[0].textRendering, "omni-native");
  assert.match(native.scenes[0].videoComposition.effectivePrompt, /NATIVE TYPOGRAPHY CONTRACT/);
  assert.match(native.scenes[0].videoComposition.effectivePrompt, /PRESENÇA/);

  const timed = validateDraftSpec({
    name: "tipografia-temporizada",
    scenes: [{
      id: "cena",
      prompt: "Formas azuis.",
      motionPrompt: "As formas avançam.",
      onScreenText: "PRESENÇA",
      generationTask: "text_to_video",
      graphicsTextBinding: {
        start: 1.2,
        end: 2.8,
        startWordIndex: 3,
        endWordIndex: 4,
        textAuthority: "scene-spec-only",
        timestampAuthority: "canonical-word-timeline-only",
      },
    }],
  });
  assert.match(timed.scenes[0].videoComposition.effectivePrompt, /VERIFIED GRAPHICS TEXT BINDING/);
  assert.match(timed.scenes[0].videoComposition.effectivePrompt, /1\.200s/);
  assert.throws(() => validateDraftSpec({
    scenes: [{ id: "x", prompt: "Cena", onScreenText: "ERRADO", graphicsTextBinding: { start: 0, end: 1 } }],
  }), /não veio da especificação canônica/);

  const gc = validateDraftSpec({
    name: "gc-local",
    scenes: [{ id: "cena", prompt: "Formas azuis.", onScreenText: "CRÉDITO", textRendering: "local-gc" }],
  });
  assert.equal(gc.scenes[0].textRendering, "local-gc");
  assert.doesNotMatch(gc.scenes[0].videoComposition.effectivePrompt, /NATIVE TYPOGRAPHY CONTRACT/);
});

test("FIRST_FRAME governado chega byte a byte ao adapter de vídeo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-first-frame-"));
  try {
    const firstFrame = path.join(dir, "first.png");
    const originalBytes = Buffer.from("first-frame-exato");
    await writeFile(firstFrame, originalBytes);
    const draft = await draftScenes({
      spec: {
        name: "first-frame-direto",
        outRoot: dir,
        scenes: [{
          id: "abertura",
          prompt: "Animar a partir do quadro inicial.",
          generationTask: "image_to_video",
          references: [{ source: { kind: "workspace", locator: firstFrame }, role: "first-frame" }],
          referenceAuthorizations: [{ bindingHash: "a".repeat(64), rights: { providerInput: "allowed", reuse: "allowed" } }],
          runtimeInputRoles: ["first-frame"],
        }],
      },
    });
    assert.equal(draft.scenes[0].keyframeFile, firstFrame);
    assert.deepEqual(await readFile(draft.scenes[0].keyframeFile), originalBytes);
    await approveDraft({ draftFile: draft.stateFile });
    const delivered = await animateDraft({
      draftFile: draft.stateFile,
      budget: 1,
      videoAdapter: {
        async generate(options) {
          assert.equal(options.task, "image_to_video");
          assert.deepEqual(options.images, [firstFrame]);
          assert.deepEqual(options.inputRoles, ["first-frame"]);
          assert.deepEqual(await readFile(options.images[0]), originalBytes);
          await options.onProviderHandle({ attemptId: options.attemptId, fileId: "first-frame-file" });
          await writeFile(options.outputFile, "video");
          const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "video", role: "video" });
          const receipt = createStageReceipt({ operation: "test-first-frame", provider: "test", stage: "animate", artifacts: [artifact] });
          await writeStageReceipt(options.receiptFile, receipt);
          return { file: options.outputFile, receiptFile: options.receiptFile, receipt, fileId: "first-frame-file" };
        },
      },
    });
    assert.equal(delivered.status, "delivered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("narrador externo proíbe voz Omni e usa a janela medida para tipografia e efeitos", () => {
  const draft = validateDraftSpec({
    name: "vids-sync",
    audioPolicy: "external-narration-no-voice",
    scenes: [{ id: "cena", prompt: "Luz em movimento.", onScreenText: "CONTINUE", generationTask: "text_to_video" }],
  });
  const bound = bindDraftNarrationTimings(draft, [{
    sceneId: "cena",
    binding: {
      start: 3.125,
      end: 7.75,
      startWordIndex: 4,
      endWordIndex: 9,
      clipOrigin: 10,
      clipDuration: 10,
      words: [{ word: "CONTINUE", start: 3.125, end: 3.75, globalStart: 13.125, globalEnd: 13.75, wordIndex: 4 }],
      textAuthority: "scene-spec-only",
      timestampAuthority: "canonical-word-timeline-only",
    },
  }]);
  const prompt = bound.scenes[0].videoComposition.effectivePrompt;
  assert.match(prompt, /EXTERNAL NARRATION AUDIO CONTRACT/);
  assert.match(prompt, /Do not generate, speak, dub, sing/i);
  assert.match(prompt, /VERIFIED GRAPHICS TEXT BINDING/);
  assert.match(prompt, /SYNCHRONIZED SOUND DESIGN WINDOW/);
  assert.match(prompt, /VERIFIED LOCAL WORD TIMELINE/);
  assert.match(prompt, /\[3\.125s - 3\.750s\] CONTINUE/);
  assert.match(prompt, /3\.125s through 7\.750s/);
});

test("draft standalone bloqueia referências antes de acesso ou adapter; dry-run apenas reporta", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-rights-"));
  let adapterCalls = 0;
  try {
    const missingReference = path.join(dir, "nao-existe.png");
    const spec = {
      name: "draft-com-referencia",
      outRoot: dir,
      scenes: [{
        id: "cena",
        prompt: "Cena governada.",
        references: [missingReference],
      }],
    };
    const imageAdapter = {
      async generate() {
        adapterCalls += 1;
        throw new Error("adapter não deveria ser chamado");
      },
    };

    await assert.rejects(
      draftScenes({ spec, imageAdapter }),
      /canonical providerInput rights required/,
    );
    assert.equal(adapterCalls, 0);

    const planned = await draftScenes({ spec, dryRun: true });
    assert.equal(adapterCalls, 0);
    assert.equal(planned.status, "planned");
    assert.equal(planned.runtimeReferencePolicy.canonicalProviderInputRightsSatisfied, false);
    assert.equal(planned.runtimeReferencePolicy.defaultProviderInputAllowed, false);
    assert.deepEqual(
      planned.runtimeReferencePolicy.blockers.map(({ code }) => code),
      ["canonical_provider_input_rights_required"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("crash após handle persistido é recuperado sem novo POST", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-reconcile-"));
  let posts = 0;
  try {
    const imageAdapter = {
      async generate(options) {
        await writeFile(options.outputFile, "image");
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "image", role: "keyframe" });
        const receipt = createStageReceipt({ operation: "test-image", provider: "test", stage: "draft", artifacts: [artifact] });
        const receiptFile = `${options.outputFile}.receipt.json`;
        await writeStageReceipt(receiptFile, receipt);
        return { file: options.outputFile, receiptFile, receipt };
      },
    };
    const draft = await draftScenes({ spec: { name: "crash-handle", outRoot: dir, scenes: [{ id: "cena", prompt: "Cena" }] }, imageAdapter });
    await approveDraft({ draftFile: draft.stateFile });
    const crashedAdapter = {
      async generate(options) {
        posts += 1;
        await options.onProviderHandle({ attemptId: options.attemptId, fileId: "file-recover", interactionId: "interaction-recover", expirationTime: "2099-01-01T00:00:00.000Z" });
        throw new Error("process killed after handle_persisted");
      },
    };
    await assert.rejects(animateDraft({ draftFile: draft.stateFile, videoAdapter: crashedAdapter, budget: 1 }), /handle_persisted/);
    const ambiguous = await readDraftState(draft.stateFile);
    assert.equal(ambiguous.scenes[0].status, "ambiguous");
    assert.equal(ambiguous.scenes[0].fileId, "file-recover");
    assert.ok(ambiguous.scenes[0].attemptId);
    await assert.rejects(
      recoverDraftPreProviderFailure({
        draftFile: draft.stateFile,
        sceneIds: ["cena"],
        expectedError: "process killed after handle_persisted",
      }),
      /identidade remota/,
    );

    const reconcileAdapter = {
      async reconcile(options) {
        assert.equal(options.fileId, "file-recover");
        await writeFile(options.outputFile, "recovered-video");
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "video", role: "reconciled-video" });
        const receipt = createStageReceipt({ operation: "reconcile-video", provider: "test", stage: "animate", artifacts: [artifact] });
        await writeStageReceipt(options.receiptFile, receipt);
        return { classification: "ready", zeroPost: true, fileId: options.fileId, checkedAt: new Date().toISOString(), file: options.outputFile, receiptFile: options.receiptFile, receipt };
      },
    };
    const recovered = await reconcileDraftScene({ draftFile: draft.stateFile, sceneId: "cena", videoAdapter: reconcileAdapter });
    assert.equal(recovered.state.status, "delivered");
    assert.equal(recovered.scene.status, "delivered");
    assert.equal(posts, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("falha local anterior ao provedor volta a approved sem apagar a evidência histórica", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-pre-provider-"));
  const preflightError = "confirmation.source deve ser cli ou app.";
  try {
    const draft = await draftScenes({
      spec: {
        name: "pre-provider",
        outRoot: dir,
        scenes: [{ id: "cena", prompt: "Formas avançam.", generationTask: "text_to_video" }],
      },
    });
    await approveDraft({ draftFile: draft.stateFile });
    await assert.rejects(
      animateDraft({
        draftFile: draft.stateFile,
        budget: 1,
        videoAdapter: { async generate() { throw new Error(preflightError); } },
      }),
      /confirmation\.source/,
    );
    const ambiguous = await readDraftState(draft.stateFile);
    const previousAttemptId = ambiguous.scenes[0].attemptId;
    assert.equal(ambiguous.scenes[0].status, "ambiguous");
    assert.equal(ambiguous.scenes[0].providerHandle, null);

    const recovered = await recoverDraftPreProviderFailure({
      draftFile: draft.stateFile,
      sceneIds: ["cena"],
      expectedError: preflightError,
    });
    assert.equal(recovered.status, "approved");
    assert.equal(recovered.scenes[0].status, "approved");
    assert.equal(recovered.scenes[0].attemptId, null);
    assert.equal(recovered.scenes[0].error, null);
    assert.ok(recovered.history.some((entry) => entry.event === "scene_pre_provider_failure_recovered" && entry.previousAttemptId === previousAttemptId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function humanReplacementFixture(t, count = 3) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-draft-human-replacement-"));
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    await rm(dir, { recursive: true, force: true });
  });
  const spec = validateDraftSpec({ name: "human-replacement", scenes: Array.from({ length: count }, (_, index) => ({ id: `scene-${String(index + 1).padStart(2, "0")}`, prompt: "Um traço atravessa mundos.", generationTask: "text_to_video" })) }, { outputsRoot: dir });
  const state = createDraftState(spec);
  state.status = "attention_required";
  for (const scene of state.scenes) {
    scene.status = "ambiguous";
    scene.attemptId = `old-${scene.id}`;
    scene.error = "external_effect_unknown";
  }
  await Promise.all(["metadados", "videos-soltos", "receitas"].map((name) => mkdir(path.join(state.root, name), { recursive: true })));
  await writeFile(state.stateFile, JSON.stringify(state, null, 2));
  return { state, draftFile: state.stateFile };
}

test("decisão humana preserva três entregas e autoriza só nove novas tentativas mantendo desconhecidos", async (t) => {
  const { state, draftFile } = await humanReplacementFixture(t, 12);
  const deliveredIds = new Set(["scene-01", "scene-03", "scene-04"]);
  const replacements = [];
  const unsubmittedSceneIds = [];
  const expectedUnsubmittedAttemptIds = {};
  for (const [index, scene] of state.scenes.entries()) {
    if (deliveredIds.has(scene.id)) {
      scene.status = "delivered";
      scene.fileId = `remote-${scene.id}`;
      scene.interactionId = `interaction-${scene.id}`;
      scene.providerHandle = { fileId: scene.fileId, attemptId: scene.attemptId };
      await writeFile(scene.videoFile, `original-${scene.id}`);
      await writeFile(scene.videoReceipt, `receipt-${scene.id}`);
    } else if (index >= 6) {
      scene.status = "generating";
      scene.error = null;
      unsubmittedSceneIds.push(scene.id);
      expectedUnsubmittedAttemptIds[scene.id] = scene.attemptId;
    } else {
      replacements.push({ sceneId: scene.id, attemptId: scene.attemptId });
    }
  }
  const frozen = structuredClone(state);
  await writeFile(draftFile, JSON.stringify(state, null, 2));
  const updated = await authorizeDraftHumanReplacements({ draftFile, decisionId: "human-decision-1", replacements, unsubmittedSceneIds, expectedUnsubmittedAttemptIds });
  assert.equal(updated.status, "approved");
  assert.equal(updated.scenes.filter((scene) => scene.status === "approved").length, 9);
  for (const scene of updated.scenes) {
    const original = frozen.scenes.find((entry) => entry.id === scene.id);
    if (deliveredIds.has(scene.id)) {
      assert.deepEqual(scene, original);
      assert.equal(await readFile(scene.videoFile, "utf8"), `original-${scene.id}`);
      assert.equal(await readFile(scene.videoReceipt, "utf8"), `receipt-${scene.id}`);
      continue;
    }
    assert.equal(scene.attemptId, null);
    assert.equal(scene.error, null);
    assert.equal(scene.videoFile, original.videoFile);
    assert.equal(scene.motionPrompt, original.motionPrompt);
    const record = scene.replacementHistory[0];
    assert.equal(record.previousAttemptId, original.attemptId);
    assert.equal(record.previousStatus, original.status);
    assert.equal(record.previousError, original.error);
    assert.equal(record.noSubmission, unsubmittedSceneIds.includes(scene.id));
    assert.equal(record.outcome, record.noSubmission ? "not-submitted" : "unknown");
    assert.equal(record.classification, record.noSubmission ? "not-submitted" : "external_effect_unknown");
    assert.ok(updated.history.some((entry) => entry.scene === scene.id && entry.previousAttemptId === original.attemptId && entry.outcome === record.outcome));
  }
  assert.equal(updated.humanReplacementDecisions.length, 1);
  assert.deepEqual(updated.history.slice(0, frozen.history.length), frozen.history);
});

test("replay da mesma decisão não reseta tentativa nova nem grava o draft novamente", async (t) => {
  const { state, draftFile } = await humanReplacementFixture(t, 1);
  const request = { draftFile, decisionId: "repeat-safe", replacements: [{ sceneId: state.scenes[0].id, attemptId: state.scenes[0].attemptId }] };
  const first = await authorizeDraftHumanReplacements(request);
  first.scenes[0].status = "generating";
  first.scenes[0].attemptId = "new-attempt";
  first.scenes[0].fileId = "new-remote-file";
  first.scenes[0].providerHandle = { attemptId: "new-attempt", fileId: "new-remote-file" };
  await writeFile(first.scenes[0].videoFile, "new-partial-video");
  await writeFile(draftFile, JSON.stringify(first, null, 2));
  const beforeReplay = await readFile(draftFile, "utf8");
  const replay = await authorizeDraftHumanReplacements(request);
  assert.equal(replay.scenes[0].attemptId, "new-attempt");
  assert.equal(replay.scenes[0].status, "generating");
  assert.equal(replay.scenes[0].replacementHistory.length, 1);
  assert.equal(await readFile(draftFile, "utf8"), beforeReplay);
  await assert.rejects(authorizeDraftHumanReplacements({ ...request, replacements: [{ sceneId: state.scenes[0].id, attemptId: "new-attempt" }] }), /outro escopo/);
  assert.equal(await readFile(draftFile, "utf8"), beforeReplay);
});

test("aplicações concorrentes da mesma decisão produzem uma única projeção", async (t) => {
  const { state, draftFile } = await humanReplacementFixture(t, 1);
  const request = { draftFile, decisionId: "concurrent-same", replacements: [{ sceneId: state.scenes[0].id, attemptId: state.scenes[0].attemptId }] };
  const results = await Promise.all([authorizeDraftHumanReplacements(request), authorizeDraftHumanReplacements(request)]);
  assert.deepEqual(results[0], results[1]);
  const saved = await readDraftState(draftFile);
  assert.equal(saved.humanReplacementDecisions.length, 1);
  assert.equal(saved.scenes[0].replacementHistory.length, 1);
});

test("substituição valida todo o conjunto antes de gravar e recusa qualquer identidade ou saída", async (t) => {
  for (const blocker of ["fileId", "providerHandle", "interactionId", "videoFile", "videoReceipt", "attemptId", "status"]) {
    await t.test(blocker, async (child) => {
      const { state, draftFile } = await humanReplacementFixture(child, 2);
      const second = state.scenes[1];
      const replacements = state.scenes.map((scene) => ({ sceneId: scene.id, attemptId: scene.attemptId }));
      if (["videoFile", "videoReceipt"].includes(blocker)) await writeFile(second[blocker], "preservar");
      else second[blocker] = blocker === "providerHandle" ? {} : blocker === "status" ? "delivered" : "divergent";
      await writeFile(draftFile, JSON.stringify(state, null, 2));
      const before = await readFile(draftFile, "utf8");
      await assert.rejects(authorizeDraftHumanReplacements({ draftFile, decisionId: `blocked-${blocker}`, replacements }), /identidade remota|MP4 ou recibo|tentativa ambígua/);
      assert.equal(await readFile(draftFile, "utf8"), before);
      if (["videoFile", "videoReceipt"].includes(blocker)) assert.equal(await readFile(second[blocker], "utf8"), "preservar");
    });
  }
});

test("cena não submetida exige nonce exato e decisão não aceita duplicidade nem ampliação", async (t) => {
  const { state, draftFile } = await humanReplacementFixture(t, 2);
  state.scenes[0].status = "generating";
  state.scenes[0].error = null;
  await writeFile(draftFile, JSON.stringify(state, null, 2));
  const before = await readFile(draftFile, "utf8");
  const request = { draftFile, decisionId: "unsubmitted-exact", unsubmittedSceneIds: [state.scenes[0].id] };
  await assert.rejects(authorizeDraftHumanReplacements(request), /Nonce local divergente/);
  await assert.rejects(authorizeDraftHumanReplacements({ ...request, expectedUnsubmittedAttemptIds: { [state.scenes[0].id]: "wrong-nonce" } }), /Nonce local divergente/);
  await assert.rejects(authorizeDraftHumanReplacements({ ...request, replacements: [{ sceneId: state.scenes[0].id, attemptId: state.scenes[0].attemptId }] }), /Cena duplicada/);
  await assert.rejects(authorizeDraftHumanReplacements({ ...request, expectedUnsubmittedAttemptIds: { [state.scenes[1].id]: state.scenes[1].attemptId } }), /fora da decisão/);
  await assert.rejects(authorizeDraftHumanReplacements({ draftFile, decisionId: "unknown-scene", replacements: [{ sceneId: "absent", attemptId: "nonce" }] }), /Cena ausente/);
  assert.equal(await readFile(draftFile, "utf8"), before);
  const accepted = await authorizeDraftHumanReplacements({ ...request, expectedUnsubmittedAttemptIds: { [state.scenes[0].id]: state.scenes[0].attemptId } });
  assert.equal(accepted.scenes[0].replacementHistory[0].noSubmission, true);
  assert.equal(accepted.scenes[0].replacementHistory[0].outcome, "not-submitted");
  assert.deepEqual(accepted.scenes[1], state.scenes[1]);
});

test("cena sem nonce e sem submissão mantém evidência verdadeira sem tentar inferir efeito remoto", async (t) => {
  const { state, draftFile } = await humanReplacementFixture(t, 1);
  state.scenes[0].status = "generating";
  state.scenes[0].attemptId = null;
  state.scenes[0].error = null;
  await writeFile(draftFile, JSON.stringify(state, null, 2));
  const accepted = await authorizeDraftHumanReplacements({ draftFile, decisionId: "no-local-nonce", unsubmittedSceneIds: [state.scenes[0].id] });
  assert.equal(accepted.scenes[0].status, "approved");
  assert.equal(accepted.scenes[0].replacementHistory[0].previousAttemptId, null);
  assert.equal(accepted.scenes[0].replacementHistory[0].noSubmission, true);
});

test("helper não pode redirecionar a gravação para outro arquivo pelo stateFile embutido", async (t) => {
  const { state, draftFile } = await humanReplacementFixture(t, 1);
  const otherFile = path.join(state.root, "metadados", "frozen-plan.json");
  await writeFile(otherFile, "plano original");
  state.stateFile = otherFile;
  await writeFile(draftFile, JSON.stringify(state, null, 2));
  const before = await readFile(draftFile, "utf8");
  await assert.rejects(authorizeDraftHumanReplacements({ draftFile, decisionId: "no-redirection", replacements: [{ sceneId: state.scenes[0].id, attemptId: state.scenes[0].attemptId }] }), /stateFile.*diverge/);
  assert.equal(await readFile(otherFile, "utf8"), "plano original");
  assert.equal(await readFile(draftFile, "utf8"), before);
});

test("spec rejeita ids duplicados e mais de quatro referências", () => {
  assert.throws(() => validateDraftSpec({ scenes: [{ id: "x", prompt: "a" }, { id: "x", prompt: "b" }] }), /duplicada/);
  assert.throws(() => validateDraftSpec({ scenes: [{ prompt: "a", references: ["1", "2", "3", "4", "5"] }] }), /quatro/);
});

test("QA por cena bloqueia montagem, aceita override humano e não repete análise", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-scene-qa-"));
  let qaCalls = 0;
  try {
    const imageAdapter = {
      async generate(options) {
        await writeFile(options.outputFile, "image");
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "image", role: "keyframe" });
        const receipt = createStageReceipt({ operation: "test-image", provider: "test", stage: "draft", artifacts: [artifact] });
        const receiptFile = `${options.outputFile}.receipt.json`;
        await writeStageReceipt(receiptFile, receipt);
        return { file: options.outputFile, receiptFile, receipt };
      },
    };
    const videoAdapter = {
      async generate(options) {
        await options.onProviderHandle({ attemptId: options.attemptId, fileId: "qa-file" });
        await writeFile(options.outputFile, "video");
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "video", role: "scene-video" });
        const receipt = createStageReceipt({ operation: "test-video", provider: "test", stage: "video", artifacts: [artifact] });
        await writeStageReceipt(options.receiptFile, receipt);
        return { file: options.outputFile, receiptFile: options.receiptFile, receipt };
      },
    };
    const draft = await draftScenes({ spec: { name: "scene-qa", outRoot: dir, scenes: [{ id: "cena", prompt: "Cena", onScreenText: "Marca" }] }, imageAdapter });
    await approveDraft({ draftFile: draft.stateFile });
    await animateDraft({ draftFile: draft.stateFile, videoAdapter, budget: 1 });
    const fakeQa = async ({ outputFile, receiptFile, parentReceipts, requireAudio }) => {
      qaCalls += 1;
      assert.equal(requireAudio, false);
      const report = { status: "warning", warnings: ["expected_text_missing"] };
      await writeFile(outputFile, JSON.stringify(report));
      const receipt = createStageReceipt({ operation: "scene-qa", provider: "test", stage: "scene-qa", parentReceipts });
      await writeStageReceipt(receiptFile, receipt);
      return { report, file: outputFile, receiptFile, receipt };
    };
    await assert.rejects(qaDraftScenes({ draftFile: draft.stateFile, runQa: fakeQa }), /bloqueou a montagem/);
    const blocked = await readDraftState(draft.stateFile);
    assert.equal(blocked.scenes[0].qa.gate.status, "blocked");
    await overrideDraftSceneQa({ draftFile: draft.stateFile, sceneId: "cena", author: "Ana", justification: "Texto verificado no frame final." });
    const accepted = await qaDraftScenes({ draftFile: draft.stateFile, runQa: fakeQa });
    assert.equal(accepted.scenes[0].qa.gate.status, "overridden");
    assert.equal(qaCalls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
