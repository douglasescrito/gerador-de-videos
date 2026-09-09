import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFilmSpec, migrateFilmSpecV1 } from "../lib/media-pipeline/film-compiler.mjs";
import {
  createProviderInputAuthorization,
  scanReferenceLibrary,
  writeProviderInputAuthorization,
  writeReferenceIndex,
} from "../lib/media-pipeline/reference-governance.mjs";
import {
  assertPaidExecutionAuthorized,
  createExecutionGovernance,
  estimateExecutionPlanFromReceipts,
  verifyExecutionReferenceAuthorizations,
} from "../lib/media-pipeline/studio-governance.mjs";

function minimalLegacy(overrides = {}) {
  return {
    name: "governance",
    aspect: "16:9",
    style: "flat-2d@1",
    scenes: [{ id: "a", prompt: "Geometria original em movimento.", motionPrompt: "Formas deslizam com ritmo próprio." }],
    qa: false,
    ...overrides,
  };
}

test("plano validado expõe teto exato e confirmação presa ao fingerprint", () => {
  const plan = compileFilmSpec(minimalLegacy());
  assert.equal(plan.governance.schema, "mkt-videos/execution-governance@1");
  assert.deepEqual(plan.governance.paidCalls.map(({ provider, count }) => ({ provider, count })), [
    { provider: "gemini-image", count: 1 },
    { provider: "gemini-omni", count: 1 },
  ]);
  assert.equal(plan.governance.paidCallCeiling, 2);
  assert.equal(plan.governance.readyForPaidExecution, true);
  assert.equal(plan.governance.promptComposition[0].visual.userPrompt, "Geometria original em movimento.");
  assert.match(plan.governance.promptComposition[0].visual.effectivePrompt, /User direction, preserved literally/);
  assert.throws(() => assertPaidExecutionAuthorized(plan, { confirmPaid: true, confirmFingerprint: "errado" }), /fingerprint/);
  assert.equal(assertPaidExecutionAuthorized(plan, {
    confirmPaid: true,
    confirmFingerprint: plan.governance.approval.fingerprint,
  }).paidCallCeiling, 2);
});

test("mudança semântica ou no boundary executável altera aprovação", () => {
  const first = migrateFilmSpecV1(minimalLegacy());
  const second = structuredClone(first);
  second.execution.concurrency.video = 1;
  assert.notEqual(
    compileFilmSpec(first).governance.approval.fingerprint,
    compileFilmSpec(second).governance.approval.fingerprint,
  );
  second.scenes[0].motionPrompt = "Outra gramática de movimento.";
  assert.notEqual(
    compileFilmSpec(first).governance.approval.fingerprint,
    compileFilmSpec(second).governance.approval.fingerprint,
  );
});

test("concept streaks planeja uma única Omni, keyframe e permanece no portão humano", () => {
  const spec = migrateFilmSpecV1(minimalLegacy({ style: "produto/streaks-de-luz@1" }));
  spec.source.directionPreset = "produto/streaks-de-luz@1";
  spec.scenes[0].style = "produto/streaks-de-luz@1";
  spec.scenes[0].generationTask = "image_to_video";
  const plan = compileFilmSpec(spec);
  assert.deepEqual(plan.governance.paidCalls.map(({ provider, operation, count }) => ({ provider, operation, count })), [
    { provider: "gemini-image", operation: "image-generate", count: 1 },
    { provider: "gemini-omni", operation: "image-to-video", count: 1 },
  ]);
  assert.equal(plan.governance.paidCallCeiling, 2);
  assert.equal(plan.governance.paidCalls.find((entry) => entry.provider === "gemini-omni").count, 1);
  assert.ok(plan.governance.blockers.some((entry) => entry.code === "style_pilot_authorization_required"));
  assert.equal(plan.governance.executorCompatibility.supported, true);
  assert.equal(assertPaidExecutionAuthorized(plan, {
    confirmPaid: true,
    confirmFingerprint: plan.governance.approval.fingerprint,
    allowConceptPilot: true,
  }).conceptPilot, true);
});

test("encadeamento nunca nasce implicitamente e prompt imitativo bloqueia antes do POST", () => {
  const chained = migrateFilmSpecV1(minimalLegacy());
  chained.execution.topology = "chained";
  const explicit = compileFilmSpec(chained);
  assert.equal(explicit.governance.topology.explicit, true);
  assert.equal(explicit.governance.topology.default, "chained");
  assert.ok(!explicit.governance.blockers.some((entry) => entry.code === "implicit_chaining"));

  const imitative = minimalLegacy();
  imitative.scenes[0].prompt = "Faça no estilo de @criador.";
  assert.ok(compileFilmSpec(imitative).governance.blockers.some((entry) => entry.code === "anti_imitation_lint"));
});

test("evidência de capacidade vencida falha fechado", () => {
  const plan = compileFilmSpec(minimalLegacy());
  const stale = createExecutionGovernance(plan, { now: new Date("2026-09-25T00:00:00.000Z") });
  assert.ok(stale.blockers.some((entry) => entry.code === "provider_health_stale" && entry.provider === "gemini-omni"));
  assert.equal(stale.readyForPaidExecution, false);
});

