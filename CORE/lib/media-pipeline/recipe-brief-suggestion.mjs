import { assertStudioBrief, createStudioBrief, assertKnowledgeContextSnapshot, buildKnowledgeContextBinding } from "./studio-context.mjs";
import { composeDirection, resolveStyleSpec, isLiveSelectableStyleSpec } from "./direction-presets.mjs";
import { assertCreativeDirectionDecision } from "./creative-direction.mjs";
import { parseMasterRecipe, resolveMasterRecipe, compileResolvedMasterRecipe, preflightResolvedMasterRecipe } from "./master-recipe-v2.mjs";
import { prepareRecipeStory } from "./recipe-story-structures.mjs";
import { resolveGoogleVidsVoice } from "./google-vids-voices.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { bindStyleComposition } from "./style-controls.mjs";
import { resolveRecipeProfile } from "./recipe-profiles.mjs";

const postModuleKeys = ["transitions", "graphics", "postProduction", "qa", "delivery", "variants"];
const moduleKeys = ["assets", "cast", "narration", "alignment", "music", "sfx", "captions", "mix", "reuse", ...postModuleKeys];
const taskNames = { "text-to-video": "text_to_video", "image-to-video": "image_to_video", "reference-to-video": "reference_to_video", "edit-video": "edit" };

function assertObjectKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new Error(`${label} contém campos desconhecidos: ${unknown.join(", ")}.`);
}

