// Evidência real de uso das técnicas de prompt, medida nos recibos.
//
// O catálogo trazia a contagem anotada à mão, com a data em que alguém olhou:
// 93 recibos em 02/08, 38 em 02/08, 1 em 13/08. Número escrito à mão envelhece
// em silêncio — um mês depois ninguém sabe se ainda vale.
//
// Aqui a contagem é medida, e medida de dois jeitos, porque existem dois jeitos
// de a técnica chegar no prompt:
//
//   estruturado — a invocação selecionou a técnica e o recibo registrou em
//                 `metadata.promptComposition.techniques`. É o caminho previsto.
//   textual     — o bloco da técnica está no prompt sem estar registrado. Quase
//                 sempre porque alguém copiou e colou o texto numa peça `raw`.
//
// A distância entre os dois é o dado que interessa: conhecimento que circula por
// cópia não tem versão, não tem registro e não melhora num lugar só.

import fs from "node:fs";
import path from "node:path";
import { listProductionTechniques } from "./prompt-techniques.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const TECHNIQUE_EVIDENCE_SCHEMA = "gerador-de-videos/technique-evidence-report@1";

const TAMANHO_MINIMO_DA_AGULHA = 40;

/**
 * O maior trecho literal do bloco, entre os buracos de template. É o que
 * sobrevive à substituição e serve para reconhecer a técnica num prompt pronto.
 * Técnica cujo bloco é quase todo variável não tem agulha, e a busca textual
 * não se aplica a ela — o relatório diz isso em vez de contar zero calado.
 */
export function agulhaDoBloco(bloco) {
  const pedacos = String(bloco ?? "")
    .split(/\{\{[^}]*\}\}/g)
    .map((pedaco) => pedaco.replace(/\s+/g, " ").trim())
    .filter((pedaco) => pedaco.length >= TAMANHO_MINIMO_DA_AGULHA);
  return pedacos.sort((a, b) => b.length - a.length)[0] ?? null;
}

function promptDoRecibo(recibo) {
  return [recibo?.effectivePrompt, recibo?.prompt, recibo?.metadata?.effectivePrompt, recibo?.request?.prompt]
    .filter((valor) => typeof valor === "string" && valor)
    .join(" ")
    .replace(/\s+/g, " ");
}

function* recibosSob(raiz, profundidadeMaxima = 8) {
  const pilha = [[raiz, 0]];
  while (pilha.length) {
    const [dir, prof] = pilha.pop();
    if (prof > profundidadeMaxima) continue;
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) pilha.push([alvo, prof + 1]);
      else if (entrada.name.endsWith(".receipt.json") || entrada.name.endsWith(".receita.json")) yield alvo;
    }
  }
}

/**
 * Varre os recibos sob `raiz` e devolve, por técnica, quantas vezes ela foi
 * usada de cada jeito e quando foi a última. Somente leitura e provider-free.
 */
export function medirEvidenciaDeTecnicas({ raiz = "outputs" } = {}) {
  const tecnicas = listProductionTechniques().map((tecnica) => ({
    id: tecnica.id,
    kind: tecnica.kind,
    status: tecnica.status,
    declarado: tecnica.evidence?.receiptCount ?? null,
    declaradoEm: tecnica.evidence?.observedAt ?? null,
    agulha: agulhaDoBloco(tecnica.block),
    estruturado: 0,
    textual: 0,
    ultimoUsoMs: 0,
  }));
  const porId = new Map(tecnicas.map((tecnica) => [tecnica.id, tecnica]));

  let recibosLidos = 0;
  let recibosComPrompt = 0;
  let recibosComComposicao = 0;
  const desconhecidas = new Map();
  let registrosDeUsoInvalidos = 0;

  for (const arquivo of recibosSob(raiz)) {
    let recibo;
    try {
      recibo = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    } catch {
      continue;
    }
    recibosLidos += 1;
    let quando = 0;
    try {
      quando = fs.statSync(arquivo).mtimeMs;
    } catch { /* sem data, ainda conta o uso */ }

    const rawSelections = recibo?.metadata?.promptComposition?.techniques;
    const selecionadas = Array.isArray(rawSelections) ? [...rawSelections] : [];
    if (recibo.techniqueUsage) {
      const { hash, ...body } = recibo.techniqueUsage;
      if (hash === operationFingerprint(body) && body.schema === "mkt-videos/production-technique-usage@1" && Array.isArray(body.uses)) selecionadas.push(...body.uses);
      else registrosDeUsoInvalidos++;
    }
    if (recibo?.metadata?.promptComposition) recibosComComposicao += 1;
    const idsSelecionados = new Set((Array.isArray(selecionadas) ? selecionadas : []).map((entrada) => entrada?.id ?? String(entrada)));
    for (const id of idsSelecionados) {
      const tecnica = porId.get(id);
      if (!tecnica) {
        desconhecidas.set(id, (desconhecidas.get(id) ?? 0) + 1);
        continue;
      }
      tecnica.estruturado += 1;
      if (quando > tecnica.ultimoUsoMs) tecnica.ultimoUsoMs = quando;
    }

    const prompt = promptDoRecibo(recibo);
    if (!prompt) continue;
    recibosComPrompt += 1;
    for (const tecnica of tecnicas) {
      if (idsSelecionados.has(tecnica.id) || !tecnica.agulha || !prompt.includes(tecnica.agulha)) continue;
      tecnica.textual += 1;
      if (quando > tecnica.ultimoUsoMs) tecnica.ultimoUsoMs = quando;
    }
  }

  const linhas = tecnicas.map((tecnica) => ({
    id: tecnica.id,
    kind: tecnica.kind,
    status: tecnica.status,
    declarado: tecnica.declarado,
    declaradoEm: tecnica.declaradoEm,
    estruturado: tecnica.estruturado,
    textual: tecnica.textual,
    total: tecnica.estruturado + tecnica.textual,
    reconhecivelNoTexto: Boolean(tecnica.agulha),
    ultimoUso: tecnica.ultimoUsoMs ? new Date(tecnica.ultimoUsoMs).toISOString() : null,
  })).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));

  return {
    schema: TECHNIQUE_EVIDENCE_SCHEMA,
    raiz,
    medidoEm: new Date().toISOString(),
    recibosLidos,
    recibosComPrompt,
    recibosComComposicao,
    registrosDeUsoInvalidos,
    tecnicas: linhas,
    // A soma é o dado que interessa: seleção explícita contra cópia manual.
    resumo: {
      usosEstruturados: linhas.reduce((soma, linha) => soma + linha.estruturado, 0),
      usosTextuais: linhas.reduce((soma, linha) => soma + linha.textual, 0),
      semNenhumUso: linhas.filter((linha) => linha.total === 0).map((linha) => linha.id),
      naoReconheciveisNoTexto: linhas.filter((linha) => !linha.reconhecivelNoTexto).map((linha) => linha.id),
      idsForaDoCatalogo: [...desconhecidas.entries()].map(([id, n]) => ({ id, recibos: n })),
    },
    providerCalls: 0,
  };
}
