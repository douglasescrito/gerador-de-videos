import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import {
  assertHtmlMotionScene,
  createHtmlMotionAdapter,
  createHtmlMotionScene,
  renderHtmlMotionPilot,
} from "../lib/media-pipeline/html-motion-pilot.mjs";
import { buildAdapterInvocation, runAdapterConformanceSuite } from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

test("Piloto B fecha cena HTML local com safe area, frames e rede bloqueada", () => {
  const scene = createHtmlMotionScene({ title: "SISTEMA VISUAL", cta: "COMEÇAR" });
  assert.equal(scene.frameCount, 192);
  assert.equal(scene.providerFree, true);
  assert.equal(scene.network, "blocked");
  assert.equal(scene.safeArea.left, 0.07);
  assert.equal(assertHtmlMotionScene(scene).frameCount, 192);
});

test("Piloto B rejeita alteração de aspecto ou frame count", () => {
  assert.throws(() => createHtmlMotionScene({ aspect: "9:16" }), /16:9/);
  const scene = createHtmlMotionScene();
  assert.throws(() => assertHtmlMotionScene({ ...scene, frameCount: 1 }), /adulterado/);
  assert.equal(createHtmlMotionScene({ aspect: "9:16", width: 360, height: 640 }).width, 360);
  assert.throws(() => createHtmlMotionScene({ background: 'red' }), /hexadecimal/);
});

test("renderer HTML migra para adapter-contract@1 sem operação paga", async () => {
  const adapter = createHtmlMotionAdapter();
  const registry = await probeProviderRegistry({ probes: {} });
  const report = await runAdapterConformanceSuite({ adapter, capabilityRegistry: registry, operation: "html-render", request: { scene: { frameCount: 192 } }, now: new Date("2026-07-27T18:15:19.593Z") });
  assert.equal(report.passed, true);
  const invocation = buildAdapterInvocation({ adapter, capabilityRegistry: registry, operation: "html-render", request: { scene: { frameCount: 192 } }, now: new Date("2026-07-27T18:15:19.593Z") });
  assert.equal(invocation.paid, false);
  assert.equal(invocation.preflight.status, "ready");
});

