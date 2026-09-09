#!/usr/bin/env node
// Completa o que o acervo mostra: medição, miniatura e índice de prompts.
//
// O painel funciona sem isto — mas mostra vídeo sem duração, miniatura que
// nasce enquanto a pessoa rola, e busca por prompt que ignora tudo que foi
// gerado depois da última indexação. Este script fecha esses três vãos de uma
// vez, e é retomável: tudo que já está em cache é pulado.
//
//   node scripts/acervo-completar.mjs                 (tudo)
//   node scripts/acervo-completar.mjs --so medicao    (só uma etapa)
//   node scripts/acervo-completar.mjs --so miniaturas
//   node scripts/acervo-completar.mjs --so prompts

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  buildPromptIndex,
  loadIndexCache,
  saveIndexCache,
} from "../lib/media-pipeline/receipt-index.mjs";
import {
  generateThumb,
  loadJsonCache,
  measurePending,
  saveJsonCache,
  scanVideos,
  thumbFileFor,
} from "../lib/media-pipeline/media-archive.mjs";
import { CACHE_DIR, CORE_DIR, FONTES, THUMBS_DIR, chaveDeCache } from "../app/editor/acervo.mjs";

const ARQUIVO_MEDICAO = path.join(CACHE_DIR, "cinemateca-probe-cache.json");
const ARQUIVO_PROMPTS = path.join(CACHE_DIR, "prompt-index.json");

const argumentos = process.argv.slice(2);
const so = argumentos.includes("--so") ? argumentos[argumentos.indexOf("--so") + 1] : null;
const fazer = (etapa) => !so || so === etapa;

/** Todos os vídeos de todas as fontes, já com a chave de cache resolvida. */
function inventario() {
  const itens = [];
  for (const fonte of FONTES) {
    if (!fs.existsSync(fonte.root)) continue;
    for (const arquivo of scanVideos(fonte.root)) {
      itens.push({ ...arquivo, fonte: fonte.id, chave: chaveDeCache(fonte.id, arquivo.relPath) });
    }
  }
  return itens;
}

function barra(feitos, total, rotulo) {
  const porcento = total === 0 ? 100 : Math.round((feitos / total) * 100);
  const cheio = Math.round(porcento / 4);
  process.stdout.write(`\r  ${rotulo} [${"#".repeat(cheio)}${".".repeat(25 - cheio)}] ${feitos}/${total} (${porcento}%)   `);
}

const videos = inventario();
console.log(`Acervo: ${videos.length} vídeos em ${FONTES.filter((f) => fs.existsSync(f.root)).length} raízes.\n`);

// --- 1. medição -------------------------------------------------------------

if (fazer("medicao")) {
  const cache = loadJsonCache(ARQUIVO_MEDICAO);
  // `measurePending` compara por `relPath`; aqui a identidade é a chave de
  // cache, então os arquivos entram com ela no lugar do caminho relativo.
  const paraMedir = videos.map((video) => ({ ...video, relPath: video.chave }));
  const faltando = paraMedir.filter((video) => {
    const anterior = cache[video.chave];
    return !anterior || anterior.size !== video.size || Math.abs((anterior.mtimeMs ?? 0) - video.mtimeMs) > 1000;
  });

  console.log(`Medição: ${faltando.length} pendentes de ${videos.length}.`);
  if (faltando.length) {
    let feitos = 0;
    const relatorio = await measurePending(paraMedir, cache, {
      concurrency: 8,
      onMeasured: () => {
        feitos += 1;
        if (feitos % 25 === 0 || feitos === faltando.length) barra(feitos, faltando.length, "medindo    ");
      },
    });
    saveJsonCache(ARQUIVO_MEDICAO, cache);
    console.log(`\n  medidos ${relatorio.measured}; ${relatorio.pending - relatorio.measured} não responderam ao ffprobe.\n`);
  } else {
    console.log("  nada a fazer.\n");
  }
}

// --- 2. miniaturas ----------------------------------------------------------

if (fazer("miniaturas")) {
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  const faltando = videos.filter(
    (video) => !fs.existsSync(thumbFileFor(THUMBS_DIR, video.chave, video.size, video.mtimeMs)),
  );

  console.log(`Miniaturas: ${faltando.length} faltando de ${videos.length}.`);
  if (faltando.length) {
    let feitos = 0;
    let falhas = 0;
    let cursor = 0;
    // Quatro ffmpeg ao mesmo tempo saturam a máquina sem travá-la; cada
    // miniatura leva algumas centenas de milissegundos.
    const trabalhador = async () => {
      while (cursor < faltando.length) {
        const video = faltando[cursor++];
        const destino = thumbFileFor(THUMBS_DIR, video.chave, video.size, video.mtimeMs);
        // Um segundo pega a cena já revelada; vídeo curto demais cai no frame 0.
        let ok = await generateThumb(video.fullPath, destino, 1, { exec: execFile });
        if (!ok) ok = await generateThumb(video.fullPath, destino, 0, { exec: execFile });
        if (!ok) falhas += 1;
        feitos += 1;
        if (feitos % 10 === 0 || feitos === faltando.length) barra(feitos, faltando.length, "miniaturas ");
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, faltando.length) }, trabalhador));
    console.log(`\n  geradas ${feitos - falhas}; ${falhas} sem quadro utilizável.\n`);
  } else {
    console.log("  nada a fazer.\n");
  }
}

// --- 3. índice de prompts ---------------------------------------------------

if (fazer("prompts")) {
  // O índice de prompts vive de recibos, e recibo só existe ao lado das
  // entregas. As outras raízes não têm o que indexar.
  const raiz = FONTES.find((fonte) => fonte.id === "entregas").root;
  const anterior = loadIndexCache(ARQUIVO_PROMPTS);
  const antes = Object.keys(anterior?.entries ?? {}).length;

  console.log(`Prompts: reindexando recibos em ${path.relative(CORE_DIR, raiz)} (tinha ${antes} entradas).`);
  const indice = buildPromptIndex(raiz, { cache: anterior });
  saveIndexCache(ARQUIVO_PROMPTS, indice);
  const depois = Object.keys(indice.entries ?? {}).length;
  console.log(`  ${depois} entradas (${depois - antes >= 0 ? "+" : ""}${depois - antes}).\n`);
}

console.log("Pronto. Recarregue o painel para ver o resultado.");
