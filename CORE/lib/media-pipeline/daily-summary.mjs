import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildRuntimeOperationsSnapshot } from "./operational-reports.mjs";

export const DAILY_SUMMARY_SCHEMA = "gerador-de-videos/resumo-do-dia@1";

// "O que rodou hoje, o que falhou, o que ficou pendente" não tinha resposta.
// Havia `jobs`, `status` e agora a colheita, cada um contando um pedaço, e
// nenhum lugar juntando. Este módulo não mede nada novo: ele lê o que as
// produções já deixaram no disco e monta a resposta.

const ESTADOS_DE_ATENCAO = new Set(["attention_required", "ambiguous", "provider_pending", "stale_paid", "reapproval_required", "failed"]);

function horas(ms) {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

async function lerJson(arquivo) {
  try { return JSON.parse(await readFile(arquivo, "utf8")); }
  catch { return null; }
}

/**
 * Coleções tocadas na janela, com o que a colheita registrou.
 *
 * A varredura é por mtime de diretório — 784 pastas — em vez de abrir os
 * 10.811 recibos. O detalhe de cada peça já está na colheita da coleção.
 */
async function producoesRecentes(outputsRoot, desde) {
  let entradas;
  try { entradas = await readdir(outputsRoot, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const producoes = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    const raiz = path.join(outputsRoot, entrada.name);
    let info;
    try { info = await stat(raiz); } catch { continue; }
    if (info.mtimeMs < desde) continue;
    const colheita = await lerJson(path.join(raiz, "metadados", `${entrada.name}.colheita.json`));
    producoes.push({
      colecao: entrada.name,
      tocadaEm: new Date(info.mtimeMs).toISOString(),
      partes: colheita?.resumo?.partes ?? null,
      presets: colheita?.resumo?.presets ?? [],
      modelos: colheita?.resumo?.modelos ?? [],
      duracaoTotalMs: colheita?.resumo?.duracaoTotalMs ?? null,
      colhida: Boolean(colheita),
    });
  }
  return producoes.sort((esquerda, direita) => direita.tocadaEm.localeCompare(esquerda.tocadaEm));
}

/**
 * O que exige decisão humana. Vem do relatório de jobs, que já lê os
 * film-state e os journals por coleção — nenhuma leitura nova, nenhuma
 * interpretação nova de estado.
 */
function pendencias(relatorioDeJobs) {
  const itens = [];
  for (const job of relatorioDeJobs?.jobs ?? []) {
    const nos = job.journal?.attentionNodes ?? [];
    const estado = job.journal?.status ?? job.stage ?? null;
    if (!nos.length && !ESTADOS_DE_ATENCAO.has(String(estado))) continue;
    itens.push({
      colecao: job.collection ?? job.name ?? path.basename(path.dirname(String(job.stateFile ?? ""))),
      estado,
      nosEmAtencao: nos,
      arquivoDeEstado: job.stateFile ?? null,
      journal: job.journal?.file ?? null,
    });
  }
  return itens;
}

/**
 * Monta o resumo. Somente leitura: não chama provedor, não escreve, não
 * reconcilia nada — dizer o que precisa de decisão não é tomá-la.
 */
export async function buildDailySummary({ outputsRoot, runtimeDb = null, relatorioDeJobs = null, desdeMs = 86_400_000, now = new Date() } = {}) {
  const instante = now instanceof Date ? now : new Date(now);
  const desde = instante.getTime() - desdeMs;
  const producoes = await producoesRecentes(path.resolve(String(outputsRoot)), desde);
  const runtime = runtimeDb ? buildRuntimeOperationsSnapshot({ dbFile: runtimeDb, now: instante }) : null;
  const emAtencao = pendencias(relatorioDeJobs);
  const comDuracao = producoes.filter((entrada) => entrada.duracaoTotalMs != null);

  return {
    schema: DAILY_SUMMARY_SCHEMA,
    geradoEm: instante.toISOString(),
    readOnly: true,
    janela: { desde: new Date(desde).toISOString(), ate: instante.toISOString(), horas: horas(desdeMs) },
    rodou: {
      colecoes: producoes.length,
      partes: producoes.reduce((total, entrada) => total + (entrada.partes ?? 0), 0),
      horasDeProducao: comDuracao.length ? horas(comDuracao.reduce((total, entrada) => total + entrada.duracaoTotalMs, 0)) : null,
      semColheita: producoes.filter((entrada) => !entrada.colhida).map((entrada) => entrada.colecao),
      producoes,
    },
    precisaDeVoce: emAtencao,
    emVoo: runtime == null ? null : {
      leases: runtime.broker?.activeLeases ?? 0,
      aguardandoCapacidade: runtime.broker?.queued ?? 0,
      recursosEmUso: runtime.broker?.used ?? {},
      producoes: (runtime.broker?.leases ?? []).map((lease) => ({ producao: lease.productionId, recursos: lease.resources, desde: lease.acquiredAt })),
      rodadasAgendadas: runtime.schedules?.states ?? null,
    },
  };
}

/** A mesma coisa em texto, para quem está lendo o terminal. */
export function renderDailySummary(resumo) {
  const linhas = [];
  const j = resumo.janela;
  linhas.push(`Últimas ${j.horas}h — ${new Date(j.desde).toLocaleString("pt-BR")} até agora`);

  linhas.push("");
  if (!resumo.rodou.colecoes) {
    linhas.push("  Nada rodou nesta janela.");
  } else {
    const horasTexto = resumo.rodou.horasDeProducao == null ? "" : `, ${resumo.rodou.horasDeProducao}h de produção`;
    linhas.push(`  Rodou: ${resumo.rodou.colecoes} coleção(ões), ${resumo.rodou.partes} parte(s)${horasTexto}`);
    for (const producao of resumo.rodou.producoes.slice(0, 12)) {
      const detalhe = producao.partes == null
        ? "sem colheita"
        : `${producao.partes} partes${producao.presets.length ? ` · ${producao.presets.join(", ")}` : ""}`;
      linhas.push(`    ${producao.colecao} — ${detalhe}`);
    }
    if (resumo.rodou.producoes.length > 12) linhas.push(`    … e mais ${resumo.rodou.producoes.length - 12}`);
  }

  linhas.push("");
  if (!resumo.precisaDeVoce.length) {
    linhas.push("  Nada esperando decisão sua.");
  } else {
    linhas.push(`  Precisa de você: ${resumo.precisaDeVoce.length}`);
    for (const item of resumo.precisaDeVoce.slice(0, 12)) {
      linhas.push(`    ${item.colecao} — ${item.estado}${item.nosEmAtencao.length ? ` (${item.nosEmAtencao.join(", ")})` : ""}`);
    }
  }

  if (resumo.emVoo) {
    linhas.push("");
    if (!resumo.emVoo.leases && !resumo.emVoo.aguardandoCapacidade) {
      linhas.push("  Nada em voo agora.");
    } else {
      linhas.push(`  Em voo: ${resumo.emVoo.leases} com vaga, ${resumo.emVoo.aguardandoCapacidade} aguardando capacidade`);
      for (const producao of resumo.emVoo.producoes.slice(0, 8)) {
        linhas.push(`    ${producao.producao} — ${producao.recursos.map((recurso) => recurso.id).join(", ")}`);
      }
    }
  }

  if (resumo.rodou.semColheita.length) {
    linhas.push("");
    linhas.push(`  Sem colheita: ${resumo.rodou.semColheita.length} coleção(ões). Registre com: npm run video -- colher --root outputs`);
  }
  return linhas.join("\n");
}