test("documento HTML gera frames determinísticos sobre o vídeo com áudio e bloqueia rede", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-document-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documentFile = path.join(root, "graphic.html");
  const videoFile = path.join(root, "source.mp4");
  await writeFile(documentFile, '<canvas width="64" height="36"></canvas><script>let cookieBlocked=false,parentBlocked=false;try{document.cookie}catch{cookieBlocked=true}try{parent.document.body}catch{parentBlocked=true}if(!cookieBlocked||!parentBlocked)throw new Error("origem não isolada");const c=document.querySelector("canvas").getContext("2d"); window.__setFrame=(frame)=>{c.clearRect(0,0,64,36);c.fillStyle="red";c.fillRect(frame*16,0,16,16)};</script>');
  await runFfmpeg(["-f", "lavfi", "-i", "color=blue:s=64x36:r=4:d=0.5", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoFile]);
  const scene = { width: 64, height: 36, fps: 4, durationSeconds: 0.5 };
  const render = (name, extra = {}) => renderHtmlMotionPilot({ scene, documentFile, videoFile, outputFile: path.join(root, `${name}.mp4`), receiptFile: path.join(root, `${name}.json`), metadataDirectory: root, maxWallMs: 15_000, ...extra });
  const first = await render("first");
  const second = await render("second");
  assert.equal(first.receipt.metadata.firstFrameHash, second.receipt.metadata.firstFrameHash);
  assert.equal(first.receipt.metadata.lastFrameHash, second.receipt.metadata.lastFrameHash);
  assert.notEqual(first.receipt.metadata.firstFrameHash, first.receipt.metadata.lastFrameHash);
  const originalVideo = await readFile(first.file);
  const originalModified = (await stat(first.file)).mtimeMs;
  const preparedBytes = await readFile(first.preparedFile);
  const recoveredCalls = [];
  const recover = async (name = "first") => {
    const nativeSpawn = ChildProcess.prototype.spawn;
    ChildProcess.prototype.spawn = function(options) { recoveredCalls.push(path.basename(options.file)); return nativeSpawn.call(this, options); };
    try { return await render(name, { recoverExisting: true }); }
    finally { ChildProcess.prototype.spawn = nativeSpawn; }
  };
  assert.equal((await recover()).recoveredPublication, "completed-receipt");
  await rm(first.receiptFile);
  const receiptRecovery = await recover();
  assert.equal(receiptRecovery.recoveredPublication, "missing-receipt");
  assert.equal(receiptRecovery.receipt.id, first.receipt.id);
  await rm(first.receiptFile);
  const stagingFile = first.receipt.metadata.publication.stagingFile;
  await rename(first.file, stagingFile);
  assert.equal((await recover()).recoveredPublication, "staged-output");
  assert.deepEqual(recoveredCalls, [], "recuperações não iniciaram browser, FFmpeg nem FFprobe assíncronos");
  assert.equal((await stat(first.file)).mtimeMs, originalModified);
  assert.deepEqual(await readFile(first.file), originalVideo);
  await assert.rejects(render("first", { recoverExisting: true, onScreenText: "OUTRO PEDIDO" }), /diverge do pedido/);
  await rm(first.receiptFile);
  const forged = JSON.parse(preparedBytes);
  forged.receipt.metadata.publication.stagingFile = path.join(root, "unrelated.mp4");
  await writeFile(first.preparedFile, JSON.stringify(forged));
  await assert.rejects(recover(), /Temporário HTML fora/);
  await writeFile(first.preparedFile, preparedBytes);
  await writeFile(first.file, Buffer.from("conteúdo divergente"));
  await assert.rejects(recover(), /Arquivo local divergente/);
  assert.equal(await readFile(first.file, "utf8"), "conteúdo divergente", "falha não sobrescreveu o arquivo existente");
  await writeFile(first.file, originalVideo);
  await recover();
  assert.ok(first.receipt.inputs.some(input => input.role === "graphics-document"));
  assert.equal(first.receipt.metadata.networkRequests, 0);
  assert.equal(first.receipt.metadata.exactText, null);
  assert.ok(first.probe.streams.some(stream => stream.codec_type === "audio"));
  const audioCopies = [];
  for (const [index, file] of [videoFile, first.file].entries()) {
    const audio = path.join(root, `audio-${index}.aac`);
    await runFfmpeg(["-i", file, "-vn", "-c:a", "copy", audio]);
    audioCopies.push(await readFile(audio));
  }
  assert.deepEqual(audioCopies[0], audioCopies[1], "pacotes de áudio foram preservados integralmente");
  const raw = path.join(root, "frames.rgb");
  await runFfmpeg(["-i", first.file, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const pixels = await readFile(raw);
  assert.equal(pixels.length, 64 * 36 * 3 * 2);
  const pixel = (frame, x, y) => [...pixels.subarray(((frame * 36 + y) * 64 + x) * 3, ((frame * 36 + y) * 64 + x) * 3 + 3)];
  assert.ok(pixel(0, 8, 8)[0] > 200, "grafismo vermelho veio do documento");
  assert.ok(pixel(0, 48, 24)[2] > 200, "vídeo azul foi preservado sob o grafismo");
  assert.ok(pixel(1, 24, 8)[0] > 200, "callback mudou a posição no segundo frame");
  const obstructedOutput = path.join(root, "publication-failure.mp4");
  let obstructed = false;
  await assert.rejects(render("publication-failure", { beforeRender: async () => {
    if (!obstructed && (await readdir(root)).some(file => /^publication-failure\.mp4\..+\.tmp\.mp4$/.test(file))) {
      obstructed = true;
      await mkdir(obstructedOutput);
    }
  } }), /já existe/);
  const preparation = JSON.parse(await readFile(`${obstructedOutput}.prepared.json`, "utf8"));
  assert.deepEqual(await readFile(preparation.receipt.metadata.publication.stagingFile), originalVideo, "falha de publicação preservou o temporário verificado");
  await rmdir(obstructedOutput);
  assert.equal((await recover("publication-failure")).recoveredPublication, "staged-output");
  assert.deepEqual(recoveredCalls, [], "a falha local foi retomada sem outro render");
  // Estado deixado por interrupção entre os dois JSONs, antes de existir saída preparada.
  await Promise.all([rm(first.file), rm(first.receiptFile), rm(first.preparedFile), rm(first.sandboxFile)]);
  const resumedMetadata = await recover();
  assert.equal(resumedMetadata.recoveredPublication, null);
  assert.ok(recoveredCalls.some(command => /ffmpeg/i.test(command)), "sem saída preparada, o processamento local é refeito");
  assert.deepEqual(await readFile(first.file), originalVideo);
  const legacy = await render("legacy", { documentFile: null, videoFile: null, scene: { ...scene, title: '<img src="https://example.invalid/x">' } });
  assert.equal(legacy.receipt.metadata.networkRequests, 0, "texto do template legado permanece literal, sem executar marcação");
  await writeFile(documentFile, '<img src="https://example.invalid/undeclared.png">');
  await assert.rejects(render("network"), /contrato local|bloqueou|isolamento/);
  await assert.rejects(readFile(path.join(root, "network.mp4")), /ENOENT/);
  await writeFile(documentFile, '<p>DOCUMENTO AUTORIZADO</p>');
  let checks = 0;
  await assert.rejects(render("changed", { beforeRender: async () => { if (++checks === 2) await writeFile(documentFile, '<p>DOCUMENTO ALTERADO</p>'); } }), /Entrada HTML mudou/);
  await assert.rejects(readFile(path.join(root, "changed.mp4")), /ENOENT/);
  await writeFile(documentFile, '<script>window.__setFrame=()=>{while(true){}}</script>');
  await assert.rejects(render("timeout", { maxWallMs: 1_000 }), /limite de parede/);
  await assert.rejects(readFile(path.join(root, "timeout.mp4")), /ENOENT/);
});
