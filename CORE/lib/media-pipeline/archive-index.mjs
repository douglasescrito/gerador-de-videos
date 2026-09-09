import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { verifyReceipt } from "./receipt.mjs";
import { recipeFromReceipt } from "./recipe.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const ARCHIVE_INDEX_SCHEMA = "mkt-videos/archive-index@1";
export const RECIPE_PREFERENCE_EVENT_SCHEMA = "mkt-videos/recipe-preference-event@1";

async function receiptFiles(root) {
  const found = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".receipt.json")) found.push(file);
    }
  }
  await visit(path.resolve(root));
  return found;
}

function pipelineStyle(receipt) {
  return receipt?.metadata?.promptComposition?.directionPreset
    ?? receipt?.metadata?.pipeline?.directionPreset
    ?? receipt?.parameters?.style
    ?? null;
}

function collectionName(file, root) {
  const relative = path.relative(root, file).split(path.sep);
  return relative.length > 1 ? relative[0] : null;
}

function probeMetadata(receipt) {
  const probe = receipt?.metadata?.probe ?? receipt?.metadata?.after ?? receipt?.metadata?.outputProbe ?? null;
  const video = probe?.video ?? probe?.streams?.find?.((stream) => stream.codec_type === "video") ?? null;
  return {
    duration: Number.isFinite(Number(probe?.duration ?? probe?.format?.duration)) ? Number(probe?.duration ?? probe?.format?.duration) : null,
    width: Number.isInteger(Number(video?.width)) ? Number(video.width) : null,
    height: Number.isInteger(Number(video?.height)) ? Number(video.height) : null,
  };
}

function normalizedReceipt(file, root, receipt) {
  const isStandard = receipt?.schema === "mkt-videos/receipt@1";
  const validation = isStandard ? verifyReceipt(receipt) : { valid: null, errors: [] };
  const inputHashes = (receipt?.inputs ?? []).map((entry) => entry?.hash?.value).filter(Boolean);
  const artifacts = (receipt?.artifacts ?? []).map((entry) => entry?.file).filter(Boolean);
  const style = pipelineStyle(receipt);
  const probe = probeMetadata(receipt);
  const recipeHash = recipeFromReceipt(receipt).hash;
  return {
    path: path.resolve(file),
    id: receipt?.id ?? null,
    schema: receipt?.schema ?? null,
    valid: validation.valid == null ? null : validation.valid ? 1 : 0,
    validationErrors: validation.errors,
    operation: receipt?.operation ?? null,
    task: receipt?.parameters?.task ?? null,
    model: receipt?.model ?? null,
    prompt: receipt?.prompt ?? null,
    style,
    collection: collectionName(file, root),
    status: receipt?.status ?? null,
    startedAt: receipt?.startedAt ?? receipt?.createdAt ?? null,
    completedAt: receipt?.completedAt ?? null,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    inputHashes,
    artifacts,
    receiptHash: receipt?.hash?.value ?? null,
    recipeHash,
  };
}

