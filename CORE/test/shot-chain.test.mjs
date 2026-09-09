import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SHOT_CHAIN_SCHEMA, buildShotPrompt, planShotChain, shotChainGenerateArgs, validateShotChainSpec } from "../lib/media-pipeline/shot-chain.mjs";

const bible = "Flat 2D, vetor chapado, navy e cobalto. A câmera anda sempre para a direita e nunca corta.";
const coreRoot = path.resolve(import.meta.dirname, "..");
const runner = path.join(coreRoot, "scripts", "encadear-planos.mjs");

function spec(overrides = {}) {
  return {
    schema: SHOT_CHAIN_SCHEMA,
    bible,
    logo: "C:/marca/logo.png",
    shots: [
      { id: "c01", role: "open", beat: "abertura", action: "BEGINS vazio. A linha do chão chega. ENDS com ela parada." },
      { id: "c02", beat: "cidade", action: "BEGINS no frame que entra. A cidade passa. ENDS no meio do trecho." },
      { id: "c03", role: "brand", beat: "marca", action: "Os cacos se remontam na logo oficial." },
    ],
    ...overrides,
  };
}

test("papéis derivam da posição: o primeiro abre, os do meio encadeiam", () => {
  const plan = planShotChain(spec(), { outDir: "C:/peca/cadeia" });
  assert.deepEqual(plan.steps.map((s) => s.task), ["text_to_video", "image_to_video", "reference_to_video"]);
  assert.equal(plan.steps[0].firstFrameFile, null);
  assert.match(plan.steps[1].firstFrameFile, /c01-final\.png$/);
  assert.equal(plan.steps[1].previousShotId, "c01");
  assert.match(plan.steps[2].referenceImage, /logo\.png$/);
});

test("a bíblia inteira entra em todo prompt, seguida da ação do plano", () => {
  const plan = planShotChain(spec(), { outDir: "C:/peca/cadeia" });
  for (const step of plan.steps) assert.ok(step.prompt.startsWith(bible), `${step.id} perdeu a bíblia`);
  assert.equal(buildShotPrompt({ bible, action: "AÇÃO" }), `${bible}\n\nAÇÃO`);
  assert.throws(() => buildShotPrompt({ bible, action: "  " }), /action/);
});

test("o primeiro plano não pode herdar frame que não existe", () => {
  assert.throws(
    () => validateShotChainSpec(spec({ shots: [{ id: "c01", role: "chain", action: "x" }] })),
    /não existe frame anterior/,
  );
});

test("plano de marca sem arte oficial falha fechado", () => {
  const semLogo = spec({ logo: null });
  assert.throws(() => validateShotChainSpec(semLogo), /arte oficial/);
});

test("ids são únicos e sanitizados; aspect é restrito", () => {
  assert.throws(() => validateShotChainSpec(spec({ shots: [{ id: "c01", role: "open", action: "a" }, { id: "c01", action: "b" }] })), /duplicado/);
  assert.throws(() => validateShotChainSpec(spec({ shots: [{ id: "C 01", role: "open", action: "a" }] })), /minúsculo/);
  assert.throws(() => validateShotChainSpec(spec({ aspect: "1:1" })), /aspect inválido/);
  assert.throws(() => validateShotChainSpec({ schema: "outro@1", bible, shots: [] }), /schema/);
});

test("argumentos de entrada externa exigem e apenas repassam confirmação humana literal", () => {
  const plan = planShotChain(spec(), { outDir: "C:/peca/cadeia" });
  const [abertura, elo, marca] = plan.steps;
  const aberturaArgs = shotChainGenerateArgs(abertura);
  assert.ok(!aberturaArgs.includes("--confirm-provider-input"));
  assert.throws(() => shotChainGenerateArgs(elo), /valor literal "true"/);
  assert.throws(() => shotChainGenerateArgs(elo, { confirmProviderInput: true }), /valor literal "true"/);
  assert.throws(() => shotChainGenerateArgs(marca, { confirmProviderInput: "false" }), /valor literal "true"/);

  const eloArgs = shotChainGenerateArgs(elo, { confirmProviderInput: "true" });
  const marcaArgs = shotChainGenerateArgs(marca, { confirmProviderInput: "true" });
  assert.ok(eloArgs.includes("--first-frame") && eloArgs.includes("--confirm-provider-input"));
  assert.ok(marcaArgs.includes("--image") && marcaArgs.includes("--confirm-provider-input"));
  assert.equal(eloArgs[eloArgs.indexOf("--confirm-provider-input") + 1], "true");
  assert.equal(marcaArgs[marcaArgs.indexOf("--confirm-provider-input") + 1], "true");
  assert.ok(!eloArgs.includes("--image"), "elo não mistura --first-frame com --image");
});

test("dry-run informa o gate de entrada sem exigir consentimento nem escrever saída", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shot-chain-dry-run-"));
  const specFile = path.join(root, "plano.json");
  const outDir = path.join(root, "saida");
  writeFileSync(specFile, JSON.stringify(spec()), "utf8");

  const result = spawnSync(process.execPath, [
    runner,
    "--spec", specFile,
    "--out-dir", outDir,
    "--dry-run",
  ], { cwd: coreRoot, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.confirmacaoEntradaProvedor, {
    exigidaNaExecucaoReal: true,
    fornecidaLiteralmente: false,
    passos: ["c02", "c03"],
  });
  assert.match(result.stderr, /--confirm-provider-input true será exigido para c02, c03/);
  assert.equal(existsSync(outDir), false, "dry-run não pode criar a árvore de saída");
});

test("runner real falha antes de criar saída quando o consentimento literal está ausente ou implícito", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shot-chain-consent-"));
  const specFile = path.join(root, "plano.json");
  const logo = path.join(root, "logo.png");
  writeFileSync(logo, "referencia-de-teste", "utf8");
  writeFileSync(specFile, JSON.stringify(spec({
    logo,
    shots: [{ id: "marca", role: "brand", action: "Formar a marca oficial." }],
  })), "utf8");

  for (const extraArgs of [[], ["--confirm-provider-input"], ["--confirm-provider-input", "false"]]) {
    const outDir = path.join(root, `saida-${extraArgs.length}-${String(extraArgs.at(-1) ?? "ausente")}`);
    const result = spawnSync(process.execPath, [
      runner,
      "--spec", specFile,
      "--out-dir", outDir,
      ...extraArgs,
    ], { cwd: coreRoot, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });

    assert.notEqual(result.status, 0, "execução sem literal true deveria falhar fechada");
    assert.match(result.stderr, /exige --confirm-provider-input true com o valor literal "true"/);
    assert.equal(existsSync(outDir), false, "gate deve falhar antes de criar frames ou saída");
  }
});

test("dry-run apenas registra quando o literal true foi fornecido, sem executar provedor", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shot-chain-dry-confirmed-"));
  const specFile = path.join(root, "plano.json");
  const outDir = path.join(root, "saida");
  writeFileSync(specFile, JSON.stringify(spec()), "utf8");

  const result = spawnSync(process.execPath, [
    runner,
    "--spec", specFile,
    "--out-dir", outDir,
    "--dry-run",
    "--confirm-provider-input", "true",
  ], { cwd: coreRoot, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.confirmacaoEntradaProvedor.fornecidaLiteralmente, true);
  assert.equal(existsSync(outDir), false);
});
