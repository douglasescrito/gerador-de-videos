import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { composeDirection } from "./direction-presets.mjs";
import { createStageReceipt, operationFingerprint, pathExists, readVerifiedReceipt, replaceJsonAtomic, writeFileAtomic, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { contextualizeQaWarnings, evaluateQaGate, runQa as defaultRunQa } from "./qa.mjs";
import { runProductionPool } from "./production-pool.mjs";
import { withVerifiedGraphicsText, withVerifiedLocalWordTimeline } from "./narration-text-contract.mjs";

export const DRAFT_WORKFLOW_SCHEMA = "mkt-videos/draft-workflow@1";
const EXECUTABLE_DRAFT_TASKS = new Set(["image_to_video", "text_to_video", "reference_to_video", "edit"]);
const stateSaveQueues = new WeakMap();
const humanReplacementQueues = new Map();

function slug(value, fallback = "draft") {
  const normalized = String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized.slice(0, 64) || fallback;
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function resolveReference(baseDirectory, value, label) {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value.relPath ?? value.source?.locator ?? value.locator
    : value;
  const text = requiredText(candidate, label);
  return path.resolve(baseDirectory, text);
}

function nativeTypographyPrompt(prompt, exactText) {
  if (exactText == null) return prompt;
  return `${prompt}\n\nNATIVE TYPOGRAPHY CONTRACT\nRender only the exact text \"${exactText}\" directly inside the generated video pixels as an integral part of the scene. Treat it as authored kinetic typography with deliberate composition, hierarchy, transitions and motion—not as subtitles, captions or a generic lower third. Synchronize its reveal and graphic accents to the narrated idea. Do not create post-render overlays, incidental writing, alternate wording, translations, or extra readable text.`;
}

function externalNarrationAudioPrompt(prompt, graphicsTextBinding) {
  let result = String(prompt ?? "");
  if (!result.includes("EXTERNAL NARRATION AUDIO CONTRACT")) {
    result += "\n\nEXTERNAL NARRATION AUDIO CONTRACT\nThe narration is generated separately and will be added in post. Do not generate, speak, dub, sing or imitate any narration, dialogue, vocalization or intelligible human voice. Generate only designed non-verbal ambience and sound effects that support the motion.";
  }
  const start = Number(graphicsTextBinding?.binding?.start);
  const end = Number(graphicsTextBinding?.binding?.end);
  if (Number.isFinite(start) && Number.isFinite(end) && !result.includes("SYNCHRONIZED SOUND DESIGN WINDOW")) {
    result += `\n\nSYNCHRONIZED SOUND DESIGN WINDOW\nUse precise non-verbal sound accents and kinetic graphic beats around ${start.toFixed(3)}s through ${end.toFixed(3)}s, matching the verified external narration timing. Never synthesize the spoken words.`;
  }
  return result;
}

export function bindDraftNarrationTimings(spec, bindings = []) {
  if (spec?.schema !== "mkt-videos/draft-spec@1") throw new Error("Binding de narração exige draft-spec@1 normalizado.");
  const byScene = new Map(bindings.map((entry) => [String(entry.sceneId), entry.binding]));
  const bound = structuredClone(spec);
  bound.scenes = bound.scenes.map((scene) => {
    const binding = byScene.get(scene.id) ?? null;
    if (!binding) return scene;
    const timedPrompt = withVerifiedLocalWordTimeline(
      withVerifiedGraphicsText(scene.motionPrompt, { sceneId: scene.id, text: scene.expectedText, binding }),
      binding,
    );
    const motionPrompt = scene.audioPolicy === "external-narration-no-voice"
      ? externalNarrationAudioPrompt(timedPrompt, { binding })
      : timedPrompt;
    return {
      ...scene,
      graphicsTextBinding: binding,
      motionPrompt,
      videoComposition: composeDirection({ userPrompt: motionPrompt, style: scene.style }),
    };
  });
  return bound;
}

export function validateDraftSpec(raw, { specFile = null, outputsRoot = null, allowConceptStyle = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Spec de draft inválido.");
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) throw new Error("Spec de draft exige scenes não vazio.");
  const baseDirectory = specFile ? path.dirname(path.resolve(specFile)) : process.cwd();
  const name = slug(raw.name ?? "draft", "draft");
  const aspect = String(raw.aspect ?? "16:9");
  if (!new Set(["16:9", "9:16"]).has(aspect)) throw new Error(`Aspecto inválido: ${aspect}.`);
  const ids = new Set();
  const scenes = raw.scenes.map((scene, index) => {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw new Error(`Cena ${index + 1} inválida.`);
    const id = slug(scene.id ?? `scene-${index + 1}`, `scene-${index + 1}`);
    if (ids.has(id)) throw new Error(`Cena duplicada: ${id}.`);
    ids.add(id);
    const userPrompt = requiredText(scene.prompt, `Cena ${id}.prompt`);
    const motionPrompt = scene.motionPrompt == null ? userPrompt : requiredText(scene.motionPrompt, `Cena ${id}.motionPrompt`);
    const expectedText = scene.onScreenText == null ? null : requiredText(scene.onScreenText, `Cena ${id}.onScreenText`);
    const textRendering = String(scene.textRendering ?? (expectedText == null ? "none" : "omni-native")).trim().toLowerCase();
    if (!new Set(["none", "omni-native", "local-gc"]).has(textRendering)) throw new Error(`Cena ${id}.textRendering inválido: ${textRendering}.`);
    if (expectedText == null && textRendering !== "none") throw new Error(`Cena ${id}.textRendering exige onScreenText.`);
    if (expectedText != null && textRendering === "none") throw new Error(`Cena ${id}.onScreenText exige textRendering omni-native ou local-gc.`);
    const style = scene.style ?? raw.style ?? null;
    const imageComposition = composeDirection({ userPrompt, style, allowConcept: allowConceptStyle });
    const nativeMotionPrompt = textRendering === "omni-native" ? nativeTypographyPrompt(motionPrompt, expectedText) : motionPrompt;
    const graphicsTextBinding = scene.graphicsTextBinding == null ? null : structuredClone(scene.graphicsTextBinding);
    const boundMotionPrompt = graphicsTextBinding == null
      ? nativeMotionPrompt
      : withVerifiedGraphicsText(nativeMotionPrompt, { sceneId: id, text: expectedText, binding: graphicsTextBinding });
    const audioPolicy = String(scene.audioPolicy ?? raw.audioPolicy ?? "provider-default");
    const effectiveMotionPrompt = audioPolicy === "external-narration-no-voice"
      ? externalNarrationAudioPrompt(boundMotionPrompt, graphicsTextBinding)
      : boundMotionPrompt;
    const videoComposition = composeDirection({ userPrompt: effectiveMotionPrompt, style, allowConcept: allowConceptStyle });
    const referenceDescriptors = structuredClone(scene.references ?? []);
    const references = referenceDescriptors.map((value, referenceIndex) => resolveReference(baseDirectory, value, `Cena ${id}.references[${referenceIndex}]`));
    if (references.length > 4) throw new Error(`Cena ${id} aceita no máximo quatro referências.`);
    const generationTask = String(scene.generationTask ?? scene.task ?? "image_to_video").trim().toLowerCase().replaceAll("-", "_");
    if (!EXECUTABLE_DRAFT_TASKS.has(generationTask)) throw new Error(`Cena ${id}.generationTask não é executável neste draft: ${generationTask}.`);
    if (generationTask === "text_to_video" && references.length > 0) throw new Error(`Cena ${id}: text_to_video não aceita referências.`);
    if (generationTask === "image_to_video" && references.length > 2) throw new Error(`Cena ${id}: image_to_video aceita no máximo duas imagens.`);
    if (generationTask === "reference_to_video" && references.length < 1) throw new Error(`Cena ${id}: reference_to_video exige pelo menos uma imagem.`);
    if (generationTask === "edit" && references.length !== 1) throw new Error(`Cena ${id}: edit exige exatamente um vídeo.`);
    return {
      id,
      style: imageComposition.directionPreset,
      userPrompt,
      motionPrompt: effectiveMotionPrompt,
      imageComposition,
      videoComposition,
      references,
      referenceDescriptors,
      referenceAuthorizations: structuredClone(scene.referenceAuthorizations ?? []),
      runtimeInputRoles: structuredClone(scene.runtimeInputRoles ?? referenceDescriptors.map((entry) => entry?.role ?? null)),
      generationTask,
      aspect: String(scene.aspect ?? imageComposition.suggestedAspect ?? aspect),
      imageModel: String(scene.imageModel ?? raw.imageModel ?? "gemini-3-pro-image"),
      imageSize: String(scene.imageSize ?? raw.imageSize ?? "2K"),
      expectedText,
      textRendering,
      graphicsTextBinding,
      audioPolicy,
      expectedDuration: scene.durationHint == null && scene.duration == null ? null : Number(scene.durationHint ?? scene.duration),
    };
  });
  const root = path.resolve(outputsRoot ?? raw.outRoot ?? path.join(process.cwd(), "outputs"), name);
  return { schema: "mkt-videos/draft-spec@1", name, aspect, root, scenes };
}

export function createDraftState(spec, { stateFile = null } = {}) {
  const root = path.resolve(spec.root);
  const statePath = path.resolve(stateFile ?? path.join(root, "metadados", "draft.json"));
  const id = `draft:${operationFingerprint({ name: spec.name, scenes: spec.scenes.map((scene) => ({ id: scene.id, prompt: scene.userPrompt, motion: scene.motionPrompt, style: scene.style, refs: scene.references })) }).slice(0, 24)}`;
  const now = new Date().toISOString();
  const referenceBlockers = spec.scenes.flatMap((scene) => scene.references.flatMap((reference, index) => {
    const authorization = scene.referenceAuthorizations?.[index];
    const ready = /^[a-f0-9]{64}$/u.test(String(authorization?.bindingHash ?? ""))
      && authorization?.rights?.providerInput === "allowed";
    return ready ? [] : [{
      code: "canonical_provider_input_rights_required",
      message: `canonical providerInput rights required: a referência Studio ${scene.id}[${index}] não possui permit canônico.`,
      sceneId: scene.id,
      index,
      reference,
    }];
  }));
  return {
    schema: DRAFT_WORKFLOW_SCHEMA,
    id,
    name: spec.name,
    mode: "studio",
    status: "planned",
    root,
    stateFile: statePath,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, event: "planned" }],
    runtimeReferencePolicy: {
      references: referenceBlockers.map(({ sceneId, index, reference }) => ({ sceneId, index, reference })),
      canonicalProviderInputRightsSatisfied: referenceBlockers.length === 0,
      defaultProviderInputAllowed: false,
      blockers: referenceBlockers,
    },
    scenes: spec.scenes.map((scene) => ({
      ...scene,
      status: "planned",
      keyframeFile: path.join(root, "keyframes", `${scene.id}.${scene.generationTask === "text_to_video" ? "svg" : "png"}`),
      keyframeReceipt: null,
      videoFile: path.join(root, "videos-soltos", `${scene.id}.mp4`),
      videoReceipt: path.join(root, "receitas", `${scene.id}.mp4.receipt.json`),
      interactionId: null,
      attemptId: null,
      fileId: null,
      providerHandle: null,
      error: null,
    })),
  };
}

