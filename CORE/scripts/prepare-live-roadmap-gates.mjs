import path from "node:path";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { buildMultiVoiceNarrationPlan } from "../lib/media-pipeline/multi-voice-narration.mjs";
import { createCapabilityCandidate } from "../lib/media-pipeline/capability-lifecycle.mjs";
import { compileResolvedMasterRecipe, parseMasterRecipe, resolveMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { writeJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";

const { values } = parseArgs({ options: {
  film: { type: "string" }, "multi-voice": { type: "string" },
  out: { type: "string" }, "media-out": { type: "string" },
  "prepared-at": { type: "string" }, help: { type: "boolean" },
}, allowPositionals: false });
if (values.help) {
  console.log("Uso: npm run prepare:live-gates -- --film <receita-filme.json> --multi-voice <receita-vozes.json> --out <pasta-planos> --media-out <pasta-futura-audios> --prepared-at <ISO-UTC>\nPrepara planos locais sem gerar mídia ou ler credenciais. Reutilize a mesma data e os mesmos argumentos para conferir uma preparação existente.");
  process.exit(0);
}
for (const key of ["film", "multi-voice", "out", "media-out", "prepared-at"]) {
  if (!values[key]?.trim()) throw new Error(`--${key} é obrigatório; consulte --help.`);
}
const phase5File = path.resolve(values.film);
const phase7File = path.resolve(values["multi-voice"]);
const diagnosticsRoot = path.resolve(values.out);
const outputRoot = path.resolve(values["media-out"]);
const preparedAt = new Date(values["prepared-at"]);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(values["prepared-at"]) || !Number.isFinite(preparedAt.getTime())) throw new Error("--prepared-at exige uma data ISO UTC válida.");

async function resolved(file) {
  return resolveMasterRecipe(parseMasterRecipe(await readFile(file), { channel: "file" }));
}

async function publishDeterministic(file, value, label) {
  try {
    const existing = JSON.parse(await readFile(file, "utf8"));
    if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error(`${label} existente diverge da preparação determinística: ${file}`);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeJsonAtomic(file, value, { label });
}

const phase5 = await resolved(phase5File);
const phase7 = await resolved(phase7File);
const phase5Compiled = compileResolvedMasterRecipe(phase5);
const multiVoicePlan = buildMultiVoiceNarrationPlan({
  productionId: phase7.recipe.identity.id,
  blocks: phase7.recipe.narration.blocks,
  speakers: phase7.recipe.narration.speakers,
  outputDir: path.join(outputRoot, "narracao"),
});
const candidate = createCapabilityCandidate({
  id: "google-vids-multi-voice",
  adapterProvider: "google-vids",
  intents: ["narration.generate.segmented-multi-voice"],
  operations: ["segmented-text-to-speech"],
  authContract: "cookie-only-browser-session",
  reconcile: true,
  limitation: "Admitida somente após WAV e recibo distintos por segmento, replay local e alinhamento Whisper global aprovados.",
  actor: "local-roadmap-preparation",
  now: preparedAt,
});
const checklist = {
  schema: "gerador-de-videos/live-roadmap-gates-preexecution@1",
  preparedAt: preparedAt.toISOString(),
  providerCalls: 0,
  phase5: {
    recipeFile: phase5File,
    resolvedHash: phase5.hashes.resolvedHash,
    durationSeconds: phase5.derived.durationSeconds,
    scenes: phase5.recipe.program.shots.map((shot) => {
      const generation = phase5.recipe.videoGeneration.shots.find((entry) => entry.shotId === shot.id);
      return {
        scene: shot.id,
        durationSeconds: shot.durationFrames * phase5.recipe.format.master.fps.denominator / phase5.recipe.format.master.fps.numerator,
        castIds: generation?.castIds ?? [],
        reference: (generation?.inputAssetIds ?? []).join(", ") || "nenhuma",
        speechOrNarration: shot.id === phase5.recipe.program.shots[0].id ? phase5.recipe.narration.blocks.map((entry) => entry.id).join(", ") : "sem bloco exclusivo",
        onScreenText: phase5.recipe.graphics?.scenes?.find((entry) => entry.shotId === shot.id)?.text ?? "nenhum",
        music: phase5.recipe.music ?? null,
      };
    }),
  },
  phase7: {
    recipeFile: phase7File,
    resolvedHash: phase7.hashes.resolvedHash,
    expectedBlocker: "capability-multi-voice-unproved",
    segments: multiVoicePlan.segments.map(({ id, speakerId, voice, text, outputFile, receiptFile }) => ({ id, speakerId, voice, text, outputFile, receiptFile })),
    masterFile: multiVoicePlan.masterFile,
    alignmentFile: multiVoicePlan.alignmentFile,
    planFingerprint: multiVoicePlan.planFingerprint,
    promotion: "candidate -> live WAV/receipt evidence -> provider-free replay -> explicit human activation with TTL",
  },
};

await publishDeterministic(path.join(diagnosticsRoot, "phase7-multi-voice-plan-v3.json"), multiVoicePlan, "Plano multi-voz");
await publishDeterministic(path.join(diagnosticsRoot, "phase7-capability-candidate-v3.json"), candidate, "Capability candidata");
await publishDeterministic(path.join(diagnosticsRoot, "live-roadmap-gates-preexecution-v3.json"), checklist, "Checklist pré-execução live");
await publishDeterministic(path.join(diagnosticsRoot, "phase5-live-film-spec-v6.json"), phase5Compiled.filmSpec, "Film spec live");
await publishDeterministic(path.join(diagnosticsRoot, "phase5-live-execution-plan-v6.json"), phase5Compiled.executionPlan, "Execution plan live");
console.log(JSON.stringify({ checklist, candidate, multiVoicePlan, providerCalls: 0 }, null, 2));
