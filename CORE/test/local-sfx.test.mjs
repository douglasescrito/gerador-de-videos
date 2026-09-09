import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAssetRuntime, authorizeStoredLocalAssets } from "../lib/media-pipeline/local-asset-use.mjs";
import { mixAudio } from "../lib/media-pipeline/audio-mix.mjs";
import { runCommand, runFfmpeg, probeMedia } from "../lib/media-pipeline/media-tools.mjs";
import { governedSfxFixture } from "./fixtures/governed-sfx.mjs";

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-sfx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "effect.wav");
  await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=800:duration=0.5", "-ar", "48000", "-ac", "2", file]);
  const stored = await governedSfxFixture({ root, file, ...options });
  const authorize = await createLocalAssetRuntime(stored.context);
  return { ...stored, root, file, authorize, request: { rootScopeId: stored.context.rootScopeId, assets: [stored.asset] } };
}

test("SFX materializa silêncio, cue no instante exato e cauda com duração congelada", async (t) => {
  const f = await fixture(t);
  const [authorized] = await f.authorize(f.request);
  const outputFile = path.join(f.root, "master.wav");
  let guards = 0;
  const result = await mixAudio({ sfxInputs: [{ file: authorized.file, role: "sfx", assetId: f.asset.id, atSeconds: 1, gainDb: -6, authorization: authorized.evidence }],
    durationSeconds: 3, outputFile, loudness: "raw", fadeIn: 0, beforeMix: async () => { guards++; await f.authorize(f.request); } });
  assert.equal(guards, 2, "revalida antes do processamento e da publicação");
  assert.ok(Math.abs((await probeMedia(outputFile)).duration - 3) < 0.001);
  const pcmFile = path.join(f.root, "samples.pcm");
  await runCommand("ffmpeg", ["-v", "error", "-i", outputFile, "-f", "s16le", "-ac", "1", pcmFile]);
  const pcm = await readFile(pcmFile);
  const peak = (from, to) => { let maximum = 0; for (let i = from * 48000; i < to * 48000; i++) maximum = Math.max(maximum, Math.abs(pcm.readInt16LE(i * 2))); return maximum; };
  assert.equal(peak(0, 1), 0);
  assert.ok(peak(1, 1.5) > 1000);
  assert.equal(peak(1.5, 3), 0);
  assert.equal(result.receipt.inputs[0].role, "sfx");
  assert.equal(result.receipt.parameters.sfxCues[0].authorization.itemHash, f.target.contentHash);
  assert.match(result.receipt.parameters.sfxCues[0].authorization.rightsHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result.receipt).includes(f.context.dbFile));
});

test("reuso exige root, binding, bytes e direitos vigentes; revogação durante resolução bloqueia", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.authorize({ ...f.request, rootScopeId: "client:other" }), /root/);
  await assert.rejects(f.authorize({ ...f.request, assets: [{ ...f.asset, authorization: { ...f.asset.authorization, bindingHash: "b".repeat(64) } }] }), /binding/);
  await assert.rejects(authorizeStoredLocalAssets({ ...f.request, repository: f.repository, grant: structuredClone(f.grant), rootResolver: () => path.dirname(f.file) }), /ScopeGrant/);
  const original = await readFile(f.file);
  await writeFile(f.file, Buffer.concat([original, Buffer.from("changed")]));
  await assert.rejects(f.authorize(f.request), /Bytes/);
  await writeFile(f.file, original);
  await assert.rejects(authorizeStoredLocalAssets({ ...f.request, repository: f.repository, grant: f.grant,
    rootResolver: () => { f.changeRights({ permissions: { reuse: "revoked" } }); return path.dirname(f.file); } }), /reuse bloqueado: revoked/);
});

test("direito desconhecido, negado e expirado nunca autoriza mixagem", async (t) => {
  const f = await fixture(t);
  for (const state of ["unknown", "denied"]) {
    f.changeRights({ permissions: { reuse: state } });
    await assert.rejects(f.authorize(f.request), new RegExp(`reuse bloqueado: ${state}`));
  }
  const expiry = new Date(Date.now() + 1000);
  f.changeRights({ permissions: { reuse: "allowed" }, expiresAt: expiry.toISOString() });
  const afterExpiry = await createLocalAssetRuntime(f.context, { clock: () => new Date(expiry.getTime() + 1000) });
  await assert.rejects(afterExpiry(f.request), /bloqueado: expired/);
});

test("revogação depois do FFmpeg impede publicar master e recibo", async (t) => {
  const f = await fixture(t);
  const outputFile = path.join(f.root, "must-not-exist.wav");
  let calls = 0;
  await assert.rejects(mixAudio({ sfxInputs: [{ file: f.file, atSeconds: 0, gainDb: 0 }], durationSeconds: 1, outputFile,
    beforeMix: async () => { if (++calls === 2) f.changeRights({ permissions: { reuse: "denied" } }); await f.authorize(f.request); } }), /reuse bloqueado: denied/);
  assert.equal(calls, 2);
  await assert.rejects(access(outputFile), { code: "ENOENT" });
  await assert.rejects(access(`${outputFile}.receipt.json`), { code: "ENOENT" });
});
