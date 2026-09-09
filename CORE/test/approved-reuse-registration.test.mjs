import assert from "node:assert/strict";
import { access, link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareApprovedReuse, registerApprovedReuse, readReusePrivateJson, writeReusePrivateJson } from "../lib/media-pipeline/approved-reuse-registration.mjs";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";
import { governedLocalAssetFixture } from "./fixtures/governed-sfx.mjs";
import { runCommand } from "../lib/media-pipeline/media-tools.mjs";
import { readArchiveReview, setArchiveReview, upsertArchiveReceipt } from "../lib/media-pipeline/archive-index.mjs";
import { referenceRightsItemId } from "../lib/media-pipeline/knowledge-effective-rights.mjs";
import { createScopeGrant } from "../lib/media-pipeline/knowledge-store.mjs";
import { DatabaseSync } from "node:sqlite";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "reuse-registration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "master.mp4");
  await writeFile(file, "isolated-fixture");
  const stored = await governedLocalAssetFixture({ root, file, mediaKind: "video", mediaType: "video/mp4", role: "motion-master" });
  const artifact = await createArtifactFromFile({ file, kind: "video", role: "motion-master" });
  const receiptFile = `${file}.receipt.json`;
  const receipt = createStageReceipt({ operation: "render-motion-graphics", provider: "ffmpeg", stage: "graphics", parameters: { consumer: { id: "render-motion-graphics", version: "motion-graphics@1.1.0" } }, artifacts: [artifact] });
  await writeStageReceipt(receiptFile, receipt);
  const dbFile = path.join(root, "archive.sqlite");
  const context = { ...stored.context, reuse: { dbFile, candidates: [] } };
  const contextFile = path.join(root, "context.json");
  await writeFile(contextFile, JSON.stringify(context));
  const options = { context, dbFile, sourceReceiptFile: receiptFile, artifactRole: "motion-master", rootAlias: "sfx", reason: "Aprovo este grafismo para reaproveitamento local.", coreRoot: path.join(root, "workspace", "CORE") };
  const items = () => stored.repository.listKnowledgeItems({ grant: stored.grant, rootScopeId: context.rootScopeId });
  const cli = async (...args) => JSON.parse((await runCommand(process.execPath, ["scripts/omni-cli.mjs", "reuse", ...args])).stdout);
  return { ...stored, root, file, dbFile, context, contextFile, receiptFile, receipt, options, items, cli };
}

test("CLI prepara sem conceder direitos, registra decisão exata e produz contexto utilizável", async (t) => {
  const f = await fixture(t);
  const proposalFile = path.join(f.root, "proposal.json");
  const baseline = f.items().length;
  const prepared = await f.cli("--action", "prepare", "--asset-context", f.contextFile, "--source-receipt", f.receiptFile, "--role", "motion-master", "--root-alias", "sfx", "--reason", f.options.reason, "--out", proposalFile);
  assert.equal(prepared.authority, "none");
  const proposal = JSON.parse(await readFile(proposalFile, "utf8"));
  assert.equal(proposal.governance.schema, "mkt-videos/knowledge-record-envelope@1");
  assert.equal(proposal.governance.createdBy, "cli:reuse-proposal");
  assert.equal(proposal.governance.rights.reuse, "denied");
  assert.equal(proposal.registration.rights.reuse, "allowed");
  assert.equal(f.items().length, baseline);
  await assert.rejects(access(f.dbFile), { code: "ENOENT" });
  const registeredContextFile = path.join(f.root, "approved-context.json");
  await assert.rejects(f.cli("--action", "register", "--input", proposalFile, "--expected-proposal-hash", prepared.proposalHash, "--out", registeredContextFile), /confirm-human/);
  assert.equal(f.items().length, baseline);
  const result = await f.cli("--action", "register", "--input", proposalFile, "--expected-proposal-hash", prepared.proposalHash, "--confirm-human", "true", "--out", registeredContextFile);
  assert.equal(result.status, "registered");
  assert.equal(f.items().length, baseline + 2);
  const context = JSON.parse(await readFile(registeredContextFile, "utf8"));
  assert.equal(context.reuse.candidates[0].asset.authorization.bindingHash, result.itemHash);
  const copied = await f.cli("--source-receipt", f.receiptFile, "--asset-context", registeredContextFile, "--role", "motion-master", "--policy", "require-approved", "--out", path.join(f.root, "copied.mp4"));
  assert.equal(copied.hit, true);
  assert.equal(copied.receipt.metadata.avoidedOperation, null);
  assert.equal(await readFile(f.file, "utf8"), "isolated-fixture");
});

