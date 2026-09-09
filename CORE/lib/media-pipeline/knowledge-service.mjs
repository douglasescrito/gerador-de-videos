import { isPathWithin, realPathThroughExistingAncestor, resolveKnowledgeExportFile } from "./knowledge-private-paths.mjs";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkKnowledgeStoreIntegrity,
  createKnowledgeStoreRepository,
  createKnowledgeStoreSnapshotAdapter,
  createScopeGrant,
  initializeKnowledgeStore,
  readKnowledgeStoreStatus,
  resolveKnowledgeStorePath,
} from "./knowledge-store.mjs";
import {
  createKnowledgeBackup,
  KNOWLEDGE_RESTORE_REPORT_SCHEMA,
  KNOWLEDGE_RESTORE_REPORT_V1_SCHEMA,
  readKnowledgeBackupManifest,
  restoreKnowledgeBackup,
} from "./knowledge-backup.mjs";
import {
  KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  knowledgeAssetLinkItemId,
  verifyKnowledgeAssetIntegrityFromRepository,
} from "./knowledge-asset-integrity.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "./knowledge-governance-envelope.mjs";
import {
  createBrandKitImportCandidate,
  createReceiptMetadataImportCandidate,
  createRecipeImportCandidate,
  createReferenceEvidenceImportCandidate,
  createStyleSpecImportCandidate,
} from "./knowledge-importers.mjs";
import {
  createBuiltinKnowledgeSchemaReplayRegistry,
  replayAuthorizedKnowledgeExport,
} from "./knowledge-schema-replay.mjs";
import {
  FEEDBACK_EVENT_SCHEMA,
  FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA,
  FEEDBACK_PROMOTION_DECISION_SCHEMA,
  FEEDBACK_CANONICALIZATION_REQUEST_SCHEMA,
  KNOWLEDGE_FEEDBACK_ACTION_RESULT_SCHEMA,
  KNOWLEDGE_FEEDBACK_INTERPRETATION_ACTION_RESULT_SCHEMA,
  KNOWLEDGE_FEEDBACK_PROMOTION_ACTION_RESULT_SCHEMA,
  KNOWLEDGE_FEEDBACK_CANONICALIZATION_ACTION_RESULT_SCHEMA,
  feedbackPromotionDecisionEntriesAggregateHash,
  feedbackPromotionQueueHash,
  feedbackEntriesAggregateHash,
  feedbackInterpretationEntriesAggregateHash,
} from "./knowledge-feedback.mjs";
import {
  KNOWLEDGE_RETRIEVAL_REQUEST_SCHEMA,
  KNOWLEDGE_RETRIEVAL_ACTION_RESULT_SCHEMA,
  assertKnowledgeRetrievalActionResult,
  retrievalActionResultHash,
} from "./knowledge-retrieval.mjs";
import {
  KNOWLEDGE_DECISION_RESOLUTION_REQUEST_SCHEMA,
  KNOWLEDGE_DECISION_SHADOW_ACTION_RESULT_SCHEMA,
  assertKnowledgeDecisionResolution,
  resolveKnowledgeDecision,
} from "./knowledge-decision-resolver.mjs";
import {
  KNOWLEDGE_ACTION_VALUES,
  KNOWLEDGE_INPUT_ACTION_VALUES,
  isKnowledgeAction,
} from "../knowledge-actions.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import { writeFileAtomic } from "./pipeline-operation.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const KNOWLEDGE_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-action-result@1";
export const KNOWLEDGE_INTEGRITY_REPORT_SCHEMA =
  "mkt-videos/knowledge-integrity-report@2";
export const KNOWLEDGE_INTEGRITY_REPORT_V1_SCHEMA =
  "mkt-videos/knowledge-integrity-report@1";
export const KNOWLEDGE_EXPORT_RESULT_SCHEMA =
  "mkt-videos/knowledge-export-result@1";
export const KNOWLEDGE_BACKUP_RESULT_SCHEMA =
  "mkt-videos/knowledge-backup-result@1";
export const KNOWLEDGE_RESTORE_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-restore-action-result@2";
export const KNOWLEDGE_RELEASE_LIFECYCLE_RESULT_SCHEMA =
  "mkt-videos/knowledge-release-lifecycle-result@1";
export const KNOWLEDGE_REVIEW_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-review-action-result@1";
export const KNOWLEDGE_PROVISION_SCOPES_RESULT_SCHEMA =
  "mkt-videos/knowledge-provision-scopes-result@1";
export const KNOWLEDGE_ASSET_LINK_REGISTRATION_SCHEMA =
  "mkt-videos/knowledge-asset-link-registration@1";
export const KNOWLEDGE_ASSET_LINK_REGISTRATION_RESULT_SCHEMA =
  "mkt-videos/knowledge-asset-link-registration-result@1";
export const KNOWLEDGE_IMPORT_REQUEST_SCHEMA =
  "mkt-videos/knowledge-import-request@1";
export const KNOWLEDGE_IMPORT_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-import-action-result@1";
export const KNOWLEDGE_REPLAY_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-replay-action-result@1";

const DEFAULT_CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function normalizeAction(value) {
  const action = String(value ?? "status").trim().toLowerCase();
  if (!isKnowledgeAction(action)) {
    throw new Error(
      `knowledge --action inválida. Valores: ${KNOWLEDGE_ACTION_VALUES.join(", ")}.`,
    );
  }
  return action;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedRestoreAssets(report, manifest) {
  if (report.schema === KNOWLEDGE_RESTORE_REPORT_SCHEMA) {
    return {
      mode: report.assets.mode,
      status: report.assets.status,
      counts: {
        total: report.assets.counts.total,
        resolved: report.assets.counts.resolved,
        missing: report.assets.counts.missing,
        revoked: report.assets.counts.revoked,
        quarantined: report.assets.counts.quarantined,
        extra: report.assets.counts.extra,
        divergent: 0,
        unsafe: 0,
      },
    };
  }
  if (report.schema !== KNOWLEDGE_RESTORE_REPORT_V1_SCHEMA) {
    throw new Error(`Schema de relatório de restore não suportado: ${report.schema}.`);
  }

  const total = Number(manifest.assets.count);
  const missing = report.assets.missing.length;
  const divergent = report.assets.divergent.length;
  const unsafe = report.assets.unsafe.length;
  const resolved = total - missing - divergent - unsafe;
  if (!Number.isInteger(total) || total < 0 || resolved < 0) {
    throw new Error("Relatório de restore legado possui contagens de assets incoerentes.");
  }
  return {
    mode: manifest.assets.mode === "not-included"
      ? "not-included"
      : "legacy-inventory",
    status: report.assets.status,
    counts: {
      total,
      resolved,
      missing,
      revoked: 0,
      quarantined: 0,
      extra: 0,
      divergent,
      unsafe,
    },
  };
}

async function readPrivateKnowledgeInput(
  inputFile,
  coreRoot,
  { schemaId, label },
) {
  const requested = path.resolve(requiredText(inputFile, "--input"));
  if (path.extname(requested).toLowerCase() !== ".json") {
    throw new Error("knowledge --input exige um arquivo .json.");
  }
  const resolved = await realpath(requested);
  if (
    resolved.toLocaleLowerCase("en-US")
    !== requested.toLocaleLowerCase("en-US")
  ) {
    throw new Error("--input não pode usar symlink ou junction.");
  }
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || metadata.nlink > 1) {
    throw new Error("--input deve ser arquivo regular e não pode ser hardlink.");
  }
  if (metadata.size > 1024 * 1024) {
    throw new Error("--input excede o limite de 1 MiB.");
  }
  const workspaceRoot = path.resolve(coreRoot, "..");
  const resolvedWorkspace = await realPathThroughExistingAncestor(
    workspaceRoot,
  );
  if (isPathWithin(resolvedWorkspace, resolved)) {
    throw new Error(
      "Input privado do Knowledge Core não pode ficar dentro do workspace.",
    );
  }
  let value;
  try {
    value = JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    throw new Error("--input não contém JSON válido.");
  }
  assertKnowledgeContract(value, {
    schemaId,
    label,
  });
  return value;
}

