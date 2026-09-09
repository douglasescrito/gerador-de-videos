import { readdir, readFile, stat, statfs } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { materializeExecutionSnapshot } from "./execution-journal.mjs";
import { assertExecutionTiming, summarizeExecutionTimings } from "./execution-timing.mjs";
import { verifyReceipt } from "./receipt.mjs";
import { readRemoteReplacementDecision } from "./resource-broker.mjs";

export const JOBS_REPORT_SCHEMA = "mkt-videos/jobs@1";
export const USAGE_COST_REPORT_SCHEMA = "mkt-videos/usage-cost-report@1";
export const STORAGE_REPORT_SCHEMA = "mkt-videos/storage-report@1";
export const RUNTIME_OPERATIONS_SCHEMA = "mkt-videos/runtime-operations@1";

function sqliteTableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

/**
 * @param {{ dbFile: string, now?: Date }} options
 */
export function buildRuntimeOperationsSnapshot({ dbFile, now = new Date() }) {
  const absolute = path.resolve(String(dbFile));
  let db;
  try { db = new DatabaseSync(absolute, { readOnly: true }); }
  catch {
    return { schema: RUNTIME_OPERATIONS_SCHEMA, generatedAt: new Date(now).toISOString(), readOnly: true, status: "not-initialized", dbFile: absolute, broker: null, schedules: null };
  }
  try {
    // Uma leitura do diagnóstico pode coincidir com abertura/migração de outro
    // processo. Aguarde apenas a trava curta e leia todos os contadores na
    // mesma transação, sem combinar leases e reservas de instantes diferentes.
    db.exec("PRAGMA busy_timeout=1000; BEGIN");
    const leasesTable = sqliteTableExists(db, "broker_resource_leases_v2") ? "broker_resource_leases_v2" : "broker_leases";
    const leases = sqliteTableExists(db, leasesTable)
      ? db.prepare(`SELECT lease_id,request_id,production_id,client_id,resources_json,acquired_at,heartbeat_at FROM ${leasesTable} ORDER BY acquired_at`).all().map((row) => ({ leaseId: row.lease_id, requestId: row.request_id, productionId: row.production_id, clientId: row.client_id, resources: JSON.parse(row.resources_json), acquiredAt: row.acquired_at, heartbeatAt: row.heartbeat_at }))
      : [];
    const remoteOperations = sqliteTableExists(db, "broker_remote_operations")
      ? db.prepare("SELECT * FROM broker_remote_operations ORDER BY created_at").all().map((row) => {
        const decision = readRemoteReplacementDecision(db, row);
        return { operationId: row.operation_id, productionId: row.production_id, clientId: row.client_id, resourceId: row.resource_id, weight: Number(row.weight), state: row.state, nextObservationAt: row.next_observation_at,
          externalEffectUnknown: row.terminal_proof_json == null && row.handle_json == null,
          administrativelyReleased: decision != null,
          replacementDecisionId: decision?.decisionId ?? null,
          replacementDecisionHash: decision?.hash ?? null,
          occupiesRemoteCapacity: row.terminal_proof_json == null && decision == null,
          observerClaimed: row.claim_until != null && Date.parse(row.claim_until) > new Date(now).getTime() };
      })
      : [];
    const queue = sqliteTableExists(db, "broker_requests")
      ? db.prepare("SELECT request_id,production_id,client_id,priority,state,created_at,due_at FROM broker_requests WHERE state IN ('queued','orphaned') ORDER BY priority,created_at").all().map((row) => ({ requestId: row.request_id, productionId: row.production_id, clientId: row.client_id, priority: row.priority, status: row.state, createdAt: row.created_at, dueAt: row.due_at }))
      : [];
    const cycles = sqliteTableExists(db, "schedule_cycles")
      ? db.prepare("SELECT cycle_key,schedule_id,planned_fire_at,status,production_id,client_id,director_id,journal_file,receipt_id,collapsed_missed,heartbeat_at FROM schedule_cycles ORDER BY planned_fire_at DESC LIMIT 200").all().map((row) => ({ cycleKey: row.cycle_key, scheduleId: row.schedule_id, plannedFireAt: row.planned_fire_at, status: row.status, productionId: row.production_id, clientId: row.client_id, directorId: row.director_id, journalFile: row.journal_file, receiptId: row.receipt_id, collapsedMissed: Number(row.collapsed_missed), heartbeatAt: row.heartbeat_at }))
      : [];
    const used = {};
    for (const lease of leases) for (const resource of lease.resources) used[resource.id] = (used[resource.id] ?? 0) + Number(resource.weight);
    for (const remote of remoteOperations) if (remote.occupiesRemoteCapacity) used[remote.resourceId] = (used[remote.resourceId] ?? 0) + remote.weight;
    return {
      schema: RUNTIME_OPERATIONS_SCHEMA,
      generatedAt: new Date(now).toISOString(),
      readOnly: true,
      status: "ready",
      dbFile: absolute,
      // Fila e órfão não são a mesma coisa: um espera capacidade, o outro é
      // resto de um dono que sumiu. Contar os dois juntos fazia a visão
      // operacional mostrar espera que já não existe.
      broker: {
        activeLeases: leases.length,
        queued: queue.filter((entry) => entry.status === "queued").length,
        orphaned: queue.filter((entry) => entry.status === "orphaned").length,
        used,
        leases,
        queue,
        remoteInFlight: remoteOperations.filter((entry) => entry.occupiesRemoteCapacity).length,
        remoteUnknown: remoteOperations.filter((entry) => entry.externalEffectUnknown).length,
        administrativelyReleased: remoteOperations.filter((entry) => entry.administrativelyReleased).length,
        remoteOperations,
      },
      schedules: { total: cycles.length, states: Object.fromEntries([...new Set(cycles.map((cycle) => cycle.status))].sort().map((status) => [status, cycles.filter((cycle) => cycle.status === status).length])), cycles },
      contentCapture: false,
    };
  } catch (error) {
    if ([5, 6].includes(error?.errcode)) return { schema: RUNTIME_OPERATIONS_SCHEMA, generatedAt: new Date(now).toISOString(), readOnly: true, status: "busy", dbFile: absolute, broker: null, schedules: null };
    throw error;
  } finally { db.close(); }
}

