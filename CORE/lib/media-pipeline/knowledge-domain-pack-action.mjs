import { fileURLToPath } from "node:url";
import {
  loadDomainPackCatalog,
} from "./knowledge-domain-pack-catalog.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_DOMAIN_PACK_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-domain-pack-action-result@1";

const DEFAULT_CORE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function emptyPackContentCounts() {
  return {
    sources: 0,
    definitions: 0,
    principles: 0,
    exceptions: 0,
    antiPatterns: 0,
    abstractExamples: 0,
    counterExamples: 0,
    coverageTags: 0,
    dependencies: 0,
  };
}

function projectDomainPackCatalog(catalog) {
  const content = emptyPackContentCounts();
  const manifestEntries = new Map(
    catalog.manifest.packs.map((entry) => [entry.ref, entry]),
  );
  const packs = catalog.packs.map((pack) => {
    const entry = manifestEntries.get(pack.ref);
    if (!entry) {
      throw new Error(`Manifest não contém o domain pack ${pack.ref}.`);
    }
    if (pack.document.status !== "candidate") {
      throw new Error(
        `Domain pack ${pack.ref} não possui lifecycle candidate-only.`,
      );
    }
    const counts = {
      sources: pack.document.sources.length,
      definitions: pack.document.definitions.length,
      principles: pack.document.principles.length,
      exceptions: pack.document.exceptions.length,
      antiPatterns: pack.document.antiPatterns.length,
      abstractExamples: pack.document.abstractExamples.length,
      counterExamples: pack.document.counterExamples.length,
      coverageTags: pack.document.coverageTags.length,
      dependencies: pack.document.dependencies.length,
    };
    for (const key of Object.keys(content)) content[key] += counts[key];
    return {
      ref: entry.ref,
      id: entry.id,
      version: entry.version,
      status: "candidate",
      approvalVerified: false,
      hashes: {
        fileSha256: entry.fileSha256,
        contentHash: entry.contentHash,
      },
      counts,
    };
  });
  return {
    schema: catalog.manifest.schema,
    directory: catalog.manifest.directory,
    manifestHash: catalog.manifest.manifestHash,
    packCount: catalog.manifest.packCount,
    loadOrder: [...catalog.manifest.loadOrder],
    counts: {
      candidates: packs.length,
      content,
    },
    packs,
  };
}

export async function runKnowledgeDomainPackAction(options = {}) {
  const {
    action = "packs",
    coreRoot = DEFAULT_CORE_ROOT,
    ...privateOptions
  } = options;
  if (String(action).trim().toLowerCase() !== "packs") {
    throw new Error("Domain pack action aceita somente action=packs.");
  }
  const forbidden = Object.entries(privateOptions)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key]) => key);
  if (forbidden.length > 0) {
    throw new Error(
      "knowledge packs aceita somente --action packs; "
      + "remova opções de store, escopo, input, saída ou confirmação.",
    );
  }
  const catalog = await loadDomainPackCatalog({ coreRoot });
  return assertKnowledgeContract({
    schema: KNOWLEDGE_DOMAIN_PACK_ACTION_RESULT_SCHEMA,
    action: "packs",
    status: "catalog-loaded",
    providerFree: true,
    readOnly: true,
    changed: false,
    deterministic: true,
    approvalVerified: false,
    manifest: projectDomainPackCatalog(catalog),
  }, {
    schemaId: KNOWLEDGE_DOMAIN_PACK_ACTION_RESULT_SCHEMA,
    label: "Resultado de knowledge packs",
  });
}