function upsertRow(db, row) {
  db.prepare(`INSERT OR REPLACE INTO receipts
    (path,id,schema,valid,validation_errors,operation,task,model,prompt,style,collection,status,started_at,completed_at,duration,width,height,input_hashes,artifacts,receipt_hash,recipe_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.path, row.id, row.schema, row.valid, JSON.stringify(row.validationErrors), row.operation, row.task, row.model, row.prompt, row.style, row.collection, row.status, row.startedAt, row.completedAt, row.duration, row.width, row.height, JSON.stringify(row.inputHashes), JSON.stringify(row.artifacts), row.receiptHash, row.recipeHash);
  db.prepare("DELETE FROM receipts_fts WHERE path=?").run(row.path);
  db.prepare("INSERT INTO receipts_fts(path,prompt,collection,task,style,model) VALUES (?,?,?,?,?,?)")
    .run(row.path, row.prompt ?? "", row.collection ?? "", row.task ?? "", row.style ?? "", row.model ?? "");
}

function initialize(db) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (
      path TEXT PRIMARY KEY,
      id TEXT,
      schema TEXT,
      valid INTEGER,
      validation_errors TEXT,
      operation TEXT,
      task TEXT,
      model TEXT,
      prompt TEXT,
      style TEXT,
      collection TEXT,
      status TEXT,
      started_at TEXT,
      completed_at TEXT,
      duration REAL,
      width INTEGER,
      height INTEGER,
      input_hashes TEXT,
      artifacts TEXT,
      receipt_hash TEXT,
      recipe_hash TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS receipts_fts USING fts5(path UNINDEXED, prompt, collection, task, style, model);
    CREATE TABLE IF NOT EXISTS reviews (
      receipt_path TEXT PRIMARY KEY,
      receipt_id TEXT,
      status TEXT NOT NULL,
      rating INTEGER,
      tags TEXT NOT NULL,
      notes TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      receipt_path TEXT PRIMARY KEY,
      receipt_id TEXT,
      liked INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorite_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      rel_path TEXT NOT NULL,
      receipt_path TEXT,
      receipt_id TEXT,
      liked INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS favorite_events_rel_path_idx ON favorite_events(rel_path,event_id);
    CREATE TABLE IF NOT EXISTS external_favorite_event_imports (
      source TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      imported_event_id INTEGER NOT NULL,
      source_occurred_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY(source,source_event_id),
      FOREIGN KEY(imported_event_id) REFERENCES favorite_events(event_id)
    );
    CREATE TABLE IF NOT EXISTS recipe_preference_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      preference_key TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      recipe_hash TEXT NOT NULL,
      style TEXT,
      motion_combination_id TEXT,
      motion_instruction_ids TEXT NOT NULL,
      source_file TEXT,
      liked INTEGER NOT NULL,
      actor TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recipe_preference_events_key_idx ON recipe_preference_events(preference_key,event_id);
    CREATE INDEX IF NOT EXISTS recipe_preference_events_motion_idx ON recipe_preference_events(motion_combination_id,event_id);
    CREATE INDEX IF NOT EXISTS receipts_recipe_hash_idx ON receipts(recipe_hash);
    CREATE INDEX IF NOT EXISTS receipts_collection_idx ON receipts(collection);
  `);
  // Um ledger que contém apenas likes continua sendo um archive-index válido.
  // Sem esta marca, a projeção read-only ignorava eventos importados do shell
  // desktop até que uma indexação completa de recibos fosse executada.
  db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)").run("schema", ARCHIVE_INDEX_SCHEMA);
}

