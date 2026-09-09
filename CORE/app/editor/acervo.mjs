// Acervo: a visão completa do que já foi gerado.
//
// Não é um segundo servidor — é um conjunto de rotas montadas no servidor do
// editor que já existe. A regra do workspace proíbe um segundo app/servidor, e
// ela está certa: o que faltava era alcance, não outro processo.
//
// A varredura reaproveita `media-archive.mjs` inteiro (classificação, medição
// em cache, prompts, estatística). A única coisa nova aqui é olhar para mais de
// uma raiz, porque vídeo gravado fora de `outputs/` ficava invisível por
// endereço, não por decisão.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { Worker } from 'node:worker_threads';
import { classificarCatalogo } from './acervo-groups.mjs';
import { mapearEntregas } from '../../lib/media-pipeline/archive-delivery.mjs';
import {
  buildMultiRootCatalog,
  loadJsonCache,
  measurePending,
  saveJsonCache,
  thumbFileFor,
  generateThumb,
} from "../../lib/media-pipeline/media-archive.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const CORE_DIR = path.resolve(AQUI, "..", "..");
const WORKSPACE_DIR = path.dirname(CORE_DIR);
const CACHE_DIR = path.join(CORE_DIR, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "cinemateca-probe-cache.json");
const THUMBS_DIR = path.join(CACHE_DIR, "cinemateca-thumbs");

// As raízes onde vídeo já apareceu neste projeto. `entregas` é a principal;
// as outras existem porque houve produção fora dela e nenhuma delas pode
// sumir da vista só por ter nascido no lugar errado.
export const FONTES = [
  { id: "entregas", label: "Entregas", root: path.join(CORE_DIR, "outputs") },
  { id: "soltos", label: "Vídeos soltos da raiz", root: path.join(WORKSPACE_DIR, "videos-soltos") },
  { id: "core-videos", label: "Vídeos do CORE", root: path.join(CORE_DIR, "videos") },
  { id: "producoes", label: "Produções", root: path.join(CORE_DIR, "producoes") },
  { id: "diagnosticos", label: "Diagnósticos", root: path.join(CORE_DIR, "diagnosticos") },
];

const FONTE_POR_ID = new Map(FONTES.map((fonte) => [fonte.id, fonte]));

let catalogo = null;
let construidoEm = 0;
let indexador;
let indexacaoEmCurso;
let payloadGrade;

/** A varredura do disco roda fora do event loop que transmite os vídeos. */
export function atualizarCatalogo({ forcar = false } = {}) {
  if (catalogo && !forcar) return Promise.resolve(catalogo);
  if (indexacaoEmCurso) return indexacaoEmCurso;
  if (!indexador) {
    indexador = new Worker(new URL('./acervo-index-worker.mjs', import.meta.url));
    indexador.on('error', () => { indexador = null; });
  }
  const worker = indexador;
  indexacaoEmCurso = new Promise((resolve, reject) => {
    const limpar = () => { worker.off('message', receber); worker.off('error', falhar); worker.off('exit', sair); indexacaoEmCurso = null; };
    const falhar = erro => { limpar(); indexador = null; reject(erro); };
    const sair = codigo => falhar(new Error(`Indexador encerrado: ${codigo}`));
    const receber = resultado => {
      limpar();
      if (resultado.error) { reject(new Error(resultado.error)); return; }
      catalogo = resultado.catalogo;
      payloadGrade = null;
      construidoEm = Date.now();
      resolve(catalogo);
    };
    worker.once('message', receber);
    worker.once('error', falhar);
    worker.once('exit', sair);
    worker.postMessage({ reindexar: true });
  });
  return indexacaoEmCurso;
}

/** Extrai duração numérica (segundos) de recibos de geração e composição. */
function numeroDuracao(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (!texto.length) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? Number(numero.toFixed(2)) : null;
}

