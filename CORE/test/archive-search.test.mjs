import assert from "node:assert/strict";
import test from "node:test";
import { searchArchive } from "../lib/media-pipeline/archive-search.mjs";

const catalog = {
  videos: [
    { id: "a/um.mp4", relPath: "a/um.mp4", title: "Primeiro", collectionId: "a", collectionName: "A", duration: 30, aspect: "portrait", mtimeMs: 2, isMaster: false },
    { id: "b/dois.mp4", relPath: "b/dois.mp4", title: "Segundo", collectionId: "b", collectionName: "B", duration: 60, aspect: "landscape", mtimeMs: 1, isMaster: true },
  ],
};
const promptIndex = {
  entries: {
    "a/um.mp4": {
      receiptId: "receipt:a",
      prompt: "Comercial de astronomia",
      promptComposition: { userPrompt: "Produto estrelas", effectivePrompt: "Animação produto estrelas", directionPreset: "flat-2d@1" },
      task: "text_to_video",
      aspectRatio: "9:16",
      mode: "studio",
      model: "gemini-omni-flash-preview",
      batchId: "batch:1",
      templateBinding: { templateId: "comercial", templateRevision: 2, templateHash: "a".repeat(64), values: { produto: "estrelas" } },
    },
  },
};
const transcripts = [{
  schema: "mkt-videos/media-transcript@1",
  assetId: "b/dois.mp4",
  text: "uma jornada pelo oceano profundo",
  language: "pt",
}];

test("FTS encontra prompt e fala sem cruzar fatos ausentes", () => {
  assert.deepEqual(
    searchArchive({ catalog, promptIndex, transcripts, filters: { q: "estrelas" } }).rows.map(({ relPath }) => relPath),
    ["a/um.mp4"],
  );
  assert.deepEqual(
    searchArchive({ catalog, promptIndex, transcripts, filters: { q: "oceano profundo" } }).rows.map(({ relPath }) => relPath),
    ["b/dois.mp4"],
  );
  assert.equal(searchArchive({ catalog, promptIndex, transcripts, filters: { q: "inexistente" } }).total, 0);
});

test("filtros técnicos, template e cobertura combinam por AND", () => {
  const result = searchArchive({
    catalog,
    promptIndex,
    transcripts,
    filters: {
      collection: "a",
      preset: "flat-2d@1",
      templateId: "comercial",
      templateRevision: 2,
      minDuration: 20,
      maxDuration: 40,
      promptRecorded: true,
      transcriptRecorded: false,
    },
  });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].templateBinding.templateRevision, 2);
  assert.deepEqual(result.coverage, { videos: 2, prompt: 1, transcript: 1, measured: 2, reviewed: 0, liked: 0 });
});

test("pagina sem repetir nem esconder partes da coleção", () => {
  const pagedCatalog = {
    videos: [
      { id: "a/novo.mp4", relPath: "a/novo.mp4", title: "Novo", collectionId: "a", collectionName: "A", mtimeMs: 3 },
      { id: "a/meio-b.mp4", relPath: "a/meio-b.mp4", title: "Meio B", collectionId: "a", collectionName: "A", mtimeMs: 2 },
      { id: "a/meio-a.mp4", relPath: "a/meio-a.mp4", title: "Meio A", collectionId: "a", collectionName: "A", mtimeMs: 2 },
      { id: "a/antigo.mp4", relPath: "a/antigo.mp4", title: "Antigo", collectionId: "a", collectionName: "A", mtimeMs: 1 },
    ],
  };
  const first = searchArchive({ catalog: pagedCatalog, promptIndex: { entries: {} }, filters: { limit: 2 } });
  const second = searchArchive({
    catalog: pagedCatalog,
    promptIndex: { entries: {} },
    filters: { limit: 2, cursor: JSON.stringify(first.nextCursor) },
  });

  assert.equal(first.total, 4);
  assert.deepEqual(first.rows.map(({ relPath }) => relPath), ["a/novo.mp4", "a/meio-a.mp4"]);
  assert.deepEqual(second.rows.map(({ relPath }) => relPath), ["a/meio-b.mp4", "a/antigo.mp4"]);
  assert.equal(second.nextCursor, null);
});
