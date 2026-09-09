import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createBuiltinKnowledgeSchemaReplayRegistry,
  createKnowledgeSchemaReplayRegistry,
  issueKnowledgeReplayAuthorization,
  registerKnowledgeSchemaReader,
  registerKnowledgeSchemaUpcaster,
  replayAuthorizedKnowledgeExport,
} from "../lib/media-pipeline/knowledge-schema-replay.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

test("registry builtin cobre somente payloads persistíveis conhecidos", () => {
  const registry = createBuiltinKnowledgeSchemaReplayRegistry();
  assert.equal(registry.readers.length, 11);
  assert.equal(registry.upcasters.length, 0);
  assert.deepEqual(
    registry.readers.map(({ schemaId }) => schemaId).sort(),
    [
      "mkt-videos/creative-decision-record@1",
      "mkt-videos/entity-profile@1",
      "mkt-videos/evidence-link@1",
      "mkt-videos/knowledge-assertion@1",
      "mkt-videos/knowledge-asset-link-payload@1",
      "mkt-videos/knowledge-relation@1",
      "mkt-videos/media-transcript@1",
      "mkt-videos/preference-rule@1",
      "mkt-videos/prompt-template-revision@1",
      "mkt-videos/rights-record@1",
      "mkt-videos/smart-collection@1",
    ],
  );
});

function normalizeJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("fixture não JSON");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]),
    );
  }
  throw new Error("fixture não JSON");
}

function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value));
}

function hash(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function itemFixture({
  id = "private:item-a",
  revision = 1,
  schemaId = "mkt-videos/motion-principle@1",
  schemaVersion = 1,
  payload = {
    secretObservation: "private timing note",
    beats: 3,
  },
  status = "active",
  localAnalysis = "allowed",
  supersedesRevision = null,
} = {}) {
  const governance = createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: {
      type: "client",
      id: "client:private-acme",
    },
    provenance: [{
      sourceType: "human-feedback",
      sourceRef: "feedback:private-source",
      method: "explicit-statement",
      observedAt: "2026-07-21T11:30:00.000Z",
      contentHash: "a".repeat(64),
    }],
    modality: "observation",
    evidenceIds: [],
    rights: {
      localAnalysis,
    },
    createdAt: "2026-07-21T11:35:00.000Z",
    createdBy: "human:private-owner",
  }, {
    expectedActor: "human:private-owner",
  });
  const body = {
    schema: "mkt-videos/knowledge-item@1",
    id,
    revision,
    rootScopeId: "client:private-acme",
    scopeId: "project:private-launch",
    recordType: "assertion",
    schemaId,
    schemaVersion,
    status,
    governance,
    supersedesRevision,
    payload,
    createdAt: `2026-07-2${revision}T12:00:00.000Z`,
    createdBy: "human:private-owner",
  };
  return {
    ...body,
    contentHash: hash(body),
  };
}

const REPLAY_CHECKED_AT = "2026-07-23T13:30:00.000Z";
const REPLAY_EXPIRES_AT = "2026-07-23T13:35:00.000Z";

function authorizedReplay({
  knowledgeExport,
  registry,
  releaseId = null,
  releaseHash = null,
  currentItems = null,
} = {}) {
  const release = knowledgeExport.releases.find((entry) =>
    (releaseId == null || entry.id === releaseId)
    && (releaseHash == null || entry.hash === releaseHash)
    && (
      releaseId != null
      || releaseHash != null
      || entry.id === knowledgeExport.releaseId
    )
  );
  if (!release) throw new Error("fixture não encontrou release");
  const releaseItems = release.members.map((member) =>
    knowledgeExport.items.find((item) =>
      item.id === member.id && item.revision === member.revision));
  const authorization = issueKnowledgeReplayAuthorization({
    rootScopeId: knowledgeExport.rootScopeId,
    release,
    releaseItems,
    currentItems: currentItems ?? releaseItems,
    checkedAt: REPLAY_CHECKED_AT,
    expiresAt: REPLAY_EXPIRES_AT,
  });
  return replayAuthorizedKnowledgeExport({
    knowledgeExport,
    registry,
    authorization,
    releaseId,
    releaseHash,
    clock: () => new Date("2026-07-23T13:31:00.000Z"),
  });
}

function releaseFixture({
  id = "release:private-v1",
  item,
  previousReleaseId = null,
} = {}) {
  const body = {
    schema: "mkt-videos/knowledge-release@1",
    id,
    rootScopeId: item.rootScopeId,
    label: "Private approved release",
    previousReleaseId,
    createdAt: "2026-07-23T13:00:00.000Z",
    createdBy: "human:private-owner",
    members: [{
      id: item.id,
      revision: item.revision,
      recordType: item.recordType,
      schemaId: item.schemaId,
      schemaVersion: item.schemaVersion,
      contentHash: item.contentHash,
    }],
  };
  return {
    ...body,
    hash: hash(body),
  };
}

