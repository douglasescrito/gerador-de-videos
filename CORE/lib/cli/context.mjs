import { createCliReferenceDocs } from "./reference-docs.mjs";
import { studioLocalPath } from '../studio-local-config.mjs';
import { createCliBootstrap } from "./bootstrap.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAllowedOptions, getCommand, listCommands, PROTECTED_COMMAND_IDS } from "./command-registry.mjs";
import { CliError, classifyError, ERROR_CODES } from "./cli-errors.mjs";
import { dicaDeSugestao, distanciaDeEdicao } from "./suggest.mjs";
import { compilarReceita } from "../media-pipeline/recipe-compiler.mjs";
import { handleRecipeCommand } from "./recipe-command-handler.mjs";
import { gerarReceitasCompletas, gerarReceitasDiversificadas, gerarPlanoDiversidade } from "../media-pipeline/recipe-variety-generator.mjs";
import { orientarReceitasComBancoMotion, validarBancoInstrucoesMotion } from "../media-pipeline/motion-instruction-bank.mjs";
import { discoverRecipeFiles } from "../media-pipeline/recipe-shelf.mjs";
import { compilarProductionSpec, resumirEtapasDoPlano } from "../media-pipeline/production-spec.mjs";
import { probeWhisperRuntime } from "../media-pipeline/whisper-runtime.mjs";
import { PROVIDER_WAIT_POLICY, resolveProviderWaitMs } from "../media-pipeline/performance-policy.mjs";
import { googleVidsVoiceCatalog } from "../media-pipeline/google-vids-voices.mjs";
import { createBatchJob, saveBatchJob, runBatchJob } from "../media-pipeline/omni-batch-runner.mjs";
import {
  assertNoBatchReferences,
  createCliBatchGenerate,
  createCliBatchPersist,
  preflightBatchItems,
} from "../media-pipeline/batch-dispatch.mjs";
import { searchOnlineAudio, downloadOnlineAudio } from "../media-pipeline/online-audio-bank.mjs";
import { resolveRuntimeDbFile } from "../media-pipeline/runtime-location.mjs";
import { DIRECT_REQUIRED_BYTES, createDirectAdmission } from "../media-pipeline/direct-admission.mjs";
import { harvestOutputsRoot, writeHarvestedRecipe } from "../media-pipeline/recipe-harvest.mjs";