function escapeSvg(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function wrapCardText(value, maxCharacters = 52, maxLines = 7) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  const consumed = lines.join(" ").length;
  if (consumed < String(value ?? "").trim().length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/u, "")}…`;
  return lines;
}

export async function renderDraftApprovalCard({ scene, outputFile, receiptFile = `${outputFile}.receipt.json`, metadata = {} } = {}) {
  if (scene?.generationTask !== "text_to_video") throw new Error("Cartão determinístico aceita somente text_to_video.");
  const startedAt = new Date();
  const vertical = scene.aspect === "9:16";
  const width = vertical ? 720 : 1280;
  const height = vertical ? 1280 : 720;
  const promptLines = wrapCardText(scene.videoComposition?.effectivePrompt ?? scene.motionPrompt);
  const lineHeight = vertical ? 48 : 40;
  const startY = vertical ? 390 : 285;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#08172f"/>`,
    `<circle cx="${Math.round(width * 0.84)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.18)}" fill="#123d8f" opacity="0.42"/>`,
    `<rect x="${Math.round(width * 0.075)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.85)}" height="${Math.round(height * 0.76)}" rx="28" fill="#0d2347" stroke="#2f73e0" stroke-width="2"/>`,
    `<text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.24)}" fill="#6ba7ff" font-family="Arial, sans-serif" font-size="${vertical ? 28 : 24}" font-weight="700" letter-spacing="4">GERAÇÃO DIRETA · TEXT → VIDEO</text>`,
    `<text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.32)}" fill="#ffffff" font-family="Arial, sans-serif" font-size="${vertical ? 44 : 38}" font-weight="700">${escapeSvg(scene.id)}</text>`,
    ...promptLines.map((line, index) => `<text x="${Math.round(width * 0.12)}" y="${startY + index * lineHeight}" fill="#dce9ff" font-family="Arial, sans-serif" font-size="${vertical ? 29 : 26}">${escapeSvg(line)}</text>`),
    `<text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.82)}" fill="#7e9bc7" font-family="Arial, sans-serif" font-size="${vertical ? 24 : 20}">Aprovar este cartão autoriza o prompt; nenhum keyframe será enviado ao provedor.</text>`,
    `</svg>`,
  ].join("\n");
  await writeFileAtomic(outputFile, svg, { label: "Cartão de aprovação do draft", encoding: "utf8" });
  const artifact = await createArtifactFromFile({ file: outputFile, kind: "image", role: "text-to-video-approval-card", mimeType: "image/svg+xml", source: { provider: "local-deterministic" } });
  const receipt = createStageReceipt({
    operation: "render-text-to-video-approval-card",
    provider: "local-deterministic",
    stage: "draft",
    parameters: { generationTask: scene.generationTask, aspect: scene.aspect, promptFingerprint: operationFingerprint(scene.videoComposition) },
    artifacts: [artifact],
    metadata,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: path.resolve(outputFile), receiptFile: path.resolve(receiptFile), receipt };
}

