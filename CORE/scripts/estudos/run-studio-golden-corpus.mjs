#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStudioGoldenReport } from "../../lib/media-pipeline/studio-golden-corpus.mjs";

const coreRoot = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  process.stdout.write("Uso: node scripts/estudos/run-studio-golden-corpus.mjs [--corpus arquivo.json] [--out relatório.json]\nCompila os 20 briefs técnicos duas vezes, sem gerar mídia ou chamar provedores.\nO relatório mantém avaliação humana pendente; não verifica os resultados editoriais esperados.\nCaminhos explícitos são relativos ao diretório atual. Saídas existentes são preservadas.\n");
  process.exit(0);
}
const options = new Map();
for (let index = 0; index < args.length; index += 1) {
  const [key, ...inline] = args[index].split("=");
  if (!["--corpus", "--out"].includes(key) || options.has(key)) throw new Error(`Opção desconhecida ou repetida: ${key}`);
  const value = inline.length ? inline.join("=") : args[++index];
  if (!value?.trim() || value.startsWith("--")) throw new Error(`Valor ausente para ${key}.`);
  options.set(key, value);
}
const corpusFile = options.has("--corpus") ? path.resolve(options.get("--corpus")) : path.join(coreRoot, "test", "fixtures", "studio-golden-briefs@1.json");
const outputFile = options.has("--out") ? path.resolve(options.get("--out")) : path.join(coreRoot, "diagnosticos", "governanca", "studio-golden-report.json");
const corpus = JSON.parse(await readFile(corpusFile, "utf8"));
const report = buildStudioGoldenReport(corpus);
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch(async (error) => {
  if (error?.code !== "EEXIST") throw error;
  throw new Error(`Saída já existe; escolha outro --out para não sobrescrever: ${outputFile}`);
});
process.stdout.write(`${JSON.stringify({ ok: true, output: outputFile, schema: report.schema, caseCount: report.caseCount, fingerprint: report.fingerprint, providerCalls: report.providerCalls, humanVerdict: report.humanVerdict })}\n`);
