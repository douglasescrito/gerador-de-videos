// Persistência do vídeo gerado pelo Omni no acervo local, com recibo.
//
// Antes deste módulo, `POST /api/generate-video` devolvia um fileId e nada mais:
// o vídeo vivia na storage do provedor mais um cache em RAM de 12 itens, e
// nenhum recibo era gravado. Resultado: o que era gerado pela tela não entrava
// na galeria, não tinha prompt consultável e sumia quando saía do cache.
//
// Aqui o laço fecha: baixa o MP4, grava em `outputs/<coleção>/<nome>.mp4` e emite
// `<nome>.mp4.receipt.json` no MESMO contrato `mkt-videos/receipt@1` que a CLI
// usa — é isso que faz o vídeo aparecer em `prompts`, em `usage` e na galeria.
//
// Compartilhado de propósito entre a tela e o lote: um bug de persistência se
// conserta em um lugar só.

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { createArtifactFromKnownFile, sha256Buffer } from "./artifact.mjs";
import { createReceipt, receiptPathForArtifact, writeReceipt } from "./receipt.mjs";

export const OMNI_STORE_SCHEMA = "mkt-videos/omni-artifact-store@1";

const MP4_MAGIC_BOX = "ftyp";

/**
 * Nome de arquivo seguro derivado de um título livre. Sem acento, sem separador
 * de caminho, sem nome reservado do Windows — o acervo é navegado por humano e
 * indexado por caminho relativo, então nome sujo vira dor depois.
 */
export function safeSlug(raw, fallback = "clipe") {
  const base = String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de acento separadas pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!base) return fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) return `${base}-arquivo`;
  return base;
}

/**
 * Rejeita nome de coleção que tente escapar da raiz de outputs.
 *
 * Entrada com sintaxe de caminho é REJEITADA, não saneada: o slug apagaria a
 * travessia (`../fuga` viraria `fuga`) e o chamador gravaria num lugar diferente
 * do que pediu, achando que deu certo. Falhar alto é melhor que reescrever calado.
 */
export function assertSafeCollection(collection) {
  const normalized = String(collection ?? "").trim();
  if (!normalized) throw new Error("collection é obrigatória para persistir no acervo.");
  if (normalized.includes("\0")) throw new Error("collection inválida.");
  if (path.isAbsolute(normalized)) throw new Error("collection não pode ser caminho absoluto.");
  if (/[/\\]/.test(normalized)) {
    throw new Error("collection é um único nível de pasta: não pode conter / nem \\.");
  }
  if (normalized.split(/[.]+/).some((part) => part === "") && normalized.includes("..")) {
    throw new Error("collection não pode conter '..'.");
  }
  const slug = safeSlug(normalized, "");
  if (!slug) throw new Error("collection não produziu nome de pasta utilizável.");
  return slug;
}

/**
 * Confere que o buffer é mesmo um MP4 antes de gravar. O provedor já devolveu
 * HTML de erro com status 200 em outras rotas deste projeto; gravar isso como
 * .mp4 no acervo criaria um arquivo corrompido com recibo válido, que é pior do
 * que falhar.
 */
export function mp4BufferError(buffer) {
  if (!buffer || buffer.length === 0) return "Download vazio: nenhum byte recebido.";
  if (buffer.length < 32) return `Download muito pequeno para ser MP4 (${buffer.length} bytes).`;
  const head = buffer.subarray(0, 64).toString("latin1");
  if (!head.includes(MP4_MAGIC_BOX)) {
    return "Conteúdo baixado não tem box 'ftyp': não é um MP4 válido.";
  }
  return null;
}

async function writeBufferAtomic(file, buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return file;
}

/**
 * Resolve um destino livre dentro da coleção, sem sobrescrever nada.
 * `01-abertura.mp4` já existe → `01-abertura-2.mp4`.
 */