async function stageDirectInputApproval({ scene, sourceFile, receiptFile, metadata = {} } = {}) {
  const startedAt = new Date();
  const role = scene.generationTask === "edit" ? "reference-video" : "first-frame";
  const artifact = await createArtifactFromFile({
    file: sourceFile,
    kind: scene.generationTask === "edit" ? "video" : "image",
    role,
    source: { provider: "governed-input" },
  });
  const receipt = createStageReceipt({
    operation: "stage-direct-provider-input-approval",
    provider: "local-deterministic",
    stage: "draft",
    parameters: { generationTask: scene.generationTask, inputRole: role, exactBytesPreserved: true, promptFingerprint: operationFingerprint(scene.videoComposition) },
    inputs: [artifact],
    artifacts: [artifact],
    metadata,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: path.resolve(sourceFile), receiptFile: path.resolve(receiptFile), receipt };
}

export async function readDraftState(file) {
  const absolute = path.resolve(String(file));
  const state = JSON.parse(await readFile(absolute, "utf8"));
  if (state?.schema !== DRAFT_WORKFLOW_SCHEMA || !Array.isArray(state.scenes)) throw new Error(`Estado de draft inválido: ${absolute}`);
  return state;
}

async function saveState(state, { initial = false } = {}) {
  const previous = stateSaveQueues.get(state) ?? Promise.resolve();
  const next = previous.then(async () => {
    state.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(state);
    if (initial) await writeJsonAtomic(state.stateFile, snapshot, { label: "Estado de draft" });
    else await replaceJsonAtomic(state.stateFile, snapshot, { label: "Estado de draft" });
  });
  stateSaveQueues.set(state, next.catch(() => {}));
  await next;
}

function event(state, name, details = {}) {
  state.history.push({ at: new Date().toISOString(), event: name, ...details });
}

function refreshStatus(state) {
  const statuses = new Set(state.scenes.map((scene) => scene.status));
  if (state.scenes.some((scene) => scene.qa?.gate?.status === "blocked") || [...statuses].some((value) => value === "ambiguous" || value === "failed")) state.status = "attention_required";
  else if ([...statuses].every((value) => value === "delivered")) state.status = "delivered";
  else if ([...statuses].every((value) => ["approved", "delivered"].includes(value))) state.status = "approved";
  else if ([...statuses].every((value) => ["awaiting_approval", "approved", "delivered"].includes(value))) state.status = "awaiting_approval";
  else if (statuses.has("drafting") || statuses.has("generating")) state.status = "running";
  else state.status = "planned";
}

export async function draftScenes({ spec, specFile = null, outputsRoot = null, stateFile = null, imageAdapter, draftCardRenderer = renderDraftApprovalCard, dryRun = false, receiptMetadata = {} } = {}) {
  const normalized = spec?.schema === "mkt-videos/draft-spec@1"
    ? structuredClone(spec)
    : validateDraftSpec(spec, { specFile, outputsRoot: outputsRoot ?? spec?.outRoot });
  const state = createDraftState(normalized, { stateFile });
  if (dryRun) return state;
  if (state.runtimeReferencePolicy.blockers.length) {
    throw new Error(state.runtimeReferencePolicy.blockers.map((entry) => entry.message).join(" "));
  }
  if (state.scenes.some((scene) => scene.generationTask === "reference_to_video") && !imageAdapter?.generate) throw new Error("imageAdapter.generate é obrigatório para cenas reference_to_video.");
  if (state.scenes.some((scene) => scene.generationTask === "image_to_video" && scene.runtimeInputRoles?.[0] !== "first-frame") && !imageAdapter?.generate) throw new Error("imageAdapter.generate é obrigatório para cenas image_to_video sem FIRST_FRAME explícito.");
  if (state.scenes.some((scene) => scene.generationTask === "text_to_video") && typeof draftCardRenderer !== "function") throw new Error("draftCardRenderer é obrigatório para cenas text_to_video.");
  await Promise.all(["keyframes", "videos-soltos", "receitas", "metadados"].map((directory) => mkdir(path.join(state.root, directory), { recursive: true })));
  await saveState(state, { initial: true });

  for (const scene of state.scenes) {
    await Promise.all(scene.references.map((file) => access(file)));
    scene.status = "drafting";
    event(state, "scene_drafting", { scene: scene.id });
    refreshStatus(state);
    await saveState(state);
    try {
      const operationMetadata = {
        ...structuredClone(receiptMetadata ?? {}),
        mode: "studio",
        draftId: state.id,
        sceneId: scene.id,
        generationTask: scene.generationTask,
        promptComposition: scene.generationTask === "text_to_video" ? scene.videoComposition : scene.imageComposition,
      };
      const directInputApproval = scene.generationTask === "edit"
        || (scene.generationTask === "image_to_video" && scene.runtimeInputRoles?.[0] === "first-frame");
      const result = scene.generationTask === "text_to_video"
        ? await draftCardRenderer({ scene, outputFile: scene.keyframeFile, receiptFile: `${scene.keyframeFile}.receipt.json`, metadata: operationMetadata })
        : directInputApproval
          ? await stageDirectInputApproval({ scene, sourceFile: scene.references[0], receiptFile: `${scene.keyframeFile}.receipt.json`, metadata: operationMetadata })
          : await imageAdapter.generate({
            prompt: scene.imageComposition.effectivePrompt,
            outputFile: scene.keyframeFile,
            images: scene.references,
            model: scene.imageModel,
            aspectRatio: scene.aspect,
            imageSize: scene.imageSize,
            metadata: operationMetadata,
          });
      scene.keyframeFile = result.file;
      scene.keyframeReceipt = result.receiptFile;
      scene.status = "awaiting_approval";
      event(state, "scene_drafted", { scene: scene.id, receipt: result.receiptFile });
    } catch (error) {
      scene.status = "failed";
      scene.error = error?.message ?? String(error);
      event(state, "scene_draft_failed", { scene: scene.id, error: scene.error });
      refreshStatus(state);
      await saveState(state);
      throw error;
    }
    refreshStatus(state);
    await saveState(state);
  }
  return state;
}

/**
 * Aprova os keyframes do draft para produção (decisão humana explícita).
 * @param {{ draftFile: string, scenes?: string[] | string | null }} options
 * @returns {Promise<{ status: string, stateFile: string, scenes: Array<{ id: string, status: string }> }>}
 */
export async function approveDraft({ draftFile, scenes = null } = {}) {
  const state = await readDraftState(draftFile);
  const selected = scenes == null ? null : new Set((Array.isArray(scenes) ? scenes : [scenes]).map((value) => String(value)));
  let approved = 0;
  for (const scene of state.scenes) {
    if (selected && !selected.has(scene.id)) continue;
    if (scene.status !== "awaiting_approval") throw new Error(`Cena ${scene.id} não aguarda aprovação; status atual: ${scene.status}.`);
    scene.status = "approved";
    scene.approvedAt = new Date().toISOString();
    approved += 1;
    event(state, "scene_approved", { scene: scene.id });
  }
  if (!approved) throw new Error("Nenhuma cena foi aprovada.");
  refreshStatus(state);
  await saveState(state);
  return state;
}

/**
 * Recupera somente falhas locais comprovadamente anteriores ao efeito externo.
 * A tentativa local permanece no histórico; a cena volta a `approved` apenas
 * quando não há handle, identificador remoto, MP4 ou recibo que possa indicar
 * que o provedor recebeu a operação.
 */
export async function recoverDraftPreProviderFailure({ draftFile, sceneIds, expectedError } = {}) {
  const state = await readDraftState(draftFile);
  const selected = new Set((Array.isArray(sceneIds) ? sceneIds : [sceneIds]).filter(Boolean).map(String));
  if (!selected.size) throw new Error("Recuperação pré-provedor exige ao menos uma cena.");
  const expected = requiredText(expectedError, "expectedError");
  const scenes = [...selected].map((sceneId) => {
    const scene = state.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error(`Cena ausente na recuperação pré-provedor: ${sceneId}.`);
    return scene;
  });

  for (const scene of scenes) {
    if (scene.status !== "ambiguous" || String(scene.error ?? "").trim() !== expected) {
      throw new Error(`Cena ${scene.id} não corresponde à falha pré-provedor esperada.`);
    }
    if (scene.providerHandle || scene.fileId || scene.interactionId) {
      throw new Error(`Cena ${scene.id} possui identidade remota; recuperação automática bloqueada.`);
    }
    if (await pathExists(scene.videoFile) || await pathExists(scene.videoReceipt)) {
      throw new Error(`Cena ${scene.id} possui MP4 ou recibo; recuperação automática bloqueada.`);
    }
  }

  for (const scene of scenes) {
    const previousAttemptId = scene.attemptId ?? null;
    scene.status = "approved";
    scene.attemptId = null;
    scene.error = null;
    event(state, "scene_pre_provider_failure_recovered", {
      scene: scene.id,
      previousAttemptId,
      reason: expected,
    });
  }
  refreshStatus(state);
  await saveState(state);
  return state;
}

/**
 * Projeta no draft uma decisão humana já validada e registrada pelo chamador no
 * journal canônico e no broker. Não comprova ausência de submissão, não encerra
 * tentativas remotas e nunca pode ser usado como recuperação automática.
 *
 * expectedUnsubmittedAttemptIds vincula cada nonce local ainda presente no draft
 * à evidência de ausência de tentativa que o chamador validou no journal.
 */
export async function authorizeDraftHumanReplacements({ draftFile, decisionId, replacements = [], unsubmittedSceneIds = [], expectedUnsubmittedAttemptIds = {} } = {}) {
  const absolute = path.resolve(requiredText(draftFile, "draftFile"));
  const previous = humanReplacementQueues.get(absolute) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const decision = requiredText(decisionId, "decisionId");
    if (!Array.isArray(replacements) || !Array.isArray(unsubmittedSceneIds)) throw new Error("replacements e unsubmittedSceneIds devem ser arrays.");
    if (!expectedUnsubmittedAttemptIds || typeof expectedUnsubmittedAttemptIds !== "object" || Array.isArray(expectedUnsubmittedAttemptIds)) throw new Error("expectedUnsubmittedAttemptIds deve ser um mapa por cena.");
    const selected = new Set();
    const select = (value) => {
      const sceneId = requiredText(value, "sceneId");
      if (selected.has(sceneId)) throw new Error(`Cena duplicada na decisão humana: ${sceneId}.`);
      selected.add(sceneId);
      return sceneId;
    };
    const replacementRequests = replacements.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Substituição humana inválida.");
      return { sceneId: select(entry.sceneId), attemptId: requiredText(entry.attemptId, "attemptId") };
    }).sort((left, right) => left.sceneId.localeCompare(right.sceneId));
    const unsubmittedRequests = unsubmittedSceneIds.map((value) => {
      const sceneId = select(value);
      return { sceneId, attemptId: Object.hasOwn(expectedUnsubmittedAttemptIds, sceneId) ? requiredText(expectedUnsubmittedAttemptIds[sceneId], `expectedUnsubmittedAttemptIds.${sceneId}`) : null };
    }).sort((left, right) => left.sceneId.localeCompare(right.sceneId));
    if (!selected.size) throw new Error("Decisão humana exige ao menos uma cena.");
    const unsubmittedIds = new Set(unsubmittedRequests.map((entry) => entry.sceneId));
    if (Object.keys(expectedUnsubmittedAttemptIds).some((sceneId) => !unsubmittedIds.has(sceneId))) throw new Error("expectedUnsubmittedAttemptIds contém cena fora da decisão de ausência de submissão.");

    const before = await readFile(absolute, "utf8");
    const state = JSON.parse(before);
    if (state?.schema !== DRAFT_WORKFLOW_SCHEMA || !Array.isArray(state.scenes) || !Array.isArray(state.history)) throw new Error(`Estado de draft inválido: ${absolute}.`);
    if (path.resolve(requiredText(state.stateFile, "state.stateFile")) !== absolute) throw new Error("stateFile do draft diverge do arquivo solicitado.");
    if (state.humanReplacementDecisions != null && !Array.isArray(state.humanReplacementDecisions)) throw new Error("Histórico de decisões humanas inválido.");
    const requestFingerprint = operationFingerprint({ replacements: replacementRequests, unsubmitted: unsubmittedRequests });
    const priorDecisions = (state.humanReplacementDecisions ?? []).filter((entry) => entry.decisionId === decision);
    if (priorDecisions.length) {
      if (priorDecisions.length !== 1 || priorDecisions[0].requestFingerprint !== requestFingerprint) throw new Error("decisionId já foi vinculado a outro escopo de substituição.");
      // Uma nova tentativa pode ter começado ou concluído. Replay jamais altera
      // seu status, ponteiro, artefatos, erro ou horário de atualização.
      return state;
    }

    const changes = [];
    for (const request of [...replacementRequests.map((entry) => ({ ...entry, noSubmission: false })), ...unsubmittedRequests.map((entry) => ({ ...entry, noSubmission: true }))]) {
      const matches = state.scenes.filter((scene) => scene.id === request.sceneId);
      if (matches.length !== 1) throw new Error(`Cena ausente ou duplicada no draft: ${request.sceneId}.`);
      const scene = matches[0];
      if (scene.replacementHistory != null && !Array.isArray(scene.replacementHistory)) throw new Error(`Histórico de substituições inválido: ${scene.id}.`);
      if (request.noSubmission) {
        if (!["approved", "generating"].includes(scene.status)) throw new Error(`Cena ${scene.id} não está elegível como não submetida.`);
        if ((scene.attemptId ?? null) !== request.attemptId) throw new Error(`Nonce local divergente em expectedUnsubmittedAttemptIds para ${scene.id}.`);
      } else if (scene.status !== "ambiguous" || scene.attemptId !== request.attemptId) {
        throw new Error(`Cena ${scene.id} não corresponde à tentativa ambígua exata da decisão.`);
      }
      if (scene.fileId || scene.providerHandle || scene.interactionId) throw new Error(`Cena ${scene.id} possui identidade remota; substituição humana bloqueada.`);
      for (const file of [scene.videoFile, scene.videoReceipt]) {
        if (await pathExists(requiredText(file, `Saída de ${scene.id}`))) throw new Error(`Cena ${scene.id} possui MP4 ou recibo; substituição humana bloqueada.`);
      }
      changes.push({ scene, request });
    }
    // O executor deve estar parado. Uma alteração concorrente detectada durante
    // as verificações locais invalida a projeção antes da primeira gravação.
    if (await readFile(absolute, "utf8") !== before) throw new Error("Draft mudou durante a validação da decisão humana; releia antes de aplicar.");
    const authorizedAt = new Date().toISOString();
    for (const { scene, request } of changes) {
      const replacement = {
        decisionId: decision,
        authorizedAt,
        previousAttemptId: scene.attemptId ?? null,
        previousStatus: scene.status,
        previousError: scene.error ?? null,
        outcome: request.noSubmission ? "not-submitted" : "unknown",
        classification: request.noSubmission ? "not-submitted" : "external_effect_unknown",
        noSubmission: request.noSubmission,
      };
      scene.replacementHistory = [...(scene.replacementHistory ?? []), replacement];
      scene.status = "approved";
      scene.attemptId = null;
      scene.error = null;
      event(state, request.noSubmission ? "scene_unsubmitted_human_authorized" : "scene_replacement_human_authorized", { scene: scene.id, ...replacement });
    }
    state.humanReplacementDecisions = [...(state.humanReplacementDecisions ?? []), { decisionId: decision, requestFingerprint, authorizedAt, replacements: replacementRequests, unsubmitted: unsubmittedRequests }];
    refreshStatus(state);
    await saveState(state);
    return state;
  });
  humanReplacementQueues.set(absolute, operation);
  try {
    return await operation;
  } finally {
    if (humanReplacementQueues.get(absolute) === operation) humanReplacementQueues.delete(absolute);
  }
}

