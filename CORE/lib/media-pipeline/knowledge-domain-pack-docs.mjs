import {
  canonicalDomainPackHash,
  DOMAIN_PACK_CATALOG_SCHEMA,
  DOMAIN_PACKS_RELATIVE_DIRECTORY,
  DOMAIN_PACK_SCHEMA,
} from "./knowledge-domain-pack-catalog.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const DOMAIN_PACK_CATALOG_MARKDOWN_SCHEMA =
  "mkt-videos/domain-pack-catalog-markdown@1";
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

function tableText(value) {
  return inlineText(value);
}

function linkText(value) {
  return inlineText(value);
}

function safeHttpsDestination(uri) {
  try {
    const parsed = new URL(String(uri ?? ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }
    return parsed.href.replace(
      /[<>\u0000-\u0020\u007f]/g,
      (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  } catch {
    return null;
  }
}

function safeLink(label, uri) {
  const normalized = normalizedInline(uri);
  const destination = safeHttpsDestination(normalized);
  if (destination) return `[${linkText(label)}](<${destination}>)`;
  if (normalized.startsWith("urn:mkt-videos:governance:")) {
    return `${linkText(label)} (${inlineCode(normalized)})`;
  }
  return `${linkText(label)} (destino inválido omitido)`;
}

function codeList(values, fallback = "nenhum") {
  return Array.isArray(values) && values.length > 0
    ? values.map(inlineCode).join(", ")
    : fallback;
}

function textList(lines, values, fallback = "nenhum", prefix = "- ") {
  if (!Array.isArray(values) || values.length === 0) {
    lines.push(`${prefix}${fallback}.`);
    return;
  }
  for (const value of values) lines.push(`${prefix}${inlineText(value)}`);
}

function compareText(left, right) {
  const normalizedLeft = String(left);
  const normalizedRight = String(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("Catálogo de domain packs deve ser um objeto.");
  }
  assertKnowledgeContract(catalog.manifest, {
    schemaId: DOMAIN_PACK_CATALOG_SCHEMA,
    label: "Manifest de domain packs",
  });
  const {
    manifestHash,
    ...manifestBody
  } = catalog.manifest;
  if (canonicalDomainPackHash(manifestBody) !== manifestHash) {
    throw new Error("Hash do manifest de domain packs é inválido.");
  }
  if (!Array.isArray(catalog.packs)) {
    throw new Error("Catálogo de domain packs deve conter packs.");
  }
  if (catalog.packs.length !== catalog.manifest.packCount) {
    throw new Error("Quantidade de packs diverge do manifest.");
  }
  const manifestByRef = new Map(
    catalog.manifest.packs.map((entry) => [entry.ref, entry]),
  );
  if (manifestByRef.size !== catalog.manifest.packs.length) {
    throw new Error("Manifest contém refs de domain pack duplicadas.");
  }
  const seen = new Set();
  for (const entry of catalog.packs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Entrada de domain pack inválida.");
    }
    if (seen.has(entry.ref)) {
      throw new Error(`Domain pack duplicado na projeção: ${entry.ref}.`);
    }
    seen.add(entry.ref);
    const expectedRef =
      `${entry.document.id}@${entry.document.version}`;
    const expectedFile =
      `${expectedRef}.domain-pack.json`;
    if (entry.ref !== expectedRef || entry.file !== expectedFile) {
      throw new Error(
        `Identidade ou arquivo inválido em ${entry.ref}.`,
      );
    }
    const manifestEntry = manifestByRef.get(entry.ref);
    if (
      !manifestEntry
      || manifestEntry.file !== entry.file
      || manifestEntry.fileSha256 !== entry.fileSha256
      || manifestEntry.contentHash !== entry.contentHash
    ) {
      throw new Error(`Domain pack ${entry.ref} diverge do manifest.`);
    }
    assertKnowledgeContract(entry.document, {
      schemaId: DOMAIN_PACK_SCHEMA,
      label: `Domain pack ${entry.ref}`,
    });
    if (canonicalDomainPackHash(entry.document) !== entry.contentHash) {
      throw new Error(`Hash canônico inválido em ${entry.ref}.`);
    }
  }
  if (
    seen.size !== manifestByRef.size
    || catalog.manifest.loadOrder.some((ref) => !seen.has(ref))
  ) {
    throw new Error("Manifest e packs não possuem o mesmo conjunto.");
  }
  const byRef = new Map(catalog.packs.map((entry) => [entry.ref, entry]));
  const visiting = new Set();
  const visited = new Set();
  const expectedLoadOrder = [];
  const visit = (ref, trail = []) => {
    if (visiting.has(ref)) {
      throw new Error(
        `Ciclo na projeção: ${[...trail, ref].join(" -> ")}.`,
      );
    }
    if (visited.has(ref)) return;
    const entry = byRef.get(ref);
    if (!entry) {
      throw new Error(`Dependência ausente na projeção: ${ref}.`);
    }
    visiting.add(ref);
    entry.document.dependencies
      .map((dependency) => `${dependency.id}@${dependency.version}`)
      .sort(compareText)
      .forEach((dependency) => visit(dependency, [...trail, ref]));
    visiting.delete(ref);
    visited.add(ref);
    expectedLoadOrder.push(ref);
  };
  [...byRef.keys()].sort(compareText).forEach((ref) => visit(ref));
  const expectedManifestBody = {
    schema: DOMAIN_PACK_CATALOG_SCHEMA,
    directory: DOMAIN_PACKS_RELATIVE_DIRECTORY,
    packCount: catalog.packs.length,
    loadOrder: expectedLoadOrder,
    packs: [...catalog.packs]
      .sort((left, right) => compareText(left.ref, right.ref))
      .map((entry) => ({
        ref: entry.ref,
        id: entry.document.id,
        version: entry.document.version,
        status: entry.document.status,
        file: entry.file,
        fileSha256: entry.fileSha256,
        contentHash: entry.contentHash,
        coverageTags: entry.document.coverageTags
          .map((coverage) => coverage.tag)
          .sort(compareText),
        dependencies: entry.document.dependencies
          .map((dependency) => ({
            ref: `${dependency.id}@${dependency.version}`,
            contentHash: dependency.contentHash,
          }))
          .sort((left, right) => compareText(left.ref, right.ref)),
      })),
  };
  if (
    canonicalDomainPackHash(expectedManifestBody)
    !== catalog.manifest.manifestHash
  ) {
    throw new Error(
      "Manifest não corresponde integralmente aos domain packs.",
    );
  }
}

function appendSources(lines, pack) {
  lines.push(
    "",
    "### Fontes e termos",
    "",
    "| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const source of [...pack.sources].sort((a, b) =>
    compareText(a.id, b.id)
  )) {
    const terms = [
      source.sourceTerms.status,
      source.sourceTerms.licenseId,
    ].filter(Boolean).join(" / ");
    const termsLink = source.sourceTerms.termsUri
      ? `; ${safeLink("termos", source.sourceTerms.termsUri)}`
      : "";
    const attestation = source.sourceContentHash
      ? inlineCode(source.sourceContentHash)
      : "sem snapshot local";
    const version = [
      source.version,
      source.publishedAt,
    ].filter(Boolean).map(inlineCode).join(" / ") || "não declarada";
    lines.push(
      `| ${inlineCode(source.id)} | ${safeLink(source.title, source.uri)} | ${inlineCode(source.sourceKind)} | ${tableText(source.publisher)} | ${version} | ${inlineCode(source.usageMode)} | ${tableText(terms || "não declarado")}${termsLink}; acesso ${inlineCode(source.accessedAt)}; ${tableText(source.sourceTerms.notes)} | ${attestation} |`,
    );
  }
}

function appendDefinitions(lines, pack) {
  lines.push("", "### Definições", "");
  for (const definition of pack.definitions) {
    lines.push(
      `- **${inlineText(definition.term)}** (${inlineCode(definition.id)}; base ${inlineCode(definition.basis)}): ${inlineText(definition.definition)} Fontes: ${codeList(definition.sourceIds)}.`,
    );
  }
}

function appendPrinciples(lines, pack) {
  lines.push("", "### Princípios", "");
  for (const principle of pack.principles) {
    lines.push(
      `#### ${inlineCode(principle.id)} — ${inlineText(principle.title)}`,
      "",
      `- Base epistemológica: ${inlineCode(principle.basis)}.`,
      `- Modalidade: ${inlineCode(principle.modality)}.`,
      `- Definição: ${inlineText(principle.definition)}`,
      `- Intenção: ${inlineText(principle.intent)}`,
      `- Fontes: ${codeList(principle.sourceIds)}.`,
      "- Aplicabilidade:",
    );
    textList(lines, principle.applicability, "nenhuma", "  - ");
    lines.push("- Limites:");
    textList(lines, principle.limits, "nenhum", "  - ");
    lines.push("- Riscos:");
    textList(lines, principle.risks, "nenhum", "  - ");
    lines.push("- Sinais de sucesso:");
    textList(lines, principle.successSignals, "nenhum", "  - ");
    lines.push("- Testes:");
    for (const test of principle.tests) {
      lines.push(
        `  - ${inlineCode(test.id)} — cenário: ${inlineText(test.scenario)} Resultado esperado: ${inlineText(test.expected)}`,
      );
    }
    lines.push("");
  }
}

function appendExceptions(lines, pack) {
  lines.push("", "### Exceções", "");
  if (pack.exceptions.length === 0) {
    lines.push("- Nenhuma exceção declarada.");
    return;
  }
  for (const exception of pack.exceptions) {
    lines.push(
      `- ${inlineCode(exception.id)} — princípios ${codeList(exception.principleIds)}. Condição: ${inlineText(exception.condition)} Resposta: ${inlineText(exception.response)} Fontes: ${codeList(exception.sourceIds)}.`,
    );
  }
}

function appendAntiPatterns(lines, pack) {
  lines.push("", "### Anti-padrões", "");
  for (const antiPattern of pack.antiPatterns) {
    lines.push(
      `- **${inlineText(antiPattern.title)}** (${inlineCode(antiPattern.id)}): ${inlineText(antiPattern.description)}`,
      `  - Princípios: ${codeList(antiPattern.principleIds)}.`,
      `  - Riscos: ${antiPattern.risks.map(inlineText).join("; ")}.`,
      `  - Mitigações: ${antiPattern.mitigations.map(inlineText).join("; ")}.`,
      `  - Fontes: ${codeList(antiPattern.sourceIds)}.`,
    );
  }
}

function appendExamples(lines, title, examples) {
  lines.push("", `### ${title}`, "");
  for (const example of examples) {
    lines.push(
      `- **${inlineText(example.title)}** (${inlineCode(example.id)}): ${inlineText(example.description)}`,
      `  - Análise: ${inlineText(example.analysis)}`,
      `  - Princípios: ${codeList(example.principleIds)}.`,
      `  - Fontes: ${codeList(example.sourceIds)}.`,
    );
  }
}

function appendPack(lines, entry) {
  const pack = entry.document;
  lines.push(
    "",
    `## ${inlineCode(entry.ref)} — ${inlineText(pack.title)}`,
    "",
    `- Lifecycle editorial: ${inlineCode(pack.status)}.`,
    `- Hash canônico: ${inlineCode(entry.contentHash)}.`,
    `- Arquivo: ${inlineCode(entry.file)}; SHA-256 ${inlineCode(entry.fileSha256)}.`,
    `- Resumo: ${inlineText(pack.summary)}`,
    `- Domínios: ${codeList(pack.scope.domains)}.`,
    `- Autores: ${pack.authors.map((author) => `${inlineText(author.name)} (${inlineCode(author.id)})`).join(", ")}.`,
    `- Revisores: ${pack.reviewers.length > 0 ? pack.reviewers.map((reviewer) => `${inlineText(reviewer.name)} (${inlineCode(reviewer.id)})`).join(", ") : "nenhum; candidato ainda não aprovado"}.`,
    `- Revisado em: ${pack.reviewedAt ? inlineCode(pack.reviewedAt) : "não revisado"}.`,
    `- Licença do pack: ${inlineCode(pack.packLicense.identifier)} (${inlineCode(pack.packLicense.type)}).`,
    `- Termos do pack: ${pack.packLicense.termsUri ? safeLink("contrato governado", pack.packLicense.termsUri) : "não declarados"}; hash ${pack.packLicense.termsContentHash ? inlineCode(pack.packLicense.termsContentHash) : "não atestado"}.`,
    `- Dependências: ${entry.document.dependencies.length > 0 ? entry.document.dependencies.map((dependency) => `${inlineCode(`${dependency.id}@${dependency.version}`)} / ${inlineCode(dependency.contentHash)}`).join(", ") : "nenhuma"}.`,
    `- Cobertura: ${pack.coverageTags.length}/${pack.requiredCoverage.length} tags declaradas/requeridas.`,
    "",
    "### Aplicabilidade",
    "",
  );
  textList(lines, pack.scope.appliesTo);
  lines.push("", "### Exclusões", "");
  textList(lines, pack.scope.excludes);
  appendSources(lines, pack);
  appendDefinitions(lines, pack);
  appendPrinciples(lines, pack);
  appendExceptions(lines, pack);
  appendAntiPatterns(lines, pack);
  appendExamples(lines, "Exemplos abstratos", pack.abstractExamples);
  appendExamples(lines, "Contraexemplos", pack.counterExamples);
  lines.push(
    "",
    "### Cobertura governada",
    "",
    `- Tags obrigatórias: ${codeList(pack.requiredCoverage)}.`,
    "- Mapeamento tag → princípios:",
  );
  for (const coverage of [...pack.coverageTags].sort((left, right) =>
    compareText(left.tag, right.tag)
  )) {
    lines.push(
      `  - ${inlineCode(coverage.tag)}: ${codeList(coverage.principleIds)}.`,
    );
  }
  lines.push(
    "",
    "### Changelog",
    "",
  );
  for (const change of pack.changelog) {
    lines.push(
      `- Versão ${change.version}, ${inlineCode(change.date)}: ${change.changes.map(inlineText).join("; ")}.`,
    );
  }
}

export function renderDomainPackCatalogMarkdown({ catalog } = {}) {
  validateCatalog(catalog);
  const byRef = new Map(catalog.packs.map((entry) => [entry.ref, entry]));
  const approvedCount = catalog.packs.filter(
    (entry) => entry.document.status === "approved",
  ).length;
  const candidateCount = catalog.packs.filter(
    (entry) => entry.document.status === "candidate",
  ).length;
  const lines = [
    "# Knowledge packs audiovisuais",
    "",
    "<!-- Gerado por scripts/generate-knowledge-pack-catalog.mjs. Não editar manualmente. -->",
    "",
    `Schema da projeção: ${inlineCode(DOMAIN_PACK_CATALOG_MARKDOWN_SCHEMA)}.`,
    `Schema dos packs: ${inlineCode(DOMAIN_PACK_SCHEMA)}.`,
    `Manifest: ${inlineCode(catalog.manifest.manifestHash)}.`,
    "",
    `Total: ${catalog.manifest.packCount}; aprovados: ${approvedCount}; candidatos: ${candidateCount}.`,
    "",
    "> Validade estrutural não é aprovação editorial. Packs `candidate` são",
    "> inspecionáveis, mas não podem influenciar retrieval ou planejamento.",
    "",
    "| Pack | Lifecycle | Princípios | Fontes | Cobertura | Hash |",
    "|---|---|---:|---:|---:|---|",
  ];
  for (const entry of catalog.manifest.packs) {
    const pack = byRef.get(entry.ref).document;
    lines.push(
      `| ${inlineCode(entry.ref)} | ${inlineCode(pack.status)} | ${pack.principles.length} | ${pack.sources.length} | ${pack.coverageTags.length}/${pack.requiredCoverage.length} | ${inlineCode(entry.contentHash)} |`,
    );
  }
  lines.push(
    "",
    `Ordem de carga: ${codeList(catalog.manifest.loadOrder)}.`,
  );
  for (const ref of catalog.manifest.loadOrder) {
    appendPack(lines, byRef.get(ref));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
