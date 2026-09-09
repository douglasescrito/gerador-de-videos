import { createHash } from "node:crypto";
import {
  assertEffectiveRightAllowed,
} from "./knowledge-effective-rights.mjs";
import {
  assertKnowledgeRecordPayloadContract,
} from "./knowledge-record-contracts.mjs";
import {
  assertKnowledgeRecordEnvelope,
} from "./knowledge-governance-envelope.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const REFERENCE_TECHNIQUE_CANDIDATE_SCHEMA =
  "mkt-videos/reference-technique-candidate@1";
export const REFERENCE_TECHNIQUE_LINT_POLICY =
  "anti-imitation-transferable-technique@1";

const ITEM_SCHEMA = "mkt-videos/knowledge-item@1";
const ENTITY_SCHEMA = "mkt-videos/entity-profile@1";
const EFFECTIVE_RIGHTS_SCHEMA = "mkt-videos/effective-rights@1";
const REFERENCE_ENTITY_TYPE = "reference-asset";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OBSERVATION_DOMAINS = new Set([
  "timing",
  "motion",
  "composition",
  "camera",
  "transition",
  "typography",
  "lighting",
  "color-system",
  "editing",
  "audio-visual-sync",
  "rendering",
  "other-technical",
]);
const TECHNIQUE_FIELDS = Object.freeze([
  "title",
  "principle",
  "mechanism",
  "applicability",
  "constraints",
  "failureModes",
]);
const GENERIC_BLOCKERS = Object.freeze([
  {
    id: "imitation-formula",
    pattern:
      /\b(?:no|na|ao|a)\s+estilo\s+(?:de|do|da|dos|das)\b|\bestilo\s+(?:de|do|da|dos|das)\b|\b(?:in\s+the\s+style\s+of|style\s+of)\b/iu,
  },
  {
    id: "copy-replicate-imitate",
    pattern:
      /\b(?:copi(?:ar|e|ado|ada|ados|adas|ando)|replic(?:ar|a|ado|ada|ados|adas|ando)|imit(?:ar|e|ado|ada|ados|adas|ando|acao)|recri(?:ar|e|ado|ada|ados|adas|ando)|emul(?:ar|e|ado|ada|ados|adas|ando)|clon(?:ar|e|ado|ada|ados|adas|ando)|copy|copied|copying|replicate|replicated|replicating|imitate|imitated|imitating|recreate|recreated|recreating|emulate|emulated|emulating|clone|cloned|cloning)\b/iu,
  },
  {
    id: "inspiration-or-signature",
    pattern:
      /\b(?:inspirad[oa]s?\s+(?:em|por)|inspired\s+by|a\s+la|assinatura\s+(?:visual\s+)?(?:de|do|da|dos|das)|linguagem\s+(?:visual\s+)?(?:de|do|da|dos|das)|signature\s+of)\b/iu,
  },
  {
    id: "identical",
    pattern:
      /\b(?:identico|identica|identicos|identicas|identical)(?:\s+(?:a|ao|as|aos|to))?\b/iu,
  },
  {
    id: "handle",
    pattern: /(^|[^\p{L}\p{N}._%+-])@[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\b/iu,
  },
  {
    id: "absolute-path",
    pattern:
      /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:Users|home|mnt|var|tmp|opt|srv|workspace|data)(?:\/|\b)|file:\/\/)/iu,
  },
  {
    id: "prompt-or-provider-identifier",
    pattern:
      /\b(?:prompt|interaction[-_ ]?id|operation[-_ ]?id|provider[-_ ]?id|request[-_ ]?id|gemini|omni|veo|sora|openai)\b/iu,
  },
  {
    id: "aesthetic-or-score",
    pattern:
      /\b(?:estetica|estetico|esteticas|esteticos|estilo|style|aesthetic|aesthetics|score|rating|pontuacao|bonito|bonita|feio|feia|beautiful|ugly)\b/iu,
  },
]);

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Technique candidate contém número não finito.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        "Technique candidate deve conter somente valores JSON.",
      );
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  throw new Error(
    "Technique candidate deve conter somente valores JSON.",
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Json(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function assertExactKeys(value, expected, label) {
  if (
    value == null
    || typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`${label} deve ser um objeto JSON.`);
  }
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`${label} possui campos não permitidos ou ausentes.`);
  }
  return value;
}

