import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUDIOVISUAL_ONTOLOGY_EPISTEMIC_MODALITIES,
  AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE,
  AUDIOVISUAL_ONTOLOGY_REQUIRED_ENTITY_TYPES,
  AUDIOVISUAL_ONTOLOGY_REQUIRED_RELATIONS,
  AUDIOVISUAL_ONTOLOGY_SCHEMA,
  canonicalAudiovisualOntologyHash,
  loadAudiovisualOntology,
} from "../lib/media-pipeline/knowledge-audiovisual-ontology.mjs";
import {
  renderAudiovisualOntologyMarkdown,
} from "../lib/media-pipeline/knowledge-audiovisual-ontology-docs.mjs";
import {
  assertKnowledgeRecordPayloadContract,
  classifyKnowledgeSchemaRole,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";
import {
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const coreRoot = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const canonicalFile = path.join(
  coreRoot,
  ...AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE.split("/"),
);
const projectionFile = path.join(
  coreRoot,
  "docs",
  "AUDIOVISUAL-ONTOLOGY.md",
);
const ontologySchemaFile = path.join(
  coreRoot,
  "schemas",
  "knowledge-audiovisual-ontology.schema.json",
);
const domainPackSchemaFile = path.join(
  coreRoot,
  "schemas",
  "knowledge-domain-pack.schema.json",
);
const HASH_A = "a".repeat(64);

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
    );
  }
  return value;
}

async function temporaryCore(source) {
  const root = await mkdtemp(path.join(tmpdir(), "mkt-ontology-"));
  const knowledge = path.join(root, "knowledge");
  await mkdir(knowledge);
  await writeFile(
    path.join(knowledge, "audiovisual-ontology@1.json"),
    typeof source === "string"
      ? source
      : `${JSON.stringify(source, null, 2)}\n`,
    "utf8",
  );
  return root;
}

