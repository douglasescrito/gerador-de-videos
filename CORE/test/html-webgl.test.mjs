import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHtmlMotionScene, renderHtmlMotionPilot } from "../lib/media-pipeline/html-motion-pilot.mjs";

test("WebGL exige opção explícita e API conhecida", () => {
  assert.equal(createHtmlMotionScene().graphicsApi, undefined);
  assert.equal(createHtmlMotionScene({ graphicsApi: "webgl2" }).graphicsApi, "webgl2");
  assert.throws(() => createHtmlMotionScene({ graphicsApi: "webgpu" }), /graphicsApi/);
});

test("WebGL offline publica frames reais, registra GPU e preserva isolamento", { skip: process.platform !== "win32", timeout: 120_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-webgl-"));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const documentFile = path.join(root, "scene.html");
  const source = '<canvas width="64" height="36"></canvas><script>const gl=document.querySelector("canvas").getContext("webgl2",{preserveDrawingBuffer:true,powerPreference:"high-performance"});if(!gl)throw Error("missing WebGL");let isolated=false;try{parent.document.body}catch{isolated=true}if(!isolated)throw Error("parent accessible");window.__setFrame=f=>{gl.clearColor(f?0:1,f?1:0,0,1);gl.clear(gl.COLOR_BUFFER_BIT)};</script>';
  await writeFile(documentFile, source);
  const render = (name, graphicsApi = "webgl2") => renderHtmlMotionPilot({
    scene: { width: 64, height: 36, fps: 4, durationSeconds: .5, graphicsApi }, documentFile,
    outputFile: path.join(root, name + ".mp4"), receiptFile: path.join(root, name + ".json"),
    metadataDirectory: path.join(root, name), maxWallMs: 30_000,
  });
  await assert.rejects(render("default-blocked", "canvas2d"), /gráfico|bloqueou|contrato/);
  const first = await render("first"), second = await render("second");
  assert.equal(first.receipt.parameters.consumer, "html-webgl2@1.0.0");
  assert.equal(first.receipt.metadata.graphics.api, "webgl2");
  assert.match(first.receipt.metadata.graphics.contexts[0].version, /WebGL 2/);
  assert.equal(first.receipt.metadata.networkRequests, 0);
  assert.equal(first.receipt.metadata.pageErrors, 0);
  assert.notEqual(first.receipt.metadata.firstFrameHash, first.receipt.metadata.lastFrameHash);
  assert.equal(first.receipt.metadata.firstFrameHash, second.receipt.metadata.firstFrameHash);
  assert.equal(first.receipt.metadata.lastFrameHash, second.receipt.metadata.lastFrameHash);
  assert.ok((await readFile(first.file)).length > 1000);
  await writeFile(documentFile, source.replace('gl.clear(gl.COLOR_BUFFER_BIT)', 'gl.clear(gl.COLOR_BUFFER_BIT);fetch("https://example.invalid/blocked")'));
  await assert.rejects(render("network-blocked"), /bloqueou|contrato|isolamento/);
});
