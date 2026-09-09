// Documento Mestre de Produção (production-spec@1).
//
// Um único arquivo de ponta a ponta que o usuário escreve e que o sistema
// entende: roteiro+narração em blocos, regra de sincronismo (Whisper dirige as
// cenas?), cenas (o que cada uma mostra + texto na tela), trilha, mix, QA e
// entrega. O compilador valida o documento, traduz para film-spec@2 e gera o
// execution-plan@1 (o grafo de etapas que o executor roda de ponta a ponta).
//
// Puro por contrato: sem I/O de escrita, sem relógio, sem sorteio.

import { compileFilmSpec } from "./film-compiler.mjs";

export const PRODUCTION_SPEC_SCHEMA = "mkt-videos/production-spec@1";

const ASPECTS = new Set(["16:9", "9:16"]);
const SYNC_ENGINES = new Set(["whisper-word-timestamps"]);
const NARRATION_PROVIDERS = new Set(["omni", "google-vids"]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function slug(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`${label} deve usar apenas letras minúsculas, números e hífen.`);
  }
  return normalized;
}

/** Valida a forma do documento mestre e devolve uma cópia normalizada. */
export function validarProductionSpec(bruta) {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) {
    throw new Error("Documento mestre inválido: esperava um objeto.");
  }
  if (bruta.schema !== PRODUCTION_SPEC_SCHEMA) {
    throw new Error(`Documento exige schema ${PRODUCTION_SPEC_SCHEMA}; recebeu ${JSON.stringify(bruta.schema)}.`);
  }
  const name = slug(bruta.name, "name");
  const aspect = String(bruta.aspect ?? "16:9");
  if (!ASPECTS.has(aspect)) throw new Error(`aspect deve ser 16:9 ou 9:16; recebeu "${aspect}".`);

  const narrationRaw = bruta.narration;
  if (!narrationRaw || typeof narrationRaw !== "object") throw new Error("narration é obrigatório.");
  const provider = String(narrationRaw.provider ?? "omni");
  if (!NARRATION_PROVIDERS.has(provider)) throw new Error(`narration.provider desconhecido: ${provider}.`);
  const documentUrl = narrationRaw.documentUrl == null ? null : String(narrationRaw.documentUrl).trim();
  if (provider === "google-vids" && !documentUrl?.startsWith("https://docs.google.com/videos/d/")) {
    throw new Error("narration.documentUrl deve apontar para um documento do Google Vids.");
  }
  const blocks = Array.isArray(narrationRaw.blocks) && narrationRaw.blocks.length
    ? narrationRaw.blocks.map((block, index) => ({
        id: String(block?.id ?? `bloco-${index + 1}`).trim(),
        text: requiredText(block?.text, `narration.blocks[${index}].text`),
        ...(block?.voice == null ? {} : { voice: String(block.voice) }),
      }))
    : [];
  if (!blocks.length) throw new Error("narration.blocks deve ter ao menos um bloco.");
  const blockIds = new Set();
  for (const block of blocks) {
    if (blockIds.has(block.id)) throw new Error(`narration.blocks contém id duplicado: ${block.id}.`);
    blockIds.add(block.id);
  }

  const syncRaw = bruta.sync ?? {};
  const syncEngine = String(syncRaw.engine ?? "whisper-word-timestamps");
  if (!SYNC_ENGINES.has(syncEngine)) throw new Error(`sync.engine desconhecido: ${syncEngine}.`);
  const scenesFollowSpeech = syncRaw.scenesFollowSpeech !== false;
  const whisperModel = String(syncRaw.whisperModel ?? "small");
  const language = String(syncRaw.language ?? "pt");
  const leadInSeconds = syncRaw.leadInSeconds == null ? 0.5 : Number(syncRaw.leadInSeconds);
  const tailOutSeconds = syncRaw.tailOutSeconds == null ? 0.3 : Number(syncRaw.tailOutSeconds);
  const gapSeconds = syncRaw.gapSeconds == null ? 0.25 : Number(syncRaw.gapSeconds);
  const minConfidence = syncRaw.minConfidence == null ? 0.6 : Number(syncRaw.minConfidence);

  const scenes = Array.isArray(bruta.scenes) && bruta.scenes.length
    ? bruta.scenes.map((scene, index) => {
        const id = String(scene?.id ?? `cena-${index + 1}`).trim();
        if (!blockIds.has(id) && !scene?.block) {
          throw new Error(`scenes[${index}].id ("${id}") deve casar com um block de narração, ou informar scene.block.`);
        }
        const block = scene?.block ?? id;
        if (!blockIds.has(block)) throw new Error(`scenes[${index}] aponta para block inexistente: "${block}".`);
        const duration = scene?.duration == null ? null : Number(scene.duration);
        if (duration != null && (!Number.isInteger(duration) || duration < 4 || duration > 120)) {
          throw new Error(`scenes[${index}].duration deve ser inteiro entre 4 e 120 segundos (ou ausente para seguir a fala).`);
        }
        return {
          id,
          block,
          visual: requiredText(scene?.visual ?? scene?.prompt, `scenes[${index}].visual`),
          ...(scene?.onScreenText == null ? {} : { onScreenText: String(scene.onScreenText) }),
          ...(scene?.textRendering == null ? {} : { textRendering: String(scene.textRendering) }),
          ...(duration == null ? {} : { duration }),
        };
      })
    : [];
  if (!scenes.length) throw new Error("scenes deve ter ao menos uma cena.");

  const musicRaw = bruta.music ?? {};
  const music = musicRaw.preset || musicRaw.prompt
    ? {
        preset: musicRaw.preset == null ? null : String(musicRaw.preset),
        prompt: musicRaw.prompt == null ? null : String(musicRaw.prompt),
        fit: String(musicRaw.fit ?? "exact"),
        ...(musicRaw.durationSeconds == null ? {} : { durationSeconds: Number(musicRaw.durationSeconds) }),
        ...(musicRaw.fadeOut == null ? {} : { fadeOut: Number(musicRaw.fadeOut) }),
      }
    : null;

  const assembly = { fps: Number(bruta.assembly?.fps ?? 24) };
  if (!Number.isInteger(assembly.fps) || assembly.fps < 1 || assembly.fps > 60) throw new Error("assembly.fps deve ser inteiro entre 1 e 60.");
  const mix = {
    musicGain: Number(bruta.mix?.musicGain ?? 0.32),
    duckingRatio: Number(bruta.mix?.duckingRatio ?? 8),
    fadeIn: Number(bruta.mix?.fadeIn ?? 0.15),
    fadeOut: Number(bruta.mix?.fadeOut ?? 0),
  };
  const qa = {
    structural: bruta.qa?.structural !== false,
    semantic: bruta.qa?.semantic === true,
  };
  const delivery = { profile: String(bruta.delivery?.profile ?? "web-1080p") };

  return {
    schema: PRODUCTION_SPEC_SCHEMA,
    name,
    aspect,
    narration: {
      provider,
      voice: String(narrationRaw.voice ?? (provider === "google-vids" ? "Nyla" : "voz masculina brasileira madura, grave, calorosa, encorpada e confiável, de locutor institucional experiente")),
      documentUrl,
      blocks,
    },
    sync: { engine: syncEngine, scenesFollowSpeech, whisperModel, language, leadInSeconds, tailOutSeconds, gapSeconds, minConfidence },
    scenes,
    music,
    assembly,
    mix,
    qa,
    delivery,
  };
}