async function verifiedReceiptId(file, label) {
  if (!file || !(await pathExists(file))) throw new Error(`Recibo ausente para ${label}.`);
  const receipt = await readVerifiedReceipt(file);
  for (const artifact of receipt.artifacts ?? []) {
    const validation = await verifyArtifact(artifact);
    if (!validation.valid) throw new Error(`Artefato divergente em ${label}: ${validation.errors.join(" ")}`);
  }
  return receipt.id ?? null;
}

export async function animateDraft({ draftFile, videoAdapter, budget = null, timeoutMs = 900_000, pollIntervalMs = 5_000, parallel = 3, receiptMetadata = {} } = {}) {
  if (!videoAdapter?.generate) throw new Error("videoAdapter.generate é obrigatório.");
  const state = await readDraftState(draftFile);
  const resumes = (scene) => videoAdapter.canResumePhases === true && ["generating", "ambiguous"].includes(scene.status) && scene.attemptId && videoAdapter.canResumeAttempt?.(scene.attemptId) === true;
  const candidates = state.scenes.filter((scene) => scene.status === "approved" || resumes(scene));
  if (!candidates.length && state.status !== "delivered") {
    throw new Error("Nenhuma cena aprovada para animação. Execute approve antes de animate.");
  }
  const max = budget == null ? candidates.length : Number(budget);
  if (!Number.isInteger(max) || max < 0) throw new Error("budget deve ser inteiro não negativo.");
  const newCalls = candidates.filter((scene) => !resumes(scene)).length;
  if (newCalls > max) throw new Error(`O draft exige ${newCalls} chamadas Omni, acima do budget ${max}.`);
  const ambiguous = state.scenes.filter((scene) => ["generating", "ambiguous"].includes(scene.status) && !resumes(scene));
  if (ambiguous.length) throw new Error(`Há cenas com chamada ambígua (${ambiguous.map((scene) => scene.id).join(", ")}); não haverá repetição automática.`);

  for (const scene of candidates) {
    if (!(await pathExists(scene.keyframeFile))) throw new Error(`Keyframe ausente para ${scene.id}: ${scene.keyframeFile}`);
    if (!resumes(scene) && (await pathExists(scene.videoFile) || await pathExists(scene.videoReceipt))) {
      throw new Error(`Cena ${scene.id} já possui saída parcial; reconcilie manualmente antes de gerar.`);
    }
    await verifiedReceiptId(scene.keyframeReceipt, `keyframe ${scene.id}`);
  }
  const pool = await runProductionPool({
    // Uma cena recusada não é motivo para descartar as outras trinta e nove: o
    // provedor recusa conteúdo caso a caso, e a onda seguia morrendo inteira por
    // causa de um clipe. Três falhas seguidas, sem nenhum sucesso entre elas,
    // continuam parando tudo — aí não é a cena, é o provedor, e insistir só
    // queima cota.
    haltAfterConsecutiveFailures: 3,
    jobs: candidates.map((scene) => ({ id: scene.id, run: async ({ waitWithoutWorker }) => {
      const resumePhase = Boolean(resumes(scene));
      scene.status = "generating";
      if (!resumePhase) {
        scene.attemptId = randomUUID();
        scene.fileId = null;
        scene.providerHandle = null;
      }
      event(state, resumePhase ? "scene_video_reconcile_started" : "scene_video_started", { scene: scene.id, attemptId: scene.attemptId });
      refreshStatus(state);
      await saveState(state);
      try {
      const parentReceiptId = await verifiedReceiptId(scene.keyframeReceipt, `keyframe ${scene.id}`);
      const directTextGeneration = scene.generationTask === "text_to_video";
      const editGeneration = scene.generationTask === "edit";
      const images = directTextGeneration || editGeneration
        ? []
        : scene.references.length ? scene.references : [scene.keyframeFile];
      const result = await videoAdapter.generate({
        waitWithoutWorker,
        resumePhase,
        prompt: scene.videoComposition.effectivePrompt,
        outputFile: scene.videoFile,
        images,
        inputRoles: editGeneration ? [] : scene.references.length ? scene.runtimeInputRoles : ["first-frame"],
        referenceVideo: editGeneration ? scene.references[0] : null,
        executionInputReceipts: directTextGeneration ? [] : [scene.keyframeReceipt],
        task: scene.generationTask,
        aspectRatio: scene.aspect,
        durationSeconds: scene.expectedDuration,
        model: "gemini-omni-flash-preview",
        timeoutMs,
        pollIntervalMs,
        receiptFile: scene.videoReceipt,
        attemptId: scene.attemptId,
        onProviderHandle: async (handle) => {
          if (handle.attemptId !== scene.attemptId) throw new Error(`Handle Omni divergente para a cena ${scene.id}.`);
          scene.fileId = handle.fileId;
          scene.interactionId = handle.interactionId ?? null;
          scene.providerHandle = structuredClone(handle);
          event(state, "scene_video_handle_persisted", { scene: scene.id, attemptId: scene.attemptId, fileId: scene.fileId });
          await saveState(state);
        },
        metadata: {
          ...structuredClone(receiptMetadata ?? {}),
          mode: "studio",
          draftId: state.id,
          sceneId: scene.id,
          promptComposition: scene.videoComposition,
          pipeline: { stage: "draft-animate", parentReceiptIds: parentReceiptId ? [parentReceiptId] : [] },
        },
      });
      scene.videoFile = result.file;
      scene.videoReceipt = result.receiptFile;
      scene.interactionId = result.interactionId ?? null;
      scene.fileId = result.fileId ?? scene.fileId;
      scene.status = "delivered";
      event(state, "scene_video_delivered", { scene: scene.id, receipt: result.receiptFile });
      } catch (error) {
        scene.status = "ambiguous";
        scene.error = error?.message ?? String(error);
        event(state, "scene_video_ambiguous", { scene: scene.id, error: scene.error });
        refreshStatus(state);
        await saveState(state);
        throw error;
      }
      refreshStatus(state);
      await saveState(state);
      return { scene: scene.id, file: scene.videoFile, receipt: scene.videoReceipt };
    } })),
    parallel,
  });
  state.productionPool = { schema: pool.schema, parallel: pool.parallel, admitted: pool.admitted, fulfilled: pool.fulfilled, rejected: pool.rejected, results: pool.results.map(({ cause, value, ...entry }) => ({ ...entry, value: value ?? null })) };
  refreshStatus(state);
  await saveState(state);
  const rejected = pool.results.find((entry) => entry.status === "rejected");
  if (rejected) throw rejected.cause ?? new Error(rejected.error);
  return state;
}