async function walkFiles(root, accept = () => true) {
  const absoluteRoot = path.resolve(root);
  let entries;
  try {
    // Node's native recursive walker avoids thousands of JS-level readdir
    // round trips on large Windows output trees. Dirent traversal does not
    // follow symlinks/junctions, preserving the previous read-only boundary.
    entries = await readdir(absoluteRoot, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => accept(file, path.basename(file)));
}

function activeStage(state) {
  const priority = ["running", "ambiguous", "attention_required", "awaiting_approval", "failed", "planned", "blocked"];
  for (const status of priority) {
    const found = Object.entries(state?.stages ?? {}).find(([, stage]) => stage?.status === status);
    if (found) return { name: found[0], status, ...found[1] };
  }
  return null;
}

function jobNextAction(state, stage, scene) {
  if (state.status === "awaiting_approval") return `npm run video -- approve --draft "${state.draftFile}"`;
  if (scene?.reconciliation?.classification === "provider_pending") return `npm run video -- reconcile --state "${state.stateFile}" --stage video --scene ${scene.id}`;
  if (scene && ["ambiguous", "failed"].includes(scene.status)) return `npm run video -- reconcile --state "${state.stateFile}" --stage video --scene ${scene.id}`;
  if (state.status === "attention_required") return "Inspecionar o estado; não repetir chamadas pagas automaticamente.";
  if (state.status === "ready") return `npm run video -- resume --state "${state.stateFile}"`;
  if (state.status === "delivered") return "Nenhuma ação pendente.";
  return stage ? `Inspecionar etapa ${stage.name} (${stage.status}).` : "Inspecionar o estado.";
}

export async function listFilmJobs({ root, runtimeDb = null } = {}) {
  const absoluteRoot = path.resolve(String(root));
  const operationalFiles = await walkFiles(absoluteRoot, (_file, name) => name === "film-state.json" || name === "execution-journal.sqlite");
  const stateFiles = operationalFiles.filter((file) => path.basename(file) === "film-state.json");
  const journalFiles = new Map(operationalFiles.filter((file) => path.basename(file) === "execution-journal.sqlite").map((file) => [path.dirname(file), file]));
  const jobs = [];
  const unreadable = [];
  // State files are small JSON snapshots. Reads are batched in bounded chunks
  // so large output trees do not pay for thousands of sequential opens while
  // the report keeps a predictable ceiling on in-flight filesystem work.
  const parsed = [];
  // 256 mantém o teto de handles previsível e reduz quatro vezes as barreiras
  // de lote no hot path de 1000 jobs, inclusive sob contenção de outros agentes.
  const CHUNK_SIZE = 256;
  for (let offset = 0; offset < stateFiles.length; offset += CHUNK_SIZE) {
    const results = await Promise.all(
      stateFiles.slice(offset, offset + CHUNK_SIZE).map(async (file) => {
        try {
          const state = JSON.parse(await readFile(file, "utf8"));
          if (state?.schema !== "mkt-videos/film-state@1") throw new Error("schema incompatível");
          const stage = activeStage(state);
          let draft = null;
          try { draft = state.draftFile ? JSON.parse(await readFile(state.draftFile, "utf8")) : null; } catch {}
          const scene = draft?.scenes?.find((entry) => ["generating", "ambiguous", "failed"].includes(entry.status)) ?? null;
          const expirationTime = scene?.providerHandle?.expirationTime ?? scene?.reconciliation?.expirationTime ?? null;
          let journal = null;
          const journalFile = journalFiles.get(path.dirname(file));
          if (journalFile) {
            const snapshot = materializeExecutionSnapshot({ dbFile: journalFile, readOnly: true });
            journal = { file: path.resolve(journalFile), status: snapshot.status, lastEvent: snapshot.lastEvent, attentionNodes: Object.values(snapshot.nodes).filter((node) => ["attention_required", "ambiguous", "provider_pending", "stale_paid", "reapproval_required"].includes(node.status)).map((node) => node.id) };
            journal.executionTiming = summarizeExecutionTimings(Object.values(snapshot.nodes));
            journal.approvedReuseNodes = Object.values(snapshot.nodes).filter((node) => node.reuseSource === "approved-archive").map((node) => node.id);
            journalFiles.delete(path.dirname(file));
          }
          return { job: {
            id: state.id,
            collection: path.relative(absoluteRoot, path.dirname(path.dirname(file))).split(path.sep).join("/"),
            stateFile: path.resolve(file),
            status: state.status,
            activeStage: stage ? { name: stage.name, status: stage.status } : null,
            activeScene: scene ? { id: scene.id, status: scene.status, classification: scene.reconciliation?.classification ?? null } : null,
            updatedAt: state.updatedAt ?? null,
            finalFile: state.finalFile ?? null,
            expirationTime,
            reconcileDeadline: expirationTime,
            retentionProtected: ["running", "attention_required", "awaiting_approval"].includes(state.status),
            nextAction: jobNextAction(state, stage, scene),
            journal,
          } };
        } catch (error) {
          return { unreadable: { stateFile: path.resolve(file), error: error?.message ?? String(error) } };
        }
      }),
    );
    parsed.push(...results);
  }
  for (const entry of parsed) {
    if (entry.job) jobs.push(entry.job);
    else unreadable.push(entry.unreadable);
  }
  for (const journalFile of journalFiles.values()) {
    try {
      const snapshot = materializeExecutionSnapshot({ dbFile: journalFile, readOnly: true });
      jobs.push({ id: `journal:${snapshot.planFingerprint.slice(0, 24)}`, collection: path.relative(absoluteRoot, path.dirname(path.dirname(journalFile))).split(path.sep).join("/"), stateFile: null, status: snapshot.status, activeStage: null, activeScene: null, updatedAt: snapshot.lastEvent?.at ?? null, finalFile: null, expirationTime: null, reconcileDeadline: null, retentionProtected: snapshot.status !== "completed", nextAction: snapshot.status === "completed" ? "Nenhuma ação pendente." : "Inspecionar o execution journal.", journal: { file: path.resolve(journalFile), status: snapshot.status, lastEvent: snapshot.lastEvent, attentionNodes: Object.values(snapshot.nodes).filter((node) => node.status !== "completed").map((node) => node.id) } });
      jobs.at(-1).journal.executionTiming = summarizeExecutionTimings(Object.values(snapshot.nodes));
      jobs.at(-1).journal.approvedReuseNodes = Object.values(snapshot.nodes).filter((node) => node.reuseSource === "approved-archive").map((node) => node.id);
    } catch (error) { unreadable.push({ stateFile: path.resolve(journalFile), error: error?.message ?? String(error) }); }
  }
  jobs.sort((left, right) => {
    const leftExpiry = Date.parse(left.expirationTime ?? "") || Number.POSITIVE_INFINITY;
    const rightExpiry = Date.parse(right.expirationTime ?? "") || Number.POSITIVE_INFINITY;
    return leftExpiry - rightExpiry || String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
  });
  const counts = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return { schema: JOBS_REPORT_SCHEMA, generatedAt: new Date().toISOString(), root: absoluteRoot, scope: "studio-film-states+journals", counts, total: jobs.length, unreadable, jobs, runtime: runtimeDb == null ? null : buildRuntimeOperationsSnapshot({ dbFile: runtimeDb }) };
}

function receiptUsage(receipt) {
  return receipt?.providerResponse?.usageMetadata ?? receipt?.providerResponse?.usage_metadata ?? receipt?.providerResponse?.usage ?? receipt?.metadata?.usageMetadata ?? null;
}

function receiptCost(receipt, priceBook) {
  const cost = receipt?.cost;
  if (cost && Number.isFinite(Number(cost.amount ?? cost.value))) {
    const classification = cost.classification === "reported" || cost.source === "billing" ? "reported" : "estimated";
    return { classification, amount: Number(cost.amount ?? cost.value), currency: cost.currency ?? null, source: cost.source ?? null, priceBookVersion: cost.priceBookVersion ?? null };
  }
  const rule = priceBook?.rates?.find?.((entry) => (entry.model == null || entry.model === receipt?.model) && (entry.operation == null || entry.operation === receipt?.operation));
  if (rule && Number.isFinite(Number(rule.perCall))) return { classification: "estimated", amount: Number(rule.perCall), currency: priceBook.currency, source: priceBook.source ?? null, priceBookVersion: priceBook.version };
  return { classification: "unknown", amount: null, currency: priceBook?.currency ?? null, source: null, priceBookVersion: null };
}

function receiptExecutionTiming(receipt) {
  const value = receipt.metadata?.executionTiming;
  if (!value) return null;
  try {
    if (value.coverage !== "until-receipt-construction") throw new Error("coverage");
    const { schema: _schema, intervals, ...summary } = assertExecutionTiming(value.measurement);
    return { coverage: value.coverage, measurementSummary: { ...summary, measuredIntervals: intervals.length } };
  } catch { return { coverage: "invalid", measurementSummary: null }; }
}

export async function buildUsageCostReport({ root, from = null, to = null, priceBook = null } = {}) {
  if (priceBook && (!priceBook.version || !priceBook.currency || !Array.isArray(priceBook.rates))) throw new Error("priceBook exige version, currency e rates.");
  const absoluteRoot = path.resolve(String(root));
  const operationalFiles = await walkFiles(absoluteRoot, (_file, name) => name.endsWith(".receipt.json") || name === "execution-journal.sqlite");
  const files = operationalFiles.filter((file) => file.endsWith(".receipt.json"));
  const journals = operationalFiles.filter((file) => path.basename(file) === "execution-journal.sqlite");
  const seen = new Set();
  const records = [];
  let unreadable = 0;
  let duplicates = 0;
  for (const file of files) {
    try {
      const receipt = JSON.parse(await readFile(file, "utf8"));
      const completedAt = receipt.completedAt ?? receipt.createdAt ?? null;
      if (from && (!completedAt || Date.parse(completedAt) < Date.parse(from))) continue;
      if (to && (!completedAt || Date.parse(completedAt) > Date.parse(to))) continue;
      const identity = receipt.id ? `id:${receipt.id}` : `path:${path.resolve(file)}`;
      if (seen.has(identity)) { duplicates += 1; continue; }
      seen.add(identity);
      const usage = receiptUsage(receipt);
      const cost = receiptCost(receipt, priceBook);
      const approvedReuse = receipt.operation === "reuse-artifact" && verifyReceipt(receipt).valid && receipt.metadata?.approvedReuse?.binding?.schema === "mkt-videos/approved-reuse-binding@1";
      const operationAvoided = approvedReuse && receipt.metadata.avoidedOperation === receipt.metadata.approvedReuse.binding.consumer?.id ? receipt.metadata.avoidedOperation : null;
      records.push({
        receiptId: receipt.id ?? null,
        operation: receipt.operation ?? null,
        provider: receipt.provider ?? null,
        model: receipt.model ?? null,
        collection: path.relative(absoluteRoot, file).split(path.sep)[0] ?? null,
        completedAt,
        call: receipt.operation === "reuse-artifact" ? "reuse_copy" : receipt.operation === "reconcile-video" ? "reconciled" : "completed",
        ...(receipt.operation === "reuse-artifact" ? { reuse: { evidence: approvedReuse ? "governed-receipt" : "legacy-or-unverified", operationAvoided, providerPostAvoided: false } } : {}),
        quota: usage == null ? { classification: "unknown", usage: null } : { classification: "reported", usage },
        money: cost,
        executionTiming: receiptExecutionTiming(receipt),
      });
    } catch { unreadable += 1; }
  }
  const calls = { planned: 0, authorized: 0, completed: 0, ambiguous: 0, providerPending: 0, reconciled: 0, avoidedByReuse: 0, reuseCopies: 0, localOperationsAvoided: 0 };
  const money = { reported: 0, estimated: 0, unknown: 0, currencies: {} };
  let quotaReported = 0;
  for (const record of records) {
    if (record.call === "completed") calls.completed += 1;
    else if (record.call === "reconciled") calls.reconciled += 1;
    else if (record.call === "reuse_copy") { calls.reuseCopies += 1; if (record.reuse.operationAvoided) calls.localOperationsAvoided += 1; }
    if (record.quota.classification === "reported") quotaReported += 1;
    if (record.money.classification === "unknown") money.unknown += 1;
    else {
      money[record.money.classification] += record.money.amount;
      const currency = record.money.currency ?? "unknown";
      money.currencies[currency] = (money.currencies[currency] ?? 0) + record.money.amount;
    }
  }
  for (const journalFile of journals) {
    try {
      const db = new DatabaseSync(journalFile, { readOnly: true });
      try {
        const plan = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='plan'").get()?.value ?? "null");
        calls.planned += plan?.nodes?.filter((node) => node.costClass !== "local").length ?? 0;
        for (const event of db.prepare("SELECT type,data FROM events WHERE type IN ('node_authorized','provider_handle_persisted','node_failed')").all()) {
          if (event.type === "node_authorized") calls.authorized += 1;
          else if (event.type === "provider_handle_persisted") calls.providerPending += 1;
          else if (["ambiguous", "attention_required"].includes(JSON.parse(event.data)?.status)) calls.ambiguous += 1;
        }
      } finally { db.close(); }
    } catch { unreadable += 1; }
  }
  return {
    schema: USAGE_COST_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    root: absoluteRoot,
    period: { from, to },
    priceBook: priceBook ? { version: priceBook.version, currency: priceBook.currency, effectiveAt: priceBook.effectiveAt ?? null, source: priceBook.source ?? null } : null,
    scanned: files.length,
    journalsScanned: journals.length,
    deduplicatedReceipts: records.length,
    duplicates,
    unreadable,
    calls,
    quota: { reported: quotaReported, unknown: records.length - quotaReported, monetaryEquivalent: null },
    money: { ...money, status: money.reported || money.estimated ? "partial" : "unknown" },
    executionTimingPolicy: { aggregation: "do-not-sum-receipt-snapshots", detailSource: "receipt.metadata.executionTiming", unknown: null, meaning: "Recibos podem compartilhar intervalos do mesmo nó ou lote; cada snapshot termina antes da publicação do próprio recibo." },
    records,
  };
}

function storageClass(file, referenced, activeRoots) {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  if (activeRoots.some((root) => file === root || file.startsWith(`${root}${path.sep}`))) return { class: "protected", reason: "active_job" };
  if (referenced.has(path.resolve(file))) return { class: "protected", reason: "receipt_reference" };
  if (/\.receipt\.json$|film-(state|plan)\.json$|draft\.json$|timeline|approval|filme\.json$/.test(normalized)) return { class: "protected", reason: "state_or_provenance" };
  if (/\/(videos-soltos|audio|keyframes)\//.test(normalized) || /master|final\.mp4$/.test(normalized)) return { class: "protected", reason: "source_or_master" };
  if (/\.(tmp|part)$|\.lock$/.test(normalized)) return { class: "ephemeral", reason: "temporary" };
  if (/\/diagnosticos\//.test(normalized) || /\.log$/.test(normalized)) return { class: "diagnostic", reason: "diagnostic" };
  if (/proxy|animatic|normaliz|qa\.|captioned/.test(normalized)) return { class: "rebuildable", reason: "derived" };
  return { class: "protected", reason: "unclassified_safe_default" };
}

export async function buildStorageReport({ root, graceHours = 24, capacityAlertPercent = 15 } = {}) {
  const absoluteRoot = path.resolve(String(root));
  const files = await walkFiles(absoluteRoot);
  const referenced = new Set();
  const activeRoots = [];
  for (const file of files) {
    if (file.endsWith(".receipt.json")) {
      try {
        const receipt = JSON.parse(await readFile(file, "utf8"));
        for (const artifact of [...(receipt.inputs ?? []), ...(receipt.artifacts ?? [])]) if (artifact?.file) referenced.add(path.resolve(artifact.file));
      } catch {}
    } else if (path.basename(file) === "film-state.json") {
      try {
        const state = JSON.parse(await readFile(file, "utf8"));
        if (["running", "attention_required", "awaiting_approval"].includes(state.status)) activeRoots.push(path.dirname(path.dirname(file)));
      } catch {}
    }
  }
  const classes = {};
  const collections = {};
  const candidates = [];
  const cutoff = Date.now() - Number(graceHours) * 3_600_000;
  let totalBytes = 0;
  for (const file of files) {
    const info = await stat(file);
    const classified = storageClass(file, referenced, activeRoots);
    const collection = path.relative(absoluteRoot, file).split(path.sep)[0] || ".";
    totalBytes += info.size;
    classes[classified.class] ??= { files: 0, bytes: 0 };
    classes[classified.class].files += 1;
    classes[classified.class].bytes += info.size;
    collections[collection] ??= { files: 0, bytes: 0, classes: {} };
    collections[collection].files += 1;
    collections[collection].bytes += info.size;
    collections[collection].classes[classified.class] = (collections[collection].classes[classified.class] ?? 0) + info.size;
    if (classified.class === "ephemeral" && info.mtimeMs <= cutoff) candidates.push({ file: path.resolve(file), bytes: info.size, class: classified.class, reason: classified.reason, action: "review_for_quarantine" });
  }
  let volume = null;
  try {
    const value = await statfs(absoluteRoot, { bigint: true });
    const total = value.blocks * value.bsize;
    const free = value.bavail * value.bsize;
    volume = { totalBytes: total.toString(), freeBytes: free.toString(), freePercent: total > 0n ? Number((free * 10_000n) / total) / 100 : null, alert: total > 0n ? Number((free * 10_000n) / total) / 100 < Number(capacityAlertPercent) : null };
  } catch {}
  return {
    schema: STORAGE_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    root: absoluteRoot,
    readOnly: true,
    totals: { files: files.length, bytes: totalBytes },
    classes,
    collections,
    volume,
    policy: { graceHours: Number(graceHours), capacityAlertPercent: Number(capacityAlertPercent), referencedFilesPrunable: false, activeJobsPrunable: false },
    plan: { action: "none", candidates, bytesReviewable: candidates.reduce((sum, entry) => sum + entry.bytes, 0), note: "Relatório somente leitura; nenhum arquivo foi movido ou apagado." },
  };
}
