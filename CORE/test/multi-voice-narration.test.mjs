import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { finalizeMultiVoiceProof } from "../scripts/estudos/finalize-live-multi-voice-proof.mjs";
import { buildMultiVoiceNarrationPlan, createMultiVoiceNarrationAdapter, executeMultiVoiceNarration, replayMultiVoiceNarration } from "../lib/media-pipeline/multi-voice-narration.mjs";
import { runAdapterConformanceSuite } from "../lib/media-pipeline/adapter-contract.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "multi-voice-"));
  const plan = buildMultiVoiceNarrationPlan({ productionId: "p1", outputDir: root, speakers: [{ id: "a", voice: "Nyla" }, { id: "b", voice: "Charon" }], blocks: [{ id: "s1", speakerId: "a", text: "Olá." }, { id: "s2", speakerId: "b", text: "Vamos." }] });
  const artifacts = [];
  for (const segment of plan.segments) {
    const bytes = Buffer.from(`wav:${segment.id}:${segment.voice}`);
    await writeFile(segment.outputFile, bytes);
    await writeFile(segment.receiptFile, JSON.stringify({ status: "completed", voice: segment.voice, segmentId: segment.id }));
    artifacts.push({ status: "completed", segmentId: segment.id, file: segment.outputFile, receiptFile: segment.receiptFile, sha256: hash(bytes) });
  }
  return { root, plan, artifacts };
}

async function concatSegments({ inputs, outputFile }) { await writeFile(outputFile, Buffer.concat(await Promise.all(inputs.map((file) => readFile(file))))); }
async function alignMaster({ audioFile, blocks, outputFile }) { const value = { status: "measured", audioHash: hash(await readFile(audioFile)), blocks }; await writeFile(outputFile, JSON.stringify(value)); return value; }

test("replay multi-voz exige WAV e recibo distintos e alinha o master global", async () => {
  const { root, plan, artifacts } = await fixture();
  try {
    const replay = await replayMultiVoiceNarration({ plan, segmentArtifacts: artifacts, concatSegments, alignMaster });
    assert.equal(replay.status, "passed");
    assert.equal(replay.providerCalls, 0);
    assert.equal(replay.segmentArtifacts.length, 2);
    assert.equal(replay.alignment.blocks.length, 2);
    await assert.rejects(replayMultiVoiceNarration({ plan, segmentArtifacts: [artifacts[0], { ...artifacts[1], file: artifacts[0].file }], concatSegments, alignMaster }), /diverge do plano|distintos/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("estado ambíguo só avança por reconcile e nunca resubmete", async () => {
  const { root, plan, artifacts } = await fixture();
  try {
    let submitted = 0; let reconciled = 0;
    const replay = await executeMultiVoiceNarration({ plan, generateSegment: async (segment) => { submitted += 1; return segment.id === "s1" ? { status: "ambiguous", handle: "h1" } : artifacts[1]; }, reconcileSegment: async ({ segment }) => { reconciled += 1; return artifacts.find((entry) => entry.segmentId === segment.id); }, concatSegments, alignMaster });
    assert.equal(replay.status, "passed");
    assert.equal(submitted, 2);
    assert.equal(reconciled, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("adapter multi-voz usa o contrato comum e não exige nova UI ou executor", async () => {
  const adapter = createMultiVoiceNarrationAdapter({ generateSegment: async () => ({ status: "failed" }), reconcileSegment: async () => null, concatSegments, alignMaster });
  const registry = { providers: [{ id: "google-vids-multi-voice", operations: ["segmented-text-to-speech"], auth: ["browser-session"], status: "supported", deliveryDependencyAllowed: true, health: { status: "ready" } }] };
  const conformance = await runAdapterConformanceSuite({ adapter, capabilityRegistry: registry, operation: "segmented-text-to-speech" });
  assert.equal(conformance.passed, true);
  assert.equal(conformance.providerFree, true);
});

for (const verdict of ["pass", "blocked"]) {
  test(`auxiliar multi-voz preserva WAVs e respeita alinhamento ${verdict}`, async () => {
    const { root, plan } = await fixture();
    try {
      // Replace only this test's synthetic bytes with real, short tone WAVs.
      for (const segment of plan.segments) {
        const wav = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.15", "-ar", "48000", "-ac", "1", segment.outputFile], { encoding: "utf8", windowsHide: true });
        assert.equal(wav.status, 0, wav.stderr);
      }
      const originals = await Promise.all(plan.segments.map(async (segment) => hash(await readFile(segment.outputFile))));
      const planFile = path.join(root, "plan.json");
      const outFile = path.join(root, "replay.json");
      await writeFile(planFile, JSON.stringify(plan));
      let called = 0;
      let masterHash;
      const invoke = () => finalizeMultiVoiceProof({ planFile, outFile, alignImpl: async (options) => {
        called += 1;
        assert.equal(options.masterFile, plan.masterFile);
        assert.equal(options.wordsFile, plan.alignmentFile);
        assert.equal(options.preserveSingleAudioMaster, true);
        assert.deepEqual(options.blocks, [{ id: "global-master", text: "Olá. Vamos.", audioFile: plan.masterFile }]);
        masterHash = hash(await readFile(plan.masterFile));
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", plan.masterFile], { encoding: "utf8", windowsHide: true });
        assert.equal(probe.status, 0, probe.stderr);
        assert.ok(Math.abs(Number(JSON.parse(probe.stdout).format.duration) - 0.3) < 0.01);
        return { status: verdict, duration: 0.3, wordCount: 2, wordsFile: options.wordsFile };
      } });
      if (verdict === "pass") {
        assert.equal((await invoke()).status, "passed");
        assert.equal(JSON.parse(await readFile(outFile, "utf8")).master.sha256, masterHash);
      } else {
        await assert.rejects(invoke(), /Alinhamento multi-voz não aprovado/);
        await assert.rejects(readFile(outFile), { code: "ENOENT" });
      }
      assert.equal(called, 1);
      assert.equal(hash(await readFile(plan.masterFile)), masterHash);
      assert.deepEqual(await Promise.all(plan.segments.map(async (segment) => hash(await readFile(segment.outputFile)))), originals);
      await assert.rejects(invoke(), /Saída já existe/);
      assert.equal(called, 1);
    } finally {
      // root is the dedicated temporary fixture directory created above.
      await rm(root, { recursive: true, force: true });
    }
  });
}