function duracaoDoReceita(receiptPath) {
  let receita;
  try {
    receita = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {
    return null;
  }

  const candidatos = [
    numeroDuracao(receita.duration),
    numeroDuracao(receita?.metadata?.outputProbe?.duration),
    numeroDuracao(receita?.metadata?.outputProbe?.format?.duration),
    numeroDuracao(receita?.deliverySummary?.duration),
    numeroDuracao(receita?.deliverySummary?.totalDuration),
    numeroDuracao(receita?.metadata?.inputProbe?.duration),
    numeroDuracao(receita?.metadata?.inputProbes?.[0]?.duration),
    numeroDuracao(receita?.metadata?.inputProbes?.[0]?.format?.duration),
  ];

  for (const valor of candidatos) {
    if (valor != null && valor > 0) return valor;
  }
  return null;
}

function atualizarStatsDuracao(catalogo) {
  const measured = catalogo.videos.filter((video) => Number.isFinite(video.duration) && video.duration > 0).length;
  catalogo.stats = {
    ...catalogo.stats,
    measured,
    pendingMeasure: catalogo.videos.length - measured,
  };
}

function anotarDuracaoPelaReceita(catalogo, cache) {
  for (const video of catalogo.videos) {
    if (video.duration && Number.isFinite(video.duration) && video.duration > 0) continue;
    const fonte = FONTE_POR_ID.get(video.source);
    if (!fonte) continue;
    const receiptPath = path.join(fonte.root, `${video.relPath}.receipt.json`);
    const recuperada = duracaoDoReceita(receiptPath);
    if (!recuperada) continue;

    video.duration = recuperada;
    if (cache && (cache[video.relPath] || cache[`${video.source}/${video.relPath}`])) {
      const chave = video.source === "entregas" ? video.relPath : `${video.source}/${video.relPath}`;
      cache[chave] = {
        ...cache[chave],
        duration: recuperada,
      };
    }
  }
}

/** Medições e prompts já foram calculados uma vez; ler o cache evita ffprobe. */
function caches() {
  return {
    cache: loadJsonCache(CACHE_FILE),
    prompts: loadJsonCache(path.join(CACHE_DIR, "prompt-index.json")),
  };
}

/**
 * `buildCatalog` procura no cache pela chave relativa à sua própria raiz, mas o
 * cache é compartilhado e usa o prefixo da fonte. Esta visão traduz uma coisa
 * na outra, para que uma fonte fora de `entregas` também mostre duração.
 */
function visaoDoCache(cache, sourceId) {
  if (sourceId === "entregas") return cache;
  const prefixo = `${sourceId}/`;
  const visao = {};
  for (const [chave, valor] of Object.entries(cache)) {
    if (chave.startsWith(prefixo)) visao[chave.slice(prefixo.length)] = valor;
  }
  return visao;
}

export function construirCatalogo({ forcar = false } = {}) {
  if (catalogo && !forcar) return catalogo;
  const inicio = Date.now();
  const { cache, prompts } = caches();
  catalogo = buildMultiRootCatalog(
    // O índice de prompts nasceu relativo a `outputs/` e só faz sentido lá; a
    // medição, não — ela vale para qualquer raiz, desde que a chave bata.
    FONTES.map((fonte) => ({
      ...fonte,
      cache: visaoDoCache(cache, fonte.id),
      prompts: fonte.id === "entregas" ? prompts : null,
    })),
  );
  anotarDuracaoPelaReceita(catalogo, cache);
  mapearEntregas(catalogo, FONTES);
  classificarCatalogo(catalogo);
  catalogo.builtAt = new Date().toISOString();
  catalogo.buildMs = Date.now() - inicio;
  construidoEm = Date.now();
  payloadGrade = null;
  return catalogo;
}

async function preencherDuracaoComMedicao(catalogo) {
  const { cache } = caches();
  const faltantes = [];
  const alvoPorChave = new Map();

  for (const video of catalogo.videos) {
    if (Number.isFinite(video.duration) && video.duration > 0) continue;
    const fonte = FONTE_POR_ID.get(video.source);
    if (!fonte) continue;

    const absoluto = resolverArquivo(video.source, video.relPath);
    if (!absoluto) continue;

    let stat;
    try {
      stat = fs.statSync(absoluto);
    } catch {
      continue;
    }

    const chave = chaveDeCache(video.source, video.relPath);
    const entradaCache = cache[chave];
    const cacheTemValido = Boolean(
      entradaCache &&
      entradaCache.size === stat.size &&
      Math.abs((entradaCache.mtimeMs ?? 0) - stat.mtimeMs) <= 1000 &&
      Number.isFinite(entradaCache.duration) &&
      entradaCache.duration > 0,
    );

    if (cacheTemValido) {
      video.duration = Number(entradaCache.duration.toFixed(2));
      continue;
    }
    if (cache[chave]) delete cache[chave];

    const relPathCache = chave;
    faltantes.push({
      relPath: relPathCache,
      fullPath: absoluto,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
    alvoPorChave.set(relPathCache, video);
  }

  if (!faltantes.length) return { pending: 0, measured: 0 };

  const resultado = await measurePending(faltantes, cache, {
    onMeasured: (relPath, medicao) => {
      const video = alvoPorChave.get(relPath);
      if (video && medicao && Number.isFinite(medicao.duration) && medicao.duration > 0) {
        video.duration = medicao.duration;
      }
    },
  });

  if (resultado.measured > 0) {
    saveJsonCache(CACHE_FILE, cache);
  }

  atualizarStatsDuracao(catalogo);
  return resultado;
}

/** Payload enxuto: 10 mil vídeos cabem numa resposta se cada um for pequeno. */
function montarPayloadGrade(atual) {
  return {
    schema: "gerador-de-videos/acervo-view@1",
    builtAt: atual.builtAt,
    buildMs: atual.buildMs,
    sources: atual.sources,
    collections: atual.collections,
    stats: atual.stats,
    groups: atual.groups,
    tagging: atual.tagging,
    videos: atual.videos.map((video) => [
      video.source,
      video.relPath,
      video.title,
      video.collectionId,
      video.mtimeMs,
      video.duration ?? 0,
      video.isMaster ? 1 : 0,
      video.sizeMb,
      video.hasPrompt ? 1 : 0,
      video.aspect,
      video.width ?? null,
      video.height ?? null,
      video.createdAtMs ?? null,
      video.delivery,
      video.tags,
    ]),
    campos: ["source", "relPath", "title", "collectionId", "mtimeMs", "duration", "isMaster", "sizeMb", "hasPrompt", "aspect", "width", "height", "createdAtMs", "delivery", "tags"],
  };
}

export function catalogoParaGrade() {
  const atual = construirCatalogo();
  return payloadGrade ||= montarPayloadGrade(atual);
}

export function registrarMedicaoNoCatalogo(source, relPath, info) {
  const video = catalogo?.videos.find((v) => v.source === source && v.relPath === relPath);
  if (!video) return;
  payloadGrade = null;
  Object.assign(video, { duration: info.duration, width: info.width, height: info.height });
  const ratio = info.width / info.height;
  video.aspect = ratio > 1.15 ? 'landscape' : ratio < 0.85 ? 'portrait' : 'square';
  atualizarStatsDuracao(catalogo);
}

export async function catalogoParaGradeAutoAtualizado({ forcar = false } = {}) {
  const atual = construirCatalogo({ forcar });
  await preencherDuracaoComMedicao(atual);
  return montarPayloadGrade(atual);
}

/**
 * Resolve um vídeo dentro da raiz declarada. Qualquer caminho que escape da
 * raiz é recusado — a rota é pública para o navegador local e não pode virar
 * leitor de disco.
 */
export function resolverArquivo(sourceId, relPath) {
  const fonte = FONTE_POR_ID.get(String(sourceId));
  if (!fonte) return null;
  const limpo = String(relPath ?? "").replace(/\\/g, "/");
  if (!limpo || limpo.includes("..")) return null;
  const absoluto = path.resolve(fonte.root, limpo);
  const raiz = path.resolve(fonte.root);
  if (absoluto !== raiz && !absoluto.startsWith(raiz + path.sep)) return null;
  if (!fs.existsSync(absoluto) || !fs.statSync(absoluto).isFile()) return null;
  return absoluto;
}

/** O recibo mora ao lado do vídeo, com o mesmo nome mais `.receipt.json`. */
export function dossie(sourceId, relPath) {
  const absoluto = resolverArquivo(sourceId, relPath);
  if (!absoluto) return null;
  const stat = fs.statSync(absoluto);
  const base = {
    source: sourceId,
    relPath,
    absolutePath: absoluto,
    sizeBytes: stat.size,
    mtime: new Date(stat.mtimeMs).toISOString(),
    receipt: null,
    receiptFile: null,
  };
  const caminhoRecibo = `${absoluto}.receipt.json`;
  if (fs.existsSync(caminhoRecibo)) {
    try {
      base.receipt = JSON.parse(fs.readFileSync(caminhoRecibo, "utf8"));
      base.receiptFile = path.relative(CORE_DIR, caminhoRecibo).replace(/\\/g, "/");
    } catch {
      base.receipt = { erro: "Recibo ilegível." };
    }
  }
  return base;
}

// --- miniaturas ------------------------------------------------------------
// 1.431 já estão em cache do trabalho anterior e são reaproveitadas pelo mesmo
// hash. O resto nasce sob demanda enquanto a pessoa rola a página: nada de
// gerar dez mil miniaturas antes de mostrar a primeira tela.

const gerandoAgora = new Map();
const LIMITE_SIMULTANEO = 3;
let emVoo = 0;
const fila = [];

/**
 * A chave que identifica um vídeo nos caches de medição e miniatura.
 *
 * `entregas` mantém a chave histórica (relPath puro) para aproveitar os caches
 * já existentes, construídos quando `outputs/` era a única raiz; as outras
 * fontes ganham prefixo para não colidir. Exportada porque o servidor e o
 * script de manutenção precisam concordar — se divergirem, um regenera o que o
 * outro acabou de gravar, para sempre.
 */
export function chaveDeCache(sourceId, relPath) {
  return sourceId === "entregas" ? relPath : `${sourceId}/${relPath}`;
}

export { THUMBS_DIR, CACHE_DIR };

function chaveMiniatura(sourceId, relPath, size, mtimeMs) {
  return thumbFileFor(THUMBS_DIR, chaveDeCache(sourceId, relPath), size, mtimeMs);
}

function proximo() {
  if (emVoo >= LIMITE_SIMULTANEO) return;
  const tarefa = fila.shift();
  if (!tarefa) return;
  emVoo += 1;
  tarefa().finally(() => {
    emVoo -= 1;
    proximo();
  });
}

export function miniatura(sourceId, relPath) {
  const absoluto = resolverArquivo(sourceId, relPath);
  if (!absoluto) return Promise.resolve(null);
  const stat = fs.statSync(absoluto);
  const destino = chaveMiniatura(sourceId, relPath, stat.size, stat.mtimeMs);
  if (fs.existsSync(destino)) return Promise.resolve(destino);
  if (gerandoAgora.has(destino)) return gerandoAgora.get(destino);

  const promessa = new Promise((resolve) => {
    fila.push(async () => {
      // Um segundo depois do início costuma pegar a cena já revelada; vídeo
      // curto demais volta ao frame zero.
      const ok = await generateThumb(absoluto, destino, 1, { exec: execFile });
      if (!ok) await generateThumb(absoluto, destino, 0, { exec: execFile });
      resolve(fs.existsSync(destino) ? destino : null);
    });
    proximo();
  }).finally(() => gerandoAgora.delete(destino));

  gerandoAgora.set(destino, promessa);
  return promessa;
}

export function idadeDoCatalogo() {
  return construidoEm ? Date.now() - construidoEm : null;
}

/**
 * Busca por prompt.
 *
 * O campo de busca do painel sempre prometeu "nome, coleção ou prompt", mas só
 * olhava nome e coleção — os prompts ficam nos recibos e não cabem no payload da
 * grade (o índice deles tem 26 MB). Mandar 26 MB para o navegador a cada abertura
 * para permitir uma busca ocasional é caro; buscar no servidor, que já tem o
 * índice em memória, é barato.
 *
 * Devolve só os identificadores que casaram. O navegador cruza com o que já tem.
 */
export function buscarPorPrompt(termo, { limite = 4000 } = {}) {
  const alvo = String(termo ?? "").trim().toLowerCase();
  if (alvo.length < 3) return { schema: "gerador-de-videos/acervo-busca-prompt@1", termo: alvo, curtoDemais: true, ids: [] };

  const { prompts } = caches();
  const entradas = prompts?.entries ?? {};
  const ids = [];
  for (const [relPath, entrada] of Object.entries(entradas)) {
    const texto = [entrada?.prompt, entrada?.userPrompt, entrada?.effectivePrompt]
      .filter((valor) => typeof valor === "string")
      .join(" ")
      .toLowerCase();
    if (!texto.includes(alvo)) continue;
    // O índice de prompts nasceu relativo a `outputs/`, que é a fonte `entregas`.
    ids.push(`entregas/${relPath}`);
    if (ids.length >= limite) break;
  }
  return {
    schema: "gerador-de-videos/acervo-busca-prompt@1",
    termo: alvo,
    curtoDemais: false,
    ids,
    truncado: ids.length >= limite,
  };
}

// ---------------------------------------------------------------------------
// Dossiê completo de um vídeo
// ---------------------------------------------------------------------------
//
// O painel mostrava o recibo e parava aí. Mas cada peça carrega mais: a receita
// que a gerou, o roteiro, os quadros-chave, a locução, a trilha, o alinhamento
// palavra a palavra, e os clipes irmãos que a compõem.
//
// Nem toda coleção tem tudo. Medido em 02/09/2026 sobre 720 coleções: **17%
// têm receita mostrável** (arquivo nomeado em `recipes/` ou documento próprio em
// `metadados/`), **87% têm ao menos recibo**, 13% não têm nada. O dossiê mostra
// o que existe e deixa vazio o que não existe — **nunca adivinha**. Casar receita
// por nome aproximado foi testado e não ganha nada (0 casamentos extras), então
// só o casamento exato vale.

const DOCUMENTOS_DE_RECEITA = /^(spec|receita|recipe|filme|jobs|imagem-jobs|visual-jobs)\.json$/i;
const ROTEIRO = /^roteiro\.txt$/i;

let indiceDeReceitas = null;

/** Receitas de `recipes/`, indexadas por `collection` e por `id`. */
function receitasPorNome() {
  if (indiceDeReceitas) return indiceDeReceitas;
  indiceDeReceitas = new Map();
  const dir = path.join(CORE_DIR, "recipes");
  let entradas;
  try {
    entradas = fs.readdirSync(dir);
  } catch {
    return indiceDeReceitas;
  }
  for (const nome of entradas) {
    if (!/\.receita(-[a-z0-9.]+)?\.json$/i.test(nome)) continue;
    let receita;
    try {
      receita = JSON.parse(fs.readFileSync(path.join(dir, nome), "utf8"));
    } catch {
      continue;
    }
    const chaves = [receita.collection, receita.id, receita.identity?.id].filter(Boolean);
    for (const chave of chaves) if (!indiceDeReceitas.has(chave)) indiceDeReceitas.set(chave, { arquivo: `recipes/${nome}`, receita });
  }
  return indiceDeReceitas;
}

function lerJson(arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return null;
  }
}

/** A receita da coleção: primeiro a nomeada, depois a que a própria pasta guarda. */
function receitaDaColecao(raizDaColecao, nomeDaColecao) {
  const nomeada = receitasPorNome().get(nomeDaColecao);
  if (nomeada) {
    return { origem: "arquivo-nomeado", caminho: nomeada.arquivo, schema: nomeada.receita.schema ?? null, conteudo: nomeada.receita };
  }
  for (const sub of ["metadados", ""]) {
    const dir = path.join(raizDaColecao, sub);
    let entradas;
    try {
      entradas = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const nome of entradas.sort()) {
      if (!DOCUMENTOS_DE_RECEITA.test(nome)) continue;
      const conteudo = lerJson(path.join(dir, nome));
      if (!conteudo) continue;
      return {
        origem: "documento-da-colecao",
        caminho: path.relative(CORE_DIR, path.join(dir, nome)).replace(/\\/g, "/"),
        schema: conteudo.schema ?? null,
        conteudo,
      };
    }
  }
  return null;
}

const EXTENSOES = {
  imagem: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  audio: new Set([".wav", ".mp3", ".m4a"]),
  video: new Set([".mp4"]),
};

/**
 * O material da coleção: roteiro, quadros-chave, áudios, alinhamento e marca.
 * É isto que a pessoa chama de "camadas" — o que entrou na peça antes do corte.
 */
function materiaisDaColecao(raiz) {
  const material = { roteiro: null, imagens: [], audios: [], alinhamento: null, marca: [], outros: 0 };
  const visitar = (dir, profundidade = 0) => {
    if (profundidade > 3) return;
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      const absoluto = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        visitar(absoluto, profundidade + 1);
        continue;
      }
      const relativo = path.relative(raiz, absoluto).replace(/\\/g, "/");
      const ext = path.extname(entrada.name).toLowerCase();
      if (ROTEIRO.test(entrada.name) && !material.roteiro) {
        try {
          material.roteiro = { arquivo: relativo, texto: fs.readFileSync(absoluto, "utf8").slice(0, 6000) };
        } catch { /* roteiro ilegível não derruba o dossiê */ }
      } else if (/^alinhamento\.metrics\.json$|^palavras-master\.json$/i.test(entrada.name) && !material.alinhamento) {
        const dados = lerJson(absoluto);
        if (dados) {
          const palavras = Array.isArray(dados) ? dados.length : Array.isArray(dados.words) ? dados.words.length : null;
          material.alinhamento = { arquivo: relativo, palavras, resumo: palavras ? `${palavras} palavras medidas` : "medição de alinhamento" };
        }
      } else if (EXTENSOES.imagem.has(ext)) {
        (relativo.startsWith("marca/") ? material.marca : material.imagens).push(relativo);
      } else if (EXTENSOES.audio.has(ext)) {
        material.audios.push(relativo);
      } else if (!EXTENSOES.video.has(ext) && !entrada.name.endsWith(".json") && !entrada.name.endsWith(".txt")) {
        material.outros += 1;
      }
    }
  };
  visitar(raiz);
  material.imagens.sort();
  material.audios.sort();
  material.marca.sort();
  return material;
}

