import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  KNOWLEDGE_IMPORT_BATCH_SCHEMA,
  KNOWLEDGE_IMPORT_CANDIDATE_SCHEMA,
  computeKnowledgeImportSourceHash,
  createBrandKitImportCandidate,
  createKnowledgeImportBatch,
  createRecipeImportCandidate,
  createReceiptMetadataImportCandidate,
  createReferenceEvidenceImportCandidate,
  createStyleSpecImportCandidate,
} from "../lib/media-pipeline/knowledge-importers.mjs";
import { createReceipt } from "../lib/media-pipeline/receipt.mjs";
import {
  listKnowledgeSchemas,
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const CREATED_AT = "2026-07-24T12:05:00.000Z";
const OBSERVED_AT = "2026-07-24T12:00:00.000Z";

function governance(overrides = {}) {
  return {
    sourceRef: "style:flat-2d@1",
    rootScopeId: "client:alpha",
    scopeId: "brand:alpha",
    classification: "confidential",
    owner: { type: "brand", id: "brand:alpha" },
    rights: {
      inventory: "allowed",
      localAnalysis: "allowed",
      textualIndexing: "unknown",
    },
    observedAt: OBSERVED_AT,
    createdAt: CREATED_AT,
    createdBy: "reviewer:human",
    ...overrides,
  };
}

function styleSpec(overrides = {}) {
  return {
    schema: "mkt-videos/style-spec@1",
    id: "flat-2d@1",
    label: "Flat 2D",
    direction: "Geometria original, timing legível e movimentos com easing controlado.",
    aspect: "16:9",
    tags: ["motion", "flat"],
    family: "motion-graphics",
    status: "validated",
    studioOnly: true,
    generation: {
      allowedTasks: ["text_to_video"],
      allowedTopologies: ["independent"],
      defaultTopology: "independent",
      continuityRequired: false,
    },
    formats: { allowedAspects: ["16:9"] },
    capabilities: { typography: "supported" },
    runtimeInputs: { requiredRoles: [], maxReferences: 0 },
    validation: {
      model: "gemini-omni-flash-preview",
      checkedAt: "2026-07-23T00:00:00.000Z",
      humanVerdict: "approved",
      aspects: ["16:9"],
      receiptIds: ["receipt-client-alpha-001"],
      notes: ["texto livre que não deve virar metadado de importação"],
    },
    referenceEvidence: [{
      file: String.raw`C:\private\aftermagics-1780457769000.mp4`,
      sha256: HASH_D,
      timeRanges: ["00:00-00:02"],
      usage: "local-study-only",
      rightsStatus: "unknown",
    }],
    risks: ["Não copiar identidade visual de criadores."],
    ...overrides,
  };
}

function brandKit(overrides = {}) {
  return {
    schema: "mkt-videos/brand-kit@1",
    id: "alpha-brand",
    version: 1,
    palette: ["#111111", "#ffffff"],
    typography: { primary: "Inter", fallback: ["Arial", "sans-serif"] },
    logos: [{
      id: "official",
      path: String.raw`C:\private\logo.svg`,
      hash: HASH_D,
      fidelity: "exact",
      requiredForRoles: ["identity"],
    }],
    requiredTerms: ["Alpha"],
    forbiddenTerms: [{ term: "clichê", match: "word" }],
    maxOnScreenWords: 12,
    safeAreas: { "16:9": { left: 0.08, right: 0.08 } },
    captionStyle: "kinetic-word@1",
    motion: { logoTransform: false },
    hash: HASH_B,
    ...overrides,
  };
}

function recipe(overrides = {}) {
  return {
    schema: "mkt-videos/recipe@2",
    operation: "generate-video",
    provider: "omni",
    model: "gemini-omni-flash-preview",
    prompt: "LANÇAMENTO CONFIDENCIAL DO CLIENTE ALPHA",
    task: "text_to_video",
    aspect: "16:9",
    resolution: { width: 1920, height: 1080, outputFile: String.raw`C:\private\master.mp4` },
    timing: { durationSeconds: 8, narrationText: "texto privado" },
    parameters: {
      fps: 30,
      codec: "h264",
      prompt: "outro texto privado",
      negativePrompt: "segredo comercial",
      apiKey: "sk-proj-super-secret-value",
      outputFile: String.raw`C:\private\clip.mp4`,
    },
    inputHashes: [HASH_D, HASH_A],
    preset: { id: "flat-2d@1", hash: HASH_C },
    brandKit: { id: "alpha-brand", hash: HASH_B },
    captionStyle: "kinetic-word@1",
    metadata: {
      receiptId: "client-alpha-receipt-001",
      attemptId: "client-alpha-attempt-002",
      durationSeconds: 8,
      promptComposition: { userPrompt: "material privado" },
      authorization: "Bearer this-must-never-survive",
    },
    hash: HASH_C,
    ...overrides,
  };
}

function referenceIndex(overrides = {}) {
  return {
    schema: "mkt-videos/reference-evidence-index@1",
    generatedAt: OBSERVED_AT,
    root: String.raw`C:\Users\private\VIDEO REFS`,
    fingerprint: HASH_D,
    policy: {
      defaultClassification: "inspiration-evidence",
      defaultUsage: "local-study-only",
      providerInput: "explicit-authorization-required",
      framesInspected: false,
      filesMoved: false,
      filesCopied: false,
      providerCalls: 0,
    },
    videoCount: 1,
    videos: [{
      path: String.raw`C:\Users\private\VIDEO REFS\aftermagics-1780457769000.mp4`,
      relativePath: "aftermagics-1780457769000.mp4",
      sha256: HASH_B,
      classification: "inspiration-evidence",
      usage: "local-study-only",
      providerInputPolicy: "explicit-authorization-required",
      media: {
        format: "mp4",
        durationSeconds: 3.25,
        streams: [{
          codec: "h264",
          width: 1920,
          height: 1080,
          path: String.raw`C:\private\stream`,
        }],
      },
    }],
    ...overrides,
  };
}

test("StyleSpec vira candidato governado sem paths locais nem auto-promoção", () => {
  const candidate = createStyleSpecImportCandidate({
    source: styleSpec(),
    ...governance(),
  });

  assert.equal(candidate.schema, KNOWLEDGE_IMPORT_CANDIDATE_SCHEMA);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.providerFree, true);
  assert.equal(candidate.readOnly, true);
  assert.equal(candidate.recordType, "assertion");
  assert.match(candidate.id, /^kic_[a-f0-9]{32}$/);
  assert.equal(candidate.id.slice(4), candidate.contentHash.slice(0, 32));
  assert.equal(candidate.envelope.classification, "confidential");
  assert.equal(candidate.envelope.owner.id, "brand:alpha");
  assert.equal(candidate.envelope.rights.providerInput, "unknown");
  assert.equal(candidate.envelope.provenance[0].sourceRef, "style:flat-2d@1");
  assert.equal(candidate.payload.direction, styleSpec().direction);
  assert.equal(
    candidate.sourceHash,
    computeKnowledgeImportSourceHash(styleSpec()),
  );
  const changedSource = styleSpec({
    direction: "Direção diferente com o mesmo identificador.",
  });
  const changed = createStyleSpecImportCandidate({
    source: changedSource,
    ...governance(),
  });
  assert.notEqual(changed.sourceHash, candidate.sourceHash);
  assert.throws(
    () => createStyleSpecImportCandidate({
      source: changedSource,
      ...governance({ sourceHash: candidate.sourceHash }),
    }),
    /sourceHash diverge dos bytes canônicos/,
  );
  const serialized = JSON.stringify(candidate);
  assert.doesNotMatch(serialized, /C:\\private/i);
  assert.doesNotMatch(serialized, /receipt-client-alpha-001/);
  assert.doesNotMatch(serialized, /texto livre que não deve virar/i);
  assert.equal(validateKnowledgeContract(candidate).valid, true);
  assert.equal(Object.isFrozen(candidate), true);
});

