import { access } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { sha256File, validateReferenceIndex } from "./reference-governance.mjs";

export const REFERENCE_TEMPORAL_STUDY_SCHEMA = "mkt-videos/reference-temporal-study@1";
export const MOTION_GRAMMAR_SCHEMA = "mkt-videos/motion-grammar-taxonomy@1";
export const TEMPORAL_SAMPLE_PERCENTAGES = Object.freeze([8, 28, 50, 72, 92]);

export const MOTION_GRAMMAR_FAMILIES = Object.freeze([
  Object.freeze({
    id: "interface-orchestration",
    label: "Orquestração de interfaces",
    rhythm: "Batidas de 2–6 s; um estado funcional dominante por beat.",
    contrast: "Superfícies claras ou escuras separadas por acentos de produto.",
    easing: "Snaps curtos seguidos de assentamento controlado.",
    density: "Média a alta, reduzida antes do hero reveal.",
    depth: "Cartões em primeiro plano, painel funcional no meio e campo de luz atrás.",
    transitions: "Mask wipe, push-in, troca de estado, cursor e encaixe de painéis.",
    materiality: "Vidro, cards, campos de busca, dashboards e chips.",
    movement: "Paralaxe coordenada; o foco percorre uma ação de cada vez.",
  }),
  Object.freeze({
    id: "kinetic-type",
    label: "Tipografia cinética",
    rhythm: "Palavra-herói ou frase curta por mudança semântica.",
    contrast: "Tipo grande contra campo simples; cor reservada ao acento.",
    easing: "Entrada rápida, hold legível e saída por máscara ou escala.",
    density: "Baixa; poucas palavras grandes em vez de muitas etiquetas.",
    depth: "Tipo alterna entre superfície, volume e plano de câmera.",
    transitions: "Fratura, wipe, tracking, escala, blur e recorte geométrico.",
    materiality: "Tipo sólido, luminoso, extrudado ou integrado a uma superfície.",
    movement: "Microevento no termo importante, não animação constante de cada palavra.",
  }),
  Object.freeze({
    id: "luminous-flow",
    label: "Fluxos e streaks luminosos",
    rhythm: "Acúmulo gradual, convergência e resolução em espaço negativo.",
    contrast: "Base quase preta com cobalto, ciano, magenta ou âmbar restritos.",
    easing: "Curvas longas e orgânicas intercaladas com pulsos breves.",
    density: "Baixa a média; bloom controlado para preservar leitura espacial.",
    depth: "Trilhas atravessam camadas de profundidade e sugerem câmera volumétrica.",
    transitions: "Light sweep, órbita, túnel, propagação e dissolução luminosa.",
    materiality: "Luz volumétrica, partículas finas, reflexo e vidro escuro.",
    movement: "Fluxo direcional com começo e fim declarados, sem visualizador genérico.",
  }),
  Object.freeze({
    id: "product-hero",
    label: "Produto-herói tridimensional",
    rhythm: "Preparação curta, rotação/reveal e hold final do objeto.",
    contrast: "Objeto recortado por rim light contra fundo controlado.",
    easing: "Órbita suave, aceleração limitada e desaceleração antes do hold.",
    density: "Baixa; um dispositivo, ícone ou volume é o foco.",
    depth: "Macro, perspectiva e iluminação separam objeto e ambiente.",
    transitions: "Exploded view, morph, rotação, recorte de luz e aproximação.",
    materiality: "Metal, vidro, plástico polido e superfícies emissivas.",
    movement: "Câmera e objeto não competem; um conduz enquanto o outro estabiliza.",
  }),
  Object.freeze({
    id: "data-code-systems",
    label: "Sistemas de dados e código",
    rhythm: "Progressão por estados, linhas, contadores ou blocos de informação.",
    contrast: "Texto/código colorido em base escura ou grade editorial clara.",
    easing: "Scroll, highlight e expansão de seleção com velocidade consistente.",
    density: "Alta, mas hierarquizada por foco, blur e recorte.",
    depth: "Camadas de editor, gráfico e painel se sobrepõem com parcimônia.",
    transitions: "Scan, seleção, zoom em detalhe, reorganização e grid split.",
    materiality: "Código, gráficos, terminais e visualizações abstratas de dados.",
    movement: "O dado muda por causa visível; ruído decorativo não substitui narrativa.",
  }),
  Object.freeze({
    id: "modular-brand-grids",
    label: "Grades modulares de marca",
    rhythm: "Módulos entram em sequência e convergem numa assinatura.",
    contrast: "Paleta de marca aplicada a blocos com separação nítida.",
    easing: "Encaixe elástico curto, alinhamento e hold final.",
    density: "Média; repetição modular controlada por grade.",
    depth: "Planos 2D com deslocamento z discreto e câmera frontal ou oblíqua.",
    transitions: "Tile, mosaic, grid split, stack, wipe e formação de símbolo.",
    materiality: "Blocos, fitas, módulos, cartões e formas vetoriais.",
    movement: "Reorganização com destino claro; a forma final não é copiada de referência.",
  }),
  Object.freeze({
    id: "soft-launch-surfaces",
    label: "Superfícies suaves de lançamento",
    rhythm: "Introdução limpa, demonstração breve e CTA/assinatura com pausa.",
    contrast: "Fundos claros ou gradientes macios com acento cromático único.",
    easing: "Deslizamento suave, fade curto e scale pop restrito.",
    density: "Baixa a média; espaço em branco funciona como ritmo.",
    depth: "Sombras leves e sobreposição de cards sem perspectiva agressiva.",
    transitions: "Slide, dissolve, morph simples, recorte arredondado e zoom leve.",
    materiality: "Papel digital, cards claros, gradientes e superfícies foscas.",
    movement: "Clareza primeiro; uma demonstração por plano.",
  }),
]);