export async function qaDraftScenes({ draftFile, qa = {}, runQa = defaultRunQa, throwOnBlocked = true, receiptMetadata = {} } = {}) {
  const state = await readDraftState(draftFile);
  const scenes = state.scenes.filter((scene) => scene.status === "delivered");
  if (scenes.length !== state.scenes.length) throw new Error("QA de cenas exige todas as cenas entregues.");
  await mkdir(path.join(state.root, "metadados", "qa-scenes"), { recursive: true });
  const blocked = [];
  for (const scene of scenes) {
    if (!scene.qa?.report) {
      const outputFile = path.join(state.root, "metadados", "qa-scenes", `${scene.id}.json`);
      const receiptFile = path.join(state.root, "receitas", `${scene.id}.qa.receipt.json`);
      const result = await runQa({
        videoFile: scene.videoFile,
        outputFile,
        receiptFile,
        expectedText: scene.expectedText,
        expectedDuration: scene.expectedDuration,
        direction: scene.motionPrompt,
        semantic: Boolean(qa.semanticScenes),
        semanticModel: qa.semanticModel,
        requireAudio: false,
        sourceReceipts: [scene.videoReceipt],
        parentReceipts: [await verifiedReceiptId(scene.videoReceipt, `vídeo ${scene.id}`)].filter(Boolean),
        metadata: structuredClone(receiptMetadata ?? {}),
      });
      const reportFingerprint = operationFingerprint({ report: result.report });
      scene.qa = { report: result.file, receipt: result.receiptFile, reportFingerprint, gate: null, override: scene.qa?.override ?? null };
      event(state, "scene_qa_completed", { scene: scene.id, report: result.file });
    }
    const report = JSON.parse(await readFile(scene.qa.report, "utf8"));
    const qaContext = contextualizeQaWarnings(report, {
      allowedPreMasterTruePeakDb: qa.preMasterTruePeakToleranceDb ?? null,
    });
    const gate = {
      ...evaluateQaGate(
        { ...report, warnings: qaContext.warnings },
        { mode: qa.sceneGate ?? "block", blockingWarnings: qa.sceneBlockingWarnings ?? null },
      ),
      contextualAllowances: qaContext.contextualAllowances,
    };
    // Um override humano prévio é decisão sobre o vídeo: re-QA não pode anulá-lo
    // por causa de um fingerprint novo de relatório. Mantém a justificativa e
    // atualiza o fingerprint corrente para permanecer consistente.
    const override = scene.qa.override ? { ...scene.qa.override, reportFingerprint: scene.qa.reportFingerprint } : null;
    scene.qa.gate = gate.status === "blocked" && override ? { ...gate, status: "overridden", override } : gate;
    if (scene.qa.gate.status === "blocked") blocked.push({ scene: scene.id, warnings: scene.qa.gate.blockingWarnings });
    await saveState(state);
  }
  refreshStatus(state);
  await saveState(state);
  state.sceneQaSummary = {
    schema: "mkt-videos/scene-qa-summary@1",
    status: blocked.length ? "blocked" : "passed",
    checkedScenes: scenes.length,
    blocked,
  };
  await saveState(state);
  if (blocked.length && throwOnBlocked) throw new Error(`QA de cenas bloqueou a montagem: ${blocked.map((entry) => `${entry.scene} (${entry.warnings.join(", ")})`).join("; ")}.`);
  return state;
}