function normalizedText(value, label, maximum = 2000) {
  if (typeof value !== "string") {
    throw new Error(`${label} deve ser texto.`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${label} deve ter entre 1 e ${maximum} caracteres.`);
  }
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) {
    throw new Error(`${label} contém caracteres de controle ou bidi.`);
  }
  return normalized;
}

function normalizedTextList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(`${label} deve conter de 1 a 32 textos.`);
  }
  const normalized = value.map((entry, index) =>
    normalizedText(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contém textos duplicados.`);
  }
  return normalized;
}

function foldText(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function searchableText(value) {
  return ` ${foldText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()} `;
}

function normalizedProtectedTerms(protectedTerms) {
  if (!Array.isArray(protectedTerms) || protectedTerms.length > 256) {
    throw new Error(
      "protectedTerms deve ser uma lista explícita de até 256 termos.",
    );
  }
  const normalized = protectedTerms.map((term, index) =>
    normalizedText(term, `protectedTerms[${index}]`, 200));
  const searchForms = normalized.map(searchableText);
  if (
    searchForms.some((entry) => entry.trim().length === 0)
    || new Set(searchForms).size !== searchForms.length
  ) {
    throw new Error("protectedTerms contém termos vazios ou duplicados.");
  }
  return searchForms
    .map((entry) => entry.trim())
    .sort(compareText);
}

function assertCleanText({
  value,
  label,
  protectedSearchTerms,
}) {
  const folded = foldText(value);
  for (const blocker of GENERIC_BLOCKERS) {
    if (blocker.pattern.test(folded)) {
      throw new Error(
        `${label} viola lint anti-imitação (${blocker.id}).`,
      );
    }
  }
  const searchable = searchableText(value);
  for (const protectedTerm of protectedSearchTerms) {
    if (searchable.includes(` ${protectedTerm} `)) {
      throw new Error(
        `${label} contém termo protegido e não pode virar técnica.`,
      );
    }
  }
  return value;
}

function targetReference(targetItem) {
  return {
    schema: "mkt-videos/knowledge-reference@1",
    kind: "item",
    rootScopeId: targetItem.rootScopeId,
    id: targetItem.id,
    revision: targetItem.revision,
    recordType: targetItem.recordType,
    contentHash: targetItem.contentHash,
  };
}

function assertReferenceTarget(targetItem) {
  assertKnowledgeContract(targetItem, {
    schemaId: ITEM_SCHEMA,
    label: "Reference target",
  });
  assertKnowledgeRecordPayloadContract({
    recordType: targetItem.recordType,
    schemaId: targetItem.schemaId,
    schemaVersion: targetItem.schemaVersion,
    payload: targetItem.payload,
  });
  assertKnowledgeRecordEnvelope(targetItem.governance);
  const { contentHash, ...body } = targetItem;
  if (contentHash !== sha256Json(body)) {
    throw new Error("Reference target possui contentHash inválido.");
  }
  if (
    targetItem.recordType !== "entity"
    || targetItem.schemaId !== ENTITY_SCHEMA
    || targetItem.payload.entityType !== REFERENCE_ENTITY_TYPE
    || targetItem.status !== "active"
  ) {
    throw new Error(
      "Reference target deve ser reference-asset canônico e active.",
    );
  }
  return targetItem;
}

function assertEffectiveRightsForTarget({
  effectiveRights,
  targetItem,
}) {
  assertKnowledgeContract(effectiveRights, {
    schemaId: EFFECTIVE_RIGHTS_SCHEMA,
    label: "Effective rights",
  });
  const { decisionHash, ...body } = effectiveRights;
  if (decisionHash !== sha256Json(body)) {
    throw new Error("Effective rights possui decisionHash inválido.");
  }
  const target = effectiveRights.target;
  if (
    target.rootScopeId !== targetItem.rootScopeId
    || target.id !== targetItem.id
    || target.revision !== targetItem.revision
    || target.contentHash !== targetItem.contentHash
    || target.status !== targetItem.status
  ) {
    throw new Error(
      "Effective rights não pertence ao reference target exato.",
    );
  }
  if (targetItem.governance.rights.localAnalysis !== "allowed") {
    throw new Error(
      "Reference target não permite localAnalysis no envelope governado.",
    );
  }
  assertEffectiveRightAllowed({
    effectiveRights,
    right: "localAnalysis",
  });
  return effectiveRights;
}

function normalizeObservation(observation, {
  segmentIndex,
  observationIndex,
  protectedSearchTerms,
}) {
  const label =
    `segments[${segmentIndex}].observations[${observationIndex}]`;
  assertExactKeys(observation, ["domain", "statement"], label);
  if (!OBSERVATION_DOMAINS.has(observation.domain)) {
    throw new Error(`${label}.domain não é técnico/canônico.`);
  }
  const statement = normalizedText(
    observation.statement,
    `${label}.statement`,
  );
  assertCleanText({
    value: statement,
    label: `${label}.statement`,
    protectedSearchTerms,
  });
  return {
    domain: observation.domain,
    statement,
  };
}

function normalizeSegments(segments, protectedSearchTerms) {
  if (!Array.isArray(segments) || segments.length < 1
      || segments.length > 4096) {
    throw new Error("segments deve conter de 1 a 4096 segmentos.");
  }
  let previousEnd = -1;
  return segments.map((segment, index) => {
    assertExactKeys(
      segment,
      ["startMs", "endMs", "observations"],
      `segments[${index}]`,
    );
    if (
      !Number.isSafeInteger(segment.startMs)
      || segment.startMs < 0
      || !Number.isSafeInteger(segment.endMs)
      || segment.endMs <= segment.startMs
    ) {
      throw new Error(
        `segments[${index}] exige startMs < endMs em inteiros seguros.`,
      );
    }
    if (segment.startMs < previousEnd) {
      throw new Error(
        `segments[${index}] sobrepõe ou quebra a ordem temporal.`,
      );
    }
    if (
      !Array.isArray(segment.observations)
      || segment.observations.length < 1
      || segment.observations.length > 64
    ) {
      throw new Error(
        `segments[${index}].observations deve conter de 1 a 64 itens.`,
      );
    }
    previousEnd = segment.endMs;
    return {
      id: `segment-${String(index + 1).padStart(4, "0")}`,
      startMs: segment.startMs,
      endMs: segment.endMs,
      observations: segment.observations.map(
        (observation, observationIndex) =>
          normalizeObservation(observation, {
            segmentIndex: index,
            observationIndex,
            protectedSearchTerms,
          }),
      ),
    };
  });
}

function normalizeTechnique(technique, protectedSearchTerms) {
  assertExactKeys(technique, TECHNIQUE_FIELDS, "technique");
  const normalized = {
    abstraction: "transferable-mechanism",
    title: normalizedText(technique.title, "technique.title", 200),
    principle: normalizedText(technique.principle, "technique.principle"),
    mechanism: normalizedText(
      technique.mechanism,
      "technique.mechanism",
      4000,
    ),
    applicability: normalizedTextList(
      technique.applicability,
      "technique.applicability",
    ),
    constraints: normalizedTextList(
      technique.constraints,
      "technique.constraints",
    ),
    failureModes: normalizedTextList(
      technique.failureModes,
      "technique.failureModes",
    ),
  };
  const texts = [
    ["technique.title", normalized.title],
    ["technique.principle", normalized.principle],
    ["technique.mechanism", normalized.mechanism],
    ...normalized.applicability.map((value, index) => [
      `technique.applicability[${index}]`,
      value,
    ]),
    ...normalized.constraints.map((value, index) => [
      `technique.constraints[${index}]`,
      value,
    ]),
    ...normalized.failureModes.map((value, index) => [
      `technique.failureModes[${index}]`,
      value,
    ]),
  ];
  for (const [label, value] of texts) {
    assertCleanText({ value, label, protectedSearchTerms });
  }
  return { techniqueCard: normalized, texts };
}

function candidateTextEntries(candidate) {
  return [
    ["techniqueCard.title", candidate.techniqueCard.title],
    ["techniqueCard.principle", candidate.techniqueCard.principle],
    ["techniqueCard.mechanism", candidate.techniqueCard.mechanism],
    ...candidate.techniqueCard.applicability.map((value, index) => [
      `techniqueCard.applicability[${index}]`,
      value,
    ]),
    ...candidate.techniqueCard.constraints.map((value, index) => [
      `techniqueCard.constraints[${index}]`,
      value,
    ]),
    ...candidate.techniqueCard.failureModes.map((value, index) => [
      `techniqueCard.failureModes[${index}]`,
      value,
    ]),
    ...candidate.analysis.segments.flatMap((segment, segmentIndex) =>
      segment.observations.map((observation, observationIndex) => [
        `analysis.segments[${segmentIndex}].observations[${observationIndex}].statement`,
        observation.statement,
      ])),
  ];
}

function protectedTermsBinding(protectedTerms) {
  const normalized = normalizedProtectedTerms(protectedTerms);
  return {
    normalized,
    hash: sha256Json(normalized),
  };
}

export function validateReferenceTechniqueCandidate(candidate, {
  targetItem,
  effectiveRights,
  protectedTerms,
} = {}) {
  const target = assertReferenceTarget(targetItem);
  const rights = assertEffectiveRightsForTarget({
    effectiveRights,
    targetItem: target,
  });
  const protectedBinding = protectedTermsBinding(protectedTerms);
  assertKnowledgeContract(candidate, {
    schemaId: REFERENCE_TECHNIQUE_CANDIDATE_SCHEMA,
    label: "Reference technique candidate",
  });
  if (
    canonicalJson(candidate.sourceTarget)
    !== canonicalJson(targetReference(target))
  ) {
    throw new Error(
      "Technique candidate não aponta para o reference target exato.",
    );
  }
  const expectedRightsDecision = {
    authority: rights.authority,
    evaluatedAt: rights.evaluatedAt,
    decisionHash: rights.decisionHash,
    localAnalysis: structuredClone(
      rights.permissions.localAnalysis,
    ),
  };
  if (
    canonicalJson(candidate.rightsDecision)
    !== canonicalJson(expectedRightsDecision)
  ) {
    throw new Error(
      "Technique candidate diverge da decisão efetiva de direitos.",
    );
  }
  if (candidate.analysis.segmentCount !== candidate.analysis.segments.length) {
    throw new Error("segmentCount diverge dos segmentos.");
  }
  let previousEnd = -1;
  candidate.analysis.segments.forEach((segment, index) => {
    if (segment.id !== `segment-${String(index + 1).padStart(4, "0")}`) {
      throw new Error("Segmento possui ID ou ordem não canônica.");
    }
    if (segment.endMs <= segment.startMs || segment.startMs < previousEnd) {
      throw new Error("Segmentos inválidos ou sobrepostos.");
    }
    previousEnd = segment.endMs;
  });
  if (
    candidate.lint.protectedTermsCount
      !== protectedBinding.normalized.length
    || candidate.lint.protectedTermsHash !== protectedBinding.hash
  ) {
    throw new Error("Technique candidate diverge dos termos protegidos.");
  }
  const textEntries = candidateTextEntries(candidate);
  if (candidate.lint.checkedTextCount !== textEntries.length) {
    throw new Error("checkedTextCount diverge dos textos inspecionados.");
  }
  for (const [label, value] of textEntries) {
    assertCleanText({
      value,
      label,
      protectedSearchTerms: protectedBinding.normalized,
    });
  }
  const { candidateHash, ...body } = candidate;
  if (candidateHash !== sha256Json(body)) {
    throw new Error("Technique candidate possui candidateHash inválido.");
  }
  return candidate;
}

export function buildReferenceTechniqueCandidate({
  targetItem,
  effectiveRights,
  adapterAnalysis,
  protectedTerms,
} = {}) {
  const target = assertReferenceTarget(targetItem);
  const rights = assertEffectiveRightsForTarget({
    effectiveRights,
    targetItem: target,
  });
  assertExactKeys(
    adapterAnalysis,
    ["segments", "technique"],
    "adapterAnalysis",
  );
  const protectedBinding = protectedTermsBinding(protectedTerms);
  const segments = normalizeSegments(
    adapterAnalysis.segments,
    protectedBinding.normalized,
  );
  const { techniqueCard, texts } = normalizeTechnique(
    adapterAnalysis.technique,
    protectedBinding.normalized,
  );
  const checkedTextCount = texts.length + segments.reduce(
    (total, segment) => total + segment.observations.length,
    0,
  );
  const body = {
    schema: REFERENCE_TECHNIQUE_CANDIDATE_SCHEMA,
    status: "candidate",
    providerFree: true,
    persisted: false,
    sourceTarget: targetReference(target),
    rightsDecision: {
      authority: rights.authority,
      evaluatedAt: rights.evaluatedAt,
      decisionHash: rights.decisionHash,
      localAnalysis: structuredClone(
        rights.permissions.localAnalysis,
      ),
    },
    analysis: {
      segmentCount: segments.length,
      segments,
    },
    techniqueCard,
    lint: {
      policy: REFERENCE_TECHNIQUE_LINT_POLICY,
      protectedTermsCount: protectedBinding.normalized.length,
      protectedTermsHash: protectedBinding.hash,
      checkedTextCount,
    },
  };
  const result = {
    ...body,
    candidateHash: sha256Json(body),
  };
  validateReferenceTechniqueCandidate(result, {
    targetItem: target,
    effectiveRights: rights,
    protectedTerms,
  });
  return deepFreeze(result);
}