export function resolveKnowledgeDatabaseFile({
  dbFile = null,
  environment = process.env,
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const configuredRoot = String(
    environment?.MKT_VIDEO_KNOWLEDGE_ROOT ?? "",
  ).trim();
  const requested = dbFile == null && configuredRoot
    ? path.join(configuredRoot, "knowledge.sqlite")
    : dbFile;
  return resolveKnowledgeStorePath({
    dbFile: requested,
    localAppData: environment?.LOCALAPPDATA,
    coreRoot,
  });
}

function actionStatus(status, { action, changed = false } = {}) {
  const ready = status.initialized && status.issues.length === 0;
  return {
    schema: KNOWLEDGE_ACTION_RESULT_SCHEMA,
    action,
    status: ready
      ? "ready"
      : status.exists
        ? "invalid"
        : "not_initialized",
    providerFree: true,
    readOnly: action === "status",
    changed,
    store: status,
  };
}

function migrationFingerprint(status) {
  return JSON.stringify({
    initialized: status.initialized,
    userVersion: status.userVersion,
    migrations: status.migrations.map(({ version, id, hash }) => ({
      version,
      id,
      hash,
    })),
  });
}

function operationGrant({
  rootScopeId,
  permission = null,
  permissions = null,
  actor,
  purpose,
  clock,
}) {
  const issuedAtValue = clock();
  const issuedAt = issuedAtValue instanceof Date
    ? issuedAtValue
    : new Date(issuedAtValue);
  if (!Number.isFinite(issuedAt.getTime())) {
    throw new Error("O clock do serviço de conhecimento retornou data inválida.");
  }
  const normalizedPermissions = permissions ?? [permission];
  return createScopeGrant({
    rootScopeIds: [rootScopeId],
    permissions: normalizedPermissions,
    actor,
    purpose,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 5 * 60 * 1000),
  });
}

function integrityStatus(globalReport, scopedReport, linkedArtifacts = null) {
  if (!globalReport.ok || (scopedReport && !scopedReport.ok)) return "fail";
  const hasWarnings =
    globalReport.issues.length > 0
    || (scopedReport?.issues.length ?? 0) > 0
    || linkedArtifacts?.status === "asymmetric";
  return hasWarnings ? "warning" : "pass";
}