test("toda referência Studio, inclusive fora da raiz histórica, exige direitos canônicos", async () => {
  const spec = minimalLegacy();
  spec.scenes[0].references = [
    String.raw`C:\fora-da-biblioteca-historica\ref.mp4`,
    "referencia-relativa.png",
  ];
  const plan = compileFilmSpec(spec);
  assert.equal(plan.governance.runtimeReferencePolicy.evidenceReferences.length, 2);
  assert.equal(
    plan.governance.blockers.filter((entry) => entry.code === "canonical_provider_input_rights_required").length,
    2,
  );
  assert.ok(plan.governance.blockers.every((entry) => (
    entry.code !== "canonical_provider_input_rights_required"
    || entry.message.includes("canonical providerInput rights required")
  )));
  const preflight = await verifyExecutionReferenceAuthorizations(plan);
  assert.ok(preflight.governance.blockers.some((entry) => entry.code === "reference_index_required"));
  assert.equal(preflight.governance.runtimeReferencePolicy.defaultProviderInputAllowed, false);
  assert.equal(preflight.governance.runtimeReferencePolicy.canonicalProviderInputRightsSatisfied, false);
});

test("sidecar legado válido permanece report-only e nunca autoriza execução paga", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mkt-studio-sidecar-"));
  try {
    const referenceRoot = path.join(directory, "refs");
    const reference = path.join(referenceRoot, "reference.mp4");
    await mkdir(referenceRoot, { recursive: true });
    await writeFile(reference, "reference");
    const index = await scanReferenceLibrary({
      root: referenceRoot,
      probe: async () => ({
        format: { format_name: "mp4", duration: "1", size: "9", bit_rate: "72" },
        streams: [],
      }),
      now: new Date("2026-07-24T12:00:00.000Z"),
    });
    const indexFile = path.join(directory, "reference-index.json");
    await writeReferenceIndex(indexFile, index);
    const authorization = createProviderInputAuthorization({
      index,
      reference,
      actor: "Ana",
      scope: "film:governance",
      role: "visual-reference",
      operation: "image-to-video",
      confirmed: true,
      issuedAt: new Date("2026-07-24T12:05:00.000Z"),
    });
    const authorizationFile = path.join(directory, "provider-input.json");
    await writeProviderInputAuthorization(authorizationFile, authorization);

    const spec = minimalLegacy();
    spec.scenes[0].references = [reference];
    spec.scenes[0].referenceAuthorizations = [{ file: authorizationFile, role: "visual-reference" }];
    const plan = compileFilmSpec(spec);
    const approvalFingerprint = plan.governance.approval.fingerprint;
    const preflight = await verifyExecutionReferenceAuthorizations(plan, {
      referenceIndexFile: indexFile,
      now: new Date("2026-07-24T12:10:00.000Z"),
    });

    assert.equal(preflight.governance.runtimeReferencePolicy.verifiedAuthorizations.length, 0);
    assert.deepEqual(preflight.governance.runtimeReferencePolicy.legacySidecarReport, {
      status: "validated",
      effect: "report-only",
      checkedReferences: 1,
      verifiedReferences: 1,
      entries: [{
        id: authorization.id,
        sceneId: "a",
        referenceSha256: index.videos[0].sha256,
        role: "visual-reference",
        operation: "image-to-video",
        actor: "Ana",
        issuedAt: "2026-07-24T12:05:00.000Z",
      }],
    });
    assert.equal(preflight.governance.approval.fingerprint, approvalFingerprint);
    assert.equal(preflight.governance.readyForPaidExecution, false);
    assert.ok(preflight.governance.blockers.some((entry) => entry.code === "canonical_provider_input_rights_required"));
    assert.throws(
      () => assertPaidExecutionAuthorized(preflight, {
        confirmPaid: true,
        confirmFingerprint: approvalFingerprint,
        now: new Date("2026-07-24T12:10:00.000Z"),
      }),
      /canonical_provider_input_rights_required/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ETA só aparece com amostra histórica suficiente e informa p50-p90", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-governance-eta-"));
  try {
    const receipts = path.join(root, "colecao", "receitas");
    await mkdir(receipts, { recursive: true });
    const durations = [1_000, 2_000, 3_000];
    for (const [index, duration] of durations.entries()) {
      for (const provider of ["gemini-image-endpoint", "gemini-omni"]) {
        const startedAt = new Date(Date.UTC(2026, 6, 20, 12, 0, index)).toISOString();
        const completedAt = new Date(Date.parse(startedAt) + duration).toISOString();
        await writeFile(path.join(receipts, `${provider}-${index}.receipt.json`), JSON.stringify({
          id: `${provider}-${index}`,
          operation: provider.includes("image") ? "generate-image" : "generate-video",
          provider,
          startedAt,
          completedAt,
        }));
      }
    }
    const planned = compileFilmSpec(minimalLegacy());
    const approvalFingerprint = planned.governance.approval.fingerprint;
    const enriched = await estimateExecutionPlanFromReceipts(planned, { root, minSamples: 3 });
    assert.equal(enriched.governance.eta.status, "available");
    assert.equal(enriched.governance.eta.providers.length, 2);
    assert.ok(enriched.governance.eta.total.p90Ms >= enriched.governance.eta.total.p50Ms);
    assert.equal(enriched.governance.approval.fingerprint, approvalFingerprint);
    assert.equal(assertPaidExecutionAuthorized(enriched, {
      confirmPaid: true,
      confirmFingerprint: approvalFingerprint,
    }).fingerprint, approvalFingerprint);

    const unavailable = await estimateExecutionPlanFromReceipts(compileFilmSpec(minimalLegacy()), { root, minSamples: 4 });
    assert.equal(unavailable.governance.eta.status, "unavailable");
    assert.equal(unavailable.governance.eta.total, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
