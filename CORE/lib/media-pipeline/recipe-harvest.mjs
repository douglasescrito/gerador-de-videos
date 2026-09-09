import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { replaceJsonAtomic } from "./pipeline-operation.mjs";

export const HARVESTED_RECIPE_SCHEMA = "gerador-de-videos/receita-colhida@1";
export const HARVESTED_RECIPE_SUFFIX = ".colheita.json";

// A colheita NÃO é a receita autoral. `<colecao>.receita.json`, quando
// existe, é a direção que alguém escreveu; `<colecao>.colheita.json` é o
// que de fato rodou, lido dos recibos. As duas convivem e respondem a
// perguntas diferentes — uma diz o que se quis, a outra o que se fez.
//
// Uma peça pronta guarda tudo que a fez: prompt efetivo, preset, tarefa,
// aspecto, modelo, e o tempo que cada parte levou. O que faltava era o
// caminho de volta — juntar isso num arquivo que dá para ler, variar e
// repetir. Sem ele, cada peça boa morre como arquivo e a próxima começa do
// zero.

function duracaoMs(receipt) {
  const inicio = Date.parse(String(receipt?.startedAt ?? ""));
  const fim = Date.parse(String(receipt?.completedAt ?? ""));
  return Number.isFinite(inicio) && Number.isFinite(fim) && fim >= inicio ? fim - inicio : null;
}

