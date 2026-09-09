import { resolveGoogleVidsVoice } from "./google-vids-voices.mjs";

// Compilador de receita@1.
//
// Uma receita descreve o que produzir; este módulo traduz isso para a entrada
// que o executor já existente espera. É o que impede a tela e o CLI de
// divergirem: os dois compilam pelo mesmo caminho, então a tela não consegue
// produzir nada que o CLI não reproduza.
//
// **Puro por contrato.** Sem I/O, sem relógio, sem sorteio, sem provedor. O
// sufixo único da coleção entra por parâmetro em vez de ser gerado aqui — é o
// que torna o resultado conferível byte a byte no teste, sem cota e sem
// depender do minuto em que rodou.
//
//   kind: peca  -> um item de lote
//   kind: lote  -> N itens de lote (parts × linhas da matriz)
//   kind: filme -> mkt-videos/film-spec@1

export const RECIPE_SCHEMA = "gerador-de-videos/receita@1";

/**
 * O resultado é união discriminada por `motor`, para que quem consome saiba, com
 * o verificador ajudando, se recebeu um lote ou um filme. Sem os literais aqui o
 * TypeScript infere `motor: string` e não consegue estreitar nada.
 *
 * @typedef {{ motor: "lote", colecao: string, lote: object, receita: object, saidas: number }} CompiladoLote
 * @typedef {{ motor: "filme", colecao: string, filmSpec: object, receita: object, saidas: number }} CompiladoFilme
 * @typedef {CompiladoLote | CompiladoFilme} ReceitaCompilada
 */

const KINDS = new Set(["peca", "lote", "filme"]);
const ASPECTS = new Set(["16:9", "9:16"]);
const TASKS = new Set(["text_to_video", "reference_to_video", "edit"]);
const REFERENCE_SOURCES = new Set(["pessoas", "assets"]);
const REFERENCE_ROLES = new Set(["reference-image", "first-frame"]);
const MAX_REFERENCIAS = 4;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VARIAVEL = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
const NARRATION_PROVIDERS = new Set(["google-vids", "omni"]);
const NARRATION_FALLBACK_POLICIES = new Set(["manual-after-preflight-failure"]);
const NARRATION_SYNCS = new Set(["whisper-word-timestamps"]);
const MUSIC_FITS = new Set(["exact"]);
const TEXT_RENDERING_MODES = new Set(["none", "omni-native", "local-gc"]);
const ALIGNMENT_REVIEWS = new Set(["orthographic-logical"]);
const OMNI_RESUBMIT_POLICIES = new Set(["evidence-guided-human", "evidence-guided-automatic"]);
const ACCEPTED_ATTEMPT_POLICIES = new Set(["whisper-pass-and-human-review", "whisper-pass"]);
const AUTHORIZATION_MODES = new Set(["per-invocation", "production-once"]);
const RETRY_POLICIES = new Set(["none", "bounded-reconciled@1"]);
const ENDING_PRESETS = new Set(["omni-flow-slow-dip-black@1"]);

function texto(valor, rotulo) {
  const normalizado = String(valor ?? "").trim();
  if (!normalizado) throw new Error(`${rotulo} é obrigatório.`);
  return normalizado;
}

function slug(valor, rotulo) {
  const normalizado = texto(valor, rotulo);
  if (!SLUG.test(normalizado)) {
    throw new Error(`${rotulo} deve usar apenas letras minúsculas, números e hífen: recebeu "${normalizado}".`);
  }
  return normalizado;
}

function lista(valor, rotulo) {
  if (valor == null) return [];
  if (!Array.isArray(valor)) throw new Error(`${rotulo} deve ser uma lista.`);
  return valor;
}

function referencias(valor, rotulo) {
  const entradas = lista(valor, rotulo);
  if (entradas.length > MAX_REFERENCIAS) {
    throw new Error(`${rotulo}: no máximo ${MAX_REFERENCIAS} referências, recebeu ${entradas.length}.`);
  }
  return entradas.map((entrada, indice) => {
    const onde = `${rotulo}[${indice}]`;
    const source = texto(entrada?.source, `${onde}.source`);
    if (!REFERENCE_SOURCES.has(source)) {
      throw new Error(`${onde}.source deve ser pessoas ou assets; referência fora da biblioteca local não é aceita.`);
    }
    const role = entrada?.role == null ? "reference-image" : texto(entrada.role, `${onde}.role`);
    if (!REFERENCE_ROLES.has(role)) throw new Error(`${onde}.role desconhecido: ${role}.`);
    return { source, relPath: texto(entrada?.relPath, `${onde}.relPath`), role };
  });
}

/**
 * Troca `{{variavel}}` pelos valores da linha. Variável sem valor é erro, nunca
 * texto vazio silencioso: um prompt com buraco produz mídia errada e custa uma
 * geração para descobrir.
 */
