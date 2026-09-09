import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import test from "node:test";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  activatePromptTemplateRevision,
  compilePromptTemplate,
  createPromptTemplateRevision,
  expandPromptTemplateRows,
  importLegacyPromptCandidates,
  listPromptTemplates,
} from "../lib/media-pipeline/prompt-template-library.mjs";

const ROOT = "client:templates";
const ACTOR = "human:test-operator";
const NOW = new Date("2026-07-30T12:00:00.000Z");

async function setup(context) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "prompt-templates-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const coreRoot = path.join(temporary, "CORE");
  const dbFile = path.join(temporary, "knowledge.sqlite");
  await mkdir(coreRoot, { recursive: true });
  initializeKnowledgeStore({ dbFile, coreRoot, clock: () => NOW });
  const repository = createKnowledgeStoreRepository({ dbFile, coreRoot, clock: () => NOW });
  const grant = createScopeGrant({
    rootScopeIds: [ROOT],
    permissions: ["read", "write", "release"],
    actor: ACTOR,
    purpose: "provider-free prompt template tests",
    issuedAt: "2026-07-30T11:00:00.000Z",
    expiresAt: "2026-07-30T13:00:00.000Z",
  });
  repository.createScope({
    grant,
    scope: {
      id: ROOT,
      rootScopeId: ROOT,
      parentScopeId: null,
      kind: "client",
      name: "Templates",
      createdAt: NOW,
    },
  });
  return { repository, grant };
}

function input(body = "Comercial de {{duracao}} segundos para {{produto}} em {{formato}}.") {
  return {
    templateId: "comercial-produto",
    name: "Comercial de produto",
    body,
    variables: [
      { name: "duracao", type: "number", required: true, defaultValue: null, options: [] },
      { name: "produto", type: "text", required: true, defaultValue: null, options: [] },
      { name: "formato", type: "enum", required: false, defaultValue: "vertical", options: ["vertical", "horizontal"] },
    ],
    config: {
      mode: "studio",
      directionPreset: "react-audiovisual@1",
      aspectRatio: "9:16",
      task: "text_to_video",
    },
    source: { kind: "manual", receiptId: null },
  };
}

test("template cria candidato, ativa por decisão humana e compila sem provider", async (context) => {
  const { repository, grant } = await setup(context);
  const created = createPromptTemplateRevision({
    repository,
    grant,
    rootScopeId: ROOT,
    input: input(),
    actor: ACTOR,
    clock: () => NOW,
  });
  assert.equal(created.item.status, "candidate");
  assert.equal(listPromptTemplates({ repository, grant, rootScopeId: ROOT })[0].activeRevision, null);
  const activated = activatePromptTemplateRevision({
    repository,
    grant,
    rootScopeId: ROOT,
    templateId: "comercial-produto",
    revision: 1,
    reason: "Aprovado para produção",
    actor: ACTOR,
    confirmHuman: true,
    clock: () => NOW,
  });
  assert.equal(activated.item.status, "active");
  const projection = listPromptTemplates({ repository, grant, rootScopeId: ROOT })[0];
  assert.equal(projection.activeRevision, 1);
  const compiled = compilePromptTemplate(activated.item.payload, {
    duracao: 30,
    produto: "Curso X",
  });
  assert.equal(compiled.userPrompt, "Comercial de 30 segundos para Curso X em vertical.");
  assert.match(compiled.templateHash, /^[a-f0-9]{64}$/);
});

test("mudança cria revisão imutável, preserva hash e expansão tabular rastreia valores", async (context) => {
  const { repository, grant } = await setup(context);
  const first = createPromptTemplateRevision({
    repository, grant, rootScopeId: ROOT, input: input(), actor: ACTOR, clock: () => NOW,
  });
  activatePromptTemplateRevision({
    repository, grant, rootScopeId: ROOT, templateId: "comercial-produto", revision: 1,
    reason: "Aprovado", actor: ACTOR, confirmHuman: true, clock: () => NOW,
  });
  const second = createPromptTemplateRevision({
    repository,
    grant,
    rootScopeId: ROOT,
    input: input("Filme de {{duracao}}s para {{produto}}, formato {{formato}}."),
    actor: ACTOR,
    clock: () => NOW,
  });
  assert.equal(first.item.payload.revision, 1);
  assert.equal(second.item.payload.revision, 2);
  assert.notEqual(first.templateHash, second.templateHash);
  const rows = expandPromptTemplateRows({
    repository,
    grant,
    rootScopeId: ROOT,
    templateId: "comercial-produto",
    rows: [
      { name: "a", values: { duracao: 15, produto: "A" } },
      { name: "b", values: { duracao: 30, produto: "B", formato: "horizontal" } },
    ],
  });
  assert.deepEqual(rows.map(({ prompt }) => prompt), [
    "Comercial de 15 segundos para A em vertical.",
    "Comercial de 30 segundos para B em horizontal.",
  ]);
  assert.equal(rows[0].templateBinding.templateRevision, 1);
});

test("validação falha fechado para placeholder, valor extra e ativação sem humano", async (context) => {
  const { repository, grant } = await setup(context);
  assert.throws(
    () => createPromptTemplateRevision({
      repository,
      grant,
      rootScopeId: ROOT,
      input: { ...input(), body: "Olá {{nao_declarada}}" },
      actor: ACTOR,
      clock: () => NOW,
    }),
    /Placeholder sem variável declarada/,
  );
  const created = createPromptTemplateRevision({
    repository, grant, rootScopeId: ROOT, input: input(), actor: ACTOR, clock: () => NOW,
  });
  assert.throws(
    () => compilePromptTemplate(created.item.payload, { duracao: 30, produto: "X", segredo: "não" }),
    /variável desconhecida/,
  );
  assert.throws(
    () => activatePromptTemplateRevision({
      repository, grant, rootScopeId: ROOT, templateId: "comercial-produto", revision: 1,
      reason: "não", actor: ACTOR, confirmHuman: false, clock: () => NOW,
    }),
    /confirmHuman=true/,
  );
});

test("importador legado cria somente candidatos deduplicados e não chama provider", async (context) => {
  const { repository, grant } = await setup(context);
  const imported = importLegacyPromptCandidates({
    repository,
    grant,
    rootScopeId: ROOT,
    entries: [
      { name: "A", prompt: "Prompt literal legado A" },
      { name: "A duplicado", prompt: "Prompt literal legado A" },
      "Prompt literal legado B",
    ],
    actor: ACTOR,
    clock: () => NOW,
  });
  assert.equal(imported.inputCount, 3);
  assert.equal(imported.createdCount, 2);
  assert.equal(imported.skippedExactDuplicates, 1);
  assert.equal(imported.providerCalls, 0);
  assert.deepEqual(imported.created.map(({ status }) => status), ["candidate", "candidate"]);
});
