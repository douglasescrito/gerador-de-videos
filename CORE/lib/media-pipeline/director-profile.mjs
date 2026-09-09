import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import {
  KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
} from "./knowledge-record-contracts.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "./knowledge-store.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { compilarReceita } from "./recipe-compiler.mjs";
import { compileFilmSpec } from "./film-compiler.mjs";
import { assertCreativeDirectionDecision, CREATIVE_AXES } from "./creative-direction.mjs";
import { listArchiveFavorites, listRecipePreferences } from "./archive-index.mjs";

export const DIRECTOR_PROFILE_SCHEMA = "mkt-videos/client-director-profile@1";
export const DIRECTOR_CONTEXT_SCHEMA = "mkt-videos/director-context@1";
export const DIRECTOR_BRIEF_SCHEMA = "mkt-videos/director-brief@1";
export const DIRECTOR_VALIDATION_SCHEMA = "mkt-videos/director-validation@1";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DIRECTOR_ENTITY_PREFIX = "entity:marketing-director:";

function text(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function id(value, label) {
  const normalized = text(value, label).toLowerCase();
  if (!ID.test(normalized)) throw new Error(`${label} deve usar apenas a-z, 0-9 e hífen.`);
  return normalized;
}

function uniqueStrings(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value)) throw new Error(`${label} deve ser uma lista.`);
  const normalized = [...new Set(value.map((entry) => text(entry, label)))];
  if (normalized.length < min) throw new Error(`${label} exige ao menos ${min} item(ns).`);
  return normalized;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} deve ser boolean.`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function defaultKnowledgeDbFile(localAppData = process.env.LOCALAPPDATA) {
  return path.join(text(localAppData, "LOCALAPPDATA"), "GeradorDeVideos", "Knowledge", "knowledge.sqlite");
}

export function directorRootScopeId(clientId) {
  return `client:${id(clientId, "clientId")}`;
}

export function directorProjectScopeId(clientId, projectId) {
  return `project:${id(clientId, "clientId")}:${id(projectId, "projectId")}`;
}

export function directorEntityId(clientId, projectId) {
  return `${DIRECTOR_ENTITY_PREFIX}${id(clientId, "clientId")}:${id(projectId, "projectId")}`;
}

export function validateDirectorProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Perfil diretor inválido.");
  if (value.schema !== DIRECTOR_PROFILE_SCHEMA) throw new Error(`schema do perfil deve ser ${DIRECTOR_PROFILE_SCHEMA}.`);
  const clientId = id(value.clientId, "clientId");
  const projectId = id(value.projectId, "projectId");
  const cadenceMinutes = Number(value.cadenceMinutes ?? 30);
  if (!Number.isInteger(cadenceMinutes) || cadenceMinutes < 5 || cadenceMinutes > 10080) throw new Error("cadenceMinutes deve ficar entre 5 e 10080.");
  const profile = {
    schema: DIRECTOR_PROFILE_SCHEMA,
    clientId,
    clientName: text(value.clientName, "clientName"),
    projectId,
    projectName: text(value.projectName, "projectName"),
    directorName: text(value.directorName, "directorName"),
    status: value.status === "active" ? "active" : (() => { throw new Error("status do perfil deve ser active."); })(),
    cadenceMinutes,
    outputCollection: text(value.outputCollection, "outputCollection"),
    brand: {
      positioning: text(value.brand?.positioning, "brand.positioning"),
      palette: uniqueStrings(value.brand?.palette, "brand.palette", { min: 2 }),
      logoPolicy: text(value.brand?.logoPolicy, "brand.logoPolicy"),
      forbiddenTerms: uniqueStrings(value.brand?.forbiddenTerms ?? [], "brand.forbiddenTerms"),
      requiredClosing: text(value.brand?.requiredClosing, "brand.requiredClosing"),
    },
    creative: {
      primaryStyle: text(value.creative?.primaryStyle, "creative.primaryStyle"),
      allowedStyles: uniqueStrings(value.creative?.allowedStyles, "creative.allowedStyles", { min: 1 }),
      advertisingArchetypes: uniqueStrings(value.creative?.advertisingArchetypes, "creative.advertisingArchetypes", { min: 2 }),
      narrationModes: uniqueStrings(value.creative?.narrationModes, "creative.narrationModes", { min: 2 }),
      transitionTechniques: uniqueStrings(value.creative?.transitionTechniques, "creative.transitionTechniques", { min: 1 }),
      motionTechniqueIds: uniqueStrings(value.creative?.motionTechniqueIds, "creative.motionTechniqueIds", { min: 1 }),
      motionCombinationIds: uniqueStrings(value.creative?.motionCombinationIds, "creative.motionCombinationIds", { min: 1 }),
      motionBankSha256: text(value.creative?.motionBankSha256, "creative.motionBankSha256").toLowerCase(),
      visualPrinciples: uniqueStrings(value.creative?.visualPrinciples, "creative.visualPrinciples", { min: 1 }),
      avoid: uniqueStrings(value.creative?.avoid, "creative.avoid", { min: 1 }),
      sceneCount: Number(value.creative?.sceneCount ?? 6),
      sceneDurationSeconds: Number(value.creative?.sceneDurationSeconds ?? 10),
    },
    audio: {
      narrationProvider: text(value.audio?.narrationProvider, "audio.narrationProvider"),
      preferredVoice: text(value.audio?.preferredVoice, "audio.preferredVoice"),
      whisperModel: text(value.audio?.whisperModel, "audio.whisperModel"),
      textAuthority: text(value.audio?.textAuthority, "audio.textAuthority"),
      timestampAuthority: text(value.audio?.timestampAuthority, "audio.timestampAuthority"),
      allowIntercutNarration: bool(value.audio?.allowIntercutNarration, "audio.allowIntercutNarration"),
      musicProvider: text(value.audio?.musicProvider, "audio.musicProvider"),
      fadeOutSeconds: Number(value.audio?.fadeOutSeconds ?? 0),
    },
    feedback: {
      videoLikes: text(value.feedback?.videoLikes, "feedback.videoLikes"),
      recipeLikes: text(value.feedback?.recipeLikes, "feedback.recipeLikes"),
      automaticPromotion: bool(value.feedback?.automaticPromotion, "feedback.automaticPromotion"),
      influence: text(value.feedback?.influence, "feedback.influence"),
    },
    governance: {
      humanApprovalRequired: bool(value.governance?.humanApprovalRequired, "governance.humanApprovalRequired"),
      rawModeInfluence: text(value.governance?.rawModeInfluence, "governance.rawModeInfluence"),
      providerCallsDuringPlanning: Number(value.governance?.providerCallsDuringPlanning ?? 0),
    },
  };
  if (!Number.isInteger(profile.creative.sceneCount) || profile.creative.sceneCount < 1 || profile.creative.sceneCount > 20) throw new Error("creative.sceneCount inválido.");
  if (!profile.creative.allowedStyles.includes(profile.creative.primaryStyle)) throw new Error("creative.primaryStyle deve constar em creative.allowedStyles.");
  if (!/^[a-f0-9]{64}$/.test(profile.creative.motionBankSha256)) throw new Error("creative.motionBankSha256 deve ser SHA-256 hexadecimal.");
  if (!Number.isFinite(profile.creative.sceneDurationSeconds) || profile.creative.sceneDurationSeconds < 1 || profile.creative.sceneDurationSeconds > 15) throw new Error("creative.sceneDurationSeconds inválido.");
  if (profile.audio.fadeOutSeconds !== 0) throw new Error("O perfil diretor não pode habilitar fade-out automático.");
  if (profile.feedback.automaticPromotion !== false) throw new Error("Likes não podem promover preferências automaticamente.");
  if (profile.governance.rawModeInfluence !== "none") throw new Error("Perfil diretor não pode influenciar o modo raw.");
  if (profile.governance.providerCallsDuringPlanning !== 0) throw new Error("Planejamento do diretor deve ser provider-free.");
  return Object.freeze(profile);
}

function directorGrant(rootScopeId, actor, permissions, now = new Date()) {
  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000);
  return createScopeGrant({
    rootScopeIds: [rootScopeId],
    permissions,
    actor,
    purpose: "governed multi-client marketing director",
    issuedAt,
    expiresAt,
  });
}

function ensureScope(repository, grant, scope) {
  try {
    return repository.createScope({ grant, scope });
  } catch (error) {
    if (!/já existe|duplic|UNIQUE constraint failed: knowledge_scopes/i.test(String(error?.message ?? error))) throw error;
    return null;
  }
}

export function registerDirectorProfile({ profile: rawProfile, dbFile = null, coreRoot, actor = "local-human", reason = "aprovação humana do perfil diretor", now = new Date() } = {}) {
  const profile = validateDirectorProfile(rawProfile);
  const databaseFile = path.resolve(dbFile ?? defaultKnowledgeDbFile());
  initializeKnowledgeStore({ dbFile: databaseFile, coreRoot, clock: () => now });
  const rootScopeId = directorRootScopeId(profile.clientId);
  const projectScopeId = directorProjectScopeId(profile.clientId, profile.projectId);
  const repository = createKnowledgeStoreRepository({ dbFile: databaseFile, coreRoot, clock: () => now });
  const grant = directorGrant(rootScopeId, actor, ["read", "write", "release", "integrity"], now);
  ensureScope(repository, grant, { id: rootScopeId, rootScopeId, parentScopeId: null, kind: "client", name: profile.clientName, createdAt: now });
  ensureScope(repository, grant, { id: projectScopeId, rootScopeId, parentScopeId: rootScopeId, kind: "project", name: profile.projectName, createdAt: now });
  const itemId = directorEntityId(profile.clientId, profile.projectId);
  const previous = repository.getKnowledgeItem({ grant, rootScopeId, id: itemId });
  const revision = (previous?.revision ?? 0) + 1;
  const payload = {
    schema: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
    entityType: "marketing-director",
    name: profile.directorName,
    aliases: [],
    attributes: { directorProfile: profile },
    evidenceRefs: [],
  };
  const createdAt = new Date(now).toISOString();
  const item = repository.appendKnowledgeItem({
    grant,
    item: {
      id: itemId,
      revision,
      rootScopeId,
      scopeId: projectScopeId,
      recordType: "entity",
      schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      schemaVersion: 1,
      status: "active",
      governance: createKnowledgeRecordEnvelope({
        classification: "confidential",
        owner: { type: "project", id: projectScopeId },
        provenance: [{ sourceType: "human-approved-director-profile", sourceRef: `${itemId}@${revision}`, method: "manual", observedAt: createdAt, contentHash: sha256(JSON.stringify(profile)) }],
        modality: "fact",
        evidenceIds: [],
        retention: { policy: "manual-review" },
        rights: { inventory: "allowed", localAnalysis: "allowed", textualIndexing: "allowed", embedding: "denied", training: "denied", reuse: "allowed", providerInput: "allowed", publication: "denied" },
        createdAt,
        createdBy: actor,
      }, { expectedActor: actor }),
      supersedesRevision: previous?.revision ?? null,
      payload,
      createdAt,
      createdBy: actor,
    },
  });
  const active = repository.getActiveRelease({ grant, rootScopeId });
  const members = (active?.release?.members ?? []).filter((member) => member.id !== itemId);
  members.push({ id: item.id, revision: item.revision });
  const release = repository.createRelease({
    grant,
    rootScopeId,
    releaseId: `release:director:${profile.clientId}:${profile.projectId}:v${revision}`,
    label: `${profile.directorName} v${revision}`,
    previousReleaseId: active?.release?.id ?? null,
    members,
    createdAt,
    createdBy: actor,
  });
  const activation = repository.activateRelease({
    grant,
    rootScopeId,
    releaseId: release.id,
    expectedReleaseHash: release.hash,
    expectedCurrentActivationId: active?.activation?.id ?? null,
    reason,
    createdAt,
    createdBy: actor,
  });
  return { schema: "mkt-videos/director-profile-registration@1", rootScopeId, projectScopeId, profile, profileFingerprint: operationFingerprint(profile), item: { id: item.id, revision: item.revision, contentHash: item.contentHash }, release: { id: release.id, hash: release.hash }, activation: { id: activation.id, hash: activation.hash }, providerCalls: 0 };
}

async function recentNoveltyFingerprints(outputsRoot, collection, limit = 12) {
  const root = path.join(path.resolve(outputsRoot), collection);
  if (!existsSync(root)) return [];
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && ["ineditismo.json", "creative-direction.json"].includes(entry.name)) {
        try {
          const value = JSON.parse(await readFile(target, "utf8"));
          found.push({
            file: path.relative(root, target).replaceAll("\\", "/"),
            checkedAt: value.decidedAt ?? value.checkedAt ?? null,
            productionId: value.productionId ?? null,
            fingerprint: value.fingerprint ?? null,
            ...(value.envelope?.editorialChain ? { editorialChain: value.envelope.editorialChain } : {}),
            variation: value.variation ?? null,
            decisionHash: value.decisionHash ?? null,
          });
        } catch {}
      }
    }
  }
  await visit(root);
  return found.sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0, limit);
}

export async function readDirectorContext({ clientId, projectId, dbFile = null, coreRoot, preferencesDbFile = null, outputsRoot = null, actor = "local-director-reader" } = {}) {
  const rootScopeId = directorRootScopeId(clientId);
  const databaseFile = path.resolve(dbFile ?? defaultKnowledgeDbFile());
  if (!existsSync(databaseFile)) throw new Error("Knowledge Store não inicializado para diretores.");
  const repository = createKnowledgeStoreRepository({ dbFile: databaseFile, coreRoot });
  const grant = directorGrant(rootScopeId, actor, ["read", "integrity"]);
  const active = repository.getActiveRelease({ grant, rootScopeId });
  if (!active) throw new Error(`Nenhum perfil diretor ativo para ${rootScopeId}.`);
  const itemId = directorEntityId(clientId, projectId);
  const member = active.release.members.find((entry) => entry.id === itemId);
  if (!member) throw new Error(`Perfil diretor ${itemId} não pertence à release ativa.`);
  const item = repository.getKnowledgeItem({ grant, rootScopeId, id: itemId, revision: member.revision });
  const profile = validateDirectorProfile(item?.payload?.attributes?.directorProfile);
  const preferences = preferencesDbFile && existsSync(preferencesDbFile)
    ? {
        videoLikes: listArchiveFavorites({ dbFile: preferencesDbFile, root: outputsRoot }).map((entry) => ({ relPath: entry.relPath, likedAt: entry.updatedAt })),
        recipeLikes: listRecipePreferences({ dbFile: preferencesDbFile, likedOnly: true }).map((entry) => ({ recipeId: entry.recipeId, style: entry.style, motionCombinationId: entry.motionCombinationId, motionInstructionIds: entry.motionInstructionIds, likedAt: entry.updatedAt })),
      }
    : { videoLikes: [], recipeLikes: [] };
  const recent = outputsRoot ? await recentNoveltyFingerprints(outputsRoot, profile.outputCollection) : [];
  const planningBody = {
    schema: DIRECTOR_CONTEXT_SCHEMA,
    rootScopeId,
    projectScopeId: directorProjectScopeId(clientId, projectId),
    activeRelease: { id: active.release.id, hash: active.release.hash, activationId: active.activation.id, activationHash: active.activation.hash },
    profile,
    profileFingerprint: operationFingerprint(profile),
    recentCreativeFingerprints: recent,
    boundaries: { providerFree: true, providerCalls: 0, rawModeInfluence: "none", generationTriggered: false, humanApprovalForPromotion: true },
  };
  return {
    ...planningBody,
    contextFingerprint: operationFingerprint(planningBody),
    preferenceEvidence: {
      ...preferences,
      authority: "suggestion-only",
      automaticPromotion: false,
      evidenceFingerprint: operationFingerprint(preferences),
      excludedFromPlanningFingerprint: true,
    },
  };
}

/**
 * Descobre somente os perfis diretores publicados na release ativa do root
 * autorizado. A lista não é uma configuração paralela: item, root e release
 * continuam sendo resolvidos pelo Knowledge Core.
 */
export function discoverDirectorProjects({ dbFile = null, coreRoot, rootScopeId, actor = "local-director-discovery" } = {}) {
  const normalizedRoot = text(rootScopeId, "rootScopeId");
  if (!normalizedRoot.startsWith("client:")) throw new Error("Descoberta de diretores exige rootScopeId client:.");
  const clientId = id(normalizedRoot.slice("client:".length), "clientId");
  const databaseFile = path.resolve(dbFile ?? defaultKnowledgeDbFile());
  if (!existsSync(databaseFile)) throw new Error("Knowledge Store não inicializado para diretores.");
  const repository = createKnowledgeStoreRepository({ dbFile: databaseFile, coreRoot });
  const grant = directorGrant(normalizedRoot, actor, ["read", "integrity"]);
  const active = repository.getActiveRelease({ grant, rootScopeId: normalizedRoot });
  if (!active) return [];
  const prefix = `${DIRECTOR_ENTITY_PREFIX}${clientId}:`;
  const projects = [];
  for (const member of active.release.members) {
    if (!member.id.startsWith(prefix)) continue;
    const projectId = member.id.slice(prefix.length);
    if (!ID.test(projectId)) continue;
    const item = repository.getKnowledgeItem({ grant, rootScopeId: normalizedRoot, id: member.id, revision: member.revision });
    const profile = item?.payload?.attributes?.directorProfile;
    if (profile?.schema !== DIRECTOR_PROFILE_SCHEMA || profile.status !== "active") continue;
    projects.push({ clientId, projectId });
  }
  return projects.sort((left, right) => `${left.clientId}:${left.projectId}`.localeCompare(`${right.clientId}:${right.projectId}`));
}

export function validateDirectorBrief(value, context) {
  if (!value || value.schema !== DIRECTOR_BRIEF_SCHEMA) throw new Error(`brief deve usar ${DIRECTOR_BRIEF_SCHEMA}.`);
  if (value.clientId !== context.profile.clientId || value.projectId !== context.profile.projectId) throw new Error("Brief atravessa cliente ou projeto do contexto diretor.");
  if (value.profileFingerprint !== context.profileFingerprint) throw new Error("Brief foi criado com outro perfil diretor.");
  const profile = context.profile;
  const brief = {
    schema: DIRECTOR_BRIEF_SCHEMA,
    clientId: value.clientId,
    projectId: value.projectId,
    profileFingerprint: value.profileFingerprint,
    marketingObjective: text(value.marketingObjective, "marketingObjective"),
    audience: text(value.audience, "audience"),
    promise: text(value.promise, "promise"),
    hook: text(value.hook, "hook"),
    callToAction: text(value.callToAction, "callToAction"),
    advertisingArchetype: text(value.advertisingArchetype, "advertisingArchetype"),
    narrationMode: text(value.narrationMode, "narrationMode"),
    motionTechniqueIds: uniqueStrings(value.motionTechniqueIds, "motionTechniqueIds", { min: 1 }),
    transitionTechniques: uniqueStrings(value.transitionTechniques, "transitionTechniques", { min: 1 }),
    novelty: value.novelty,
  };
  if (!profile.creative.advertisingArchetypes.includes(brief.advertisingArchetype)) throw new Error("Arquétipo publicitário fora do perfil ativo.");
  if (!profile.creative.narrationModes.includes(brief.narrationMode)) throw new Error("Modo de locução fora do perfil ativo.");
  for (const technique of brief.motionTechniqueIds) if (!profile.creative.motionTechniqueIds.includes(technique)) throw new Error(`Técnica motion não autorizada no perfil: ${technique}.`);
  for (const transition of brief.transitionTechniques) if (!profile.creative.transitionTechniques.includes(transition)) throw new Error(`Transição não autorizada no perfil: ${transition}.`);
  const novelty = brief.novelty;
  for (const key of ["thesis", "arc", "keyVisual", "aestheticTerritory", "motionMechanism", "composition", "soundResolution"]) text(novelty?.[key], `novelty.${key}`);
  return Object.freeze(brief);
}

export function validateDirectorProduction({ context, brief: rawBrief, recipe, creativeDirection = null } = {}) {
  const brief = validateDirectorBrief(rawBrief, context);
  const compiled = compilarReceita(recipe);
  if (compiled.motor !== "filme") throw new Error("Diretor exige receita kind filme.");
  const normalized = compiled.receita;
  const profile = context.profile;
  const failures = [];
  const direction = creativeDirection == null ? null : assertCreativeDirectionDecision(creativeDirection, { context });
  if (direction != null) {
    for (const axis of CREATIVE_AXES) {
      if (brief.novelty[axis] !== direction.fingerprint.axes[axis]) failures.push(`brief.novelty.${axis} diverge da decisão criativa materializada.`);
    }
    compiled.filmSpec.creativeDirection = direction;
  }
  if (normalized.style !== profile.creative.primaryStyle) failures.push(`style deve ser ${profile.creative.primaryStyle}.`);
  if (normalized.scenes.length !== profile.creative.sceneCount) failures.push(`receita deve ter ${profile.creative.sceneCount} cenas.`);
  for (const [index, scene] of normalized.scenes.entries()) {
    if (scene.duration !== profile.creative.sceneDurationSeconds) failures.push(`cena ${scene.id} deve ter ${profile.creative.sceneDurationSeconds}s.`);
    const final = index === normalized.scenes.length - 1;
    if (!final && (scene.generationTask !== "text_to_video" || scene.references.length)) failures.push(`cena ${scene.id} deve ser text_to_video sem referência.`);
    if (final && (scene.generationTask !== "reference_to_video" || scene.references.length !== 1)) failures.push(`cena final deve usar exatamente uma referência de logo.`);
  }
  const narration = normalized.audio.narrationSpec;
  if (!narration) failures.push("receita exige locução material.");
  else {
    if (narration.provider !== profile.audio.narrationProvider) failures.push(`locução deve usar ${profile.audio.narrationProvider}.`);
    if (narration.voice !== profile.audio.preferredVoice) failures.push(`voz deve ser ${profile.audio.preferredVoice}.`);
    if (narration.sync !== "whisper-word-timestamps") failures.push("locução deve usar Whisper word timestamps.");
    if (narration.blocks.length !== normalized.scenes.length) failures.push("cada cena deve possuir bloco próprio de locução.");
  }
  if (normalized.audio.musicFadeOutSeconds !== 0) failures.push("trilha deve terminar em corte limpo.");
  if (normalized.workflow?.narrationTextAuthority !== profile.audio.textAuthority) failures.push("autoridade textual da locução diverge do perfil.");
  if (normalized.workflow?.narrationTimestampAuthority !== profile.audio.timestampAuthority) failures.push("autoridade temporal da locução diverge do perfil.");
  if (normalized.workflow?.authorizationMode !== "production-once" || normalized.workflow?.completionMode !== "complete") failures.push("produção contínua exige production-once e completionMode complete.");
  const fullText = `${narration?.text ?? ""} ${normalized.scenes.map((scene) => scene.onScreenText ?? "").join(" ")}`.toLocaleLowerCase("pt-BR");
  for (const term of profile.brand.forbiddenTerms) if (fullText.includes(term.toLocaleLowerCase("pt-BR"))) failures.push(`termo de marca proibido: ${term}.`);
  const result = {
    schema: DIRECTOR_VALIDATION_SCHEMA,
    valid: failures.length === 0,
    clientId: profile.clientId,
    projectId: profile.projectId,
    profileFingerprint: context.profileFingerprint,
    contextFingerprint: context.contextFingerprint,
    recipeId: normalized.id,
    creativeDirectionHash: direction?.decisionHash ?? null,
    brief,
    failures,
    boundaries: { providerCalls: 0, generationTriggered: false, compilationOnly: true },
  };
  return { ...result, validationFingerprint: operationFingerprint(result), compiled };
}

export function compileDirectorProduction({ context, brief, recipe, creativeDirection } = {}) {
  if (creativeDirection == null) throw new Error("Compilação contínua exige decisão criativa materializada.");
  const validation = validateDirectorProduction({ context, brief, recipe, creativeDirection });
  if (!validation.valid) throw new Error(`Produção dirigida inválida: ${validation.failures.join(" ")}`);
  const executionPlan = compileFilmSpec(validation.compiled.filmSpec);
  return Object.freeze({
    schema: "mkt-videos/director-production-plan@1",
    clientId: validation.clientId,
    projectId: validation.projectId,
    validationFingerprint: validation.validationFingerprint,
    creativeDirectionHash: creativeDirection.decisionHash,
    planSeed: creativeDirection.planSeed,
    variation: structuredClone(creativeDirection.variation),
    executionPlan,
    boundaries: { providerCalls: 0, generationTriggered: false, compilationOnly: true },
  });
}
