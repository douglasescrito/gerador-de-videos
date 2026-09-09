// Gerador de receitas diversificadas (Fase 3).
//
// Combina catálogos canônicos do estúdio — prompt-bank (briefs), STYLE-CATALOG
// (estilos) e TECHNIQUE-CATALOG (técnicas) — para PROPOR receitas@1 candidatas,
// sem escrever nada e sem chamar provedor. A decisão de gerar é sempre humana
// (o usuário escolhe o que virar receita real e rodar).
//
// Puro por contrato: sem I/O de escrita, sem relógio, sem sorteio dependente do
// minuto. O seed entra por parâmetro (determinístico e conferível).

import { isLiveSelectableStyleSpec, listStyleSpecs, resolveStyleSpec } from "./direction-presets.mjs";
import { listPromptTechniques, materializeTechniques, resolvePromptTechnique } from "./prompt-techniques.mjs";

export const RECIPE_VARIETY_SCHEMA = "mkt-videos/recipe-variety@1";

function aspectForStyle(style) {
  const allowed = style.formats?.allowedAspects ?? ["16:9", "9:16"];
  return [style.aspect, "16:9", "9:16"].find((aspect) => ["16:9", "9:16"].includes(aspect) && allowed.includes(aspect));
}

function availableStyles(requested) {
  const styles = requested == null ? listStyleSpecs() : requested.map((id) => resolveStyleSpec(id));
  const eligible = styles.filter((style) => {
    const ready = isLiveSelectableStyleSpec(style)
      && (!style.generation?.allowedTasks.length || style.generation.allowedTasks.includes("text_to_video"))
      && !(style.runtimeInputs?.requiredRoles.length)
      && aspectForStyle(style);
    if (!ready && requested != null) throw new Error(`Estilo ${style.id} não está disponível para proposta text_to_video sem referências.`);
    return ready;
  });
  if (!eligible.length) throw new Error("Nenhum estilo disponível para proposta text_to_video sem referências.");
  return [...new Set(eligible.map((style) => style.id))].sort();
}

function techniquesForStyle(requested, styleId) {
  const style = resolveStyleSpec(styleId);
  const selections = requested == null
    ? listPromptTechniques({ includeConcept: false }).filter((entry) => entry.status !== "deprecated").map(({ id }) => ({ id }))
    : requested.map((entry) => typeof entry === "string" ? { id: entry } : entry);
  const compatible = [];
  for (const selection of selections) {
    // Resolver e materializar usam o mesmo contrato da composição produtiva:
    // compatibilidade de task/família e slots obrigatórios, sem inventar dados.
    try {
      resolvePromptTechnique(selection?.id);
      const [materialized] = materializeTechniques([selection], { style, task: "text_to_video" });
      compatible.push({ id: materialized.id, values: materialized.values });
    } catch (error) {
      if (requested != null) throw error;
    }
  }
  return compatible;
}

// Sequências editoriais para receitas completas (kind filme). Cada cena recebe
// um papel, um texto de narração e um título na tela — o esqueleto do filme.
const SEQ_CENA = [
  { id: "gancho", papel: "hook", titulo: "O COMEÇO", frase: "Tudo que importa começa com um instante de atenção." },
  { id: "problema", papel: "context", titulo: "O DESAFIO", frase: "O que parece distante fica perto quando alguém mostra o caminho." },
  { id: "solucao", papel: "solution", titulo: "O CAMINHO", frase: "Cada passo construído com cuidado aproxima o futuro." },
  { id: "prova", papel: "proof", titulo: "A PROVA", frase: "Os detalhes que ninguém vê são os que sustentam o resultado." },
  { id: "fecho", papel: "cta", titulo: "COMECE AGORA", frase: "O futuro pertence a quem começa hoje, com propósito." },
];