/**
 * Compila o documento mestre para o film-spec@2 e gera o execution-plan@1.
 * O execution-plan descreve TODAS as etapas de ponta a ponta que o executor
 * vai rodar (narração → whisper → keyframe → anima → monta → mixa → entrega).
 * @param {object} bruta documento mestre (production-spec@1)
 * @returns {{ production: object, filmSpec: object, plan: object }}
 */
export function compilarProductionSpec(bruta) {
  const production = validarProductionSpec(bruta);
  const narrationText = production.narration.blocks.map((b) => b.text).join(" ");
  const scenes = production.scenes.map((scene) => {
    const block = production.narration.blocks.find((b) => b.id === scene.block);
    const durationHint = scene.duration ?? (production.sync.scenesFollowSpeech ? null : 10);
    return {
      id: scene.id,
      role: "spectacle",
      visualPrompt: scene.visual,
      motionPrompt: scene.visual,
      ...(scene.onScreenText == null ? {} : { onScreenText: scene.onScreenText }),
      ...(scene.textRendering == null ? (scene.onScreenText == null ? {} : { textRendering: "omni-native" }) : { textRendering: scene.textRendering }),
      ...(durationHint == null ? {} : { durationHint }),
      references: [],
      ...(block?.voice == null ? {} : { voice: block.voice }),
      narrationBlock: scene.block,
    };
  });

  const filmSpec = {
    schema: "mkt-videos/film-spec@2",
    name: production.name,
    source: {
      request: `${production.narration.blocks.map((b) => b.text).join(" ")}`,
      sync: production.sync,
    },
    narration: {
      mode: production.narration.provider === "omni" ? "omni" : "continuous",
      provider: production.narration.provider,
      text: narrationText,
      voice: production.narration.voice,
      documentUrl: production.narration.documentUrl,
      newScene: true,
      blocks: production.narration.blocks.map((b) => ({ ...b })),
      alignment: {
        engine: production.sync.engine,
        model: production.sync.whisperModel,
        language: production.sync.language,
        leadInSeconds: production.sync.leadInSeconds,
        tailOutSeconds: production.sync.tailOutSeconds,
        gapSeconds: production.sync.gapSeconds,
        minConfidence: production.sync.minConfidence,
      },
    },
    music: production.music
      ? {
          mode: "generated",
          backend: "flow-music",
          preset: production.music.preset,
          intent: production.music.prompt ?? "",
          fit: production.music.fit,
          ...(production.music.durationSeconds == null ? {} : { durationSeconds: production.music.durationSeconds }),
          ...(production.music.fadeOut == null ? {} : { tailSeconds: production.music.fadeOut }),
        }
      : { mode: "none" },
    timeline: {
      fps: { numerator: production.assembly.fps, denominator: 1 },
      transition: "cut",
      transitionFrames: 0,
      holdInFrames: 0,
      holdOutFrames: 0,
    },
    scenes,
    formats: { master: production.aspect },
    captions: { mode: "none" },
    qa: {
      enabled: production.qa.structural,
      semantic: production.qa.semantic,
      gate: "block",
    },
    reuse: { policy: "off" },
    execution: {
      budget: {
        omni: scenes.length + (production.narration.provider === "omni" ? production.narration.blocks.length : 0),
        image: scenes.length,
        tts: production.narration.provider === "google-vids" ? 1 : 0,
        music: production.music ? 1 : 0,
        semanticQa: production.qa.semantic ? 1 : 0,
      },
      concurrency: { profile: "balanced" },
    },
    finishing: {
      assembly: { transition: "cut", transitionDuration: 0.01, fps: production.assembly.fps },
      audio: {
        loudness: "platform",
        musicGain: production.mix.musicGain,
        duckingRatio: production.mix.duckingRatio,
        fadeIn: production.mix.fadeIn,
        fadeOut: production.mix.fadeOut,
      },
      delivery: { profile: production.delivery.profile },
    },
  };

  const plan = compileFilmSpec(filmSpec);
  return {
    production,
    filmSpec,
    plan,
  };
}

/** Etapas de ponta a ponta que o execution-plan define (para exibição). */
export function resumirEtapasDoPlano(plan) {
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  return nodes.map((node) => ({
    id: node.id,
    lane: node.lane ?? null,
    costClass: node.costClass ?? null,
    dependencies: Array.isArray(node.dependencies) ? node.dependencies : [],
  }));
}
