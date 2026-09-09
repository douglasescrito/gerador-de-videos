import { operationFingerprint } from "./pipeline-operation.mjs";

export const LLM_ALIGNMENT_REQUEST_SCHEMA = "mkt-videos/llm-alignment-request@1";
export const LLM_ALIGNMENT_PROPOSAL_SCHEMA = "mkt-videos/llm-alignment-proposal@1";
export const GRAPHICS_TEXT_PLAN_SCHEMA = "mkt-videos/graphics-text-plan@1";
export const CANONICAL_WORD_TIMELINE_SCHEMA = "mkt-videos/canonical-word-timeline@1";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return clean(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index, ...Array(b.length).fill(0)]);
  for (let column = 0; column <= b.length; column += 1) rows[0][column] = column;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - rows[a.length][b.length] / Math.max(a.length, b.length);
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} inválido.`);
  return number;
}

function scriptTokens(script) {
  return clean(script).split(/\s+/).map((text, index) => ({ index, text, normalized: normalized(text) })).filter((entry) => entry.normalized);
}

function measuredTokens(words) {
  if (!Array.isArray(words) || words.length === 0) throw new Error("A correção LLM exige palavras medidas pelo Whisper.");
  return words.map((word, index) => {
    const text = clean(word?.word ?? word?.text);
    const start = finite(word?.start, `Início da palavra medida ${index}`);
    const end = finite(word?.end, `Fim da palavra medida ${index}`);
    if (!text || end < start) throw new Error(`Palavra medida ${index} inválida.`);
    return { index, text, normalized: normalized(text), start, end, ...(Number.isFinite(Number(word?.probability)) ? { probability: Number(word.probability) } : {}) };
  });
}

function requestCore({ blockId, script, transcript = null, words }) {
  const canonical = scriptTokens(script);
  if (!canonical.length) throw new Error("A correção LLM exige roteiro canônico não vazio.");
  const measured = measuredTokens(words);
  return {
    schema: LLM_ALIGNMENT_REQUEST_SCHEMA,
    blockId: clean(blockId),
    authority: {
      text: "approved-script-only",
      timestamps: "whisper-measured-only",
      llm: "proposal-only",
    },
    script: clean(script),
    transcript: transcript == null ? null : clean(transcript),
    canonicalTokens: canonical,
    measuredTokens: measured,
  };
}

export function buildLlmAlignmentRequest(input) {
  const core = requestCore(input ?? {});
  if (!core.blockId) throw new Error("A correção LLM exige blockId.");
  return { ...core, fingerprint: operationFingerprint(core) };
}

function integer(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} inválido.`);
  return number;
}

function assertOnlyKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length) throw new Error(`${label} contém campos não autorizados: ${extras.join(", ")}.`);
}

/**
 * Valida uma proposta de LLM sem conceder autoridade ao modelo.
 *
 * A proposta contém somente índices. Texto e timestamps são reconstruídos das
 * duas fontes canônicas, portanto nem prompt injection nem alucinação do LLM
 * conseguem inserir palavras ou inventar tempo no material enviado ao Omni.
 */