/** A sugestão prepara a Receita Mestre; somente o compilador canônico cria nós. */
export function suggestMasterRecipeFromBrief({ brief: input, rootScopeId, profile = null, style, structure, techniques = [], components = null, story = {}, modules = null, shotBindings = [], creativeDirection = null, knowledgeContext = null } = {}) {
  const selection = profile == null ? null : resolveRecipeProfile(profile, { style, structure, components, modules });
  if (selection) ({ style, structure, components, modules } = selection);
  structure ??= "linear";
  const plain = input && input.schema == null && input.hash == null;
  const brief = plain ? createStudioBrief(input) : assertStudioBrief(input);
  if (Object.keys(input).some((key) => !Object.hasOwn(brief, key))) throw new Error("Brief contém campo desconhecido; use os campos de studio-brief@1.");
  if (!Array.isArray(techniques)) throw new Error("techniques deve ser um array de seleções {id, values}.");
  if (!/^client:[a-z0-9][a-z0-9:_-]*$/.test(String(rootScopeId ?? ""))) throw new Error("--root-scope-id deve ser explícito no formato client:<id>.");
  if (!brief.projectId) throw new Error("O brief exige projectId explícito.");
  if (brief.clientId && brief.clientId !== rootScopeId && `client:${brief.clientId}` !== rootScopeId) throw new Error("O cliente do brief diverge de --root-scope-id.");
  if (brief.knowledgeContextHash && !knowledgeContext) throw new Error("Contexto privado exige --knowledge-context materializado; suggest não refaz retrieval.");
  const context = knowledgeContext == null ? null : assertKnowledgeContextSnapshot(knowledgeContext);
  if (context && (context.rootScopeId !== rootScopeId || (brief.knowledgeContextHash && brief.knowledgeContextHash !== context.hash))) throw new Error("Contexto materializado diverge do root ou do hash vinculado ao brief.");
  const binding = context && buildKnowledgeContextBinding(context, { briefHash: brief.hash });
  if (!style) throw new Error("recipe suggest exige --style explícito.");
  const selected = resolveStyleSpec(style);
  if (!isLiveSelectableStyleSpec(selected)) throw new Error("O estilo precisa estar disponível como piloto ou validado.");
  const dimensions = { "16:9": [1920, 1080], "9:16": [1080, 1920] }[brief.format];
  if (!dimensions || (selected.formats?.allowedAspects.length && !selected.formats.allowedAspects.includes(brief.format))) throw new Error("brief.format deve ser 16:9 ou 9:16 e compatível com o estilo.");
  const durationFrames = Number(brief.durationSeconds) * 24;
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 3) throw new Error("brief.durationSeconds precisa representar ao menos 3 frames inteiros a 24 fps.");
  const narrative = prepareRecipeStory({ brief, structure, story });
  const stages = narrative.stages;
  if (durationFrames < stages.length) throw new Error("A duração não comporta um frame por cena; reduza os itens ou amplie a duração.");
  const frameBase = Math.floor(durationFrames / stages.length);
  const shots = stages.map(({ id }, index) => ({ id, durationFrames: frameBase + (index < durationFrames % stages.length ? 1 : 0) }));

  if (modules != null) assertObjectKeys(modules, moduleKeys, "modules");
  const withPost = selection?.localText || postModuleKeys.some((key) => modules && Object.hasOwn(modules, key));
  const activeModules = modules == null ? null : { assets: [], cast: { people: [] }, narration: null, alignment: null, music: null, sfx: { module: "local-sfx@1", cues: [] }, captions: null, mix: null,
    ...(withPost ? {
      transitions: { module: "ffmpeg-transitions@1", edges: shots.slice(1).map((shot, index) => ({ fromShotId: shots[index].id, toShotId: shot.id, transition: "cut@1", durationFrames: 0 })) },
      graphics: { module: "scene-graphics@1", scenes: [] }, postProduction: { module: "ffmpeg-post@1", operations: [] },
      qa: { module: "master-qa@1", policy: "strict@1", technical: true, semantic: false, assertions: ["video-stream", "duration", "clean-cut"] },
      delivery: { module: "delivery@1", target: "local-output@1", overwrite: false, externalDecision: null }, variants: { module: "format-variants@1", items: [] },
    } : {}), ...structuredClone(modules) };
  if (selection?.localText) {
    activeModules.graphics.scenes = stages.filter((stage) => stage.onScreen.length).map((stage) => ({ shotId: stage.id, renderer: "local-gc@1", text: stage.onScreen.join("\n"), documentAssetId: null }));
    if (!activeModules.graphics.scenes.length) throw new Error("O perfil híbrido exige message, requiredText ou cta para renderizar texto local.");
  }
  if (activeModules?.narration) {
    resolveGoogleVidsVoice(activeModules.narration.voice);
    for (const speaker of activeModules.narration.speakers ?? []) resolveGoogleVidsVoice(speaker.voice);
  }
  if (!Array.isArray(shotBindings)) throw new Error("shotBindings deve ser um array de vínculos por cena.");
  const bindings = new Map();
  for (const binding of shotBindings) {
    assertObjectKeys(binding, ["shotId", "task", "inputAssetIds", "castIds"], "shotBinding");
    if (!shots.some((shot) => shot.id === binding.shotId) || bindings.has(binding.shotId)) throw new Error(`Vínculo de cena inexistente ou duplicado: ${binding.shotId}.`);
    if (!Object.hasOwn(taskNames, binding.task) || !Array.isArray(binding.inputAssetIds) || (binding.castIds != null && !Array.isArray(binding.castIds))) throw new Error(`Vínculo inválido em ${binding.shotId}: declare task e inputAssetIds.`);
    bindings.set(binding.shotId, structuredClone(binding));
  }
  if (bindings.size && !activeModules) throw new Error("Vínculos de referência exigem --modules-file com assets e cast da Receita Mestre.");
  const assets = new Map((activeModules?.assets ?? []).map((asset) => [asset.id, asset]));
  const usedAssets = new Set(shotBindings.flatMap((binding) => binding.inputAssetIds));
  if (brief.references.some((reference) => !usedAssets.has(reference))) throw new Error("As referências do brief precisam corresponder a asset IDs vinculados explicitamente às cenas.");
  for (const id of usedAssets) if (!assets.has(id)) throw new Error(`Asset de referência ausente em modules.assets: ${id}.`);

  const direction = creativeDirection == null ? null : assertCreativeDirectionDecision(creativeDirection);
  if (direction && (direction.envelope.rootScopeId !== rootScopeId || direction.envelope.projectScopeId !== brief.projectId)) throw new Error("Direção criativa atravessa root ou projeto do brief.");
  if (direction?.envelope.preserved.style && direction.envelope.preserved.style !== selected.id) throw new Error("--style diverge do estilo preservado na decisão criativa.");
  const generations = shots.map((shot) => bindings.get(shot.id) ?? { shotId: shot.id, task: "text-to-video", inputAssetIds: [], castIds: [] });
  const compositions = stages.map(({ id, direction: sceneDirection, facts, onScreen }, index) => {
    const generation = generations[index];
    const task = taskNames[generation.task];
    const roles = generation.inputAssetIds.map((assetId) => assets.get(assetId)?.role);
    const localGraphic = activeModules?.graphics?.scenes.find((graphic) => graphic.shotId === id && graphic.renderer === "local-gc@1");
    if (localGraphic && onScreen.length && localGraphic.text !== onScreen.join("\n")) throw new Error(`O texto local da cena ${id} diverge do texto obrigatório do brief.`);
    if (selected.generation?.allowedTasks.length && !selected.generation.allowedTasks.includes(task)) throw new Error(`O estilo não aceita ${task} na cena ${id}.`);
    if (selected.runtimeInputs?.requiredRoles.some((role) => !roles.includes(role))) throw new Error(`Faltam referências obrigatórias do estilo na cena ${id}.`);
    return {
      shotId: id,
      ...composeDirection({ style, techniques, components, onScreenText: localGraphic ? [] : onScreen, task, userPrompt: [
        `Pedido original: ${brief.userBrief}`,
        `Objetivo: ${brief.objective}`,
        ...(brief.audience ? [`Público: ${brief.audience}`] : []),
        ...(brief.genre ? [`Gênero: ${brief.genre}`] : []),
        `Cena ${index + 1}/${stages.length}, ${shots[index].durationFrames}/24 segundos. ${sceneDirection}`,
        `Conteúdo fornecido para esta cena, sem acrescentar fatos: ${JSON.stringify(facts)}.`,
        ...(localGraphic ? ["Não desenhar letras, legendas ou texto no clipe. O texto será composto localmente sobre este vídeo; preserve espaço de leitura no enquadramento."] : [`Texto gráfico em tela, preservado exatamente: ${JSON.stringify(onScreen)}.`]),
        "Os textos são elementos gráficos silenciosos. Sem narração, fala ou canto no Omni. Não inventar nomes, marcas, ofertas ou afirmações.",
        ...(activeModules?.narration ? ["A locução será um arquivo de áudio separado, produzido pelo Google Vids a partir dos blocos literais da receita. Não substituir a voz por texto em tela."] : []),
        ...(roles.some((role) => role === "person-reference" || role === "character-reference") ? ["Somente as pessoas vinculadas a esta cena podem aparecer; enquadramento estável e referência restrita a esta cena."] : []),
        ...(direction ? [`Decisões criativas humanas congeladas: ${JSON.stringify(direction.envelope.selectedAxes)}.`, ...(direction.envelope.editorialChain ? [`Encadeamento editorial aprovado: ${JSON.stringify(direction.envelope.editorialChain)}.`] : [])] : []),
        `Restrições: ${JSON.stringify(brief.restrictions)}. Acessibilidade: ${JSON.stringify(brief.accessibility)}.`,
        `Preferências explícitas: ${JSON.stringify(brief.preferences)}. Idioma: ${brief.language}.`,
      ].join("\n") }),
    };
  });
  const suggestionHash = operationFingerprint({ briefHash: brief.hash, rootScopeId, style, narrative, compositions, modules: activeModules, shotBindings, creativeDirection: direction?.decisionHash ?? null, ...(selection ? { profile: selection.evidence } : {}), ...(binding ? { knowledgeContextBindingHash: binding.hash } : {}) });
  const styleComposition = components == null ? null : bindStyleComposition({ composition: compositions[0].styleComposition, briefHash: brief.hash,
    scope: { rootScopeId, projectScopeId: brief.projectId }, shots: compositions.map(({ shotId, effectivePrompt }) => ({ shotId, prompt: effectivePrompt })) });
  const recipe = {
    schema: "gerador-de-videos/receita@2", ...(activeModules ? { vertical: withPost ? "2.5C" : "2.5B" } : {}), mode: "studio", kind: "peca",
    identity: { id: `sugestao-${suggestionHash.slice(0, 16)}`, revision: 1, name: `Proposta ${selection ? `${profile} · ` : ""}${narrative.structure} · ${brief.briefId}`.slice(0, 160), request: brief.userBrief },
    scope: { rootScopeId, projectScopeId: brief.projectId },
    context: { brief, ...(direction ? { creativeDirection: direction } : {}), ...(binding ? { knowledgeContextBinding: binding } : {}), ...(styleComposition ? { styleComposition } : {}) },
    format: { master: { width: dimensions[0], height: dimensions[1], fps: { numerator: 24, denominator: 1 } } },
    program: { durationPolicy: "fixed-frames", durationFrames, shots },
    ...(activeModules ?? {}),
    videoGeneration: { module: "omni-video@1", ...(activeModules ? {} : { task: "text-to-video" }), shots: compositions.map(({ shotId, effectivePrompt }, index) => ({ ...(activeModules ? generations[index] : { shotId }), prompt: effectivePrompt })) },
    assembly: { module: "ffmpeg-assembly@1", mode: "concat", transition: "cut@1" },
  };
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const preflight = preflightResolvedMasterRecipe(resolved);
  const compiled = preflight.status === "ready" ? compileResolvedMasterRecipe(resolved, { knowledgeContext: context }) : null;
  return {
    schema: "mkt-videos/recipe-brief-suggestion@1", status: "candidate", authority: "none", providerCalls: 0,
    recipe,
    readiness: { structure: "valid", capabilityPreflight: preflight.status, assetBytes: assets.size ? "not-checked" : "not-applicable", runtimeAuthority: "not-checked", blockers: preflight.blockers },
    evidence: { briefHash: brief.hash, suggestionHash, resolvedHash: resolved.hashes.resolvedHash, planFingerprint: compiled?.executionPlan.fingerprint ?? null, structure: narrative.structure, structureReason: narrative.reason, narrative, compositions, ...(selection ? { profile: selection.evidence } : {}), ...(direction ? { creativeDecisionHash: direction.decisionHash, variation: structuredClone(direction.variation), planSeed: direction.planSeed } : {}) },
    limitations: [
      ...(styleComposition ? styleComposition.composition.limitations : []),
      ...(activeModules?.narration ? ["Narração e alinhamento estão planejados; duração e palavras precisam ser medidos nos artefatos reais."] : ["Narração separada não foi incluída."]),
      ...(activeModules?.music ? ["Trilha separada será ajustada à duração congelada da timeline."] : ["Trilha separada não foi incluída."]),
      ...(assets.size ? ["Assets e autorizações declarados foram preservados. Bytes, direitos vigentes e autoridade exigem preflight e runtime guard antes do uso."] : []),
      ...(selection ? selection.evidence.profile.limitations : []),
      selection?.localText ? "Texto local foi vinculado às cenas; legibilidade e fidelidade dos glifos precisam de verificação no master." : "Texto em tela é instrução ao Omni; sua presença física ainda depende de QA após gerar.",
      "A sugestão não consulta nem promove Knowledge e não autoriza execução.",
    ],
  };
}
