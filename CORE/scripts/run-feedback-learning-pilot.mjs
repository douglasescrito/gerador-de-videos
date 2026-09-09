#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFeedbackLearningPilotReport, runFeedbackLearningPilot } from "../lib/media-pipeline/feedback-learning-pilot.mjs";

const coreRoot = path.resolve(import.meta.dirname, "..");
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const outputFile = path.resolve(outArg
  ? outArg.slice("--out=".length)
  : path.join(coreRoot, "diagnosticos", "governanca", "feedback-learning-pilot.json"));
const report = await runFeedbackLearningPilot();
assertFeedbackLearningPilotReport(report);
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch((error) => {
  if (error?.code === "EEXIST") {
    throw new Error(`Saída já existe; escolha outro --out para não sobrescrever: ${outputFile}`);
  }
  throw error;
});
process.stdout.write(`${JSON.stringify({
  ok: true,
  output: outputFile,
  schema: report.schema,
  fingerprint: report.fingerprint,
  contextHash: report.retrieval.contextHash,
  rollbackVerified: report.rollbackVerified,
  providerCalls: report.providerCalls,
})}\n`);

