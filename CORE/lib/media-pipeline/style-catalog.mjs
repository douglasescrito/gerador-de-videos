import {
  isLiveSelectableStyleSpec,
  listStyleSpecs,
  STYLE_SPEC_SCHEMA,
} from "./direction-presets.mjs";
import {
  assertStyleEvidenceReconciliation,
  buildStyleEvidenceReconciliationReport,
} from "./style-evidence-reconciliation.mjs";

export const STYLE_CATALOG_MARKDOWN_SCHEMA = "mkt-videos/style-catalog-markdown@1";

function compareIds(left, right) {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function inlineText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tableText(value) {
  return inlineText(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function inlineCode(value) {
  return `\`${inlineText(value).replaceAll("`", "\\`")}\``;
}

function codeList(values, fallback = "nenhum") {
  return Array.isArray(values) && values.length > 0
    ? values.map((value) => inlineCode(value)).join(", ")
    : fallback;
}

function yesNo(value) {
  return value ? "sim" : "não";
}

function validateCatalogStyles(styles) {
  if (!Array.isArray(styles)) throw new Error("styles deve ser uma lista de StyleSpec.");
  const ids = new Set();
  for (const [index, style] of styles.entries()) {
    if (!style || typeof style !== "object" || Array.isArray(style)) throw new Error(`styles[${index}] deve ser um objeto.`);
    if (style.schema !== STYLE_SPEC_SCHEMA) throw new Error(`styles[${index}].schema deve ser ${STYLE_SPEC_SCHEMA}.`);
    if (!inlineText(style.id)) throw new Error(`styles[${index}].id é obrigatório.`);
    if (ids.has(style.id)) throw new Error(`StyleSpec duplicado no catálogo: ${style.id}.`);
    ids.add(style.id);
  }
}

function appendGeneration(lines, generation) {
  if (!generation) return;
  lines.push(
    "",
    "### Geração",
    "",
    `- Tarefas permitidas: ${codeList(generation.allowedTasks)}.`,
    `- Tarefa padrão: ${generation.defaultTask ? inlineCode(generation.defaultTask) : "não definida"}.`,
    `- Topologias permitidas: ${codeList(generation.allowedTopologies)}.`,
    `- Topologia padrão: ${inlineCode(generation.defaultTopology)}.`,
    `- Continuidade obrigatória: ${yesNo(generation.continuityRequired)}.`,
  );
}

function appendFormats(lines, formats) {
  if (!formats) return;
  lines.push(
    "",
    "### Formatos",
    "",
    `- Aspectos permitidos: ${codeList(formats.allowedAspects)}.`,
  );
  if (formats.typicalClipSeconds) {
    lines.push(`- Faixa típica de clipe: ${formats.typicalClipSeconds[0]}–${formats.typicalClipSeconds[1]} segundos.`);
  }
}

function appendCapabilities(lines, capabilities) {
  if (!capabilities || Object.keys(capabilities).length === 0) return;
  lines.push("", "### Capacidades", "", "| Capacidade | Nível |", "|---|---|");
  for (const key of Object.keys(capabilities).sort()) {
    lines.push(`| ${tableText(key)} | ${inlineCode(capabilities[key])} |`);
  }
}

function appendRuntimeInputs(lines, runtimeInputs) {
  if (!runtimeInputs) return;
  lines.push(
    "",
    "### Inputs em execução",
    "",
    `- Papéis obrigatórios: ${codeList(runtimeInputs.requiredRoles)}.`,
    `- Máximo de referências: ${runtimeInputs.maxReferences}.`,
  );
}

function appendEvidence(lines, evidence) {
  if (!evidence || evidence.length === 0) return;
  lines.push("", "### Evidências locais", "");
  for (const entry of evidence) {
    lines.push(
      `- ${inlineCode(entry.file)} — SHA-256 ${inlineCode(entry.sha256)}; uso ${inlineCode(entry.usage)}; direitos ${inlineCode(entry.rightsStatus)}; trechos ${codeList(entry.timeRanges)}.`,
    );
  }
}

function appendValidation(lines, validation) {
  if (!validation) return;
  lines.push(
    "",
    "### Validação",
    "",
    `- Modelo: ${validation.model ? inlineCode(validation.model) : "não registrado"}.`,
    `- Verificado em: ${validation.checkedAt ? inlineCode(validation.checkedAt) : "não registrado"}.`,
    `- Veredito humano: ${validation.humanVerdict ? inlineCode(validation.humanVerdict) : "não registrado"}.`,
    `- Aspectos: ${codeList(validation.aspects)}.`,
    `- Recibos: ${codeList(validation.receiptIds)}.`,
  );
  if (validation.notes.length > 0) {
    lines.push("- Notas:");
    for (const note of validation.notes) lines.push(`  - ${inlineText(note)}`);
  }
}

function appendRisks(lines, risks) {
  if (!risks || risks.length === 0) return;
  lines.push("", "### Riscos", "");
  for (const risk of risks) lines.push(`- ${inlineText(risk)}`);
}

function appendEvidenceReconciliation(lines, reconciliation) {
  lines.push(
    "",
    "### Reconciliação de evidência",
    "",
    `- Disponibilidade: ${inlineCode(reconciliation.availability)}.`,
    `- Estado da evidência: ${inlineCode(reconciliation.evidenceStatus)}.`,
    `- Evidência de referência: ${inlineCode(reconciliation.referenceEvidence.status)}; ${reconciliation.referenceEvidence.eligibleCount} de ${reconciliation.referenceEvidence.declaredCount} qualificadas.`,
    `- Recibos canônicos: ${codeList(reconciliation.receipts.eligibleIds)}.`,
    `- Veredito humano: ${reconciliation.humanVerdict ? inlineCode(reconciliation.humanVerdict) : "não registrado"}.`,
    `- Limitações registradas: ${reconciliation.limitations.length > 0 ? reconciliation.limitations.map(inlineText).join("; ") : "nenhuma"}.`,
    `- Campos ausentes: ${codeList(reconciliation.missing)}.`,
    `- Bloqueios: ${codeList(reconciliation.blockers)}.`,
  );
}

export function renderStyleCatalogMarkdown({ styles = listStyleSpecs() } = {}) {
  validateCatalogStyles(styles);
  const ordered = [...styles].sort(compareIds);
  const evidenceReport = assertStyleEvidenceReconciliation(
    buildStyleEvidenceReconciliationReport({ styles: ordered }),
  );
  const evidenceByStyleId = new Map(
    evidenceReport.styles.map((entry) => [entry.styleId, entry]),
  );
  const lines = [
    "# Catálogo de estilos",
    "",
    "<!-- Gerado por scripts/generate-style-catalog.mjs. Não editar manualmente. -->",
    "",
    `Schema fonte: ${inlineCode(STYLE_SPEC_SCHEMA)}.`,
    "",
    "Este índice provider-free deriva exclusivamente do registro canônico em",
    "`lib/media-pipeline/direction-presets.mjs`. Um estilo `concept` pode ser",
    "inspecionado, mas não é selecionável para geração live por padrão.",
    "",
    `Total: ${ordered.length} estilos; ${evidenceReport.summary.available} disponíveis para geração live; ${evidenceReport.summary.evidenceValidated} validados por evidência.`,
    "",
    "| ID | Nome | Família | Lifecycle | Disponível | Evidência | Aspecto sugerido | Tags |",
    "|---|---|---|---|---|---|---|---|",
  ];

  for (const style of ordered) {
    const reconciliation = evidenceByStyleId.get(style.id);
    lines.push(
      `| ${inlineCode(style.id)} | ${tableText(style.label)} | ${inlineCode(style.family)} | ${inlineCode(style.status)} | ${yesNo(reconciliation.availability === "available")} | ${inlineCode(reconciliation.evidenceStatus)} | ${style.aspect ? inlineCode(style.aspect) : "herdado"} | ${codeList(style.tags)} |`,
    );
  }

  for (const style of ordered) {
    const reconciliation = evidenceByStyleId.get(style.id);
    lines.push(
      "",
      `## ${inlineCode(style.id)} — ${inlineText(style.label)}`,
      "",
      `- Família: ${inlineCode(style.family)}.`,
      `- Status: ${inlineCode(style.status)}.`,
      `- Somente Studio: ${yesNo(style.studioOnly)}.`,
      `- Selecionável para geração live: ${yesNo(isLiveSelectableStyleSpec(style))}.`,
      `- Aspecto sugerido: ${style.aspect ? inlineCode(style.aspect) : "herdado do pedido"}.`,
      `- Tags: ${codeList(style.tags)}.`,
    );
    if (style.supersedes) lines.push(`- Substitui: ${inlineCode(style.supersedes)}.`);
    lines.push("", "### Direção", "", inlineText(style.direction));
    if (style.compositionControls) {
      lines.push("", "### Componentes opcionais de direção", "", "Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.", "", "| Dimensão | Opções compatíveis |", "|---|---|");
      for (const [dimension, entries] of Object.entries(style.compositionControls.dimensions)) lines.push(`| ${inlineCode(dimension)} | ${codeList(entries.map((entry) => entry.id))} |`);
      lines.push("");
      if (style.compositionControls.availability === "unavailable") lines.push("Este estilo preserva uma direção específica e não aceita complementos genéricos.", "");
    }
    appendGeneration(lines, style.generation);
    appendFormats(lines, style.formats);
    appendCapabilities(lines, style.capabilities);
    appendRuntimeInputs(lines, style.runtimeInputs);
    appendEvidence(lines, style.referenceEvidence);
    appendValidation(lines, style.validation);
    appendRisks(lines, style.risks);
    if (style.tradeoffs?.length) {
      lines.push("### Limitações condicionais", "", "| Condição | Capacidade afetada | Limitação | Evidência | Fallback automático |", "|---|---|---|---|---|");
      for (const rule of style.tradeoffs) lines.push(`| ${inlineText(rule.condition)} | ${inlineText(rule.affectedCapability)} | ${inlineText(rule.limitation)} | ${inlineText(rule.evidenceLevel)} | não |`);
      lines.push("");
    }
    appendEvidenceReconciliation(lines, reconciliation);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
