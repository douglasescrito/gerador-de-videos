import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parseSemanticScript, validateSemanticScript, generateMusicBrief } from "./energy-analyzer.mjs";
import { computeAudioHash } from "./whisper-cache.mjs";
import { mixSfxStem } from "./sfx-stem-mixer.mjs";
import { buildV17FfmpegArgs } from "./v17-filtergraph-builder.mjs";
import { guardAspectRatio } from "./aspect-ratio-guard.mjs";

// Utilitário para salvar o estado de forma atômica
async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
  } catch (err) {
    try { await fs.unlink(tempPath); } catch {}
    throw new Error(`Falha ao salvar o estado de forma atômica: ${err.message}`);
  }
}

/**
 * Cria o estado inicial do pipeline V17
 */
export function createV17PipelineState({ collection, theme, scriptRaw, targetDurationMs = 60000, expectedAspect = "9:16" } = {}) {
  const now = new Date().toISOString();
  return {
    schema: "mkt-videos/v17-pipeline-state@1",
    collection: collection || "default",
    createdAt: now,
    updatedAt: now,
    spec: {
      theme: theme || "unknown",
      scriptRaw: scriptRaw || "",
      scriptHash: scriptRaw ? crypto.createHash("sha256").update(scriptRaw).digest("hex") : "",
      targetDurationMs,
      expectedAspect
    },
    phases: {
      parse: { status: "pending" },
      voice: { status: "pending" },
      align: { status: "pending" },
      music: { status: "pending" },
      visual: { status: "pending" },
      compose: { status: "pending" },
      deliver: { status: "pending" }
    },
    warnings: []
  };
}

/**
 * Orquestrador principal do Pipeline V17
 */
