// Índice de prompts derivado dos recibos `mkt-videos/receipt@1`.
//
// Cada vídeo gerado pela CLI grava `<video>.mp4.receipt.json` ao lado do
// arquivo, com o prompt literal enviado ao provedor. Este módulo varre uma raiz
// de outputs, lê esses recibos e monta um índice consultável — é o que permite
// perguntar "que prompt gerou este vídeo?" e "quais vídeos saíram deste estilo?".
//
// O índice é DERIVADO e descartável: se divergir do recibo, o recibo vence.
// Vídeo sem recibo fica ausente do índice, nunca com prompt vazio ou inventado.

import fs from "node:fs";
import path from "node:path";
import { readPromptProvenanceLink } from "./archive-prompt-backfill.mjs";

export const PROMPT_INDEX_SCHEMA = "mkt-videos/prompt-index@1";
export const RECEIPT_SCHEMA = "mkt-videos/receipt@1";

const RECEIPT_SUFFIX = ".receipt.json";

/**
 * Varre `root` atrás de pares vídeo + recibo.
 * Retorna a lista de mp4 encontrados, com ou sem recibo, para que o chamador
 * consiga medir cobertura.
 */
export function scanReceiptPairs(root) {
  const pairs = [];
  if (!fs.existsSync(root)) return pairs;

  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, relPath);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".mp4")) continue;

      const receiptPath = `${full}${RECEIPT_SUFFIX}`;
      let receiptStat = null;
      try {
        receiptStat = fs.statSync(receiptPath);
      } catch {
        receiptStat = null;
      }
      pairs.push({
        relPath,
        videoPath: full,
        receiptPath: receiptStat ? receiptPath : null,
        receiptSize: receiptStat?.size ?? null,
        receiptMtimeMs: receiptStat?.mtimeMs ?? null,
      });
    }
  };

  walk(root, "");
  return pairs;
}

/**
 * Nem todo recibo é de geração. Operações locais de ffmpeg — montar o filme
 * (`finish-video`), mixar áudio (`mux-master-audio`), queimar legenda
 * (`render-word-captions`) — emitem recibo válido com `prompt: null`, porque
 * nenhum prompt foi enviado a provedor nenhum. Isso não é recibo defeituoso, e
 * contá-los como tal falsearia a cobertura do índice.
 */
export function isGenerativeReceipt(receipt) {
  return (
    receipt?.schema === RECEIPT_SCHEMA &&
    typeof receipt.prompt === "string" &&
    receipt.prompt.trim() !== ""
  );
}

/**
 * Extrai do recibo apenas o que o índice publica.
 * `parameters.auth` é descartado de propósito: o índice não guarda segredo.
 */
export function projectReceipt(receipt) {
  if (!isGenerativeReceipt(receipt)) return null;

  const parameters = receipt.parameters ?? {};
  const composition = receipt.metadata?.promptComposition ?? null;

  const startedAt = receipt.startedAt ?? null;
  const completedAt = receipt.completedAt ?? null;
  let durationMs = null;
  if (startedAt && completedAt) {
    const delta = Date.parse(completedAt) - Date.parse(startedAt);
    if (Number.isFinite(delta) && delta >= 0) durationMs = delta;
  }

  // Forma real gravada pelo pipeline, estável em todo o acervo:
  // userPrompt (direção literal do usuário) + directionPreset (estilo aplicado)
  // + effectivePrompt (o que de fato foi ao provedor). É esse trio que torna
  // o reuso possível: reexecutar = mesmo directionPreset + mesmo userPrompt.
  return {
    receiptId: receipt.id ?? null,
    prompt: receipt.prompt,
    promptComposition: composition
      ? {
          userPrompt: composition.userPrompt ?? null,
          directionPreset: composition.directionPreset ?? null,
          effectivePrompt: composition.effectivePrompt ?? null,
          compositionAuthorized: composition.compositionAuthorized ?? null,
          suggestedAspect: composition.suggestedAspect ?? null,
        }
      : null,
    provider: receipt.provider ?? null,
    model: receipt.model ?? null,
    operation: receipt.operation ?? null,
    task: parameters.task ?? null,
    aspectRatio: parameters.aspectRatio ?? null,
    mode: parameters.mode ?? receipt.metadata?.mode ?? null,
    status: receipt.status ?? null,
    cost: receipt.cost ?? null,
    batchId: receipt.metadata?.batchId ?? null,
    templateBinding: receipt.metadata?.templateBinding
      ? structuredClone(receipt.metadata.templateBinding)
      : null,
    startedAt,
    completedAt,
    durationMs,
  };
}