test("brand-kit preserva restrições úteis, ancora o hash e remove paths de assets", () => {
  const candidate = createBrandKitImportCandidate({
    source: brandKit(),
    ...governance({
      sourceRef: "brand-kit:alpha@1",
    }),
  });

  assert.equal(candidate.sourceSchema, "mkt-videos/brand-kit@1");
  assert.deepEqual(candidate.payload.palette, ["#111111", "#ffffff"]);
  assert.deepEqual(candidate.payload.requiredTerms, ["Alpha"]);
  assert.equal(candidate.payload.logos[0].hash, HASH_D);
  assert.equal(candidate.payload.logos[0].fidelity, "exact");
  assert.doesNotMatch(JSON.stringify(candidate), /logo[.]svg|C:\\private/i);
  assert.throws(() => createBrandKitImportCandidate({
    source: brandKit(),
    ...governance({
      sourceHash: HASH_A,
      sourceRef: "brand-kit:alpha@1",
    }),
  }), /sourceHash diverge/);
});

test("recipe@2 retém somente allowlist técnica, hashes e IDs pseudônimos", () => {
  const candidate = createRecipeImportCandidate({
    source: recipe(),
    ...governance({
      sourceRef: "recipe:semantic-hash-c",
    }),
  });

  assert.equal(candidate.sourceSchema, "mkt-videos/recipe@2");
  assert.equal(candidate.recordType, "evidence");
  assert.equal(candidate.payload.technical.operation, "generate-video");
  assert.equal(candidate.payload.technical.parameters.fps, 30);
  assert.equal(candidate.payload.technical.parameters.codec, "h264");
  assert.deepEqual(candidate.payload.technical.inputHashes, [HASH_A, HASH_D]);
  assert.equal(candidate.payload.technical.brandKitHash, HASH_B);
  assert.equal(candidate.payload.technical.presetHash, HASH_C);
  assert.equal(candidate.payload.technical.identifiers.length, 2);
  assert.equal(candidate.payload.technical.identifiers.every(({ pseudonym }) =>
    /^pid_(?:attempt|receipt)_[a-f0-9]{24}$/.test(pseudonym)), true);

  const serialized = JSON.stringify(candidate);
  for (const forbidden of [
    "LANÇAMENTO CONFIDENCIAL",
    "outro texto privado",
    "segredo comercial",
    "material privado",
    "sk-proj-super-secret-value",
    "Bearer this-must-never-survive",
    "client-alpha-receipt-001",
    "client-alpha-attempt-002",
    String.raw`C:\private`,
  ]) {
    assert.equal(serialized.includes(forbidden), false, `vazamento detectado: ${forbidden}`);
  }
  assert.equal(candidate.payload.sanitization.promptRemoved, true);
  assert.equal(candidate.payload.sanitization.privateTextRemoved, true);
});

