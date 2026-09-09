import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { resolveStyleSpec } from "./direction-presets.mjs";
import { PROVIDER_CAPABILITIES } from "./provider-registry.mjs";
import {
  DEFAULT_REFERENCE_ROOT,
  assertPromptIsNotImitative,
  assertProviderInputAuthorized,
  readProviderInputAuthorization,
  readReferenceIndex,
} from "./reference-governance.mjs";

export const EXECUTION_GOVERNANCE_SCHEMA = "mkt-videos/execution-governance@1";
export const CAPABILITY_SET_SNAPSHOT_SCHEMA = "mkt-videos/capability-set-snapshot@1";
export const HISTORICAL_ETA_SCHEMA = "mkt-videos/historical-eta@1";

const TOPOLOGIES = new Set(["independent", "chained"]);

const NODE_CAPABILITIES = Object.freeze({
  keyframe: { provider: "gemini-image", operation: "image-generate", stage: "draft" },
  tts: { provider: "google-vids", operation: "text-to-speech", stage: "tts" },
  "omni-narration": { provider: "gemini-omni", operation: "text-to-video", stage: "tts" },
  "music-generate": { provider: "flow-music", operation: "music-generate", stage: "music" },
  "omni-video": { provider: "gemini-omni", operation: "video-generate", stage: "video" },
  "qa-scene": { provider: "gemini-vision", operation: "semantic-qa", stage: "sceneQa" },
  qa: { provider: "gemini-vision", operation: "semantic-qa", stage: "qa" },
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizedTask(value) {
  return String(value ?? "image_to_video").trim().toLowerCase().replaceAll("-", "_");
}

function providerOperation(provider, task) {
  if (provider !== "gemini-omni") return NODE_CAPABILITIES[task]?.operation ?? null;
  return normalizedTask(task).replaceAll("_", "-");
}

function semanticProjection(spec, styleSpec, topology) {
  return {
    schema: spec.schema,
    name: spec.name,
    source: clone(spec.source),
    ...(spec.styleComposition ? { styleCompositionHash: spec.styleComposition.hash } : {}),
    narration: clone(spec.narration),
    music: clone(spec.music),
    timeline: clone(spec.timeline),
    brief: clone(spec.brief),
    knowledgeContext: clone(spec.knowledgeContext),
    knowledgeContextBinding: clone(spec.knowledgeContextBinding),
    scenes: spec.scenes.map((scene) => ({
      id: scene.id,
      role: scene.role,
      objective: scene.objective,
      visualPrompt: scene.visualPrompt,
      motionPrompt: scene.motionPrompt,
      onScreenText: scene.onScreenText,
      references: clone(scene.references),
      referenceAuthorizations: clone(scene.referenceAuthorizations ?? []),
      restrictions: clone(scene.restrictions),
      style: scene.style,
      generationTask: normalizedTask(scene.generationTask),
      topology: topology.scenes.find((entry) => entry.sceneId === scene.id)?.topology ?? "independent",
      image: clone(scene.image),
    })),
    formats: clone(spec.formats),
    brandKit: clone(spec.brandKit),
    captions: clone(spec.captions),
    qa: clone(spec.qa),
    reuse: clone(spec.reuse),
    finishing: clone(spec.finishing),
    styleSpec: styleSpec == null ? null : clone(styleSpec),
  };
}

function executionBoundaryProjection(plan) {
  return {
    schema: plan.schema,
    brief: clone(plan.brief),
    knowledgeContextBinding: clone(plan.knowledgeContextBinding),
    timeline: clone(plan.timeline),
    nodes: clone(plan.nodes),
    budget: clone(plan.budget),
    concurrency: clone(plan.concurrency),
    policies: clone(plan.policies),
    compatibility: clone(plan.compatibility),
  };
}

function styleFeatureRequirements(spec) {
  return {
    onScreenText: spec.scenes.some((scene) => scene.onScreenText != null),
    logo: Boolean(spec.brandKit?.logo || spec.brandKit?.logoFile || spec.scenes.some((scene) => scene.runtimeInputRoles?.includes?.("logo"))),
    people: Boolean(spec.source?.requirements?.people || spec.scenes.some((scene) => scene.runtimeInputRoles?.includes?.("person"))),
    synchronizedAudio: spec.narration?.mode !== "none" || spec.music?.mode !== "none",
  };
}

function capabilityFreshness(capability, now) {
  const checkedAt = capability.checkedAt ?? capability.evidenceAt ?? null;
  const checkedTime = Date.parse(checkedAt ?? "");
  const ttlSeconds = capability.ttlSeconds;
  if (!checkedAt || !Number.isFinite(checkedTime)) {
    return { status: "missing", checkedAt: null, ttlSeconds: ttlSeconds ?? null, expiresAt: null };
  }
  const expiresAt = ttlSeconds == null ? null : new Date(checkedTime + Number(ttlSeconds) * 1_000).toISOString();
  const stale = expiresAt != null && now.getTime() > Date.parse(expiresAt);
  return { status: stale ? "stale" : "valid", checkedAt, ttlSeconds: ttlSeconds ?? null, expiresAt };
}

function callInventory(nodes, spec) {
  const grouped = new Map();
  for (const node of nodes) {
    if (node.costClass === "local") continue;
    const mapped = node.kind === "music-generate" && spec?.music?.backend === "flow-music"
      ? { ...NODE_CAPABILITIES[node.kind], provider: "flow-music", operation: "music-generate" }
      : node.kind === "tts" && spec?.narration?.provider === "google-vids"
        ? { ...NODE_CAPABILITIES[node.kind], provider: "google-vids" }
        : NODE_CAPABILITIES[node.kind];
    if (!mapped) continue;
    const operation = mapped.provider === "gemini-omni"
      ? node.kind === "omni-narration"
        ? "text-to-video"
        : providerOperation(mapped.provider, node.id.startsWith("video:") ? node.semanticTask : null)
      : mapped.operation;
    const key = `${mapped.stage}\0${mapped.provider}\0${operation}`;
    const current = grouped.get(key) ?? { stage: mapped.stage, provider: mapped.provider, operation, count: 0, nodeIds: [] };
    current.count += 1;
    current.nodeIds.push(node.id);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => left.stage.localeCompare(right.stage) || left.provider.localeCompare(right.provider));
}

function callsFromPlan(plan) {
  const sceneTasks = new Map(plan.spec.scenes.map((scene) => [`video:${scene.id}`, normalizedTask(scene.generationTask)]));
  const nodes = plan.nodes.map((node) => ({ ...node, semanticTask: sceneTasks.get(node.id) }));
  return callInventory(nodes, plan.spec);
}

function pushBlocker(blockers, code, message, details = {}) {
  blockers.push({ code, message, ...details });
}

function resolveTopology(spec, styleSpec, blockers) {
  const planDefaultWasExplicit = Object.hasOwn(spec.execution ?? {}, "topology");
  const requestedDefault = spec.execution?.topology
    ?? styleSpec?.generation?.defaultTopology
    ?? "independent";
  if (!TOPOLOGIES.has(requestedDefault)) {
    pushBlocker(blockers, "invalid_topology", `Topologia inválida: ${requestedDefault}.`);
  }
  const defaultTopology = TOPOLOGIES.has(requestedDefault) ? requestedDefault : "independent";
  if (defaultTopology === "chained" && !planDefaultWasExplicit) {
    pushBlocker(blockers, "implicit_chaining", "Encadeamento exige escolha explícita no plano.");
  }
  const scenes = spec.scenes.map((scene, index) => {
    const explicit = Object.hasOwn(scene, "topology");
    const topology = scene.topology ?? defaultTopology;
    if (!TOPOLOGIES.has(topology)) pushBlocker(blockers, "invalid_topology", `Cena ${scene.id} usa topologia inválida: ${topology}.`, { sceneId: scene.id });
    if (topology === "chained" && !explicit && !planDefaultWasExplicit) {
      pushBlocker(blockers, "implicit_chaining", `Cena ${scene.id} encadeada sem escolha explícita.`, { sceneId: scene.id });
    }
    if (styleSpec?.generation?.allowedTopologies && !styleSpec.generation.allowedTopologies.includes(topology)) {
      pushBlocker(blockers, "style_topology_incompatible", `O estilo ${styleSpec.id} não permite topologia ${topology}.`, { sceneId: scene.id });
    }
    return {
      sceneId: scene.id,
      topology: TOPOLOGIES.has(topology) ? topology : "independent",
      explicit: explicit || planDefaultWasExplicit,
      dependsOnSceneId: topology === "chained" && index > 0 ? spec.scenes[index - 1].id : null,
    };
  });
  return { default: defaultTopology, explicit: planDefaultWasExplicit, scenes };
}

function validateStyle(spec, styleSpec, blockers) {
  if (!styleSpec) return;
  if (styleSpec.status === "concept") {
    pushBlocker(blockers, "style_pilot_authorization_required", `O estilo ${styleSpec.id} está em concept e exige autorização específica de piloto.`);
  } else if (styleSpec.status === "deprecated") {
    pushBlocker(blockers, "style_deprecated", `O estilo ${styleSpec.id} está deprecated.`, { replacement: styleSpec.supersedes ?? null });
  }
  if (styleSpec.formats?.allowedAspects?.length && !styleSpec.formats.allowedAspects.includes(spec.formats.master)) {
    pushBlocker(blockers, "style_aspect_incompatible", `O estilo ${styleSpec.id} não permite o aspecto ${spec.formats.master}.`);
  }
  for (const scene of spec.scenes) {
    const task = normalizedTask(scene.generationTask ?? styleSpec.generation?.defaultTask);
    if (styleSpec.generation?.allowedTasks?.length && !styleSpec.generation.allowedTasks.includes(task)) {
      pushBlocker(blockers, "style_task_incompatible", `O estilo ${styleSpec.id} não permite a tarefa ${task}.`, { sceneId: scene.id });
    }
    const maxReferences = styleSpec.runtimeInputs?.maxReferences;
    if (maxReferences != null && scene.references.length > maxReferences) {
      pushBlocker(blockers, "style_reference_limit", `A cena ${scene.id} excede o limite de ${maxReferences} referência(s) do estilo ${styleSpec.id}.`, { sceneId: scene.id });
    }
  }
  const requirements = styleFeatureRequirements(spec);
  for (const [feature, required] of Object.entries(requirements)) {
    if (required && styleSpec.capabilities?.[feature] === "unsupported") {
      pushBlocker(blockers, "style_capability_unsupported", `O estilo ${styleSpec.id} não suporta ${feature}.`, { feature });
    }
  }
}

function lintPrompts(spec, blockers) {
  for (const scene of spec.scenes) {
    for (const [field, prompt] of [["visualPrompt", scene.visualPrompt], ["motionPrompt", scene.motionPrompt]]) {
      try {
        assertPromptIsNotImitative(prompt);
      } catch (error) {
        pushBlocker(blockers, "anti_imitation_lint", error.message, { sceneId: scene.id, field });
      }
    }
  }
}

function evidenceRuntimeReferences(spec, blockers) {
  const found = [];
  for (const scene of spec.scenes) {
    for (const [index, reference] of scene.references.entries()) {
      const entry = { sceneId: scene.id, reference: path.resolve(String(reference)), index };
      found.push(entry);
      pushBlocker(
        blockers,
        "canonical_provider_input_rights_required",
        `canonical providerInput rights required: a referência Studio ${scene.id}[${index}] exige decisão canônica vigente do Knowledge Core antes de qualquer POST.`,
        entry,
      );
    }
  }
  return found;
}

function promptComposition(spec, planStyle, blockers) {
  return spec.scenes.map((scene) => {
    let style = planStyle;
    if (scene.style && scene.style !== planStyle?.id) {
      try {
        style = resolveStyleSpec(scene.style, { allowConcept: true, allowDeprecated: true });
      } catch (error) {
        pushBlocker(blockers, "style_unknown", error.message, { sceneId: scene.id, styleId: scene.style });
        style = null;
      }
    }
    const compose = (userPrompt) => ({
      userPrompt,
      effectivePrompt: style && !spec.styleComposition ? `${style.direction}\n\nUser direction, preserved literally:\n${userPrompt}` : userPrompt,
    });
    return {
      sceneId: scene.id,
      directionPreset: style?.id ?? null,
      ...(spec.styleComposition ? { compositionBindingHash: spec.styleComposition.hash, precomposed: true } : {}),
      precedence: ["user-request", "brand-kit", "style", "defaults"],
      visual: compose(scene.visualPrompt),
      motion: compose(scene.motionPrompt),
    };
  });
}

function validateProviders(calls, blockers, now, registry = PROVIDER_CAPABILITIES) {
  return calls.map((call) => {
    const capability = registry[call.provider] ?? null;
    const freshness = capability == null ? { status: "missing", checkedAt: null, ttlSeconds: null, expiresAt: null } : capabilityFreshness(capability, now);
    if (!capability) {
      pushBlocker(blockers, "provider_unregistered", `Provedor não registrado: ${call.provider}.`, { provider: call.provider });
    } else {
      const declaredOperation = call.provider === "gemini-omni" ? call.operation : call.operation;
      if (!capability.operations.includes(declaredOperation)) {
        pushBlocker(blockers, "provider_operation_unsupported", `${call.provider} não declara ${declaredOperation}.`, { provider: call.provider, operation: declaredOperation });
      }
      if (capability.status !== "supported") {
        pushBlocker(blockers, "provider_not_supported", `${call.provider} está ${capability.status}.`, { provider: call.provider, status: capability.status });
      }
      if (capability.deliveryDependencyAllowed !== true) {
        pushBlocker(blockers, "provider_delivery_blocked", `${call.provider} não pode ser dependência de entrega.`, { provider: call.provider });
      }
      if (freshness.status !== "valid") {
        pushBlocker(blockers, "provider_health_stale", `${call.provider} possui evidência de capacidade ${freshness.status}.`, { provider: call.provider, freshness });
      }
    }
    return {
      provider: call.provider,
      operation: call.operation,
      status: capability?.status ?? "missing",
      deliveryDependencyAllowed: capability?.deliveryDependencyAllowed === true,
      authContract: capability?.authContract ?? null,
      evidence: capability?.evidence ?? null,
      freshness,
    };
  });
}

function validatePaidBudget(spec, calls, blockers) {
  const budgetKeys = {
    "gemini-image": "image",
    "google-vids": "tts",
    "flow-music": "music",
    "gemini-omni": "omni",
    "gemini-vision": "semanticQa",
  };
  const required = {};
  for (const call of calls) {
    const key = budgetKeys[call.provider];
    if (key) required[key] = (required[key] ?? 0) + call.count;
  }
  const declared = clone(spec.execution?.budget ?? {});
  for (const [key, count] of Object.entries(required)) {
    if (declared[key] != null && Number(declared[key]) < count) {
      pushBlocker(blockers, "budget_exceeded", `O plano exige ${count} chamada(s) ${key}, acima do orçamento ${declared[key]}.`, { budgetKey: key, required: count, declared: Number(declared[key]) });
    }
  }
  return { required, declared, unit: "session-quota-calls", monetaryCostAssumed: false };
}

function legacyCompatibility(spec, blockers) {
  const incompatibleScenes = spec.scenes
    .filter((scene) => !new Set(["image_to_video", "text_to_video"]).has(normalizedTask(scene.generationTask)))
    .map((scene) => ({ sceneId: scene.id, task: normalizedTask(scene.generationTask) }));
  if (incompatibleScenes.length) {
    pushBlocker(
      blockers,
      "legacy_executor_task_incompatible",
      "O executor legado suporta image_to_video e text_to_video; outras tarefas devem permanecer provider-free.",
      { scenes: incompatibleScenes },
    );
  }
  return {
    adapter: "execution-plan@1-to-film-spec@1",
    supported: incompatibleScenes.length === 0,
    rollback: "--planner legacy",
    limitations: incompatibleScenes,
  };
}

export function createExecutionGovernance(plan, { now = new Date(), providerCapabilities = PROVIDER_CAPABILITIES } = {}) {
  if (plan?.schema !== "mkt-videos/execution-plan@1") throw new Error("execution-plan@1 é obrigatório.");
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error("now inválido.");
  const blockers = [];
  const styleId = plan.spec.source?.directionPreset ?? plan.spec.styleComposition?.composition.styleId ?? plan.spec.scenes.find((scene) => scene.style)?.style ?? null;
  let styleSpec = null;
  if (styleId) {
    try {
      styleSpec = resolveStyleSpec(styleId, { allowConcept: true, allowDeprecated: true });
    } catch (error) {
      pushBlocker(blockers, "style_unknown", error.message, { styleId });
    }
  }
  const topology = resolveTopology(plan.spec, styleSpec, blockers);
  validateStyle(plan.spec, styleSpec, blockers);
  lintPrompts(plan.spec, blockers);
  const evidenceReferences = evidenceRuntimeReferences(plan.spec, blockers);
  const composedPrompts = promptComposition(plan.spec, styleSpec, blockers);
  const paidCalls = callsFromPlan(plan);
  const budget = validatePaidBudget(plan.spec, paidCalls, blockers);
  const capabilities = validateProviders(paidCalls, blockers, current, providerCapabilities);
  const capabilitySnapshotHash = operationFingerprint({
    schema: CAPABILITY_SET_SNAPSHOT_SCHEMA,
    capabilities,
  });
  const executorCompatibility = legacyCompatibility(plan.spec, blockers);
  const approvalFingerprint = operationFingerprint({
    schema: "mkt-videos/paid-approval@1",
    semanticPlan: semanticProjection(plan.spec, styleSpec, topology),
    executionBoundary: executionBoundaryProjection(plan),
    paidCalls: paidCalls.map(({ stage, provider, operation, count }) => ({ stage, provider, operation, count })),
  });
  const paidCallCeiling = paidCalls.reduce((sum, entry) => sum + entry.count, 0);
  return {
    schema: EXECUTION_GOVERNANCE_SCHEMA,
    planner: "canonical",
    style: styleSpec == null ? null : {
      id: styleSpec.id,
      status: styleSpec.status,
      family: styleSpec.family,
      studioOnly: styleSpec.studioOnly,
    },
    promptComposition: composedPrompts,
    runtimeReferencePolicy: {
      evidenceRoot: DEFAULT_REFERENCE_ROOT,
      evidenceReferences,
      verifiedAuthorizations: [],
      legacySidecarReport: {
        status: "not-checked",
        effect: "report-only",
        checkedReferences: 0,
        verifiedReferences: 0,
        entries: [],
      },
      canonicalProviderInputRightsSatisfied: evidenceReferences.length === 0,
      defaultProviderInputAllowed: false,
    },
    topology,
    paidCalls,
    paidCallCeiling,
    budget,
    capabilities,
    capabilitySnapshotHash,
    approval: {
      fingerprint: approvalFingerprint,
      required: paidCallCeiling > 0,
      fingerprintFlag: `--confirm-fingerprint ${approvalFingerprint}`,
    },
    executorCompatibility,
    blockers,
    readyForPaidExecution: blockers.length === 0,
    eta: { schema: HISTORICAL_ETA_SCHEMA, status: "unavailable", reason: "historical_receipts_not_scanned", providers: [] },
  };
}

function authorizationFile(value) {
  if (typeof value === "string") return value;
  return value?.file ?? value?.authorizationFile ?? null;
}

function sameCanonicalValue(left, right) {
  return operationFingerprint(left) === operationFingerprint(right);
}

function assertCanonicalField(actual, expected, label) {
  if (!sameCanonicalValue(actual, expected)) {
    throw new Error(`Integridade canônica do execution plan falhou em ${label}.`);
  }
}

function expectedAuthorizationRoles(scene, referenceIndex) {
  const roles = new Set([
    scene.runtimeInputRoles?.[referenceIndex] ?? "visual-reference",
    ...(scene.referenceAuthorizations ?? [])
      .filter((entry) => entry && typeof entry === "object" && entry.role)
      .map((entry) => entry.role),
  ]);
  return roles;
}

function assertLegacyAuthorizationReport(plan, evidenceReferences, verifiedAuthorizations) {
  if (!Array.isArray(verifiedAuthorizations)) {
    throw new Error("Integridade canônica do execution plan falhou em verifiedAuthorizations.");
  }
  if (verifiedAuthorizations.length > evidenceReferences.length) {
    throw new Error("Integridade canônica do execution plan falhou: sidecars legados excedem as referências Studio.");
  }
  const remaining = evidenceReferences.map((entry) => structuredClone(entry));
  for (const authorization of verifiedAuthorizations) {
    if (!authorization || typeof authorization !== "object") {
      throw new Error("Integridade canônica do execution plan falhou: relatório de sidecar legado inválido.");
    }
    const evidenceIndex = remaining.findIndex((entry) => (
      entry.sceneId === authorization.sceneId
      && /^[a-f0-9]{64}$/.test(String(authorization.referenceSha256 ?? ""))
    ));
    if (evidenceIndex < 0) {
      throw new Error(`Integridade canônica do execution plan falhou: sidecar legado não corresponde a ${authorization.sceneId ?? "cena desconhecida"}.`);
    }
    const evidence = remaining[evidenceIndex];
    const scene = plan.spec.scenes.find((entry) => entry.id === evidence.sceneId);
    const operation = normalizedTask(scene?.generationTask).replaceAll("_", "-");
    const acceptedRoles = expectedAuthorizationRoles(scene, evidence.index);
    if (!String(authorization.id ?? "").trim()
        || !acceptedRoles.has(authorization.role)
        || authorization.operation !== operation) {
      throw new Error(`Integridade canônica do execution plan falhou: sidecar legado inválido para ${evidence.sceneId}[${evidence.index}].`);
    }
    remaining.splice(evidenceIndex, 1);
  }
  return verifiedAuthorizations.map(({ id, sceneId, referenceSha256, role, operation }) => ({
    id,
    sceneId,
    referenceSha256,
    role,
    operation,
  }));
}

function canonicalApprovalFingerprint(plan, canonicalGovernance, storedGovernance) {
  const report = storedGovernance.runtimeReferencePolicy?.legacySidecarReport;
  const verified = report?.entries ?? [];
  if (report?.effect !== "report-only") {
    throw new Error("Integridade canônica do execution plan falhou: sidecar legado deve permanecer report-only.");
  }
  if (verified.length) {
    assertLegacyAuthorizationReport(
      plan,
      canonicalGovernance.runtimeReferencePolicy.evidenceReferences,
      verified,
    );
  }
  // Sidecars históricos são evidência report-only. Eles nunca alteram a
  // aprovação paga nem satisfazem providerInput no runtime canônico.
  return canonicalGovernance.approval.fingerprint;
}

/**
 * Recomputes the semantic paid boundary from the current execution-plan body.
 * This deliberately ignores ETA enrichment and other report-only fields, while
 * binding prompts, references, topology, timeline, the complete DAG, budget,
 * concurrency, policies, compatibility and paid-node inventory to the approval
 * fingerprint that a human confirms.
 */
export function assertExecutionPlanIntegrity(plan, { now = new Date(), providerCapabilities = PROVIDER_CAPABILITIES } = {}) {
  if (plan?.schema !== "mkt-videos/execution-plan@1") {
    throw new Error("Integridade canônica exige execution-plan@1.");
  }
  if (!plan.spec || !Array.isArray(plan.nodes) || !plan.timeline) {
    throw new Error("Integridade canônica do execution plan falhou: estrutura incompleta.");
  }
  if (typeof plan.compilerVersion !== "string" || !plan.compilerVersion.trim()) {
    throw new Error("Integridade canônica do execution plan falhou: compilerVersion ausente.");
  }
  if (!/^[a-z][a-z0-9-]*@[0-9]+\.[0-9]+\.[0-9]+$/.test(plan.compilerVersion)) {
    throw new Error("Integridade canônica do execution plan falhou: compilerVersion inválida.");
  }
  const governance = plan.governance;
  if (governance?.schema !== EXECUTION_GOVERNANCE_SCHEMA) {
    throw new Error("Integridade canônica do execution plan falhou: execution-governance@1 ausente.");
  }
  const { fingerprint: timelineFingerprint, ...timelineBody } = plan.timeline;
  if (operationFingerprint(timelineBody) !== timelineFingerprint) {
    throw new Error("Integridade canônica do execution plan falhou: timeline fingerprint divergente.");
  }

  const canonical = createExecutionGovernance(plan, { now, providerCapabilities });
  assertCanonicalField(governance.style ?? null, canonical.style ?? null, "style");
  assertCanonicalField(governance.promptComposition, canonical.promptComposition, "promptComposition");
  assertCanonicalField(
    governance.runtimeReferencePolicy?.evidenceReferences ?? [],
    canonical.runtimeReferencePolicy.evidenceReferences,
    "runtimeReferencePolicy.evidenceReferences",
  );
  if (governance.runtimeReferencePolicy?.defaultProviderInputAllowed !== false) {
    throw new Error("Integridade canônica do execution plan falhou: provider input implícito não é permitido.");
  }
  if ((governance.runtimeReferencePolicy?.verifiedAuthorizations ?? []).length !== 0) {
    throw new Error("Integridade canônica do execution plan falhou: sidecar legado não é autorização canônica.");
  }
  if (governance.runtimeReferencePolicy?.canonicalProviderInputRightsSatisfied
      !== (canonical.runtimeReferencePolicy.evidenceReferences.length === 0)) {
    throw new Error("Integridade canônica do execution plan falhou: estado canônico de providerInput divergente.");
  }
  assertCanonicalField(governance.topology, canonical.topology, "topology");
  assertCanonicalField(governance.paidCalls, canonical.paidCalls, "paidCalls");
  assertCanonicalField(governance.paidCallCeiling, canonical.paidCallCeiling, "paidCallCeiling");
  assertCanonicalField(governance.budget, canonical.budget, "budget");
  assertCanonicalField(governance.executorCompatibility, canonical.executorCompatibility, "executorCompatibility");
  assertCanonicalField(governance.capabilitySnapshotHash, canonical.capabilitySnapshotHash, "capabilitySnapshotHash");
  assertCanonicalField(governance.approval?.required, canonical.approval.required, "approval.required");

  const approvalFingerprint = canonicalApprovalFingerprint(plan, canonical, governance);
  if (governance.approval?.fingerprint !== approvalFingerprint) {
    throw new Error("Integridade canônica do execution plan falhou: fingerprint de aprovação diverge da projeção semântica atual.");
  }
  if (governance.approval?.fingerprintFlag !== `--confirm-fingerprint ${approvalFingerprint}`) {
    throw new Error("Integridade canônica do execution plan falhou: fingerprintFlag divergente.");
  }
  if (governance.approval?.confirmPaidFlag !== undefined) {
    throw new Error("Integridade canônica do execution plan falhou: confirmPaidFlag divergente.");
  }

  const canonicalBlockers = canonical.blockers;
  const storedAdditionalBlockers = governance.blockers.filter((entry) => (
    !canonicalBlockers.some((candidate) => sameCanonicalValue(candidate, entry))
  ));
  return {
    governance: canonical,
    approvalFingerprint,
    paidCallCeiling: canonical.paidCallCeiling,
    blockers: [...canonicalBlockers, ...storedAdditionalBlockers],
  };
}

export async function verifyExecutionReferenceAuthorizations(plan, {
  referenceIndexFile = null,
  now = new Date(),
} = {}) {
  if (plan?.governance?.schema !== EXECUTION_GOVERNANCE_SCHEMA) throw new Error("Plano sem execution-governance@1.");
  const governed = structuredClone(plan);
  const evidenceReferences = governed.governance.runtimeReferencePolicy?.evidenceReferences ?? [];
  if (!evidenceReferences.length) return governed;
  if (!referenceIndexFile) {
    pushBlocker(
      governed.governance.blockers,
      "reference_index_required",
      "O índice/sidecar legado é apenas report-only; canonical providerInput rights required antes de qualquer POST.",
    );
    governed.governance.readyForPaidExecution = false;
    return governed;
  }
  const index = await readReferenceIndex(referenceIndexFile);
  const verified = [];
  for (const evidence of evidenceReferences) {
    const scene = governed.spec.scenes.find((entry) => entry.id === evidence.sceneId);
    const declarations = scene?.referenceAuthorizations ?? [];
    let accepted = null;
    const failures = [];
    for (const declaration of declarations) {
      const file = authorizationFile(declaration);
      if (!file) continue;
      try {
        const authorization = await readProviderInputAuthorization(file);
        const role = typeof declaration === "object" && declaration.role
          ? declaration.role
          : scene.runtimeInputRoles?.[evidence.index] ?? "visual-reference";
        const operation = normalizedTask(scene.generationTask).replaceAll("_", "-");
        const result = assertProviderInputAuthorized({
          index,
          authorization,
          reference: evidence.reference,
          scope: `film:${governed.spec.name}`,
          role,
          operation,
          now,
        });
        accepted = {
          id: result.authorization.id,
          sceneId: scene.id,
          referenceSha256: result.reference.sha256,
          role,
          operation,
          actor: result.authorization.actor,
          issuedAt: result.authorization.issuedAt,
        };
        break;
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (accepted) verified.push(accepted);
    else {
      pushBlocker(
        governed.governance.blockers,
        "legacy_reference_sidecar_unverified",
        `O sidecar legado da referência ${evidence.sceneId}[${evidence.index}] não pôde ser validado; canonical providerInput rights required independentemente deste relatório.`,
        { ...evidence, failures },
      );
    }
  }
  governed.governance.runtimeReferencePolicy.legacySidecarReport = {
    status: verified.length === evidenceReferences.length ? "validated" : "incomplete",
    effect: "report-only",
    checkedReferences: evidenceReferences.length,
    verifiedReferences: verified.length,
    entries: verified,
  };
  governed.governance.runtimeReferencePolicy.canonicalProviderInputRightsSatisfied = false;
  governed.governance.readyForPaidExecution = governed.governance.blockers.length === 0;
  return governed;
}

function quantile(sorted, percentile) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function receiptProvider(receipt) {
  const provider = String(receipt?.provider ?? "").toLowerCase();
  const operation = String(receipt?.operation ?? "").toLowerCase();
  const model = String(receipt?.model ?? "").toLowerCase();
  const joined = `${provider} ${operation} ${model}`;
  if (joined.includes("google-vids") || joined.includes("vids-tts")) return "google-vids";
  if (joined.includes("flow-music")) return "flow-music";
  if (joined.includes("vision") || joined.includes("semantic")) return "gemini-vision";
  if (joined.includes("image") && !joined.includes("video")) return "gemini-image";
  if (joined.includes("omni") || joined.includes("video")) return "gemini-omni";
  return null;
}

async function receiptFiles(root) {
  const found = [];
  const pending = [path.resolve(root)];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name.endsWith(".receipt.json")) found.push(file);
    }
  }
  return found;
}

export async function estimateExecutionPlanFromReceipts(plan, {
  root,
  minSamples = 3,
  maxSamples = 200,
} = {}) {
  if (plan?.governance?.schema !== EXECUTION_GOVERNANCE_SCHEMA) throw new Error("Plano sem execution-governance@1.");
  const files = await receiptFiles(root);
  const samples = new Map();
  let unreadable = 0;
  for (const file of files) {
    try {
      const receipt = JSON.parse(await readFile(file, "utf8"));
      const provider = receiptProvider(receipt);
      const startedAt = Date.parse(receipt.startedAt ?? "");
      const completedAt = Date.parse(receipt.completedAt ?? "");
      const durationMs = completedAt - startedAt;
      if (!provider || !Number.isFinite(durationMs) || durationMs <= 0) continue;
      const bucket = samples.get(provider) ?? [];
      bucket.push({ durationMs, completedAt: receipt.completedAt, receiptId: receipt.id ?? null });
      samples.set(provider, bucket);
    } catch {
      unreadable += 1;
    }
  }
  const providers = [];
  let available = true;
  let totalP50Ms = 0;
  let totalP90Ms = 0;
  for (const call of plan.governance.paidCalls) {
    const values = (samples.get(call.provider) ?? [])
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      .slice(0, Math.max(1, Number(maxSamples)));
    const durations = values.map((entry) => entry.durationMs).sort((left, right) => left - right);
    if (durations.length < Number(minSamples)) {
      available = false;
      providers.push({
        provider: call.provider,
        count: call.count,
        status: "unavailable",
        reason: "insufficient_samples",
        sampleSize: durations.length,
        requiredSamples: Number(minSamples),
      });
      continue;
    }
    const p50Ms = Math.round(quantile(durations, 0.5));
    const p90Ms = Math.round(quantile(durations, 0.9));
    totalP50Ms += p50Ms * call.count;
    totalP90Ms += p90Ms * call.count;
    providers.push({
      provider: call.provider,
      count: call.count,
      status: "available",
      sampleSize: durations.length,
      window: {
        from: values.map((entry) => entry.completedAt).sort()[0],
        to: values.map((entry) => entry.completedAt).sort().at(-1),
      },
      p50Ms,
      p90Ms,
    });
  }
  const eta = {
    schema: HISTORICAL_ETA_SCHEMA,
    status: available ? "available" : "unavailable",
    reason: available ? null : "one_or_more_providers_lack_evidence",
    method: "historical_receipt_elapsed_time_p50_p90",
    root: path.resolve(root),
    scannedReceipts: files.length,
    unreadable,
    minSamples: Number(minSamples),
    providers,
    total: available ? { p50Ms: totalP50Ms, p90Ms: totalP90Ms } : null,
  };
  return { ...plan, governance: { ...plan.governance, eta } };
}

export function assertPaidExecutionAuthorized(plan, {
  confirmFingerprint = null,
  allowConceptPilot = false,
  now = new Date(),
  providerCapabilities = PROVIDER_CAPABILITIES,
} = {}) {
  const governance = plan?.governance;
  if (plan?.schema !== "mkt-videos/execution-plan@1" && governance == null) return { legacy: true };
  if (governance?.schema !== EXECUTION_GOVERNANCE_SCHEMA) {
    throw new Error("Plano canônico sem execution-governance@1 válido.");
  }
  const integrity = assertExecutionPlanIntegrity(plan, { now, providerCapabilities });
  const blockers = integrity.blockers.filter((blocker) => !(allowConceptPilot && blocker.code === "style_pilot_authorization_required"));
  if (blockers.length) {
    throw new Error(`Plano bloqueado antes de qualquer POST: ${blockers.map((entry) => entry.code).join(", ")}.`);
  }
  if (integrity.paidCallCeiling > 0 && String(confirmFingerprint ?? "") !== integrity.approvalFingerprint) {
    throw new Error(`A confirmação deve corresponder ao fingerprint ${integrity.approvalFingerprint}.`);
  }
  return {
    legacy: false,
    fingerprint: integrity.approvalFingerprint,
    paidCallCeiling: integrity.paidCallCeiling,
    conceptPilot: allowConceptPilot,
  };
}