// Cada invocação possui seus argumentos e closures; pedidos independentes
// não compartilham opções nem um command global mutável.
export async function createCliContext(argv = process.argv.slice(2)) {
  const {
    args,
    command,
    allowedOptions,
    knowledgeActionAllowedOptions,
    parse,
    validateOptions,
    validateKnowledgeActionOptions,
    required,
    explicitBoolean,
    errorMessage,
    resumoCurto,
    displayOptionFlag,
    printCommandHelp,
    printHelp,
    reportError,
  } = createCliBootstrap(argv);
  function isKnowledgePacksInvocation(argv = process.argv.slice(2)) {
    if (String(argv[0] ?? "").trim().toLowerCase() !== "knowledge") {
      return false;
    }
    let action = null;
    for (let index = 1; index < argv.length; index += 1) {
      if (argv[index] !== "--action") continue;
      action = String(argv[index + 1] ?? "").trim().toLowerCase();
    }
    return action === "packs";
  }

  const knowledgePacksBootstrap = isKnowledgePacksInvocation(argv);
  const runtimeModules = knowledgePacksBootstrap
    ? null
    : await Promise.all([
        import("../../scripts/cookie-studio-operations.mjs"),
        import("../media-pipeline/gemini-image.mjs"),
        import("../media-pipeline/omni-video.mjs"),
        import("../media-pipeline/narrated-video.mjs"),
        import("../media-pipeline/commercial.mjs"),
        import("../media-pipeline/index.mjs"),
        import("../../scripts/batch-progress.mjs"),
      ]);

  const {
    createCookieImageAdapter,
    createCookieMusicOperation,
    createCookieStudioOperations,
    createCookieTtsOperation,
    createCookieVideoAdapter,
    createCookieVidsVideoOperation,
    createCookieFlowVideoOperation,
    createCookieFlowImageOperation,
  } = runtimeModules?.[0] ?? {};
  const {
    createGeminiImageEndpointAdapter,
  } = runtimeModules?.[1] ?? {};
  const {
    createOmniVideoEndpointAdapter,
  } = runtimeModules?.[2] ?? {};
  const {
    applyNarrationScript,
    buildNarrationTimingGuide,
    mediaDuration,
    readWordTimeline,
    replaceVideoAudio,
    withNarrationTimingGuide,
  } = runtimeModules?.[3] ?? {};
  const {
    buildCommercialJobs,
    buildNarrationBlockPrompt,
    concatPath,
    concatVideos,
    extractVerifyFrame,
    muxNarration,
    planAssembly,
    scaffoldCommercial,
    trimScene,
    validateSpec,
  } = runtimeModules?.[4] ?? {};
  const {
    ALIGN_DEFAULTS,
    MUSIC_PRESETS,
    adaptExecutionPlanToLegacy,
    alignNarrationBlocks,
    approveDraft,
    animateDraft,
    assertDirectProviderInputPermit,
    assertDirectProviderInputPermitJit,
    assertPaidExecutionAuthorized,
    assertStyleEvidenceReconciliation,
    buildArchiveIndex,
    bindExactGraphicsTextToLocalWords,
    buildEffectiveCapabilityMap,
    loadEffectiveProviderCapabilities,
    createConcurrencyController,
    createResourceBroker,
    createScheduleController,
    buildRuntimeOperationsSnapshot,
    buildDailySummary,
    renderDailySummary,
    capabilityPreflight,
    withResourceLease,
    reportQueueWait,
    DEFAULT_CAPACITY_WAIT_MS,
    classifyRetryReconcile,
    profileForParallel,
    resolveConcurrencyProfile,
    buildHybridCompositionManifestFromPilot,
    auditHybridPilotCandidates,
    buildStyleEvidenceReconciliationReport,
    buildPromptIndex,
    buildStorageReport,
    listBatchJobs,
    loadBatchJob,
    projectBatchAudit,
    pruneBatchJobs,
    summarizeBatchJob,
    buildUsageCostReport,
    groupByPrompt,
    loadIndexCache,
    queryPromptIndex,
    saveIndexCache,
    assembleVideoResearchBatch,
    assertVideoResearchOutputPlanAvailable,
    composeDirection,
    composeHybridVideo,
    compileFilmSpec,
    verifyHybridPilotSelection,
    createDirectProviderInputPermit,
    createDirectProviderInputPermitFromProductionAuthorization,
    createProductionProviderInputAuthorization,
    validateProductionProviderInputAuthorization,
    createVideoResearchOutputPlan,
    createArtifactFromFile,
    createProvenanceManifest,
    createStageReceipt,
    createVideoVariant,
    archiveDailyCommercialWave,
    assembleDailyCommercialWave,
    deliverCollectionToDrive,
    draftScenes,
    estimateExecutionPlanFromReceipts,
    executeAudioRecipe,
    finishVideo,
    fitNarrationToDuration,
    initializeArchiveLifecycle,
    loadFilmSpec,
    listFilmJobs,
    mixAudio,
    muxMasterAudio,
    normalizePipelineMode,
    operationFingerprint,
    listStyleSpecs,
    overrideDraftSceneQa,
    overrideFilmQa,
    planAudioRecipe,
    planFilm,
    prepareExecutorRollout,
    buildAdapterInvocation,
    executeDirectAdapterInvocation,
    probeProviderRegistry,
    projectDirectProviderInputPermit,
    recipeFromReceipt,
    renderMotionGraphics,
    renderStyleCatalogMarkdown,
    reuseApprovedArtifact,
    renderWordCaptions,
    remapCanonicalWordsToClipWindows,
    reconcileFilmVideo,
    resolveAudioRecipe,
    resolveAudioRecipePreset,
    resolveMusicPrompt,
    resolveVideoResearchProfile,
    readVerifiedReceipt,
    readDailyCommercialStatus,
    readFilmPlan,
    readFilmState,
    replaceFileAtomic,
    replaceJsonAtomic,
    prepareDailyCommercialWave,
    requireStudioMode,
    resumeFilm,
    rollbackExecutor,
    runFilm,
    runQa,
    searchArchive,
    setArchiveReview,
    signC2paDelivery,
    statusFilm,
    summarizeArchiveLifecycle,
    verifyExecutionReferenceAuthorizations,
    withVerifiedGraphicsText,
    withVerifiedLocalWordTimeline,
    writeFileAtomic,
    writeJsonAtomic,
    writeStageReceipt,
    markDailyCommercialAttention,
  } = runtimeModules?.[5] ?? {};
  const {
    accumulatedWork,
    buildJobTimingStats,
    estimatePoolEta,
    formatDuration,
    loadLatestBatchBaseline,
    summarizeMilliseconds,
  } = runtimeModules?.[6] ?? {};

  const coreRoot = path.resolve(import.meta.dirname, "../..");
  const runtimeDbFile = resolveRuntimeDbFile({ coreRoot });
  if (process.env.NODE_ENV === "test" && !process.env.MKT_VIDEOS_RUNTIME_DB) {
    process.once("exit", () => {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${runtimeDbFile}${suffix}`, { force: true });
    });
  }

  function createCliResourceBroker() {
    return createResourceBroker({ dbFile: runtimeDbFile });
  }

  // Espera por capacidade é configurável e não é timeout de provedor. Um
  // operador que queira desistir rápido baixa este número; o padrão espera,
  // porque enquanto o job está na fila nenhuma submissão foi feita.
  function resolveCapacityWaitMs() {
    const configured = Number(process.env.MKT_VIDEOS_CAPACITY_WAIT_MS);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_CAPACITY_WAIT_MS;
  }

  async function withCliResourceLease({ resource, resources = null, weight = 1, productionId, clientId = "local", requestId = null, priority = "interactive", admission = null, broker = null }, execute) {
    return withResourceLease({
      broker: broker ?? createCliResourceBroker(),
      requestId,
      productionId,
      clientId,
      priority,
      admission,
      label: productionId,
      capacityWaitMs: resolveCapacityWaitMs(),
      onQueued: reportQueueWait({ label: productionId }),
      resources: resources ?? [{ id: resource, weight: Math.max(1, Number(weight) || 1) }],
    }, (lease) => execute({ signal: lease.signal, lease }));
  }
  // Optional local path only; it does not grant provider-input rights.
  const DEFAULT_COMMERCIAL_LOGO = studioLocalPath('commercialLogo');

  const DEFAULT_BATCH_PARALLEL = 3;
  const MAX_BATCH_PARALLEL = 8;
  const BATCH_TASKS = new Set(["auto", "text_to_video", "image_to_video", "reference_to_video", "edit"]);
  const BATCH_ASPECTS = new Set(["16:9", "9:16"]);

  function authConfiguration(options, fallback = "credential-manager") {
    const requested = options.auth ?? (options.har !== undefined ? "har" : fallback);
    const mode = String(requested).trim().toLowerCase();
    if (mode === "api") throw new Error("Este projeto é cookie-only: --auth api e GEMINI_API_KEY não são permitidos. Use credential-manager ou har.");
    if (!new Set(["credential-manager", "har"]).has(mode)) throw new Error("--auth deve ser credential-manager ou har.");
    if (mode === "har" && options.har === undefined) throw new Error("--auth har exige --har <arquivo.har>.");
    if (mode !== "har" && options.har !== undefined) throw new Error("--har só pode ser usado com --auth har.");
    return { mode, harFile: mode === "har" ? path.resolve(String(options.har)) : null };
  }

  async function cookieRuntime(options) {
    const auth = authConfiguration(options);
    if (auth.harFile) await access(auth.harFile);
    const testEndpoint = process.env.NODE_ENV === "test" ? process.env.MKT_VIDEO_TEST_COOKIE_ENDPOINT : null;
    if (process.env.NODE_ENV === "test" && !testEndpoint) throw new Error("Provider-free test guard: operação de sessão exige MKT_VIDEO_TEST_COOKIE_ENDPOINT local.");
    if (testEndpoint) {
      const parsed = new URL(testEndpoint);
      if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("MKT_VIDEO_TEST_COOKIE_ENDPOINT aceita somente servidor HTTP de loopback em NODE_ENV=test.");
      const imageAdapter = createGeminiImageEndpointAdapter({ endpoint: testEndpoint });
      const videoAdapter = createOmniVideoEndpointAdapter({ endpoint: testEndpoint });
      return { auth, imageAdapter, videoAdapter, operations: { ...createCookieStudioOperations({ harFile: auth.harFile }), imageAdapter, videoAdapter } };
    }
    const imageAdapter = createCookieImageAdapter({ harFile: auth.harFile });
    let videoAdapter = createCookieVideoAdapter({ harFile: auth.harFile });
    if (options['use-flow']) {
      const flowOp = createCookieFlowVideoOperation();
      videoAdapter = {
        generate: async (opts) => {
          try {
            const res = await flowOp({
              provider: 'google-flow-video',
              prompt: opts.prompt,
              outputFile: opts.outputFile,
              aspectRatio: opts.aspectRatio || '16:9',
              references: opts.images || []
            });
            return { file: res.files[0], receiptFile: res.receiptFile, interactionId: null, fileId: null, timings: {} };
          } catch (e) {
            console.error('FLOW ADAPTER ERROR:', e);
            throw e;
          }
        }
      };
    }
    return { auth, imageAdapter, videoAdapter, operations: createCookieStudioOperations({ harFile: auth.harFile }) };
  }

  function productionRetryDecision(error, { attemptNumber, maxAttempts, postAccepted }) {
    const code = String(error?.code ?? "").toLowerCase();
    const kind = String(error?.kind ?? error?.batchFailureKind ?? "").toLowerCase();
    const status = Number(error?.status ?? 0);
    const terminalRejected = !postAccepted && (code === ERROR_CODES.PROVIDER_REJECTED || kind === "provider_rejected" || status === 429);
    const rejectionRetryable = status === 429 || status === 503 || error?.retryable === true;
    const decision = classifyRetryReconcile({
      state: terminalRejected ? "provider_rejected" : "ambiguous",
      attemptNumber,
      maxAttempts,
      terminalRejectionProved: terminalRejected,
      rejectionRetryable,
      retryAfter: error?.retryAfter ?? error?.headers?.["retry-after"] ?? null,
      seed: `${code}:${kind}:${status}`,
    });
    return { retry: decision.createsNewAttempt, reason: decision.reason, dueAt: decision.dueAt, action: decision.action };
  }

  function directProviderInputConfirmed(options, hasInputs) {
    const confirmed = explicitBoolean(
      options["confirm-provider-input"],
      "--confirm-provider-input",
      false,
    );
    if (hasInputs && !confirmed) {
      throw new CliError(
        "Entradas externas exigem --confirm-provider-input true antes do envio ao provedor.",
        { code: ERROR_CODES.CONFIRMATION_REQUIRED, hint: "Repita a mesma invocação com --confirm-provider-input true." },
      );
    }
    return confirmed;
  }

  async function preflightDirectProviderInputs(
    options,
    inputs,
    { purpose, expectedOperations, productionAuthorization = null, productionId = null },
  ) {
    if (inputs.length === 0) return null;
    const permit = productionAuthorization
      ? await createDirectProviderInputPermitFromProductionAuthorization({
          authorization: productionAuthorization,
          productionId,
          inputs,
          purpose,
        })
      : await createDirectProviderInputPermit({
          confirmProviderInput: directProviderInputConfirmed(options, true),
          inputs,
          purpose,
        });
    return assertDirectProviderInputPermit(permit, {
      expectedActor: "local-cli-human",
      expectedInputCount: inputs.length,
      expectedOperations,
    });
  }

  function withDirectProviderInputMetadata(metadata, permit) {
    if (!permit) return metadata;
    return {
      ...metadata,
      providerInputAuthorization: projectDirectProviderInputPermit(permit),
    };
  }

  function plannerMode(value = "canonical") {
    const normalized = String(value).trim().toLowerCase();
    if (normalized !== "canonical") throw new Error("--planner legacy foi removido; toda execução Studio usa o planner canônico.");
    return normalized;
  }

  async function compileGovernedPlan(spec, options = {}) {
    const enrichedSpec = await applyStudioKnowledgeContext(spec, options);
    const providerCapabilities = await loadEffectiveProviderCapabilities();
    let plan = compileFilmSpec(enrichedSpec, { providerCapabilities });
    plan = await verifyExecutionReferenceAuthorizations(plan, {
      referenceIndexFile: options["reference-index"] ? path.resolve(String(options["reference-index"])) : null,
    });
    plan = await estimateExecutionPlanFromReceipts(plan, {
      root: path.resolve(String(options["eta-root"] ?? path.join(coreRoot, "outputs"))),
      minSamples: Number(options["min-samples"] ?? 3),
    });
    return plan;
  }

  async function applyStudioKnowledgeContext(spec, options = {}) {
    if (!options["knowledge-context"]) return spec;
    const input = await readJsonFile(options["knowledge-context"], "--knowledge-context");
    const candidate = input.value?.context ?? input.value;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("--knowledge-context deve apontar para knowledge-context@1 ou para o resultado retrieval-shadow.");
    if (spec?.knowledgeContext != null && operationFingerprint(spec.knowledgeContext) !== operationFingerprint(candidate)) {
      throw new Error("--knowledge-context diverge do contexto inline do filme.");
    }
    return { ...spec, knowledgeContext: candidate };
  }

  async function planStudioFilm({ spec, specFile, options, dryRun = false } = {}) {
    const enrichedSpec = await applyStudioKnowledgeContext(spec, options);
    const selectedPlanner = plannerMode(options.planner);
    const outputsRoot = options["out-root"] ? path.resolve(String(options["out-root"])) : null;
    const executionPlan = await compileGovernedPlan(enrichedSpec, options);
    if (executionPlan.governance?.executorCompatibility?.supported === false) {
      if (!dryRun) {
        throw new Error("O plano canônico não é compatível com o executor legado; mantenha-o provider-free com dry-run/compile.");
      }
      return { plan: executionPlan, state: { stateFile: null }, dryRun: true };
    }
    const legacySpec = adaptExecutionPlanToLegacy(executionPlan);
    return planFilm({ spec: legacySpec, specFile, outputsRoot, dryRun, executionPlan });
  }

  async function assertStatePaidAuthorization(stateFile, options) {
    const state = await readFilmState(stateFile);
    const providerCapabilities = await loadEffectiveProviderCapabilities();
    const plan = await readFilmPlan(state.planFile, { providerCapabilities });
    return assertPaidExecutionAuthorized(plan.executionPlan ?? plan, {
      providerCapabilities,
      confirmFingerprint: options["confirm-fingerprint"] ?? null,
      allowConceptPilot: explicitBoolean(options["confirm-concept-pilot"], "--confirm-concept-pilot", false),
    });
  }

  function studioMode(options, feature) {
    return requireStudioMode(options.mode, feature);
  }

  function promptComposition(prompt, options) {
    const mode = normalizePipelineMode(options.mode ?? "raw");
    if (options.style != null) requireStudioMode(mode, "--style");
    const composition = composeDirection({ userPrompt: prompt, style: options.style ?? null });
    return { mode, composition };
  }

  function structuredApiError(payload, status) {
    const candidate = payload?.error ?? payload?.message;
    if (typeof candidate === "string") return { message: candidate };
    if (candidate && typeof candidate === "object") {
      return {
        message: String(candidate.message ?? `HTTP ${status}`),
        ...(candidate.code != null ? { code: candidate.code } : {}),
        ...(candidate.status != null ? { status: candidate.status } : {}),
      };
    }
    return { message: `HTTP ${status}` };
  }

  async function optionText(inlineValue, fileValue, inlineLabel, fileLabel, baseDirectory = process.cwd()) {
    if (inlineValue !== undefined && fileValue !== undefined) {
      throw new Error(`Use somente ${inlineLabel} ou ${fileLabel}, não ambos.`);
    }
    if (fileValue !== undefined) {
      if (fileValue === true) throw new Error(`${fileLabel} exige um caminho de arquivo.`);
      const file = path.resolve(baseDirectory, String(fileValue));
      const value = await readFile(file, "utf8");
      return required(value, fileLabel);
    }
    if (inlineValue === true) throw new Error(`${inlineLabel} exige um texto.`);
    return required(inlineValue, inlineLabel);
  }

  const officialDocs = createCliReferenceDocs();

  function timestamp() {
    return new Date().toISOString().replace(/[-:.]/g, "");
  }

  function defaultOutput(kind) {
    return path.join(coreRoot, "outputs", `omni-${kind}-${timestamp()}.mp4`);
  }

  function defaultImageOutput() {
    return path.join(coreRoot, "outputs", `gemini-image-${timestamp()}.png`);
  }

  function slug(value, fallback) {
    const normalized = String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return normalized.slice(0, 72) || fallback;
  }

  function collectionTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  }

  function collectionSlug(value, fallback = "video") {
    return slug(value, fallback).slice(0, 56) || fallback;
  }

  async function nextCollectionPartNumber(videosDir) {
    try {
      const entries = await readdir(videosDir, { withFileTypes: true });
      const numbers = entries
        .filter((entry) => entry.isFile())
        .map((entry) => /^parte-(\d{3,})\.mp4$/i.exec(entry.name)?.[1])
        .filter(Boolean)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0);
      return numbers.length ? Math.max(...numbers) + 1 : 1;
    } catch (error) {
      if (error?.code === "ENOENT") return 1;
      throw error;
    }
  }

  async function collectionOutputPlan({ options, text, kind }) {
    if (options.out !== undefined) {
      return { outputFile: path.resolve(String(options.out)), receiptFile: null, collection: null };
    }
    const explicit = options.collection !== undefined;
    const name = explicit
      ? collectionSlug(required(options.collection, "--collection"), kind)
      : `${collectionTimestamp()}-${collectionSlug(text, kind)}`;
    const root = path.join(coreRoot, "outputs", name);
    const videosDir = path.join(root, "videos-soltos");
    const receiptsDir = path.join(root, "receitas");
    const finalDir = path.join(root, "videos-unidos");
    const metadataDir = path.join(root, "metadados");
    await Promise.all([videosDir, receiptsDir, finalDir, metadataDir].map((directory) => mkdir(directory, { recursive: true })));
    const partNumber = await nextCollectionPartNumber(videosDir);
    const partName = `parte-${String(partNumber).padStart(3, "0")}.mp4`;
    return {
      outputFile: path.join(videosDir, partName),
      receiptFile: path.join(receiptsDir, `${partName}.receipt.json`),
      collection: {
        schema: "mkt-videos/collection-plan@1",
        name,
        mode: normalizePipelineMode(options.mode ?? "raw"),
        root,
        videosDir,
        receiptsDir,
        finalDir,
        metadataDir,
        partNumber,
        finalFile: path.join(finalDir, `${name}-partes-juntas.mp4`),
        assemblyReceipt: path.join(receiptsDir, `${name}-partes-juntas-${String(partNumber).padStart(3, "0")}.assembly.receipt.json`),
        concatList: path.join(metadataDir, "concat.txt"),
        manifestFile: path.join(root, "manifest.json"),
      },
    };
  }

  function narratedOutputPlan(plan) {
    if (!plan.collection) {
      const parsed = path.parse(plan.outputFile);
      return {
        file: path.join(parsed.dir, `${parsed.name}.narrado${parsed.ext || ".mp4"}`),
        receipt: path.join(parsed.dir, `${parsed.name}.narrado.receipt.json`),
        metadata: path.join(parsed.dir, `${parsed.name}.narracao.json`),
      };
    }
    const base = `parte-${String(plan.collection.partNumber).padStart(3, "0")}`;
    return {
      file: path.join(plan.collection.root, "videos-narrados", `${base}.mp4`),
      receipt: path.join(plan.collection.receiptsDir, `${base}.narracao.receipt.json`),
      metadata: path.join(plan.collection.metadataDir, `${base}.narracao.json`),
    };
  }

  async function assertAvailable(file) {
    try {
      await access(file);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    throw new Error(`A saída já existe e não será sobrescrita: ${file}`);
  }

  function ffmpegConcatPath(file) {
    return path.resolve(file).replace(/\\/g, "/").replace(/'/g, "'\\''");
  }

  async function runFfmpegConcat(listFile, outputFile) {
    await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputFile], {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (status) => {
        if (status === 0) resolve();
        else reject(new Error(`ffmpeg concat falhou (${status}): ${stderr.trim()}`));
      });
    });
  }

  async function rebuildCollectionFinal(collection, options = {}) {
    const { rebuildDirectCollection } = await import("../media-pipeline/collection-final.mjs");
    return rebuildDirectCollection(collection, { ...options, concat: runFfmpegConcat });
  }

  function arrayValue(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function batchDeclaresProviderInputs(jobs) {
    return jobs.some((job) => {
      if (!job || typeof job !== "object" || Array.isArray(job)) return false;
      return arrayValue(job.images ?? job.image).length > 0
        || (job.video !== undefined && job.video !== null);
    });
  }

  async function readJsonFile(file, label) {
    const resolved = path.resolve(required(file, label));
    const text = await readFile(resolved, "utf8");
    try {
      return { file: resolved, value: JSON.parse(text) };
    } catch (error) {
      throw new Error(`${label} não contém JSON válido: ${error.message}`);
    }
  }

  // Pool do lote. Com `controller`, a permissão de começar mais um item passa a
  // ser dele: o teto continua sendo o `--parallel` pedido, mas a largura recua
  // sozinha quando o provedor começa a recusar. O pool nunca reenvia nada — item
  // que falhou continua falhado e some do caminho.
  async function runPool(items, limit, worker, { controller = null } = {}) {
    const concurrency = Math.min(limit, items.length);
    const results = new Array(items.length);
    let next = 0;
    async function loop() {
      while (next < items.length) {
        controller?.observeQueue(items.length - next);
        const permit = controller ? await controller.acquire() : null;
        // A checagem do while aconteceu antes do await: outro loop pode ter
        // levado o último item enquanto este esperava o permit. Reconfirmar aqui
        // evita reclamar um índice além da lista e pegar `undefined`.
        if (next >= items.length) {
          if (permit) controller.release(permit, { outcome: "skipped" });
          break;
        }
        const index = next;
        next += 1;
        try {
          results[index] = await worker(items[index], index);
        } finally {
          if (permit) controller.release(permit, { outcome: results[index]?.ok === false ? "provider_rejected" : "completed" });
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => loop()));
    return results;
  }

  function batchParallel(value) {
    const parallel = Number(value ?? DEFAULT_BATCH_PARALLEL);
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > MAX_BATCH_PARALLEL) {
      throw new Error(`--parallel deve ser um número inteiro entre 1 e ${MAX_BATCH_PARALLEL}.`);
    }
    return parallel;
  }

  function deliveryAccel(value) {
    if (value === undefined || value === null) return "cpu";
    const accel = String(value).trim().toLowerCase();
    if (!["cpu", "nvenc", "auto"].includes(accel)) {
      throw new Error("--accel deve ser cpu, nvenc ou auto.");
    }
    return accel;
  }

  function jobValue(value, label) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} deve ser texto não vazio.`);
    return value;
  }

  function assertBatchInputs(task, images, referenceVideo, label) {
    if (images.length > 4) throw new Error(`${label} aceita no máximo quatro imagens.`);
    if (task === "text_to_video" && (images.length || referenceVideo)) throw new Error(`${label}: text_to_video não aceita referências.`);
    if (task === "image_to_video" && (images.length < 1 || images.length > 2 || referenceVideo)) throw new Error(`${label}: image_to_video exige uma ou duas imagens e nenhum vídeo.`);
    if (task === "reference_to_video" && (!images.length || referenceVideo)) throw new Error(`${label}: reference_to_video exige imagens e nenhum vídeo.`);
    if (task === "edit" && (!referenceVideo || images.length)) throw new Error(`${label}: edit exige exatamente um vídeo e nenhuma imagem.`);
  }

  async function prepareBatchJobs(jobs, jobsFile, outDir, options) {
    const jobsDirectory = path.dirname(jobsFile);
    const prepared = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const number = index + 1;
      const prefix = `job ${number}`;
      if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error(`${prefix} deve ser um objeto JSON válido.`);
      if (job.id !== undefined && !["string", "number"].includes(typeof job.id)) throw new Error(`${prefix}.id deve ser texto ou número.`);
      if (job.name !== undefined && typeof job.name !== "string") throw new Error(`${prefix}.name deve ser texto.`);

      const promptFile = job["prompt-file"] ?? job.promptFile;
      jobValue(job.prompt, `${prefix}.prompt`);
      jobValue(promptFile, `${prefix}.promptFile`);
      const userPrompt = await optionText(job.prompt, promptFile, `${prefix}.prompt`, `${prefix}.promptFile`, jobsDirectory);
      const mode = normalizePipelineMode(job.mode ?? options.mode ?? "raw");
      const style = job.style ?? options.style ?? null;
      if (style != null) requireStudioMode(mode, `${prefix}.style`);
      const composition = composeDirection({ userPrompt, style });
      const prompt = composition.effectivePrompt;

      const rawImages = arrayValue(job.images ?? job.image);
      const images = rawImages.map((file, imageIndex) => {
        const value = jobValue(file, `${prefix}.images[${imageIndex}]`);
        return path.resolve(jobsDirectory, value);
      });
      const videoValue = jobValue(job.video, `${prefix}.video`);
      const referenceVideo = videoValue ? path.resolve(jobsDirectory, videoValue) : null;

      const task = job.task ?? (referenceVideo ? "edit" : images.length > 0 ? "reference_to_video" : "text_to_video");
      if (typeof task !== "string" || !BATCH_TASKS.has(task)) throw new Error(`${prefix}.task inválida: ${String(task)}.`);
      assertBatchInputs(task, images, referenceVideo, prefix);
      const aspectRatio = job.aspect ?? options.aspect ?? "16:9";
      if (!BATCH_ASPECTS.has(aspectRatio)) throw new Error(`${prefix}.aspect inválido: ${String(aspectRatio)}.`);

      const timeoutMs = resolveProviderWaitMs("omni", job.timeout ?? options.timeout ?? PROVIDER_WAIT_POLICY.omni.defaultMs);
      const pollIntervalMs = Number(job.poll ?? options.poll ?? 5_000);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`${prefix}.timeout deve ser positivo.`);
      if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) throw new Error(`${prefix}.poll não pode ser negativo.`);

      const label = slug(job.id ?? job.name ?? prefix, prefix.replace(" ", "-"));
      const outValue = jobValue(job.out, `${prefix}.out`);
      const outputFile = path.resolve(String(outValue ?? path.join(outDir, `${String(number).padStart(2, "0")}-${label}.mp4`)));
      prepared.push({ job, index, number, label, prompt, userPrompt, mode, composition, images, referenceVideo, task, aspectRatio, timeoutMs, pollIntervalMs, outputFile });
    }
    return prepared;
  }

  function assertUniqueBatchDestinations(jobs, summaryFile) {
    const seen = new Map();
    for (const job of jobs) {
      for (const [kind, file] of [["vídeo", job.outputFile], ["recibo", `${job.outputFile}.receipt.json`]]) {
        const key = path.normalize(file).toLowerCase();
        const previous = seen.get(key);
        if (previous) throw new Error(`Destino duplicado no batch: ${file} (${previous} e job ${job.number} ${kind}).`);
        seen.set(key, `job ${job.number} ${kind}`);
      }
    }
    const summaryKey = path.normalize(summaryFile).toLowerCase();
    if (seen.has(summaryKey)) throw new Error(`Destino do batch colide com summary.json: ${summaryFile}.`);
  }

  function healthBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }

  function finiteDuration(value, fallback = null) {
    return Number.isFinite(value) && value >= 0 ? Number(value) : fallback;
  }

  function finiteNumber(value) {
    return Number.isFinite(value) && value >= 0 ? Number(value) : null;
  }

  function firstFiniteNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = finiteNumber(Number(value));
      if (number !== null) return number;
    }
    return null;
  }

  function extractTokenUsage(receipt) {
    const candidates = [
      receipt?.providerResponse?.usageMetadata,
      receipt?.providerResponse?.usage,
      receipt?.providerResponse?.tokenUsage,
      receipt?.metadata?.usageMetadata,
      receipt?.cost?.usageMetadata,
      receipt?.cost?.tokens,
    ].filter((candidate) => candidate && typeof candidate === "object");

    for (const usage of candidates) {
      const inputTokens = firstFiniteNumber(
        usage.inputTokens,
        usage.input_tokens,
        usage.promptTokens,
        usage.prompt_tokens,
        usage.promptTokenCount,
        usage.inputTokenCount,
      );
      const outputTokens = firstFiniteNumber(
        usage.outputTokens,
        usage.output_tokens,
        usage.completionTokens,
        usage.completion_tokens,
        usage.candidatesTokenCount,
        usage.outputTokenCount,
      );
      const totalTokens = firstFiniteNumber(
        usage.totalTokens,
        usage.total_tokens,
        usage.totalTokenCount,
        inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null,
      );
      if (inputTokens !== null || outputTokens !== null || totalTokens !== null) {
        return {
          available: true,
          inputTokens,
          outputTokens,
          totalTokens,
          source: "providerResponse.usageMetadata",
          raw: usage,
        };
      }
    }

    return {
      available: false,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      note: "indisponível: o endpoint Omni não retornou contagem de tokens nesta operação",
    };
  }

  function stageSummary(timings) {
    const stages = [
      ["preparationMs", "preparação local"],
      ["requestMs", "envio/aceite Omni"],
      ["providerProcessingMs", "processamento Omni"],
      ["downloadMs", "download do MP4"],
      ["artifactCommitMs", "gravação do MP4"],
      ["receiptMs", "gravação do recibo"],
      ["localFinalizeMs", "finalização local"],
      ["videoDeliveryMs", "entrega do vídeo"],
      ["totalMs", "total até o recibo"],
    ];
    return stages.map(([field, label]) => {
      const milliseconds = finiteNumber(Number(timings?.[field]));
      return {
        field,
        label,
        milliseconds,
        duration: milliseconds === null ? "indisponível" : formatDuration(milliseconds),
      };
    });
  }

  function deliverySummary(result) {
    const receipt = result?.receipt ?? {};
    const timings = result?.timings ?? receipt.timings ?? {};
    return {
      schema: "mkt-videos/delivery-summary@1",
      operation: receipt.operation ?? null,
      model: receipt.model ?? null,
      tokens: extractTokenUsage(receipt),
      timings: {
        unit: timings.unit ?? "milliseconds",
        startedAt: timings.operationStartedAt ?? receipt.startedAt ?? null,
        completedAt: timings.completedAt ?? receipt.completedAt ?? null,
        polls: Number.isInteger(timings.polls) ? timings.polls : null,
        stages: stageSummary(timings),
      },
    };
  }

  function terminalText(value, fallback = "job") {
    const normalized = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    return (normalized || fallback).slice(0, 72);
  }

  function progressFailureLabel(error) {
    const classification = error?.kind ?? error?.code ?? error?.status;
    return classification == null ? "erro de geração" : terminalText(classification, "erro de geração");
  }

  function ffmpegPreflight() {
    try {
      const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", timeout: 5_000 });
      if (probe.error || probe.status !== 0) return { available: false, version: null };
      const firstLine = String(probe.stdout ?? "").split(/\r?\n/, 1)[0];
      const match = /ffmpeg version (\S+)/.exec(firstLine);
      return { available: true, version: match ? match[1] : null };
    } catch {
      return { available: false, version: null };
    }
  }

  async function cliVersion() {
    try {
      const raw = await readFile(path.join(coreRoot, "package.json"), "utf8");
      return JSON.parse(raw).version ?? null;
    } catch {
      return null;
    }
  }

  // Fatos locais que não dependem do endpoint: úteis mesmo quando o app local
  // está fora do ar, para um agente decidir se pode operar antes de tentar.
  async function localPreflight() {
    const [major] = process.versions.node.split(".").map(Number);
    return {
      cliVersion: await cliVersion(),
      node: { version: process.version, required: ">=22", satisfies: Number.isFinite(major) && major >= 22 },
      ffmpeg: ffmpegPreflight(),
      whisper: await probeWhisperRuntime(),
      manifest: { commandCount: listCommands().length, protectedCommands: [...PROTECTED_COMMAND_IDS] },
    };
  }

  async function runDoctor(endpoint) {
    const local = await localPreflight();
    const capabilityMap = await buildEffectiveCapabilityMap();
    const capabilityExpiry = capabilityMap.capabilities
      .filter((entry) => entry.expiresAt != null)
      .map((entry) => ({ id: entry.id, status: entry.status, expiresAt: entry.expiresAt, freshness: entry.freshness }))
      .sort((left, right) => String(left.expiresAt).localeCompare(String(right.expiresAt)));
    try {
      const response = await fetch(`${endpoint}/api/health`, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        console.log(JSON.stringify({ endpoint, reachable: true, configured: null, ready: null, health: "not_exposed", httpStatus: 404, local, capabilityExpiry }, null, 2));
        process.exitCode = 1;
        return;
      }
      const ready = healthBoolean(payload.ready);
      const configured = healthBoolean(payload.configured);
      const health = payload.upstreamHealth === "not_exposed" ? "not_exposed" : response.ok && ready === true ? "ready" : response.ok ? "not_ready" : "error";
      const result = {
        endpoint,
        reachable: true,
        configured,
        ready,
        health,
        httpStatus: response.status,
        provider: payload.provider ?? null,
        model: payload.model ?? null,
        ...(payload.error || !response.ok ? { error: structuredApiError(payload, response.status) } : {}),
        docs: officialDocs.videoGeneration,
        limitations: officialDocs.limitations,
        local,
        capabilityExpiry,
      };
      console.log(JSON.stringify(result, null, 2));
      if (!response.ok || ready !== true) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({
        endpoint,
        reachable: false,
        configured: null,
        ready: false,
        health: "unreachable",
        error: { message: errorMessage(error) },
        local,
        capabilityExpiry,
      }, null, 2));
      process.exitCode = 1;
    }
  }

  // A primeira frase do resumo. O resto do detalhe fica no --help do próprio
  // comando, que já é bom.

  /**
   * Caminho padrão do catálogo canônico mantido pelo desktop.
   *
   * A mineração lê este banco em modo somente leitura em vez de construir um
   * segundo índice: `user_prompt`, `effective_prompt`, `task`, `aspect_ratio` e o
   * veredito humano já vivem aqui, e um índice paralelo repetiria o problema de
   * catálogo duplicado que a Fase 0 mapeou.
   */
  function caminhoDoCatalogoCanonico(opcao) {
    if (opcao) return path.resolve(String(opcao));
    const base = process.env.LOCALAPPDATA ?? process.env.USERPROFILE ?? coreRoot;
    return path.join(base, "GeradorDeVideos", "Acervo", "catalog.sqlite");
  }

  /** Projeta o acervo para a mineração da Fase 9. Nunca escreve no catálogo. */
  async function lerAcervoParaMineracao(catalogFile) {
    const { DatabaseSync } = await import("node:sqlite");
    const absoluto = caminhoDoCatalogoCanonico(catalogFile);
    if (!existsSync(absoluto)) {
      throw new CliError(`Catálogo do acervo não encontrado em ${absoluto}.`, {
        code: ERROR_CODES.DEPENDENCY_MISSING,
        hint: "Abra a Mesa uma vez para indexar o acervo, ou aponte --catalog para o arquivo correto.",
      });
    }
    const db = new DatabaseSync(absoluto, { readOnly: true });
    try {
      return db.prepare(`SELECT a.user_prompt userPrompt, a.effective_prompt effectivePrompt,
      a.direction_preset directionPreset, a.task, a.aspect_ratio aspectRatio,
      (SELECT status FROM reviews WHERE rel_path=a.rel_path) review
      FROM assets a`).all();
    } finally { db.close(); }
  }

  /** Lê likes de vídeos e receitas do mesmo SQLite, projetados por contagem. */
  async function lerPreferenciasFavoritas(favoritosDbOption) {
    if (!favoritosDbOption) return null;
    const { listArchiveFavorites, listRecipePreferences } = await import("../media-pipeline/archive-index.mjs");
    const { DatabaseSync } = await import("node:sqlite");
    const favDb = path.resolve(String(favoritosDbOption));
    const favs = listArchiveFavorites({ dbFile: favDb, root: path.join(coreRoot, "outputs") });
    const recipePreferences = listRecipePreferences({ dbFile: favDb, likedOnly: true });
    let db = null;
    try {
      db = new DatabaseSync(favDb, { readOnly: true });
      const styleCounts = new Map();
      const combinationCounts = new Map();
      const instructionCounts = new Map();
      for (const fav of favs) {
        const row = db.prepare("SELECT style FROM receipts WHERE path=?").get(fav.receiptPath);
        const estilo = row?.style ?? null;
        if (estilo) styleCounts.set(estilo, (styleCounts.get(estilo) ?? 0) + 1);
      }
      for (const preference of recipePreferences) {
        if (preference.style) styleCounts.set(preference.style, (styleCounts.get(preference.style) ?? 0) + 1);
        if (preference.motionCombinationId) combinationCounts.set(preference.motionCombinationId, (combinationCounts.get(preference.motionCombinationId) ?? 0) + 1);
        for (const instructionId of preference.motionInstructionIds ?? []) {
          instructionCounts.set(instructionId, (instructionCounts.get(instructionId) ?? 0) + 1);
        }
      }
      db.close();
      db = null;
      const ordered = (counts) => [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .map(([id]) => id);
      return {
        estilos: ordered(styleCounts),
        motionCombinationIds: ordered(combinationCounts),
        motionInstructionIds: ordered(instructionCounts),
        videoLikes: favs.length,
        recipeLikes: recipePreferences.length,
      };
    } finally {
      db?.close();
    }
  }

  /**
   * Carrega o banco candidato somente quando a pessoa o informa explicitamente.
   * A attestation irmã é obrigatória e o hash é calculado sobre os bytes lidos.
   */
  async function carregarBancoMotion(motionBankOption, motionValidationOption) {
    if (!motionBankOption) return null;
    const bankFile = path.resolve(String(motionBankOption));
    const validationFile = path.resolve(String(motionValidationOption ?? path.join(path.dirname(bankFile), "validation.json")));
    const [bankBytes, validationBytes] = await Promise.all([
      readFile(bankFile),
      readFile(validationFile),
    ]);
    const bank = JSON.parse(bankBytes.toString("utf8"));
    const validation = JSON.parse(validationBytes.toString("utf8"));
    const bankSha256 = createHash("sha256").update(bankBytes).digest("hex");
    return {
      bankFile,
      validationFile,
      validatedBank: validarBancoInstrucoesMotion({ bank, validation, bankSha256 }),
    };
  }

  function anexarOrientacaoMotion(geradas, motionBank, seed, filme, preferences = null) {
    if (!motionBank) return geradas;
    const receitas = filme ? geradas.receitas : geradas.propostas;
    return {
      ...geradas,
      motionGuidance: orientarReceitasComBancoMotion({
        validatedBank: motionBank.validatedBank,
        recipeIds: receitas.map((receita) => receita.id),
        seed,
        preferredCombinationIds: preferences?.motionCombinationIds ?? [],
      }),
    };
  }

  return Object.freeze({
    spawn,
    spawnSync,
    createHash,
    randomUUID,
    existsSync,
    rmSync,
    access,
    copyFile,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
    path,
    buildAllowedOptions,
    getCommand,
    listCommands,
    PROTECTED_COMMAND_IDS,
    CliError,
    classifyError,
    ERROR_CODES,
    dicaDeSugestao,
    distanciaDeEdicao,
    compilarReceita,
    handleRecipeCommand,
    gerarReceitasCompletas,
    gerarReceitasDiversificadas,
    gerarPlanoDiversidade,
    orientarReceitasComBancoMotion,
    validarBancoInstrucoesMotion,
    discoverRecipeFiles,
    compilarProductionSpec,
    resumirEtapasDoPlano,
    probeWhisperRuntime,
    PROVIDER_WAIT_POLICY,
    resolveProviderWaitMs,
    googleVidsVoiceCatalog,
    createBatchJob,
    saveBatchJob,
    runBatchJob,
    assertNoBatchReferences,
    createCliBatchGenerate,
    createCliBatchPersist,
    preflightBatchItems,
    searchOnlineAudio,
    downloadOnlineAudio,
    resolveRuntimeDbFile,
    DIRECT_REQUIRED_BYTES,
    createDirectAdmission,
    harvestOutputsRoot,
    writeHarvestedRecipe,
    isKnowledgePacksInvocation,
    knowledgePacksBootstrap,
    runtimeModules,
    createCookieImageAdapter,
    createCookieMusicOperation,
    createCookieStudioOperations,
    createCookieTtsOperation,
    createCookieVideoAdapter,
    createCookieVidsVideoOperation,
    createCookieFlowVideoOperation,
    createCookieFlowImageOperation,
    createGeminiImageEndpointAdapter,
    createOmniVideoEndpointAdapter,
    applyNarrationScript,
    buildNarrationTimingGuide,
    mediaDuration,
    readWordTimeline,
    replaceVideoAudio,
    withNarrationTimingGuide,
    buildCommercialJobs,
    buildNarrationBlockPrompt,
    concatPath,
    concatVideos,
    extractVerifyFrame,
    muxNarration,
    planAssembly,
    scaffoldCommercial,
    trimScene,
    validateSpec,
    ALIGN_DEFAULTS,
    MUSIC_PRESETS,
    adaptExecutionPlanToLegacy,
    alignNarrationBlocks,
    approveDraft,
    animateDraft,
    assertDirectProviderInputPermit,
    assertDirectProviderInputPermitJit,
    assertPaidExecutionAuthorized,
    assertStyleEvidenceReconciliation,
    buildArchiveIndex,
    bindExactGraphicsTextToLocalWords,
    buildEffectiveCapabilityMap,
    loadEffectiveProviderCapabilities,
    createConcurrencyController,
    createResourceBroker,
    createScheduleController,
    buildRuntimeOperationsSnapshot,
    buildDailySummary,
    renderDailySummary,
    capabilityPreflight,
    withResourceLease,
    reportQueueWait,
    DEFAULT_CAPACITY_WAIT_MS,
    classifyRetryReconcile,
    profileForParallel,
    resolveConcurrencyProfile,
    buildHybridCompositionManifestFromPilot,
    auditHybridPilotCandidates,
    buildStyleEvidenceReconciliationReport,
    buildPromptIndex,
    buildStorageReport,
    listBatchJobs,
    loadBatchJob,
    projectBatchAudit,
    pruneBatchJobs,
    summarizeBatchJob,
    buildUsageCostReport,
    groupByPrompt,
    loadIndexCache,
    queryPromptIndex,
    saveIndexCache,
    assembleVideoResearchBatch,
    assertVideoResearchOutputPlanAvailable,
    composeDirection,
    composeHybridVideo,
    compileFilmSpec,
    verifyHybridPilotSelection,
    createDirectProviderInputPermit,
    createDirectProviderInputPermitFromProductionAuthorization,
    createProductionProviderInputAuthorization,
    validateProductionProviderInputAuthorization,
    createVideoResearchOutputPlan,
    createArtifactFromFile,
    createProvenanceManifest,
    createStageReceipt,
    createVideoVariant,
    archiveDailyCommercialWave,
    assembleDailyCommercialWave,
    deliverCollectionToDrive,
    draftScenes,
    estimateExecutionPlanFromReceipts,
    executeAudioRecipe,
    finishVideo,
    fitNarrationToDuration,
    initializeArchiveLifecycle,
    loadFilmSpec: async (file, options = {}) => {
      const context = await applyStudioKnowledgeContext({}, options);
      return loadFilmSpec(file, { knowledgeContext: context.knowledgeContext ?? null });
    },
    listFilmJobs,
    mixAudio,
    muxMasterAudio,
    normalizePipelineMode,
    operationFingerprint,
    listStyleSpecs,
    overrideDraftSceneQa,
    overrideFilmQa,
    planAudioRecipe,
    planFilm,
    prepareExecutorRollout,
    buildAdapterInvocation,
    executeDirectAdapterInvocation,
    probeProviderRegistry,
    projectDirectProviderInputPermit,
    recipeFromReceipt,
    renderMotionGraphics,
    renderStyleCatalogMarkdown,
    reuseApprovedArtifact,
    renderWordCaptions,
    remapCanonicalWordsToClipWindows,
    reconcileFilmVideo,
    resolveAudioRecipe,
    resolveAudioRecipePreset,
    resolveMusicPrompt,
    resolveVideoResearchProfile,
    readVerifiedReceipt,
    readDailyCommercialStatus,
    readFilmPlan,
    readFilmState,
    replaceFileAtomic,
    replaceJsonAtomic,
    prepareDailyCommercialWave,
    requireStudioMode,
    resumeFilm,
    rollbackExecutor,
    runFilm,
    runQa,
    searchArchive,
    setArchiveReview,
    signC2paDelivery,
    statusFilm,
    summarizeArchiveLifecycle,
    verifyExecutionReferenceAuthorizations,
    withVerifiedGraphicsText,
    withVerifiedLocalWordTimeline,
    writeFileAtomic,
    writeJsonAtomic,
    writeStageReceipt,
    markDailyCommercialAttention,
    accumulatedWork,
    buildJobTimingStats,
    estimatePoolEta,
    formatDuration,
    loadLatestBatchBaseline,
    summarizeMilliseconds,
    coreRoot,
    runtimeDbFile,
    createCliResourceBroker,
    resolveCapacityWaitMs,
    withCliResourceLease,
    DEFAULT_COMMERCIAL_LOGO,
    args,
    command,
    parse,
    allowedOptions,
    knowledgeActionAllowedOptions,
    validateOptions,
    validateKnowledgeActionOptions,
    DEFAULT_BATCH_PARALLEL,
    MAX_BATCH_PARALLEL,
    BATCH_TASKS,
    BATCH_ASPECTS,
    required,
    authConfiguration,
    cookieRuntime,
    explicitBoolean,
    productionRetryDecision,
    directProviderInputConfirmed,
    preflightDirectProviderInputs,
    withDirectProviderInputMetadata,
    plannerMode,
    compileGovernedPlan,
    applyStudioKnowledgeContext,
    planStudioFilm,
    assertStatePaidAuthorization,
    studioMode,
    promptComposition,
    structuredApiError,
    optionText,
    officialDocs,
    timestamp,
    defaultOutput,
    defaultImageOutput,
    slug,
    collectionTimestamp,
    collectionSlug,
    nextCollectionPartNumber,
    collectionOutputPlan,
    narratedOutputPlan,
    assertAvailable,
    ffmpegConcatPath,
    runFfmpegConcat,
    rebuildCollectionFinal,
    arrayValue,
    batchDeclaresProviderInputs,
    readJsonFile,
    runPool,
    batchParallel,
    deliveryAccel,
    jobValue,
    assertBatchInputs,
    prepareBatchJobs,
    assertUniqueBatchDestinations,
    healthBoolean,
    errorMessage,
    finiteDuration,
    finiteNumber,
    firstFiniteNumber,
    extractTokenUsage,
    stageSummary,
    deliverySummary,
    terminalText,
    progressFailureLabel,
    ffmpegPreflight,
    cliVersion,
    localPreflight,
    runDoctor,
    resumoCurto,
    displayOptionFlag,
    printCommandHelp,
    printHelp,
    caminhoDoCatalogoCanonico,
    lerAcervoParaMineracao,
    lerPreferenciasFavoritas,
    carregarBancoMotion,
    anexarOrientacaoMotion,
    reportError,
  });
}