test("receipt/archive metadata preserva prova técnica sem prompt, paths ou resposta privada", () => {
  const source = createReceipt({
    operation: "generate-video",
    provider: "omni",
    model: "gemini-omni-flash-preview",
    prompt: "CAMPANHA PRIVADA CLIENTE ALPHA",
    parameters: {
      task: "text_to_video",
      aspect: "16:9",
      fps: 24,
      apiKey: "sk-proj-never-import-this",
      outputFile: String.raw`C:\private\master.mp4`,
    },
    inputs: [{
      file: String.raw`C:\private\input.png`,
      hash: { algorithm: "sha256", value: HASH_A },
    }],
    artifacts: [{
      file: String.raw`C:\private\output.mp4`,
      hash: { algorithm: "sha256", value: HASH_B },
    }],
    providerResponse: {
      interactionId: "private-interaction-id",
      authorization: "Bearer must-not-survive",
    },
    metadata: {
      clientName: "Cliente Alpha Privado",
      probe: {
        duration: 8,
        streams: [{ width: 1920, height: 1080, codec: "h264" }],
      },
    },
    timings: { durationMs: 8_000 },
    startedAt: OBSERVED_AT,
    completedAt: CREATED_AT,
  });
  const candidate = createReceiptMetadataImportCandidate({
    source,
    ...governance({
      sourceRef: "receipt:archive-entry-001",
    }),
  });

  assert.equal(candidate.sourceKind, "receipt-metadata");
  assert.equal(candidate.sourceSchema, "mkt-videos/receipt@1");
  assert.equal(candidate.recordType, "evidence");
  assert.equal(candidate.payload.technical.operation, "generate-video");
  assert.equal(candidate.payload.technical.task, "text_to_video");
  assert.deepEqual(candidate.payload.technical.inputHashes, [HASH_A]);
  assert.deepEqual(candidate.payload.technical.artifactHashes, [HASH_B]);
  assert.equal(candidate.payload.technical.receiptHash, source.hash.value);
  assert.match(
    candidate.payload.technical.receiptId,
    /^pid_receipt_[a-f0-9]{24}$/,
  );
  const serialized = JSON.stringify(candidate);
  for (const forbidden of [
    "CAMPANHA PRIVADA",
    "Cliente Alpha Privado",
    "private-interaction-id",
    "Bearer must-not-survive",
    "sk-proj-never-import-this",
    String.raw`C:\private`,
    source.id,
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `vazamento de receipt detectado: ${forbidden}`,
    );
  }
  assert.equal(candidate.payload.sanitization.promptRemoved, true);
  assert.equal(candidate.payload.sanitization.providerResponseRemoved, true);
});

