import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyBatchItemRecoveryResult,
  authorizeReferenceReattempt,
  BATCH_JOB_SCHEMA,
  createBatchJob,
  listBatchJobs,
  loadBatchJob,
  prepareBatchItemAction,
  projectBatchJob,
  reorderPendingItems,
  requestBatchCancellation,
  runBatchJob,
  saveBatchJob,
  summarizeBatchJob,
  suspendUnauthorizedReferenceItems,
} from "../lib/media-pipeline/omni-batch-runner.mjs";
import { projectProductionOrder } from "../lib/media-pipeline/production-order-projection.mjs";

const reference = (seed = "a") => ({
  inputId: "input-001",
  role: "reference-image",
  file: "item-001-input-001.png",
  sha256: seed.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, "a"),
  bytes: 128,
  mimeType: "image/png",
});

const stateDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "batch-"));

const job3 = () =>
  createBatchJob({
    collection: "colecao-exemplo",
    items: [
      { name: "01-parte", prompt: "Prompt um" },
      { name: "02-parte", prompt: "Prompt dois" },
      { name: "03-parte", prompt: "Prompt tres" },
    ],
    defaults: { aspectRatio: "9:16", mode: "studio", directionPreset: "aquarela-2d@1" },
    parallel: 2,
  });

const okGenerate = async () => ({ buffer: Buffer.from("video"), fileId: "f1" });
const okPersist = async (payload) => ({ relPath: `${payload.collection}/${payload.name}.mp4`, receiptId: "receipt:sha256:x" });

test("criação valida collection, itens, prompt vazio e parallel", () => {
  assert.throws(() => createBatchJob({ collection: "", items: [{ prompt: "p" }] }), /collection é obrigatória/);
  assert.throws(() => createBatchJob({ collection: "c", items: [] }), /pelo menos um item/);
  assert.throws(() => createBatchJob({ collection: "c", items: [{ prompt: "   " }] }), /sem prompt/);
  assert.throws(() => createBatchJob({ collection: "c", items: [{ prompt: "p" }], parallel: 0 }), /parallel/);
  assert.throws(() => createBatchJob({ collection: "c", items: [{ prompt: "p" }], parallel: 99 }), /parallel/);

  const job = createBatchJob({ collection: "c", items: [{ prompt: "p" }] });
  assert.equal(job.schema, BATCH_JOB_SCHEMA);
  assert.equal(job.items[0].id, "item:001");
  assert.equal(job.items[0].state, "pending");
});

test("lote completo grava cada item com recibo e respeita a concorrência", async () => {
  const dir = stateDir();
  const job = job3();
  let ativos = 0;
  let pico = 0;

  const generate = async () => {
    ativos += 1;
    pico = Math.max(pico, ativos);
    await new Promise((resolve) => setTimeout(resolve, 5));
    ativos -= 1;
    return { buffer: Buffer.from("video"), fileId: "f" };
  };

  const persistidos = [];
  const persist = async (payload) => {
    persistidos.push(payload);
    return { relPath: `${payload.collection}/${payload.name}.mp4`, receiptId: "receipt:sha256:x" };
  };

  const summary = await runBatchJob({ job, stateDir: dir, generate, persist });

  assert.equal(summary.counts.completed, 3);
  assert.equal(summary.state, "completed");
  assert.ok(pico <= 2, `concorrência estourou: ${pico}`);

  // todo item persistido carrega batchId e o preset do lote
  for (const payload of persistidos) {
    assert.equal(payload.metadata.batchId, job.id);
    assert.equal(payload.metadata.promptComposition.directionPreset, "aquarela-2d@1");
    assert.equal(payload.parameters.aspectRatio, "9:16");
    assert.equal(payload.parameters.source, "batch");
  }
});

test("rejeição conhecida não derruba o lote e fica terminal sem retry", async () => {
  const dir = stateDir();
  const job = job3();

  const generate = async (item, _job, hooks) => {
    if (item.name === "02-parte") {
      hooks.accepted({ fileId: "rejeitado" });
      throw Object.assign(new Error("provedor recusou"), {
        code: "provider_rejected",
        batchFailureKind: "provider_rejected",
      });
    }
    return { buffer: Buffer.from("video") };
  };

  const summary = await runBatchJob({ job, stateDir: dir, generate, persist: okPersist });

  assert.equal(summary.counts.completed, 2);
  assert.equal(summary.counts.provider_rejected, 1);
  assert.equal(summary.state, "completed_with_failures");

  const gravado = loadBatchJob(dir, job.id);
  const falho = gravado.items.find((item) => item.name === "02-parte");
  assert.equal(falho.state, "provider_rejected");
  assert.match(falho.error.message, /recusou/);
  assert.equal(falho.recovery, "authorize_new_attempt");
  assert.equal(falho.relPath, null);
});