function aplicarVariaveis(textoBruto, valores, onde) {
  return textoBruto.replace(VARIAVEL, (_todo, nome) => {
    const valor = valores[nome];
    if (valor == null || String(valor).trim() === "") {
      throw new Error(`${onde}: a variável {{${nome}}} não tem valor nesta linha da matriz.`);
    }
    return String(valor);
  });
}

function variaveisUsadas(textoBruto) {
  return [...String(textoBruto).matchAll(VARIAVEL)].map((achado) => achado[1]);
}

/** Valida a forma da receita e devolve uma cópia normalizada. */
export function validarReceita(bruta) {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) {
    throw new Error("Receita inválida: esperava um objeto.");
  }
  if (bruta.schema !== RECIPE_SCHEMA) {
    throw new Error(`Receita exige schema ${RECIPE_SCHEMA}; recebeu ${JSON.stringify(bruta.schema)}.`);
  }

  const kind = texto(bruta.kind, "kind");
  if (!KINDS.has(kind)) throw new Error(`kind deve ser peca, lote ou filme; recebeu "${kind}".`);

  const aspect = texto(bruta.aspect, "aspect");
  if (!ASPECTS.has(aspect)) throw new Error(`aspect deve ser 16:9 ou 9:16; recebeu "${aspect}".`);

  const task = bruta.task == null ? "text_to_video" : texto(bruta.task, "task");
  if (!TASKS.has(task)) throw new Error(`task desconhecida: ${task}.`);

  const variables = lista(bruta.variables, "variables").map((entrada, indice) => ({
    id: texto(entrada?.id, `variables[${indice}].id`),
    label: texto(entrada?.label, `variables[${indice}].label`),
    example: entrada?.example == null ? null : String(entrada.example),
    required: entrada?.required !== false,
  }));

  const matrix = lista(bruta.matrix, "matrix").map((linha, indice) => {
    if (!linha || typeof linha !== "object" || Array.isArray(linha)) {
      throw new Error(`matrix[${indice}] deve ser um objeto de valores.`);
    }
    return { ...linha };
  });

  const parts = lista(bruta.parts, "parts").map((parte, indice) => ({
    name: parte?.name == null ? null : texto(parte.name, `parts[${indice}].name`),
    prompt: texto(parte?.prompt, `parts[${indice}].prompt`),
    references: referencias(parte?.references, `parts[${indice}].references`),
    techniques: lista(parte?.techniques, `parts[${indice}].techniques`).map((tecnica, t) => ({
      id: texto(tecnica?.id, `parts[${indice}].techniques[${t}].id`),
      values: { ...(tecnica?.values ?? {}) },
    })),
  }));

  const scenes = lista(bruta.scenes, "scenes").map((cena, indice) => {
    const duration = Number(cena?.duration);
    if (!Number.isInteger(duration) || duration < 4 || duration > 120) {
      throw new Error(`scenes[${indice}].duration deve ser inteiro entre 4 e 120 segundos.`);
    }
    const onScreenText = cena?.onScreenText == null ? null : texto(cena.onScreenText, `scenes[${indice}].onScreenText`);
    const textRendering = String(cena?.textRendering ?? (onScreenText == null ? "none" : "omni-native")).trim().toLowerCase();
    if (!TEXT_RENDERING_MODES.has(textRendering)) throw new Error(`scenes[${indice}].textRendering inválido: ${textRendering}.`);
    if (onScreenText == null && textRendering !== "none") throw new Error(`scenes[${indice}].textRendering exige onScreenText.`);
    if (onScreenText != null && textRendering === "none") throw new Error(`scenes[${indice}].onScreenText exige textRendering omni-native ou local-gc.`);
    const generationTask = cena?.generationTask == null ? task : texto(cena.generationTask, `scenes[${indice}].generationTask`);
    if (!TASKS.has(generationTask)) throw new Error(`scenes[${indice}].generationTask desconhecida: ${generationTask}.`);
    const sceneReferences = referencias(cena?.references, `scenes[${indice}].references`);
    if (generationTask === "text_to_video" && sceneReferences.length > 0) {
      throw new Error(`scenes[${indice}].generationTask text_to_video não aceita referências.`);
    }
    return {
      id: cena?.id == null ? `cena-${indice + 1}` : texto(cena.id, `scenes[${indice}].id`),
      prompt: texto(cena?.prompt, `scenes[${indice}].prompt`),
      duration,
      generationTask,
      onScreenText,
      textRendering,
      references: sceneReferences,
    };
  });

  // Cada kind tem uma forma só. Aceitar as duas ao mesmo tempo esconderia qual
  // motor vai rodar, e é justamente isso que a receita existe para deixar claro.
  if (kind === "filme") {
    if (!scenes.length) throw new Error("kind filme exige pelo menos uma cena.");
    if (parts.length) throw new Error("kind filme não aceita parts; use scenes.");
    if (matrix.length) throw new Error("kind filme não aceita matrix.");
  } else {
    if (!parts.length) throw new Error(`kind ${kind} exige pelo menos uma part.`);
    if (scenes.length) throw new Error(`kind ${kind} não aceita scenes; use parts.`);
    if (kind === "peca") {
      if (parts.length > 1) throw new Error("kind peca aceita exatamente uma part; use kind lote para várias.");
      if (matrix.length) throw new Error("kind peca não aceita matrix; use kind lote.");
    }
  }

  const idsDeVariavel = new Set(variables.map((v) => v.id));
  const textos = [...parts.map((p) => p.prompt), ...scenes.map((s) => s.prompt)];
  for (const conteudo of textos) {
    for (const nome of variaveisUsadas(conteudo)) {
      if (!idsDeVariavel.has(nome)) {
        throw new Error(`O texto usa {{${nome}}}, que não está declarado em variables.`);
      }
    }
  }
  if (idsDeVariavel.size && !matrix.length && kind === "lote") {
    throw new Error("A receita declara variables mas não tem matrix: não há valores para preencher.");
  }

  const targetDurationSeconds = bruta.targetDurationSeconds == null ? null : Number(bruta.targetDurationSeconds);
  if (targetDurationSeconds != null && (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds < 4 || targetDurationSeconds > 120)) {
    throw new Error("targetDurationSeconds deve ser inteiro entre 4 e 120 segundos.");
  }
  if (targetDurationSeconds != null && kind === "filme") {
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    if (total !== targetDurationSeconds) {
      throw new Error(`A duração das scenes (${total}s) deve ser exatamente targetDurationSeconds (${targetDurationSeconds}s).`);
    }
  }

  const rawAudio = bruta.audio ?? {};
  const rawNarration = rawAudio.narration;
  const narrationSpec = rawNarration && typeof rawNarration === "object" && !Array.isArray(rawNarration)
    ? {
        provider: rawNarration.provider == null ? "google-vids" : texto(rawNarration.provider, "audio.narration.provider"),
        text: texto(rawNarration.text, "audio.narration.text"),
        voice: rawNarration.voice == null ? (rawNarration.provider === "omni" ? "Charon" : "Nyla") : texto(rawNarration.voice, "audio.narration.voice"),
        documentUrl: rawNarration.documentUrl == null ? null : texto(rawNarration.documentUrl, "audio.narration.documentUrl"),
        newScene: rawNarration.newScene !== false,
        fallbackProvider: rawNarration.fallbackProvider == null ? (rawNarration.provider === "omni" ? null : "omni") : texto(rawNarration.fallbackProvider, "audio.narration.fallbackProvider"),
        fallbackPolicy: rawNarration.fallbackPolicy == null ? "manual-after-preflight-failure" : texto(rawNarration.fallbackPolicy, "audio.narration.fallbackPolicy"),
        readingDirection: rawNarration.readingDirection == null ? null : String(rawNarration.readingDirection),
        model: rawNarration.model == null ? null : texto(rawNarration.model, "audio.narration.model"),
        sync: rawNarration.sync == null ? "whisper-word-timestamps" : texto(rawNarration.sync, "audio.narration.sync"),
        whisperModel: rawNarration.whisperModel == null ? "small" : texto(rawNarration.whisperModel, "audio.narration.whisperModel"),
        language: rawNarration.language == null ? "pt" : texto(rawNarration.language, "audio.narration.language"),
        blocks: lista(rawNarration.blocks, "audio.narration.blocks").map((block, index) => ({
          id: block?.id == null ? `bloco-${index + 1}` : texto(block.id, `audio.narration.blocks[${index}].id`),
          text: texto(block?.text, `audio.narration.blocks[${index}].text`),
          ...(block?.direction == null ? {} : { direction: texto(block.direction, `audio.narration.blocks[${index}].direction`) }),
          ...(block?.voice == null ? {} : { voice: texto(block.voice, `audio.narration.blocks[${index}].voice`) }),
          ...(block?.seconds == null ? {} : { seconds: Number(block.seconds) }),
        })),
        humanReview: rawNarration.humanReview !== false,
      }
    : null;
  if (narrationSpec) {
    if (!NARRATION_PROVIDERS.has(narrationSpec.provider)) throw new Error(`audio.narration.provider desconhecido: ${narrationSpec.provider}.`);
    if (narrationSpec.provider === "google-vids") {
      if (!narrationSpec.documentUrl?.startsWith("https://docs.google.com/videos/d/")) throw new Error("audio.narration.documentUrl deve apontar para um documento do Google Vids.");
      narrationSpec.voice = resolveGoogleVidsVoice(narrationSpec.voice ?? "Nyla").name;
      if (narrationSpec.blocks.length === 0) throw new Error("Google Vids exige audio.narration.blocks para vincular as cenas aos timestamps medidos.");
    }
    if (narrationSpec.fallbackProvider != null && narrationSpec.fallbackProvider !== "omni") throw new Error("audio.narration.fallbackProvider deve ser omni ou null.");
    if (!NARRATION_FALLBACK_POLICIES.has(narrationSpec.fallbackPolicy)) throw new Error(`audio.narration.fallbackPolicy desconhecido: ${narrationSpec.fallbackPolicy}.`);
    if (!NARRATION_SYNCS.has(narrationSpec.sync)) throw new Error(`audio.narration.sync desconhecido: ${narrationSpec.sync}.`);
    const blockIds = new Set();
    for (const [index, block] of narrationSpec.blocks.entries()) {
      if (blockIds.has(block.id)) throw new Error(`audio.narration.blocks contém id duplicado: ${block.id}.`);
      blockIds.add(block.id);
      if (block.seconds != null && (!Number.isFinite(block.seconds) || block.seconds <= 0 || block.seconds > 15)) {
        throw new Error(`audio.narration.blocks[${index}].seconds deve ficar entre 0 e 15.`);
      }
    }
    if ((narrationSpec.provider === "omni" || narrationSpec.fallbackProvider === "omni") && narrationSpec.blocks.length === 0) {
      throw new Error("Narração Omni principal ou de fallback exige ao menos um bloco.");
    }
  }
  const narration = Boolean(rawNarration);
  const musicDurationSeconds = rawAudio.musicDurationSeconds == null
    ? targetDurationSeconds
    : Number(rawAudio.musicDurationSeconds);
  if (musicDurationSeconds != null && (!Number.isInteger(musicDurationSeconds) || musicDurationSeconds < 5 || musicDurationSeconds > 120)) {
    throw new Error("audio.musicDurationSeconds deve ser inteiro entre 5 e 120 segundos.");
  }
  const musicFit = rawAudio.musicFit == null ? "exact" : texto(rawAudio.musicFit, "audio.musicFit");
  if (!MUSIC_FITS.has(musicFit)) throw new Error(`audio.musicFit desconhecido: ${musicFit}.`);
  const musicFadeOutSeconds = rawAudio.musicFadeOutSeconds == null ? 0 : Number(rawAudio.musicFadeOutSeconds);
  if (!Number.isFinite(musicFadeOutSeconds) || musicFadeOutSeconds < 0) throw new Error("audio.musicFadeOutSeconds deve ser número não negativo.");

  const rawEnding = bruta.ending;
  const ending = rawEnding == null ? null : {
    preset: rawEnding.preset == null ? "omni-flow-slow-dip-black@1" : texto(rawEnding.preset, "ending.preset"),
    durationPolicy: rawEnding.durationPolicy == null ? "narration-end-plus-tail" : texto(rawEnding.durationPolicy, "ending.durationPolicy"),
    tailAfterNarrationSeconds: rawEnding.tailAfterNarrationSeconds == null ? 6 : Number(rawEnding.tailAfterNarrationSeconds),
    dipToBlackSeconds: rawEnding.dipToBlackSeconds == null ? 3 : Number(rawEnding.dipToBlackSeconds),
    audioFadeOutSeconds: rawEnding.audioFadeOutSeconds == null ? 3 : Number(rawEnding.audioFadeOutSeconds),
    omniBaseGainDb: rawEnding.omniBaseGainDb == null ? 5 : Number(rawEnding.omniBaseGainDb),
    omniTailGainDb: rawEnding.omniTailGainDb == null ? 3.5 : Number(rawEnding.omniTailGainDb),
    omniTailRiseSeconds: rawEnding.omniTailRiseSeconds == null ? 0.52 : Number(rawEnding.omniTailRiseSeconds),
    flowContinuation: rawEnding.flowContinuation == null ? "provider-original" : texto(rawEnding.flowContinuation, "ending.flowContinuation"),
    visualContinuation: rawEnding.visualContinuation == null ? "last-omni-original" : texto(rawEnding.visualContinuation, "ending.visualContinuation"),
    sourceTailSceneId: texto(rawEnding.sourceTailSceneId, "ending.sourceTailSceneId"),
    insufficientRemainderPolicy: rawEnding.insufficientRemainderPolicy == null ? "fail" : texto(rawEnding.insufficientRemainderPolicy, "ending.insufficientRemainderPolicy"),
    fadeColor: rawEnding.fadeColor == null ? "#000000" : texto(rawEnding.fadeColor, "ending.fadeColor"),
  };
  if (ending) {
    if (kind !== "filme") throw new Error("ending só é aceito em kind filme.");
    if (!rawAudio.narration || !rawAudio.music) throw new Error("ending exige narração e trilha na receita.");
    if (!ENDING_PRESETS.has(ending.preset)) throw new Error(`ending.preset desconhecido: ${ending.preset}.`);
    if (ending.durationPolicy !== "narration-end-plus-tail") throw new Error("ending.durationPolicy deve ser narration-end-plus-tail.");
    if (!Number.isFinite(ending.tailAfterNarrationSeconds) || ending.tailAfterNarrationSeconds <= 0 || ending.tailAfterNarrationSeconds > 15) throw new Error("ending.tailAfterNarrationSeconds deve ficar entre 0 e 15.");
    for (const key of ["dipToBlackSeconds", "audioFadeOutSeconds", "omniTailRiseSeconds"]) {
      if (!Number.isFinite(ending[key]) || ending[key] <= 0 || ending[key] > ending.tailAfterNarrationSeconds) throw new Error(`ending.${key} deve ser positivo e não exceder ending.tailAfterNarrationSeconds.`);
    }
    for (const key of ["omniBaseGainDb", "omniTailGainDb"]) {
      if (!Number.isFinite(ending[key]) || ending[key] < 0 || ending[key] > 12) throw new Error(`ending.${key} deve ficar entre 0 e 12 dB.`);
    }
    if (ending.flowContinuation !== "provider-original") throw new Error("ending.flowContinuation deve ser provider-original.");
    if (ending.visualContinuation !== "last-omni-original") throw new Error("ending.visualContinuation deve ser last-omni-original.");
    if (ending.insufficientRemainderPolicy !== "fail") throw new Error("ending.insufficientRemainderPolicy deve ser fail; o final nunca gera ou repete silenciosamente.");
    if (ending.fadeColor.toLowerCase() !== "#000000") throw new Error("ending.fadeColor deve ser #000000.");
    if (!scenes.some((scene) => scene.id === ending.sourceTailSceneId)) throw new Error(`ending.sourceTailSceneId não corresponde a uma cena: ${ending.sourceTailSceneId}.`);
    const endingNarrationBlocks = narrationSpec?.blocks ?? rawAudio.narrationSpec?.blocks ?? [];
    if (endingNarrationBlocks.some((block) => block.id === ending.sourceTailSceneId)) throw new Error("A cena de cauda do ending não pode possuir bloco de narração.");
  }

  const rawWorkflow = bruta.workflow ?? (kind === "filme" ? {} : null);
  const automaticRetry = rawWorkflow?.automaticRetry !== false;
  const workflow = rawWorkflow == null ? null : {
    narrationSync: rawWorkflow.narrationSync == null ? "whisper-word-timestamps" : texto(rawWorkflow.narrationSync, "workflow.narrationSync"),
    whisperModel: rawWorkflow.whisperModel == null ? narrationSpec?.whisperModel ?? "small" : texto(rawWorkflow.whisperModel, "workflow.whisperModel"),
    omniPostProcess: rawWorkflow.omniPostProcess !== false,
    humanReview: rawWorkflow.humanReview == null ? !automaticRetry : rawWorkflow.humanReview === true,
    completionMode: rawWorkflow.completionMode == null ? (automaticRetry ? "complete" : "pause-for-review") : texto(rawWorkflow.completionMode, "workflow.completionMode"),
    wallTargetSeconds: rawWorkflow.wallTargetSeconds == null ? 300 : Number(rawWorkflow.wallTargetSeconds),
    flowSoftBudgetSeconds: rawWorkflow.flowSoftBudgetSeconds == null ? 90 : Number(rawWorkflow.flowSoftBudgetSeconds),
    streamAlignment: rawWorkflow.streamAlignment !== false,
    musicFit: rawWorkflow.musicFit == null ? musicFit : texto(rawWorkflow.musicFit, "workflow.musicFit"),
    defaultTextRendering: rawWorkflow.defaultTextRendering == null ? "omni-native" : texto(rawWorkflow.defaultTextRendering, "workflow.defaultTextRendering"),
    localGcPolicy: rawWorkflow.localGcPolicy == null ? "explicit-only" : texto(rawWorkflow.localGcPolicy, "workflow.localGcPolicy"),
    alignmentReview: rawWorkflow.alignmentReview == null ? "orthographic-logical" : texto(rawWorkflow.alignmentReview, "workflow.alignmentReview"),
    correctionWhisperModel: rawWorkflow.correctionWhisperModel == null ? "large-v3-turbo" : texto(rawWorkflow.correctionWhisperModel, "workflow.correctionWhisperModel"),
    llmCorrectionContract: rawWorkflow.llmCorrectionContract == null ? "proposal-only-script-bound@1" : texto(rawWorkflow.llmCorrectionContract, "workflow.llmCorrectionContract"),
    narrationTextAuthority: rawWorkflow.narrationTextAuthority == null ? "approved-script-only" : texto(rawWorkflow.narrationTextAuthority, "workflow.narrationTextAuthority"),
    narrationTimestampAuthority: rawWorkflow.narrationTimestampAuthority == null ? "whisper-measured-only" : texto(rawWorkflow.narrationTimestampAuthority, "workflow.narrationTimestampAuthority"),
    graphicsTextBinding: rawWorkflow.graphicsTextBinding == null ? "scene-text-at-validated-word-window@1" : texto(rawWorkflow.graphicsTextBinding, "workflow.graphicsTextBinding"),
    authorizationMode: rawWorkflow.authorizationMode == null ? (automaticRetry ? "production-once" : "per-invocation") : texto(rawWorkflow.authorizationMode, "workflow.authorizationMode"),
    omniResubmit: rawWorkflow.omniResubmit == null ? (automaticRetry ? "evidence-guided-automatic" : "evidence-guided-human") : texto(rawWorkflow.omniResubmit, "workflow.omniResubmit"),
    automaticRetry,
    retryPolicy: rawWorkflow.retryPolicy == null ? (automaticRetry ? "bounded-reconciled@1" : "none") : texto(rawWorkflow.retryPolicy, "workflow.retryPolicy"),
    maxAttempts: rawWorkflow.maxAttempts == null ? 3 : Number(rawWorkflow.maxAttempts),
    automaticCorrections: rawWorkflow.automaticCorrections == null ? automaticRetry : rawWorkflow.automaticCorrections === true,
    acceptedAttemptPolicy: rawWorkflow.acceptedAttemptPolicy == null ? (automaticRetry ? "whisper-pass" : "whisper-pass-and-human-review") : texto(rawWorkflow.acceptedAttemptPolicy, "workflow.acceptedAttemptPolicy"),
  };
  if (workflow && !NARRATION_SYNCS.has(workflow.narrationSync)) throw new Error(`workflow.narrationSync desconhecido: ${workflow.narrationSync}.`);
  if (workflow && !MUSIC_FITS.has(workflow.musicFit)) throw new Error(`workflow.musicFit desconhecido: ${workflow.musicFit}.`);
  if (workflow && workflow.defaultTextRendering !== "omni-native") throw new Error("workflow.defaultTextRendering deve ser omni-native; GC local é somente exceção explícita por cena.");
  if (workflow && workflow.localGcPolicy !== "explicit-only") throw new Error("workflow.localGcPolicy deve ser explicit-only.");
  if (workflow && !ALIGNMENT_REVIEWS.has(workflow.alignmentReview)) throw new Error(`workflow.alignmentReview desconhecido: ${workflow.alignmentReview}.`);
  if (workflow && workflow.correctionWhisperModel !== "large-v3-turbo") throw new Error("workflow.correctionWhisperModel deve ser large-v3-turbo para confirmar uma divergência antes do reenvio.");
  if (workflow && workflow.llmCorrectionContract !== "proposal-only-script-bound@1") throw new Error("workflow.llmCorrectionContract deve ser proposal-only-script-bound@1.");
  if (workflow && workflow.narrationTextAuthority !== "approved-script-only") throw new Error("workflow.narrationTextAuthority deve ser approved-script-only.");
  if (workflow && workflow.narrationTimestampAuthority !== "whisper-measured-only") throw new Error("workflow.narrationTimestampAuthority deve ser whisper-measured-only.");
  if (workflow && workflow.graphicsTextBinding !== "scene-text-at-validated-word-window@1") throw new Error("workflow.graphicsTextBinding deve ser scene-text-at-validated-word-window@1.");
  if (workflow && !OMNI_RESUBMIT_POLICIES.has(workflow.omniResubmit)) throw new Error(`workflow.omniResubmit desconhecido: ${workflow.omniResubmit}.`);
  if (workflow && !AUTHORIZATION_MODES.has(workflow.authorizationMode)) throw new Error(`workflow.authorizationMode desconhecido: ${workflow.authorizationMode}.`);
  if (workflow && !RETRY_POLICIES.has(workflow.retryPolicy)) throw new Error(`workflow.retryPolicy desconhecido: ${workflow.retryPolicy}.`);
  if (workflow && (!Number.isInteger(workflow.maxAttempts) || workflow.maxAttempts < 1 || workflow.maxAttempts > 3)) throw new Error("workflow.maxAttempts deve ficar entre 1 e 3.");
  if (workflow?.automaticRetry && (workflow.authorizationMode !== "production-once" || workflow.retryPolicy !== "bounded-reconciled@1")) {
    throw new Error("workflow.automaticRetry exige authorizationMode production-once e retryPolicy bounded-reconciled@1.");
  }
  if (workflow?.automaticCorrections && !workflow.automaticRetry) throw new Error("workflow.automaticCorrections exige automaticRetry.");
  if (workflow && !ACCEPTED_ATTEMPT_POLICIES.has(workflow.acceptedAttemptPolicy)) throw new Error(`workflow.acceptedAttemptPolicy desconhecido: ${workflow.acceptedAttemptPolicy}.`);
  if (workflow && !new Set(["complete", "pause-for-review"]).has(workflow.completionMode)) throw new Error(`workflow.completionMode desconhecido: ${workflow.completionMode}.`);
  if (workflow && workflow.completionMode === "complete" && (workflow.authorizationMode !== "production-once" || workflow.humanReview)) {
    throw new Error("workflow.completionMode complete exige authorizationMode production-once e humanReview false.");
  }
  if (workflow && (!Number.isInteger(workflow.wallTargetSeconds) || workflow.wallTargetSeconds < 60 || workflow.wallTargetSeconds > 1800)) throw new Error("workflow.wallTargetSeconds deve ficar entre 60 e 1800.");
  if (workflow && (!Number.isInteger(workflow.flowSoftBudgetSeconds) || workflow.flowSoftBudgetSeconds < 30 || workflow.flowSoftBudgetSeconds > workflow.wallTargetSeconds)) throw new Error("workflow.flowSoftBudgetSeconds deve ficar entre 30 e wallTargetSeconds.");
  const resources = lista(bruta.resources, "resources").map((resource, index) => texto(resource, `resources[${index}]`));

  const parallel = bruta.parallel == null ? 3 : Number(bruta.parallel);
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 8) {
    throw new Error("parallel deve ser inteiro entre 1 e 8.");
  }
  const fps = bruta.assembly?.fps == null ? 24 : Number(bruta.assembly.fps);
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error("assembly.fps deve ser inteiro entre 1 e 60.");

  return {
    schema: RECIPE_SCHEMA,
    id: slug(bruta.id, "id"),
    label: texto(bruta.label, "label"),
    description: bruta.description == null ? null : String(bruta.description),
    kind,
    aspect,
    style: bruta.style == null || String(bruta.style).trim() === "" ? null : String(bruta.style).trim(),
    collection: slug(bruta.collection, "collection"),
    task,
    model: bruta.model == null ? null : texto(bruta.model, "model"),
    variables,
    matrix,
    parts,
    scenes,
    audio: {
      music: Boolean(rawAudio.music),
      musicPreset: rawAudio.musicPreset == null ? null : String(rawAudio.musicPreset),
      musicIntent: rawAudio.musicIntent == null ? null : String(rawAudio.musicIntent),
      musicDurationSeconds,
      musicFit,
      musicFadeOutSeconds,
      narration,
      narrationSpec,
    },
    workflow,
    ending,
    targetDurationSeconds,
    resources,
    qa: {
      structural: Boolean(bruta.qa?.structural),
      expectedDuration: bruta.qa?.expectedDuration == null
        ? (ending ? null : targetDurationSeconds)
        : Number(bruta.qa.expectedDuration),
    },
    assembly: { fps },
    parallel,
  };
}

