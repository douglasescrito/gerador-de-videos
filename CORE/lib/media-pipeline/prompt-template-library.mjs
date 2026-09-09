import { createHash } from "node:crypto";
import {
  KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA,
  KNOWLEDGE_PROMPT_TEMPLATE_SCHEMA,
} from "./knowledge-record-contracts.mjs";
import { createKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function text(value, label, max = 65_536) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  if (normalized.length > max) throw new Error(`${label} excede ${max} caracteres.`);
  return normalized;
}

function templateId(value) {
  const normalized = text(value, "templateId", 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(normalized)) {
    throw new Error("templateId possui formato inválido.");
  }
  return normalized;
}

function normalizeVariables(input = []) {
  if (!Array.isArray(input)) throw new Error("variables deve ser uma lista.");
  const seen = new Set();
  return input.map((entry, index) => {
    const name = String(entry?.name ?? "").trim();
    if (!VARIABLE_NAME.test(name)) throw new Error(`Variável ${index + 1} possui nome inválido.`);
    if (seen.has(name)) throw new Error(`Variável duplicada: ${name}.`);
    seen.add(name);
    const type = String(entry?.type ?? "text");
    if (!["text", "number", "boolean", "enum"].includes(type)) {
      throw new Error(`Tipo inválido para ${name}.`);
    }
    const options = Array.isArray(entry?.options)
      ? [...new Set(entry.options.map((value) => text(value, `options.${name}`, 500)))]
      : [];
    if (type === "enum" && options.length === 0) {
      throw new Error(`Variável enum ${name} exige options.`);
    }
    const defaultValue = entry?.defaultValue ?? null;
    return {
      name,
      type,
      required: entry?.required === true,
      defaultValue,
      options,
    };
  });
}

function normalizeConfig(input = {}) {
  return {
    mode: input.mode ?? "raw",
    directionPreset: input.directionPreset == null || input.directionPreset === ""
      ? null
      : text(input.directionPreset, "directionPreset", 160),
    aspectRatio: input.aspectRatio ?? "9:16",
    task: input.task ?? "text_to_video",
  };
}

