import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  classifyKnowledgeSchemaRole,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";
import {
  referenceRightsItemId,
  resolveEffectiveRights,
} from "../lib/media-pipeline/knowledge-effective-rights.mjs";
import {
  buildReferenceTechniqueCandidate,
  validateReferenceTechniqueCandidate,
} from "../lib/media-pipeline/knowledge-reference-technique-candidate.mjs";
import {
  assertKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const NOW = "2026-07-24T15:00:00.000Z";
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

function rehashItem(value) {
  const copy = structuredClone(value);
  delete copy.contentHash;
  return {
    ...copy,
    contentHash: hashBody(copy),
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

function permissions(localAnalysis = "allowed") {
  return {
    inventory: "allowed",
    localAnalysis,
    textualIndexing: "unknown",
    embedding: "denied",
    training: "denied",
    providerInput: "denied",
    publication: "unknown",
    reuse: "unknown",
  };
}

function envelope(rights, sourceRef) {
  return createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: { type: "client", id: "client:a" },
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
    createdBy: "human:operator",
  }, { expectedActor: "human:operator" });
}

function targetFixture(localAnalysis = "allowed") {
  const body = {
    schema: "mkt-videos/knowledge-item@1",
    id: "reference-asset:kra_0123456789abcdef0123456789abcdef",
    revision: 1,
    rootScopeId: "client:a",
    scopeId: "project:film-a",
    recordType: "entity",
    schemaId: "mkt-videos/entity-profile@1",
    schemaVersion: 1,
    status: "active",
    governance: envelope(
      permissions(localAnalysis),
      "attestation:reference-a",
    ),
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

function rightsFixture(target, localAnalysis = "allowed") {
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
    governance: envelope(
      permissions(localAnalysis),
      "attestation:rights-a",
    ),
    supersedesRevision: null,
    payload: {
      schema: "mkt-videos/rights-record@1",
      targetRef: itemReference(target),
      permissions: permissions(localAnalysis),
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

function governedFixture(localAnalysis = "allowed") {
  const targetItem = targetFixture(localAnalysis);
  const rightsItem = rightsFixture(targetItem, localAnalysis);
  const effectiveRights = resolveEffectiveRights({
    targetItem,
    rightsItems: [rightsItem],
    at: NOW,
  });
  return { targetItem, rightsItem, effectiveRights };
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

function build(overrides = {}) {
  const governed = governedFixture();
  return buildReferenceTechniqueCandidate({
    ...governed,
    adapterAnalysis: analysisFixture(),
    protectedTerms: PROTECTED_TERMS,
    ...overrides,
  });
}

test("builder puro produz candidate determinístico, imutável e não persistível", () => {
  const governed = governedFixture();
  const adapterAnalysis = analysisFixture();
  const beforeTarget = structuredClone(governed.targetItem);
  const beforeRights = structuredClone(governed.effectiveRights);
  const beforeAnalysis = structuredClone(adapterAnalysis);

  const first = buildReferenceTechniqueCandidate({
    ...governed,
    adapterAnalysis,
    protectedTerms: PROTECTED_TERMS,
  });
  const second = buildReferenceTechniqueCandidate({
    ...governed,
    adapterAnalysis,
    protectedTerms: [...PROTECTED_TERMS].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.status, "candidate");
  assert.equal(first.providerFree, true);
  assert.equal(first.persisted, false);
  assert.equal(first.sourceTarget.contentHash, governed.targetItem.contentHash);
  assert.equal(first.analysis.segmentCount, 2);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.techniqueCard), true);
  assert.deepEqual(governed.targetItem, beforeTarget);
  assert.deepEqual(governed.effectiveRights, beforeRights);
  assert.deepEqual(adapterAnalysis, beforeAnalysis);
  assert.equal(JSON.stringify(first).includes("Autor Protegido"), false);
  assert.equal(JSON.stringify(first).includes("Marca Reservada"), false);
  assert.doesNotThrow(() => validateReferenceTechniqueCandidate(first, {
    targetItem: governed.targetItem,
    effectiveRights: governed.effectiveRights,
    protectedTerms: PROTECTED_TERMS,
  }));

  const role = classifyKnowledgeSchemaRole(first.schema);
  assert.equal(role.persistableItemPayload, false);
  assert.equal(role.kind, "reference-analysis-candidate");
});

test("ranges inválidos, fora de ordem ou sobrepostos falham fechado", () => {
  const invalidRange = analysisFixture();
  invalidRange.segments[0].endMs = 0;
  assert.throws(
    () => build({ adapterAnalysis: invalidRange }),
    /startMs < endMs/,
  );

  const overlap = analysisFixture();
  overlap.segments[1].startMs = 899;
  assert.throws(
    () => build({ adapterAnalysis: overlap }),
    /sobrepõe ou quebra a ordem/,
  );

  const reversed = analysisFixture();
  reversed.segments.reverse();
  assert.throws(
    () => build({ adapterAnalysis: reversed }),
    /sobrepõe ou quebra a ordem/,
  );
});

test("target e effective rights adulterados não viram fonte autorizada", () => {
  const governed = governedFixture();
  const tamperedTarget = structuredClone(governed.targetItem);
  tamperedTarget.payload.name = "Nome adulterado";
  assert.throws(
    () => buildReferenceTechniqueCandidate({
      ...governed,
      targetItem: tamperedTarget,
      adapterAnalysis: analysisFixture(),
      protectedTerms: PROTECTED_TERMS,
    }),
    /contentHash inválido/,
  );

  const tamperedRights = structuredClone(governed.effectiveRights);
  tamperedRights.permissions.localAnalysis.reason = "razão adulterada";
  assert.throws(
    () => buildReferenceTechniqueCandidate({
      ...governed,
      effectiveRights: tamperedRights,
      adapterAnalysis: analysisFixture(),
      protectedTerms: PROTECTED_TERMS,
    }),
    /decisionHash inválido/,
  );

  const otherTargetRights = rehashEffectiveRights({
    ...structuredClone(governed.effectiveRights),
    target: {
      ...governed.effectiveRights.target,
      contentHash: "f".repeat(64),
    },
  });
  assert.throws(
    () => buildReferenceTechniqueCandidate({
      ...governed,
      effectiveRights: otherTargetRights,
      adapterAnalysis: analysisFixture(),
      protectedTerms: PROTECTED_TERMS,
    }),
    /não pertence ao reference target exato/,
  );
});

test("localAnalysis diferente de allowed bloqueia antes do builder", () => {
  const governed = governedFixture();
  const denied = rehashEffectiveRights({
    ...structuredClone(governed.effectiveRights),
    permissions: {
      ...governed.effectiveRights.permissions,
      localAnalysis: {
        state: "denied",
        allowed: false,
        reason: "intersection-denied",
      },
    },
    allAllowed: false,
  });
  assert.throws(
    () => buildReferenceTechniqueCandidate({
      ...governed,
      effectiveRights: denied,
      adapterAnalysis: analysisFixture(),
      protectedTerms: PROTECTED_TERMS,
    }),
    /localAnalysis bloqueado/,
  );

  const deniedTarget = targetFixture("denied");
  const forgedAllowed = rehashEffectiveRights({
    ...structuredClone(governed.effectiveRights),
    target: {
      rootScopeId: deniedTarget.rootScopeId,
      id: deniedTarget.id,
      revision: deniedTarget.revision,
      contentHash: deniedTarget.contentHash,
      status: deniedTarget.status,
    },
  });
  assert.throws(
    () => buildReferenceTechniqueCandidate({
      targetItem: deniedTarget,
      effectiveRights: forgedAllowed,
      adapterAnalysis: analysisFixture(),
      protectedTerms: PROTECTED_TERMS,
    }),
    /não permite localAnalysis no envelope/,
  );
});

test("lint rejeita termos protegidos, handles e fórmulas de imitação", () => {
  const cases = [
    {
      mutate(value) {
        value.technique.title = "Movimento da Marca Reservada";
      },
      expected: /termo protegido/,
    },
    {
      mutate(value) {
        value.segments[0].observations[0].statement =
          "Aplicar a curva observada por @autor.";
      },
      expected: /handle/,
    },
    {
      mutate(value) {
        value.technique.mechanism =
          "Executar no estilo de um realizador reconhecível.";
      },
      expected: /imitation-formula/,
    },
    {
      mutate(value) {
        value.technique.constraints[0] =
          "Copiar a composição sem deslocamentos.";
      },
      expected: /copy-replicate-imitate/,
    },
    {
      mutate(value) {
        value.technique.failureModes[0] =
          "O resultado fica idêntico ao material original.";
      },
      expected: /identical/,
    },
    {
      mutate(value) {
        value.technique.principle =
          "Tratamento inspirado por uma assinatura reconhecível.";
      },
      expected: /inspiration-or-signature/,
    },
    {
      mutate(value) {
        value.technique.mechanism =
          "Recrie a mesma transição e preserve seus detalhes.";
      },
      expected: /copy-replicate-imitate/,
    },
  ];
  for (const entry of cases) {
    const adapterAnalysis = analysisFixture();
    entry.mutate(adapterAnalysis);
    assert.throws(
      () => build({ adapterAnalysis }),
      entry.expected,
    );
  }
});

test("builder exclui prompts, IDs de provider, caminhos e score estético", () => {
  for (const field of ["prompt", "providerId", "interactionId"]) {
    const adapterAnalysis = analysisFixture();
    adapterAnalysis[field] = "não autorizado";
    assert.throws(
      () => build({ adapterAnalysis }),
      /campos não permitidos ou ausentes/,
    );
  }

  const absolutePath = analysisFixture();
  absolutePath.technique.applicability[0] =
    "Ler o material em C:\\private\\reference.mp4.";
  assert.throws(
    () => build({ adapterAnalysis: absolutePath }),
    /absolute-path/,
  );

  const aestheticScore = analysisFixture();
  aestheticScore.segments[0].observations[0].statement =
    "A estética recebe score máximo.";
  assert.throws(
    () => build({ adapterAnalysis: aestheticScore }),
    /aesthetic-or-score/,
  );

  const styleLabel = analysisFixture();
  styleLabel.technique.title = "Controle visual por estilo";
  assert.throws(
    () => build({ adapterAnalysis: styleLabel }),
    /aesthetic-or-score/,
  );
});

test("schema e validação semântica rejeitam adulteração da projeção", () => {
  const candidate = build();
  const schemaTamper = {
    ...structuredClone(candidate),
    providerId: "forbidden",
  };
  assert.throws(
    () => assertKnowledgeContract(schemaTamper),
    /additional properties/,
  );

  const governed = governedFixture();
  const hashTamper = {
    ...structuredClone(candidate),
    candidateHash: "0".repeat(64),
  };
  assert.throws(
    () => validateReferenceTechniqueCandidate(hashTamper, {
      targetItem: governed.targetItem,
      effectiveRights: governed.effectiveRights,
      protectedTerms: PROTECTED_TERMS,
    }),
    /candidateHash inválido/,
  );

  const segmentTamper = structuredClone(candidate);
  segmentTamper.analysis.segments[1].startMs = 100;
  const body = structuredClone(segmentTamper);
  delete body.candidateHash;
  segmentTamper.candidateHash = hashBody(body);
  assert.throws(
    () => validateReferenceTechniqueCandidate(segmentTamper, {
      targetItem: governed.targetItem,
      effectiveRights: governed.effectiveRights,
      protectedTerms: PROTECTED_TERMS,
    }),
    /Segmentos inválidos ou sobrepostos/,
  );
});

test("fixture target rehash helper preserva contrato e detecta revisão alterada", () => {
  const target = targetFixture();
  const revised = rehashItem({
    ...target,
    revision: 2,
    supersedesRevision: 1,
    contentHash: undefined,
  });
  assert.notEqual(revised.contentHash, target.contentHash);
  assertKnowledgeContract(revised);
});