function primeiroArtefatoDeMidia(receipt) {
  return (receipt?.artifacts ?? []).find((artifact) => /^(?:video|image|audio)\//.test(String(artifact?.mimeType ?? ""))) ?? null;
}

function parteDoRecibo(receipt, file) {
  const composicao = receipt?.metadata?.promptComposition ?? {};
  const artefato = primeiroArtefatoDeMidia(receipt);
  const timings = receipt?.timings ?? receipt?.metadata?.timings ?? null;
  return {
    reciboId: receipt?.id ?? null,
    reciboArquivo: file,
    operacao: receipt?.operation ?? null,
    provedor: receipt?.provider ?? null,
    modelo: receipt?.model ?? null,
    status: receipt?.status ?? null,
    // O prompt efetivo é o que o provedor viu; o do usuário é o que foi
    // pedido. Guardar os dois é o que permite entender por que funcionou.
    prompt: receipt?.prompt ?? composicao.effectivePrompt ?? null,
    promptDoUsuario: composicao.userPrompt ?? null,
    preset: composicao.directionPreset ?? null,
    tarefa: receipt?.parameters?.task ?? null,
    aspecto: receipt?.parameters?.aspectRatio ?? receipt?.parameters?.aspect ?? null,
    cena: receipt?.metadata?.batchId ?? (artefato?.path ? path.basename(String(artefato.path)) : null),
    arquivo: artefato?.path ? path.basename(String(artefato.path)) : null,
    sha256: artefato?.hash?.value ?? null,
    bytes: artefato?.bytes ?? null,
    iniciadoEm: receipt?.startedAt ?? null,
    concluidoEm: receipt?.completedAt ?? null,
    duracaoMs: duracaoMs(receipt),
    // Detalhe fino só existe nos recibos que o adapter de vídeo escreve.
    // Onde existir, é aproveitado; onde não, a duração de parede continua
    // respondendo "quanto tempo isto levou".
    esperaDoProvedorMs: timings?.providerProcessingMs ?? null,
  };
}

async function listarRecibos(root) {
  const encontrados = [];
  let entradas;
  try { entradas = await readdir(root, { recursive: true, withFileTypes: true }); }
  catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  for (const entrada of entradas) {
    if (!entrada.isFile() || !entrada.name.endsWith(".receipt.json")) continue;
    encontrados.push(path.join(entrada.parentPath ?? entrada.path ?? root, entrada.name));
  }
  return encontrados.sort();
}

function resumir(partes) {
  const somaDuracao = partes.reduce((total, parte) => total + (parte.duracaoMs ?? 0), 0);
  const comDuracao = partes.filter((parte) => parte.duracaoMs != null).length;
  const distintos = (campo) => [...new Set(partes.map((parte) => parte[campo]).filter(Boolean))].sort();
  return {
    partes: partes.length,
    provedores: distintos("provedor"),
    modelos: distintos("modelo"),
    presets: distintos("preset"),
    tarefas: distintos("tarefa"),
    aspectos: distintos("aspecto"),
    // Tempo de parede somado: responde "esta peça custou mais que aquela?",
    // que hoje não tem resposta em 94% do acervo.
    duracaoTotalMs: comDuracao ? somaDuracao : null,
    duracaoMediaMs: comDuracao ? Math.round(somaDuracao / comDuracao) : null,
    partesComDuracao: comDuracao,
    partesComEsperaDoProvedor: partes.filter((parte) => parte.esperaDoProvedorMs != null).length,
  };
}

/**
 * Lê os recibos de uma coleção e devolve a receita colhida.
 * Não escreve nada — quem escreve é writeHarvestedRecipe.
 */
export async function buildHarvestedRecipe({ root, name = null, masterFile = null, now = new Date() } = {}) {
  const absoluto = path.resolve(String(root));
  const colecao = name ?? path.basename(absoluto);
  const arquivos = await listarRecibos(absoluto);
  const partes = [];
  const ilegiveis = [];
  for (const arquivo of arquivos) {
    try {
      const receipt = JSON.parse(await readFile(arquivo, "utf8"));
      if (receipt?.schema !== "mkt-videos/receipt@1") continue;
      partes.push(parteDoRecibo(receipt, path.relative(absoluto, arquivo).split(path.sep).join("/")));
    } catch (error) {
      ilegiveis.push({ arquivo: path.relative(absoluto, arquivo).split(path.sep).join("/"), erro: String(error?.message ?? error).slice(0, 200) });
    }
  }
  partes.sort((esquerda, direita) => String(esquerda.arquivo ?? "").localeCompare(String(direita.arquivo ?? ""))
    || String(esquerda.iniciadoEm ?? "").localeCompare(String(direita.iniciadoEm ?? "")));

  let master = null;
  if (masterFile) {
    try {
      const info = await stat(masterFile);
      master = { arquivo: path.basename(masterFile), bytes: info.size };
    } catch { master = null; }
  }

  return {
    schema: HARVESTED_RECIPE_SCHEMA,
    colecao,
    colhidaEm: (now instanceof Date ? now : new Date(now)).toISOString(),
    raiz: absoluto,
    master,
    resumo: resumir(partes),
    partes,
    ...(ilegiveis.length ? { recibosIlegiveis: ilegiveis } : {}),
  };
}

/**
 * Colhe e grava. Idempotente e barato: pode rodar ao fim de toda produção.
 * Devolve `null` quando a coleção ainda não tem recibo nenhum — colher o
 * vazio só produziria arquivo sem conteúdo.
 */
export async function writeHarvestedRecipe({ root, name = null, masterFile = null, outFile = null, now = new Date() } = {}) {
  const receita = await buildHarvestedRecipe({ root, name, masterFile, now });
  if (!receita.partes.length) return null;
  const destino = outFile ?? path.join(path.resolve(String(root)), "metadados", `${receita.colecao}${HARVESTED_RECIPE_SUFFIX}`);
  // Substitui: a colheita roda a cada fechamento de coleção e precisa ser
  // idempotente. Recusar sobrescrita transformaria a segunda produção da
  // mesma coleção num erro.
  await replaceJsonAtomic(destino, receita, { label: "Receita colhida" });
  return { file: destino, recipe: receita };
}

/**
 * Colhe todas as coleções sob uma raiz de outputs. É o backfill do acervo:
 * as peças já produzidas passam a ter de onde ser variadas e repetidas.
 */
export async function harvestOutputsRoot({ root, now = new Date(), onCollection = null } = {}) {
  const absoluto = path.resolve(String(root));
  let entradas;
  try { entradas = await readdir(absoluto, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === "ENOENT") return { schema: HARVESTED_RECIPE_SCHEMA, root: absoluto, colhidas: 0, vazias: 0, falhas: [] };
    throw error;
  }
  let colhidas = 0;
  let vazias = 0;
  const falhas = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    const colecao = path.join(absoluto, entrada.name);
    try {
      const resultado = await writeHarvestedRecipe({ root: colecao, name: entrada.name, now });
      if (resultado) { colhidas += 1; onCollection?.({ colecao: entrada.name, partes: resultado.recipe.resumo.partes, file: resultado.file }); }
      else vazias += 1;
    } catch (error) {
      falhas.push({ colecao: entrada.name, erro: String(error?.message ?? error).slice(0, 200) });
    }
  }
  return { schema: HARVESTED_RECIPE_SCHEMA, root: absoluto, colhidas, vazias, falhas };
}