export async function buildArchiveIndex({ root, dbFile } = {}) {
  const absoluteRoot = path.resolve(String(root));
  const absoluteDb = path.resolve(String(dbFile));
  const files = await receiptFiles(absoluteRoot);
  const db = new DatabaseSync(absoluteDb);
  try {
    initialize(db);
    db.exec("BEGIN IMMEDIATE; DELETE FROM receipts; DELETE FROM receipts_fts;");
    let indexed = 0;
    let unreadable = 0;
    for (const file of files) {
      try {
        const receipt = JSON.parse(await readFile(file, "utf8"));
        const row = normalizedReceipt(file, absoluteRoot, receipt);
        upsertRow(db, row);
        indexed += 1;
      } catch {
        unreadable += 1;
      }
    }
    db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run("schema", ARCHIVE_INDEX_SCHEMA);
    db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run("root", absoluteRoot);
    db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run("updatedAt", new Date().toISOString());
    db.exec("COMMIT;");
    return { schema: ARCHIVE_INDEX_SCHEMA, dbFile: absoluteDb, root: absoluteRoot, scanned: files.length, indexed, unreadable };
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

export async function upsertArchiveReceipt({ root, dbFile, receiptFile, preserveRoot = false } = {}) {
  const absoluteRoot = path.resolve(String(root));
  const absoluteReceipt = path.resolve(String(receiptFile));
  const receipt = JSON.parse(await readFile(absoluteReceipt, "utf8"));
  const row = normalizedReceipt(absoluteReceipt, absoluteRoot, receipt);
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  try {
    initialize(db);
    db.exec("BEGIN IMMEDIATE;");
    upsertRow(db, row);
    db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run("schema", ARCHIVE_INDEX_SCHEMA);
    if (!preserveRoot || !db.prepare("SELECT value FROM metadata WHERE key='root'").get()) db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run("root", absoluteRoot);
    db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run("updatedAt", new Date().toISOString());
    db.exec("COMMIT;");
    return { schema: ARCHIVE_INDEX_SCHEMA, indexed: 1, receiptFile: absoluteReceipt, recipeHash: row.recipeHash };
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

export function searchArchive({ dbFile, query = "", task = null, style = null, collection = null, reviewStatus = null, tag = null, recipeHash = null, limit = 20 } = {}) {
  const db = new DatabaseSync(path.resolve(String(dbFile)), { readOnly: true });
  try {
    const schema = db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value;
    if (schema !== ARCHIVE_INDEX_SCHEMA) throw new Error("Índice do acervo ausente ou incompatível; execute index primeiro.");
    const clauses = ["(r.valid IS NULL OR r.valid=1)"];
    const parameters = [];
    let from = "receipts r LEFT JOIN reviews v ON v.receipt_path=r.path";
    if (String(query).trim()) {
      from += " JOIN receipts_fts f ON f.path=r.path";
      clauses.push("receipts_fts MATCH ?");
      parameters.push(String(query).trim());
    }
    for (const [column, value] of [["r.task", task], ["r.style", style], ["r.collection", collection], ["v.status", reviewStatus], ["r.recipe_hash", recipeHash]]) {
      if (value != null && String(value).trim()) {
        clauses.push(`${column}=?`);
        parameters.push(String(value).trim());
      }
    }
    if (tag != null && String(tag).trim()) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(v.tags) THEN v.tags ELSE '[]' END) AS review_tag WHERE review_tag.value=?)");
      parameters.push(String(tag).trim());
    }
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
    const sql = `SELECT r.path,r.id,r.schema,r.valid,r.operation,r.task,r.model,r.prompt,r.style,r.collection,r.status,r.started_at AS startedAt,r.completed_at AS completedAt,r.duration,r.width,r.height,r.recipe_hash AS recipeHash,v.status AS reviewStatus,v.rating,v.tags,v.notes FROM ${from} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY COALESCE(r.completed_at,r.started_at) DESC LIMIT ?`;
    return db.prepare(sql).all(...parameters, safeLimit).map((row) => ({ ...row, tags: row.tags ? JSON.parse(row.tags) : [] }));
  } finally {
    db.close();
  }
}

export function summarizeArchiveLifecycle({ dbFile } = {}) {
  const db = new DatabaseSync(path.resolve(String(dbFile)), { readOnly: true });
  try {
    const schema = db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value;
    if (schema !== ARCHIVE_INDEX_SCHEMA) throw new Error("Índice do acervo ausente ou incompatível; execute index primeiro.");
    const visibleReceipt = "(r.valid IS NULL OR r.valid=1)";
    const totals = db.prepare(`SELECT
      COUNT(*) AS receipts,
      COUNT(DISTINCT r.collection) AS collections,
      SUM(CASE WHEN v.receipt_path IS NULL THEN 1 ELSE 0 END) AS unreviewed,
      SUM(CASE WHEN v.receipt_path IS NOT NULL THEN 1 ELSE 0 END) AS reviewed
      FROM receipts r
      LEFT JOIN reviews v ON v.receipt_path=r.path
      WHERE ${visibleReceipt}`).get();
    const statuses = db.prepare(`SELECT v.status AS status, COUNT(*) AS count
      FROM receipts r
      JOIN reviews v ON v.receipt_path=r.path
      WHERE ${visibleReceipt}
      GROUP BY v.status
      ORDER BY v.status`).all();
    const tags = db.prepare(`SELECT review_tag.value AS tag, COUNT(*) AS count
      FROM receipts r
      JOIN reviews v ON v.receipt_path=r.path
      JOIN json_each(CASE WHEN json_valid(v.tags) THEN v.tags ELSE '[]' END) AS review_tag
      WHERE ${visibleReceipt}
      GROUP BY review_tag.value
      ORDER BY count DESC, tag`).all();
    return {
      schema: ARCHIVE_INDEX_SCHEMA,
      receipts: Number(totals.receipts),
      collections: Number(totals.collections),
      reviewed: Number(totals.reviewed),
      unreviewed: Number(totals.unreviewed),
      statuses: Object.fromEntries(statuses.map((row) => [row.status, Number(row.count)])),
      tags: tags.map((row) => ({ tag: String(row.tag), count: Number(row.count) })),
    };
  } finally {
    db.close();
  }
}

export function initializeArchiveLifecycle({
  dbFile,
  status = "needs-review",
  tag = "needs-review",
  note = "Classificação inicial provider-free; requer revisão humana.",
  now = new Date(),
} = {}) {
  if (status !== "needs-review") throw new Error("A inicialização lifecycle só pode marcar needs-review.");
  const normalizedTag = String(tag ?? "").trim();
  if (!normalizedTag) throw new Error("tag é obrigatória.");
  const updatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  try {
    initialize(db);
    const schema = db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value;
    if (schema !== ARCHIVE_INDEX_SCHEMA) throw new Error("Índice do acervo ausente ou incompatível; execute index primeiro.");
    db.exec("BEGIN IMMEDIATE;");
    const result = db.prepare(`INSERT INTO reviews(receipt_path,receipt_id,status,rating,tags,notes,updated_at)
      SELECT r.path,r.id,?,NULL,?,?,?
      FROM receipts r
      LEFT JOIN reviews v ON v.receipt_path=r.path
      WHERE v.receipt_path IS NULL`).run(status, JSON.stringify([normalizedTag]), String(note), updatedAt);
    db.exec("COMMIT;");
    return {
      schema: ARCHIVE_INDEX_SCHEMA,
      initialized: Number(result.changes),
      preservedExistingReviews: true,
      status,
      tags: [normalizedTag],
      updatedAt,
    };
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

/**
 * @param {{
 *   dbFile: string,
 *   receiptPath?: string|null,
 *   receiptId?: string|null,
 *   status: string,
 *   rating?: number|null,
 *   tags?: string[],
 *   notes?: string|null,
 *   expectedReviewHash?: string
 * }} options
 */
export function setArchiveReview({ dbFile, receiptPath, receiptId = null, status, rating = null, tags = [], notes = null, expectedReviewHash = undefined }) {
  const allowed = new Set(["approved", "rejected", "needs-review"]);
  const normalizedStatus = String(status ?? "").trim();
  if (!allowed.has(normalizedStatus)) throw new Error(`Status de review inválido: ${normalizedStatus}.`);
  const normalizedRating = rating == null ? null : Number(rating);
  if (normalizedRating != null && (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5)) throw new Error("rating deve ser inteiro de 1 a 5.");
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  try {
    initialize(db);
    db.exec("BEGIN IMMEDIATE");
    let absoluteReceipt = receiptPath == null ? null : path.resolve(String(receiptPath));
    if (!absoluteReceipt && receiptId) {
      const matches = db.prepare("SELECT path FROM receipts WHERE id=? LIMIT 2").all(String(receiptId));
      if (matches.length > 1) throw new Error(`ID de recibo ambíguo: ${receiptId}. Informe receiptPath.`);
      absoluteReceipt = matches[0]?.path ?? null;
    }
    if (!absoluteReceipt) throw new Error("Informe receiptPath ou receiptId.");
    const exists = db.prepare("SELECT id FROM receipts WHERE path=?").get(absoluteReceipt);
    if (!exists) throw new Error(`Recibo não indexado: ${absoluteReceipt}`);
    if (expectedReviewHash !== undefined && operationFingerprint(reviewHead(db, absoluteReceipt)) !== expectedReviewHash) throw new Error("A revisão editorial mudou desde a preparação; prepare uma nova decisão.");
    if (receiptId != null && receiptId !== exists.id) throw new Error("receiptId diverge do recibo indexado.");
    const updatedAt = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO reviews(receipt_path,receipt_id,status,rating,tags,notes,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(absoluteReceipt, receiptId ?? exists.id ?? null, normalizedStatus, normalizedRating, JSON.stringify([...new Set(tags.map(String))]), notes == null ? null : String(notes), updatedAt);
    db.exec("COMMIT");
    return { receiptPath: absoluteReceipt, status: normalizedStatus, rating: normalizedRating, tags: [...new Set(tags.map(String))], notes, updatedAt };
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

export function listArchiveReviews({ dbFile, root } = {}) {
  const databaseFile = path.resolve(String(dbFile));
  if (!databaseFile) return [];
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const schema = db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value;
    if (schema !== ARCHIVE_INDEX_SCHEMA) return [];
    return db.prepare(`SELECT r.path,r.id,r.artifacts,v.status,v.rating,v.tags,v.notes,v.updated_at AS updatedAt
      FROM receipts r
      JOIN reviews v ON v.receipt_path=r.path
      ORDER BY v.updated_at DESC`).all().map((row) => {
        let artifacts = [];
        try { artifacts = JSON.parse(row.artifacts ?? "[]"); } catch {}
        const video = artifacts.find((file) => String(file).toLowerCase().endsWith(".mp4")) ?? null;
        const relPath = video && root
          ? path.relative(path.resolve(String(root)), path.resolve(video)).replace(/\\/g, "/")
          : null;
        return {
          receiptPath: row.path,
          receiptId: row.id,
          artifactId: relPath,
          relPath,
          status: row.status,
          rating: row.rating,
          tags: row.tags ? JSON.parse(row.tags) : [],
          reason: row.notes,
          updatedAt: row.updatedAt,
        };
      }).filter((row) => row.relPath && !row.relPath.startsWith("../"));
  } finally {
    db.close();
  }
}

/**
 * Marca ou desmarca um vídeo como favorito (evidência humana append-only).
 * O evento é ligado ao caminho do MP4, portanto também cobre vídeos antigos
 * sem recibo. Desmarcar grava um novo evento em vez de apagar a evidência.
 * @param {{ dbFile: string, relPath: string, receiptPath?: string|null, receiptId?: string|null, liked: boolean }} options
 */
export function setArchiveFavorite({ dbFile, relPath, receiptPath = null, receiptId = null, liked = true }) {
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  try {
    initialize(db);
    const normalizedRelPath = String(relPath ?? '').replaceAll('\\', '/').trim();
    if (!normalizedRelPath) throw new Error('Informe relPath do vídeo.');
    const absoluteReceipt = receiptPath == null ? null : path.resolve(String(receiptPath));
    const updatedAt = new Date().toISOString();
    db.prepare("INSERT INTO favorite_events(rel_path,receipt_path,receipt_id,liked,updated_at) VALUES (?,?,?,?,?)")
      .run(normalizedRelPath, absoluteReceipt, receiptId, liked ? 1 : 0, updatedAt);
    return { relPath: normalizedRelPath, receiptPath: absoluteReceipt, liked: Boolean(liked), updatedAt };
  } finally {
    db.close();
  }
}

/** Retorna a lista de vídeos marcados como favoritos. */
export function listArchiveFavorites({ dbFile, root } = {}) {
  const databaseFile = path.resolve(String(dbFile));
  if (!databaseFile) return [];
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const schema = db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value;
    if (schema !== ARCHIVE_INDEX_SCHEMA) return [];
    const latestEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='favorite_events'").get()
      ? db.prepare(`SELECT event.rel_path AS relPath,event.receipt_path AS receiptPath,event.receipt_id AS receiptId,event.liked,event.updated_at AS updatedAt
          FROM favorite_events event
          JOIN (SELECT rel_path,MAX(event_id) AS event_id FROM favorite_events GROUP BY rel_path) latest
            ON latest.event_id=event.event_id
          ORDER BY event.event_id DESC`).all()
      : [];
    const latestByPath = new Map(latestEvents.map((row) => [row.relPath, row]));
    const favorites = latestEvents
      .filter((row) => Boolean(row.liked))
      .map((row) => ({
        receiptPath: row.receiptPath,
        receiptId: row.receiptId,
        artifactId: row.relPath,
        relPath: row.relPath,
        liked: true,
        updatedAt: row.updatedAt,
      }));
    const legacy = db.prepare(`SELECT r.path,r.id,r.artifacts,f.liked,f.updated_at AS updatedAt
      FROM receipts r
      JOIN favorites f ON f.receipt_path=r.path
      ORDER BY f.updated_at DESC`).all().map((row) => {
        let artifacts = [];
        try { artifacts = JSON.parse(row.artifacts ?? "[]"); } catch {}
        const video = artifacts.find((file) => String(file).toLowerCase().endsWith(".mp4")) ?? null;
        const relPath = video && root
          ? path.relative(path.resolve(String(root)), path.resolve(video)).replace(/\\/g, "/")
          : null;
        return {
          receiptPath: row.path,
          receiptId: row.id,
          artifactId: relPath,
          relPath,
          liked: Boolean(row.liked),
          updatedAt: row.updatedAt,
        };
      }).filter((row) => row.relPath && !row.relPath.startsWith("../") && !latestByPath.has(row.relPath));
    return [...favorites, ...legacy]
      .filter((row) => row.relPath && !row.relPath.startsWith('../') && !path.isAbsolute(row.relPath));
  } finally {
    db.close();
  }
}

/**
 * Importa eventos append-only de outro shell local. A chave da origem impede
 * duplicação; unlike permanece como novo evento, nunca como deleção.
 * @param {{ dbFile: string, source: string, events: Array<{ sourceEventId: string|number, relPath: string, liked: boolean, occurredAt: string }> }} options
 */
export function importExternalFavoriteEvents({ dbFile, source, events = [] } = {}) {
  const normalizedSource = String(source ?? "").trim();
  if (!normalizedSource) throw new Error("source é obrigatório para importar favoritos.");
  if (!Array.isArray(events)) throw new Error("events deve ser uma lista.");
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  try {
    initialize(db);
    db.exec("BEGIN IMMEDIATE;");
    let imported = 0;
    let skipped = 0;
    const importedAt = new Date().toISOString();
    const already = db.prepare("SELECT 1 FROM external_favorite_event_imports WHERE source=? AND source_event_id=?");
    const append = db.prepare("INSERT INTO favorite_events(rel_path,receipt_path,receipt_id,liked,updated_at) VALUES (?,?,?,?,?)");
    const remember = db.prepare("INSERT INTO external_favorite_event_imports(source,source_event_id,imported_event_id,source_occurred_at,imported_at) VALUES (?,?,?,?,?)");
    for (const event of events) {
      const sourceEventId = String(event?.sourceEventId ?? "").trim();
      const relPath = String(event?.relPath ?? "").replaceAll("\\", "/").trim();
      const occurredAt = String(event?.occurredAt ?? "").trim();
      if (!sourceEventId || !relPath || path.isAbsolute(relPath) || relPath.startsWith("../") || !Number.isFinite(Date.parse(occurredAt))) throw new Error("Evento externo de favorito inválido.");
      if (already.get(normalizedSource, sourceEventId)) { skipped += 1; continue; }
      const result = append.run(relPath, null, null, event?.liked === true ? 1 : 0, occurredAt);
      remember.run(normalizedSource, sourceEventId, Number(result.lastInsertRowid), occurredAt, importedAt);
      imported += 1;
    }
    db.exec("COMMIT;");
    return { schema: "mkt-videos/external-favorite-import@1", source: normalizedSource, received: events.length, imported, skipped, providerCalls: 0 };
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Registra um like/unlike de receita como evento imutável. A rota da Galeria
 * resolve os campos contra a prateleira antes de chamar esta função; o banco
 * nunca recebe uma combinação motion inventada pelo cliente.
 * @param {{
 *   dbFile: string,
 *   preferenceKey: string,
 *   recipeId: string,
 *   recipeHash: string,
 *   style?: string|null,
 *   motionCombinationId?: string|null,
 *   motionInstructionIds?: string[],
 *   sourceFile?: string|null,
 *   liked?: boolean,
 *   actor?: string
 * }} options
 */
export function setRecipePreference({
  dbFile,
  preferenceKey,
  recipeId,
  recipeHash,
  style = null,
  motionCombinationId = null,
  motionInstructionIds = [],
  sourceFile = null,
  liked = true,
  actor = "local-gallery-human",
} = {}) {
  const normalizedKey = String(preferenceKey ?? "").trim().toLowerCase();
  const normalizedHash = String(recipeHash ?? "").trim().toLowerCase();
  const normalizedRecipeId = String(recipeId ?? "").trim();
  const normalizedActor = String(actor ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(normalizedKey)) throw new Error("preferenceKey deve ser um SHA-256.");
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new Error("recipeHash deve ser um SHA-256.");
  if (!normalizedRecipeId) throw new Error("recipeId é obrigatório.");
  if (!normalizedActor) throw new Error("actor é obrigatório.");
  const instructions = [...new Set((Array.isArray(motionInstructionIds) ? motionInstructionIds : []).map((id) => String(id).trim()).filter(Boolean))];
  const updatedAt = new Date().toISOString();
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  try {
    initialize(db);
    const result = db.prepare(`INSERT INTO recipe_preference_events
      (preference_key,recipe_id,recipe_hash,style,motion_combination_id,motion_instruction_ids,source_file,liked,actor,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        normalizedKey,
        normalizedRecipeId,
        normalizedHash,
        style == null ? null : String(style),
        motionCombinationId == null ? null : String(motionCombinationId),
        JSON.stringify(instructions),
        sourceFile == null ? null : String(sourceFile),
        liked ? 1 : 0,
        normalizedActor,
        updatedAt,
      );
    return {
      schema: RECIPE_PREFERENCE_EVENT_SCHEMA,
      eventId: Number(result.lastInsertRowid),
      preferenceKey: normalizedKey,
      recipeId: normalizedRecipeId,
      recipeHash: normalizedHash,
      style: style == null ? null : String(style),
      motionCombinationId: motionCombinationId == null ? null : String(motionCombinationId),
      motionInstructionIds: instructions,
      sourceFile: sourceFile == null ? null : String(sourceFile),
      liked: Boolean(liked),
      actor: normalizedActor,
      updatedAt,
    };
  } finally {
    db.close();
  }
}

/**
 * Projeção atual dos eventos de preferência por receita, sem apagar o histórico.
 * @param {{ dbFile: string, likedOnly?: boolean }} options
 */
export function listRecipePreferences({ dbFile, likedOnly = false } = {}) {
  const databaseFile = path.resolve(String(dbFile));
  if (!existsSync(databaseFile)) return [];
  let db = null;
  try {
    db = new DatabaseSync(databaseFile, { readOnly: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recipe_preference_events'").get();
    if (!table) return [];
    const rows = db.prepare(`SELECT
        event.event_id AS eventId,
        event.preference_key AS preferenceKey,
        event.recipe_id AS recipeId,
        event.recipe_hash AS recipeHash,
        event.style,
        event.motion_combination_id AS motionCombinationId,
        event.motion_instruction_ids AS motionInstructionIds,
        event.source_file AS sourceFile,
        event.liked,
        event.actor,
        event.updated_at AS updatedAt
      FROM recipe_preference_events event
      JOIN (
        SELECT preference_key,MAX(event_id) AS event_id
        FROM recipe_preference_events
        GROUP BY preference_key
      ) latest ON latest.event_id=event.event_id
      ${likedOnly ? "WHERE event.liked=1" : ""}
      ORDER BY event.event_id DESC`).all();
    return rows.map((row) => ({
      ...row,
      liked: Boolean(row.liked),
      motionInstructionIds: JSON.parse(row.motionInstructionIds ?? "[]"),
    }));
  } catch (error) {
    if (String(error?.code ?? "").includes("CANTOPEN")) return [];
    throw error;
  } finally {
    db?.close();
  }
}

function reviewHead(db, receiptPath) {
  return db.prepare("SELECT receipt_id,status,rating,tags,notes,updated_at FROM reviews WHERE receipt_path=?").get(path.resolve(receiptPath)) ?? null;
}

export function readArchiveReview({ dbFile, receiptPath }) {
  if (!existsSync(dbFile)) return { review: null, hash: operationFingerprint(null) };
  const db = new DatabaseSync(path.resolve(dbFile), { readOnly: true });
  try {
    const review = db.prepare("SELECT name FROM sqlite_master WHERE name='reviews'").get() ? reviewHead(db, receiptPath) : null;
    return { review, hash: operationFingerprint(review) };
  } finally { db.close(); }
}
