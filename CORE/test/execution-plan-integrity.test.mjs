import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptExecutionPlanToLegacy, compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, readFilmPlan } from "../lib/media-pipeline/film-orchestrator.mjs";
import { assertPaidExecutionAuthorized } from "../lib/media-pipeline/studio-governance.mjs";
import { PROVIDER_CAPABILITIES } from "../lib/media-pipeline/provider-registry.mjs";

function legacySpec() {
  return {
    name: "integridade-plano",
    aspect: "16:9",
    style: "flat-2d@1",
    scenes: [{
      id: "a",
      prompt: "Geometria original em movimento.",
      motionPrompt: "Formas deslizam com ritmo próprio.",
    }],
    qa: false,
  };
}

test("integridade de execução rejeita referência injetada após compile com fingerprint antigo", () => {
  const plan = compileFilmSpec(legacySpec());
  const approvedFingerprint = plan.governance.approval.fingerprint;
  plan.spec.scenes[0].references.push(String.raw`C:\entrada-injetada.png`);

  assert.throws(
    () => assertPaidExecutionAuthorized(plan, {
      
      confirmFingerprint: approvedFingerprint,
    }),
    /Integridade canônica.*(?:runtimeReferencePolicy\.evidenceReferences|fingerprint de aprovação)/,
  );
});

test("execution-plan canônico nunca rebaixa para legado se governance for removida", () => {
  const plan = compileFilmSpec(legacySpec());
  delete plan.governance;
  assert.throws(
    () => assertPaidExecutionAuthorized(plan, {}),
    /sem execution-governance@1 válido/,
  );
  assert.deepEqual(assertPaidExecutionAuthorized({ schema: "mkt-videos/film-plan@1" }), { legacy: true });
});

test("autorização rejeita dependência de nó adulterada com approval antigo", () => {
  const plan = compileFilmSpec(legacySpec());
  const approvedFingerprint = plan.governance.approval.fingerprint;
  const video = plan.nodes.find((node) => node.id === "video:a");
  video.dependencies = ["animatic-approval"];

  assert.throws(
    () => assertPaidExecutionAuthorized(plan, {
      
      confirmFingerprint: approvedFingerprint,
    }),
    /Integridade canônica.*fingerprint de aprovação/,
  );
});

test("leitor rejeita adulteração tanto no spec executor quanto no execution plan aninhado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-plan-integrity-"));
  try {
    const executionPlan = compileFilmSpec(legacySpec());
    const planned = await planFilm({
      spec: adaptExecutionPlanToLegacy(executionPlan),
      outputsRoot: root,
      executionPlan,
    });
    const planFile = planned.plan.files.planFile;
    const original = JSON.parse(await readFile(planFile, "utf8"));
    // This fixture is compiled with the static registry. Read it with the same
    // registry; a recipient's local capability evidence is unrelated to tampering.
    const readOptions = { providerCapabilities: PROVIDER_CAPABILITIES };
    assert.equal((await readFilmPlan(planFile, readOptions)).fingerprint, original.fingerprint);

    const legacyTamper = structuredClone(original);
    legacyTamper.spec.draft.scenes[0].references.push(String.raw`C:\entrada-injetada.png`);
    await writeFile(planFile, JSON.stringify(legacyTamper));
    await assert.rejects(readFilmPlan(planFile, readOptions), /Plano de filme adulterado: fingerprint canônico divergente/);

    const canonicalTamper = structuredClone(original);
    canonicalTamper.executionPlan.spec.scenes[0].references.push(String.raw`C:\entrada-injetada.png`);
    await writeFile(planFile, JSON.stringify(canonicalTamper));
    await assert.rejects(
      readFilmPlan(planFile, readOptions),
      /Integridade canônica.*(?:runtimeReferencePolicy\.evidenceReferences|fingerprint de aprovação)/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
