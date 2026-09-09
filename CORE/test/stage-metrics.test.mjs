import assert from "node:assert/strict";
import test from "node:test";
import {
  compareStageMetrics,
  createStageMetrics,
  STAGE_METRICS_SCHEMA,
} from "../lib/media-pipeline/stage-metrics.mjs";

function fakeClock() {
  let value = 0;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

test("span separa espera de fila do tempo de execução", () => {
  const clock = fakeClock();
  const metrics = createStageMetrics({ clock: clock.now });
  const span = metrics.open("whisper", { blockId: "n01" });
  clock.advance(400);
  span.begin();
  clock.advance(1_500);
  span.end({ status: "ok", cache: "miss" });

  const document = metrics.snapshot();
  assert.equal(document.schema, STAGE_METRICS_SCHEMA);
  assert.equal(document.spans[0].queueMs, 400);
  assert.equal(document.spans[0].durationMs, 1_500);
  assert.equal(document.stages[0].cache.miss, 1);
});

test("paralelismo é medido, não declarado", () => {
  const clock = fakeClock();
  const metrics = createStageMetrics({ clock: clock.now });

  // Três spans abertos ao mesmo tempo: 3.000ms de trabalho em 1.000ms de parede.
  const spans = ["a", "b", "c"].map((id) => metrics.open("extract", { blockId: id }).begin());
  clock.advance(1_000);
  for (const span of spans) span.end({ status: "ok" });
  const parallel = metrics.snapshot().stages.find((stage) => stage.stage === "extract");
  assert.equal(parallel.effectiveParallelism, 3);
  assert.equal(parallel.peakConcurrency, 3);

  // Mesma soma de trabalho, mas em série: paralelismo efetivo 1.
  const serial = createStageMetrics({ clock: clock.now });
  for (const id of ["a", "b", "c"]) {
    const span = serial.open("gpu", { blockId: id }).begin();
    clock.advance(1_000);
    span.end({ status: "ok" });
  }
  assert.equal(serial.snapshot().stages[0].effectiveParallelism, 1);
});

test("atributos de métrica não carregam segredo nem caminho local", () => {
  const metrics = createStageMetrics();
  metrics.open("upload", {
    cookie: "SESSION=abc",
    apiKey: "sk-123",
    prompt: "texto do roteiro",
    model: "small",
    file: "C:\\Users\\operador\\segredo\\voz.wav",
  }).begin().end({ status: "ok" });

  const attributes = metrics.snapshot().spans[0].attributes;
  assert.equal(attributes.cookie, undefined);
  assert.equal(attributes.apiKey, undefined);
  assert.equal(attributes.prompt, undefined);
  assert.equal(attributes.model, "small");
  assert.equal(attributes.file, "[local-path]");
});

test("measure registra erro e repropaga em vez de engolir", async () => {
  const metrics = createStageMetrics();
  await assert.rejects(metrics.measure("render", async () => { throw new Error("ffmpeg quebrou"); }), /ffmpeg quebrou/);
  const stage = metrics.snapshot().stages[0];
  assert.equal(stage.errors, 1);
  assert.equal(metrics.snapshot().spans[0].outcome, "error");
});

test("comparação diz onde ficou mais rápido e quanto veio de cache", () => {
  const baselineClock = fakeClock();
  const baseline = createStageMetrics({ run: "antes", clock: baselineClock.now });
  const first = baseline.open("whisper").begin();
  baselineClock.advance(62_500);
  first.end({ status: "ok", cache: "miss" });

  const candidateClock = fakeClock();
  const candidate = createStageMetrics({ run: "depois", clock: candidateClock.now });
  const second = candidate.open("whisper").begin();
  candidateClock.advance(120);
  second.end({ status: "ok", cache: "hit" });

  const comparison = compareStageMetrics(baseline.snapshot(), candidate.snapshot());
  assert.equal(comparison.verdict, "faster");
  const stage = comparison.stages.find((entry) => entry.stage === "whisper");
  assert.equal(stage.verdict, "faster");
  assert.equal(stage.cacheHitDelta, 1);
  assert.ok(stage.deltaMs < -60_000);
});

test("comparação recusa documento que não é de métricas", () => {
  assert.throws(() => compareStageMetrics({ schema: "outra" }, { schema: STAGE_METRICS_SCHEMA }), /stage-metrics/);
});