export async function overrideDraftSceneQa({ draftFile, sceneId, author, justification } = {}) {
  const state = await readDraftState(draftFile);
  const scene = state.scenes.find((entry) => entry.id === String(sceneId));
  if (!scene?.qa?.gate || scene.qa.gate.status !== "blocked") throw new Error(`Cena ${sceneId} não possui QA bloqueado elegível para override.`);
  const normalizedAuthor = requiredText(author, "author");
  const normalizedJustification = requiredText(justification, "justification");
  scene.qa.override = { schema: "mkt-videos/scene-qa-override@1", author: normalizedAuthor, justification: normalizedJustification, acceptedAt: new Date().toISOString(), acceptedWarnings: [...scene.qa.gate.blockingWarnings], reportFingerprint: scene.qa.reportFingerprint };
  scene.qa.gate = { ...scene.qa.gate, status: "overridden", override: scene.qa.override };
  event(state, "scene_qa_overridden", { scene: scene.id, author: normalizedAuthor, reportFingerprint: scene.qa.reportFingerprint });
  const remainingBlocked = state.scenes
    .filter((entry) => entry.qa?.gate?.status === "blocked")
    .map((entry) => ({ scene: entry.id, warnings: entry.qa.gate.blockingWarnings }));
  state.sceneQaSummary = {
    schema: "mkt-videos/scene-qa-summary@1",
    status: remainingBlocked.length ? "blocked" : "passed",
    checkedScenes: state.scenes.length,
    blocked: remainingBlocked,
  };
  refreshStatus(state);
  await saveState(state);
  return state;
}