test("retomada não regera item já concluído", async () => {
  const dir = stateDir();
  const job = job3();

  // primeira passada: o terceiro item falha comprovadamente antes do POST
  await runBatchJob({
    job,
    stateDir: dir,
    generate: async (item) => {
      if (item.name === "03-parte") throw new Error("queda de rede");
      return { buffer: Buffer.from("video") };
    },
    persist: okPersist,
  });

  // retoma do estado em disco por ação tipada, agora com tudo funcionando
  const retomado = loadBatchJob(dir, job.id);
  const falho = retomado.items.find((item) => item.name === "03-parte");
  assert.equal(falho.state, "pre_submit_failed");
  prepareBatchItemAction(retomado, falho.id, "resume-pre-submit");

  const gerados = [];
  await runBatchJob({
    job: retomado,
    stateDir: dir,
    generate: async (item) => {
      gerados.push(item.name);
      return { buffer: Buffer.from("video") };
    },
    persist: okPersist,
  });

  assert.deepEqual(gerados, ["03-parte"], "regerou item que já estava pronto");
  assert.equal(summarizeBatchJob(loadBatchJob(dir, job.id)).counts.completed, 3);
});

test("estado é gravado a cada transição, não só no fim", async () => {
  const dir = stateDir();
  const job = createBatchJob({ collection: "c", items: [{ prompt: "a" }, { prompt: "b" }], parallel: 1 });
  const snapshots = [];

  await runBatchJob({
    job,
    stateDir: dir,
    generate: async () => {
      // durante a geração, o disco já precisa refletir o item em execução
      snapshots.push(summarizeBatchJob(loadBatchJob(dir, job.id)).counts);
      return { buffer: Buffer.from("video") };
    },
    persist: okPersist,
  });

  assert.ok(
    snapshots.some((counts) => counts.submitting === 1),
    "nenhum snapshot pegou item antes da fronteira de efeito",
  );
  assert.equal(summarizeBatchJob(loadBatchJob(dir, job.id)).counts.completed, 2);
});

test("listagem ordena por criação e ignora arquivo corrompido", async () => {
  const dir = stateDir();
  const a = createBatchJob({ collection: "a", items: [{ prompt: "p" }], id: "batch:aaa" });
  a.createdAt = "2026-01-01T00:00:00.000Z";
  const b = createBatchJob({ collection: "b", items: [{ prompt: "p" }], id: "batch:bbb" });
  b.createdAt = "2026-06-01T00:00:00.000Z";
  saveBatchJob(dir, a);
  saveBatchJob(dir, b);
  fs.writeFileSync(path.join(dir, "lixo.json"), "{ nao é json");

  const listed = listBatchJobs(dir);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, "batch:bbb");
  assert.equal(listed[1].id, "batch:aaa");
});

test("lote inválido é recusado antes de gerar qualquer coisa", async () => {
  const dir = stateDir();
  let chamou = false;
  await assert.rejects(
    () => runBatchJob({ job: { schema: "outra-coisa" }, stateDir: dir, generate: async () => { chamou = true; return {}; }, persist: okPersist }),
    /Lote inválido/,
  );
  assert.equal(chamou, false);
});

test("erro na persistência preserva handle e exige somente retry local", async () => {
  const dir = stateDir();
  const job = job3();

  const summary = await runBatchJob({
    job,
    stateDir: dir,
    generate: okGenerate,
    persist: async (payload) => {
      if (payload.name === "01-parte") throw new Error("conteúdo não é um MP4 válido");
      return { relPath: `x/${payload.name}.mp4`, receiptId: "r" };
    },
  });

  assert.equal(summary.counts.local_persist_failed, 1);
  assert.equal(summary.counts.completed, 2);
  const falho = loadBatchJob(dir, job.id).items.find((item) => item.name === "01-parte");
  assert.match(falho.error.message, /MP4/);
  assert.equal(falho.recovery, "retry_persist_only");
  assert.equal(falho.fileId, "f1");
});

test("queda depois do handle vira ambígua e resume não a admite", async () => {
  const dir = stateDir();
  const job = createBatchJob({ collection: "c", items: [{ prompt: "p" }] });
  let chamadas = 0;
  await runBatchJob({
    job,
    stateDir: dir,
    generate: async (_item, _job, hooks) => {
      chamadas += 1;
      hooks.accepted({ fileId: "handle-1", interactionId: "interaction-1" });
      throw Object.assign(new Error("timeout depois do aceite"), { code: "ambiguous_state" });
    },
    persist: okPersist,
  });
  const saved = loadBatchJob(dir, job.id);
  assert.equal(saved.items[0].state, "ambiguous");
  assert.equal(saved.items[0].effectBoundaryReached, true);
  assert.equal(saved.items[0].recovery, "reconcile_by_handle");
  await runBatchJob({ job: saved, stateDir: dir, generate: async () => { chamadas += 1; }, persist: okPersist });
  assert.equal(chamadas, 1, "estado ambíguo voltou à fila");
});

