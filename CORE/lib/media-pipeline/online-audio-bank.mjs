import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { runFfmpeg, probeMedia } from "./media-tools.mjs";
import { createStageReceipt, writeStageReceipt } from "./pipeline-operation.mjs";

export const ONLINE_AUDIO_SOURCES = Object.freeze([
  "archive-org",
  "freesound",
  "pixabay",
  "direct-url",
]);

/**
 * Busca trilhas ou efeitos sonoros em repositórios online públicos (Internet Archive, etc.)
 */
export async function searchOnlineAudio({
  query,
  type = "music", // "music" | "sfx"
  limit = 10,
  source = "archive-org",
} = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("Parâmetro --query é obrigatório para busca no banco de áudio.");

  if (source === "archive-org") {
    // Internet Archive Search API (Áudios CC / royalty free / public domain)
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      `${q} AND mediatype:(audio)`
    )}&fl[]=identifier,title,description,duration,format,creator,downloads&sort[]=downloads+desc&rows=${Number(
      limit
    )}&page=1&output=json`;

    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "GeradorDeVideos-Studio/1.0" },
    });

    if (!response.ok) {
      throw new Error(`Falha ao buscar no Internet Archive: HTTP ${response.status}`);
    }

    const data = await response.json();
    const docs = data.response?.docs ?? [];

    return docs.map((doc) => ({
      id: doc.identifier,
      title: doc.title || doc.identifier,
      description: doc.description || "",
      creator: doc.creator || "Desconhecido",
      duration: doc.duration || null,
      source: "archive-org",
      type,
      downloadUrl: `https://archive.org/download/${doc.identifier}/${doc.identifier}_vbr.mp3`,
      directPage: `https://archive.org/details/${doc.identifier}`,
    }));
  }

  throw new Error(`Fonte de áudio online não suportada: ${source}`);
}

/**
 * Baixa um áudio online a partir de ID/URL ou lista de busca e converte para padrão WAV estúdio
 */
export async function downloadOnlineAudio({
  url,
  id,
  query,
  type = "music",
  source = "archive-org",
  outputFile,
  receiptFile = null,
  duration = null,
} = {}) {
  const out = path.resolve(String(outputFile ?? `outputs/audio-bank-${Date.now()}.wav`));
  await mkdir(path.dirname(out), { recursive: true });

  const candidateUrls = [];

  if (url) {
    candidateUrls.push({ url, id: id ?? "custom-url" });
  } else if (id && source === "archive-org") {
    candidateUrls.push({ url: `https://archive.org/download/${id}/${id}_vbr.mp3`, id });
  } else if (query) {
    const results = await searchOnlineAudio({ query, type, source, limit: 5 });
    if (!results.length) {
      throw new Error(`Nenhum áudio encontrado para a busca: "${query}"`);
    }
    for (const res of results) {
      candidateUrls.push({ url: res.downloadUrl, id: res.id });
    }
  }

  if (!candidateUrls.length) {
    throw new Error("É necessário fornecer --url, --id ou --query para download.");
  }

  let lastError = null;

  for (const candidate of candidateUrls) {
    const tempDownload = `${out}.${Date.now()}.tmp`;
    try {
      let res = await fetch(candidate.url, {
        headers: { "User-Agent": "GeradorDeVideos-Studio/1.0" },
      });

      // Se falhar a tentativa direta de _vbr.mp3 no Archive.org, busca o arquivo correto via metadados
      if (!res.ok && source === "archive-org" && candidate.id) {
        const metaRes = await fetch(`https://archive.org/metadata/${candidate.id}`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          const audioFile = meta.files?.find(
            (f) =>
              (f.name?.endsWith(".mp3") || f.name?.endsWith(".wav") || f.name?.endsWith(".ogg")) &&
              !f.name?.includes("_thumb")
          );
          if (audioFile) {
            const altUrl = `https://archive.org/download/${candidate.id}/${audioFile.name}`;
            res = await fetch(altUrl);
            if (res.ok) candidate.url = altUrl;
          }
        }
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} em ${candidate.url}`);
      }

      const fileStream = createWriteStream(tempDownload);
      await pipeline(Readable.fromWeb(res.body), fileStream);

      const result = await convertAndFinalize(
        tempDownload,
        out,
        receiptFile,
        candidate.url,
        candidate.id,
        source,
        type,
        duration
      );

      try {
        await rm(tempDownload, { force: true });
      } catch {}

      return result;
    } catch (err) {
      lastError = err;
      try {
        await rm(tempDownload, { force: true });
      } catch {}
    }
  }

  throw new Error(`Falha ao baixar áudio online após tentar opções: ${lastError?.message}`);
}

async function convertAndFinalize(tempFile, outFile, receiptFile, targetUrl, id, source, type, duration) {
  // Converte e normaliza para WAV 48kHz Stereo padrão de estúdio
  const ffmpegArgs = ["-y", "-i", tempFile];
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
    ffmpegArgs.push("-t", String(Number(duration)));
  }
  ffmpegArgs.push("-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outFile);

  await runFfmpeg(ffmpegArgs);

  const probe = await probeMedia(outFile);
  const artifact = await createArtifactFromFile({
    file: outFile,
    kind: "audio",
    role: type === "sfx" ? "sfx" : "music",
    source: { provider: `online-audio-bank:${source}`, url: targetUrl },
  });

  const finalReceiptFile = receiptFile ?? `${outFile}.receipt.json`;
  const receipt = createStageReceipt({
    operation: "online-audio-fetch",
    provider: `audio-bank:${source}`,
    model: null,
    mode: "studio",
    stage: "audio-bank",
    prompt: targetUrl,
    parameters: { id, source, type, duration: probe.duration, sampleRate: 48000, channels: 2 },
    artifacts: [artifact],
    startedAt: new Date(),
    completedAt: new Date(),
  });

  await writeStageReceipt(finalReceiptFile, receipt);

  return {
    file: outFile,
    receiptFile: path.resolve(finalReceiptFile),
    receipt,
    duration: probe.duration,
    sourceUrl: targetUrl,
  };
}