function readReceipt(receiptPath) {
  try {
    return JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Monta o índice completo.
 *
 * `cache` opcional no formato `{ entries: { [relPath]: { receiptSize, receiptMtimeMs, ...projeção } } }`
 * evita reparse de recibos que não mudaram.
 */
export function buildPromptIndex(root, { cache = null } = {}) {
  const pairs = scanReceiptPairs(root);
  const entries = {};
  const cached = cache?.entries ?? {};

  let withReceipt = 0;
  let reused = 0;
  let unreadable = 0;
  const nonGenerative = {};

  for (const pair of pairs) {
    if (!pair.receiptPath) {
      const link = readPromptProvenanceLink({ outputsRoot: root, relPath: pair.relPath });
      if (link) {
        entries[pair.relPath] = {
          receiptFile: null,
          receiptSize: null,
          receiptMtimeMs: null,
          receiptId: null,
          prompt: link.prompt,
          promptComposition: null,
          provider: null,
          model: null,
          operation: null,
          task: null,
          aspectRatio: null,
          mode: null,
          status: "provenance-linked",
          cost: null,
          batchId: null,
          templateBinding: null,
          startedAt: null,
          completedAt: link.createdAt,
          durationMs: null,
          backfillSource: structuredClone(link.source),
        };
      }
      continue;
    }
    withReceipt++;

    const hit = cached[pair.relPath];
    if (
      hit &&
      hit.receiptSize === pair.receiptSize &&
      Math.abs((hit.receiptMtimeMs ?? 0) - pair.receiptMtimeMs) < 1000
    ) {
      entries[pair.relPath] = hit;
      reused++;
      continue;
    }

    const receipt = readReceipt(pair.receiptPath);
    if (!receipt || receipt.schema !== RECEIPT_SCHEMA) {
      unreadable++;
      continue;
    }

    const projected = projectReceipt(receipt);
    if (!projected) {
      // recibo válido de operação local (ffmpeg), sem prompt por natureza
      const op = receipt.operation ?? "(sem operation)";
      nonGenerative[op] = (nonGenerative[op] ?? 0) + 1;
      continue;
    }

    entries[pair.relPath] = {
      receiptFile: `${pair.relPath}${RECEIPT_SUFFIX}`,
      receiptSize: pair.receiptSize,
      receiptMtimeMs: pair.receiptMtimeMs,
      ...projected,
    };
  }

  return {
    schema: PROMPT_INDEX_SCHEMA,
    builtAt: new Date().toISOString(),
    root,
    entries,
    stats: {
      videos: pairs.length,
      withReceipt,
      indexed: Object.keys(entries).length,
      withoutReceipt: pairs.length - withReceipt,
      // recibos válidos de operação local (ffmpeg), que não carregam prompt
      nonGenerativeReceipts: Object.values(nonGenerative).reduce((a, b) => a + b, 0),
      nonGenerativeByOperation: nonGenerative,
      // recibos que não deu para ler ou com schema desconhecido
      unreadableReceipts: unreadable,
      reusedFromCache: reused,
      // cobertura de PROMPT: quantos vídeos dá para responder "que prompt gerou isto?"
      promptCoverage:
        pairs.length === 0 ? 0 : Number(((Object.keys(entries).length / pairs.length) * 100).toFixed(1)),
    },
  };
}

/**
 * Consulta o índice. Todos os filtros combinam por AND; ausência de filtro
 * devolve tudo, ordenado do mais recente para o mais antigo.
 */
export function queryPromptIndex(index, filters = {}) {
  const {
    text = null,
    provider = null,
    model = null,
    task = null,
    aspect = null,
    mode = null,
    collection = null,
    from = null,
    to = null,
    limit = null,
  } = filters;

  const needle = text ? String(text).toLowerCase() : null;
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;

  let rows = Object.entries(index.entries).map(([relPath, entry]) => ({ relPath, ...entry }));

  rows = rows.filter((row) => {
    if (needle) {
      const haystack = [
        row.prompt,
        row.promptComposition?.userPrompt,
        row.promptComposition?.directionPreset,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (provider && row.provider !== provider) return false;
    if (model && row.model !== model) return false;
    if (task && row.task !== task) return false;
    if (aspect && row.aspectRatio !== aspect) return false;
    if (mode && row.mode !== mode) return false;
    if (collection && row.relPath.split("/")[0] !== collection) return false;
    if (fromMs !== null && (!row.completedAt || Date.parse(row.completedAt) < fromMs)) return false;
    if (toMs !== null && (!row.completedAt || Date.parse(row.completedAt) > toMs)) return false;
    return true;
  });

  rows.sort((a, b) => String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? "")));
  if (limit !== null && Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return rows;
}

/** Índice invertido leve: quantos vídeos por prompt idêntico. */
export function groupByPrompt(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.prompt;
    if (!groups.has(key)) {
      groups.set(key, {
        prompt: key,
        count: 0,
        videos: [],
        directionPreset: row.promptComposition?.directionPreset ?? null,
      });
    }
    const group = groups.get(key);
    group.count++;
    group.videos.push(row.relPath);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function loadIndexCache(cacheFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (parsed?.schema !== PROMPT_INDEX_SCHEMA) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveIndexCache(cacheFile, index) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, `${JSON.stringify(index)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
