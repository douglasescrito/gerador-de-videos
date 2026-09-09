import { operationFingerprint } from "./pipeline-operation.mjs";

export const ARCHIVE_INSIGHT_SCHEMA = "mkt-videos/archive-insight@1";
export const REQUEST_MINER_VERSION = "request-miner@1";

// Palavras que aparecem em qualquer pedido e não distinguem nada. Manter curta
// e explícita: um filtro grande esconde vocabulário real do usuário.
const VAZIAS = new Set([
  "a", "as", "ao", "aos", "com", "como", "da", "das", "de", "do", "dos", "e",
  "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "se",
  "sem", "um", "uma", "the", "of", "in", "and", "to", "with", "for",
]);

function texto(value) {
  return String(value ?? "").trim();
}

/** Normaliza para comparação: minúsculas, sem acento, sem pontuação. */
export function normalizarTexto(value) {
  return texto(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-z0-9\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function termos(value) {
  return normalizarTexto(value).split(" ").filter((termo) => termo.length > 2 && !VAZIAS.has(termo));
}

function contar(lista) {
  const contagem = new Map();
  for (const item of lista) contagem.set(item, (contagem.get(item) ?? 0) + 1);
  return contagem;
}

function maiores(contagem, limite) {
  return [...contagem]
    .sort((esquerda, direita) => direita[1] - esquerda[1] || esquerda[0].localeCompare(direita[0]))
    .slice(0, limite);
}

function linhaValida(linha) {
  return linha && typeof linha === "object" && !Array.isArray(linha);
}

/**
 * Extrai o padrão da tradução que o Studio aplica ao texto pedido.
 *
 * Cada divergência entre `userPrompt` e `effectivePrompt` é uma regra que algum
 * preset aplicou na prática e nunca foi registrada como conhecimento. Isto lê
 * essas regras de volta, agrupadas pelo preset que as produziu.
 */
export function minerarDeltasDePedido(linhas, { minimoAmostra = 5, limiteTermos = 12 } = {}) {
  const porPreset = new Map();
  let comparaveis = 0;
  for (const linha of linhas ?? []) {
    if (!linhaValida(linha)) continue;
    const pedido = texto(linha.userPrompt);
    const efetivo = texto(linha.effectivePrompt);
    if (!pedido || !efetivo || pedido === efetivo) continue;
    comparaveis += 1;
    const preset = texto(linha.directionPreset) || "(sem preset)";
    if (!porPreset.has(preset)) porPreset.set(preset, { acrescentados: [], removidos: [], amostra: 0, prefixo: 0, sufixo: 0 });
    const grupo = porPreset.get(preset);
    grupo.amostra += 1;
    const doPedido = new Set(termos(pedido));
    const doEfetivo = new Set(termos(efetivo));
    for (const termo of doEfetivo) if (!doPedido.has(termo)) grupo.acrescentados.push(termo);
    for (const termo of doPedido) if (!doEfetivo.has(termo)) grupo.removidos.push(termo);
    const pedidoNormal = normalizarTexto(pedido);
    const efetivoNormal = normalizarTexto(efetivo);
    if (efetivoNormal.endsWith(pedidoNormal)) grupo.prefixo += 1;
    if (efetivoNormal.startsWith(pedidoNormal)) grupo.sufixo += 1;
  }

  const presets = [...porPreset]
    .map(([preset, grupo]) => ({
      preset,
      n: grupo.amostra,
      // Só publica termo que aparece na maioria das traduções daquele preset:
      // termo isolado é ruído de um pedido específico, não regra do preset.
      termosAcrescentados: maiores(contar(grupo.acrescentados), limiteTermos)
        .filter(([, vezes]) => vezes >= Math.max(2, Math.ceil(grupo.amostra / 2)))
        .map(([termo, vezes]) => ({ termo, vezes, fracao: Number((vezes / grupo.amostra).toFixed(3)) })),
      termosRemovidos: maiores(contar(grupo.removidos), limiteTermos)
        .filter(([, vezes]) => vezes >= Math.max(2, Math.ceil(grupo.amostra / 2)))
        .map(([termo, vezes]) => ({ termo, vezes, fracao: Number((vezes / grupo.amostra).toFixed(3)) })),
      formato: grupo.prefixo >= grupo.amostra * 0.8
        ? "preset-prefixa-o-pedido"
        : grupo.sufixo >= grupo.amostra * 0.8
          ? "preset-sufixa-o-pedido"
          : "reescrita-interna",
      evidenciaSuficiente: grupo.amostra >= minimoAmostra,
    }))
    .sort((esquerda, direita) => direita.n - esquerda.n || esquerda.preset.localeCompare(direita.preset));

  return { comparaveis, minimoAmostra, presets };
}

/** Vocabulário recorrente dos pedidos — o que é pedido, e o que é pedido junto. */
export function minerarVocabularioDePedido(linhas, { limite = 30, minimoCoocorrencia = 3 } = {}) {
  const frequencia = new Map();
  const pares = new Map();
  let pedidos = 0;
  for (const linha of linhas ?? []) {
    if (!linhaValida(linha)) continue;
    const lista = [...new Set(termos(linha.userPrompt))];
    if (!lista.length) continue;
    pedidos += 1;
    for (const termo of lista) frequencia.set(termo, (frequencia.get(termo) ?? 0) + 1);
    const ordenados = [...lista].sort();
    for (let i = 0; i < ordenados.length; i += 1) {
      for (let j = i + 1; j < ordenados.length; j += 1) {
        const chave = `${ordenados[i]}|${ordenados[j]}`;
        pares.set(chave, (pares.get(chave) ?? 0) + 1);
      }
    }
  }
  return {
    pedidos,
    termos: maiores(frequencia, limite).map(([termo, vezes]) => ({ termo, vezes })),
    coocorrencias: maiores(pares, limite)
      .filter(([, vezes]) => vezes >= minimoCoocorrencia)
      .map(([chave, vezes]) => ({ termos: chave.split("|"), vezes })),
  };
}

/**
 * Cobertura e lacunas do espaço criativo.
 *
 * Esta é a metade que impede o relatório de virar elogio: lista o que nunca foi
 * pedido, não só o que foi. O invariante 6 da Fase 9 depende dela.
 */
export function minerarLacunasDeCobertura(linhas, { presets = [], tarefas = [], formatos = [] } = {}) {
  // O catálogo grava tarefa com underscore (`text_to_video`) e os registries de
  // receita usam hífen (`text-to-video`). Sem canonizar, toda combinação real
  // parece nunca tentada e o relatório de lacunas mente por inteiro.
  const canonico = (value, vazio) => {
    const normalizado = texto(value).toLowerCase().replaceAll("_", "-");
    return normalizado || vazio;
  };
  const chaveDe = (preset, tarefa, formato) => [
    canonico(preset, "(sem preset)"),
    canonico(tarefa, "(sem tarefa)"),
    canonico(formato, "(sem formato)"),
  ].join(" × ");
  const observadas = new Map();
  for (const linha of linhas ?? []) {
    if (!linhaValida(linha)) continue;
    const chave = chaveDe(linha.directionPreset, linha.task, linha.aspectRatio);
    observadas.set(chave, (observadas.get(chave) ?? 0) + 1);
  }
  const combinacoes = [];
  for (const preset of presets) {
    for (const tarefa of tarefas) {
      for (const formato of formatos) {
        const chave = chaveDe(preset, tarefa, formato);
        combinacoes.push({ combinacao: chave, vezes: observadas.get(chave) ?? 0 });
      }
    }
  }
  const naoTentadas = combinacoes.filter((entrada) => entrada.vezes === 0).map((entrada) => entrada.combinacao);
  return {
    espacoDeclarado: combinacoes.length,
    espacoExercitado: combinacoes.length - naoTentadas.length,
    fracaoExercitada: combinacoes.length ? Number(((combinacoes.length - naoTentadas.length) / combinacoes.length).toFixed(3)) : 0,
    naoTentadas,
    maisFrequentes: maiores(observadas, 10).map(([combinacao, vezes]) => ({ combinacao, vezes })),
  };
}

/**
 * E3 — correlaciona preset e tradução com o veredito humano.
 *
 * Publica sempre a linha, mesmo sem evidência: combinação abaixo do `n` mínimo
 * aparece como `sem-evidencia-suficiente`, nunca é omitida. Omitir o que não
 * alcançou amostra é o jeito silencioso de transformar ruído em recomendação.
 */
export function minerarCorrelacaoComVeredito(linhas, { minimoAmostra = 20 } = {}) {
  const porPreset = new Map();
  let julgados = 0;
  for (const linha of linhas ?? []) {
    if (!linhaValida(linha)) continue;
    const veredito = texto(linha.review);
    if (!veredito) continue;
    julgados += 1;
    const preset = texto(linha.directionPreset) || "(sem preset)";
    if (!porPreset.has(preset)) porPreset.set(preset, { approved: 0, rejected: 0, outros: 0 });
    const grupo = porPreset.get(preset);
    if (veredito === "approved") grupo.approved += 1;
    else if (veredito === "rejected") grupo.rejected += 1;
    else grupo.outros += 1;
  }
  const presets = [...porPreset]
    .map(([preset, grupo]) => {
      const n = grupo.approved + grupo.rejected + grupo.outros;
      const decididos = grupo.approved + grupo.rejected;
      return {
        preset,
        n,
        aprovados: grupo.approved,
        rejeitados: grupo.rejected,
        pendentes: grupo.outros,
        taxaAprovacao: decididos ? Number((grupo.approved / decididos).toFixed(3)) : null,
        status: n >= minimoAmostra ? "com-evidencia" : "sem-evidencia-suficiente",
      };
    })
    .sort((esquerda, direita) => direita.n - esquerda.n || esquerda.preset.localeCompare(direita.preset));
  return {
    julgados,
    minimoAmostra,
    // O relatório inteiro é inconclusivo enquanto nenhuma combinação alcançar
    // amostra. É o estado real do acervo hoje e precisa aparecer como tal.
    conclusivo: presets.some((entrada) => entrada.status === "com-evidencia"),
    presets,
  };
}

/**
 * E4 — extrai de um achado o candidato que a decisão humana vai julgar.
 *
 * Não promove nada e não fala com o planner.
 *
 * ATENÇÃO — não existe destino pronto para este candidato, e isso é um achado,
 * não um esquecimento. Os dois portões de promoção existentes recusam esta
 * proveniência por desenho:
 *
 *   - `feedback-interpretation-candidate@1` exige `sourceFeedback`, ou seja,
 *     nasce de feedback humano em texto. Um achado minerado não tem texto
 *     humano; sintetizar um seria registrar no ledger um feedback que nunca
 *     aconteceu.
 *   - `reference-technique-candidate@1` exige `sourceTarget` + `rightsDecision`,
 *     isto é, técnica extraída de referência externa com direitos. Achado do
 *     acervo próprio não tem referência externa nem decisão de direitos.
 *
 * Um terceiro portão seria o segundo caminho de promoção que o projeto proíbe.
 * A saída correta é uma decisão humana de contrato: estender um dos dois para
 * aceitar proveniência minerada. Até lá este candidato é material de leitura
 * para um humano, e `destino` diz isso explicitamente em vez de mentir.
 */
export function extrairCandidatoDeAchado({ insight, preset } = {}) {
  assertArchiveInsight(insight, { label: "archive-insight@1 (origem do candidato)" });
  const alvo = texto(preset);
  const achado = insight.deltas.presets.find((entrada) => entrada.preset === alvo);
  if (!achado) throw new Error(`Preset ${alvo || "<vazio>"} não aparece no relatório de mineração.`);
  if (!achado.evidenciaSuficiente) {
    throw new Error(`Preset ${alvo} tem n=${achado.n}, abaixo do mínimo; candidato exige evidência suficiente.`);
  }
  return Object.freeze({
    origem: { schema: insight.schema, fingerprint: insight.fingerprint, rootScopeId: insight.rootScopeId },
    preset: achado.preset,
    n: achado.n,
    formato: achado.formato,
    termos: achado.termosAcrescentados.map((entrada) => entrada.termo),
    // Estes três campos existem para o humano ler antes de decidir. Nenhum
    // deles autoriza coisa alguma sozinho.
    requerDecisaoHumana: true,
    autoridade: "none",
    destino: "nenhum-portao-aceita-esta-proveniencia",
    bloqueio: "feedback-interpretation-candidate@1 exige sourceFeedback humano; reference-technique-candidate@1 exige sourceTarget externo com rightsDecision. Estender um dos dois é decisão humana de contrato.",
  });
}

/**
 * Monta o relatório de mineração em modo sombra.
 *
 * O relatório declara estruturalmente que não tem autoridade nenhuma. Quem
 * quiser usar um achado precisa passar por `feedbackPromotionDecision`, com
 * confirmação humana — não existe caminho daqui para o planner.
 */
export function construirArchiveInsight({ rootScopeId, linhas, registries = {}, geradoEm = new Date() } = {}) {
  const escopo = texto(rootScopeId);
  if (!escopo) throw new Error("archive-insight exige rootScopeId; mineração sem escopo vaza entre clientes.");
  if (!Array.isArray(linhas)) throw new Error("archive-insight exige a lista de linhas do acervo.");
  const corpo = {
    schema: ARCHIVE_INSIGHT_SCHEMA,
    minerVersion: REQUEST_MINER_VERSION,
    rootScopeId: escopo,
    geradoEm: new Date(geradoEm).toISOString(),
    universo: {
      linhas: linhas.length,
      comPedido: linhas.filter((linha) => linhaValida(linha) && texto(linha.userPrompt)).length,
      comTraducao: linhas.filter((linha) => linhaValida(linha) && texto(linha.userPrompt) && texto(linha.effectivePrompt) && texto(linha.userPrompt) !== texto(linha.effectivePrompt)).length,
      julgados: linhas.filter((linha) => linhaValida(linha) && texto(linha.review)).length,
    },
    deltas: minerarDeltasDePedido(linhas),
    vocabulario: minerarVocabularioDePedido(linhas),
    lacunas: minerarLacunasDeCobertura(linhas, registries),
    veredito: minerarCorrelacaoComVeredito(linhas),
    authority: "none",
    plannerInfluence: "none",
    changed: false,
    providerCalls: 0,
  };
  return Object.freeze({ ...corpo, fingerprint: operationFingerprint(corpo) });
}

/** Recusa qualquer relatório que declare autoridade, mutação, provider ou que omita as lacunas. */
export function assertArchiveInsight(value, { label = "archive-insight@1" } = {}) {
  if (value?.schema !== ARCHIVE_INSIGHT_SCHEMA) throw new Error(`${label} usa schema inválido.`);
  if (value.minerVersion !== REQUEST_MINER_VERSION) throw new Error(`${label}.minerVersion incompatível.`);
  if (!texto(value.rootScopeId)) throw new Error(`${label} exige rootScopeId.`);
  if (value.authority !== "none" || value.plannerInfluence !== "none") {
    throw new Error(`${label} não pode declarar autoridade ou influência no planner.`);
  }
  if (value.changed !== false || value.providerCalls !== 0) {
    throw new Error(`${label} não pode declarar mutação ou chamada de provider.`);
  }
  // Invariante 6 da Fase 9: relatório que só mostra o que funcionou é inválido.
  if (!value.lacunas || !Array.isArray(value.lacunas.naoTentadas)) {
    throw new Error(`${label} exige a seção de lacunas; relatório que só elogia é inválido.`);
  }
  const { fingerprint, ...corpo } = value;
  if (fingerprint !== operationFingerprint(corpo)) throw new Error(`${label}.fingerprint divergente.`);
  return value;
}
