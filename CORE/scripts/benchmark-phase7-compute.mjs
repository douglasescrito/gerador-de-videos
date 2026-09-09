import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { benchmarkDeliveryEncoders } from "../lib/media-pipeline/delivery-profile.mjs";
import { probeMedia } from "../lib/media-pipeline/media-tools.mjs";
import { probeWhisperRuntime, resolveWhisperDevice } from "../lib/media-pipeline/whisper-runtime.mjs";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";

function option(name, fallback = null) { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; }
const inputFile = path.resolve(option("input"));
const outDir = path.resolve(option("out", path.join("diagnosticos", "phase7-compute-benchmark")));
await mkdir(outDir, { recursive: true });

const hashStarted = performance.now();
const inputBytes = await readFile(inputFile);
const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
const hashElapsedMs = performance.now() - hashStarted;
const probeStarted = performance.now();
const media = await probeMedia(inputFile);
const probeElapsedMs = performance.now() - probeStarted;
const encoder = await benchmarkDeliveryEncoders({ inputFile, outDir, profile: "web-1080p" });
const whisperProbe = await probeWhisperRuntime();
const whisperDevice = resolveWhisperDevice({ requested: "auto", probe: whisperProbe });

const body = {
  schema: "mkt-videos/stage-compute-benchmark@1",
  generatedAt: new Date().toISOString(),
  hardwareScope: "local-reference-machine",
  input: { sha256: inputSha256, bytes: inputBytes.length, duration: media.duration, width: media.width, height: media.height },
  stages: [
    { id: "hash-input", device: "cpu", elapsedMs: hashElapsedMs },
    { id: "probe-media", device: "cpu", elapsedMs: probeElapsedMs },
    { id: "delivery-encode", devices: encoder.verdict === "unavailable" ? [{ device: "cpu", elapsedMs: null }, { device: "gpu-nvenc", status: "unavailable" }] : [{ device: "cpu", elapsedMs: encoder.reference.elapsedMs }, { device: "gpu-nvenc", elapsedMs: encoder.candidate.elapsedMs }], verdict: encoder.verdict },
    { id: "whisper-alignment", selectedDevice: whisperDevice.device, computeType: whisperDevice.computeType, cudaAvailable: whisperProbe.cuda === true, note: "A seleção é medida pelo runtime; inferência não é repetida neste benchmark para não duplicar o corpus de referência." },
  ],
  providerCalls: 0,
};
const report = { ...body, fingerprint: operationFingerprint(body) };
const reportFile = path.join(outDir, "stage-compute-benchmark.json");
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportFile, report }, null, 2));