function normalizedPath(value) {
  return path.resolve(String(value)).toLowerCase();
}

function frameFileFor(metadata, framesRoot, index) {
  return path.join(path.resolve(framesRoot), `${path.parse(metadata.path).name}-${index}.jpg`);
}

export async function buildReferenceTemporalStudy({
  referenceIndex,
  motionMetadata,
  framesRoot,
  generatedAt = new Date(),
} = {}) {
  validateReferenceIndex(referenceIndex);
  if (!Array.isArray(motionMetadata)) throw new Error("motionMetadata deve ser uma lista.");
  if (motionMetadata.length !== referenceIndex.videoCount) throw new Error("A análise temporal deve cobrir todas as referências indexadas.");
  const metadataByPath = new Map(motionMetadata.map((entry) => [normalizedPath(entry.path), entry]));
  const videos = [];
  for (const reference of referenceIndex.videos) {
    const metadata = metadataByPath.get(normalizedPath(reference.path));
    if (!metadata) throw new Error(`Metadado temporal ausente para ${reference.relativePath}.`);
    const durationSeconds = Number(metadata.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`Duração inválida para ${reference.relativePath}.`);
    const samples = [];
    for (const [index, percentage] of TEMPORAL_SAMPLE_PERCENTAGES.entries()) {
      const frameFile = frameFileFor(metadata, framesRoot, index);
      await access(frameFile);
      const timeSeconds = Math.max(0, Math.min(durationSeconds - 0.05, durationSeconds * percentage / 100));
      samples.push({
        percentage,
        timeSeconds,
        timeRange: [Math.max(0, timeSeconds - 0.05), Math.min(durationSeconds, timeSeconds + 0.05)],
        frameFile: path.resolve(frameFile),
        frameSha256: await sha256File(frameFile),
      });
    }
    videos.push({
      path: reference.path,
      relativePath: reference.relativePath,
      sourceSha256: reference.sha256,
      durationSeconds,
      width: Number(metadata.width),
      height: Number(metadata.height),
      fps: String(metadata.fps),
      usage: "local-study-only",
      providerInput: false,
      samples,
    });
  }
  const body = {
    schema: REFERENCE_TEMPORAL_STUDY_SCHEMA,
    sourceIndexFingerprint: referenceIndex.fingerprint,
    method: {
      samplePercentages: [...TEMPORAL_SAMPLE_PERCENTAGES],
      sampleKind: "single-frame-window",
      visualInspection: true,
      audioInspection: false,
      ocr: false,
      providerCalls: 0,
      filesMoved: false,
      filesCopied: false,
    },
    videoCount: videos.length,
    sampledFrameCount: videos.reduce((sum, video) => sum + video.samples.length, 0),
    totalDurationSeconds: videos.reduce((sum, video) => sum + video.durationSeconds, 0),
    taxonomy: {
      schema: MOTION_GRAMMAR_SCHEMA,
      familyCount: MOTION_GRAMMAR_FAMILIES.length,
      families: structuredClone(MOTION_GRAMMAR_FAMILIES),
      assignmentPolicy: "abstract-observation-only; no creator or file-level style imitation labels",
    },
    videos,
  };
  return {
    ...body,
    generatedAt: (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString(),
    fingerprint: operationFingerprint(body),
  };
}

function cell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

export function renderReferenceMotionGrammarMarkdown(study) {
  if (study?.schema !== REFERENCE_TEMPORAL_STUDY_SCHEMA) throw new Error("reference-temporal-study@1 é obrigatório.");
  const lines = [
    "# Gramática temporal das referências de motion",
    "",
    "<!-- Gerado da taxonomia estruturada e do estudo temporal local. Não editar manualmente. -->",
    "",
    `Escopo provider-free: ${study.videoCount} MP4, ${study.sampledFrameCount} amostras visuais em ${study.method.samplePercentages.join("%, ")}% da duração; fingerprint do índice \`${study.sourceIndexFingerprint}\`.`,
    "",
    "As famílias abaixo são vocabulário abstrato de ritmo, profundidade, materialidade e movimento. Não são promessa de reprodução pelo Omni, não atribuem um estilo a um criador e não autorizam qualquer referência como input do provedor.",
    "",
    "| Família | Ritmo | Easing | Densidade | Profundidade | Transições | Materialidade | Movimento |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const family of study.taxonomy.families) {
    lines.push(`| \`${family.id}\` — ${cell(family.label)} | ${cell(family.rhythm)} | ${cell(family.easing)} | ${cell(family.density)} | ${cell(family.depth)} | ${cell(family.transitions)} | ${cell(family.materiality)} | ${cell(family.movement)} |`);
  }
  lines.push(
    "",
    "## Limites de uso",
    "",
    "- O estudo amostra cinco janelas por vídeo; não reconstrói sequências nem copia composições.",
    "- Handles, nomes de criadores, logos, interfaces proprietárias e sequências reconhecíveis não entram em prompts efetivos.",
    "- A taxonomia não promove estilos para `pilot` ou `validated`; isso depende de execução autorizada e veredito humano.",
    "- Os MP4 originais permanecem no lugar. Frames e manifests são diagnósticos locais, nunca runtime inputs automáticos.",
    "",
  );
  return lines.join("\n");
}
