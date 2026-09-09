#!/usr/bin/env node
// Executa uma cadeia de planos encadeados (plano-sequência sem corte).
//
//   npm run chain -- --spec plano.json --out-dir outputs/<peca>/cadeia --confirm-provider-input true
//   npm run chain -- --spec plano.json --out-dir outputs/<peca>/cadeia --dry-run
//
// Sequencial por definição: o elo N+1 depende do último frame do elo N. Retomável:
// plano com MP4 já entregue é pulado, sem nova chamada. O gasto acontece só dentro
// do `generate` do CLI, que continua dono do recibo, da task e da trava de entrada.
//
// Receita completa: docs/guias/MANUAL-PLANO-SEQUENCIA.md
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planShotChain } from "../lib/media-pipeline/shot-chain.mjs";

const coreRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Argumento inesperado: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) options[key] = true;
    else { options[key] = next; i += 1; }
  }
  return options;
}

function required(value, flag) {
  if (value === undefined || value === true) throw new Error(`${flag} é obrigatório.`);
  return String(value);
}

const HELP = `Plano-sequência encadeado — o último frame de cada plano vira o primeiro do seguinte.

  node scripts/encadear-planos.mjs --spec plano.json --out-dir outputs/<peca>/cadeia --confirm-provider-input true

  --spec       JSON da cadeia (schema mkt-videos/shot-chain@1). Ver examples/plano-sequencia.example.json
  --out-dir    onde ficam os MP4, os recibos e frames/
  --dry-run    imprime o plano e as chamadas, sem gerar nada
  --only <id>  gera um único plano (exige o frame anterior já disponível)
  --tail       segundos do fim usados para extrair o frame de corte (padrão 0.15)
  --confirm-provider-input true
               confirmação humana literal exigida na execução real de todo elo
               que envie imagem de referência ou frame derivado ao provedor

O script nunca presume essa confirmação. Cada elo é uma chamada paga do Omni.
Rode --dry-run antes e confira o teto e os passos que exigirão a confirmação.`;

const options = parseArgs(process.argv.slice(2));
if (options.help || options.h) { console.log(HELP); process.exit(0); }

const specFile = path.resolve(required(options.spec, "--spec"));
const outDir = path.resolve(required(options["out-dir"], "--out-dir"));
const dryRun = options["dry-run"] === true || options["dry-run"] === "true";
const only = options.only === undefined || options.only === true ? null : String(options.only);
const tail = Number(options.tail ?? 0.15);
const confirmProviderInputLiteral = options["confirm-provider-input"];
const providerInputConfirmed = confirmProviderInputLiteral === "true";
if (!Number.isFinite(tail) || tail <= 0) throw new Error("--tail deve ser positivo.");

const plan = planShotChain(JSON.parse(readFileSync(specFile, "utf8")), { outDir });
const promptFile = path.join(outDir, "prompt.txt");
const manifestFile = path.join(outDir, "cadeia.json");

const pendentes = plan.steps.filter((s) => !existsSync(s.outputFile) && (only === null || s.id === only));
const passosComEntradaProvedor = pendentes.filter((s) => s.firstFrameFile || s.referenceImage);
const confirmacaoEntradaProvedorExigida = passosComEntradaProvedor.length > 0;
console.error(`cadeia "${plan.title ?? path.basename(specFile)}" | ${plan.steps.length} planos | ${pendentes.length} chamadas Omni pendentes`);
for (const step of plan.steps) {
  const estado = existsSync(step.outputFile) ? "entregue" : pendentes.includes(step) ? "pendente" : "fora do --only";
  console.error(`  ${step.id}  ${step.task.padEnd(19)} ${step.beat ?? ""} [${estado}]`);
}

if (dryRun) {
  if (confirmacaoEntradaProvedorExigida) {
    console.error(`execução real: --confirm-provider-input true será exigido para ${passosComEntradaProvedor.map((step) => step.id).join(", ")}`);
  }
  console.log(JSON.stringify({ spec: specFile, outDir, planos: plan.steps.length, chamadasPendentes: pendentes.length,
    confirmacaoEntradaProvedor: {
      exigidaNaExecucaoReal: confirmacaoEntradaProvedorExigida,
      fornecidaLiteralmente: providerInputConfirmed,
      passos: passosComEntradaProvedor.map((step) => step.id),
    },
    steps: plan.steps.map((s) => ({ id: s.id, task: s.task, firstFrame: s.firstFrameFile, referencia: s.referenceImage, out: s.outputFile })) }, null, 2));
  process.exit(0);
}

if (confirmacaoEntradaProvedorExigida && !providerInputConfirmed) {
  throw new Error(
    `A execução real dos passos ${passosComEntradaProvedor.map((step) => step.id).join(", ")} exige --confirm-provider-input true com o valor literal "true".`,
  );
}

mkdirSync(plan.framesDir, { recursive: true });
const registro = [];

for (const step of plan.steps) {
  if (only !== null && step.id !== only) continue;
  if (existsSync(step.outputFile)) { console.error(`[${step.id}] já entregue, pulando`); continue; }

  const entrada = [];
  if (step.firstFrameFile) {
    const anterior = path.join(outDir, `${step.previousShotId}.mp4`);
    if (!existsSync(anterior)) throw new Error(`cadeia quebrada: ${step.id} precisa de ${anterior}.`);
    // O frame de corte sai do MP4 já entregue, nunca de um render intermediário.
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-sseof", `-${tail}`, "-i", anterior,
      "-frames:v", "1", step.firstFrameFile], { stdio: "inherit" });
    entrada.push("--first-frame", step.firstFrameFile, "--confirm-provider-input", confirmProviderInputLiteral);
  } else if (step.referenceImage) {
    if (!existsSync(step.referenceImage)) throw new Error(`${step.id}: arte de marca não encontrada em ${step.referenceImage}.`);
    entrada.push("--image", step.referenceImage, "--confirm-provider-input", confirmProviderInputLiteral);
  }

  writeFileSync(promptFile, step.prompt, "utf8");
  console.error(`--- ${step.id} (${step.beat ?? step.role}) : ${step.task} ---`);
  execFileSync("node", [path.join(coreRoot, "scripts", "omni-cli.mjs"), "generate",
    "--prompt-file", promptFile, ...entrada, "--task", step.task, "--aspect", step.aspect, "--out", step.outputFile],
    { cwd: coreRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });

  registro.push({ id: step.id, beat: step.beat, task: step.task, aspect: step.aspect,
    firstFrame: step.firstFrameFile, referencia: step.referenceImage,
    video: step.outputFile, recibo: `${step.outputFile}.receipt.json` });
  console.error(`[${step.id}] pronto`);
}

writeFileSync(manifestFile, JSON.stringify({ schema: "mkt-videos/shot-chain-run@1", spec: specFile, outDir,
  geradoEm: new Date().toISOString(), planos: registro }, null, 2), "utf8");
console.error(`cadeia registrada em ${manifestFile}`);
console.log(JSON.stringify({ outDir, gerados: registro.length, manifesto: manifestFile }, null, 2));
