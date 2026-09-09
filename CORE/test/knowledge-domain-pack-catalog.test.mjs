import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalDomainPackHash,
  DOMAIN_PACK_CATALOG_SCHEMA,
  DOMAIN_PACK_REQUIRED_COVERAGE,
  DOMAIN_PACK_SCHEMA,
  loadDomainPackCatalog,
  MAX_DOMAIN_PACK_AGGREGATE_BYTES,
  MAX_DOMAIN_PACKS,
} from "../lib/media-pipeline/knowledge-domain-pack-catalog.mjs";
import {
  listKnowledgeSchemas,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const HASH_A = "a".repeat(64);
const TEST_PACK_TERMS_BYTES = Buffer.from(
  "# Synthetic domain pack terms\nProvider-free test fixture only.\n",
  "utf8",
);
const TEST_PACK_TERMS_HASH = createHash("sha256")
  .update(TEST_PACK_TERMS_BYTES)
  .digest("hex");

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makePack(id = "sample-domain", overrides = {}) {
  const source = {
    id: "source-primary",
    title: "Public technical source",
    uri: "https://example.test/technical-source",
    publisher: "Example Standards Body",
    accessedAt: "2026-07-24T12:00:00.000Z",
    sourceKind: "external-guidance",
    usageMode: "paraphrase-only",
    version: "1",
    publishedAt: "2026-01-10",
    sourceTerms: {
      status: "unknown",
      licenseId: null,
      termsUri: "https://example.test/terms",
      notes: "Only citation and original paraphrase are allowed by this pack.",
    },
  };
  const principle = {
    id: "principle-primary",
    title: "Make the intended relationship perceivable",
    definition: "The formal relationship must be legible in its delivery context.",
    intent: "Preserve meaning instead of prescribing one visual aesthetic.",
    sourceIds: [source.id],
    basis: "editorial-synthesis",
    modality: "heuristic",
    applicability: ["Use when a viewer must infer a technical relationship."],
    limits: ["It does not replace audience or channel validation."],
    risks: ["Excess emphasis can suppress secondary information."],
    successSignals: ["A reviewer can identify the intended relationship."],
    tests: [{
      id: "test-primary",
      scenario: "Inspect the abstract hierarchy at the target delivery size.",
      expected: "The intended primary relationship remains distinguishable.",
    }],
  };
  return {
    schema: DOMAIN_PACK_SCHEMA,
    id,
    version: 1,
    status: "candidate",
    title: `Candidate pack for ${id}`,
    summary: "A synthetic, public and provider-free fixture for contract tests.",
    scope: {
      domains: ["audiovisual"],
      appliesTo: ["Abstract audiovisual planning and review."],
      excludes: ["It does not grant rights or authorize provider input."],
    },
    authors: [{
      id: "fixture-author",
      name: "Synthetic Fixture Author",
    }],
    reviewers: [],
    packLicense: {
      type: "custom",
      identifier: "MKT-Videos-Proprietary-Knowledge@1",
      termsUri: "urn:mkt-videos:governance:domain-pack-terms",
      termsContentHash: TEST_PACK_TERMS_HASH,
      notice: "Synthetic fixture content for provider-free automated tests.",
    },
    sources: [source],
    definitions: [{
      id: "definition-primary",
      term: "Perceivable relationship",
      definition: "A relationship that remains distinguishable in context.",
      basis: "source-grounded",
      sourceIds: [source.id],
    }],
    principles: [principle],
    exceptions: [],
    antiPatterns: [{
      id: "anti-pattern-primary",
      title: "Decorative ambiguity",
      description: "Decoration obscures the relationship being communicated.",
      principleIds: [principle.id],
      risks: ["The viewer infers the wrong hierarchy."],
      mitigations: ["Restore a measurable contrast between the roles."],
      sourceIds: [source.id],
    }],
    abstractExamples: [{
      id: "example-primary",
      title: "Abstract positive example",
      description: "One role is consistently distinguished from its context.",
      principleIds: [principle.id],
      analysis: "The distinction supports the intended relationship.",
      sourceIds: [source.id],
    }],
    counterExamples: [{
      id: "counter-example-primary",
      title: "Abstract counterexample",
      description: "All roles receive equal emphasis despite different meaning.",
      principleIds: [principle.id],
      analysis: "The treatment hides the intended relationship.",
      sourceIds: [source.id],
    }],
    coverageTags: [{
      tag: "primary-technique",
      principleIds: [principle.id],
    }],
    requiredCoverage: ["primary-technique"],
    dependencies: [],
    reviewedAt: null,
    changelog: [{
      version: 1,
      date: "2026-07-24",
      changes: ["Created the initial candidate fixture."],
    }],
    ...overrides,
  };
}

async function makeCore(t) {
  const coreRoot = await mkdtemp(path.join(os.tmpdir(), "mkt-pack-core-"));
  const packsDirectory = path.join(coreRoot, "knowledge", "domain-packs");
  await mkdir(packsDirectory, { recursive: true });
  await writeFile(
    path.join(coreRoot, "knowledge", "DOMAIN-PACK-TERMS.md"),
    TEST_PACK_TERMS_BYTES,
  );
  t.after(async () => {
    await rm(coreRoot, { recursive: true, force: true });
  });
  return { coreRoot, packsDirectory };
}

async function writePack(packsDirectory, document, {
  file = `${document.id}@${document.version}.domain-pack.json`,
  space = 2,
} = {}) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, space)}\n`);
  await writeFile(path.join(packsDirectory, file), bytes);
  return { bytes, file };
}

async function assertInvalidPack(t, name, mutate, pattern) {
  await t.test(name, async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const document = makePack(`invalid-${name.replaceAll("_", "-")}`);
    mutate(document);
    await writePack(packsDirectory, document);
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      pattern,
    );
  });
}

test("schema é autodescoberto e catálogo atesta bytes, conteúdo e ordem determinística", async (t) => {
  const registered = new Set(listKnowledgeSchemas().map((entry) => entry.id));
  assert.ok(registered.has(DOMAIN_PACK_SCHEMA));
  assert.ok(registered.has(DOMAIN_PACK_CATALOG_SCHEMA));

  const { coreRoot, packsDirectory } = await makeCore(t);
  const foundation = makePack("foundation-technique");
  const foundationWrite = await writePack(packsDirectory, foundation);
  const dependent = makePack("dependent-technique", {
    dependencies: [{
      id: foundation.id,
      version: foundation.version,
      contentHash: canonicalDomainPackHash(foundation),
    }],
  });
  await writePack(packsDirectory, dependent);
  const before = await readdir(packsDirectory);

  const first = await loadDomainPackCatalog({ coreRoot });
  const second = await loadDomainPackCatalog({ coreRoot });
  const after = await readdir(packsDirectory);

  assert.deepEqual(first, second);
  assert.deepEqual(after, before);
  assert.equal(first.manifest.schema, DOMAIN_PACK_CATALOG_SCHEMA);
  assert.equal(first.manifest.packCount, 2);
  assert.deepEqual(first.manifest.loadOrder, [
    "foundation-technique@1",
    "dependent-technique@1",
  ]);
  assert.deepEqual(
    first.manifest.packs.map((entry) => entry.ref),
    ["dependent-technique@1", "foundation-technique@1"],
  );
  const foundationEntry = first.manifest.packs.find(
    (entry) => entry.ref === "foundation-technique@1",
  );
  assert.equal(
    foundationEntry.fileSha256,
    createHash("sha256").update(foundationWrite.bytes).digest("hex"),
  );
  assert.equal(
    foundationEntry.contentHash,
    canonicalDomainPackHash(foundation),
  );
  const body = Object.fromEntries(
    Object.entries(first.manifest).filter(([key]) => key !== "manifestHash"),
  );
  assert.equal(
    first.manifest.manifestHash,
    canonicalDomainPackHash(body),
  );
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.manifest));
  assert.ok(Object.isFrozen(first.packs[0].document.principles[0]));
  assert.throws(
    () => {
      first.packs[0].document.title = "mutated";
    },
    TypeError,
  );
});

test("hash de conteúdo é canônico e hash de arquivo atesta os bytes exatos", async (t) => {
  const { coreRoot, packsDirectory } = await makeCore(t);
  const document = makePack("canonical-hash");
  const compact = await writePack(packsDirectory, document, { space: 0 });
  const first = await loadDomainPackCatalog({ coreRoot });
  await writePack(packsDirectory, document, { space: 2 });
  const expanded = await loadDomainPackCatalog({ coreRoot });

  assert.equal(
    first.manifest.packs[0].contentHash,
    expanded.manifest.packs[0].contentHash,
  );
  assert.notEqual(
    first.manifest.packs[0].fileSha256,
    expanded.manifest.packs[0].fileSha256,
  );
  assert.equal(
    first.manifest.packs[0].fileSha256,
    createHash("sha256").update(compact.bytes).digest("hex"),
  );
  assert.notEqual(first.manifest.manifestHash, expanded.manifest.manifestHash);
});

test("parser rejeita chaves JSON duplicadas antes da canonicalização", async (t) => {
  const { coreRoot, packsDirectory } = await makeCore(t);
  const document = makePack("duplicate-json-key");
  const serialized = JSON.stringify(document);
  const title = `"title":${JSON.stringify(document.title)}`;
  const ambiguous = serialized.replace(
    title,
    `"title":"shadow value",${title}`,
  );
  await writeFile(
    path.join(
      packsDirectory,
      `${document.id}@${document.version}.domain-pack.json`,
    ),
    ambiguous,
  );
  await assert.rejects(
    () => loadDomainPackCatalog({ coreRoot }),
    /chave JSON duplicada/,
  );
});

test("parser limita nesting antes da validação de schema", async (t) => {
  const { coreRoot, packsDirectory } = await makeCore(t);
  const file = path.join(
    packsDirectory,
    "nested-json@1.domain-pack.json",
  );
  await writeFile(
    file,
    `${"[".repeat(130)}0${"]".repeat(130)}`,
  );
  await assert.rejects(
    () => loadDomainPackCatalog({ coreRoot }),
    /excede nesting JSON/,
  );
});

test("contrato e fechamento semântico falham para campos, IDs, refs, licença e lifecycle inválidos", async (t) => {
  await assertInvalidPack(
    t,
    "campo_extra",
    (pack) => {
      pack.undeclared = true;
    },
    /inválido/,
  );
  await assertInvalidPack(
    t,
    "licenca_custom_sem_contrato_governado",
    (pack) => {
      pack.packLicense = {
        type: "custom",
        identifier: "Self-Declared-License",
        termsUri: "urn:mkt-videos:governance:domain-pack-terms",
        termsContentHash: HASH_A,
        notice: "A self-declared identifier cannot grant reuse.",
      };
    },
    /termos proprietários internos atestados/,
  );
  await assertInvalidPack(
    t,
    "controle_terminal",
    (pack) => {
      pack.summary = "Resumo seguro\u001b[31mtexto forjado";
    },
    /controle Unicode proibido/,
  );
  await assertInvalidPack(
    t,
    "controle_bidi",
    (pack) => {
      pack.summary = "Resumo \u202Etexto visualmente invertido";
    },
    /controle Unicode proibido/,
  );
  await assertInvalidPack(
    t,
    "source_duplicada",
    (pack) => {
      pack.sources.push({
        ...jsonClone(pack.sources[0]),
        title: "Different title with the same semantic ID",
      });
    },
    /sources contém duplicata/,
  );
  await assertInvalidPack(
    t,
    "source_ausente",
    (pack) => {
      pack.principles[0].sourceIds = ["missing-source"];
    },
    /referencia ID ausente/,
  );
  await assertInvalidPack(
    t,
    "source_orfa",
    (pack) => {
      pack.sources.push({
        ...jsonClone(pack.sources[0]),
        id: "source-orphan",
        title: "Source with no inbound semantic reference",
      });
    },
    /Fontes sem referência inbound/,
  );
  await assertInvalidPack(
    t,
    "termos_known_sem_licenca",
    (pack) => {
      pack.sources[0].sourceTerms.status = "known";
      pack.sources[0].sourceTerms.licenseId = null;
      pack.sources[0].sourceTerms.termsUri = null;
    },
    /exige licença e URI/,
  );
  await assertInvalidPack(
    t,
    "termos_unknown_com_licenca",
    (pack) => {
      pack.sources[0].sourceTerms.status = "unknown";
      pack.sources[0].sourceTerms.licenseId = "Made-Up-License";
    },
    /não pode alegar licenseId/,
  );
  await assertInvalidPack(
    t,
    "termos_not_applicable_externo",
    (pack) => {
      pack.sources[0].sourceTerms.status = "not-applicable";
      pack.sources[0].sourceTerms.licenseId = null;
      pack.sources[0].sourceTerms.termsUri = null;
    },
    /externo não pode declarar termos não aplicáveis/,
  );
  await assertInvalidPack(
    t,
    "uri_executavel",
    (pack) => {
      pack.sources[0].uri = "javascript:alert(1)";
    },
    /inválido/,
  );
  await assertInvalidPack(
    t,
    "uri_com_credencial",
    (pack) => {
      pack.sources[0].uri =
        "https://user:secret@example.test/technical-source";
    },
    /não pode conter credenciais/,
  );
  await assertInvalidPack(
    t,
    "reuse_nao_autorizado_pelo_schema_v1",
    (pack) => {
      pack.sources[0].usageMode = "licensed-reuse";
    },
    /inválido/,
  );
  await assertInvalidPack(
    t,
    "candidate_com_reviewer",
    (pack) => {
      pack.reviewers = [{ id: "reviewer", name: "Reviewer" }];
      pack.reviewedAt = "2026-07-24";
    },
    /inválido/,
  );
  await assertInvalidPack(
    t,
    "aprovacao_autodeclarada",
    (pack) => {
      pack.status = "approved";
      pack.reviewers = [{ id: "reviewer", name: "Reviewer" }];
      pack.reviewedAt = "2026-07-24";
    },
    /inválido/,
  );
  await assertInvalidPack(
    t,
    "sintese_editorial_normativa",
    (pack) => {
      pack.principles[0].modality = "hard-constraint";
    },
    /editorial-synthesis não pode alegar modalidade normativa/,
  );
  await assertInvalidPack(
    t,
    "policy_com_fonte_externa",
    (pack) => {
      pack.principles[0].basis = "internal-policy";
      pack.principles[0].modality = "hard-constraint";
    },
    /internal-policy exige somente política interna/,
  );
  await assertInvalidPack(
    t,
    "definicao_policy_com_fonte_externa",
    (pack) => {
      pack.definitions[0].basis = "internal-policy";
    },
    /definitions\[0\] internal-policy exige somente política interna/,
  );
  await assertInvalidPack(
    t,
    "principio_sem_coverage",
    (pack) => {
      pack.principles.push({
        ...jsonClone(pack.principles[0]),
        id: "uncovered-principle",
        tests: [{
          ...jsonClone(pack.principles[0].tests[0]),
          id: "uncovered-test",
        }],
      });
    },
    /Princípios sem coverageTags/,
  );
});

test("perfis fundacionais exigem toda a cobertura mínima governada", async (t) => {
  const { coreRoot, packsDirectory } = await makeCore(t);
  const document = makePack("motion-foundations");
  await writePack(packsDirectory, document);
  await assert.rejects(
    () => loadDomainPackCatalog({ coreRoot }),
    /requiredCoverage não cobre o mínimo governado/,
  );
  assert.ok(DOMAIN_PACK_REQUIRED_COVERAGE["motion-foundations"].length >= 29);
});

test("política interna exige URN permitida e hash do arquivo efetivo", async (t) => {
  const { coreRoot, packsDirectory } = await makeCore(t);
  const schemasDirectory = path.join(coreRoot, "schemas");
  const policyFile = path.join(schemasDirectory, "brand-kit.schema.json");
  const policyBytes = Buffer.from(
    "{\"schema\":\"synthetic-brand-policy@1\"}\n",
    "utf8",
  );
  await mkdir(schemasDirectory, { recursive: true });
  await writeFile(policyFile, policyBytes);
  const policyHash = createHash("sha256")
    .update(policyBytes)
    .digest("hex");
  const document = makePack("bound-internal-policy");
  document.sources[0] = {
    id: "source-primary",
    title: "Synthetic governed BrandKit policy",
    uri: "urn:mkt-videos:governance:brand-kit-contract",
    publisher: "MKT Videos test fixture",
    accessedAt: "2026-07-24T12:00:00.000Z",
    sourceKind: "internal-policy",
    usageMode: "normative-policy",
    version: "synthetic-brand-policy@1",
    sourceContentHash: policyHash,
    sourceTerms: {
      status: "not-applicable",
      licenseId: null,
      termsUri: null,
      notes: "Synthetic local policy used only by a provider-free test.",
    },
  };
  document.definitions[0].basis = "internal-policy";
  document.principles[0].basis = "internal-policy";
  document.principles[0].modality = "hard-constraint";
  await writePack(packsDirectory, document);

  const catalog = await loadDomainPackCatalog({ coreRoot });
  assert.equal(catalog.manifest.packCount, 1);

  document.sources[0].sourceContentHash = HASH_A;
  await writePack(packsDirectory, document);
  await assert.rejects(
    () => loadDomainPackCatalog({ coreRoot }),
    /declara hash divergente/,
  );

  delete document.sources[0].sourceContentHash;
  await writePack(packsDirectory, document);
  await assert.rejects(
    () => loadDomainPackCatalog({ coreRoot }),
    /inválido/,
  );
});

test("dependências exigem existência, hash exato e grafo acíclico", async (t) => {
  await t.test("ausente", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const document = makePack("missing-dependency", {
      dependencies: [{
        id: "not-present",
        version: 1,
        contentHash: HASH_A,
      }],
    });
    await writePack(packsDirectory, document);
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /depende de pack ausente/,
    );
  });

  await t.test("hash divergente", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const dependency = makePack("hash-target");
    const dependent = makePack("hash-source", {
      dependencies: [{
        id: dependency.id,
        version: dependency.version,
        contentHash: HASH_A,
      }],
    });
    await writePack(packsDirectory, dependency);
    await writePack(packsDirectory, dependent);
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /hash divergente/,
    );
  });

  await t.test("ciclo", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const left = makePack("cycle-left", {
      dependencies: [{
        id: "cycle-right",
        version: 1,
        contentHash: HASH_A,
      }],
    });
    const right = makePack("cycle-right", {
      dependencies: [{
        id: "cycle-left",
        version: 1,
        contentHash: HASH_A,
      }],
    });
    await writePack(packsDirectory, left);
    await writePack(packsDirectory, right);
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /Ciclo entre domain packs/,
    );
  });
});

test("mesmo source ID não pode divergir entre packs", async (t) => {
  const { coreRoot, packsDirectory } = await makeCore(t);
  const left = makePack("source-consistency-left");
  const right = makePack("source-consistency-right");
  right.sources[0].uri = "https://example.test/different-source";
  await writePack(packsDirectory, left);
  await writePack(packsDirectory, right);
  await assert.rejects(
    () => loadDomainPackCatalog({ coreRoot }),
    /Fonte source-primary diverge entre/,
  );
});

test("diretório governado rejeita nome divergente, entrada extra, symlink, junction e hardlink", async (t) => {
  await t.test("nome diverge da identidade", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    await writePack(packsDirectory, makePack("inside-identity"), {
      file: "outside-identity@1.domain-pack.json",
    });
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /diverge da identidade/,
    );
  });

  await t.test("entrada extra", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    await mkdir(path.join(packsDirectory, "nested"));
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /aceita somente arquivos/,
    );
  });

  await t.test("hardlink", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const external = path.join(coreRoot, "external.json");
    const document = makePack("hardlink-pack");
    await writeFile(external, JSON.stringify(document));
    await link(
      external,
      path.join(packsDirectory, "hardlink-pack@1.domain-pack.json"),
    );
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /hardlink/,
    );
  });

  await t.test("symlink de arquivo", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const external = path.join(coreRoot, "external-pack.json");
    await writeFile(external, JSON.stringify(makePack("symlink-pack")));
    try {
      await symlink(
        external,
        path.join(packsDirectory, "symlink-pack@1.domain-pack.json"),
        "file",
      );
    } catch (error) {
      if (error?.code === "EPERM") {
        subtest.skip("Host não permite criar symlink de arquivo.");
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /aceita somente arquivos|symlink/,
    );
  });

  await t.test("junction do diretório governado", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const outside = await mkdtemp(path.join(os.tmpdir(), "mkt-pack-outside-"));
    subtest.after(async () => {
      await rm(outside, { recursive: true, force: true });
    });
    await rm(packsDirectory, { recursive: true });
    try {
      await symlink(outside, packsDirectory, "junction");
    } catch (error) {
      if (error?.code === "EPERM") {
        subtest.skip("Host não permite criar junction.");
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /symlink ou junction/,
    );
  });
});

test("preflight limita quantidade e bytes agregados antes de parsear", async (t) => {
  await t.test("quantidade", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    for (let index = 0; index <= MAX_DOMAIN_PACKS; index += 1) {
      await writeFile(
        path.join(packsDirectory, `pack-${index}@1.domain-pack.json`),
        "{}",
      );
    }
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      new RegExp(`limite de ${MAX_DOMAIN_PACKS} domain packs`),
    );
  });

  await t.test("bytes agregados", async (subtest) => {
    const { coreRoot, packsDirectory } = await makeCore(subtest);
    const fileBytes = 1024 * 1024;
    const fileCount = Math.floor(
      MAX_DOMAIN_PACK_AGGREGATE_BYTES / fileBytes,
    ) + 1;
    for (let index = 0; index < fileCount; index += 1) {
      const file = path.join(
        packsDirectory,
        `large-${index}@1.domain-pack.json`,
      );
      await writeFile(file, "{}");
      await truncate(file, fileBytes);
    }
    await assert.rejects(
      () => loadDomainPackCatalog({ coreRoot }),
      /limite agregado/,
    );
  });
});