export async function resolveFreeTarget(outputsRoot, collection, baseName, { exists }) {
  const folder = path.join(outputsRoot, collection);
  let candidate = path.join(folder, `${baseName}.mp4`);
  let counter = 2;
  while (await exists(candidate)) {
    candidate = path.join(folder, `${baseName}-${counter}.mp4`);
    counter += 1;
    if (counter > 999) throw new Error(`Não achei nome livre para ${baseName} em ${collection}.`);
  }
  return candidate;
}

/**
 * Grava o vídeo e o recibo.
 *
 * `exists` é injetado para que o teste não precise de provedor nem de rede, e
 * para que a tela e o lote compartilhem exatamente este caminho de escrita.
 *
 * O JSDoc abaixo não é enfeite: `app/server.ts` é TypeScript e importa este
 * módulo `.mjs`. Sem a assinatura declarada, o `tsc --noEmit` do app infere o
 * parâmetro só a partir dos defaults e reprova os campos obrigatórios.
 *
 * @param {object} args
 * @param {string} args.outputsRoot raiz do acervo (normalmente CORE/outputs)
 * @param {string} args.collection pasta de um nível dentro do acervo
 * @param {string} args.name título livre, convertido em nome de arquivo seguro
 * @param {Buffer} args.buffer bytes do MP4 já baixado
 * @param {string} args.prompt prompt literal enviado ao provedor
 * @param {(file: string) => Promise<boolean>} args.exists teste de existência de arquivo
 * @param {string} [args.provider]
 * @param {string|null} [args.model]
 * @param {string} [args.operation]
 * @param {Record<string, unknown>} [args.parameters]
 * @param {Record<string, unknown>} [args.metadata]
 * @param {Record<string, unknown>} [args.providerResponse]
 * @param {unknown[]} [args.inputs]
 * @param {unknown} [args.cost]
 * @param {Date} [args.startedAt]
 * @param {Date} [args.completedAt]
 * @returns {Promise<{schema: string, videoFile: string, receiptFile: string, collection: string, relPath: string, bytes: number, receiptId: string}>}
 */
export async function persistOmniVideo({
  outputsRoot,
  collection,
  name,
  buffer,
  prompt,
  provider = "gemini-omni-video-endpoint",
  model = null,
  operation = "generate-video",
  parameters = {},
  metadata = {},
  providerResponse = {},
  inputs = [],
  cost = null,
  startedAt = new Date(),
  completedAt = new Date(),
  exists,
} = {}) {
  if (!outputsRoot) throw new Error("outputsRoot é obrigatório.");
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt é obrigatório: vídeo sem prompt não vira recibo consultável.");
  }

  const bufferError = mp4BufferError(buffer);
  if (bufferError) throw new Error(bufferError);

  const safeCollection = assertSafeCollection(collection);
  const baseName = safeSlug(name, "clipe");
  const videoFile = await resolveFreeTarget(outputsRoot, safeCollection, baseName, { exists });

  await writeBufferAtomic(videoFile, buffer);

  const artifact = await createArtifactFromKnownFile({
    file: videoFile,
    kind: "video",
    role: "generated-video",
    mimeType: "video/mp4",
    bytes: buffer.length,
    digest: sha256Buffer(buffer),
    createdAt: completedAt,
  });

  const receipt = createReceipt({
    operation,
    provider,
    model,
    status: "completed",
    prompt: String(prompt),
    // `auth` nunca entra aqui: o recibo é lido pela galeria e pelo índice.
    parameters: stripAuth(parameters),
    inputs,
    artifacts: [artifact],
    providerResponse,
    cost,
    metadata,
    startedAt,
    completedAt,
  });

  const receiptFile = await writeReceipt(receiptPathForArtifact(videoFile), receipt);

  return {
    schema: OMNI_STORE_SCHEMA,
    videoFile,
    receiptFile,
    collection: safeCollection,
    relPath: path.relative(outputsRoot, videoFile).replace(/\\/g, "/"),
    bytes: buffer.length,
    receiptId: receipt.id,
  };
}

function stripAuth(parameters) {
  if (!parameters || typeof parameters !== "object") return {};
  const { auth, ...rest } = parameters;
  return structuredClone(rest);
}