export async function runV17Pipeline({
  spec,
  stateFile,
  outputDir,
  sfxDir = null,
  dryRun = false,
  resumeFrom = null,
  parallelMusicVisual = true
} = {}) {
  if (!stateFile || !outputDir) {
    throw new Error("Parâmetros 'stateFile' e 'outputDir' são obrigatórios.");
  }

  // Carregar ou inicializar o estado
  let state;
  try {
    const content = await fs.readFile(stateFile, "utf8");
    state = JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      // Estado não existe, precisa inicializar
      if (!spec) {
        throw new Error("Não é possível inicializar o estado sem a 'spec'.");
      }
      
      let parsedSpec = spec;
      if (typeof spec === "string") {
        const specContent = await fs.readFile(spec, "utf8");
        parsedSpec = JSON.parse(specContent);
      }
      
      state = createV17PipelineState({
        collection: parsedSpec.collection,
        theme: parsedSpec.theme,
        scriptRaw: parsedSpec.scriptRaw || parsedSpec.script_raw,
        targetDurationMs: parsedSpec.targetDurationMs,
        expectedAspect: parsedSpec.expectedAspect
      });
      await writeJsonAtomic(stateFile, state);
    } else {
      throw new Error(`Erro ao ler o stateFile: ${err.message}`);
    }
  }

  // Tratamento do resumeFrom
  const phaseNames = ["parse", "voice", "align", "music", "visual", "compose", "deliver"];
  if (resumeFrom) {
    if (!phaseNames.includes(resumeFrom)) {
      throw new Error(`Fase desconhecida para resumeFrom: ${resumeFrom}`);
    }
    const startIndex = phaseNames.indexOf(resumeFrom);
    for (let i = startIndex; i < phaseNames.length; i++) {
      state.phases[phaseNames[i]].status = "pending";
    }
    await writeJsonAtomic(stateFile, state);
  }

  // Auxiliar para atualizar estado de fase
  const updatePhase = async (phaseName, data) => {
    state.phases[phaseName] = { ...state.phases[phaseName], ...data, updatedAt: new Date().toISOString() };
    state.updatedAt = new Date().toISOString();
    if (!dryRun) {
      await writeJsonAtomic(stateFile, state);
    }
  };

  const metaDir = path.join(outputDir, "metadados");
  const videosSoltosDir = path.join(outputDir, "videos-soltos");
  const videosUnidosDir = path.join(outputDir, "videos-unidos");

  if (!dryRun) {
    await fs.mkdir(metaDir, { recursive: true });
    await fs.mkdir(videosSoltosDir, { recursive: true });
    await fs.mkdir(videosUnidosDir, { recursive: true });
  }

  let totalCostEstimate = 0;
  
  // ==============================================
  // Fase 1: Parse
  // ==============================================
  if (state.phases.parse.status === "pending") {
    await updatePhase("parse", { status: "running", startedAt: new Date().toISOString() });
    try {
      if (!dryRun) {
        const scriptData = state.spec.scriptRaw;
        const validation = validateSemanticScript(scriptData);
        if (!validation.valid) {
          throw new Error(`Validação falhou: ${validation.errors.join(", ")}`);
        }
        
        const parsed = parseSemanticScript(scriptData);
        const musicBrief = generateMusicBrief(scriptData);
        
        const parsedPath = path.join(metaDir, "parsed-script.json");
        const briefPath = path.join(metaDir, "music-brief.json");
        
        await fs.writeFile(parsedPath, JSON.stringify(parsed, null, 2), "utf8");
        await fs.writeFile(briefPath, JSON.stringify(musicBrief, null, 2), "utf8");
        
        await updatePhase("parse", { status: "done", completedAt: new Date().toISOString(), artifact: parsedPath });
      } else {
        await updatePhase("parse", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("parse", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase parse: ${err.message}`);
    }
  }

  // ==============================================
  // Fase 2: Voice
  // ==============================================
  if (state.phases.voice.status === "pending") {
    await updatePhase("voice", { status: "running", startedAt: new Date().toISOString() });
    
    try {
      if (!dryRun) {
        // Lê o script parseado da Fase 1 para obter o texto limpo
        const parsedPath = path.join(metaDir, "parsed-script.json");
        const parsedData = JSON.parse(await fs.readFile(parsedPath, "utf8"));
        
        const voicePrompt = [
          "Leia este roteiro com uma voz masculina, grave, hiper-agressiva e autoritária.",
          "- Sem pausas musicais longas, sem pausas reflexivas lentas.",
          "- O tom é de aviso severo, quase uma bronca ríspida, no estilo 'Wake up call'.",
          "- Dite as sílabas finais de forma percussiva.",
          "",
          `Roteiro: ${parsedData.cleanText}`
        ].join("\n");
        
        const jobConfig = {
          schema: "mkt-videos/batch-job@4",
          mode: "raw",
          collection: state.collection,
          jobs: [{
            id: `${state.collection}-voice-01`,
            prompt: voicePrompt,
            aspect: state.spec.expectedAspect,
          }]
        };
        const jobPath = path.join(metaDir, "voice-job.json");
        await fs.writeFile(jobPath, JSON.stringify(jobConfig, null, 2), "utf8");
        await updatePhase("voice", { status: "done", completedAt: new Date().toISOString(), artifact: jobPath });
      } else {
        totalCostEstimate++;
        await updatePhase("voice", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("voice", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase voice: ${err.message}`);
    }
  }

  // ==============================================
  // Fase 3: Align
  // ==============================================
  if (state.phases.align.status === "pending") {
    await updatePhase("align", { status: "running", startedAt: new Date().toISOString() });
    
    try {
      if (!dryRun) {
        // Mock da lógica de alinhamento
        const sfxTriggersPath = path.join(metaDir, "sfx-triggers.json");
        // Em um cenário real, chamaria Whisper e cruzaria os dados.
        // Simulando a escrita do arquivo por enquanto.
        await fs.writeFile(sfxTriggersPath, JSON.stringify([], null, 2), "utf8");
        await updatePhase("align", { status: "done", completedAt: new Date().toISOString(), artifact: sfxTriggersPath });
      } else {
        await updatePhase("align", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("align", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase align: ${err.message}`);
    }
  }

  // ==============================================
  // Fase 4 & 5: Music e Visual (Opcionalmente Paralelas)
  // ==============================================
  const runMusic = async () => {
    if (state.phases.music.status !== "pending") return;
    await updatePhase("music", { status: "running", startedAt: new Date().toISOString() });
    try {
      if (!dryRun) {
        // Lê o music brief da Fase 1
        const briefPath = path.join(metaDir, "music-brief.json");
        const musicBrief = JSON.parse(await fs.readFile(briefPath, "utf8"));
        
        const jobConfig = {
          type: "music",
          prompt: musicBrief.selectedPrompt,
          duration: Math.round(state.spec.targetDurationMs / 1000),
          style: musicBrief.style,
          targetBpm: musicBrief.targetBpm,
          command: `npm run video -- music --prompt "${musicBrief.selectedPrompt}" --duration ${Math.round(state.spec.targetDurationMs / 1000)}`
        };
        const jobPath = path.join(metaDir, "music-job.json");
        await fs.writeFile(jobPath, JSON.stringify(jobConfig, null, 2), "utf8");
        await updatePhase("music", { status: "done", completedAt: new Date().toISOString(), artifact: jobPath });
      } else {
        totalCostEstimate++;
        await updatePhase("music", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("music", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase music: ${err.message}`);
    }
  };

  const runVisual = async () => {
    if (state.phases.visual.status !== "pending") return;
    await updatePhase("visual", { status: "running", startedAt: new Date().toISOString() });
    try {
      if (!dryRun) {
        // Lê o parsed-script da Fase 1 para montar os jobs visuais reativos à energia
        const parsedPath = path.join(metaDir, "parsed-script.json");
        const parsedData = JSON.parse(await fs.readFile(parsedPath, "utf8"));
        
        const jobConfig = {
          schema: "mkt-videos/batch-job@4",
          mode: "studio",
          style: "react-audiovisual@1",
          collection: state.collection,
          sfxTriggersFile: path.join(metaDir, "sfx-triggers.json"),
          jobs: parsedData.segments.map((seg, i) => ({
            id: `${state.collection}-visual-${String(i + 1).padStart(2, "0")}`,
            prompt: seg.text,
            energy: seg.energy,
            aspect: state.spec.expectedAspect,
          })),
          command: `npm run video -- batch --jobs "${path.join(metaDir, "visual-jobs.json")}" --mode studio --style react-audiovisual@1`
        };
        const jobPath = path.join(metaDir, "visual-jobs.json");
        await fs.writeFile(jobPath, JSON.stringify(jobConfig, null, 2), "utf8");
        await updatePhase("visual", { status: "done", completedAt: new Date().toISOString(), artifact: jobPath });
      } else {
        totalCostEstimate++;
        await updatePhase("visual", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("visual", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase visual: ${err.message}`);
    }
  };

  if (parallelMusicVisual) {
    await Promise.all([runMusic(), runVisual()]);
  } else {
    await runMusic();
    await runVisual();
  }

  // ==============================================
  // Fase 6: Compose
  // ==============================================
  if (state.phases.compose.status === "pending") {
    await updatePhase("compose", { status: "running", startedAt: new Date().toISOString() });
    
    try {
      if (!dryRun) {
        const masterPath = path.join(videosUnidosDir, "master-v17.mp4");
        // Em um cenário real: mixSfxStem, buildV17FfmpegArgs, executar ffmpeg, guardAspectRatio
        // Simulando a escrita
        await fs.writeFile(masterPath, "dummy video data", "utf8");
        await updatePhase("compose", { status: "done", completedAt: new Date().toISOString(), artifact: masterPath });
      } else {
        await updatePhase("compose", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("compose", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase compose: ${err.message}`);
    }
  }

  // ==============================================
  // Fase 7: Deliver
  // ==============================================
  if (state.phases.deliver.status === "pending") {
    await updatePhase("deliver", { status: "running", startedAt: new Date().toISOString() });
    
    try {
      if (!dryRun) {
        const deliverConfig = {
          type: "drive-deliver",
          collection: state.collection,
          command: `npm run video -- drive-deliver --collection ${state.collection} --root-folder-id <GOOGLE_DRIVE_FOLDER_ID> --client <CLIENT_ID> --dry-run true`,
          commandConfirm: `npm run video -- drive-deliver --collection ${state.collection} --root-folder-id <GOOGLE_DRIVE_FOLDER_ID> --client <CLIENT_ID> --dry-run false --confirm-drive-write true`
        };
        const deliverPath = path.join(metaDir, "deliver-command.json");
        await fs.writeFile(deliverPath, JSON.stringify(deliverConfig, null, 2), "utf8");
        await updatePhase("deliver", { status: "done", completedAt: new Date().toISOString(), artifact: deliverPath });
      } else {
        await updatePhase("deliver", { status: "done", completedAt: new Date().toISOString() });
      }
    } catch (err) {
      await updatePhase("deliver", { status: "failed", error: err.message });
      throw new Error(`Pipeline falhou na fase deliver: ${err.message}`);
    }
  }

  // Sumário
  const completed = Object.keys(state.phases).filter(k => state.phases[k].status === "done");
  const pending = Object.keys(state.phases).filter(k => state.phases[k].status === "pending");
  const failed = Object.keys(state.phases).filter(k => state.phases[k].status === "failed");
  
  let pipelineStatus = "completed";
  if (failed.length > 0) pipelineStatus = "failed";
  else if (pending.length > 0) pipelineStatus = "paused";

  return {
    schema: "mkt-videos/v17-pipeline-result@1",
    collection: state.collection,
    stateFile,
    status: pipelineStatus,
    currentPhase: failed.length > 0 ? failed[0] : (pending[0] || "none"),
    completedPhases: completed,
    pendingPhases: pending,
    warnings: state.warnings,
    summary: dryRun 
      ? `Dry run completo. Estimativa de ${totalCostEstimate} chamadas pagas.`
      : `Pipeline V17: ${completed.length}/${phaseNames.length} fases concluídas. Próxima: ${pending[0] || "nenhuma"}.`
  };
}
