import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import {
  adaptExecutionPlanToLegacy,
  compileFilmSpec,
} from "../lib/media-pipeline/film-compiler.mjs";
import { createExecutionKernel } from "../lib/media-pipeline/execution-kernel.mjs";
import {
  consumeExecutionEffectAuthorization,
  claimNodeReconciliation,
  materializeExecutionSnapshot,
  recordExecutionNodeApproval,
  recordNodePreEffectFailure,
  recordNodeProviderUnaccepted,
} from "../lib/media-pipeline/execution-journal.mjs";
import {
  createReceipt,
  writeReceipt,
} from "../lib/media-pipeline/receipt.mjs";
import { writeFileAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import {
  planFilm,
  resumeFilm,
  runFilm,
  statusFilm,
} from "../lib/media-pipeline/film-orchestrator.mjs";
import { approveDraft } from "../lib/media-pipeline/draft-workflow.mjs";

// O ledger de capabilities vive em %LOCALAPPDATA%. Sem isolar a raiz, uma
// ativação real da máquina muda o snapshot efetivo e o plano compilado com o
// catálogo estático passa a divergir em capabilitySnapshotHash. O teste é do
// limite de efeito, não do ledger do operador.
let capabilityRoot = null;
let previousLocalAppData;
before(async () => {
  capabilityRoot = await mkdtemp(path.join(os.tmpdir(), "effect-boundary-capabilities-"));
  previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = capabilityRoot;
});
after(async () => {
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  if (capabilityRoot) await rm(capabilityRoot, { recursive: true, force: true });
});

function plan() {
  return compileFilmSpec({
    name: "effect-boundary",
    scenes: [{
      id: "scene-a",
      prompt: "Quadro geométrico.",
      motionPrompt: "Mover lentamente.",
      generationTask: "image_to_video",
    }],
    qa: false,
    budget: {
      image: 1,
      tts: 0,
      music: 0,
      omni: 1,
      semanticQa: 0,
    },
  });
}

async function paidResult({
  file,
  kind,
  mimeType,
  operation,
  provider,
  content,
} = {}) {
  await writeFileAtomic(file, content);
  const artifact = await createArtifactFromFile({
    file,
    kind,
    mimeType,
    role: "generated",
  });
  const receipt = createReceipt({
    operation,
    provider,
    artifacts: [artifact],
  });
  const receiptFile = `${file}.receipt.json`;
  await writeReceipt(receiptFile, receipt);
  return { file, receiptFile, receipt };
}

async function completeVisualPrerequisites(kernel) {
  await kernel.executeLocalNode({
    nodeId: "alignment",
    execute: async () => ({ completed: true }),
  });
  await kernel.executeLocalNode({
    nodeId: "timeline-lock",
    execute: async () => ({ completed: true }),
  });
}

test("reconciliação do mesmo efeito possui claim SQLite exclusivo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reconcile-claim-"));
  try {
    const executionPlan = plan();
    const dbFile = path.join(root, "journal.sqlite");
    const kernel = createExecutionKernel({ dbFile, plan: executionPlan, confirmFingerprint: executionPlan.governance.approval.fingerprint, actor: "human:reconcile-claim" });
    await completeVisualPrerequisites(kernel);
    await assert.rejects(() => kernel.executePaidNode({
      nodeId: "keyframe:scene-a",
      execute: async ({ attemptId, executionEffectAuthorization }) => {
        consumeExecutionEffectAuthorization(executionEffectAuthorization, { provider: "gemini-image", operation: "image-generate", attemptId });
        throw new Error("queda depois do efeito");
      },
    }), /queda depois do efeito/);
    const claim = claimNodeReconciliation({ dbFile, nodeId: "keyframe:scene-a" });
    assert.equal(claim.status, "reconciling");
    assert.throws(() => claimNodeReconciliation({ dbFile, nodeId: "keyframe:scene-a" }), /não possui tentativa reconciliável|concorrente/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kernel exige que o adapter consuma a capability antes de concluir o nó", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "effect-boundary-"));
  try {
    const executionPlan = plan();
    const dbFile = path.join(root, "journal.sqlite");
    const kernel = createExecutionKernel({
      dbFile,
      plan: executionPlan,
      confirmPaid: true,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      actor: "human:effect-boundary-test",
    });
    await completeVisualPrerequisites(kernel);
    let simulatedPosts = 0;
    const outputFile = path.join(root, "keyframe.png");
    const result = await kernel.executePaidNode({
      nodeId: "keyframe:scene-a",
      execute: async ({
        attemptId,
        executionEffectAuthorization,
      }) => {
        consumeExecutionEffectAuthorization(
          executionEffectAuthorization,
          {
            provider: "gemini-image",
            operation: "image-generate",
            nodeId: "keyframe:scene-a",
            attemptId,
          },
        );
        simulatedPosts += 1;
        return paidResult({
          file: outputFile,
          kind: "image",
          mimeType: "image/png",
          operation: "generate-image",
          provider: "test",
          content: Buffer.from("synthetic-png"),
        });
      },
    });
    assert.equal(simulatedPosts, 1);
    assert.equal(result.execution.status, "completed");
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"]
        .attempts,
      1,
    );
    await assert.rejects(
      kernel.executePaidNode({
        nodeId: "keyframe:scene-a",
        execute: async () => {
          simulatedPosts += 1;
        },
      }),
      /não pode ser autorizado|não autoriza nova tentativa|estado completed/,
    );
    assert.equal(simulatedPosts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutação do keyframe aprovado bloqueia o vídeo antes do adapter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "effect-input-jit-"));
  try {
    const executionPlan = plan();
    const dbFile = path.join(root, "journal.sqlite");
    const kernel = createExecutionKernel({
      dbFile,
      plan: executionPlan,
      confirmPaid: true,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      actor: "human:effect-input-test",
    });
    await completeVisualPrerequisites(kernel);
    const keyframeFile = path.join(root, "keyframe.png");
    const keyframe = await kernel.executePaidNode({
      nodeId: "keyframe:scene-a",
      execute: async ({
        attemptId,
        executionEffectAuthorization,
      }) => {
        consumeExecutionEffectAuthorization(
          executionEffectAuthorization,
          {
            provider: "gemini-image",
            operation: "image-generate",
            attemptId,
          },
        );
        return paidResult({
          file: keyframeFile,
          kind: "image",
          mimeType: "image/png",
          operation: "generate-image",
          provider: "test",
          content: Buffer.from("approved-keyframe"),
        });
      },
    });
    await kernel.executeLocalNode({
      nodeId: "animatic",
      execute: async () => ({ file: keyframeFile }),
    });
    recordExecutionNodeApproval({
      dbFile,
      nodeId: "animatic-approval",
      targetHash: "f".repeat(64),
      actor: "human:effect-input-test",
      approvedAt: new Date(),
    });
    await writeFileAtomic(
      path.join(root, "replacement.png"),
      Buffer.from("replacement"),
    );
    await import("node:fs/promises").then(({ copyFile }) =>
      copyFile(path.join(root, "replacement.png"), keyframeFile));

    let videoAdapterCalls = 0;
    await assert.rejects(
      kernel.executePaidNode({
        nodeId: "video:scene-a",
        inputFiles: [keyframeFile],
        receiptFiles: [keyframe.receiptFile],
        execute: async () => {
          videoAdapterCalls += 1;
        },
      }),
      /mudou depois da aprovação|diverge do recibo/,
    );
    assert.equal(videoAdapterCalls, 0);
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["video:scene-a"]
        .attempts,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falha após o limite de efeito fica ambígua e persiste somente erro sanitizado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "effect-failure-sanitized-"));
  try {
    const executionPlan = plan();
    const dbFile = path.join(root, "journal.sqlite");
    const kernel = createExecutionKernel({
      dbFile,
      plan: executionPlan,
      confirmPaid: true,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      actor: "human:effect-failure-test",
    });
    await completeVisualPrerequisites(kernel);
    let simulatedPosts = 0;
    const secret = "DO_NOT_PERSIST_SECRET_123456789";
    await assert.rejects(
      kernel.executePaidNode({
        nodeId: "keyframe:scene-a",
        attemptId: "attempt-sensitive-failure",
        execute: async ({
          attemptId,
          executionEffectAuthorization,
        }) => {
          consumeExecutionEffectAuthorization(
            executionEffectAuthorization,
            {
              provider: "gemini-image",
              operation: "image-generate",
              attemptId,
            },
          );
          simulatedPosts += 1;
          throw new Error(`Authorization: Bearer ${secret}; cookie=${secret}`);
        },
      }),
      new RegExp(secret),
    );
    const snapshot = materializeExecutionSnapshot({ dbFile });
    const node = snapshot.nodes["keyframe:scene-a"];
    assert.equal(node.status, "ambiguous");
    assert.equal(node.attempts, 1);
    assert.doesNotMatch(node.error, new RegExp(secret));
    assert.match(node.error, /<redacted>/);
    const db = new DatabaseSync(dbFile);
    try {
      const attempt = db.prepare(
        "SELECT status FROM attempts WHERE attempt_id=?",
      ).get("attempt-sensitive-failure");
      assert.equal(attempt.status, "ambiguous");
    } finally {
      db.close();
    }
    await assert.rejects(
      kernel.executePaidNode({
        nodeId: "keyframe:scene-a",
        execute: async () => {
          simulatedPosts += 1;
        },
      }),
      /não pode ser autorizado|não autoriza nova tentativa/,
    );
    assert.equal(simulatedPosts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falha de navegação sem handle volta ao plano e não consome o hard limit externo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "effect-pre-navigation-"));
  try {
    const executionPlan = plan();
    const dbFile = path.join(root, "journal.sqlite");
    const kernel = createExecutionKernel({
      dbFile,
      plan: executionPlan,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      actor: "human:pre-navigation-test",
    });
    await completeVisualPrerequisites(kernel);
    const preEffectError = new Error("page.goto: net::ERR_NETWORK_CHANGED at https://provider.invalid/");
    await assert.rejects(
      kernel.executePaidNode({
        nodeId: "keyframe:scene-a",
        attemptId: "attempt-before-navigation",
        execute: async () => { throw preEffectError; },
      }),
      /ERR_NETWORK_CHANGED/,
    );
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"].status, "ambiguous");
    recordNodePreEffectFailure({
      dbFile,
      nodeId: "keyframe:scene-a",
      attemptId: "attempt-before-navigation",
      error: preEffectError,
    });
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"].status, "planned");

    let posts = 0;
    const outputFile = path.join(root, "keyframe.png");
    await kernel.executePaidNode({
      nodeId: "keyframe:scene-a",
      execute: async ({ attemptId, executionEffectAuthorization }) => {
        consumeExecutionEffectAuthorization(executionEffectAuthorization, {
          provider: "gemini-image",
          operation: "image-generate",
          nodeId: "keyframe:scene-a",
          attemptId,
        });
        posts += 1;
        return paidResult({
          file: outputFile,
          kind: "image",
          mimeType: "image/png",
          operation: "image-generate",
          provider: "test",
          content: Buffer.from("image"),
        });
      },
    });
    const recovered = materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"];
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.attempts, 2);
    assert.equal(posts, 1);
    const db = new DatabaseSync(dbFile);
    try {
      assert.equal(db.prepare("SELECT status FROM attempts WHERE attempt_id=?").get("attempt-before-navigation").status, "pre_effect_failed");
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tentativa reconciliada sem aceitação do provedor libera retry sem consumir o hard limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "effect-provider-unaccepted-"));
  try {
    const executionPlan = plan();
    const dbFile = path.join(root, "journal.sqlite");
    const kernel = createExecutionKernel({
      dbFile,
      plan: executionPlan,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      actor: "human:provider-unaccepted-test",
    });
    await completeVisualPrerequisites(kernel);
    const unacceptedError = new Error("O provedor não apresentou operação, clipe ou estado ocupado.");
    await assert.rejects(
      kernel.executePaidNode({
        nodeId: "keyframe:scene-a",
        attemptId: "attempt-provider-unaccepted",
        execute: async () => { throw unacceptedError; },
      }),
      /não apresentou operação/,
    );
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"].status, "ambiguous");
    assert.throws(
      () => recordNodeProviderUnaccepted({
        dbFile,
        nodeId: "keyframe:scene-a",
        attemptId: "attempt-provider-unaccepted",
        error: unacceptedError,
        evidence: {
          zeroPostReconciliation: true,
          providerHandleObserved: false,
          providerBusyObserved: false,
          elapsedMs: 599_999,
        },
      }),
      /Evidência insuficiente/,
    );
    assert.throws(
      () => recordNodeProviderUnaccepted({
        dbFile,
        nodeId: "keyframe:scene-a",
        attemptId: "attempt-provider-unaccepted",
        error: unacceptedError,
        evidence: {
          classification: "correlated-transport-outage",
          zeroPostReconciliation: true,
          providerHandleObserved: false,
          providerBusyObserved: false,
          providerResponseObserved: false,
          correlatedFailureCount: 1,
          correlationWindowMs: 100,
          elapsedMs: 600_000,
        },
      }),
      /Evidência correlacionada insuficiente/,
    );
    recordNodeProviderUnaccepted({
      dbFile,
      nodeId: "keyframe:scene-a",
      attemptId: "attempt-provider-unaccepted",
      error: unacceptedError,
      evidence: {
        classification: "correlated-transport-outage",
        zeroPostReconciliation: true,
        providerHandleObserved: false,
        providerBusyObserved: false,
        providerResponseObserved: false,
        correlatedFailureCount: 3,
        correlationWindowMs: 248,
        elapsedMs: 600_000,
      },
    });
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"].status, "planned");

    let posts = 0;
    const outputFile = path.join(root, "keyframe.png");
    await kernel.executePaidNode({
      nodeId: "keyframe:scene-a",
      execute: async ({ attemptId, executionEffectAuthorization }) => {
        consumeExecutionEffectAuthorization(executionEffectAuthorization, {
          provider: "gemini-image",
          operation: "image-generate",
          nodeId: "keyframe:scene-a",
          attemptId,
        });
        posts += 1;
        return paidResult({
          file: outputFile,
          kind: "image",
          mimeType: "image/png",
          operation: "image-generate",
          provider: "test",
          content: Buffer.from("image"),
        });
      },
    });
    const recovered = materializeExecutionSnapshot({ dbFile }).nodes["keyframe:scene-a"];
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.attempts, 2);
    assert.equal(posts, 1);
    const db = new DatabaseSync(dbFile);
    try {
      assert.equal(
        db.prepare("SELECT status FROM attempts WHERE attempt_id=?").get("attempt-provider-unaccepted").status,
        "provider_unaccepted",
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run e resume canônicos usam o mesmo kernel e preservam pausa humana", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-kernel-"));
  try {
    const executionPlan = plan();
    const planned = await planFilm({
      spec: adaptExecutionPlanToLegacy(executionPlan),
      executionPlan,
      outputsRoot: root,
    });
    const calls = { image: 0, video: 0, assembly: 0 };
    const imageAdapter = {
      async generate(options) {
        consumeExecutionEffectAuthorization(
          options.executionEffectAuthorization,
          {
            provider: "gemini-image",
            operation: "image-generate",
            attemptId: options.attemptId,
          },
        );
        calls.image += 1;
        return paidResult({
          file: options.outputFile,
          kind: "image",
          mimeType: "image/png",
          operation: "generate-image",
          provider: "test",
          content: Buffer.from("canonical-keyframe"),
        });
      },
    };
    const videoAdapter = {
      async generate(options) {
        consumeExecutionEffectAuthorization(
          options.executionEffectAuthorization,
          {
            provider: "gemini-omni",
            operation: "image-to-video",
            attemptId: options.attemptId,
          },
        );
        await options.onProviderHandle?.({
          provider: "test",
          operation: "video-generate",
          attemptId: options.attemptId,
          fileId: "provider-file-test",
        });
        calls.video += 1;
        return {
          ...(await paidResult({
            file: options.outputFile,
            kind: "video",
            mimeType: "video/mp4",
            operation: "generate-video",
            provider: "test",
            content: Buffer.from("canonical-video"),
          })),
          fileId: "provider-file-test",
        };
      },
      async reconcile() {
        assert.fail("reconcile não deve participar da execução normal");
      },
    };
    const operations = {
      imageAdapter,
      videoAdapter,
      async assembleFilm({ outputFile }) {
        calls.assembly += 1;
        return paidResult({
          file: outputFile,
          kind: "video",
          mimeType: "video/mp4",
          operation: "assemble",
          provider: "local-test",
          content: Buffer.from("assembled-video"),
        });
      },
    };
    const confirmation = {
      confirmPaid: true,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      authorizationActor: "human:canonical-kernel-test",
      operations,
    };
    await runFilm({
      stateFile: planned.state.stateFile,
      ...confirmation,
    });
    assert.equal(
      (await statusFilm({ stateFile: planned.state.stateFile })).status,
      "awaiting_approval",
    );
    assert.deepEqual(calls, { image: 1, video: 0, assembly: 0 });

    await approveDraft({ draftFile: planned.state.draftFile });
    await resumeFilm({
      stateFile: planned.state.stateFile,
      ...confirmation,
    });
    assert.equal(
      (await statusFilm({ stateFile: planned.state.stateFile })).status,
      "delivered",
    );
    assert.deepEqual(calls, { image: 1, video: 1, assembly: 1 });

    const journalFile = path.join(
      path.dirname(planned.state.stateFile),
      "execution-journal.sqlite",
    );
    const snapshot = materializeExecutionSnapshot({ dbFile: journalFile });
    assert.equal(snapshot.nodes["keyframe:scene-a"].status, "completed");
    assert.equal(snapshot.nodes["animatic-approval"].status, "completed");
    assert.equal(snapshot.nodes["video:scene-a"].status, "completed");

    await resumeFilm({
      stateFile: planned.state.stateFile,
      ...confirmation,
    });
    assert.deepEqual(calls, { image: 1, video: 1, assembly: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor canônico aprova cartão local e executa cena text_to_video sem imagem", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-text-video-"));
  try {
    const executionPlan = compileFilmSpec({
      name: "canonical-text-video",
      scenes: [{ id: "scene-text", prompt: "Formas azuis se conectam.", motionPrompt: "As formas avançam e se conectam.", onScreenText: "MENSAGEM EXATA", textRendering: "local-gc", generationTask: "text_to_video" }],
      formats: { master: "16:9", variants: [{ format: "9:16", strategy: "fit-pad", approved: false }] },
      qa: false,
      budget: { image: 0, tts: 0, music: 0, omni: 1, semanticQa: 0 },
    });
    assert.equal(executionPlan.governance.executorCompatibility.supported, true);
    const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: root });
    const calls = { video: 0, motion: 0, assembly: 0, variant: 0 };
    let generatedVideoFile = null;
    let motionVideoFile = null;
    let assembledVideoFile = null;
    const operations = {
      videoAdapter: {
        async generate(options) {
          consumeExecutionEffectAuthorization(options.executionEffectAuthorization, {
            provider: "gemini-omni",
            operation: "text-to-video",
            attemptId: options.attemptId,
          });
          assert.equal(options.task, "text_to_video");
          assert.deepEqual(options.images, []);
          assert.deepEqual(options.executionInputReceipts, []);
          calls.video += 1;
          generatedVideoFile = options.outputFile;
          return paidResult({ file: options.outputFile, kind: "video", mimeType: "video/mp4", operation: "generate-video", provider: "test", content: Buffer.from("text-video") });
        },
        async reconcile() {
          assert.fail("reconcile não deve participar da execução normal");
        },
      },
      async renderMotionGraphics({ videoFile, cards, outputFile }) {
        calls.motion += 1;
        assert.equal(videoFile, generatedVideoFile);
        assert.equal(cards[0].text, "MENSAGEM EXATA");
        motionVideoFile = outputFile;
        return paidResult({ file: outputFile, kind: "video", mimeType: "video/mp4", operation: "render-motion-graphics", provider: "local-test", content: Buffer.from("motion-video") });
      },
      async assembleFilm({ sceneFiles, outputFile }) {
        calls.assembly += 1;
        assert.deepEqual(sceneFiles, [motionVideoFile]);
        assembledVideoFile = outputFile;
        return paidResult({ file: outputFile, kind: "video", mimeType: "video/mp4", operation: "assemble", provider: "local-test", content: Buffer.from("assembled") });
      },
      async createVideoVariant({ inputFile, outputFile, format, strategy, cropApproved }) {
        calls.variant += 1;
        assert.equal(inputFile, assembledVideoFile);
        assert.equal(format, "9:16");
        assert.equal(strategy, "fit-pad");
        assert.equal(cropApproved, false);
        return paidResult({ file: outputFile, kind: "video", mimeType: "video/mp4", operation: "create-video-variant", provider: "local-test", content: Buffer.from("vertical") });
      },
    };
    const confirmation = { confirmFingerprint: executionPlan.governance.approval.fingerprint, authorizationActor: "human:canonical-text-video-test", operations };
    await runFilm({ stateFile: planned.state.stateFile, ...confirmation });
    const awaiting = await statusFilm({ stateFile: planned.state.stateFile });
    assert.equal(awaiting.status, "awaiting_approval");
    const draft = JSON.parse(await readFile(planned.state.draftFile, "utf8"));
    assert.ok(draft.scenes[0].keyframeFile.endsWith(".svg"));
    await approveDraft({ draftFile: planned.state.draftFile });
    await resumeFilm({ stateFile: planned.state.stateFile, ...confirmation });
    assert.equal((await statusFilm({ stateFile: planned.state.stateFile })).status, "delivered");
    assert.deepEqual(calls, { video: 1, motion: 1, assembly: 1, variant: 1 });
    const snapshot = materializeExecutionSnapshot({ dbFile: path.join(path.dirname(planned.state.stateFile), "execution-journal.sqlite") });
    assert.equal(snapshot.nodes["keyframe:scene-text"].status, "completed");
    assert.equal(snapshot.nodes["video:scene-text"].status, "completed");
    assert.equal(snapshot.nodes["motion:scene-text"].status, "completed");
    assert.equal(snapshot.nodes.assembly.status, "completed");
    assert.equal(snapshot.nodes.master.status, "completed");
    assert.equal(snapshot.nodes["variant:9x16"].status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pipeline canônico executa narração Omni, alinhamento local e master sem Google Vids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-omni-narration-"));
  try {
    const executionPlan = compileFilmSpec({
      name: "canonical-omni-narration",
      scenes: [{ id: "scene-a", prompt: "Quadro geométrico.", motionPrompt: "Mover lentamente.", duration: 10, generationTask: "image_to_video" }],
      narration: {
        provider: "omni",
        text: "Primeiro bloco. Segundo bloco.",
        voice: "voz brasileira institucional",
        blocks: [
          { id: "primeiro", text: "Primeiro bloco.", seconds: 5 },
          { id: "segundo", text: "Segundo bloco.", seconds: 5 },
        ],
      },
      alignment: { model: "small", language: "pt" },
      qa: false,
      budget: { image: 1, tts: 0, music: 0, omni: 3, semanticQa: 0 },
    });
    const planned = await planFilm({
      spec: adaptExecutionPlanToLegacy(executionPlan),
      executionPlan,
      outputsRoot: root,
    });
    const calls = { image: 0, narration: 0, visual: 0, align: 0, tts: 0, assembly: 0, mix: 0, mux: 0 };
    const operations = {
      imageAdapter: {
        async generate(options) {
          consumeExecutionEffectAuthorization(options.executionEffectAuthorization, {
            provider: "gemini-image",
            operation: "image-generate",
            attemptId: options.attemptId,
          });
          calls.image += 1;
          return paidResult({ file: options.outputFile, kind: "image", mimeType: "image/png", operation: "generate-image", provider: "test", content: Buffer.from("keyframe") });
        },
      },
      videoAdapter: {
        async generate(options) {
          consumeExecutionEffectAuthorization(options.executionEffectAuthorization, {
            provider: "gemini-omni",
            operation: options.task === "text_to_video" ? "text-to-video" : "image-to-video",
            attemptId: options.attemptId,
          });
          if (options.task === "text_to_video") calls.narration += 1;
          else calls.visual += 1;
          return paidResult({ file: options.outputFile, kind: "video", mimeType: "video/mp4", operation: "generate-video", provider: "test", content: Buffer.from(`video:${options.task}`) });
        },
        async reconcile() {
          assert.fail("reconcile não deve participar da execução normal");
        },
      },
      async alignNarrationBlocks({ blocks, masterFile, parentReceipts }) {
        calls.align += 1;
        assert.equal(blocks.length, 2);
        assert.equal(parentReceipts.length, 2);
        const aligned = await paidResult({ file: masterFile, kind: "audio", mimeType: "audio/wav", operation: "align-narration", provider: "local-test", content: Buffer.from("voice-master") });
        return { ...aligned, status: "pass", masterFile };
      },
      async generateTts() {
        calls.tts += 1;
        assert.fail("Google Vids não deve ser chamado.");
      },
      async probeMedia() {
        return { audio: { codec_type: "audio" }, duration: 10 };
      },
      async assembleFilm({ outputFile }) {
        calls.assembly += 1;
        return paidResult({ file: outputFile, kind: "video", mimeType: "video/mp4", operation: "assemble", provider: "local-test", content: Buffer.from("assembled") });
      },
      async mixAudio({ outputFile }) {
        calls.mix += 1;
        return paidResult({ file: outputFile, kind: "audio", mimeType: "audio/wav", operation: "mix", provider: "local-test", content: Buffer.from("mixed-audio") });
      },
      async muxMasterAudio({ outputFile }) {
        calls.mux += 1;
        return paidResult({ file: outputFile, kind: "video", mimeType: "video/mp4", operation: "mux", provider: "local-test", content: Buffer.from("mastered") });
      },
    };
    const confirmation = {
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      authorizationActor: "human:canonical-omni-narration-test",
      operations,
    };
    await runFilm({ stateFile: planned.state.stateFile, ...confirmation });
    assert.equal((await statusFilm({ stateFile: planned.state.stateFile })).status, "awaiting_approval");
    assert.deepEqual(calls, { image: 1, narration: 2, visual: 0, align: 1, tts: 0, assembly: 0, mix: 0, mux: 0 });
    await approveDraft({ draftFile: planned.state.draftFile });
    await resumeFilm({ stateFile: planned.state.stateFile, ...confirmation });
    assert.equal((await statusFilm({ stateFile: planned.state.stateFile })).status, "delivered");
    assert.deepEqual(calls, { image: 1, narration: 2, visual: 1, align: 1, tts: 0, assembly: 1, mix: 1, mux: 1 });
    const journalFile = path.join(path.dirname(planned.state.stateFile), "execution-journal.sqlite");
    const snapshot = materializeExecutionSnapshot({ dbFile: journalFile });
    assert.equal(snapshot.nodes["video:narration:primeiro"].status, "completed");
    assert.equal(snapshot.nodes["video:narration:segundo"].status, "completed");
    assert.equal(snapshot.nodes["voice-master"].status, "completed");
    assert.equal(snapshot.nodes.master.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