function releaseExportFixture({
  item = itemFixture(),
  release = null,
} = {}) {
  const selectedRelease = release ?? releaseFixture({ item });
  const body = {
    schema: "mkt-videos/knowledge-export@1",
    storeSchema: "mkt-videos/knowledge-store@1",
    kind: "release",
    rootScopeId: item.rootScopeId,
    releaseId: selectedRelease.id,
    scopes: [],
    items: [item],
    releases: [selectedRelease],
    events: [],
  };
  return {
    ...body,
    hash: hash(body),
  };
}

function v1Reader() {
  return {
    id: "motion-principle-reader",
    implementationVersion: 1,
    schemaId: "mkt-videos/motion-principle@1",
    schemaVersion: 1,
    read(payload) {
      if (!Number.isInteger(payload.beats)) throw new Error("beats ausente");
      return payload;
    },
  };
}

function v2Reader() {
  return {
    id: "motion-principle-reader",
    implementationVersion: 2,
    schemaId: "mkt-videos/motion-principle@2",
    schemaVersion: 2,
    read(payload) {
      if (payload.unit !== "beats") throw new Error("unit ausente");
      return payload;
    },
  };
}

function v1ToV2Upcaster() {
  return {
    id: "motion-principle-v1-to-v2",
    implementationVersion: 1,
    fromSchemaId: "mkt-videos/motion-principle@1",
    fromSchemaVersion: 1,
    toSchemaId: "mkt-videos/motion-principle@2",
    toSchemaVersion: 2,
    upcast(payload) {
      return {
        ...payload,
        unit: "beats",
      };
    },
  };
}

test("identity replay valida release/revisão atuais sem expor conteúdo privado", () => {
  const knowledgeExport = releaseExportFixture();
  const bytesBefore = canonicalJson(knowledgeExport);
  const registry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader()],
  });

  const report = authorizedReplay({
    knowledgeExport,
    registry,
  });

  assert.equal(report.releaseHash, knowledgeExport.releases[0].hash);
  assert.equal(report.sourceExportHash, knowledgeExport.hash);
  assert.equal(report.memberCount, 1);
  assert.equal(
    report.members[0].sourceSchemaId,
    "mkt-videos/motion-principle@1",
  );
  assert.equal(
    report.members[0].targetSchemaId,
    "mkt-videos/motion-principle@1",
  );
  assert.equal(report.members[0].originalHash, report.members[0].projectedHash);
  assert.equal(report.members[0].upcasterHashes.length, 0);
  assert.equal(report.members[0].readerHashes.length, 1);
  assert.equal(validateKnowledgeContract(report).valid, true);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.members[0]), true);
  assert.equal(canonicalJson(knowledgeExport), bytesBefore);

  const publicBytes = JSON.stringify(report);
  for (const privateValue of [
    "client:private-acme",
    "project:private-launch",
    "private:item-a",
    "private timing note",
    "human:private-owner",
  ]) {
    assert.equal(publicBytes.includes(privateValue), false);
  }
});

test("replay aceita export v2 com lifecycle sem quebrar export histórico v1", () => {
  const legacy = releaseExportFixture();
  const {
    hash: _legacyHash,
    ...legacyBody
  } = legacy;
  const body = {
    ...legacyBody,
    schema: "mkt-videos/knowledge-export@2",
    reviewDecisions: [],
    releaseActivations: [],
  };
  const knowledgeExport = {
    ...body,
    hash: hash(body),
  };
  const registry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader()],
  });
  const report = authorizedReplay({
    knowledgeExport,
    registry,
  });

  assert.equal(report.schema, "mkt-videos/knowledge-replay-report@2");
  assert.equal(
    report.sourceExportSchema,
    "mkt-videos/knowledge-export@2",
  );
  assert.equal(report.sourceExportHash, knowledgeExport.hash);
  assert.equal(report.memberCount, 1);
  assert.equal(validateKnowledgeContract(report).valid, true);
});

test("registry imutável faz upcast sintético v1→v2 e mantém release anterior", () => {
  const historicalExport = releaseExportFixture();
  const v1Registry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader()],
  });
  const beforeNewVersion = authorizedReplay({
    knowledgeExport: historicalExport,
    registry: v1Registry,
  });

  const withV2Reader = registerKnowledgeSchemaReader(v1Registry, v2Reader());
  const currentRegistry = registerKnowledgeSchemaUpcaster(
    withV2Reader,
    v1ToV2Upcaster(),
  );
  const afterNewVersion = authorizedReplay({
    knowledgeExport: historicalExport,
    registry: currentRegistry,
  });

  assert.equal(
    beforeNewVersion.members[0].targetSchemaVersion,
    1,
  );
  assert.equal(afterNewVersion.releaseHash, beforeNewVersion.releaseHash);
  assert.equal(
    afterNewVersion.members[0].sourceSchemaId,
    "mkt-videos/motion-principle@1",
  );
  assert.equal(
    afterNewVersion.members[0].targetSchemaId,
    "mkt-videos/motion-principle@2",
  );
  assert.equal(afterNewVersion.members[0].targetSchemaVersion, 2);
  assert.equal(afterNewVersion.members[0].upcasterHashes.length, 1);
  assert.equal(afterNewVersion.members[0].readerHashes.length, 2);
  assert.equal(
    afterNewVersion.members[0].projectedHash,
    hash({
      secretObservation: "private timing note",
      beats: 3,
      unit: "beats",
    }),
  );
  assert.notEqual(
    afterNewVersion.members[0].projectedHash,
    afterNewVersion.members[0].originalHash,
  );
  assert.equal(v1Registry.readers.length, 1);
  assert.equal(v1Registry.upcasters.length, 0);
});