async function withTemporaryDocument(document, assertion) {
  const root = await temporaryCore(document);
  try {
    await assertion(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function canonicalDocument() {
  return JSON.parse(await readFile(canonicalFile, "utf8"));
}

function ontologySnapshot(document) {
  return {
    ref: `${document.id}@${document.version}`,
    file: AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE,
    fileSha256: HASH_A,
    contentHash: canonicalAudiovisualOntologyHash(document),
    document,
  };
}

test("arquivo canônico fecha o vocabulário v1 e bloqueia toda autoridade", async () => {
  const ontology = await loadAudiovisualOntology({ coreRoot });
  const expectedEntityIds = Object.values(
    AUDIOVISUAL_ONTOLOGY_REQUIRED_ENTITY_TYPES,
  ).flat();
  assert.equal(ontology.ref, "audiovisual-core@1");
  assert.equal(ontology.document.schema, AUDIOVISUAL_ONTOLOGY_SCHEMA);
  assert.equal(ontology.document.status, "candidate");
  assert.deepEqual(ontology.document.reviewers, []);
  assert.equal(ontology.document.reviewedAt, null);
  assert.deepEqual(ontology.document.authority, {
    retrieval: "blocked",
    planning: "blocked",
    providerInput: "blocked",
    reason: ontology.document.authority.reason,
  });
  assert.equal(ontology.document.entityTypes.length, 39);
  assert.deepEqual(
    [...ontology.document.entityTypes.map(({ id }) => id)].sort(),
    [...expectedEntityIds].sort(),
  );
  assert.equal(ontology.document.relations.length, 9);
  assert.deepEqual(
    [...ontology.document.relations.map(({ id }) => id)].sort(),
    [...AUDIOVISUAL_ONTOLOGY_REQUIRED_RELATIONS].sort(),
  );
  assert.equal(
    ontology.document.entityTypes.find(({ id }) => id === "Campaign")
      .activationGate,
    "future-explicit-policy",
  );
  assert.match(ontology.fileSha256, /^[a-f0-9]{64}$/);
  assert.match(ontology.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(ontology), true);
  assert.equal(Object.isFrozen(ontology.document), true);
  assert.equal(Object.isFrozen(ontology.document.entityTypes[0]), true);
});

test("modalidades coincidem com o enum real de principle.modality do domain-pack", async () => {
  const domainPackSchema = JSON.parse(
    await readFile(domainPackSchemaFile, "utf8"),
  );
  const ontologySchema = JSON.parse(
    await readFile(ontologySchemaFile, "utf8"),
  );
  const domainPackModalities =
    domainPackSchema.$defs.principle.properties.modality.enum;
  const ontologyModalities =
    ontologySchema.$defs.epistemicModality.properties.id.enum;
  const runtimeModalities = Object.keys(
    AUDIOVISUAL_ONTOLOGY_EPISTEMIC_MODALITIES,
  );
  assert.deepEqual(
    [...ontologyModalities].sort(),
    [...domainPackModalities].sort(),
  );
  assert.deepEqual(
    [...runtimeModalities].sort(),
    [...domainPackModalities].sort(),
  );
  const ontology = await loadAudiovisualOntology({ coreRoot });
  assert.deepEqual(
    [...ontology.document.epistemicModalities.map(({ id }) => id)].sort(),
    [...domainPackModalities].sort(),
  );
});

test("hash canônico é estável para ordem de chaves e sensível ao conteúdo", async () => {
  const document = await canonicalDocument();
  assert.equal(
    canonicalAudiovisualOntologyHash(reverseObjectKeys(document)),
    canonicalAudiovisualOntologyHash(document),
  );
  const changed = structuredClone(document);
  changed.summary = `${changed.summary} Alteração material.`;
  assert.notEqual(
    canonicalAudiovisualOntologyHash(changed),
    canonicalAudiovisualOntologyHash(document),
  );
});

test("projeção Markdown é determinística, derivada e explicita estado candidato", async () => {
  const ontology = await loadAudiovisualOntology({ coreRoot });
  const first = renderAudiovisualOntologyMarkdown({ ontology });
  const second = renderAudiovisualOntologyMarkdown({ ontology });
  assert.equal(first, second);
  assert.equal(first, await readFile(projectionFile, "utf8"));
  assert.match(first, /Ontologia audiovisual — candidata/);
  assert.match(first, /não possui autoridade de retrieval/);
  assert.match(first, /Retrieval: `blocked`/);
  assert.match(first, new RegExp(ontology.contentHash));

  const tampered = {
    ...ontology,
    contentHash: "b".repeat(64),
  };
  assert.throws(
    () => renderAudiovisualOntologyMarkdown({ ontology: tampered }),
    /Hash canônico/,
  );
});

test("renderer neutraliza HTML e Markdown ativo", async () => {
  const document = await canonicalDocument();
  document.summary =
    "<img src=x onerror=alert(1)> [clique](javascript:alert(1))";
  const markdown = renderAudiovisualOntologyMarkdown({
    ontology: ontologySnapshot(document),
  });
  assert.equal(markdown.includes("<img"), false);
  assert.equal(markdown.includes("[clique](javascript:"), false);
  assert.match(markdown, /&lt;img/);
  assert.match(markdown, /\\\[clique\\\]\\\(/);
});

test("renderer reaplica semântica após rehash do snapshot", async () => {
  const cases = [
    {
      mutate(document) {
        document.relations[0].domain[0] = "UnknownEntity";
      },
      expected: /entidade desconhecida UnknownEntity/,
    },
    {
      mutate(document) {
        document.entityTypes[0].id = document.entityTypes[1].id;
      },
      expected: /entityTypes contém duplicata/,
    },
    {
      mutate(document) {
        document.epistemicModalities.find(
          ({ id }) => id === "fact",
        ).obligation = "no";
      },
      expected: /Modalidade fact exige obligation when-verifiable/,
    },
    {
      mutate(document) {
        document.entityTypes.find(
          ({ id }) => id === "Campaign",
        ).activationGate = null;
      },
      expected: /Campaign exige activationGate future-explicit-policy/,
    },
  ];
  for (const { mutate, expected } of cases) {
    const document = await canonicalDocument();
    mutate(document);
    assert.throws(
      () => renderAudiovisualOntologyMarkdown({
        ontology: ontologySnapshot(document),
      }),
      expected,
    );
  }
});

test("renderer rejeita ANSI e controles bidi mesmo após rehash", async () => {
  for (const control of ["\u001b", "\u202E"]) {
    const document = await canonicalDocument();
    document.summary += control;
    assert.throws(
      () => renderAudiovisualOntologyMarkdown({
        ontology: ontologySnapshot(document),
      }),
      /controle Unicode proibido/,
    );
  }
});

test("schema fechado bloqueia autoaprovação, reviewer, data e campo extra", async () => {
  const document = await canonicalDocument();
  for (const mutate of [
    (candidate) => {
      candidate.status = "approved";
    },
    (candidate) => {
      candidate.reviewers = [{ id: "human", name: "Humano" }];
    },
    (candidate) => {
      candidate.reviewedAt = "2026-07-24";
    },
    (candidate) => {
      candidate.unexpected = true;
    },
  ]) {
    const candidate = structuredClone(document);
    mutate(candidate);
    const result = validateKnowledgeContract(candidate, {
      schemaId: AUDIOVISUAL_ONTOLOGY_SCHEMA,
    });
    assert.equal(result.valid, false);
  }
});

test("v1 rejeita entidade ou relação extra; extensão exige nova versão", async () => {
  const document = await canonicalDocument();
  const extraEntity = structuredClone(document);
  extraEntity.entityTypes.push({
    id: "ExtraEntity",
    domain: "context",
    definition: "Extensão que não pertence à versão 1.",
    aliases: [],
    activationGate: null,
  });
  await withTemporaryDocument(extraEntity, async (root) => {
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /mais de 39 itens|must NOT have more than 39 items/,
    );
  });

  const extraRelation = structuredClone(document);
  extraRelation.relations.push({
    id: "extraRelation",
    definition: "Extensão que não pertence à versão 1.",
    domain: ["Project"],
    range: ["Client"],
  });
  await withTemporaryDocument(extraRelation, async (root) => {
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /mais de 9 itens|must NOT have more than 9 items/,
    );
  });
});

test("loader rejeita referência quebrada e semântica de modalidade divergente", async () => {
  const document = await canonicalDocument();
  const brokenRelation = structuredClone(document);
  brokenRelation.relations[0].domain[0] = "UnknownEntity";
  await withTemporaryDocument(brokenRelation, async (root) => {
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /entidade desconhecida UnknownEntity/,
    );
  });

  const wrongObligation = structuredClone(document);
  wrongObligation.epistemicModalities.find(
    ({ id }) => id === "fact",
  ).obligation = "no";
  await withTemporaryDocument(wrongObligation, async (root) => {
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /Modalidade fact exige obligation when-verifiable/,
    );
  });
});

