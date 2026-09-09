// Navegação do acervo de vídeo local: varredura, medição real e miniaturas.
//
// Extraído do servidor autônomo da Cinemateca para que a mesma lógica sirva a
// galeria dentro de `app/` sem duplicar nada — inclusive a parte que mais
// importa: a proporção vem de ffprobe, não de palpite pelo nome do arquivo.
// (A versão anterior adivinhava por palavra-chave e rotulava ~94% do acervo
// como 9:16 quando a maioria é 16:9.)
//
// Todo caminho vindo de cliente passa por `resolveInsideRoot`, que confina em
// `root` inclusive contra symlink.

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MEDIA_ARCHIVE_SCHEMA = "mkt-videos/media-archive@1";

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

// ---------------------------------------------------------------------------
// Confinamento
// ---------------------------------------------------------------------------

/**
 * Resolve um caminho relativo de cliente para absoluto dentro de `root`.
 * Devolve null se escapar, tiver byte nulo, for absoluto, não existir, não for
 * arquivo, ou se o alvo real (após symlink) cair fora.
 */
export function resolveInsideRoot(root, relPath, { extensions = [".mp4"] } = {}) {
  if (typeof relPath !== "string" || relPath === "") return null;
  if (relPath.includes("\0")) return null;
  if (path.isAbsolute(relPath)) return null;

  const absoluteRoot = path.resolve(root);
  const prefix = absoluteRoot + path.sep;
  const target = path.resolve(absoluteRoot, relPath);
  if (target !== absoluteRoot && !target.startsWith(prefix)) return null;
  if (!fs.existsSync(target)) return null;

  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return null;
  }
  if (real !== absoluteRoot && !real.startsWith(prefix)) return null;
  if (!fs.statSync(real).isFile()) return null;
  if (extensions.length > 0 && !extensions.includes(path.extname(real).toLowerCase())) return null;

  return real;
}

// ---------------------------------------------------------------------------
// Varredura e rótulos
// ---------------------------------------------------------------------------

export function scanVideos(root) {
  const results = [];
  if (!fs.existsSync(root)) return results;

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
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      results.push({ relPath, fullPath: full, filename: entry.name, size: stat.size, mtimeMs: stat.mtimeMs, createdAtMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null });
    }
  };

  walk(root, "");
  return results;
}

/**
 * Rótulo legível a partir de nome de pasta/arquivo, sem depender de
 * nomenclatura de projeto: tira prefixo de timestamp e numeração, troca
 * separadores por espaço e usa caixa de frase.
 */