test("cancelamento e reordenação alteram apenas itens ainda não admitidos", () => {
  const job = createBatchJob({
    collection: "c",
    items: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }],
  });
  reorderPendingItems(job, ["item:003", "item:001", "item:002"]);
  assert.deepEqual(job.items.map((item) => item.id), ["item:003", "item:001", "item:002"]);
  job.items[0].state = "provider_pending";
  requestBatchCancellation(job);
  assert.equal(job.items[0].state, "provider_pending");
  assert.deepEqual(job.items.slice(1).map((item) => item.state), ["cancelled", "cancelled"]);
});

test("nova tentativa após rejeição exige confirmação humana e preserva histórico", () => {
  const job = createBatchJob({ collection: "c", items: [{ prompt: "a" }] });
  const item = job.items[0];
  item.state = "provider_rejected";
  item.effectBoundaryReached = true;
  item.attemptId = "attempt:old";
  item.attemptNumber = 1;
  assert.throws(() => prepareBatchItemAction(job, item.id, "new-attempt"), /confirmação humana/);
  prepareBatchItemAction(job, item.id, "new-attempt", { confirmHuman: true });
  assert.equal(item.state, "pending");
  assert.notEqual(item.attemptId, "attempt:old");
  assert.equal(item.priorAttempts[0].attemptId, "attempt:old");
});

test("batch-job@1 é projetado read-only e falha antiga vira ambígua", () => {
  const legacy = {
    schema: "mkt-videos/batch-job@1",
    id: "batch:legacy",
    collection: "legado",
    parallel: 1,
    defaults: {},
    items: [{ id: "item:001", name: "a", prompt: "p", state: "failed", error: "queda" }],
  };
  const projected = projectBatchJob(legacy);
  assert.equal(projected.schema, BATCH_JOB_SCHEMA);
  assert.equal(projected.sourceSchema, "mkt-videos/batch-job@1");
  assert.equal(projected.items[0].state, "ambiguous");
  assert.throws(() => saveBatchJob(stateDir(), legacy), /batch-job@4/);
});

test("resultado de reconcile conclui sem criar nova tentativa", () => {
  const job = createBatchJob({ collection: "c", items: [{ prompt: "a" }] });
  const item = job.items[0];
  item.state = "ambiguous";
  item.attemptId = "attempt:one";
  item.fileId = "file:one";
  item.effectBoundaryReached = true;
  applyBatchItemRecoveryResult(job, item.id, {
    state: "completed",
    relPath: "c/a.mp4",
    receiptId: "receipt:sha256:x",
  });
  assert.equal(item.state, "completed");
  assert.equal(item.attemptId, "attempt:one");
  assert.equal(item.relPath, "c/a.mp4");
});

// --- ADR 0039: referência externa em lote durável ---------------------------

test("batch-job@2 é projetado para @4 sem referências e sem mudar comportamento", () => {
  const anterior = {
    schema: "mkt-videos/batch-job@2",
    id: "batch:anterior",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    collection: "legado",
    defaults: { aspectRatio: "16:9", task: "text_to_video", mode: "raw", directionPreset: null, model: "gemini-omni-flash-preview" },
    parallel: 3,
    state: "pending",
    cancelRequested: false,
    events: [],
    items: [{ id: "item:001", name: "parte-001", prompt: "p", state: "pending", attemptId: null, attemptNumber: 0, priorAttempts: [], effectBoundaryReached: false, interactionId: null, fileId: null, relPath: null, receiptId: null, error: null, recovery: null, startedAt: null, acceptedAt: null, completedAt: null, config: null, templateBinding: null }],
  };
  const projected = projectBatchJob(anterior);
  assert.equal(projected.schema, BATCH_JOB_SCHEMA);
  assert.equal(projected.sourceSchema, "mkt-videos/batch-job@2");
  assert.deepEqual(projected.items[0].references, []);
  assert.equal(projected.items[0].state, "pending");
  assert.equal(projected.parallel, 3);
});