test("loader rejeita chave JSON duplicada, ANSI e controle bidi", async () => {
  const source = await readFile(canonicalFile, "utf8");
  const duplicate = source.replace(
    "\"status\": \"candidate\"",
    "\"status\": \"candidate\", \"status\": \"candidate\"",
  );
  await withTemporaryDocument(duplicate, async (root) => {
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /chave JSON duplicada/,
    );
  });

  for (const control of ["\u001b", "\u202E"]) {
    const document = await canonicalDocument();
    document.summary += control;
    await withTemporaryDocument(document, async (root) => {
      await assert.rejects(
        loadAudiovisualOntology({ coreRoot: root }),
        /controle Unicode proibido/,
      );
    });
  }
});

test("loader não segue symlink ou junction no arquivo canônico", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mkt-ontology-link-"));
  try {
    const knowledge = path.join(root, "knowledge");
    await mkdir(knowledge);
    const source = path.join(root, "source.json");
    await writeFile(source, await readFile(canonicalFile));
    try {
      await symlink(
        source,
        path.join(knowledge, "audiovisual-ontology@1.json"),
        "file",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        t.skip(`symlink indisponível: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /symlink ou junction/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loader rejeita junction no diretório CORE/knowledge", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mkt-ontology-junction-"));
  try {
    const actualKnowledge = path.join(root, "actual-knowledge");
    await mkdir(actualKnowledge);
    await writeFile(
      path.join(actualKnowledge, "audiovisual-ontology@1.json"),
      await readFile(canonicalFile),
    );
    try {
      await symlink(
        actualKnowledge,
        path.join(root, "knowledge"),
        "junction",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        t.skip(`junction indisponível: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /symlink ou junction/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loader rejeita hardlink no arquivo canônico", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mkt-ontology-hardlink-"));
  try {
    const knowledge = path.join(root, "knowledge");
    await mkdir(knowledge);
    const source = path.join(knowledge, "source.json");
    await writeFile(source, await readFile(canonicalFile));
    try {
      await link(
        source,
        path.join(knowledge, "audiovisual-ontology@1.json"),
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        t.skip(`hardlink indisponível: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      loadAudiovisualOntology({ coreRoot: root }),
      /hardlink/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ontologia é schema global non-item e não pode entrar no store", async () => {
  const document = await canonicalDocument();
  const role = classifyKnowledgeSchemaRole(document.schema);
  assert.equal(role.kind, "global-ontology");
  assert.equal(role.persistableItemPayload, false);
  assert.throws(
    () => assertKnowledgeRecordPayloadContract({
      recordType: "relation",
      schemaId: document.schema,
      schemaVersion: 1,
      payload: document,
    }),
    /não um payload persistível/,
  );
});

test("loader e projeção permanecem provider-free e fora do Knowledge Store", async () => {
  for (const relative of [
    "lib/media-pipeline/knowledge-audiovisual-ontology.mjs",
    "lib/media-pipeline/knowledge-audiovisual-ontology-docs.mjs",
    "scripts/generate-audiovisual-ontology.mjs",
  ]) {
    const source = await readFile(path.join(coreRoot, relative), "utf8");
    const imports = Array.from(
      source.matchAll(/from\s+["']([^"']+)["']/g),
      (match) => match[1],
    );
    assert.equal(
      imports.some((specifier) =>
        /knowledge-store|sqlite|gemini|omni|provider|playwright/i.test(
          specifier,
        )
      ),
      false,
      `import proibido em ${relative}`,
    );
  }
});
