// Renderizador provider-free do catálogo publicado de técnicas (ADR 0040).
// O documento é derivado do registro canônico; nada aqui é fonte da verdade.

import {
  TECHNIQUE_SPEC_SCHEMA,
  listPromptTechniques,
  PRODUCTION_PROCEDURES,
} from "./prompt-techniques.mjs";

const inlineCode = (value) => `\`${value}\``;

const AVAILABLE_STATUSES = new Set(["proven", "pilot"]);

function validateCatalogTechniques(techniques) {
  if (!Array.isArray(techniques) || techniques.length === 0) {
    throw new Error("Catálogo de técnicas exige ao menos uma entrada.");
  }
  const seen = new Set();
  for (const technique of techniques) {
    if (technique?.schema !== TECHNIQUE_SPEC_SCHEMA) {
      throw new Error(`Entrada de catálogo com schema inesperado: ${technique?.schema}.`);
    }
    if (seen.has(technique.id)) throw new Error(`Catálogo com id duplicado: ${technique.id}.`);
    seen.add(technique.id);
    // `proven` é uma afirmação sobre uso real. Sem recibo observado, a entrada
    // não pode se declarar provada.
    if (technique.status === "proven" && technique.evidence.receiptCount < 1) {
      throw new Error(`Técnica ${technique.id} declara proven sem recibo observado.`);
    }
    if (technique.status === "proven" && technique.evidence.samples.length === 0) {
      throw new Error(`Técnica ${technique.id} declara proven sem amostra de recibo.`);
    }
  }
  return techniques;
}

function scopeText(technique) {
  const { styles, families, tasks } = technique.appliesTo;
  const parts = [];
  parts.push(styles.length > 0
    ? `estilos ${styles.map(inlineCode).join(", ")}`
    : families.length > 0
      ? `famílias ${families.map(inlineCode).join(", ")}`
      : "qualquer estilo");
  if (tasks.length > 0) parts.push(`tasks ${tasks.map(inlineCode).join(", ")}`);
  return parts.join("; ");
}

export function renderTechniqueCatalogMarkdown({ techniques = listPromptTechniques(), procedures = Object.values(PRODUCTION_PROCEDURES) } = {}) {
  const ordered = validateCatalogTechniques([...techniques])
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const available = ordered.filter((technique) => AVAILABLE_STATUSES.has(technique.status)).length;
  const observedReceipts = ordered.reduce((total, technique) => total + technique.evidence.receiptCount, 0);

  const lines = [
    "# Catálogo de técnicas de prompt e procedimentos",
    "",
    "<!-- Gerado por scripts/generate-technique-catalog.mjs. Não editar manualmente. -->",
    "",
    `Schema fonte: ${inlineCode(TECHNIQUE_SPEC_SCHEMA)}.`,
    "",
    "Este índice provider-free deriva exclusivamente do registro canônico em",
    "`lib/media-pipeline/prompt-techniques.mjs`. Enquanto o catálogo de estilos",
    "responde como a peça se parece, este responde como o prompt é montado.",
    "",
    "Técnica é composição: só se aplica no modo `studio`, com um estilo",
    "selecionado, e sempre por escolha humana explícita na invocação. `status:",
    "proven` significa usada e mantida em produção real, não validada por",
    "avaliação formal de qualidade.",
    "",
    `Total: ${ordered.length} técnicas; ${available} selecionáveis para geração live; ${observedReceipts} recibos observados no acervo.`,
    `Procedimentos: ${procedures.length}. São parâmetros de operações existentes, nunca texto enviado ao provedor.`,
    "",
    "A contagem acima é a observação anotada em cada técnica, com a data em que",
    "alguém olhou. Ela **não se atualiza sozinha** e pode estar velha. Para medir",
    "contra os recibos de hoje: `npm run video -- tecnicas`. A medição separa dois",
    "caminhos que o número somado esconde — a técnica **selecionada** na invocação,",
    "que fica registrada no recibo, e o bloco **copiado** direto no prompt, que",
    "funciona igual mas não deixa registro de qual técnica foi nem de qual versão.",
    "",
    "| ID | Nome | Status | Posição | Ordem | Escopo | Recibos |",
    "|---|---|---|---|---|---|---:|",
  ];

  for (const technique of ordered) {
    lines.push([
      "",
      inlineCode(technique.id),
      technique.label,
      inlineCode(technique.status),
      inlineCode(technique.placement),
      String(technique.order),
      scopeText(technique),
      String(technique.evidence.receiptCount),
      "",
    ].join("|"));
  }

  for (const technique of ordered) {
    lines.push(
      "",
      `## ${inlineCode(technique.id)} — ${technique.label}`,
      "",
      `- Status: ${inlineCode(technique.status)}.`,
      `- Nível de validação: ${inlineCode(technique.validationLevel ?? "observed-local")}.`,
      `- Estudos: ${(technique.studyRefs ?? []).map(inlineCode).join(", ") || "nenhum registrado"}.`,
      `- Incompatibilidades: ${(technique.conflictsWith ?? []).map(inlineCode).join(", ") || "nenhuma declarada"}.`,
      `- Posição no prompt: ${inlineCode(technique.placement)}, ordem ${technique.order}.`,
      `- Escopo: ${scopeText(technique)}.`,
      "",
      "### Problema que evita",
      "",
      technique.problem,
      "",
      "### Bloco",
      "",
      "```text",
      technique.block,
      "```",
      "",
      "### Variáveis",
      "",
    );
    if (technique.slots.length === 0) {
      lines.push("Nenhuma.");
    } else {
      lines.push(
        "| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |",
        "|---|---|---|---|---|---|",
      );
      for (const slot of technique.slots) {
        lines.push([
          "",
          inlineCode(slot.name),
          slot.label,
          inlineCode(slot.type),
          slot.scope === "clip" ? "por clipe" : "por série",
          slot.required ? "sim" : "não",
          slot.defaultValue == null ? "—" : inlineCode(slot.defaultValue),
          "",
        ].join("|"));
      }
    }
    lines.push(
      "",
      "### Evidência de uso",
      "",
      `- Recibos observados: ${technique.evidence.receiptCount}, em ${technique.evidence.observedAt}.`,
      `- Veredito humano de qualidade: ${technique.evidence.humanVerdict ?? "não registrado"}.`,
      "- Amostras:",
    );
    for (const sample of technique.evidence.samples) {
      lines.push(`  - ${inlineCode(sample)}`);
    }
    lines.push("", "### Limites conhecidos", "");
    if (technique.risks.length === 0) lines.push("Nenhum registrado.");
    else for (const risk of technique.risks) lines.push(`- ${risk}`);
  }

  lines.push("", "## Procedimentos do método", "");
  for (const procedure of procedures) {
    lines.push(`### ${inlineCode(procedure.id)} — ${procedure.label}`, "",
      `- Tipo: ${procedure.kind}; operação: ${inlineCode(procedure.operationRef)}.`,
      `- Status: ${procedure.status}; validação: ${procedure.validationLevel}.`,
      `- Parâmetros: ${procedure.parameters.map(inlineCode).join(", ")}.`,
      `- Evidências: ${procedure.evidence.samples.map(inlineCode).join(", ")}.`,
      "", procedure.problem, "");
  }
  lines.push("");
  return `${lines.join("\n")}`.replace(/\n+$/, "\n");
}