test("release explícita anterior resolve somente a revisão congelada", () => {
  const revision1 = itemFixture();
  const revision2 = itemFixture({
    revision: 2,
    schemaId: "mkt-videos/motion-principle@2",
    schemaVersion: 2,
    supersedesRevision: 1,
    payload: {
      secretObservation: "new private note",
      beats: 5,
      unit: "beats",
    },
  });
  const release1 = releaseFixture({ item: revision1 });
  const release2 = releaseFixture({
    id: "release:private-v2",
    item: revision2,
    previousReleaseId: release1.id,
  });
  const body = {
    schema: "mkt-videos/knowledge-export@1",
    storeSchema: "mkt-videos/knowledge-store@1",
    kind: "scope",
    rootScopeId: revision1.rootScopeId,
    releaseId: null,
    scopes: [],
    items: [revision1, revision2],
    releases: [release1, release2],
    events: [],
  };
  const knowledgeExport = { ...body, hash: hash(body) };
  const registry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader(), v2Reader()],
    upcasters: [v1ToV2Upcaster()],
  });

  const report = authorizedReplay({
    knowledgeExport,
    registry,
    releaseId: release1.id,
  });

  assert.equal(report.releaseHash, release1.hash);
  assert.equal(report.members[0].itemContentHash, revision1.contentHash);
  assert.equal(report.members[0].sourceSchemaVersion, 1);
  assert.equal(report.members[0].targetSchemaVersion, 2);
});

test("tamper e schema/version desconhecido falham fechados", () => {
  const registry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader()],
  });
  const tampered = structuredClone(releaseExportFixture());
  tampered.items[0].payload.beats = 99;
  assert.throws(
    () => authorizedReplay({
      knowledgeExport: tampered,
      registry,
    }),
    /adulterado|hash divergente/,
  );

  const unknownItem = itemFixture({
    schemaId: "mkt-videos/future-motion@9",
    schemaVersion: 9,
  });
  const unknownExport = releaseExportFixture({ item: unknownItem });
  assert.throws(
    () => authorizedReplay({
      knowledgeExport: unknownExport,
      registry,
    }),
    /desconhecido/,
  );
});

test("upcaster não determinístico é rejeitado e o relatório é byte-estável", () => {
  const knowledgeExport = releaseExportFixture();
  const deterministicRegistry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader(), v2Reader()],
    upcasters: [v1ToV2Upcaster()],
  });
  const first = authorizedReplay({
    knowledgeExport,
    registry: deterministicRegistry,
  });
  const second = authorizedReplay({
    knowledgeExport,
    registry: deterministicRegistry,
  });
  assert.deepEqual(second, first);
  assert.equal(canonicalJson(second), canonicalJson(first));

  let sequence = 0;
  const nondeterministicRegistry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader(), {
      ...v2Reader(),
      read(payload) {
        return payload;
      },
    }],
    upcasters: [{
      ...v1ToV2Upcaster(),
      upcast(payload) {
        sequence += 1;
        return {
          ...payload,
          unit: "beats",
          sequence,
        };
      },
    }],
  });
  assert.throws(
    () => authorizedReplay({
      knowledgeExport,
      registry: nondeterministicRegistry,
    }),
    /não determinístico|ambiente isolado/,
  );
});

test("replay exige autorização vigente e localAnalysis permitido no head", () => {
  const knowledgeExport = releaseExportFixture();
  const registry = createKnowledgeSchemaReplayRegistry({
    readers: [v1Reader()],
  });

  assert.throws(
    () => replayAuthorizedKnowledgeExport({
      knowledgeExport,
      registry,
      clock: () => new Date("2026-07-23T13:31:00.000Z"),
    }),
    /exige autorização vigente/,
  );

  const unknownHead = itemFixture({
    localAnalysis: "unknown",
  });
  assert.throws(
    () => authorizedReplay({
      knowledgeExport,
      registry,
      currentItems: [unknownHead],
    }),
    /não autoriza localAnalysis/,
  );

  const authorization = issueKnowledgeReplayAuthorization({
    rootScopeId: knowledgeExport.rootScopeId,
    release: knowledgeExport.releases[0],
    releaseItems: knowledgeExport.items,
    currentItems: knowledgeExport.items,
    checkedAt: REPLAY_CHECKED_AT,
    expiresAt: REPLAY_EXPIRES_AT,
  });
  assert.throws(
    () => replayAuthorizedKnowledgeExport({
      knowledgeExport,
      registry,
      authorization,
      clock: () => new Date(REPLAY_EXPIRES_AT),
    }),
    /expirou/,
  );
});
