import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  resolveStyleSpec,
} from "../lib/media-pipeline/direction-presets.mjs";
import {
  referenceRightsItemId,
  resolveEffectiveRights,
} from "../lib/media-pipeline/knowledge-effective-rights.mjs";
import {
  buildReferenceTechniqueCandidate,
} from "../lib/media-pipeline/knowledge-reference-technique-candidate.mjs";
import {
  buildReferenceTechniqueMaterialization,
  validateReferenceTechniqueMaterialization,
} from "../lib/media-pipeline/knowledge-reference-technique-materialization.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";

const NOW = "2026-07-24T15:00:00.000Z";
const ROOT = "client:a";
const SCOPE = "project:film-a";
const ACTOR = "human:reviewer";
const PROTECTED_TERMS = Object.freeze([
  "Autor Protegido",
  "Marca Reservada",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  return value;
}

function hashBody(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function rehashCandidate(value) {
  const copy = structuredClone(value);
  delete copy.candidateHash;
  return {
    ...copy,
    candidateHash: hashBody(copy),
  };
}

function rehashEffectiveRights(value) {
  const copy = structuredClone(value);
  delete copy.decisionHash;
  return {
    ...copy,
    decisionHash: hashBody(copy),
  };
}

function permissions({
  localAnalysis = "allowed",
  textualIndexing = "allowed",
} = {}) {
  return {
    inventory: "allowed",
    localAnalysis,
    textualIndexing,
    embedding: "denied",
    training: "denied",
    providerInput: "denied",
    publication: "unknown",
    reuse: "unknown",
  };
}

function envelope(rights, sourceRef, actor = "human:operator") {
  return createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: { type: "client", id: ROOT },
    provenance: [{
      sourceType: "human-attestation",
      sourceRef,
      method: "human-attestation",
      observedAt: NOW,
      contentHash: "a".repeat(64),
    }],
    modality: "hard-constraint",
    evidenceIds: [],
    retention: {
      policy: "manual-review",
      expiresAt: null,
      basis: "Revisão humana explícita.",
    },
    rights,
    createdAt: NOW,
    createdBy: actor,
  }, { expectedActor: actor });
}

function itemReference(item) {
  return {
    schema: "mkt-videos/knowledge-reference@1",
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
  };
}

function targetFixture(rights = permissions()) {
  const body = {
    schema: "mkt-videos/knowledge-item@1",
    id: "reference-asset:kra_0123456789abcdef0123456789abcdef",
    revision: 1,
    rootScopeId: ROOT,
    scopeId: SCOPE,
    recordType: "entity",
    schemaId: "mkt-videos/entity-profile@1",
    schemaVersion: 1,
    status: "active",
    governance: envelope(rights, "attestation:reference-a"),
    supersedesRevision: null,
    payload: {
      schema: "mkt-videos/entity-profile@1",
      entityType: "reference-asset",
      name: "Referência governada A",
      aliases: [],
      attributes: {
        rootAlias: "private-reference-library",
        logicalPath: "cohort/reference-a.mp4",
        fileSha256: "b".repeat(64),
        bytes: 42,
        mediaType: "video/mp4",
      },
      evidenceRefs: [],
    },
    createdAt: NOW,
    createdBy: "human:operator",
  };
  return {
    ...body,
    contentHash: hashBody(body),
  };
}

function rightsFixture(target, rights = permissions()) {
  const body = {
    schema: "mkt-videos/knowledge-item@1",
    id: referenceRightsItemId(target),
    revision: 1,
    rootScopeId: target.rootScopeId,
    scopeId: target.scopeId,
    recordType: "rights",
    schemaId: "mkt-videos/rights-record@1",
    schemaVersion: 1,
    status: "active",
    governance: envelope(rights, "attestation:rights-a"),
    supersedesRevision: null,
    payload: {
      schema: "mkt-videos/rights-record@1",
      targetRef: itemReference(target),
      permissions: rights,
      basis: "Atestação humana presa ao asset exato.",
      validFrom: NOW,
      expiresAt: null,
      evidenceRefs: [],
    },
    createdAt: NOW,
    createdBy: "human:operator",
  };
  return {
    ...body,
    contentHash: hashBody(body),
  };
}