export async function reconcileDraftScene({ draftFile, sceneId, videoAdapter, timeoutMs = 120_000, receiptMetadata = {} } = {}) {
  if (!videoAdapter?.reconcile) throw new Error("videoAdapter.reconcile é obrigatório.");
  const state = await readDraftState(draftFile);
  const scene = state.scenes.find((entry) => entry.id === String(sceneId));
  if (!scene) throw new Error(`Cena não encontrada no draft: ${sceneId}.`);
  if (scene.status === "delivered") return { state, scene, result: { classification: "ready", alreadyDelivered: true, zeroPost: true } };
  const parentReceiptId = await verifiedReceiptId(scene.keyframeReceipt, `keyframe ${scene.id}`);
  let result;
  try {
    result = await videoAdapter.reconcile({
      prompt: scene.videoComposition.effectivePrompt,
      images: ["text_to_video", "edit"].includes(scene.generationTask) ? [] : scene.references.length ? scene.references : [scene.keyframeFile],
      inputRoles: scene.generationTask === "edit" ? [] : scene.references.length ? scene.runtimeInputRoles : ["first-frame"],
      referenceVideo: scene.generationTask === "edit" ? scene.references[0] : null,
      executionInputReceipts: scene.generationTask === "text_to_video" ? [] : [scene.keyframeReceipt],
      task: scene.generationTask,
      aspectRatio: scene.aspect,
      model: "gemini-omni-flash-preview",
      fileId: scene.fileId ?? scene.providerHandle?.fileId ?? null,
      attemptId: scene.attemptId ?? scene.providerHandle?.attemptId ?? null,
      expirationTime: scene.providerHandle?.expirationTime ?? scene.reconciliation?.expirationTime ?? null,
      outputFile: scene.videoFile,
      receiptFile: scene.videoReceipt,
      timeoutMs,
      metadata: {
        ...structuredClone(receiptMetadata ?? {}),
        mode: "studio",
        draftId: state.id,
        sceneId: scene.id,
        promptComposition: scene.videoComposition,
        pipeline: { stage: "draft-animate", parentReceiptIds: parentReceiptId ? [parentReceiptId] : [] },
      },
    });
  } catch (error) {
    scene.status = "ambiguous";
    scene.error = error?.message ?? String(error);
    event(state, "scene_video_reconcile_failed", { scene: scene.id, error: scene.error });
    refreshStatus(state);
    await saveState(state);
    throw error;
  }
  scene.fileId = result.fileId ?? scene.fileId ?? null;
  scene.providerHandle = scene.providerHandle ? { ...scene.providerHandle, fileId: scene.fileId, expirationTime: result.expirationTime ?? scene.providerHandle.expirationTime ?? null } : scene.providerHandle;
  scene.reconciliation = {
    classification: result.classification,
    checkedAt: result.checkedAt,
    expirationTime: result.expirationTime ?? null,
    zeroPost: true,
    nextAction: result.nextAction ?? null,
  };
  if (result.classification === "ready" && result.file) {
    scene.videoFile = result.file;
    scene.videoReceipt = result.receiptFile;
    scene.status = "delivered";
    scene.error = null;
    event(state, "scene_video_reconciled", { scene: scene.id, fileId: scene.fileId, receipt: result.receiptFile });
  } else if (["provider_failed", "remote_expired", "remote_not_found"].includes(result.classification)) {
    scene.status = "failed";
    scene.error = `Recuperação Omni encerrada: ${result.classification}.`;
    event(state, "scene_video_reconcile_terminal", { scene: scene.id, classification: result.classification });
  } else {
    scene.status = "ambiguous";
    scene.error = `Recuperação Omni requer atenção: ${result.classification}.`;
    event(state, "scene_video_reconcile_pending", { scene: scene.id, classification: result.classification });
  }
  refreshStatus(state);
  await saveState(state);
  return { state, scene, result };
}