test("reference-evidence perde caminhos e criador, permanece local-study-only e providerInput denied", () => {
  const candidate = createReferenceEvidenceImportCandidate({
    source: referenceIndex(),
    ...governance({
      sourceRef: "reference-index:motion-library@1",
      rights: {
        inventory: "allowed",
        localAnalysis: "allowed",
        textualIndexing: "unknown",
      },
    }),
  });

  assert.equal(candidate.envelope.rights.providerInput, "denied");
  assert.equal(candidate.payload.antiImitation.providerInputAllowed, false);
  assert.equal(candidate.payload.antiImitation.creatorIdentifiersRetained, false);
  assert.equal(candidate.payload.antiImitation.allowedUse, "abstract-principles-only");
  assert.equal(candidate.payload.evidence[0].sha256, HASH_B);
  assert.equal(candidate.payload.evidence[0].providerInputPolicy, "explicit-authorization-required");
  assert.equal(candidate.payload.evidence[0].media.streams[0].codec, "h264");
  const serialized = JSON.stringify(candidate);
  assert.doesNotMatch(serialized, /aftermagics|VIDEO REFS|C:\\Users|relativePath|\"path\"/i);

  assert.throws(() => createReferenceEvidenceImportCandidate({
    source: referenceIndex(),
    ...governance({
      sourceRef: "reference-index:motion-library@1",
      rights: { inventory: "allowed", providerInput: "allowed" },
    }),
  }), /nunca pode autorizar provider-input/);
});

test("material sensível em campos preservados falha sem ecoar o segredo", () => {
  const secret = "api_key=ultra-private-value";
  assert.throws(
    () => createStyleSpecImportCandidate({
      source: styleSpec({ direction: secret }),
      ...governance(),
    }),
    (error) => /sensível proibido/.test(error.message) && !error.message.includes(secret),
  );
  assert.throws(
    () => createBrandKitImportCandidate({
      source: brandKit({ typography: { primary: secret } }),
      ...governance({
        sourceRef: "brand-kit:alpha@1",
      }),
    }),
    (error) => /sensível proibido/.test(error.message) && !error.message.includes(secret),
  );
});

test("batch deduplica somente igualdade exata e reporta divergência sem escolher", () => {
  const original = createStyleSpecImportCandidate({
    source: styleSpec(),
    ...governance(),
  });
  const divergent = createStyleSpecImportCandidate({
    source: styleSpec({ direction: "Direção editorial alternativa." }),
    ...governance(),
  });
  const first = createKnowledgeImportBatch({
    candidates: [original, original, divergent],
  });
  const repeatedInAnotherOrder = createKnowledgeImportBatch({
    candidates: [divergent, original, original],
  });

  assert.deepEqual(first, repeatedInAnotherOrder);
  assert.equal(first.schema, KNOWLEDGE_IMPORT_BATCH_SCHEMA);
  assert.equal(first.status, "candidate");
  assert.equal(first.changed, false);
  assert.equal(first.inputCount, 3);
  assert.equal(first.candidateCount, 2);
  assert.equal(first.duplicateCount, 1);
  assert.deepEqual(first.duplicates, [{
    candidateId: original.id,
    contentHash: original.contentHash,
    count: 2,
  }]);
  assert.equal(first.conflictCount, 1);
  assert.equal(first.conflicts[0].type, "same-source-divergent-content");
  assert.deepEqual(
    new Set(first.conflicts[0].candidateIds),
    new Set([original.id, divergent.id]),
  );
  assert.equal(first.id.slice(4), first.contentHash.slice(0, 32));
  assert.equal(validateKnowledgeContract(first).valid, true);
});

test("batch não cruza root owner e reporta owner/scope ambíguo dentro do mesmo root", () => {
  const brandAlpha = createStyleSpecImportCandidate({
    source: styleSpec(),
    ...governance(),
  });
  const brandBeta = createStyleSpecImportCandidate({
    source: styleSpec(),
    ...governance({
      scopeId: "brand:beta",
      owner: { type: "brand", id: "brand:beta" },
    }),
  });
  const sameRoot = createKnowledgeImportBatch({
    candidates: [brandAlpha, brandBeta],
  });
  assert.equal(sameRoot.candidateCount, 2);
  assert.equal(sameRoot.conflictCount, 1);
  assert.equal(sameRoot.conflicts[0].type, "owner-scope-conflict");

  const otherRoot = createStyleSpecImportCandidate({
    source: styleSpec(),
    ...governance({
      rootScopeId: "client:beta",
      scopeId: "brand:beta",
      owner: { type: "brand", id: "brand:beta" },
    }),
  });
  assert.throws(
    () => createKnowledgeImportBatch({ candidates: [brandAlpha, otherRoot] }),
    /não pode atravessar rootScopeId/,
  );
});

test("importadores são síncronos, provider-free e não alteram filesystem ou persistência", async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "mkt-knowledge-importers-"));
  try {
    const before = await readdir(scratch);
    const candidate = createRecipeImportCandidate({
      source: recipe(),
      ...governance({
        sourceRef: "recipe:semantic-hash-c",
      }),
    });
    const mutableCandidate = structuredClone(candidate);
    assert.equal(Object.isFrozen(mutableCandidate), false);
    const batch = createKnowledgeImportBatch({ candidates: [mutableCandidate] });
    const after = await readdir(scratch);
    assert.deepEqual(after, before);
    assert.equal(Object.isFrozen(mutableCandidate), false);
    assert.equal(batch.providerFree, true);
    assert.equal(batch.readOnly, true);
    assert.equal(batch.changed, false);

    const moduleSource = await readFile(
      new URL("../lib/media-pipeline/knowledge-importers.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      moduleSource,
      /(?:node:fs|sqlite|playwright|child_process|fetch\s*\(|https?:\/\/)/i,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("registry autodescobre os dois contratos novos", () => {
  const ids = new Set(listKnowledgeSchemas().map(({ id }) => id));
  assert.equal(ids.has(KNOWLEDGE_IMPORT_CANDIDATE_SCHEMA), true);
  assert.equal(ids.has(KNOWLEDGE_IMPORT_BATCH_SCHEMA), true);
});