export async function runKnowledgeAction({
  action = "status",
  dbFile = null,
  rootScopeId = null,
  scopeId = null,
  releaseId = null,
  outputFile = null,
  backupFile = null,
  classification = null,
  assetRootDirectory = null,
  expectedActivationId = undefined,
  itemId = null,
  operation = null,
  expectedRevision = undefined,
  expectedContentHash = null,
  evidenceIds = null,
  inputFile = null,
  limit = 5,
  reason = null,
  confirmHuman = null,
  snapshotAdapter = null,
  environment = process.env,
  coreRoot = DEFAULT_CORE_ROOT,
  actor = "local-cli",
  clock = () => new Date(),
} = {}) {
  const normalizedAction = normalizeAction(action);
  if (normalizedAction === "packs") {
    const { runKnowledgeDomainPackAction } = await import(
      "./knowledge-domain-pack-action.mjs"
    );
    return runKnowledgeDomainPackAction({
      action: normalizedAction,
      coreRoot,
      dbFile,
      rootScopeId,
      releaseId,
      outputFile,
      backupFile,
      classification,
      assetRootDirectory,
      expectedActivationId,
      itemId,
      operation,
      expectedRevision,
      expectedContentHash,
      evidenceIds,
      inputFile,
      reason,
      confirmHuman,
      snapshotAdapter,
    });
  }
  if (normalizedAction === "decision-shadow") {
    if (
      dbFile != null
      || rootScopeId == null
      || releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || itemId != null
      || operation != null
      || expectedRevision !== undefined
      || expectedContentHash != null
      || evidenceIds != null
      || scopeId != null
      || Number(limit) !== 5
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "decision-shadow aceita somente --root-scope-id e --input; não abre SQLite.",
      );
    }
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const request = await readPrivateKnowledgeInput(inputFile, coreRoot, {
      schemaId: KNOWLEDGE_DECISION_RESOLUTION_REQUEST_SCHEMA,
      label: "Pedido privado de decision shadow",
    });
    if (request.rootScopeId !== normalizedRoot) {
      throw new Error(
        "--root-scope-id diverge do rootScopeId declarado em --input.",
      );
    }
    const resolution = assertKnowledgeDecisionResolution(
      resolveKnowledgeDecision(request),
      { label: "Resolução de decision shadow" },
    );
    const actionBody = {
      schema: KNOWLEDGE_DECISION_SHADOW_ACTION_RESULT_SCHEMA,
      action: "decision-shadow",
      status: "shadow",
      providerFree: true,
      readOnly: true,
      changed: false,
      humanConfirmed: false,
      rootScopeId: normalizedRoot,
      planInfluence: "none",
      resolution,
    };
    return assertKnowledgeContract({
      ...actionBody,
      hash: operationFingerprint(actionBody),
    }, {
      schemaId: KNOWLEDGE_DECISION_SHADOW_ACTION_RESULT_SCHEMA,
      label: "Resultado de decision-shadow",
    });
  }
  const resolvedDbFile = resolveKnowledgeDatabaseFile({
    dbFile,
    environment,
    coreRoot,
  });
  const effectiveSnapshotAdapter =
    snapshotAdapter ?? createKnowledgeStoreSnapshotAdapter();
  const hasReviewOptions =
    itemId != null
    || operation != null
    || expectedRevision !== undefined
    || expectedContentHash != null
    || evidenceIds != null;
  if (normalizedAction !== "review-item" && hasReviewOptions) {
    throw new Error(
      "--item-id, --operation, --expected-revision, "
      + "--expected-content-hash e --evidence-id pertencem somente a review-item.",
    );
  }
  if (
    !KNOWLEDGE_INPUT_ACTION_VALUES.includes(normalizedAction)
    && inputFile != null
  ) {
    if (normalizedAction === "provision-scopes") {
      throw new Error(
        "knowledge provision-scopes aceita somente --db, --root-scope-id, "
        + "--scope-id, --reason e --confirm-human true.",
      );
    }
    throw new Error(
      "--input pertence somente a register-asset-link, import-candidate "
      + "capture-feedback, create-feedback-interpretation-candidate, "
      + "review-feedback-interpretation, canonicalize-feedback-interpretation "
      + " retrieval-shadow ou decision-shadow.",
    );
  }
  const isPromotionQueueAction =
    normalizedAction === "list-feedback-promotion-queue"
    || normalizedAction === "review-feedback-interpretation";
  if (!isPromotionQueueAction && normalizedAction !== "provision-scopes" && scopeId != null) {
    throw new Error("--scope-id pertence somente a provision-scopes e ações da fila de promoção.");
  }
  if (!isPromotionQueueAction && normalizedAction !== "provision-scopes" && Number(limit) !== 5) {
    throw new Error("--limit pertence somente às ações da fila de promoção.");
  }

  if (normalizedAction === "status") {
    if (
      rootScopeId != null
      || releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge status aceita somente --db; remova opções de escopo ou saída.",
      );
    }
    return assertKnowledgeContract(actionStatus(
      readKnowledgeStoreStatus({
        dbFile: resolvedDbFile,
        coreRoot,
      }),
      { action: normalizedAction },
    ), {
      schemaId: KNOWLEDGE_ACTION_RESULT_SCHEMA,
      label: "Resultado de knowledge status",
    });
  }

  if (normalizedAction === "init") {
    if (
      rootScopeId != null
      || releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge init aceita somente --db; remova opções de escopo ou saída.",
      );
    }
    const before = readKnowledgeStoreStatus({
      dbFile: resolvedDbFile,
      coreRoot,
    });
    const after = initializeKnowledgeStore({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    return assertKnowledgeContract(actionStatus(after, {
      action: normalizedAction,
      changed:
        !before.exists
        || migrationFingerprint(before) !== migrationFingerprint(after),
    }), {
      schemaId: KNOWLEDGE_ACTION_RESULT_SCHEMA,
      label: "Resultado de knowledge init",
    });
  }

  if (normalizedAction === "restore") {
    if (dbFile == null) {
      throw new Error(
        "knowledge restore exige --db apontando para um destino novo e explícito.",
      );
    }
    if (
      releaseId != null
      || outputFile != null
      || classification != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge restore não aceita --release-id, --out nem --classification.",
      );
    }
    const normalizedBackup = requiredText(backupFile, "--backup");
    const descriptor = await readKnowledgeBackupManifest({
      backupFile: normalizedBackup,
      coreRoot,
    });
    const hasScopeAttestation =
      descriptor.manifest.scopeAttestation != null;
    const normalizedRoot = hasScopeAttestation
      ? requiredText(rootScopeId, "--root-scope-id")
      : null;
    if (!hasScopeAttestation && rootScopeId != null) {
      throw new Error(
        "Este backup não possui root scope atestado; remova --root-scope-id.",
      );
    }
    const grant = normalizedRoot == null
      ? null
      : operationGrant({
          rootScopeId: normalizedRoot,
          permissions: ["read", "integrity", "restore"],
          actor,
          purpose: "verified knowledge restore",
          clock,
        });
    const report = await restoreKnowledgeBackup({
      backupFile: normalizedBackup,
      destinationDbFile: resolvedDbFile,
      rootScopeId: normalizedRoot,
      grant,
      assetRootDirectory,
      snapshotAdapter: effectiveSnapshotAdapter,
      coreRoot,
      clock,
    });
    const assets = normalizedRestoreAssets(report, descriptor.manifest);
    return assertKnowledgeContract({
      schema: KNOWLEDGE_RESTORE_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      status: report.status,
      providerFree: true,
      changed: true,
      file: resolvedDbFile,
      manifestHash: report.manifestHash,
      database: {
        userVersion: report.database.userVersion,
        bytes: report.database.bytes,
        sha256: report.database.sha256,
        integritySha256: report.database.integritySha256,
      },
      assets,
      scopeAttestationVerified: report.scopeAttestationVerified,
      reportOnlyAssets: report.reportOnlyAssets,
      repairPerformed: report.repairPerformed,
    }, {
      schemaId: KNOWLEDGE_RESTORE_ACTION_RESULT_SCHEMA,
      label: "Resultado de knowledge restore",
    });
  }

  const status = readKnowledgeStoreStatus({
    dbFile: resolvedDbFile,
    coreRoot,
  });
  if (!status.initialized || status.issues.length > 0) {
    throw new Error(
      "Knowledge Store não está inicializado e íntegro; execute knowledge --action init e verifique o status.",
    );
  }

  if (normalizedAction === "integrity") {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge integrity não aceita --release-id nem --out.",
      );
    }
    const globalReport = checkKnowledgeStoreIntegrity({
      dbFile: resolvedDbFile,
      coreRoot,
    });
    let scopedReport = null;
    let linkedArtifacts = {
      status: "not_applicable",
      reason: "Ação global não atravessa roots privados nem inventaria assets.",
    };
    if (rootScopeId != null) {
      const normalizedRoot = requiredText(
        rootScopeId,
        "--root-scope-id",
      );
      const repository = createKnowledgeStoreRepository({
        dbFile: resolvedDbFile,
        coreRoot,
        clock,
      });
      const grant = operationGrant({
        rootScopeId: normalizedRoot,
        permissions: ["read", "integrity"],
        actor,
        purpose: "knowledge integrity report",
        clock,
      });
      scopedReport = repository.checkIntegrity({
        grant,
        rootScopeId: normalizedRoot,
      });
      linkedArtifacts = await verifyKnowledgeAssetIntegrityFromRepository({
        repository,
        grant,
        rootScopeId: normalizedRoot,
        allowedRoots: [
          {
            rootKind: "outputs",
            directory: path.join(coreRoot, "outputs"),
          },
          {
            rootKind: "PESSOAS",
            directory: path.join(coreRoot, "..", "PESSOAS"),
          },
        ],
        at: clock(),
        missingRootsAsEmpty: true,
      });
    }
    return assertKnowledgeContract({
      schema: KNOWLEDGE_INTEGRITY_REPORT_SCHEMA,
      action: normalizedAction,
      status: integrityStatus(
        globalReport,
        scopedReport,
        linkedArtifacts,
      ),
      providerFree: true,
      readOnly: true,
      reportOnly: true,
      repairPerformed: false,
      global: globalReport,
      scoped: scopedReport,
      linkedArtifacts,
    }, {
      schemaId: KNOWLEDGE_INTEGRITY_REPORT_SCHEMA,
      label: "Relatório de integrity do Knowledge Store",
    });
  }

  if (
    normalizedAction === "capture-feedback"
    || normalizedAction === "list-feedback"
    || normalizedAction === "replay-feedback"
  ) {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
    ) {
      throw new Error(
        "Ações de feedback aceitam somente --db, --root-scope-id "
        + "e, na captura, --input e --confirm-human true.",
      );
    }
    const capture = normalizedAction === "capture-feedback";
    if (capture && confirmHuman !== true) {
      throw new Error(
        "Captura de feedback exige --confirm-human true.",
      );
    }
    if (!capture && (inputFile != null || confirmHuman != null)) {
      throw new Error(
        "list-feedback e replay-feedback são read-only e não aceitam "
        + "--input nem --confirm-human.",
      );
    }
    const normalizedRoot = requiredText(
      rootScopeId,
      "--root-scope-id",
    );
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: capture ? ["read", "write"] : ["read"],
      actor,
      purpose: capture
        ? "human-confirmed append-only feedback capture"
        : "provider-free deterministic feedback replay",
      clock,
    });
    if (capture) {
      const feedback = await readPrivateKnowledgeInput(inputFile, coreRoot, {
        schemaId: FEEDBACK_EVENT_SCHEMA,
        label: "FeedbackEvent privado",
      });
      if (feedback.rootScopeId !== normalizedRoot) {
        throw new Error(
          "--root-scope-id diverge do rootScopeId declarado em --input.",
        );
      }
      const entry = repository.captureFeedbackEvent({
        grant,
        feedback,
      });
      const entries = [entry];
      return assertKnowledgeContract({
        schema: KNOWLEDGE_FEEDBACK_ACTION_RESULT_SCHEMA,
        action: normalizedAction,
        status: "captured",
        providerFree: true,
        readOnly: false,
        changed: true,
        humanConfirmed: true,
        rootScopeId: normalizedRoot,
        eventCount: entries.length,
        entries,
        aggregateHash: feedbackEntriesAggregateHash(
          normalizedRoot,
          entries,
        ),
      }, {
        schemaId: KNOWLEDGE_FEEDBACK_ACTION_RESULT_SCHEMA,
        label: "Resultado de capture-feedback",
      });
    }
    const replay = repository.replayFeedbackEvents({
      grant,
      rootScopeId: normalizedRoot,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_FEEDBACK_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      status: normalizedAction === "list-feedback"
        ? "listed"
        : "replayed",
      providerFree: true,
      readOnly: true,
      changed: false,
      humanConfirmed: false,
      rootScopeId: normalizedRoot,
      eventCount: replay.eventCount,
      entries: replay.entries,
      aggregateHash: replay.aggregateHash,
    }, {
      schemaId: KNOWLEDGE_FEEDBACK_ACTION_RESULT_SCHEMA,
      label: `Resultado de ${normalizedAction}`,
    });
  }

  if (
    normalizedAction === "create-feedback-interpretation-candidate"
    || normalizedAction === "list-feedback-interpretation-candidates"
    || normalizedAction === "replay-feedback-interpretation-candidates"
  ) {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
    ) {
      throw new Error(
        "Ações de interpretação de feedback aceitam somente --db, "
        + "--root-scope-id e, na criação, --input e --confirm-human true.",
      );
    }
    const create =
      normalizedAction === "create-feedback-interpretation-candidate";
    if (create && confirmHuman !== true) {
      throw new Error(
        "Criação de candidato de interpretação exige --confirm-human true.",
      );
    }
    if (!create && (inputFile != null || confirmHuman != null)) {
      throw new Error(
        "Listagem e replay de candidatos de interpretação são read-only "
        + "e não aceitam --input nem --confirm-human.",
      );
    }
    const normalizedRoot = requiredText(
      rootScopeId,
      "--root-scope-id",
    );
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: create ? ["read", "write"] : ["read"],
      actor,
      purpose: create
        ? "human-confirmed append-only feedback interpretation candidate"
        : "provider-free deterministic feedback interpretation replay",
      clock,
    });
    if (create) {
      const candidate = await readPrivateKnowledgeInput(
        inputFile,
        coreRoot,
        {
          schemaId: FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA,
          label: "Candidato privado de interpretação de feedback",
        },
      );
      if (candidate.rootScopeId !== normalizedRoot) {
        throw new Error(
          "--root-scope-id diverge do rootScopeId declarado em --input.",
        );
      }
      const entry = repository.createFeedbackInterpretationCandidate({
        grant,
        candidate,
      });
      const entries = [entry];
      return assertKnowledgeContract({
        schema: KNOWLEDGE_FEEDBACK_INTERPRETATION_ACTION_RESULT_SCHEMA,
        action: normalizedAction,
        status: "candidate-created",
        providerFree: true,
        readOnly: false,
        changed: true,
        humanConfirmed: true,
        promotionPerformed: false,
        active: false,
        rootScopeId: normalizedRoot,
        eventCount: entries.length,
        entries,
        aggregateHash: feedbackInterpretationEntriesAggregateHash(
          normalizedRoot,
          entries,
        ),
      }, {
        schemaId: KNOWLEDGE_FEEDBACK_INTERPRETATION_ACTION_RESULT_SCHEMA,
        label: "Resultado de create-feedback-interpretation-candidate",
      });
    }
    const replay = repository.replayFeedbackInterpretationCandidates({
      grant,
      rootScopeId: normalizedRoot,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_FEEDBACK_INTERPRETATION_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      status:
        normalizedAction === "list-feedback-interpretation-candidates"
          ? "listed"
          : "replayed",
      providerFree: true,
      readOnly: true,
      changed: false,
      humanConfirmed: false,
      promotionPerformed: false,
      active: false,
      rootScopeId: normalizedRoot,
      eventCount: replay.eventCount,
      entries: replay.entries,
      aggregateHash: replay.aggregateHash,
    }, {
      schemaId: KNOWLEDGE_FEEDBACK_INTERPRETATION_ACTION_RESULT_SCHEMA,
      label: `Resultado de ${normalizedAction}`,
    });
  }

  if (
    normalizedAction === "canonicalize-feedback-interpretation"
  ) {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || itemId != null
      || operation != null
      || expectedRevision !== undefined
      || expectedContentHash != null
      || evidenceIds != null
      || scopeId != null
      || Number(limit) !== 5
      || reason != null
      || confirmHuman !== true
    ) {
      throw new Error(
        "canonicalize-feedback-interpretation aceita somente --db, "
        + "--root-scope-id, --input e --confirm-human true.",
      );
    }
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const request = await readPrivateKnowledgeInput(
      inputFile,
      coreRoot,
      {
        schemaId: FEEDBACK_CANONICALIZATION_REQUEST_SCHEMA,
        label: "Pedido privado de canonicalização de feedback",
      },
    );
    if (request.rootScopeId !== normalizedRoot) {
      throw new Error(
        "--root-scope-id diverge do rootScopeId declarado em --input.",
      );
    }
    if (request.requestedBy !== actor) {
      throw new Error(
        "requestedBy do input deve coincidir com o actor do runtime.",
      );
    }
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const result = repository.canonicalizeFeedbackPromotion({
      grant: operationGrant({
        rootScopeId: normalizedRoot,
        permissions: ["read", "write"],
        actor,
        purpose: "human-confirmed feedback canonicalization",
        clock,
      }),
      request,
    });
    return assertKnowledgeContract(result, {
      schemaId: KNOWLEDGE_FEEDBACK_CANONICALIZATION_ACTION_RESULT_SCHEMA,
      label: "Resultado de canonicalize-feedback-interpretation",
    });
  }

  if (normalizedAction === "retrieval-shadow") {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || itemId != null
      || operation != null
      || expectedRevision !== undefined
      || expectedContentHash != null
      || evidenceIds != null
      || scopeId != null
      || Number(limit) !== 5
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "retrieval-shadow aceita somente --db, --root-scope-id e --input.",
      );
    }
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const request = await readPrivateKnowledgeInput(
      inputFile,
      coreRoot,
      {
        schemaId: KNOWLEDGE_RETRIEVAL_REQUEST_SCHEMA,
        label: "Pedido privado de retrieval shadow",
      },
    );
    if (request.rootScopeId !== normalizedRoot) {
      throw new Error(
        "--root-scope-id diverge do rootScopeId declarado em --input.",
      );
    }
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const result = repository.retrieveKnowledgeShadow({
      grant: operationGrant({
        rootScopeId: normalizedRoot,
        permissions: ["read"],
        actor,
        purpose: "provider-free read-only retrieval shadow",
        clock,
      }),
      request,
    });
    const actionResult = {
      schema: KNOWLEDGE_RETRIEVAL_ACTION_RESULT_SCHEMA,
      action: "retrieval-shadow",
      status: "shadow",
      providerFree: true,
      readOnly: true,
      changed: false,
      humanConfirmed: false,
      rootScopeId: normalizedRoot,
      planInfluence: "none",
      trace: result.trace,
      context: result.context,
    };
    return assertKnowledgeRetrievalActionResult({
      ...actionResult,
      hash: retrievalActionResultHash(actionResult),
    }, {
      label: "Resultado de retrieval-shadow",
    });
  }

  if (
    normalizedAction === "list-feedback-promotion-queue"
    || normalizedAction === "review-feedback-interpretation"
  ) {
    const review = normalizedAction === "review-feedback-interpretation";
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || itemId != null
      || operation != null
      || expectedRevision !== undefined
      || expectedContentHash != null
      || evidenceIds != null
      || reason != null
      || (!review && scopeId != null && !String(scopeId).trim())
    ) {
      throw new Error(
        "Ações da fila de promoção aceitam --db, --root-scope-id, "
        + "opcionalmente --scope-id/--limit e, na decisão, --input e "
        + "--confirm-human true.",
      );
    }
    if (review && confirmHuman !== true) {
      throw new Error(
        "Decisão da fila de promoção exige --confirm-human true.",
      );
    }
    if (!review && (inputFile != null || confirmHuman != null)) {
      throw new Error(
        "list-feedback-promotion-queue é read-only e não aceita --input "
        + "nem --confirm-human.",
      );
    }
    if (review && (scopeId != null || Number(limit) !== 5)) {
      throw new Error(
        "review-feedback-interpretation usa o snapshot hash-bound do input; "
        + "não aceite --scope-id nem --limit externos.",
      );
    }
    const normalizedRoot = requiredText(
      rootScopeId,
      "--root-scope-id",
    );
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: review ? ["read", "write"] : ["read"],
      actor,
      purpose: review
        ? "human-confirmed feedback promotion decision"
        : "provider-free deterministic feedback promotion queue",
      clock,
    });
    let decision = null;
    if (review) {
      decision = await readPrivateKnowledgeInput(
        inputFile,
        coreRoot,
        {
          schemaId: FEEDBACK_PROMOTION_DECISION_SCHEMA,
          label: "Decisão privada da fila de promoção",
        },
      );
      if (decision.rootScopeId !== normalizedRoot) {
        throw new Error(
          "--root-scope-id diverge do rootScopeId declarado em --input.",
        );
      }
      if (decision.reviewedBy !== actor) {
        throw new Error(
          "reviewedBy do input deve coincidir com o actor do runtime.",
        );
      }
      const recorded = repository.recordFeedbackPromotionDecision({
        grant,
        decision,
      });
      decision = recorded.decision;
    }
    const queue = repository.listFeedbackPromotionQueue({
      grant: review
        ? operationGrant({
            rootScopeId: normalizedRoot,
            permissions: ["read"],
            actor,
            purpose: "provider-free queue projection after human decision",
            clock,
          })
        : grant,
      rootScopeId: normalizedRoot,
      scopeId: review ? null : scopeId,
      limit: review ? 5 : Number(limit),
      asOf: clock(),
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_FEEDBACK_PROMOTION_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      status: review ? "decision-recorded" : "listed",
      providerFree: true,
      readOnly: !review,
      changed: review,
      humanConfirmed: review,
      rootScopeId: normalizedRoot,
      scopeId: queue.scopeId,
      asOf: queue.asOf,
      limit: queue.limit,
      queueCount: queue.queueCount,
      eventCount: review ? 1 : queue.queueCount,
      entries: queue.entries,
      queueHash: feedbackPromotionQueueHash(
        normalizedRoot,
        {
          asOf: queue.asOf,
          scopeId: queue.scopeId,
          limit: queue.limit,
        },
        queue.entries,
      ),
      decision,
    }, {
      schemaId: KNOWLEDGE_FEEDBACK_PROMOTION_ACTION_RESULT_SCHEMA,
      label: `Resultado de ${normalizedAction}`,
    });
  }

  if (normalizedAction === "replay-release") {
    if (
      outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge replay-release aceita somente --db, "
        + "--root-scope-id e --release-id.",
      );
    }
    const normalizedRoot = requiredText(
      rootScopeId,
      "--root-scope-id",
    );
    const normalizedRelease = requiredText(releaseId, "--release-id");
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: ["read", "integrity", "export"],
      actor,
      purpose: "provider-free authorized knowledge release replay",
      clock,
    });
    const knowledgeExport = repository.exportKnowledge({
      grant,
      rootScopeId: normalizedRoot,
      releaseId: normalizedRelease,
    });
    const authorization = repository.authorizeReplay({
      grant,
      rootScopeId: normalizedRoot,
      releaseId: normalizedRelease,
      ttlMs: 60_000,
    });
    const report = replayAuthorizedKnowledgeExport({
      knowledgeExport,
      registry: createBuiltinKnowledgeSchemaReplayRegistry(),
      authorization,
      releaseId: normalizedRelease,
      clock,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_REPLAY_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      status: "replayed",
      providerFree: true,
      readOnly: true,
      changed: false,
      rootScopeId: normalizedRoot,
      releaseId: normalizedRelease,
      report,
    }, {
      schemaId: KNOWLEDGE_REPLAY_ACTION_RESULT_SCHEMA,
      label: "Resultado de knowledge replay-release",
    });
  }

  if (
    normalizedAction === "active-release"
    || normalizedAction === "activate-release"
    || normalizedAction === "rollback-release"
  ) {
    if (
      outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
    ) {
      throw new Error(
        "Ações de release não aceitam --out, --backup, --classification nem --asset-root.",
      );
    }
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const writeAction = normalizedAction !== "active-release";
    if (!writeAction && (
      releaseId != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    )) {
      throw new Error(
        "knowledge active-release aceita somente --db e --root-scope-id.",
      );
    }
    if (writeAction) {
      if (confirmHuman !== true) {
        throw new Error(
          "Ativação e rollback exigem --confirm-human true.",
        );
      }
      requiredText(releaseId, "--release-id");
      requiredText(reason, "--reason");
      if (expectedActivationId === undefined) {
        throw new Error(
          "--expected-activation-id é obrigatório; use none na primeira ativação.",
        );
      }
    }
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: writeAction
        ? ["read", "integrity", "release"]
        : ["read", "integrity"],
      actor,
      purpose: writeAction
        ? "human-confirmed knowledge release lifecycle"
        : "active knowledge release inspection",
      clock,
    });
    if (writeAction) {
      const target = repository.getRelease({
        grant,
        rootScopeId: normalizedRoot,
        releaseId: requiredText(releaseId, "--release-id"),
      });
      if (!target) throw new Error("Release alvo inexistente.");
      const expectedCurrent = String(expectedActivationId).trim().toLowerCase()
        === "none"
        ? null
        : requiredText(
            expectedActivationId,
            "--expected-activation-id",
          );
      const activation = normalizedAction === "activate-release"
        ? repository.activateRelease({
            grant,
            rootScopeId: normalizedRoot,
            releaseId: target.id,
            expectedReleaseHash: target.hash,
            expectedCurrentActivationId: expectedCurrent,
            reason,
          })
        : repository.rollbackRelease({
            grant,
            rootScopeId: normalizedRoot,
            releaseId: target.id,
            expectedReleaseHash: target.hash,
            expectedCurrentActivationId: expectedCurrent,
            reason,
          });
      return assertKnowledgeContract({
        schema: KNOWLEDGE_RELEASE_LIFECYCLE_RESULT_SCHEMA,
        action: normalizedAction,
        status: normalizedAction === "activate-release"
          ? "activated"
          : "rolled-back",
        providerFree: true,
        readOnly: false,
        changed: true,
        humanConfirmed: true,
        rootScopeId: normalizedRoot,
        release: {
          id: target.id,
          hash: target.hash,
          memberCount: target.members.length,
        },
        activation,
        eligible: true,
        issues: [],
      }, {
        schemaId: KNOWLEDGE_RELEASE_LIFECYCLE_RESULT_SCHEMA,
        label: "Resultado do lifecycle de release",
      });
    }
    const inspected = repository.inspectActiveRelease({
      grant,
      rootScopeId: normalizedRoot,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_RELEASE_LIFECYCLE_RESULT_SCHEMA,
      action: normalizedAction,
      status: inspected.active ? "active" : "no-active-release",
      providerFree: true,
      readOnly: true,
      changed: false,
      humanConfirmed: false,
      rootScopeId: normalizedRoot,
      release: inspected.release == null
        ? null
        : {
            id: inspected.release.id,
            hash: inspected.release.hash,
            memberCount: inspected.release.members.length,
          },
      activation: inspected.activation,
      eligible: inspected.eligible,
      issues: inspected.issues,
    }, {
      schemaId: KNOWLEDGE_RELEASE_LIFECYCLE_RESULT_SCHEMA,
      label: "Resultado de active-release",
    });
  }

  if (normalizedAction === "review-item") {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
    ) {
      throw new Error(
        "knowledge review-item não aceita opções de release, backup, saída ou assets.",
      );
    }
    if (confirmHuman !== true) {
      throw new Error("Review exige --confirm-human true.");
    }
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const normalizedItem = requiredText(itemId, "--item-id");
    const normalizedOperation = String(operation ?? "").trim().toLowerCase();
    if (!["promote", "quarantine"].includes(normalizedOperation)) {
      throw new Error("--operation deve ser promote ou quarantine.");
    }
    const normalizedRevision = Number(expectedRevision);
    if (!Number.isInteger(normalizedRevision) || normalizedRevision < 1) {
      throw new Error("--expected-revision deve ser um inteiro positivo.");
    }
    const normalizedHash = requiredText(
      expectedContentHash,
      "--expected-content-hash",
    );
    if (evidenceIds != null && !Array.isArray(evidenceIds)) {
      throw new Error("--evidence-id deve ser repetido como uma lista.");
    }
    const normalizedEvidenceIds = evidenceIds == null
      ? []
      : evidenceIds.map((value) => requiredText(value, "--evidence-id"));
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: ["read", "release"],
      actor,
      purpose: "human-confirmed knowledge item review",
      clock,
    });
    const reviewed = repository.reviewKnowledgeItem({
      grant,
      rootScopeId: normalizedRoot,
      itemId: normalizedItem,
      expectedRevision: normalizedRevision,
      expectedContentHash: normalizedHash,
      action: normalizedOperation,
      reason: requiredText(reason, "--reason"),
      evidenceIds: normalizedEvidenceIds,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_REVIEW_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      operation: normalizedOperation,
      status: normalizedOperation === "promote"
        ? "promoted"
        : "quarantined",
      providerFree: true,
      readOnly: false,
      changed: true,
      humanConfirmed: true,
      rootScopeId: normalizedRoot,
      decision: reviewed.decision,
      item: reviewed.item,
    }, {
      schemaId: KNOWLEDGE_REVIEW_ACTION_RESULT_SCHEMA,
      label: "Resultado de knowledge review-item",
    });
  }

  if (normalizedAction === "provision-scopes") {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || itemId != null
      || operation != null
      || expectedRevision !== undefined
      || expectedContentHash != null
      || evidenceIds != null
      || inputFile != null
      || Number(limit) !== 5
    ) {
      throw new Error(
        "knowledge provision-scopes aceita somente --db, --root-scope-id, "
        + "--scope-id, --reason e --confirm-human true.",
      );
    }
    if (confirmHuman !== true) {
      throw new Error(
        "Provisão de scopes exige --confirm-human true.",
      );
    }
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const normalizedScope = requiredText(scopeId, "--scope-id");
    const normalizedReason = requiredText(reason, "--reason");
    if (!normalizedScope.startsWith("production:")) {
      throw new Error("--scope-id deve ser production:<colecao>.");
    }
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: ["read", "write"],
      actor,
      purpose: "human-confirmed governed scope provisioning",
      clock,
    });
    const chain = [
      { id: normalizedRoot, kind: "client", parentScopeId: null, name: "Gerador de Vídeos" },
      { id: "project:geral", kind: "project", parentScopeId: normalizedRoot, name: "Geral" },
      {
        id: normalizedScope,
        kind: "production",
        parentScopeId: "project:geral",
        name: String(normalizedScope).replace(/^production:/, "") || normalizedScope,
      },
    ];
    const scopes = [];
    let changed = false;
    for (const entry of chain) {
      const existing = repository.getScope({
        grant,
        rootScopeId: normalizedRoot,
        scopeId: entry.id,
      });
      if (existing) {
        scopes.push({ scopeId: entry.id, kind: entry.kind, created: false });
        continue;
      }
      repository.createScope({
        grant,
        scope: {
          id: entry.id,
          rootScopeId: normalizedRoot,
          parentScopeId: entry.parentScopeId,
          kind: entry.kind,
          name: entry.name,
          createdAt: grant.issuedAt,
          createdBy: grant.actor,
        },
      });
      changed = true;
      scopes.push({ scopeId: entry.id, kind: entry.kind, created: true });
    }
    return assertKnowledgeContract({
      schema: KNOWLEDGE_PROVISION_SCOPES_RESULT_SCHEMA,
      action: normalizedAction,
      status: "provisioned",
      providerFree: true,
      readOnly: false,
      changed,
      humanConfirmed: true,
      rootScopeId: normalizedRoot,
      reason: normalizedReason,
      scopes,
    }, {
      schemaId: KNOWLEDGE_PROVISION_SCOPES_RESULT_SCHEMA,
      label: "Resultado de provision-scopes",
    });
  }

  if (normalizedAction === "register-asset-link") {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
    ) {
      throw new Error(
        "knowledge register-asset-link não aceita opções de release, backup, saída ou assets.",
      );
    }
    if (confirmHuman !== true) {
      throw new Error(
        "Registro de asset link exige --confirm-human true.",
      );
    }
    const normalizedReason = requiredText(reason, "--reason");
    const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
    const spec = await readPrivateKnowledgeInput(inputFile, coreRoot, {
      schemaId: KNOWLEDGE_ASSET_LINK_REGISTRATION_SCHEMA,
      label: "Spec de registro de asset link",
    });
    if (spec.rootScopeId !== normalizedRoot) {
      throw new Error(
        "--root-scope-id diverge do rootScopeId declarado em --input.",
      );
    }
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: ["read", "write"],
      actor,
      purpose: "human-confirmed governed asset link registration",
      clock,
    });
    const scope = repository.getScope({
      grant,
      rootScopeId: normalizedRoot,
      scopeId: spec.scopeId,
    });
    if (!scope) {
      throw new Error("scopeId do asset link não pertence ao root autorizado.");
    }
    const governance = createKnowledgeRecordEnvelope({
      ...spec.governance,
      owner: {
        type: scope.kind,
        id: scope.id,
      },
      createdAt: grant.issuedAt,
      createdBy: grant.actor,
    }, {
      expectedActor: grant.actor,
    });
    const payload = {
      schema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
      rootKind: spec.rootKind,
      relativePath: spec.relativePath,
      expectedSha256: spec.expectedSha256,
      expectedBytes: spec.expectedBytes,
      mediaType: spec.mediaType,
    };
    const item = repository.appendKnowledgeAssetLinkItem({
      grant,
      item: {
        id: knowledgeAssetLinkItemId({
          rootScopeId: normalizedRoot,
          rootKind: spec.rootKind,
          relativePath: spec.relativePath,
        }),
        revision: spec.revision,
        rootScopeId: normalizedRoot,
        scopeId: spec.scopeId,
        recordType: "relation",
        schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
        schemaVersion: 1,
        status: spec.status,
        governance,
        supersedesRevision: spec.supersedesRevision,
        payload,
        createdAt: grant.issuedAt,
        createdBy: grant.actor,
      },
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_ASSET_LINK_REGISTRATION_RESULT_SCHEMA,
      action: normalizedAction,
      status: "registered",
      providerFree: true,
      readOnly: false,
      changed: true,
      humanConfirmed: true,
      reason: normalizedReason,
      item,
    }, {
      schemaId: KNOWLEDGE_ASSET_LINK_REGISTRATION_RESULT_SCHEMA,
      label: "Resultado de register-asset-link",
    });
  }

  if (normalizedAction === "import-candidate") {
    if (
      releaseId != null
      || outputFile != null
      || backupFile != null
      || classification != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge import-candidate aceita somente --db, "
        + "--root-scope-id e --input.",
      );
    }
    const normalizedRoot = requiredText(
      rootScopeId,
      "--root-scope-id",
    );
    const request = await readPrivateKnowledgeInput(inputFile, coreRoot, {
      schemaId: KNOWLEDGE_IMPORT_REQUEST_SCHEMA,
      label: "Knowledge import request",
    });
    if (request.rootScopeId !== normalizedRoot) {
      throw new Error(
        "--root-scope-id diverge do rootScopeId declarado em --input.",
      );
    }
    const repository = createKnowledgeStoreRepository({
      dbFile: resolvedDbFile,
      coreRoot,
      clock,
    });
    const grant = operationGrant({
      rootScopeId: normalizedRoot,
      permissions: ["read"],
      actor,
      purpose: "provider-free read-only knowledge import candidate",
      clock,
    });
    const scope = repository.getScope({
      grant,
      rootScopeId: normalizedRoot,
      scopeId: request.scopeId,
    });
    if (!scope) {
      throw new Error(
        "scopeId do import candidate não pertence ao root autorizado.",
      );
    }
    if (
      request.governance.owner.id !== scope.id
      || request.governance.owner.type !== scope.kind
    ) {
      throw new Error(
        "Owner do import candidate deve corresponder ao scope governado.",
      );
    }
    const candidateFactories = {
      "style-spec": createStyleSpecImportCandidate,
      "brand-kit": createBrandKitImportCandidate,
      recipe: createRecipeImportCandidate,
      "reference-evidence-index": createReferenceEvidenceImportCandidate,
      "receipt-metadata": createReceiptMetadataImportCandidate,
    };
    const factory = candidateFactories[request.sourceKind];
    if (typeof factory !== "function") {
      throw new Error(
        `Importador não suportado: ${request.sourceKind}.`,
      );
    }
    const candidate = factory({
      source: request.source,
      sourceRef: request.sourceRef,
      sourceHash: request.sourceHash ?? undefined,
      rootScopeId: normalizedRoot,
      scopeId: scope.id,
      classification: request.governance.classification,
      owner: request.governance.owner,
      rights: request.governance.rights,
      retention: request.governance.retention,
      evidenceIds: request.governance.evidenceIds,
      observedAt: request.governance.observedAt,
      createdAt: grant.issuedAt,
      createdBy: grant.actor,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_IMPORT_ACTION_RESULT_SCHEMA,
      action: normalizedAction,
      status: "candidate-created",
      providerFree: true,
      readOnly: true,
      changed: false,
      rootScopeId: normalizedRoot,
      candidate,
    }, {
      schemaId: KNOWLEDGE_IMPORT_ACTION_RESULT_SCHEMA,
      label: "Resultado de knowledge import-candidate",
    });
  }

  if (normalizedAction === "backup") {
    if (
      releaseId != null
      || backupFile != null
      || assetRootDirectory != null
      || expectedActivationId !== undefined
      || reason != null
      || confirmHuman != null
    ) {
      throw new Error(
        "knowledge backup não aceita --release-id, --backup nem --asset-root.",
      );
    }
    const normalizedRoot = rootScopeId == null
      ? null
      : requiredText(rootScopeId, "--root-scope-id");
    const grant = normalizedRoot == null
      ? null
      : operationGrant({
          rootScopeId: normalizedRoot,
          permissions: ["read", "integrity", "backup"],
          actor,
          purpose: "verified knowledge backup",
          clock,
        });
    const backedUp = await createKnowledgeBackup({
      sourceDbFile: resolvedDbFile,
      backupFile: requiredText(outputFile, "--out"),
      classification: requiredText(classification, "--classification"),
      rootScopeId: normalizedRoot,
      grant,
      snapshotAdapter: effectiveSnapshotAdapter,
      coreRoot,
      clock,
    });
    return assertKnowledgeContract({
      schema: KNOWLEDGE_BACKUP_RESULT_SCHEMA,
      action: normalizedAction,
      status: "backed-up",
      providerFree: true,
      changed: true,
      storeReadOnly: true,
      file: backedUp.backupFile,
      archiveBytes: backedUp.archiveBytes,
      archiveSha256: backedUp.archiveSha256,
      manifestHash: backedUp.manifest.manifestHash,
      createdAt: backedUp.manifest.createdAt,
      classification: backedUp.manifest.classification.level,
      snapshot: {
        bytes: backedUp.manifest.store.snapshotBytes,
        sha256: backedUp.manifest.store.snapshotSha256,
        userVersion: backedUp.manifest.store.userVersion,
      },
      assets: {
        mode: backedUp.manifest.assets.mode,
        count: backedUp.manifest.assets.count,
        aggregateSha256: backedUp.manifest.assets.aggregateSha256,
      },
      scopedAttestation: backedUp.manifest.scopeAttestation != null,
    }, {
      schemaId: KNOWLEDGE_BACKUP_RESULT_SCHEMA,
      label: "Resultado de knowledge backup",
    });
  }

  const normalizedRoot = requiredText(rootScopeId, "--root-scope-id");
  if (
    backupFile != null
    || classification != null
    || assetRootDirectory != null
    || expectedActivationId !== undefined
    || reason != null
    || confirmHuman != null
  ) {
    throw new Error(
      "knowledge export não aceita --backup, --classification nem --asset-root.",
    );
  }
  const globalIntegrity = checkKnowledgeStoreIntegrity({
    dbFile: resolvedDbFile,
    coreRoot,
  });
  if (!globalIntegrity.ok) {
    throw new Error(
      "Export bloqueado: o Knowledge Store falhou na verificação global de integridade.",
    );
  }
  const normalizedOutput = await resolveKnowledgeExportFile(
    outputFile,
    coreRoot,
  );
  const repository = createKnowledgeStoreRepository({
    dbFile: resolvedDbFile,
    coreRoot,
    clock,
  });
  const grant = operationGrant({
    rootScopeId: normalizedRoot,
    permission: "export",
    actor,
    purpose: "deterministic knowledge export",
    clock,
  });
  const exported = repository.exportKnowledge({
    grant,
    rootScopeId: normalizedRoot,
    releaseId: releaseId == null ? null : requiredText(releaseId, "--release-id"),
  });
  const serialized = repository.serializeExport(exported);
  await writeFileAtomic(normalizedOutput, serialized, {
    label: "Export do Knowledge Store",
    encoding: "utf8",
  });
  const metadata = await stat(normalizedOutput);
  return assertKnowledgeContract({
    schema: KNOWLEDGE_EXPORT_RESULT_SCHEMA,
    action: normalizedAction,
    status: "exported",
    providerFree: true,
    readOnly: false,
    storeReadOnly: true,
    changed: true,
    rootScopeId: normalizedRoot,
    releaseId: exported.releaseId,
    file: normalizedOutput,
    bytes: metadata.size,
    sha256: sha256(serialized),
  }, {
    schemaId: KNOWLEDGE_EXPORT_RESULT_SCHEMA,
    label: "Resultado de knowledge export",
  });
}
