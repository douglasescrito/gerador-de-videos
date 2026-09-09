import { operationFingerprint } from "./pipeline-operation.mjs";
import { materializeTechniques, resolveProductionTechnique } from "./prompt-techniques.mjs";

export const TECHNIQUE_USAGE_SCHEMA = "mkt-videos/production-technique-usage@1";

/** Registra aplicação verificável; não compõe raw nem promove conhecimento. */
export function recordProductionTechniques({ uses = [], changes = [], candidates = [] } = {}) {
  if (![uses, changes, candidates].every(Array.isArray)) throw new Error("Usos, alterações e candidatos devem ser listas.");
  const promptGroups = new Map();
  for (const use of uses) {
    if (resolveProductionTechnique(use.id).kind !== "prompt") continue;
    const key = use.sceneId ?? "production";
    const group = promptGroups.get(key) ?? { task: use.task ?? "reference_to_video", uses: [] };
    if (group.task !== (use.task ?? "reference_to_video")) throw new Error(`Tarefas divergentes para a cena ${key}.`);
    group.uses.push({ id: use.id, values: use.values });
    promptGroups.set(key, group);
  }
  for (const group of promptGroups.values()) materializeTechniques(group.uses, { task: group.task });
  const candidateIds = new Set();
  const recordedCandidates = candidates.map((candidate) => {
    if (!candidate?.id || !candidate.problem?.trim() || !candidate.description?.trim() || !candidate.evidenceRefs?.length) {
      throw new Error("Novidade exige id, problema, descrição e evidências antes de publicar a receita.");
    }
    if (candidateIds.has(candidate.id)) throw new Error(`Candidato duplicado: ${candidate.id}.`);
    candidateIds.add(candidate.id);
    const body = { id: candidate.id, problem: candidate.problem, description: candidate.description, evidenceRefs: [...candidate.evidenceRefs], status: "candidate", authority: "none" };
    return { ...body, hash: operationFingerprint(body) };
  });
  for (const change of changes) {
    if (!change?.candidateId || !candidateIds.has(change.candidateId)) throw new Error("Técnica nova ou alterada sem registro: documentação da produção incompleta.");
  }
  const seen = new Set();
  const recordedUses = uses.map(({ id, values = {}, sceneId = null, prompt = null, task = "reference_to_video" }) => {
    const technique = resolveProductionTechnique(id);
    const key = `${sceneId ?? "production"}:${id}`;
    if (seen.has(key)) throw new Error(`Uso duplicado: ${key}.`);
    seen.add(key);
    if (["concept", "deprecated"].includes(technique.status)) throw new Error(`Uso de ${id} não pode ser registrado como técnica operacional.`);
    let parameters = structuredClone(values);
    let blockHash = null;
    if (technique.kind === "prompt") {
      const [block] = materializeTechniques([{ id, values }], { task });
      if (typeof prompt !== "string" || !prompt.includes(block.text)) throw new Error(`Prompt de ${sceneId} não comprova aplicação de ${id}.`);
      parameters = block.values;
      blockHash = operationFingerprint(block.text);
    } else {
      for (const name of technique.parameters) {
        if (parameters[name] == null) throw new Error(`${id} exige parâmetro ${name}.`);
      }
      for (const name of Object.keys(parameters)) {
        if (!technique.parameters.includes(name)) throw new Error(`${id} não declara parâmetro ${name}.`);
      }
    }
    return { id, kind: technique.kind, sceneId, parameters, blockHash, validationLevel: technique.validationLevel };
  });
  const body = { schema: TECHNIQUE_USAGE_SCHEMA, uses: recordedUses, changes: structuredClone(changes), candidates: recordedCandidates, completeness: "complete", automaticPromotion: false };
  return { ...body, hash: operationFingerprint(body) };
}

/**
 * A forma do insert é decisão de estilo. Enquanto a variante de um registro não
 * estiver catalogada, ela vale `null`: não se registra uso de outra técnica no
 * lugar dela, e o episódio precisa declarar a novidade como candidata.
 */
const INSERT_POR_ESTILO = {
  plantao: "native-semantic-band-insert@1",
  confessional: null,
};

export function documentaryTechniqueUsage({ episode, timeline, sonoras }) {
  const uses = [];
  for (const [index, scene] of episode.sonoras.entries()) {
    const job = sonoras.find((entry) => entry.id === `${episode.colecao}-${scene.cena}`);
    const add = (id, values) => uses.push({ id, values, sceneId: scene.cena, prompt: job?.prompt });
    const style = scene.estilo ?? episode.estilo;
    const idInsert = Object.hasOwn(INSERT_POR_ESTILO, style) ? INSERT_POR_ESTILO[style] : "native-semantic-insert@1";
    if (!scene.semInsert && idInsert) add(idInsert, {
      highlight: scene.destaque, side: scene.interacaoInsert?.lado ?? (index % 2 === 0 ? "right" : "left"),
    });
    if (scene.transicao?.entrada) add("gaze-entry@1", { movement: scene.transicao.entrada });
    if (scene.transicao?.saida) add("gaze-exit@1", { movement: scene.transicao.saida });
  }
  const windows = timeline.cenas.map((scene) => ({ sceneId: scene.clipe, start: scene.inicio, seconds: scene.janela, source: scene.tipo }));
  uses.push({ id: "style-method-separation@1", values: { styleRef: `${episode.estilo ?? "documentario-sobrio"}@1`, invariants: ["native-text", "static-camera", "literal-speech", "official-reference", "clean-ending"] } });
  if (episode.off) {
    uses.push({ id: "exclusive-voices@1", values: { sources: ["audios/off-master.wav", "audios/direto-master.wav"], windows, overlapPolicy: "exclusive" } });
    uses.push({ id: "measured-two-pass-grid@1", values: { measurements: ["metadados/medidas-sonoras.json", "diagnosticos/align-off/palavras-master.json"], targetSeconds: timeline.totalSegundos, margins: { before: 0.35, after: 0.8 }, floors: { art: 4.5, ending: 6 } } });
    uses.push({ id: "dual-voice-qa@1", values: { script: timeline.cenas.map((scene) => scene.frase ?? scene.palavras?.map((word) => word.palavra).join(" ") ?? "").join(" "), windows, transcription: "diagnosticos/qa-align/palavras-master.json", criteria: "word-count-and-window-count; content-and-voice-identity-require-review" } });
  }
  if (episode.trilhas?.length > 1) uses.push({ id: "act-music-crossfade@1", values: { cues: episode.trilhas.map((cue, index) => ({ file: `audios/trilha-${index + 1}.provider.m4a`, until: cue.ate ?? timeline.totalSegundos })), crossfadeSeconds: 2, fadeOutSeconds: 0 } });
  return recordProductionTechniques({ uses, changes: episode.techniqueChanges ?? [], candidates: episode.techniqueCandidates ?? [] });
}