function placeholders(body) {
  return [...body.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

function normalizeRevisionPayload(input, { revision, createdAt, actor }) {
  const body = text(input?.body, "body");
  const variables = normalizeVariables(input?.variables);
  const declared = new Set(variables.map(({ name }) => name));
  const used = new Set(placeholders(body));
  for (const name of used) {
    if (!declared.has(name)) throw new Error(`Placeholder sem variável declarada: ${name}.`);
  }
  for (const variable of variables) {
    if (!used.has(variable.name)) throw new Error(`Variável não usada no corpo: ${variable.name}.`);
  }
  return assertKnowledgeContract({
    schema: KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA,
    templateId: templateId(input?.templateId),
    revision,
    name: text(input?.name, "name", 160),
    body,
    variables,
    config: normalizeConfig(input?.config),
    source: {
      kind: input?.source?.kind ?? "manual",
      receiptId: input?.source?.receiptId == null
        ? null
        : text(input.source.receiptId, "source.receiptId", 300),
    },
    createdAt,
    createdBy: actor,
  }, {
    schemaId: KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA,
    label: "Prompt template revision",
  });
}

function coerce(variable, supplied) {
  const value = supplied == null || supplied === "" ? variable.defaultValue : supplied;
  if (value == null) {
    if (variable.required) throw new Error(`Valor obrigatório ausente: ${variable.name}.`);
    return "";
  }
  if (variable.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Valor numérico inválido: ${variable.name}.`);
    return String(parsed);
  }
  if (variable.type === "boolean") {
    if (value === true || value === "true") return "true";
    if (value === false || value === "false") return "false";
    throw new Error(`Valor booleano inválido: ${variable.name}.`);
  }
  const normalized = String(value);
  if (variable.type === "enum" && !variable.options.includes(normalized)) {
    throw new Error(`Valor fora das opções de ${variable.name}.`);
  }
  return normalized;
}

export function compilePromptTemplate(revisionPayload, values = {}) {
  const payload = assertKnowledgeContract(revisionPayload, {
    schemaId: KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA,
    label: "Prompt template revision",
  });
  const allowed = new Set(payload.variables.map(({ name }) => name));
  for (const key of Object.keys(values ?? {})) {
    if (!allowed.has(key)) throw new Error(`Valor fornecido para variável desconhecida: ${key}.`);
  }
  const materializedValues = {};
  for (const variable of payload.variables) {
    materializedValues[variable.name] = coerce(variable, values?.[variable.name]);
  }
  const prompt = payload.body.replace(PLACEHOLDER, (_whole, name) => materializedValues[name]);
  return {
    schema: "mkt-videos/prompt-template-compilation@1",
    templateId: payload.templateId,
    templateRevision: payload.revision,
    templateHash: hash(payload),
    values: materializedValues,
    userPrompt: prompt,
    config: payload.config,
  };
}

function revisionItems(repository, grant, rootScopeId, logicalId) {
  return repository.listKnowledgeItems({ grant, rootScopeId, history: true })
    .filter((item) =>
      item.schemaId === KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA
      && item.payload?.templateId === logicalId)
    .sort((a, b) =>
      a.payload.revision - b.payload.revision
      || a.revision - b.revision);
}

function revisionHeads(items) {
  const heads = new Map();
  for (const item of items) {
    const key = `${item.payload.templateId}:${item.payload.revision}`;
    if (!heads.has(key) || heads.get(key).revision < item.revision) heads.set(key, item);
  }
  return [...heads.values()].sort((a, b) => a.payload.revision - b.payload.revision);
}

export function listPromptTemplates({ repository, grant, rootScopeId }) {
  const items = repository.listKnowledgeItems({ grant, rootScopeId, history: true })
    .filter((item) => item.schemaId === KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA);
  const groups = new Map();
  for (const item of revisionHeads(items)) {
    const id = item.payload.templateId;
    const values = groups.get(id) ?? [];
    values.push(item);
    groups.set(id, values);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, revisions]) => {
      const ordered = revisions.sort((a, b) => a.payload.revision - b.payload.revision);
      const active = [...ordered].reverse().find((item) => item.status === "active") ?? null;
      return assertKnowledgeContract({
        schema: KNOWLEDGE_PROMPT_TEMPLATE_SCHEMA,
        templateId: id,
        name: ordered.at(-1).payload.name,
        activeRevision: active?.payload.revision ?? null,
        revisions: ordered.map((item) => ({
          revision: item.payload.revision,
          status: item.status,
          itemId: item.id,
          contentHash: hash(item.payload),
          createdAt: item.payload.createdAt,
        })),
      }, {
        schemaId: KNOWLEDGE_PROMPT_TEMPLATE_SCHEMA,
        label: "Prompt template projection",
      });
    });
}

export function getPromptTemplateRevision({
  repository,
  grant,
  rootScopeId,
  templateId: logicalId,
  revision = null,
  requireActive = false,
}) {
  const items = revisionHeads(revisionItems(repository, grant, rootScopeId, templateId(logicalId)));
  const selected = revision == null
    ? [...items].reverse().find((item) => item.status === "active")
    : items.find((item) => item.payload.revision === Number(revision));
  if (!selected) throw new Error("Revisão de template inexistente ou sem versão ativa.");
  if (requireActive && selected.status !== "active") throw new Error("A revisão selecionada não está ativa.");
  return {
    item: selected,
    payload: selected.payload,
    hash: hash(selected.payload),
  };
}

export function createPromptTemplateRevision({
  repository,
  grant,
  rootScopeId,
  input,
  actor,
  clock = () => new Date(),
}) {
  const logicalId = templateId(input?.templateId);
  const existing = revisionHeads(revisionItems(repository, grant, rootScopeId, logicalId));
  const nextRevision = existing.reduce((max, item) => Math.max(max, item.payload.revision), 0) + 1;
  const createdAt = clock().toISOString();
  const payload = normalizeRevisionPayload(input, {
    revision: nextRevision,
    createdAt,
    actor,
  });
  if (existing.some((item) => hash(item.payload) === hash(payload))) {
    throw new Error("Uma revisão idêntica já existe para este template.");
  }
  const itemId = `prompt-template:${logicalId}:r${nextRevision}`;
  const governance = createKnowledgeRecordEnvelope({
    classification: input?.classification ?? "confidential",
    owner: { type: "client", id: rootScopeId },
    provenance: [{
      sourceType: "prompt-template",
      sourceRef: `template:${logicalId}/r${nextRevision}`,
      method: input?.source?.kind === "receipt" ? "derived" : "manual",
      observedAt: createdAt,
      contentHash: hash(payload),
    }],
    modality: "fact",
    evidenceIds: [],
    retention: { policy: "manual-review" },
    rights: {
      inventory: "allowed",
      localAnalysis: "allowed",
      textualIndexing: "allowed",
      embedding: "denied",
      training: "denied",
      providerInput: "allowed",
      publication: "unknown",
      reuse: "allowed",
    },
    createdAt,
    createdBy: actor,
  }, { expectedActor: actor });
  const item = repository.appendKnowledgeItem({
    grant,
    item: {
      id: itemId,
      revision: 1,
      rootScopeId,
      scopeId: rootScopeId,
      recordType: "assertion",
      schemaId: KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA,
      schemaVersion: 1,
      status: "candidate",
      governance,
      supersedesRevision: null,
      payload,
      createdAt,
      createdBy: actor,
    },
  });
  return { item, templateHash: hash(payload) };
}

export function activatePromptTemplateRevision({
  repository,
  grant,
  rootScopeId,
  templateId: logicalId,
  revision,
  reason,
  actor,
  confirmHuman,
  clock = () => new Date(),
}) {
  if (confirmHuman !== true) throw new Error("Ativação exige confirmHuman=true.");
  const selected = getPromptTemplateRevision({
    repository,
    grant,
    rootScopeId,
    templateId: logicalId,
    revision,
  });
  if (selected.item.status === "active") {
    return { item: selected.item, decision: null, templateHash: selected.hash };
  }
  const result = repository.reviewKnowledgeItem({
    grant,
    rootScopeId,
    itemId: selected.item.id,
    expectedRevision: selected.item.revision,
    expectedContentHash: selected.item.contentHash,
    action: "promote",
    reason: text(reason, "reason", 1_000),
    evidenceIds: [],
    reviewedAt: clock(),
    reviewedBy: actor,
  });
  return { item: result.item, decision: result.decision, templateHash: selected.hash };
}

export function expandPromptTemplateRows({
  repository,
  grant,
  rootScopeId,
  templateId: logicalId,
  revision = null,
  rows,
}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("rows precisa conter ao menos uma linha.");
  if (rows.length > 1_000) throw new Error("rows excede o limite de 1000 itens.");
  const selected = getPromptTemplateRevision({
    repository,
    grant,
    rootScopeId,
    templateId: logicalId,
    revision,
    requireActive: true,
  });
  return rows.map((row, index) => {
    const values = row?.values ?? row ?? {};
    const compiled = compilePromptTemplate(selected.payload, values);
    return {
      name: String(row?.name ?? `template-${String(index + 1).padStart(3, "0")}`),
      prompt: compiled.userPrompt,
      templateBinding: {
        templateId: compiled.templateId,
        templateRevision: compiled.templateRevision,
        templateHash: compiled.templateHash,
        values: compiled.values,
      },
    };
  });
}

export function importLegacyPromptCandidates({
  repository,
  grant,
  rootScopeId,
  entries,
  actor,
  clock = () => new Date(),
}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("entries precisa conter prompts.");
  if (entries.length > 5_000) throw new Error("Importação excede 5000 entradas.");
  const normalized = entries.map((entry, index) => {
    const prompt = text(typeof entry === "string" ? entry : entry?.prompt, `entries[${index}].prompt`);
    return {
      prompt,
      name: typeof entry === "string" ? `Prompt legado ${index + 1}` : text(entry?.name ?? `Prompt legado ${index + 1}`, `entries[${index}].name`, 160),
      receiptId: typeof entry === "string" || entry?.receiptId == null ? null : text(entry.receiptId, `entries[${index}].receiptId`, 300),
    };
  });
  const unique = [...new Map(normalized.map((entry) => [entry.prompt, entry])).values()];
  const existingBodies = new Set(
    repository.listKnowledgeItems({ grant, rootScopeId, history: true })
      .filter((item) => item.schemaId === KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA)
      .map((item) => item.payload.body),
  );
  const created = [];
  let skipped = normalized.length - unique.length;
  for (const entry of unique) {
    if (existingBodies.has(entry.prompt)) {
      skipped += 1;
      continue;
    }
    const idHash = createHash("sha256").update(entry.prompt).digest("hex").slice(0, 16);
    const result = createPromptTemplateRevision({
      repository,
      grant,
      rootScopeId,
      input: {
        templateId: `legacy-${idHash}`,
        name: entry.name,
        body: entry.prompt,
        variables: [],
        config: {
          mode: "raw",
          directionPreset: null,
          aspectRatio: "16:9",
          task: "text_to_video",
        },
        source: {
          kind: "legacy-import",
          receiptId: entry.receiptId,
        },
      },
      actor,
      clock,
    });
    created.push({
      templateId: result.item.payload.templateId,
      revision: result.item.payload.revision,
      status: result.item.status,
      templateHash: result.templateHash,
    });
    existingBodies.add(entry.prompt);
  }
  return {
    schema: "mkt-videos/prompt-template-legacy-import@1",
    inputCount: normalized.length,
    createdCount: created.length,
    skippedExactDuplicates: skipped,
    created,
    providerCalls: 0,
  };
}