function analysisFixture() {
  return {
    segments: [
      {
        startMs: 0,
        endMs: 900,
        observations: [{
          domain: "motion",
          statement:
            "A aceleração ocupa o primeiro terço e estabiliza antes do corte.",
        }],
      },
      {
        startMs: 900,
        endMs: 1800,
        observations: [
          {
            domain: "transition",
            statement:
              "A oclusão geométrica encobre a troca de plano por 120 ms.",
          },
          {
            domain: "timing",
            statement:
              "O segundo evento começa após a estabilização do primeiro.",
          },
        ],
      },
    ],
    technique: {
      title: "Troca de plano por oclusão temporal",
      principle:
        "Uma forma em primeiro plano pode ocultar uma descontinuidade.",
      mechanism:
        "Expandir a forma até cobrir o quadro, trocar o conteúdo durante a cobertura e revelar o novo estado com desaceleração.",
      applicability: [
        "Transições entre planos com geometria compatível.",
      ],
      constraints: [
        "A cobertura deve ocupar todo o quadro por pelo menos um frame.",
      ],
      failureModes: [
        "Lacunas na cobertura expõem a descontinuidade.",
      ],
    },
  };
}

function styleSpecFixture() {
  return resolveStyleSpec("aquarela-2d@1", {
    allowConcept: true,
    allowDeprecated: true,
  });
}

function governedFixture(rights = permissions()) {
  const targetItem = targetFixture(rights);
  const rightsItem = rightsFixture(targetItem, rights);
  const effectiveRights = resolveEffectiveRights({
    targetItem,
    rightsItems: [rightsItem],
    at: NOW,
  });
  const candidate = buildReferenceTechniqueCandidate({
    targetItem,
    effectiveRights,
    adapterAnalysis: analysisFixture(),
    protectedTerms: PROTECTED_TERMS,
  });
  return {
    targetItem,
    rightsItem,
    effectiveRights,
    candidate,
  };
}

function buildOptions(governed = governedFixture(), overrides = {}) {
  const styleSpec = styleSpecFixture();
  return {
    ...governed,
    protectedTerms: PROTECTED_TERMS,
    rootScopeId: ROOT,
    scopeId: SCOPE,
    actor: ACTOR,
    materializedAt: NOW,
    queueReview: {
      confirmHuman: true,
      expectedCandidateHash: governed.candidate.candidateHash,
      approvedBy: ACTOR,
      decidedAt: NOW,
    },
    styleSpecBinding: {
      styleSpecId: styleSpec.id,
      styleSpecHash: hashBody(styleSpec),
    },
    ...overrides,
  };
}

