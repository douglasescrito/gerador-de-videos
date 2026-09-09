import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  probeTorchRuntime,
  pythonForWhisperCommand,
  resolveWhisperDevice,
  whisperDeviceArgs,
  whisperRuntimeFingerprint,
  WHISPER_DEVICE_MODES,
} from "../lib/media-pipeline/whisper-runtime.mjs";

const cudaProbe = {
  python: "C:\\Python311\\python.exe",
  available: true,
  torch: "2.5.1+cu121",
  cuda: true,
  cudaVersion: "12.1",
  devices: [{ index: 0, name: "NVIDIA GeForce RTX 4070 Laptop GPU", totalMemoryBytes: 8_589_934_592, capability: "8.9" }],
  error: null,
};
const cpuOnlyProbe = { ...cudaProbe, cuda: false, devices: [], error: "torch.cuda.is_available() devolveu False" };

test("o interpretador sondado é o do lado do whisper.exe, não um python qualquer", () => {
  assert.equal(
    pythonForWhisperCommand("C:\\Users\\operador\\AppData\\Roaming\\Python\\Python311\\Scripts\\whisper.exe", { platform: "win32" }),
    path.join("C:\\Users\\operador\\AppData\\Roaming\\Python\\Python311", "python.exe"),
  );
  assert.equal(pythonForWhisperCommand("/opt/venv/bin/whisper", { platform: "linux" }), path.join("/opt/venv", "bin", "python"));
  assert.equal(pythonForWhisperCommand("whisper"), null);
});

test("auto usa CUDA quando existe e registra a queda quando não existe", () => {
  const gpu = resolveWhisperDevice({ requested: "auto", probe: cudaProbe });
  assert.equal(gpu.device, "cuda");
  assert.equal(gpu.fp16, true);
  assert.equal(gpu.reason, "auto-cuda");
  assert.equal(gpu.gpu.totalMemoryBytes, 8_589_934_592);

  const cpu = resolveWhisperDevice({ requested: "auto", probe: cpuOnlyProbe });
  assert.equal(cpu.device, "cpu");
  assert.equal(cpu.fp16, false);
  assert.equal(cpu.fallback, true);
  // A queda precisa ser dita, não descoberta pelo cronômetro.
  assert.match(cpu.notice, /CPU/);
});

test("cuda exigido e ausente falha em vez de cair mudo para CPU", () => {
  assert.throws(() => resolveWhisperDevice({ requested: "cuda", probe: cpuOnlyProbe }), /GPU exigida/);
  assert.throws(() => resolveWhisperDevice({ requested: "cuda", probe: null }), /GPU exigida/);
  assert.equal(resolveWhisperDevice({ requested: "cuda", probe: cudaProbe }).device, "cuda");
});

test("cpu explícito nunca liga fp16 e device inválido é recusado", () => {
  const plan = resolveWhisperDevice({ requested: "cpu", probe: cudaProbe });
  assert.equal(plan.device, "cpu");
  assert.equal(plan.fp16, false);
  assert.equal(plan.reason, "requested-cpu");
  assert.throws(() => resolveWhisperDevice({ requested: "gpu" }), /Device de Whisper inválido/);
  assert.deepEqual(WHISPER_DEVICE_MODES, ["auto", "cuda", "cpu"]);
});

test("argumentos de device são explícitos na linha de comando", () => {
  assert.deepEqual(whisperDeviceArgs({ device: "cuda", fp16: true }), ["--device", "cuda", "--fp16", "True"]);
  assert.deepEqual(whisperDeviceArgs({ device: "cpu", fp16: false }), ["--device", "cpu", "--fp16", "False"]);
});

test("fingerprint muda com device, backend e versão do torch", () => {
  const base = { backend: "openai-whisper", device: "cuda", fp16: true, torch: "2.5.1", cudaVersion: "12.1" };
  const reference = whisperRuntimeFingerprint(base);
  assert.equal(whisperRuntimeFingerprint({ ...base }), reference);
  assert.notEqual(whisperRuntimeFingerprint({ ...base, device: "cpu" }), reference);
  assert.notEqual(whisperRuntimeFingerprint({ ...base, backend: "faster-whisper" }), reference);
  assert.notEqual(whisperRuntimeFingerprint({ ...base, torch: "2.6.0" }), reference);
});

test("sonda de torch lê o JSON do interpretador e sobrevive à ausência dele", async () => {
  const probe = await probeTorchRuntime({
    pythonCommand: "python-de-mentira",
    runCommandImpl: async () => ({ stdout: `${JSON.stringify({ torch: "2.5.1", cuda: true, cudaVersion: "12.1", devices: [{ index: 0, name: "RTX 4070", totalMemoryBytes: 8_589_934_592 }], error: null })}\n` }),
  });
  assert.equal(probe.available, true);
  assert.equal(probe.cuda, true);
  assert.equal(probe.devices[0].name, "RTX 4070");

  const missing = await probeTorchRuntime({
    pythonCommand: "python-de-mentira",
    runCommandImpl: async () => { throw new Error("ENOENT"); },
  });
  assert.equal(missing.available, false);
  assert.equal(missing.cuda, false);
  assert.match(missing.error, /indisponível/);
});
