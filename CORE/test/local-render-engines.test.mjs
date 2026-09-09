import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeLocalRenderEngine } from "../lib/media-pipeline/local-render-engines.mjs";
import { renderHtmlMotionPilot, createHtmlMotionAdapter } from "../lib/media-pipeline/html-motion-pilot.mjs";
import { buildAdapterInvocation } from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";
import { verifyReceipt } from "../lib/media-pipeline/receipt.mjs";

const root = path.resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
const cli = args => execute(process.execPath, ["scripts/omni-cli.mjs", "render", ...args], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });

test("catálogo informa versões pinadas e descoberta sem provider", async () => {
  const result = JSON.parse((await cli([])).stdout);
  assert.deepEqual(result.engines.map(x => x.id), ["hyperframes", "remotion", "threejs"]);
  assert.ok(result.engines.every(x => x.auth === "none" && x.providerFree));
  assert.equal((await describeLocalRenderEngine("remotion")).version, "4.0.521");
  await assert.rejects(describeLocalRenderEngine("desconhecido"), /Motor/);
  const capabilityRegistry = await probeProviderRegistry({ probes: {} });
  for (const engine of ["hyperframes", "remotion"]) {
    const invocation = await buildAdapterInvocation({ adapter: createHtmlMotionAdapter({ engine }), operation: "html-render", capabilityRegistry, request: {} });
    assert.equal(invocation.preflight.status, "ready");
    assert.equal(invocation.paid, false);
  }
});

test("CLI dry-run não materializa saída e fecha modo, opções e entrada executável", async t => {
  const dir = await mkdtemp(path.join(root, ".render-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, "video.mp4");
  const args = ["--action", "render", "--mode", "studio", "--engine", "remotion", "--spec", "examples/local-render-scene.json", "--out", output];
  assert.equal(JSON.parse((await cli(args)).stdout).dryRun, true);
  await assert.rejects(stat(output), { code: "ENOENT" });
  await assert.rejects(stat(path.join(dir, "metadados")), { code: "ENOENT" });
  await assert.rejects(cli([...args, "--mode", "raw"]), /exige --mode studio/);
  await assert.rejects(cli([...args, "--dry-run", "maybe"]), /true ou false/);
  await assert.rejects(cli([...args, "--collection", "..\\escape"]), /Coleção/);
  await assert.rejects(cli(["--action", "engines", "--out", output]), /não aceita/);
  const spec = path.join(dir, "invalid.json");
  await writeFile(spec, JSON.stringify({ entryPoint: "evil.jsx" }));
  await assert.rejects(cli([...args, "--spec", spec]), /campos paramétricos/);
  await writeFile(output, "original");
  await assert.rejects(cli(args), /não será sobrescrita/);
  assert.equal(await readFile(output, "utf8"), "original");
});

for (const engine of ["hyperframes", "remotion"]) {
  test(`${engine}: MP4 real, frames em movimento, determinismo e recuperação sem sobrescrita`, { timeout: 360000 }, async t => {
    const dir = await mkdtemp(path.join(root, ".render-test-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const scene = { width: 320, height: 180, fps: 24, durationSeconds: .125, title: "<script>fetch('https://invalid')</script>" };
    const render = (name, extra = {}) => renderHtmlMotionPilot({ scene, engine, outputFile: path.join(dir, `${name}.mp4`), receiptFile: path.join(dir, `${name}.receipt.json`), metadataDirectory: path.join(dir, "meta"), maxWallMs: 150000, ...extra });
    const first = await render("first");
    const second = await render("second");
    assert.equal(first.receipt.parameters.renderer, engine);
    assert.equal(first.receipt.metadata.frameCount, 3);
    assert.equal(first.receipt.metadata.networkRequests, 0);
    assert.notEqual(first.receipt.metadata.firstFrameHash, first.receipt.metadata.lastFrameHash);
    assert.equal(first.receipt.metadata.firstFrameHash, second.receipt.metadata.firstFrameHash);
    assert.equal(first.receipt.metadata.lastFrameHash, second.receipt.metadata.lastFrameHash);
    assert.equal(verifyReceipt(first.receipt).valid, true);
    const original = await readFile(first.file);
    await assert.rejects(render("first"), /não será sobrescrita/);
    const recovered = await render("first", { recoverExisting: true });
    assert.equal(recovered.recoveredPublication, "completed-receipt");
    assert.deepEqual(await readFile(first.file), original);
    await assert.rejects(render("first", { recoverExisting: true, scene: { ...scene, title: "outro" } }), /diverge/);
    await rm(first.receiptFile);
    assert.equal((await render("first", { recoverExisting: true })).recoveredPublication, "missing-receipt");
    await assert.rejects(render("arbitrary", { documentFile: "arbitrary.html" }), /sandbox HTML canônico/);
  });
}