/**
 * Dossiê completo: o vídeo, o recibo, a receita quando existe, o material da
 * coleção e os clipes irmãos.
 */
export function dossieCompleto(sourceId, relPath) {
  const base = dossie(sourceId, relPath);
  if (!base) return null;

  const fonte = FONTE_POR_ID.get(String(sourceId));
  const nomeDaColecao = String(relPath).split("/")[0];
  const raizDaColecao = path.join(fonte.root, nomeDaColecao);

  const catalogoAtual = construirCatalogo();
  const idDaColecao = `${sourceId}/${nomeDaColecao}`;
  const irmaos = catalogoAtual.videos.filter((video) => video.collectionId === idDaColecao);

  return {
    ...base,
    colecao: {
      nome: nomeDaColecao,
      totalVideos: irmaos.length,
      masters: irmaos.filter((v) => v.isMaster).length,
      duracaoSegundos: Math.round(irmaos.reduce((soma, v) => soma + (v.duration ?? 0), 0)),
    },
    receita: receitaDaColecao(raizDaColecao, nomeDaColecao),
    material: materiaisDaColecao(raizDaColecao),
    irmaos: irmaos
      .filter((video) => video.relPath !== relPath)
      .sort((a, b) => a.relPath.localeCompare(b.relPath))
      .slice(0, 60)
      .map((video) => ({
        relPath: video.relPath,
        title: video.title,
        duration: video.duration,
        isMaster: video.isMaster,
      })),
  };
}