/**
 * Quantos vídeos esta receita produz. Serve para a tela dizer antes de gerar.
 *
 * Sempre valida antes de contar. A primeira versão tentava pular a validação
 * quando a receita "parecia normalizada" (tinha schema e collection) — mas uma
 * receita crua também tem esses dois campos, e a conta batia em `parts`
 * indefinido. Validar é puro e barato; adivinhar não valia o risco.
 */
export function contarSaidas(bruta) {
  const receita = validarReceita(bruta);
  if (receita.kind === "filme") return receita.scenes.length;
  return receita.parts.length * (receita.matrix.length || 1);
}

function nomeDoItem(parte, indice) {
  if (parte.name) return parte.name;
  return `parte-${String(indice + 1).padStart(3, "0")}`;
}

/**
 * Compila para o executor durável de lote (`batch-job@4`).
 * Cada linha da matriz multiplica as parts, na ordem: linha 1 × todas as parts,
 * linha 2 × todas as parts, e assim por diante.
 */
/** @returns {CompiladoLote} */
function compilarLote(receita, colecao) {
  const linhas = receita.matrix.length ? receita.matrix : [{}];
  const items = [];
  for (const [indiceLinha, valores] of linhas.entries()) {
    for (const [indiceParte, parte] of receita.parts.entries()) {
      const onde = `parts[${indiceParte}] linha ${indiceLinha + 1}`;
      const sufixoLinha = receita.matrix.length ? `-${String(indiceLinha + 1).padStart(2, "0")}` : "";
      items.push({
        name: `${nomeDoItem(parte, indiceParte)}${sufixoLinha}`,
        prompt: aplicarVariaveis(parte.prompt, valores, onde),
        config: {
          mode: receita.style ? "studio" : "raw",
          directionPreset: receita.style,
          aspectRatio: receita.aspect,
          task: receita.task,
          ...(receita.model ? { model: receita.model } : {}),
        },
        references: parte.references,
        techniques: parte.techniques,
      });
    }
  }
  return {
    motor: "lote",
    colecao,
    lote: {
      collection: colecao,
      parallel: receita.parallel,
      defaults: {
        mode: receita.style ? "studio" : "raw",
        directionPreset: receita.style,
        aspectRatio: receita.aspect,
        task: receita.task,
      },
      items,
    },
  };
}

