import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyFilmPostOperation, validatePostProduction } from "../lib/media-pipeline/film-post-production.mjs";
import { probeMedia, runCommand, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";

const op = (id, operation, assetId = null, durationFrames = null) => ({ id, operation, assetId, durationFrames });

test("pós-produção recusa operação ignorada, IDs duplicados e hold fora da timeline", () => {
  const valid = [op("color", "color-normalize@1"), op("logo", "logo-overlay@1", "brand"), op("ending", "ending-hold@1", null, 24)];
  assert.deepEqual(validatePostProduction({ module: "ffmpeg-post@1", operations: valid }, 72), valid);
  for (const operations of [[op("x", "unknown")], [valid[0], valid[0]], [op("x", "ending-hold@1", null, 73)], [op("x", "logo-overlay@1")], [op("x", "color-normalize@1", "brand")], [op("x", "color-normalize@1", null, 2)]]) {
    assert.throws(() => validatePostProduction({ module: "ffmpeg-post@1", operations }, 72));
  }
});

test("cor, logo e hold produzem pixels reais sem alterar duração, áudio ou originais", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-post-pixels-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.mp4"), logo = path.join(root, "logo.png");
  await runFfmpeg(["-f", "lavfi", "-i", "nullsrc=s=160x90:r=24:d=3,geq=lum='16+mod(N*5,200)':cb=128:cr=128", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  await runFfmpeg(["-f", "lavfi", "-i", "color=red:s=16x16", "-frames:v", "1", logo]);
  const originals = await Promise.all([sha256File(source), sha256File(logo)]);
  let current = source;
  const results = [];
  for (const operation of [op("color", "color-normalize@1"), op("logo", "logo-overlay@1", "brand"), op("hold", "ending-hold@1", null, 24)]) {
    const result = await applyFilmPostOperation({ inputFile: current, outputFile: path.join(root, `${operation.id}.mp4`), operation,
      expectedFrames: 72, fps: 24, ...(operation.assetId ? { logoFile: logo, authorize: async () => ({ itemHash: "a".repeat(64) }) } : {}) });
    results.push(result); current = result.file;
  }
  assert.equal(results[0].probe.video.color_space, "bt709");
  assert.equal(results[0].probe.video.color_range, "tv");
  assert.equal(results[0].probe.video.color_transfer, "bt709");
  const samples = path.join(root, "gray.raw");
  await runFfmpeg(["-i", current, "-vf", "crop=8:8:0:0", "-pix_fmt", "gray", "-f", "rawvideo", samples]);
  const pixels = await readFile(samples);
  assert.equal(pixels.length, 72 * 64);
  const means = Array.from({ length: 72 }, (_, i) => pixels.subarray(i * 64, (i + 1) * 64).reduce((sum, v) => sum + v, 0) / 64);
  assert.ok(Math.max(...means.slice(0, 48)) - Math.min(...means.slice(0, 48)) > 100, "fonte realmente varia antes do hold");
  assert.ok(Math.max(...means.slice(48)) - Math.min(...means.slice(48)) <= 1, "últimos 24 frames permanecem estáveis");
  const rgbFile = path.join(root, "logo.raw");
  await runFfmpeg(["-i", current, "-vf", "crop=4:4:142:76", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", rgbFile]);
  const rgb = await readFile(rgbFile);
  for (let i = 0; i < rgb.length; i += 3) assert.ok(rgb[i] > rgb[i + 1] + 80 && rgb[i] > rgb[i + 2] + 80, "logo vermelho aparece nos pixels");
  const audioHash = async (file) => (await runCommand("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "hash", "-hash", "sha256", "-"])).stdout.trim();
  assert.equal(await audioHash(current), await audioHash(source), "áudio decodificado permanece idêntico");
  const finalHash = await sha256File(current);
  const recovery = { inputFile: results[1].file, outputFile: current, operation: op("hold", "ending-hold@1", null, 24), expectedFrames: 72, fps: 24, recoverExisting: true };
  assert.equal((await applyFilmPostOperation(recovery)).receipt.id, results[2].receipt.id);
  await rm(results[2].receiptFile);
  await applyFilmPostOperation(recovery);
  assert.equal(await sha256File(current), finalHash, "recibo ausente se recupera sem sobrescrever o MP4");
  assert.deepEqual(await Promise.all([sha256File(source), sha256File(logo)]), originals);
  const denied = path.join(root, "denied.mp4");
  let checks = 0;
  await assert.rejects(applyFilmPostOperation({ inputFile: source, outputFile: denied, operation: op("logo", "logo-overlay@1", "brand"), logoFile: logo, expectedFrames: 72, fps: 24,
    authorize: async () => { if (++checks > 1) throw new Error("revoked"); return { itemHash: "a".repeat(64) }; } }), /revoked/);
  await assert.rejects(access(denied), { code: "ENOENT" });
  await assert.rejects(access(`${denied}.receipt.json`), { code: "ENOENT" });
  const hdr = path.join(root, "hdr.mp4");
  await runFfmpeg(["-i", source, "-c", "copy", "-bsf:v", "h264_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9", hdr]);
  assert.equal((await probeMedia(hdr)).video.color_transfer, "smpte2084");
  await assert.rejects(applyFilmPostOperation({ inputFile: hdr, outputFile: path.join(root, "sdr.mp4"), operation: op("c", "color-normalize@1"), expectedFrames: 72, fps: 24 }), /SDR BT.709/);
});
