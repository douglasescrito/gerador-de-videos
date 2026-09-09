import assert from "node:assert/strict";
import test from "node:test";
import {
  listSmartCollections,
  saveSmartCollection,
} from "../lib/media-pipeline/smart-collection-service.mjs";

function repository() {
  const items = [];
  return {
    getKnowledgeItem({ id }) {
      return [...items].reverse().find((item) => item.id === id) ?? null;
    },
    listKnowledgeItems() {
      const latest = new Map();
      items.forEach((item) => latest.set(item.id, item));
      return [...latest.values()];
    },
    appendKnowledgeItem({ item }) {
      const written = { ...item, contentHash: String(item.revision).repeat(64).slice(0, 64) };
      items.push(written);
      return written;
    },
  };
}

test("consulta salva é governada, versionada e nunca contém prompt", () => {
  const store = repository();
  const first = saveSmartCollection({
    repository: store,
    grant: {},
    rootScopeId: "client:a",
    input: {
      collectionId: "verticais",
      name: "Verticais sem prompt",
      filters: { aspect: "9:16", promptRecorded: false, minDuration: 30 },
    },
    actor: "human:test-operator",
    confirmHuman: true,
    clock: () => new Date("2026-07-30T12:00:00.000Z"),
  });
  const second = saveSmartCollection({
    repository: store,
    grant: {},
    rootScopeId: "client:a",
    input: {
      collectionId: "verticais",
      name: "Verticais curtos",
      filters: { aspect: "9:16", maxDuration: 45 },
    },
    actor: "human:test-operator",
    confirmHuman: true,
    clock: () => new Date("2026-07-30T12:01:00.000Z"),
  });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.deepEqual(listSmartCollections({
    repository: store,
    grant: {},
    rootScopeId: "client:a",
  }).map(({ name }) => name), ["Verticais curtos"]);
  assert.doesNotMatch(JSON.stringify(second), /prompt literal|cookie|token/i);
});

test("salvar consulta exige confirmação humana e condição real", () => {
  const store = repository();
  assert.throws(() => saveSmartCollection({
    repository: store,
    grant: {},
    rootScopeId: "client:a",
    input: { collectionId: "x", name: "X", filters: { aspect: "9:16" } },
    actor: "human:test-operator",
    confirmHuman: false,
  }), /confirmHuman=true/);
  assert.throws(() => saveSmartCollection({
    repository: store,
    grant: {},
    rootScopeId: "client:a",
    input: { collectionId: "x", name: "X", filters: {} },
    actor: "human:test-operator",
    confirmHuman: true,
  }), /entre 1 e 30/);
});