export function humanize(rawName) {
  const cleaned = String(rawName ?? "")
    .replace(/\.mp4$/i, "")
    .replace(/^\d{8,}[-_]?/, "")
    .replace(/^\d{1,3}[-_]/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return String(rawName ?? "");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Classifica o arquivo como filme montado ("master") e como versão acelerada 3X.
 * A 3X conta como master: só existe como render do filme inteiro já montado, e
 * o nome gerado pelo pipeline não repete a palavra "master".
 */
export function classifyVideo(file) {
  const name = String(file.filename ?? "").toLowerCase();
  const rel = String(file.relPath ?? "").toLowerCase();
  const is3x = name.includes("acelerad") || /(^|[^a-z0-9])3x([^a-z0-9]|$)/.test(name);
  // Fragmento de montagem mora **dentro** de `videos-unidos/`, em `_pecas/`: são
  // os cortes de um ou dois segundos que o ffmpeg produz para remontar o filme.
  // Pela regra de caminho eles herdavam "master" do pai — 314 deles — e como são
  // recentes e numerosos, enchiam a primeira tela do acervo com pedaços no lugar
  // da peça pronta. Pedaço nunca é master.
  const isFragmentoDeMontagem = rel.includes("/_pecas/");
  const isMaster =
    !isFragmentoDeMontagem &&
    (is3x ||
      name.includes("master") ||
      name.includes("unificado") ||
      name.includes("unidos") ||
      name.includes("partes-juntas") ||
      name.includes("-completo") ||
      rel.includes("/videos-unidos/"));
  return { isMaster, is3x, isFragmentoDeMontagem };
}

export function aspectClass(width, height) {
  if (!width || !height) return "unknown";
  const ratio = width / height;
  if (ratio > 1.05) return "landscape";
  if (ratio < 0.95) return "portrait";
  return "square";
}

// ---------------------------------------------------------------------------
// Medição (ffprobe) com cache em disco
// ---------------------------------------------------------------------------

export function probeVideo(absPath, { exec = execFile } = {}) {
  return new Promise((resolve) => {
    exec(
      FFPROBE,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", absPath],
      { maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const parsed = JSON.parse(stdout);
          const stream = parsed.streams?.[0] ?? {};
          if (!stream.width || !stream.height) return resolve(null);
          const duration = Number(parsed.format?.duration);
          resolve({
            width: Number(stream.width),
            height: Number(stream.height),
            duration: Number.isFinite(duration) ? Number(duration.toFixed(2)) : null,
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/** Entrada de cache continua válida enquanto tamanho e mtime não mudarem. */
export function cacheHit(cache, file) {
  const hit = cache?.[file.relPath];
  if (!hit) return null;
  if (hit.size !== file.size) return null;
  if (Math.abs((hit.mtimeMs ?? 0) - file.mtimeMs) > 1000) return null;
  return hit;
}

/**
 * Mede o que ainda não está medido, com paralelismo limitado.
 * `onMeasured` recebe cada medição para que a UI possa preencher ao vivo.
 */
export async function measurePending(files, cache, { concurrency = 6, onMeasured = null, probe = probeVideo } = {}) {
  const pending = files.filter((file) => !cacheHit(cache, file));
  let cursor = 0;
  let measured = 0;

  const worker = async () => {
    while (cursor < pending.length) {
      const file = pending[cursor++];
      const result = await probe(file.fullPath);
      if (!result) continue;
      cache[file.relPath] = { size: file.size, mtimeMs: file.mtimeMs, ...result };
      measured += 1;
      if (onMeasured) onMeasured(file.relPath, cache[file.relPath]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return { pending: pending.length, measured };
}

// ---------------------------------------------------------------------------
// Miniaturas
// ---------------------------------------------------------------------------

export function thumbFileFor(thumbsDir, relPath, size, mtimeMs) {
  const hash = crypto.createHash("sha1").update(`${relPath}:${size}:${mtimeMs}`).digest("hex");
  return path.join(thumbsDir, `${hash}.jpg`);
}

export function generateThumb(absPath, outFile, seekSeconds, { exec = execFile } = {}) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    exec(
      FFMPEG,
      ["-y", "-ss", String(seekSeconds), "-i", absPath, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", outFile],
      { maxBuffer: 1024 * 1024, windowsHide: true },
      (error) => resolve(!error && fs.existsSync(outFile)),
    );
  });
}

// ---------------------------------------------------------------------------
// hover-proxy@1 (Fase 0.5 do plano) — mesmo hash de identidade e mesma forma
// que a miniatura acima; troca extrair 1 frame por transcodificar leve com
// faststart, para o hover não abrir mais o master original.
// ---------------------------------------------------------------------------

export function proxyFileFor(proxiesDir, relPath, size, mtimeMs) {
  const hash = crypto.createHash("sha1").update(`hover-proxy@1:${relPath}:${size}:${mtimeMs}`).digest("hex");
  return path.join(proxiesDir, `${hash}.mp4`);
}

export function generateProxy(absPath, outFile, { exec = execFile } = {}) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    exec(
      FFMPEG,
      [
        "-y", "-i", absPath,
        "-t", "12",
        "-vf", "scale=480:-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        outFile,
      ],
      { maxBuffer: 1024 * 1024, windowsHide: true },
      (error) => resolve(!error && fs.existsSync(outFile)),
    );
  });
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/**
 * Monta o catálogo publicado à UI. `prompts` é o índice da Fase 1: quando um
 * vídeo tem recibo, o catálogo já anuncia que há prompt consultável, para a
 * tela não precisar perguntar item a item.
 */
export function buildCatalog(root, { cache = {}, prompts = null } = {}) {
  const files = scanVideos(root);
  const collections = new Map();
  const videos = [];

  for (const file of files) {
    const collectionId = file.relPath.split("/")[0];
    const { isMaster, is3x, isFragmentoDeMontagem } = classifyVideo(file);
    const measured = cacheHit(cache, file);
    const promptEntry = prompts?.entries?.[file.relPath] ?? null;

    videos.push({
      id: file.relPath,
      relPath: file.relPath,
      filename: file.filename,
      title: humanize(file.filename),
      collectionId,
      collectionName: humanize(collectionId),
      sizeMb: Number((file.size / (1024 * 1024)).toFixed(1)),
      sizeBytes: file.size,
      mtimeMs: file.mtimeMs,
      createdAtMs: file.createdAtMs,
      isMaster,
      is3x,
      isFragmentoDeMontagem,
      width: measured?.width ?? null,
      height: measured?.height ?? null,
      duration: measured?.duration ?? null,
      aspect: aspectClass(measured?.width, measured?.height),
      hasPrompt: Boolean(promptEntry),
      directionPreset: promptEntry?.promptComposition?.directionPreset ?? null,
    });

    if (!collections.has(collectionId)) {
      collections.set(collectionId, { id: collectionId, name: humanize(collectionId), total: 0, masters: 0, withPrompt: 0, newestMs: 0 });
    }
    const collection = collections.get(collectionId);
    collection.total += 1;
    if (isMaster) collection.masters += 1;
    if (promptEntry) collection.withPrompt += 1;
    if (file.mtimeMs > collection.newestMs) collection.newestMs = file.mtimeMs;
  }

  const measuredCount = videos.filter((video) => video.width !== null).length;
  const withPrompt = videos.filter((video) => video.hasPrompt).length;

  return {
    schema: MEDIA_ARCHIVE_SCHEMA,
    root,
    videos,
    collections: [...collections.values()].sort((a, b) => b.newestMs - a.newestMs),
    stats: {
      total: videos.length,
      masters: videos.filter((video) => video.isMaster).length,
      collections: collections.size,
      measured: measuredCount,
      pendingMeasure: videos.length - measuredCount,
      withPrompt,
      promptCoverage: videos.length === 0 ? 0 : Number(((withPrompt / videos.length) * 100).toFixed(1)),
    },
  };
}

export function loadJsonCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveJsonCache(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value), "utf8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Catálogo de várias raízes
// ---------------------------------------------------------------------------

/**
 * O acervo nasceu apontando só para `outputs/`, e por isso vídeo gravado fora
 * dali ficava invisível — não por regra, por endereço. Esta função varre várias
 * raízes e devolve um catálogo único, marcando de qual fonte cada vídeo veio.
 *
 * Reaproveita `buildCatalog` inteiro: classificação, medição em cache, prompts
 * e estatística continuam com uma implementação só. O que muda é o alcance.
 *
 * `sources`: [{ id, label, root, cache?, prompts? }]. Raiz inexistente é
 * ignorada em silêncio — a lista de fontes descreve onde procurar, não promete
 * que todas existem nesta máquina.
 */
export function buildMultiRootCatalog(sources = []) {
  const videos = [];
  const collections = [];
  const fontes = [];

  for (const source of sources) {
    const id = String(source?.id ?? "").trim();
    const root = String(source?.root ?? "");
    if (!id || !root || !fs.existsSync(root)) continue;

    const parcial = buildCatalog(root, { cache: source.cache ?? {}, prompts: source.prompts ?? null });

    for (const video of parcial.videos) {
      videos.push({
        ...video,
        id: `${id}/${video.relPath}`,
        source: id,
        sourceLabel: source.label ?? id,
        collectionId: `${id}/${video.collectionId}`,
      });
    }
    for (const collection of parcial.collections) {
      collections.push({
        ...collection,
        id: `${id}/${collection.id}`,
        source: id,
        sourceLabel: source.label ?? id,
      });
    }
    fontes.push({ id, label: source.label ?? id, root, total: parcial.videos.length });
  }

  collections.sort((a, b) => b.newestMs - a.newestMs);
  const medidos = videos.filter((video) => video.width !== null).length;
  const comPrompt = videos.filter((video) => video.hasPrompt).length;

  return {
    schema: MEDIA_ARCHIVE_SCHEMA,
    sources: fontes,
    videos,
    collections,
    stats: {
      total: videos.length,
      masters: videos.filter((video) => video.isMaster).length,
      collections: collections.length,
      measured: medidos,
      pendingMeasure: videos.length - medidos,
      withPrompt: comPrompt,
      promptCoverage: videos.length === 0 ? 0 : Number(((comPrompt / videos.length) * 100).toFixed(1)),
    },
  };
}