test("materializa ordem flat determinística e somente knowledge candidates", () => {
  const governed = governedFixture();
  const options = buildOptions(governed);
  const before = structuredClone(options);
  const first = buildReferenceTechniqueMaterialization(options);
  const second = buildReferenceTechniqueMaterialization(options);

  assert.deepEqual(first, second);
  assert.equal(first.materializationHash, second.materializationHash);
  assert.deepEqual(options, before);
  assert.equal(first.providerFree, true);
  assert.equal(first.persisted, false);
  assert.equal(first.status, "candidate");
  assert.equal(first.activeRulesCreated, 0);
  assert.ok(first.items.every(({ status }) => status === "candidate"));
  assert.ok(first.items.every(({ governance }) =>
    governance.rights.embedding === "denied"
    && governance.rights.training === "denied"
    && governance.rights.providerInput === "denied"));
  assert.deepEqual(first.items, [
    ...first.segmentItems,
    first.techniqueItem,
    ...first.observationItems,
    first.decisionItem,
    first.styleAssertionItem,
  ]);
  assert.equal(first.segmentItems.length, 2);
  assert.equal(first.observationItems.length, 3);
  assert.match(
    first.segmentItems[0].id,
    /^reference-segment:[a-f0-9]{32}$/u,
  );
  assert.match(
    first.techniqueItem.id,
    /^reference-technique:[a-f0-9]{32}$/u,
  );
  assert.equal(
    first.decisionItem.payload.impact.promoted,
    false,
  );
  assert.equal(
    first.styleAssertionItem.payload.value.styleSpecId,
    options.styleSpecBinding.styleSpecId,
  );
  assert.equal(
    first.styleAssertionItem.payload.value.styleSpecHash,
    options.styleSpecBinding.styleSpecHash,
  );
  assert.equal(
    first.styleAssertionItem.payload.value.activatesRule,
    false,
  );
  assert.deepEqual(first.persistenceExpectedHeads, [
    {
      rootScopeId: governed.targetItem.rootScopeId,
      id: governed.targetItem.id,
      revision: governed.targetItem.revision,
      contentHash: governed.targetItem.contentHash,
      status: governed.targetItem.status,
      schemaId: governed.targetItem.schemaId,
    },
    {
      rootScopeId: governed.targetItem.rootScopeId,
      id: governed.effectiveRights.rightsHead.id,
      revision: governed.effectiveRights.rightsHead.revision,
      contentHash: governed.effectiveRights.rightsHead.contentHash,
      status: governed.effectiveRights.rightsHead.status,
      schemaId: "mkt-videos/rights-record@1",
    },
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(
    validateReferenceTechniqueMaterialization(first, options),
    first,
  );
  const tamperedPrecondition = structuredClone(first);
  tamperedPrecondition.persistenceExpectedHeads[1].contentHash =
    "f".repeat(64);
  delete tamperedPrecondition.materializationHash;
  tamperedPrecondition.materializationHash = hashBody(
    tamperedPrecondition,
  );
  assert.throws(
    () => validateReferenceTechniqueMaterialization(
      tamperedPrecondition,
      options,
    ),
    /diverge da projeção canônica/,
  );
});

test("localAnalysis allowed sozinho é insuficiente sem textualIndexing allowed", () => {
  for (const textualIndexing of ["unknown", "denied"]) {
    const governed = governedFixture(permissions({ textualIndexing }));
    assert.equal(
      governed.effectiveRights.permissions.localAnalysis.state,
      "allowed",
    );
    assert.equal(
      governed.effectiveRights.permissions.textualIndexing.state,
      textualIndexing,
    );
    assert.throws(
      () => buildReferenceTechniqueMaterialization(
        buildOptions(governed),
      ),
      /textualIndexing/,
    );
  }
});

test("lint anti-imitação é revalidado antes de criar qualquer item", () => {
  const governed = governedFixture();
  const protectedCandidate = structuredClone(governed.candidate);
  protectedCandidate.techniqueCard.title =
    "Movimento da Marca Reservada";
  const tampered = rehashCandidate(protectedCandidate);

  assert.throws(
    () => buildReferenceTechniqueMaterialization(buildOptions({
      ...governed,
      candidate: tampered,
    }, {
      queueReview: null,
      styleSpecBinding: null,
    })),
    /termo protegido/,
  );
});

test("hash, target, rights e StyleSpec precisam ser vínculos exatos", () => {
  const governed = governedFixture();

  assert.throws(
    () => buildReferenceTechniqueMaterialization(buildOptions({
      ...governed,
      candidate: {
        ...structuredClone(governed.candidate),
        candidateHash: "0".repeat(64),
      },
    })),
    /candidateHash inválido/,
  );

  const wrongTarget = structuredClone(governed.candidate);
  wrongTarget.sourceTarget.id = "reference-asset:other";
  assert.throws(
    () => buildReferenceTechniqueMaterialization(buildOptions({
      ...governed,
      candidate: rehashCandidate(wrongTarget),
    })),
    /reference target exato/,
  );

  const wrongRights = structuredClone(governed.candidate);
  wrongRights.rightsDecision.decisionHash = "f".repeat(64);
  assert.throws(
    () => buildReferenceTechniqueMaterialization(buildOptions({
      ...governed,
      candidate: rehashCandidate(wrongRights),
    })),
    /decisão efetiva de direitos/,
  );

  const forgedEffective = rehashEffectiveRights({
    ...structuredClone(governed.effectiveRights),
    rightsHead: {
      ...governed.effectiveRights.rightsHead,
      targetMatches: false,
    },
  });
  assert.throws(
    () => buildReferenceTechniqueMaterialization(buildOptions({
      ...governed,
      effectiveRights: forgedEffective,
    })),
    /head autoritativo e active|decisão efetiva de direitos/,
  );

  const options = buildOptions(governed);
  assert.throws(
    () => buildReferenceTechniqueMaterialization({
      ...options,
      styleSpecBinding: {
        ...options.styleSpecBinding,
        styleSpecHash: "e".repeat(64),
      },
    }),
    /styleSpecHash diverge/,
  );

  assert.throws(
    () => buildReferenceTechniqueMaterialization({
      ...options,
      styleSpecBinding: {
        ...options.styleSpecBinding,
        styleSpecId: "cinematic-3d@1",
      },
    }),
    /styleSpecHash diverge/,
  );
});

test("decisão de fila só existe com confirmação humana hash-bound", () => {
  const governed = governedFixture();
  const withoutDecision = buildReferenceTechniqueMaterialization(
    buildOptions(governed, {
      queueReview: null,
      styleSpecBinding: null,
    }),
  );
  assert.equal(withoutDecision.reviewQueueConfirmed, false);
  assert.equal(withoutDecision.decisionItem, null);
  assert.equal(withoutDecision.styleAssertionItem, null);
  assert.ok(withoutDecision.items.every((item) =>
    item.recordType !== "decision"));

  assert.throws(
    () => buildReferenceTechniqueMaterialization(
      buildOptions(governed, {
        queueReview: {
          confirmHuman: false,
          expectedCandidateHash: governed.candidate.candidateHash,
          approvedBy: ACTOR,
          decidedAt: NOW,
        },
      }),
    ),
    /confirmação humana explícita/,
  );
  assert.throws(
    () => buildReferenceTechniqueMaterialization(
      buildOptions(governed, {
        queueReview: {
          confirmHuman: true,
          expectedCandidateHash: "0".repeat(64),
          approvedBy: ACTOR,
          decidedAt: NOW,
        },
      }),
    ),
    /expectedCandidateHash diverge/,
  );
});

test("items candidate são persistíveis atomicamente sem promoção implícita", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "technique-materialization-"),
  );
  context.after(() => rm(temporaryRoot, {
    recursive: true,
    force: true,
  }));
  const dbFile = path.join(temporaryRoot, "knowledge.sqlite");
  initializeKnowledgeStore({
    dbFile,
    clock: () => new Date(NOW),
  });
  const repository = createKnowledgeStoreRepository({
    dbFile,
    clock: () => new Date(NOW),
  });
  const grant = createScopeGrant({
    rootScopeIds: [ROOT],
    permissions: ["read", "write", "integrity"],
    actor: ACTOR,
    purpose: "persist technique candidates atomically",
    issuedAt: "2026-07-24T14:00:00.000Z",
    expiresAt: "2026-07-24T16:00:00.000Z",
  });
  repository.createScope({
    grant,
    scope: {
      id: ROOT,
      rootScopeId: ROOT,
      parentScopeId: null,
      kind: "client",
      name: "Client A",
      createdAt: NOW,
      createdBy: ACTOR,
    },
  });
  repository.createScope({
    grant,
    scope: {
      id: SCOPE,
      rootScopeId: ROOT,
      parentScopeId: ROOT,
      kind: "project",
      name: "Film A",
      createdAt: NOW,
      createdBy: ACTOR,
    },
  });

  const governed = governedFixture();
  const storeTarget = {
    ...structuredClone(governed.targetItem),
    governance: envelope(
      governed.targetItem.governance.rights,
      "attestation:reference-a",
      ACTOR,
    ),
    createdBy: ACTOR,
  };
  storeTarget.contentHash = hashBody((({ contentHash, ...body }) =>
    body)(storeTarget));
  const storeRightsBody = {
    ...structuredClone(governed.rightsItem),
    id: referenceRightsItemId(storeTarget),
    governance: envelope(
      governed.rightsItem.governance.rights,
      "attestation:rights-a",
      ACTOR,
    ),
    payload: {
      ...structuredClone(governed.rightsItem.payload),
      targetRef: itemReference(storeTarget),
    },
    createdBy: ACTOR,
  };
  delete storeRightsBody.contentHash;
  const storeRights = {
    ...storeRightsBody,
    contentHash: hashBody(storeRightsBody),
  };
  repository.appendKnowledgeItemsAtomic({
    grant,
    items: [storeTarget, storeRights],
  });
  const effectiveRights = resolveEffectiveRights({
    targetItem: storeTarget,
    rightsItems: [storeRights],
    at: NOW,
  });
  const candidate = buildReferenceTechniqueCandidate({
    targetItem: storeTarget,
    effectiveRights,
    adapterAnalysis: analysisFixture(),
    protectedTerms: PROTECTED_TERMS,
  });
  const materialization = buildReferenceTechniqueMaterialization(
    buildOptions({
      targetItem: storeTarget,
      rightsItem: storeRights,
      effectiveRights,
      candidate,
    }),
  );
  const written = repository.appendKnowledgeItemsAtomic({
    grant,
    items: materialization.items,
    expectedHeads: materialization.persistenceExpectedHeads,
  });

  assert.deepEqual(written, materialization.items);
  assert.ok(written.every(({ status }) => status === "candidate"));
  assert.equal(
    repository.listKnowledgeItems({
      grant,
      rootScopeId: ROOT,
    }).filter(({ status }) => status === "candidate").length,
    materialization.items.length,
  );
  assert.equal(
    repository.listKnowledgeItems({
      grant,
      rootScopeId: ROOT,
    }).some((item) =>
      materialization.items.some(({ id }) => id === item.id)
      && item.status === "active"),
    false,
  );
  assert.equal(
    repository.checkIntegrity({
      grant,
      rootScopeId: ROOT,
    }).ok,
    true,
  );
});
