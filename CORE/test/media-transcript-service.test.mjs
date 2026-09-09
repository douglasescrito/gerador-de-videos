import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  listMediaTranscripts,
  transcribeAndPersistMedia,
} from "../lib/media-pipeline/media-transcript-service.mjs";

const ROOT = "client:transcript";
const ACTOR = "human:test-operator";

function fakeRepository({ localAnalysis = "allowed", textualIndexing = "allowed" } = {}) {
  const items = [];
  return {
    resolveReferenceAssetEffectiveRights() {
      return {
        targetItem: {
          id: "video:um",
          rootScopeId: ROOT,
          scopeId: ROOT,
          governance: {
            classification: "confidential",
            owner: { type: "client", id: ROOT },
            retention: { policy: "manual-review", expiresAt: null },
            rights: { localAnalysis, textualIndexing },
          },
        },
        effectiveRights: {
          authority: "knowledge-store-head-only",
          permissions: {
            localAnalysis: { state: localAnalysis },
            textualIndexing: { state: textualIndexing },
          },
        },
      };
    },
    listKnowledgeItems() {
      return items;
    },
    appendKnowledgeItem({ item }) {
      const written = {
        ...item,
        contentHash: "b".repeat(64),
      };
      items.push(written);
      return written;
    },
  };
}

test("transcrição local exige direitos antes de ler e persiste authority none", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "transcript-service-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const videoFile = path.join(temporary, "video.mp4");
  await writeFile(videoFile, Buffer.from("video para hash"));
  let calls = 0;
  const repository = fakeRepository();
  const result = await transcribeAndPersistMedia({
    repository,
    grant: {},
    rootScopeId: ROOT,
    assetId: "video:um",
    videoFile,
    actor: ACTOR,
    transcriber: async () => {
      calls += 1;
      return {
        text: "fala pesquisável",
        segments: [{ start: 0, end: 1.2, text: "fala pesquisável" }],
        language: "pt",
        engine: { id: "whisper-local", model: "small" },
      };
    },
    clock: () => new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "candidate");
  assert.equal(result.payload.authority, "none");
  assert.equal(result.payload.text, "fala pesquisável");
  assert.equal(result.payload.artifactHash.length, 64);
  assert.equal(listMediaTranscripts({ repository, grant: {}, rootScopeId: ROOT }).length, 1);
});

test("direito desconhecido bloqueia antes do Whisper", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "transcript-rights-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const videoFile = path.join(temporary, "video.mp4");
  await writeFile(videoFile, Buffer.from("não deve ser lido"));
  let calls = 0;
  await assert.rejects(
    () => transcribeAndPersistMedia({
      repository: fakeRepository({ textualIndexing: "unknown" }),
      grant: {},
      rootScopeId: ROOT,
      assetId: "video:um",
      videoFile,
      actor: ACTOR,
      transcriber: async () => {
        calls += 1;
        return {};
      },
    }),
    /não permite textualIndexing|não está allowed/,
  );
  assert.equal(calls, 0);
});