test("registro retoma a mesma proposta sem duplicar itens nem restaurar direitos revogados", async (t) => {
  const f = await fixture(t);
  await upsertArchiveReceipt({ root: path.dirname(f.root), dbFile: f.dbFile, receiptFile: f.receiptFile });
  const proposal = await prepareApprovedReuse(f.options);
  const request = { proposal, expectedProposalHash: proposal.hash, confirmHuman: true, coreRoot: f.options.coreRoot };
  const first = await registerApprovedReuse(request);
  const count = f.items().length;
  const retry = await registerApprovedReuse(request);
  assert.deepEqual(retry, first);
  assert.equal(f.items().length, count);
  const index = new DatabaseSync(f.dbFile, { readOnly: true });
  try { assert.equal(index.prepare("SELECT value FROM metadata WHERE key='root'").get().value, path.dirname(f.root)); } finally { index.close(); }
  const target = f.repository.getKnowledgeItem({ grant: f.grant, rootScopeId: f.context.rootScopeId, id: first.itemId });
  const rights = f.repository.getKnowledgeItem({ grant: f.grant, rootScopeId: f.context.rootScopeId, id: referenceRightsItemId(target) });
  const grant = createScopeGrant({ rootScopeIds: [f.context.rootScopeId], permissions: ["read", "write"], actor: rights.createdBy, purpose: "Revogar autorização da fixture", issuedAt: f.grant.issuedAt });
  f.repository.appendKnowledgeItem({ grant, item: { ...rights, contentHash: undefined, revision: 2, supersedesRevision: 1, payload: { ...rights.payload, permissions: { ...rights.payload.permissions, reuse: "revoked" } } } });
  await assert.rejects(registerApprovedReuse(request), /revoked/);
});

test("registros concorrentes convergem no mesmo par de itens e retomam a revisão pendente", async (t) => {
  const f = await fixture(t);
  const baseline = f.items().length;
  const proposal = await prepareApprovedReuse(f.options);
  const request = { proposal, expectedProposalHash: proposal.hash, confirmHuman: true, coreRoot: f.options.coreRoot };
  const results = await Promise.allSettled([registerApprovedReuse(request), registerApprovedReuse(request)]);
  assert.ok(results.some((entry) => entry.status === "fulfilled"));
  assert.equal(f.items().length, baseline + 2);
  const reconciled = await registerApprovedReuse(request);
  assert.equal(reconciled.status, "registered");
  assert.equal(f.items().length, baseline + 2);
});

test("mudança de bytes, hash ou revisão editorial bloqueia antes de registrar Knowledge", async (t) => {
  const f = await fixture(t);
  const proposal = await prepareApprovedReuse(f.options);
  const count = f.items().length;
  const request = { proposal, expectedProposalHash: proposal.hash, confirmHuman: true, coreRoot: f.options.coreRoot };
  await assert.rejects(registerApprovedReuse({ ...request, expectedProposalHash: "a".repeat(64) }), /expected-proposal-hash/);
  await writeFile(f.file, "changed");
  await assert.rejects(registerApprovedReuse(request), /Bytes/);
  await writeFile(f.file, "isolated-fixture");
  await upsertArchiveReceipt({ root: f.root, dbFile: f.dbFile, receiptFile: f.receiptFile });
  setArchiveReview({ dbFile: f.dbFile, receiptPath: f.receiptFile, status: "rejected" });
  await assert.rejects(registerApprovedReuse(request), /revisão editorial/);
  assert.equal(f.items().length, count);
  const state = readArchiveReview({ dbFile: f.dbFile, receiptPath: f.receiptFile });
  assert.throws(() => setArchiveReview({ dbFile: f.dbFile, receiptPath: f.receiptFile, status: "approved", expectedReviewHash: proposal.editorialReviewHash }), /revisão editorial/);
  assert.deepEqual(readArchiveReview({ dbFile: f.dbFile, receiptPath: f.receiptFile }), state);
});

test("documentos privados recusam workspace, hardlink, tamanho excessivo e sobrescrita", async (t) => {
  const f = await fixture(t);
  await assert.rejects(writeReusePrivateJson(path.join(f.options.coreRoot, "private.json"), {}, f.options.coreRoot), /workspace/);
  const privateFile = path.join(f.root, "private.json");
  await writeReusePrivateJson(privateFile, { protected: true }, f.options.coreRoot);
  await assert.rejects(writeReusePrivateJson(privateFile, {}, f.options.coreRoot), /existe/);
  const linkedFile = path.join(f.root, "linked.json");
  await link(privateFile, linkedFile);
  await assert.rejects(readReusePrivateJson(linkedFile, f.options.coreRoot), /hardlink/);
  const largeFile = path.join(f.root, "large.json");
  await writeFile(largeFile, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(readReusePrivateJson(largeFile, f.options.coreRoot), /1 MiB/);
});