export function applyLlmAlignmentProposal({ request, proposal } = {}) {
  if (request?.schema !== LLM_ALIGNMENT_REQUEST_SCHEMA) throw new Error(`Request exige schema ${LLM_ALIGNMENT_REQUEST_SCHEMA}.`);
  if (proposal?.schema !== LLM_ALIGNMENT_PROPOSAL_SCHEMA) throw new Error(`Proposta exige schema ${LLM_ALIGNMENT_PROPOSAL_SCHEMA}.`);
  assertOnlyKeys(proposal, new Set(["schema", "requestFingerprint", "model", "assignments"]), "Proposta LLM");
  if (proposal.requestFingerprint !== request.fingerprint) throw new Error("Proposta LLM não pertence a este roteiro/transcrição.");
  if (!Array.isArray(proposal.assignments)) throw new Error("Proposta LLM exige assignments.");

  const assignments = [...proposal.assignments].sort((a, b) => Number(a.scriptTokenIndex) - Number(b.scriptTokenIndex));
  if (assignments.length !== request.canonicalTokens.length) throw new Error("Proposta LLM deve cobrir todos os tokens do roteiro exatamente uma vez.");
  const usedMeasured = new Set();
  let previousMeasured = -1;
  const words = assignments.map((assignment, position) => {
    assertOnlyKeys(assignment, new Set(["scriptTokenIndex", "measuredTokenIndexes", "reason"]), `assignments[${position}]`);
    const scriptTokenIndex = integer(assignment?.scriptTokenIndex, `assignments[${position}].scriptTokenIndex`);
    if (scriptTokenIndex !== position) throw new Error("Proposta LLM alterou ou reordenou os tokens do roteiro.");
    if (!Array.isArray(assignment.measuredTokenIndexes) || assignment.measuredTokenIndexes.length === 0) {
      throw new Error(`Token canônico ${position} não possui timestamp medido.`);
    }
    const indexes = assignment.measuredTokenIndexes.map((value, index) => integer(value, `assignments[${position}].measuredTokenIndexes[${index}]`));
    for (let index = 0; index < indexes.length; index += 1) {
      const measuredIndex = indexes[index];
      if (measuredIndex >= request.measuredTokens.length) throw new Error(`Índice Whisper ${measuredIndex} fora da medição.`);
      if (usedMeasured.has(measuredIndex)) throw new Error(`Índice Whisper ${measuredIndex} foi reutilizado.`);
      if (measuredIndex <= previousMeasured || (index > 0 && measuredIndex !== indexes[index - 1] + 1)) {
        throw new Error("Proposta LLM precisa preservar ordem e contiguidade dos timestamps.");
      }
      usedMeasured.add(measuredIndex);
      previousMeasured = measuredIndex;
    }
    const sources = indexes.map((index) => request.measuredTokens[index]);
    const canonical = request.canonicalTokens[scriptTokenIndex];
    const spoken = sources.map((source) => source.normalized).join("");
    const lexicalSimilarity = similarity(canonical.normalized, spoken);
    if (lexicalSimilarity < 0.75) {
      throw new Error(`Proposta LLM tentou vincular texto divergente no token ${scriptTokenIndex}.`);
    }
    return {
      word: canonical.text,
      start: sources[0].start,
      end: sources.at(-1).end,
      measuredTokenIndexes: indexes,
      transcribed: sources.map((source) => source.text).join(""),
      lexicalSimilarity: Math.round(lexicalSimilarity * 100) / 100,
      ...(sources.every((source) => source.probability != null) ? { probability: Math.min(...sources.map((source) => source.probability)) } : {}),
    };
  });
  if (usedMeasured.size !== request.measuredTokens.length) throw new Error("Proposta LLM omitiu palavra medida; correção sem cobertura integral é proibida.");

  const binding = {
    schema: CANONICAL_WORD_TIMELINE_SCHEMA,
    blockId: request.blockId,
    textAuthority: "approved-script-only",
    timestampAuthority: "whisper-measured-only",
    llmAuthority: "proposal-only",
    requestFingerprint: request.fingerprint,
    proposalFingerprint: operationFingerprint(proposal),
    script: request.script,
    words,
  };
  return { ...binding, fingerprint: operationFingerprint(binding) };
}

/**
 * Converte o plano semântico do LLM em janelas gráficas verificáveis.
 * O modelo escolhe apenas índices do cronograma; o texto vem da cena e os
 * tempos vêm das palavras canônicas já vinculadas ao Whisper.
 */