/** Compila para `mkt-videos/film-spec@1`. */
/** @returns {CompiladoFilme} */
function compilarFilme(receita, colecao) {
  if (receita.audio.music && !receita.audio.narration) {
    // O orquestrador só executa a mixagem quando existe narração; sem ela a
    // trilha seria gerada e nunca aplicada ao vídeo. Recusar aqui custa nada;
    // descobrir depois custa uma geração paga.
    throw new Error(
      "Trilha em kind filme depende de narração: sem ela o orquestrador não mixa e a música não chega ao vídeo. "
      + "Aplique a trilha pela via separada de mux-audio.",
    );
  }
  return {
    motor: "filme",
    colecao,
    filmSpec: {
      schema: "mkt-videos/film-spec@1",
      name: colecao,
      aspect: receita.aspect,
      style: receita.style,
      scenes: receita.scenes.map((cena) => ({
        id: cena.id,
        prompt: cena.prompt,
        duration: cena.duration,
        generationTask: cena.generationTask,
        onScreenText: cena.onScreenText,
        textRendering: cena.textRendering,
        references: cena.references.map(({ source, relPath }) => ({ source, relPath })),
      })),
      music: receita.audio.music
        ? {
            mode: "generated",
            backend: "flow-music",
            intent: receita.audio.musicIntent ?? "",
            prompt: receita.audio.musicIntent ?? "",
            preset: ["institucional", "tenso", "epico", "caloroso"].includes(receita.audio.musicPreset) ? receita.audio.musicPreset : null,
            fit: "exact",
            durationSeconds: receita.audio.musicDurationSeconds,
            tailSeconds: receita.audio.musicFadeOutSeconds,
          }
        : null,
      narration: receita.audio.narrationSpec
        ? {
            provider: receita.audio.narrationSpec.provider,
            text: receita.audio.narrationSpec.text,
            voice: receita.audio.narrationSpec.voice,
            documentUrl: receita.audio.narrationSpec.documentUrl,
            newScene: receita.audio.narrationSpec.newScene,
            fallbackProvider: receita.audio.narrationSpec.fallbackProvider,
            fallbackPolicy: receita.audio.narrationSpec.fallbackPolicy,
            readingDirection: receita.audio.narrationSpec.readingDirection,
            model: receita.audio.narrationSpec.model,
            blocks: receita.audio.narrationSpec.blocks,
          }
        : null,
      alignment: receita.audio.narrationSpec
        ? {
            provider: "whisper-local",
            sync: receita.audio.narrationSpec.sync,
            model: receita.audio.narrationSpec.whisperModel,
            language: receita.audio.narrationSpec.language,
            humanReview: receita.workflow?.humanReview ?? receita.audio.narrationSpec.humanReview,
          }
        : null,
      captions: null,
      workflow: receita.workflow,
      ending: receita.ending,
      resources: receita.resources,
      qa: receita.qa.structural
        ? { enabled: true, semantic: false, expectedDuration: receita.qa.expectedDuration }
        : false,
      assembly: { fps: receita.assembly.fps },
    },
  };
}

/**
 * Traduz uma receita para a entrada do executor correspondente.
 *
 * @param {object} bruta receita@1
 * @param {{ sufixoColecao?: string }} opcoes O sufixo entra por fora porque o
 *   compilador é puro: quem chama decide se a coleção é `nome`, `nome-0007` ou
 *   `nome-2026-08-08`, e o teste consegue afirmar o resultado exato.
 * @returns {ReceitaCompilada}
 */
export function compilarReceita(bruta, { sufixoColecao = "" } = {}) {
  const receita = validarReceita(bruta);
  const sufixo = String(sufixoColecao ?? "").trim();
  if (sufixo && !SLUG.test(sufixo)) {
    throw new Error(`sufixoColecao deve usar apenas letras minúsculas, números e hífen: recebeu "${sufixo}".`);
  }
  const colecao = sufixo ? `${receita.collection}-${sufixo}` : receita.collection;
  const compilado = receita.kind === "filme" ? compilarFilme(receita, colecao) : compilarLote(receita, colecao);
  return { ...compilado, receita, saidas: contarSaidas(receita) };
}