test("a ordem congelada distingue lotes que só diferem nas referências", () => {
  const semReferencia = createBatchJob({ collection: "c", items: [{ prompt: "mesmo prompt" }] });
  const comReferencia = createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [{ prompt: "mesmo prompt", references: [reference("a")] }],
  });
  const outraReferencia = createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [{ prompt: "mesmo prompt", references: [reference("b")] }],
  });
  // Sem isto, ignorar as referências passaria despercebido pela auditoria.
  assert.notEqual(
    projectProductionOrder(semReferencia).fingerprint,
    projectProductionOrder(comReferencia).fingerprint,
  );
  assert.notEqual(
    projectProductionOrder(comReferencia).fingerprint,
    projectProductionOrder(outraReferencia).fingerprint,
  );
});

test("descritor de referência recusa caminho, hash inválido e MIME incompatível", () => {
  const comFile = (file) => () => createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [{ prompt: "p", references: [{ ...reference(), file }] }],
  });
  assert.throws(comFile("../fora.png"), /nome simples/);
  assert.throws(comFile("sub/dentro.png"), /nome simples/);
  assert.throws(comFile(""), /nome simples/);
  assert.throws(() => createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [{ prompt: "p", references: [{ ...reference(), sha256: "curto" }] }],
  }), /sha256/);
  assert.throws(() => createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [{ prompt: "p", references: [{ ...reference(), mimeType: "video/mp4" }] }],
  }), /MIME incompatível/);
  assert.throws(() => createBatchJob({
    collection: "c",
    items: [{ prompt: "p", references: [reference()] }],
  }), /text_to_video não aceita referências/);
});

test("item sem autoridade sai da fila e só a reconfirmação humana o devolve", () => {
  const job = createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [
      { prompt: "com referência", references: [reference()] },
      { prompt: "sem referência", config: { task: "text_to_video" } },
    ],
  });

  const suspensos = suspendUnauthorizedReferenceItems(job, () => false);
  assert.deepEqual(suspensos, ["item:001"]);
  assert.equal(job.items[0].state, "pre_submit_failed");
  assert.equal(job.items[0].recovery, "reauthorize_references");
  assert.equal(job.items[0].effectBoundaryReached, false);
  // Parte sem entrada externa nunca é afetada.
  assert.equal(job.items[1].state, "pending");
  // O lote precisa dizer que há pendência humana, não parecer apenas pendente.
  assert.equal(job.state, "attention_required");

  // A retomada genérica não serve: ela devolveria o item à fila sem permit.
  assert.throws(
    () => prepareBatchItemAction(job, "item:001", "resume-pre-submit"),
    /nova confirmação humana/,
  );
  assert.throws(
    () => authorizeReferenceReattempt(job, { confirmHuman: false }),
    /confirmação humana explícita/,
  );

  const devolvidos = authorizeReferenceReattempt(job, { confirmHuman: true });
  assert.deepEqual(devolvidos, ["item:001"]);
  assert.equal(job.items[0].state, "pending");
  assert.equal(job.items[0].recovery, null);
  assert.equal(job.items[0].attemptNumber, 0, "reconfirmar não inventa tentativa");
});

test("autoridade vigente mantém o item na fila e itens já enviados não são tocados", () => {
  const job = createBatchJob({
    collection: "c",
    defaults: { task: "reference_to_video" },
    items: [{ prompt: "com referência", references: [reference()] }],
  });
  assert.deepEqual(suspendUnauthorizedReferenceItems(job, () => true), []);
  assert.equal(job.items[0].state, "pending");

  job.items[0].state = "provider_pending";
  job.items[0].effectBoundaryReached = true;
  assert.deepEqual(suspendUnauthorizedReferenceItems(job, () => false), []);
  assert.equal(job.items[0].state, "provider_pending", "o que já saiu nunca volta para a fila");
});

test("retry bounded persiste dueAt, libera o worker e só reabre em execução posterior", async () => {
  const directory = stateDir();
  try {
    const job = createBatchJob({ collection: "c", items: [{ prompt: "a" }], maxAttempts: 2 });
    let calls = 0;
    await runBatchJob({
      job,
      stateDir: directory,
      generate: async () => { calls += 1; throw new Error("falha antes do POST"); },
      persist: okPersist,
    });
    assert.equal(calls, 1);
    assert.equal(job.items[0].recovery, "retry_when_due");
    assert.ok(Date.parse(job.items[0].retryDueAt) > Date.now());
    // A mesma invocação acabou: nenhum worker dormiu e nenhuma segunda
    // submissão aconteceu. Uma retomada posterior respeita dueAt persistido.
    job.items[0].retryDueAt = new Date(Date.now() - 1).toISOString();
    await runBatchJob({
      job,
      stateDir: directory,
      generate: async () => { calls += 1; return { buffer: Buffer.from("video"), fileId: "f2" }; },
      persist: okPersist,
    });
    assert.equal(calls, 2);
    assert.equal(job.items[0].state, "completed");
    assert.equal(job.items[0].priorAttempts.length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
