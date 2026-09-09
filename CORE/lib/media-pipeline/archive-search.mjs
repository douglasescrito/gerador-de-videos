import { DatabaseSync } from "node:sqlite";

export const ARCHIVE_SEARCH_SCHEMA = "mkt-videos/archive-search-result@1";

function ftsQuery(value) {
  const tokens = String(value ?? "")
    .normalize("NFKC")
    .match(/[\p{L}\p{N}_@.-]+/gu) ?? [];
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

function normalizeFilters(filters = {}) {
  const numberOrNull = (value) => {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Filtro numérico inválido.");
    return parsed;
  };
  let cursor = null;
  if (filters.cursor != null && filters.cursor !== "") {
    try {
      const candidate = typeof filters.cursor === "string"
        ? JSON.parse(filters.cursor)
        : filters.cursor;
      if (
        !candidate
        || !Number.isFinite(Number(candidate.mtimeMs))
        || typeof candidate.relPath !== "string"
        || candidate.relPath.length === 0
      ) throw new Error();
      cursor = { mtimeMs: Number(candidate.mtimeMs), relPath: candidate.relPath };
    } catch {
      throw new Error("Cursor do acervo inválido.");
    }
  }
  return {
    q: String(filters.q ?? "").trim(),
    collection: filters.collection ? String(filters.collection) : null,
    preset: filters.preset ? String(filters.preset) : null,
    task: filters.task ? String(filters.task) : null,
    mode: filters.mode ? String(filters.mode) : null,
    model: filters.model ? String(filters.model) : null,
    aspect: filters.aspect ? String(filters.aspect) : null,
    review: filters.review ? String(filters.review) : null,
    linkage: filters.linkage ? String(filters.linkage) : null,
    batchId: filters.batchId ? String(filters.batchId) : null,
    templateId: filters.templateId ? String(filters.templateId) : null,
    templateRevision: numberOrNull(filters.templateRevision),
    minDuration: numberOrNull(filters.minDuration),
    maxDuration: numberOrNull(filters.maxDuration),
    promptRecorded: filters.promptRecorded == null || filters.promptRecorded === ""
      ? null
      : filters.promptRecorded === true || String(filters.promptRecorded).toLowerCase() === "true",
    transcriptRecorded: filters.transcriptRecorded == null || filters.transcriptRecorded === ""
      ? null
      : filters.transcriptRecorded === true || String(filters.transcriptRecorded).toLowerCase() === "true",
    liked: filters.liked == null || filters.liked === ""
      ? null
      : filters.liked === true || String(filters.liked).toLowerCase() === "true",
    cursor,
    limit: Math.min(1_000, Math.max(1, Number(filters.limit ?? 200))),
  };
}

function transcriptMap(transcripts = []) {
  const map = new Map();
  for (const entry of transcripts) {
    const payload = entry?.payload ?? entry;
    if (payload?.schema !== "mkt-videos/media-transcript@1") continue;
    map.set(payload.assetId, payload);
  }
  return map;
}

function reviewMap(reviews = []) {
  return new Map(reviews.map((entry) => [entry.relPath ?? entry.artifactId, entry]));
}

function favoriteMap(favorites = []) {
  return new Map(favorites.map((entry) => [entry.relPath ?? entry.artifactId, entry]));
}

function rowProjection(video, promptEntry, transcript, review, favorite) {
  const binding = promptEntry?.templateBinding ?? null;
  const tags = [
    promptEntry?.task,
    promptEntry?.mode,
    promptEntry?.model,
    promptEntry?.aspectRatio,
    promptEntry?.promptComposition?.directionPreset,
    binding?.templateId,
    binding?.templateRevision == null ? null : `revision:${binding.templateRevision}`,
    video.isMaster ? "master" : null,
  ].filter(Boolean);
  return {
    ...video,
    promptRecorded: Boolean(promptEntry),
    transcriptRecorded: Boolean(transcript),
    liked: Boolean(favorite),
    likedAt: favorite?.updatedAt ?? null,
    receiptId: promptEntry?.receiptId ?? null,
    userPrompt: promptEntry?.promptComposition?.userPrompt ?? promptEntry?.prompt ?? null,
    effectivePrompt: promptEntry?.promptComposition?.effectivePrompt ?? promptEntry?.prompt ?? null,
    directionPreset: promptEntry?.promptComposition?.directionPreset ?? video.directionPreset ?? null,
    provider: promptEntry?.provider ?? null,
    model: promptEntry?.model ?? null,
    task: promptEntry?.task ?? null,
    aspectRatio: promptEntry?.aspectRatio ?? null,
    mode: promptEntry?.mode ?? null,
    batchId: promptEntry?.batchId ?? null,
    templateBinding: binding,
    review: review?.status ?? null,
    reviewReason: review?.reason ?? null,
    transcript: transcript?.text ?? null,
    transcriptLanguage: transcript?.language ?? null,
    tags,
  };
}

// Recriar a tabela virtual e inserir milhares de linhas por busca custava a
// maior parte do tempo de resposta digitando no campo de busca — mais caro,
// inclusive, que reconstruir o catálogo. `ftsCache` deixa o chamador
// reaproveitar a mesma tabela em memória entre buscas enquanto o catálogo por
// trás não mudar: é um objeto mutável que o PRÓPRIO chamador cria e possui (no
// servidor, um por snapshot do catálogo) — nunca um estado global do módulo,
// que vazaria entre instâncias diferentes de app no mesmo processo (era
// exatamente esse o defeito de uma versão anterior desta função, pega por um
// teste que roda várias instâncias no mesmo processo). Sem `ftsCache` (chamada
// direta, testes) o comportamento continua puro: uma tabela nova a cada
// chamada, sem estado sobrevivendo entre elas.
//
// A tabela é indexada pela ORDEM de `catalog.videos`, que não muda enquanto o
// chamador reusar o mesmo `ftsCache` (mesmo objeto `catalog` por trás). `rows`
// em si é sempre recalculado na hora — review e transcript nunca ficam
// desatualizados no resultado; só a busca por texto num transcript adicionado
// depois da tabela cacheada só passa a encontrá-lo quando o cache for trocado.
function ftsDatabaseFor(rows, ftsCache) {
  if (ftsCache?.database) return ftsCache.database;
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE VIRTUAL TABLE archive_fts USING fts5(title, collection_name, user_prompt, effective_prompt, transcript, tags, tokenize='unicode61 remove_diacritics 2')");
  const insert = database.prepare("INSERT INTO archive_fts(rowid,title,collection_name,user_prompt,effective_prompt,transcript,tags) VALUES(?,?,?,?,?,?,?)");
  rows.forEach((row, index) => insert.run(
    index + 1,
    row.title,
    row.collectionName,
    row.userPrompt ?? "",
    row.effectivePrompt ?? "",
    row.transcript ?? "",
    row.tags.join(" "),
  ));
  if (ftsCache) ftsCache.database = database;
  return database;
}

/**
 * FTS5 efêmero: o índice é projeção reconstruível e nunca vira uma segunda
 * fonte de verdade. Conteúdo vem do recibo e de transcript governado do root.
 */
export function searchArchive({
  catalog,
  promptIndex,
  transcripts = [],
  reviews = [],
  favorites = [],
  filters = {},
  ftsCache = null,
}) {
  const normalized = normalizeFilters(filters);
  const prompts = promptIndex?.entries ?? {};
  const transcriptByAsset = transcriptMap(transcripts);
  const reviewByArtifact = reviewMap(reviews);
  const favoriteByArtifact = favoriteMap(favorites);
  const rows = (catalog?.videos ?? []).map((video) =>
    rowProjection(
      video,
      prompts[video.relPath] ?? null,
      transcriptByAsset.get(video.id) ?? transcriptByAsset.get(video.relPath) ?? null,
      reviewByArtifact.get(video.relPath) ?? null,
      favoriteByArtifact.get(video.relPath) ?? null,
    ));

  let allowedIds = null;
  if (normalized.q) {
    const database = ftsDatabaseFor(rows, ftsCache);
    const owned = ftsCache == null;
    try {
      const query = ftsQuery(normalized.q);
      allowedIds = new Set(
        database.prepare("SELECT rowid FROM archive_fts WHERE archive_fts MATCH ?").all(query)
          .map(({ rowid }) => Number(rowid) - 1),
      );
    } finally {
      if (owned) database.close();
    }
  }

  const matched = rows.filter((row, index) => {
    if (allowedIds && !allowedIds.has(index)) return false;
    if (normalized.collection && row.collectionId !== normalized.collection) return false;
    if (normalized.preset && row.directionPreset !== normalized.preset) return false;
    if (normalized.task && row.task !== normalized.task) return false;
    if (normalized.mode && row.mode !== normalized.mode) return false;
    if (normalized.model && row.model !== normalized.model) return false;
    if (normalized.aspect && row.aspectRatio !== normalized.aspect && row.aspect !== normalized.aspect) return false;
    if (normalized.review && row.review !== normalized.review) return false;
    if (normalized.linkage && row.linkage !== normalized.linkage) return false;
    if (normalized.batchId && row.batchId !== normalized.batchId) return false;
    if (normalized.templateId && row.templateBinding?.templateId !== normalized.templateId) return false;
    if (normalized.templateRevision != null && row.templateBinding?.templateRevision !== normalized.templateRevision) return false;
    if (normalized.minDuration != null && (row.duration == null || row.duration < normalized.minDuration)) return false;
    if (normalized.maxDuration != null && (row.duration == null || row.duration > normalized.maxDuration)) return false;
    if (normalized.promptRecorded != null && row.promptRecorded !== normalized.promptRecorded) return false;
    if (normalized.transcriptRecorded != null && row.transcriptRecorded !== normalized.transcriptRecorded) return false;
    if (normalized.liked != null && row.liked !== normalized.liked) return false;
    return true;
  }).sort((a, b) => b.mtimeMs - a.mtimeMs || a.relPath.localeCompare(b.relPath));

  let start = 0;
  if (normalized.cursor) {
    const exact = matched.findIndex((row) =>
      row.mtimeMs === normalized.cursor.mtimeMs
      && row.relPath === normalized.cursor.relPath);
    if (exact >= 0) {
      start = exact + 1;
    } else {
      const after = matched.findIndex((row) =>
        row.mtimeMs < normalized.cursor.mtimeMs
        || (row.mtimeMs === normalized.cursor.mtimeMs
          && row.relPath.localeCompare(normalized.cursor.relPath) > 0));
      start = after < 0 ? matched.length : after;
    }
  }
  const page = matched.slice(start, start + normalized.limit);
  const last = page.at(-1);
  const nextCursor = start + page.length < matched.length && last
    ? { mtimeMs: last.mtimeMs, relPath: last.relPath }
    : null;

  return {
    schema: ARCHIVE_SEARCH_SCHEMA,
    query: normalized,
    total: matched.length,
    returned: page.length,
    rows: page,
    nextCursor,
    coverage: {
      videos: rows.length,
      prompt: rows.filter((row) => row.promptRecorded).length,
      transcript: rows.filter((row) => row.transcriptRecorded).length,
      measured: rows.filter((row) => row.duration != null).length,
      reviewed: rows.filter((row) => row.review != null).length,
      liked: rows.filter((row) => row.liked).length,
    },
  };
}