export function bindGraphicsTextPlan({ scenes, words, proposal, timelineFingerprint } = {}) {
  if (proposal?.schema !== GRAPHICS_TEXT_PLAN_SCHEMA) throw new Error(`Plano gráfico exige schema ${GRAPHICS_TEXT_PLAN_SCHEMA}.`);
  assertOnlyKeys(proposal, new Set(["schema", "timelineFingerprint", "model", "bindings"]), "Plano gráfico");
  if (!clean(timelineFingerprint) || proposal.timelineFingerprint !== timelineFingerprint) throw new Error("Plano gráfico não pertence a esta timeline canônica.");
  if (!Array.isArray(scenes) || !Array.isArray(words) || !Array.isArray(proposal.bindings)) throw new Error("Plano gráfico incompleto.");
  const byScene = new Map(proposal.bindings.map((entry, index) => {
    assertOnlyKeys(entry, new Set(["sceneId", "startWordIndex", "endWordIndex", "reason"]), `bindings[${index}]`);
    return [clean(entry.sceneId), entry];
  }));
  return scenes.map((scene, index) => {
    const sceneId = clean(scene?.id);
    const exactText = clean(scene?.onScreenText ?? scene?.expectedText);
    if (!exactText) return { sceneId, text: null, binding: null };
    const selected = byScene.get(sceneId);
    if (!selected) throw new Error(`O LLM não vinculou o texto gráfico da cena ${sceneId}.`);
    const startWordIndex = integer(selected.startWordIndex, `${sceneId}.startWordIndex`);
    const endWordIndex = integer(selected.endWordIndex, `${sceneId}.endWordIndex`);
    if (endWordIndex < startWordIndex || endWordIndex >= words.length) throw new Error(`Janela gráfica inválida para ${sceneId}.`);
    const first = words[startWordIndex];
    const last = words[endWordIndex];
    if (!first || !last) throw new Error(`Janela gráfica sem timestamps para ${sceneId}.`);
    return {
      sceneId,
      text: exactText,
      binding: {
        start: finite(first.start, `${sceneId}.start`),
        end: finite(last.end, `${sceneId}.end`),
        startWordIndex,
        endWordIndex,
        textAuthority: "scene-spec-only",
        timestampAuthority: "canonical-word-timeline-only",
      },
    };
  });
}

export function withVerifiedGraphicsText(prompt, graphicsBinding) {
  if (!graphicsBinding?.text || !graphicsBinding?.binding) return String(prompt ?? "");
  const { start, end } = graphicsBinding.binding;
  if (graphicsBinding.binding.textAuthority !== "scene-spec-only") throw new Error("Texto gráfico não veio da especificação canônica da cena.");
  if (graphicsBinding.binding.timestampAuthority !== "canonical-word-timeline-only") throw new Error("Tempo gráfico não veio da timeline canônica de palavras.");
  finite(start, "Início do texto gráfico");
  finite(end, "Fim do texto gráfico");
  if (end < start) throw new Error("Janela do texto gráfico é inválida.");
  return `${String(prompt ?? "").trim()}\n\nVERIFIED GRAPHICS TEXT BINDING\nRender only the exact text "${graphicsBinding.text}". Begin its authored reveal at ${start.toFixed(3)}s and keep the graphic action bound to the measured narration window ending at ${end.toFixed(3)}s. The text is copied from the approved scene specification; the timing is derived from Whisper measurements through a validated canonical-word binding. Do not rewrite, translate, omit, replace, or invent text. Do not infer alternate timestamps.`;
}

export function bindExactGraphicsTextToLocalWords({ scene, binding } = {}) {
  const exactText = clean(scene?.onScreenText ?? scene?.expectedText);
  const sceneId = clean(scene?.id);
  if (!exactText) return { sceneId, text: null, binding: null };
  if (!binding || !Array.isArray(binding.words)) throw new Error(`Cena ${sceneId || "sem-id"} não possui janela local de palavras.`);
  const normalized = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
  const expected = exactText.split(/\s+/).map(normalized).filter(Boolean);
  const measured = binding.words.map((word) => normalized(word.word));
  let startIndex = -1;
  for (let index = 0; index <= measured.length - expected.length; index += 1) {
    if (expected.every((token, offset) => measured[index + offset] === token)) {
      startIndex = index;
      break;
    }
  }
  if (startIndex < 0) throw new Error(`Texto gráfico exato da cena ${sceneId} não foi encontrado na janela local da locução.`);
  const endIndex = startIndex + expected.length - 1;
  return {
    sceneId,
    text: exactText,
    binding: {
      start: finite(binding.words[startIndex].start, `${sceneId}.start`),
      end: finite(binding.words[endIndex].end, `${sceneId}.end`),
      startWordIndex: binding.words[startIndex].wordIndex,
      endWordIndex: binding.words[endIndex].wordIndex,
      textAuthority: "scene-spec-only",
      timestampAuthority: "canonical-word-timeline-only",
    },
  };
}

