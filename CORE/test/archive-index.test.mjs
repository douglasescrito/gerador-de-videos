import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildArchiveIndex, importExternalFavoriteEvents, initializeArchiveLifecycle, listArchiveFavorites, listRecipePreferences, searchArchive, setArchiveFavorite, setArchiveReview, setRecipePreference, summarizeArchiveLifecycle } from "../lib/media-pipeline/archive-index.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";

test("índice FTS encontra recibo e mantém review fora do recibo imutável", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-index-"));
  try {
    const outputs = path.join(dir, "outputs", "colecao-a", "receitas");
    await mkdir(outputs, { recursive: true });
    const receiptFile = path.join(outputs, "parte-001.receipt.json");
    const receipt = createStageReceipt({ operation: "generate-video", provider: "test", model: "omni", stage: "video", prompt: "ponte em aquarela", parameters: { task: "text_to_video", style: "aquarela-2d@1" } });
    await writeStageReceipt(receiptFile, receipt);
    const receiptBefore = await readFile(receiptFile);
    const dbFile = path.join(dir, "acervo.sqlite");
    const summary = await buildArchiveIndex({ root: path.join(dir, "outputs"), dbFile });
    assert.equal(summary.indexed, 1);
    let results = searchArchive({ dbFile, query: "aquarela" });
    assert.equal(results.length, 1);
    setArchiveReview({ dbFile, receiptPath: receiptFile, status: "approved", rating: 5, tags: ["bom", "bom", "bom-extra", "CaseSensitive"] });
    results = searchArchive({ dbFile, reviewStatus: "approved" });
    assert.equal(results[0].rating, 5);
    assert.deepEqual(results[0].tags, ["bom", "bom-extra", "CaseSensitive"]);
    assert.equal(searchArchive({ dbFile, tag: "bom" }).length, 1);
    assert.equal(searchArchive({ dbFile, tag: "bo" }).length, 0);
    assert.equal(searchArchive({ dbFile, tag: "Bom" }).length, 0);
    assert.equal(searchArchive({ dbFile, tag: "bom-extra" }).length, 1);
    assert.deepEqual(await readFile(receiptFile), receiptBefore);

    const lifecycle = summarizeArchiveLifecycle({ dbFile });
    assert.deepEqual(lifecycle, {
      schema: "mkt-videos/archive-index@1",
      receipts: 1,
      collections: 1,
      reviewed: 1,
      unreviewed: 0,
      statuses: { approved: 1 },
      tags: [
        { tag: "CaseSensitive", count: 1 },
        { tag: "bom", count: 1 },
        { tag: "bom-extra", count: 1 },
      ],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("receipt concluído faz upsert incremental no índice padrão de outputs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-index-upsert-"));
  try {
    const outputs = path.join(dir, "outputs");
    const receiptFile = path.join(outputs, "colecao", "receitas", "novo.receipt.json");
    const receipt = createStageReceipt({ operation: "generate-video", provider: "test", stage: "video", prompt: "índice incremental" });
    await writeStageReceipt(receiptFile, receipt);
    const results = searchArchive({ dbFile: path.join(outputs, "archive.sqlite"), query: "incremental" });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, receipt.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("inicialização lifecycle só classifica recibos sem review e não reescreve recibos", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-index-lifecycle-"));
  try {
    const receipts = path.join(dir, "outputs", "colecao", "receitas");
    await mkdir(receipts, { recursive: true });
    const first = path.join(receipts, "a.receipt.json");
    const second = path.join(receipts, "b.receipt.json");
    await writeStageReceipt(first, createStageReceipt({ operation: "generate-video", provider: "test", stage: "video", prompt: "a" }));
    await writeStageReceipt(second, createStageReceipt({ operation: "generate-video", provider: "test", stage: "video", prompt: "b" }));
    const before = await Promise.all([readFile(first), readFile(second)]);
    const dbFile = path.join(dir, "archive.sqlite");
    await buildArchiveIndex({ root: path.join(dir, "outputs"), dbFile });
    setArchiveReview({ dbFile, receiptPath: first, status: "approved", tags: ["delivery"] });
    const initialized = initializeArchiveLifecycle({ dbFile, now: new Date("2026-07-23T12:00:00.000Z") });
    assert.equal(initialized.initialized, 1);
    assert.equal(initializeArchiveLifecycle({ dbFile }).initialized, 0);
    assert.equal(searchArchive({ dbFile, tag: "delivery" }).length, 1);
    assert.equal(searchArchive({ dbFile, tag: "needs-review" }).length, 1);
    assert.deepEqual(await Promise.all([readFile(first), readFile(second)]), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("favorito marca/desmarca vídeo como evidência humana sem tocar no recibo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-index-fav-"));
  try {
    const receipts = path.join(dir, "outputs", "colecao", "receitas");
    await mkdir(receipts, { recursive: true });
    const receiptFile = path.join(receipts, "a.receipt.json");
    await writeStageReceipt(receiptFile, createStageReceipt({ operation: "generate-video", provider: "test", stage: "video", prompt: "favorito" }));
    const before = await readFile(receiptFile);
    const dbFile = path.join(dir, "archive.sqlite");
    await buildArchiveIndex({ root: path.join(dir, "outputs"), dbFile });

    setArchiveFavorite({ dbFile, relPath: "colecao/a.mp4", receiptPath: receiptFile, liked: true });
    // O marcador é um log append-only ligado ao vídeo; recibo é proveniência
    // opcional e permanece preservado.
    const db = new (await import("node:sqlite")).DatabaseSync(dbFile, { readOnly: true });
    const gravado = db.prepare("SELECT rel_path, receipt_path, liked FROM favorite_events").all();
    db.close();
    assert.equal(gravado.length, 1);
    assert.equal(gravado[0].liked, 1);
    assert.equal(gravado[0].rel_path, "colecao/a.mp4");
    assert.ok(gravado[0].receipt_path.endsWith("a.receipt.json"));

    // Repetir preserva os dois eventos humanos, sem reescrever história.
    setArchiveFavorite({ dbFile, relPath: "colecao/a.mp4", receiptPath: receiptFile, liked: true });
    const db2 = new (await import("node:sqlite")).DatabaseSync(dbFile, { readOnly: true });
    assert.equal(db2.prepare("SELECT event_id FROM favorite_events").all().length, 2);
    db2.close();

    // Desmarcar registra um evento terminal; não apaga os anteriores.
    setArchiveFavorite({ dbFile, relPath: "colecao/a.mp4", receiptPath: receiptFile, liked: false });
    const db3 = new (await import("node:sqlite")).DatabaseSync(dbFile, { readOnly: true });
    const eventos = db3.prepare("SELECT liked FROM favorite_events ORDER BY event_id").all();
    assert.deepEqual(eventos.map((evento) => evento.liked), [1, 1, 0]);
    db3.close();

    // O recibo original permanece intacto.
    assert.deepEqual(await readFile(receiptFile), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preferência de receita é append-only e a projeção usa o evento mais recente", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-recipe-fav-"));
  try {
    const dbFile = path.join(dir, "archive.sqlite");
    const outputs = path.join(dir, "outputs");
    await mkdir(outputs, { recursive: true });
    await buildArchiveIndex({ root: outputs, dbFile });
    const identity = {
      dbFile,
      preferenceKey: "a".repeat(64),
      recipeId: "receita-motion",
      recipeHash: "b".repeat(64),
      style: "flat-2d@1",
      motionCombinationId: "high-impact-manifesto@1",
      motionInstructionIds: ["semantic-hero-type@1", "shape-continuity-transition@1"],
      sourceFile: "candidatas/geradas.json",
    };
    const liked = setRecipePreference({ ...identity, liked: true });
    assert.equal(liked.liked, true);
    assert.equal(liked.schema, "mkt-videos/recipe-preference-event@1");
    setRecipePreference({ ...identity, liked: false });

    const db = new (await import("node:sqlite")).DatabaseSync(dbFile, { readOnly: true });
    const events = db.prepare("SELECT liked FROM recipe_preference_events ORDER BY event_id").all();
    db.close();
    assert.deepEqual(events.map((event) => event.liked), [1, 0]);
    assert.equal(listRecipePreferences({ dbFile })[0].liked, false);
    assert.deepEqual(listRecipePreferences({ dbFile, likedOnly: true }), []);

    setRecipePreference({ ...identity, liked: true });
    const current = listRecipePreferences({ dbFile, likedOnly: true });
    assert.equal(current.length, 1);
    assert.equal(current[0].motionCombinationId, "high-impact-manifesto@1");
    assert.deepEqual(current[0].motionInstructionIds, ["semantic-hero-type@1", "shape-continuity-transition@1"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eventos externos de favorito são importados uma vez sem perder unlike", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "archive-external-favorites-"));
  try {
    const dbFile = path.join(root, "archive.sqlite");
    await buildArchiveIndex({ root, dbFile });
    const events = [
      { sourceEventId: 1, relPath: "a/video.mp4", liked: true, occurredAt: "2026-08-12T10:00:00Z" },
      { sourceEventId: 2, relPath: "a/video.mp4", liked: false, occurredAt: "2026-08-12T10:01:00Z" },
      { sourceEventId: 3, relPath: "b/video.mp4", liked: true, occurredAt: "2026-08-12T10:02:00Z" },
    ];
    assert.equal(importExternalFavoriteEvents({ dbFile, source: "desktop", events }).imported, 3);
    assert.equal(importExternalFavoriteEvents({ dbFile, source: "desktop", events }).skipped, 3);
    assert.deepEqual(listArchiveFavorites({ dbFile, root }).map((item) => item.relPath), ["b/video.mp4"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