function hashString(value) {
  // xorshift-ish determinístico (sem depender de node:crypto para simples).
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function slug(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pick(entries, seed, offset) {
  if (!entries.length) return null;
  return entries[(hashString(`${seed}:${offset}`) + offset) % entries.length];
}

function shortCategory(categoria) {
  const labels = {
    produto: "produto", lifestyle: "estilo de vida", marca: "marca",
    alimentacao: "gastronomia", moda: "moda", imoveis: "imóveis",
    automotivo: "automotivo", saude: "saúde e bem-estar",
    tecnologia: "tecnologia", entretenimento: "entretenimento",
  };
  return labels[String(categoria).toLowerCase()] ?? String(categoria);
}

/**
 * Gera `count` propostas de receita@1 (kind lote, N parts) a partir dos catálogos.
 * @param {{ promptBank: object, seed?: string, count?: number, parallel?: number,
 *           partesPorReceita?: number, categorias?: string[], estilos?: string[],
 *           tecnicas?: string[] }} options
 * @returns {{ schema, count, propostas: Array<object> }}
 */
export function gerarReceitasDiversificadas({
  promptBank,
  seed = "estudio",
  count = 3,
  parallel = 3,
  partesPorReceita = 5,
  categorias = null,
  estilos = null,
  tecnicas = null,
  favoritos = null,
} = {}) {
  const total = Math.max(1, Math.min(20, Number(count) || 3));
  const partes = Math.max(2, Math.min(10, Number(partesPorReceita) || 5));
  const entries = promptBank?.categories
    ? Object.values(promptBank.categories).flatMap((cat) => cat?.entries ?? [])
    : [];
  if (!entries.length) throw new Error("Prompt-bank vazio: não é possível gerar receitas.");

  // Estilos curtidos (like) entram primeiro como prioridade de sugestão, depois
  // o restante do catálogo. Nunca é ranker de conteúdo — só ordem de proposta.
  const estilosLivres = availableStyles(estilos);
  const favoritosSet = new Set(Array.isArray(favoritos) ? favoritos.map(String) : []);
  const estilosOrdenados = [...estilosLivres].sort((a, b) => {
    const aFav = favoritosSet.has(a) ? 1 : 0;
    const bFav = favoritosSet.has(b) ? 1 : 0;
    return bFav - aFav;
  });
  const tecnicasPorEstilo = new Map(estilosLivres.map((id) => [id, techniquesForStyle(tecnicas, id)]));
  const cats = categorias
    ? (Array.isArray(categorias) ? categorias : [categorias])
    : [...new Set(Object.keys(promptBank.categories ?? {}))];

  const propostas = [];
  // Pares categoria × estilo, com os estilos favoritos primeiro (prioridade de
  // sugestão), e cada grupo embaralhado deterministicamente pelo seed. Assim a
  // leva diversifica sem duplicar combinação e sem rankear conteúdo.
  const paresFavoritos = [];
  const paresComuns = [];
  for (const cat of cats) {
    for (const estilo of estilosOrdenados) {
      const par = { cat, estilo };
      if (favoritosSet.has(estilo)) paresFavoritos.push(par);
      else paresComuns.push(par);
    }
  }
  const embaralhar = (lista) => {
    for (let i = lista.length - 1; i > 0; i -= 1) {
      const j = hashString(`${seed}:par:${i}`) % (i + 1);
      [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    return lista;
  };
  const pares = [...embaralhar(paresFavoritos), ...embaralhar(paresComuns)].slice(0, total);
  for (let i = 0; i < pares.length; i += 1) {
    const { cat: categoria, estilo } = pares[i];
    const categoryEntries = promptBank.categories?.[categoria]?.entries ?? [];
    if (!categoryEntries.length) throw new Error(`Categoria sem briefs: ${categoria}.`);
    const entry = pick(categoryEntries, seed, i);
    const tecnica = pick(tecnicasPorEstilo.get(estilo), seed, i * 7 + 3);
    const brief = entry?.brief ?? entry?.video?.[0]?.brief ?? "brief vazio";

    const parts = [];
    for (let p = 0; p < partes; p += 1) {
      const variante = entry?.video?.[p] ?? entry?.video?.[0] ?? null;
      const promptBase = variante?.effectivePrompt ?? variante?.brief ?? brief;
      const seq = [
        "gancho", "problema", "solução", "prova", "oferta",
        "história", "emoção", "detalhe", "ritmo", "fecho",
      ][p % 10];
      parts.push({
        name: `parte-${String(p + 1).padStart(3, "0")}`,
        prompt: `${promptBase} | Sequência ${p + 1} (${seq}): ${p + 1} de ${partes}.`,
        techniques: tecnica ? [structuredClone(tecnica)] : [],
      });
    }

    const id = `${slug(categoria)}-${slug(estilo.replace(/@.*$/, ""))}-${seed.slice(0, 4)}-${i + 1}`;
    propostas.push({
      schema: "gerador-de-videos/receita@1",
      id,
      label: `${shortCategory(categoria)} · ${estilo}`,
      description: `Proposta ${i + 1} de ${total}: brief "${brief.slice(0, 80)}…" com ${estilo}${tecnica ? ` + ${tecnica.id}` : ""}.`,
      kind: "lote",
      aspect: aspectForStyle(resolveStyleSpec(estilo)),
      style: estilo,
      collection: `variacao-${id}`,
      parts,
      parallel,
      ...(favoritosSet.has(estilo) ? { favorito: true } : {}),
    });
  }

  return {
    schema: RECIPE_VARIETY_SCHEMA,
    seed,
    count: propostas.length,
    propostas,
  };
}

/**
 * Gera receitas COMPLETAS (kind filme) que compilam para film-spec@1: scenes
 * com texto na tela, narração em blocos (whisper), trilha, workflow, qa e
 * assembly. É a forma pronta para rodar com plan/run/approve/resume.
 * @param {{ promptBank: object, seed?: string, count?: number, parallel?: number,
 *           duracaoPorCena?: number, categorias?: string[], estilos?: string[],
 *           favoritos?: string[], presetTrilha?: string, voz?: string }} options
 */
export function gerarReceitasCompletas({
  promptBank,
  seed = "estudio",
  count = 3,
  parallel = 3,
  duracaoPorCena = 10,
  categorias = null,
  estilos = null,
  tecnicas = null,
  favoritos = null,
  presetTrilha = "institucional",
  voz = "voz masculina brasileira madura, grave, calorosa, encorpada e confiável, de locutor institucional experiente",
} = {}) {
  if (tecnicas?.length) throw new Error("Técnicas por clipe são suportadas nas propostas de lote; --filme não possui esse campo no compilador de cenas.");
  const total = Math.max(1, Math.min(10, Number(count) || 3));
  const durCena = Math.max(4, Math.min(15, Number(duracaoPorCena) || 10));
  const nCenas = SEQ_CENA.length;
  const targetSeconds = nCenas * durCena;
  const entries = promptBank?.categories
    ? Object.values(promptBank.categories).flatMap((cat) => cat?.entries ?? [])
    : [];
  if (!entries.length) throw new Error("Prompt-bank vazio: não é possível gerar receitas.");

  const estilosLivres = availableStyles(estilos);
  const favoritosSet = new Set(Array.isArray(favoritos) ? favoritos.map(String) : []);
  const estilosOrdenados = [...estilosLivres].sort((a, b) => (favoritosSet.has(b) ? 1 : 0) - (favoritosSet.has(a) ? 1 : 0));
  const cats = categorias
    ? (Array.isArray(categorias) ? categorias : [categorias])
    : [...new Set(Object.keys(promptBank.categories ?? {}))];

  // Pares categoria × estilo, favoritos primeiro, cada grupo embaralhado pelo seed.
  const paresFavoritos = [];
  const paresComuns = [];
  for (const cat of cats) {
    for (const estilo of estilosOrdenados) {
      const par = { cat, estilo };
      if (favoritosSet.has(estilo)) paresFavoritos.push(par);
      else paresComuns.push(par);
    }
  }
  const embaralharPares = (lista) => {
    for (let i = lista.length - 1; i > 0; i -= 1) {
      const j = hashString(`${seed}:fp:${i}`) % (i + 1);
      [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    return lista;
  };
  const pares = [...embaralharPares(paresFavoritos), ...embaralharPares(paresComuns)].slice(0, total);

  const receitas = [];
  for (let i = 0; i < pares.length; i += 1) {
    const { cat: categoria, estilo } = pares[i];
    const categoryEntries = promptBank.categories?.[categoria]?.entries ?? [];
    if (!categoryEntries.length) throw new Error(`Categoria sem briefs: ${categoria}.`);
    const entry = pick(categoryEntries, seed, i);
    const brief = entry?.brief ?? entry?.video?.[0]?.brief ?? "brief vazio";
    const preset = Array.isArray(presetTrilha) ? pick(presetTrilha, seed, i) : String(presetTrilha);

    const scenes = SEQ_CENA.map((seq, c) => {
      const variante = entry?.video?.[c] ?? entry?.video?.[0] ?? null;
      const promptBase = variante?.effectivePrompt ?? variante?.brief ?? brief;
      return {
        id: `c${String(c + 1).padStart(2, "0")}-${seq.id}`,
        prompt: `${promptBase} | ${seq.papel}: ${seq.frase}`,
        duration: durCena,
        onScreenText: seq.titulo,
        textRendering: "omni-native",
      };
    });

    const blocks = SEQ_CENA.map((seq, c) => ({ id: `bloco-${c + 1}`, text: seq.frase }));
    const narrationText = blocks.map((b) => b.text).join(" ");

    const id = `${slug(categoria)}-${slug(estilo.replace(/@.*$/, ""))}-${seed.slice(0, 4)}-${i + 1}`;
    receitas.push({
      schema: "gerador-de-videos/receita@1",
      id,
      label: `${shortCategory(categoria)} · ${estilo} · filme`,
      description: `Receita completa de ${targetSeconds}s: brief "${brief.slice(0, 80)}…" com ${estilo}, narração em blocos e trilha ${preset}.`,
      kind: "filme",
      aspect: aspectForStyle(resolveStyleSpec(estilo)),
      style: estilo,
      collection: `filme-${id}`,
      targetDurationSeconds: targetSeconds,
      scenes,
      audio: {
        music: true,
        musicPreset: preset,
        musicDurationSeconds: targetSeconds,
        musicFit: "exact",
        musicFadeOutSeconds: 0,
        narration: {
          provider: "omni",
          text: narrationText,
          voice: voz,
          sync: "whisper-word-timestamps",
          whisperModel: "small",
          language: "pt",
          blocks,
        },
      },
      workflow: {
        narrationSync: "whisper-word-timestamps",
        whisperModel: "small",
        musicFit: "exact",
        defaultTextRendering: "omni-native",
        localGcPolicy: "explicit-only",
        alignmentReview: "orthographic-logical",
        correctionWhisperModel: "large-v3-turbo",
        humanReview: false,
        completionMode: "complete",
        wallTargetSeconds: 300,
        flowSoftBudgetSeconds: 90,
        streamAlignment: true,
        authorizationMode: "production-once",
        omniResubmit: "evidence-guided-automatic",
        automaticRetry: true,
        retryPolicy: "bounded-reconciled@1",
        maxAttempts: 3,
        automaticCorrections: true,
        acceptedAttemptPolicy: "whisper-pass",
      },
      qa: {
        structural: true,
        expectedDuration: targetSeconds,
      },
      assembly: { fps: 24 },
      parallel,
      resources: [],
      ...(favoritosSet.has(estilo) ? { favorito: true } : {}),
    });
  }

  return {
    schema: "mkt-videos/recipe-variety-filme@1",
    seed,
    count: receitas.length,
    receitas,
  };
}

/**
 * Plano de ondas determinístico (Fase 4): espalha propostas de receita ao longo
 * de N dias, com `porDia` propostas por dia. Mesma fonte (prompt-bank + estilos
 * + técnicas), mesmo seed por dia — a execução de cada onda é decisão humana.
 * @param {{ promptBank: object, seed?: string, dias?: number, porDia?: number,
 *           parallel?: number, partesPorReceita?: number, categorias?: string[],
 *           estilos?: string[], tecnicas?: string[], favoritos?: string[] }} options
 */
export function gerarPlanoDiversidade({
  promptBank,
  seed = "estudio",
  dias = 5,
  porDia = 2,
  parallel = 3,
  partesPorReceita = 5,
  categorias = null,
  estilos = null,
  tecnicas = null,
  favoritos = null,
} = {}) {
  const totalDias = Math.max(1, Math.min(30, Number(dias) || 5));
  const totalPorDia = Math.max(1, Math.min(6, Number(porDia) || 2));
  const total = totalDias * totalPorDia;
  const geradas = gerarReceitasDiversificadas({
    promptBank,
    seed,
    count: total,
    parallel,
    partesPorReceita,
    categorias,
    estilos,
    tecnicas,
    favoritos,
  });
  const diasPlano = [];
  for (let dia = 0; dia < totalDias; dia += 1) {
    const inicio = dia * totalPorDia;
    diasPlano.push({
      dia: dia + 1,
      seedDia: `${seed}:dia-${dia + 1}`,
      propostas: geradas.propostas.slice(inicio, inicio + totalPorDia).map((proposta) => proposta.id),
    });
  }
  return {
    schema: "mkt-videos/recipe-diversity-plan@1",
    seed,
    dias: totalDias,
    porDia: totalPorDia,
    total,
    diasPlano,
    propostas: geradas.propostas,
  };
}