/**
 * Converte a timeline global da locução em janelas locais consecutivas. O Omni
 * recebe um clipe por janela, portanto 23.400 s no master precisa virar 3.400 s
 * no terceiro clipe de dez segundos. O texto continua vindo do roteiro já
 * alinhado; apenas os tempos medidos são deslocados.
 */
export function remapCanonicalWordsToClipWindows({ words, scenes } = {}) {
  const measured = measuredTokens(words);
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("O remapeamento exige cenas.");
  let clipOrigin = 0;
  const bindings = scenes.map((scene, sceneIndex) => {
    const sceneId = clean(scene?.id) || `cena-${sceneIndex + 1}`;
    const clipDuration = Number(scene?.expectedDuration ?? scene?.duration ?? 10);
    if (!Number.isFinite(clipDuration) || clipDuration <= 0) throw new Error(`Duração do clipe ${sceneId} inválida.`);
    const clipEnd = clipOrigin + clipDuration;
    const selected = measured.filter((word) => word.start >= clipOrigin && word.start < clipEnd);
    const localWords = selected.map((word) => ({
      word: word.text,
      start: Math.round(Math.max(0, word.start - clipOrigin) * 1000) / 1000,
      end: Math.round(Math.min(clipDuration, Math.max(word.start, word.end) - clipOrigin) * 1000) / 1000,
      globalStart: word.start,
      globalEnd: word.end,
      wordIndex: word.index,
      ...(word.probability == null ? {} : { probability: word.probability }),
    }));
    const first = localWords[0] ?? null;
    const last = localWords.at(-1) ?? null;
    const binding = {
      start: first?.start ?? 0,
      end: last?.end ?? 0,
      startWordIndex: first?.wordIndex ?? null,
      endWordIndex: last?.wordIndex ?? null,
      globalStart: first?.globalStart ?? clipOrigin,
      globalEnd: last?.globalEnd ?? clipOrigin,
      clipOrigin,
      clipDuration,
      words: localWords,
      textAuthority: "scene-spec-only",
      timestampAuthority: "canonical-word-timeline-only",
      remapping: "global-minus-clip-origin@1",
    };
    clipOrigin = clipEnd;
    return { sceneId, binding };
  });
  const uncovered = measured.filter((word) => word.start >= clipOrigin);
  if (uncovered.length) {
    throw new Error(`A locução excede a janela visual em ${uncovered.length} palavra(s); aumente o número de clipes antes de gerar.`);
  }
  return bindings;
}

export function withVerifiedLocalWordTimeline(prompt, binding) {
  if (!binding || !Array.isArray(binding.words)) return String(prompt ?? "");
  const clipDuration = finite(binding.clipDuration, "Duração local do clipe");
  const clipOrigin = finite(binding.clipOrigin, "Origem global do clipe");
  const lines = binding.words.map((word, index) => {
    const start = finite(word.start, `Início local da palavra ${index}`);
    const end = finite(word.end, `Fim local da palavra ${index}`);
    if (end < start || end > clipDuration + 0.001) throw new Error(`Palavra local ${index} não cabe no clipe.`);
    return `- [${start.toFixed(3)}s - ${end.toFixed(3)}s] ${clean(word.word)}`;
  });
  const map = lines.length ? lines.join("\n") : "- no narrated words in this clip";
  return `${String(prompt ?? "").trim()}\n\nVERIFIED LOCAL WORD TIMELINE\nThis Omni clip is exactly ${clipDuration.toFixed(3)} seconds and represents the master narration window ${clipOrigin.toFixed(3)}s through ${(clipOrigin + clipDuration).toFixed(3)}s. Every timestamp below is local to this clip (global timestamp minus clip origin). Use it to place kinetic graphic beats, camera cuts and non-verbal sound accents. The spellings come only from the approved script and the timing comes only from Whisper; do not use Whisper transcript spellings, invent words, or infer alternate times. Timing evidence is not a request to subtitle every word.\n${map}`;
}
