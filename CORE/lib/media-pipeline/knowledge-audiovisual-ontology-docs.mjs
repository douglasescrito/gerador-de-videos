import {
  AUDIOVISUAL_ONTOLOGY_EPISTEMIC_MODALITIES,
  AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE,
  AUDIOVISUAL_ONTOLOGY_SCHEMA,
  assertAudiovisualOntologySemantics,
  canonicalAudiovisualOntologyHash,
} from "./knowledge-audiovisual-ontology.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DANGEROUS_TEXT_CONTROLS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu;

function normalizedInline(value) {
  return String(value ?? "")
    .replace(DANGEROUS_TEXT_CONTROLS, "\uFFFD")
    .replace(/\s+/g, " ")
    .trim();
}

function escapedHtml(value) {
  return normalizedInline(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineText(value) {
  return escapedHtml(value).replace(
    /[\\`*_{}[\]()#+!|~-]/g,
    (character) => `\\${character}`,
  );
}

function inlineCode(value) {
  const text = escapedHtml(value);
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
  );
  if (longestBacktickRun === 0) return `\`${text}\``;
  const fence = "`".repeat(longestBacktickRun + 1);
  return `${fence} ${text} ${fence}`;
}

function compareText(left, right) {
  const normalizedLeft = String(left);
  const normalizedRight = String(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function codeList(values, fallback = "nenhum") {
  return Array.isArray(values) && values.length > 0
    ? values.map(inlineCode).join(", ")
    : fallback;
}

function validateOntologySnapshot(ontology) {
  if (!ontology || typeof ontology !== "object" || Array.isArray(ontology)) {
    throw new Error("Snapshot da ontologia audiovisual deve ser um objeto.");
  }
  if (
    ontology.file !== AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE
    || !HASH_PATTERN.test(String(ontology.fileSha256 ?? ""))
    || !HASH_PATTERN.test(String(ontology.contentHash ?? ""))
  ) {
    throw new Error("Snapshot da ontologia audiovisual é inválido.");
  }
  assertKnowledgeContract(ontology.document, {
    schemaId: AUDIOVISUAL_ONTOLOGY_SCHEMA,
    label: "Ontologia audiovisual",
  });
  assertAudiovisualOntologySemantics(ontology.document);
  if (
    canonicalAudiovisualOntologyHash(ontology.document)
    !== ontology.contentHash
  ) {
    throw new Error("Hash canônico da ontologia audiovisual é inválido.");
  }
  if (
    ontology.ref
    !== `${ontology.document.id}@${ontology.document.version}`
  ) {
    throw new Error("Referência da ontologia audiovisual é inválida.");
  }
  if (
    ontology.document.authority.retrieval !== "blocked"
    || ontology.document.authority.planning !== "blocked"
    || ontology.document.authority.providerInput !== "blocked"
  ) {
    throw new Error("Ontologia candidata não pode declarar autoridade ativa.");
  }
}

function appendEntities(lines, document, domain, title) {
  const entities = document.entityTypes
    .filter((entity) => entity.domain === domain)
    .sort((left, right) => compareText(left.id, right.id));
  lines.push(
    "",
    `### ${title}`,
    "",
    "| Termo | Definição | Aliases | Gate adicional |",
    "|---|---|---|---|",
  );
  for (const entity of entities) {
    lines.push(
      `| ${inlineCode(entity.id)} | ${inlineText(entity.definition)} | `
      + `${codeList(entity.aliases)} | `
      + `${entity.activationGate == null
        ? "nenhum"
        : inlineCode(entity.activationGate)} |`,
    );
  }
}

function appendRelations(lines, document) {
  lines.push(
    "",
    "## Relações",
    "",
    "| Predicado | Definição | Domínio | Range |",
    "|---|---|---|---|",
  );
  for (const relation of [...document.relations].sort((left, right) =>
    compareText(left.id, right.id)
  )) {
    lines.push(
      `| ${inlineCode(relation.id)} | ${inlineText(relation.definition)} | `
      + `${codeList(relation.domain)} | ${codeList(relation.range)} |`,
    );
  }
}

function appendModalities(lines, document) {
  const modalityById = new Map(
    document.epistemicModalities.map((modality) => [
      modality.id,
      modality,
    ]),
  );
  lines.push(
    "",
    "## Modalidades epistêmicas",
    "",
    "Confiança não muda modalidade. Esta lista coincide com "
    + `${inlineCode("domain-pack@1")}.`,
    "",
    "| Modalidade | Definição | Pode obrigar? |",
    "|---|---|---|",
  );
  for (const id of Object.keys(
    AUDIOVISUAL_ONTOLOGY_EPISTEMIC_MODALITIES,
  )) {
    const modality = modalityById.get(id);
    lines.push(
      `| ${inlineCode(modality.id)} | ${inlineText(modality.definition)} | `
      + `${inlineCode(modality.obligation)} |`,
    );
  }
}

function appendChangelog(lines, document) {
  lines.push("", "## Changelog", "");
  for (const entry of [...document.changelog].sort(
    (left, right) => left.version - right.version,
  )) {
    lines.push(
      `### Versão ${entry.version} — ${inlineCode(entry.date)}`,
      "",
    );
    for (const change of entry.changes) {
      lines.push(`- ${inlineText(change)}`);
    }
    lines.push("");
  }
}

export function renderAudiovisualOntologyMarkdown({ ontology } = {}) {
  validateOntologySnapshot(ontology);
  const { document } = ontology;
  const lines = [
    "# Ontologia audiovisual — candidata",
    "",
    "> Projeção gerada do dado canônico. Esta ontologia não foi aprovada e "
    + "não possui autoridade de retrieval, planejamento ou entrada de provedor.",
    "",
    `- Título: ${inlineText(document.title)}.`,
    `- Referência: ${inlineCode(`${document.id}@${document.version}`)}.`,
    `- Estado: ${inlineCode(document.status)}.`,
    `- Arquivo canônico: ${inlineCode(ontology.file)}.`,
    `- SHA-256 do arquivo: ${inlineCode(ontology.fileSha256)}.`,
    `- Hash canônico do conteúdo: ${inlineCode(ontology.contentHash)}.`,
    `- Revisores: ${codeList(document.reviewers.map((entry) => entry.id))}.`,
    `- Revisado em: ${document.reviewedAt == null
      ? "não"
      : inlineCode(document.reviewedAt)}.`,
    "",
    `Resumo: ${inlineText(document.summary)}`,
    "",
    "## Autoridade",
    "",
    `- Retrieval: ${inlineCode(document.authority.retrieval)}.`,
    `- Planejamento: ${inlineCode(document.authority.planning)}.`,
    `- Entrada de provedor: ${inlineCode(document.authority.providerInput)}.`,
    `- Motivo: ${inlineText(document.authority.reason)}`,
    "",
    "## Tipos de entidade",
  ];
  appendEntities(lines, document, "context", "Contexto");
  appendEntities(
    lines,
    document,
    "audiovisual-language",
    "Linguagem audiovisual",
  );
  appendEntities(
    lines,
    document,
    "operational-knowledge",
    "Conhecimento operacional",
  );
  appendRelations(lines, document);
  appendModalities(lines, document);
  appendChangelog(lines, document);
  return `${lines.join("\n").trimEnd()}\n`;
}
