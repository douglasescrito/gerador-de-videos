import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { createTelemetryEvent } from "../lib/media-pipeline/telemetry.mjs";
import { assertProviderCapability, buildCapabilityMap, probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";
import { createProvenanceManifest, signC2paDelivery, verifyProvenanceManifest } from "../lib/media-pipeline/provenance.mjs";
import { copyWithRelocationManifest, resolveRelocatedArtifact } from "../lib/media-pipeline/relocation.mjs";

test("registry declara apenas capacidades operacionais e sanitiza falha de credencial", async () => {
  const registry = await probeProviderRegistry({ probes: { "gemini-omni": async () => ({ ready: true, status: "ready" }), "google-vids": async () => { throw new Error("token=abc C:\\secret\\cookie.txt"); } } });
  assert.equal(assertProviderCapability(registry, { provider: "gemini-omni", operation: "image-to-video", requireReconcile: true }).health.status, "ready");
  const tts = registry.providers.find((entry) => entry.id === "google-vids");
  assert.doesNotMatch(tts.health.error, /abc|secret/);
  assert.throws(() => assertProviderCapability(registry, { provider: "google-vids", operation: "text-to-speech", requireDelivery: true }), /health|unavailable|indisponível/i);
  assert.throws(() => assertProviderCapability(registry, { provider: "flow-music", operation: "music-clip" }), /não declarada/);
});

test("mapa de capacidades distingue supported, pending e blocked sem probe live", () => {
  const map = buildCapabilityMap({ now: new Date("2026-07-23T12:00:00.000Z") });
  assert.equal(map.schema, "mkt-videos/capability-map@1");
  assert.equal(map.checkedAt, "2026-07-23T12:00:00.000Z");
  assert.ok(map.summary.supported >= 3);
  assert.equal(map.summary.pending, 1);
  assert.ok(map.summary.blocked >= 1);
  assert.equal(map.capabilities.some((entry) => entry.id === "gemini-tts"), false);
  assert.equal(map.capabilities.some((entry) => entry.id === "lyria"), false);
  assert.equal(map.capabilities.find((entry) => entry.id === "gemini-omni").status, "supported");
  assert.equal(map.capabilities.find((entry) => entry.id === "flow-music").status, "supported");
  assert.equal(map.capabilities.find((entry) => entry.id === "flow-music").deliveryDependencyAllowed, true);
  assert.ok(map.capabilities.find((entry) => entry.id === "flow-music").operations.includes("music-generate"));
});

test("telemetria remove prompts, tokens e caminhos locais", () => {
  const event = createTelemetryEvent({ name: "provider.wait", attributes: { durationMs: 20, prompt: "segredo", accessToken: "abc", source: "C:\\Users\\operador\\file.mp4", detail: "Bearer xyz" } });
  assert.deepEqual(event.attributes, { durationMs: 20, source: "[local-path]", detail: "Bearer [redacted]" });
});

test("proveniência verifica o hash do master e recusa fingir assinatura C2PA", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-prov-"));
  try {
    const master = path.join(root, "master.mp4");
    const manifestFile = path.join(root, "provenance.json");
    await writeFile(master, "master");
    await createProvenanceManifest({ masterFile: master, receiptIds: ["receipt:a"], outputFile: manifestFile, timelineFingerprint: "timeline:a" });
    assert.equal((await verifyProvenanceManifest(manifestFile)).valid, true);
    await writeFile(master, "tampered");
    assert.equal((await verifyProvenanceManifest(manifestFile)).valid, false);
    await assert.rejects(createProvenanceManifest({ masterFile: master, outputFile: path.join(root, "fake.json"), c2pa: true }), /não está configurada/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("C2PA opcional só publica após assinatura e verificação do c2patool", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-c2pa-"));
  try {
    const master = path.join(root, "master.mp4");
    const signing = path.join(root, "signing.json");
    const output = path.join(root, "signed.mp4");
    await writeFile(master, "master");
    await writeFile(signing, "{}");
    const calls = [];
    const result = await signC2paDelivery({
      masterFile: master,
      c2paManifestFile: signing,
      outputFile: output,
      commandRunner: async (_command, args) => {
        calls.push(args);
        if (args.includes("-m")) { await writeFile(args.at(-1), "signed-master"); return { stdout: "", stderr: "", status: 0 }; }
        return { stdout: JSON.stringify({ active_manifest: "urn:c2pa:test", manifests: { "urn:c2pa:test": {} } }), stderr: "", status: 0 };
      },
    });
    assert.equal(result.receipt.metadata.c2paSigned, true);
    assert.equal(calls.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("relocação usa copy, SHA-256 e resolver sem alterar artifact histórico", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-relocate-"));
  try {
    const source = path.join(root, "source.bin");
    await writeFile(source, "immutable");
    const artifact = await createArtifactFromFile({ file: source, kind: "binary", role: "source" });
    const moved = await copyWithRelocationManifest({ sourceArtifact: artifact, destinationFile: path.join(root, "archive", "source.bin"), manifestFile: path.join(root, "archive", "manifest.json") });
    await rm(source);
    const resolved = await resolveRelocatedArtifact({ artifact, manifestFiles: [moved.manifestFile] });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.source, "relocation");
    assert.equal(resolved.artifact.hash.value, artifact.hash.value);
  } finally { await rm(root, { recursive: true, force: true }); }
});
