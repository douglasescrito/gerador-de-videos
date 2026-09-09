import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertProviderInputAuthorized,
  createProviderInputAuthorization,
  deriveCreatorIdentifiers,
  lintPromptForImitation,
  readProviderInputAuthorization,
  readReferenceIndex,
  scanReferenceLibrary,
  validateProviderInputAuthorization,
  validateReferenceIndex,
  writeProviderInputAuthorization,
  writeReferenceIndex,
} from "../lib/media-pipeline/reference-governance.mjs";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function refreshIndexFingerprint(index) {
  index.fingerprint = sha256Text(stableStringify({
    root: index.root,
    videos: index.videos.map((video) => ({
      relativePath: video.relativePath,
      sha256: video.sha256,
      sizeBytes: video.sizeBytes,
      modifiedAt: video.modifiedAt,
      media: video.media,
    })),
  }));
  return index;
}

function refreshAuthorizationId(authorization) {
  const { id: _discarded, ...body } = authorization;
  authorization.id = `refauth_${sha256Text(stableStringify(body)).slice(0, 24)}`;
  return authorization;
}

function fakeProbe() {
  return {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "3.250000",
      size: "4",
      bit_rate: "1000",
    },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
        pix_fmt: "yuv420p",
      },
    ],
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mkt-reference-governance-"));
  const root = path.join(directory, "VIDEO REFS");
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "aftermagics-1780457769000.mp4"), "abcd");
  await writeFile(path.join(root, "nested", "abstract-reference.mp4"), "efgh");
  await writeFile(path.join(root, "ignore.txt"), "not a video");
  const index = await scanReferenceLibrary({
    root,
    probe: fakeProbe,
    now: new Date("2026-07-23T18:00:00.000Z"),
  });
  return { directory, root, index };
}

test("indexa somente MP4 com caminho, SHA-256 e metadados, mantendo evidência local", async () => {
  const { directory, root, index } = await fixture();
  try {
    assert.equal(index.videoCount, 2);
    assert.equal(index.root, path.resolve(root));
    assert.equal(index.policy.framesInspected, false);
    assert.equal(index.policy.filesMoved, false);
    assert.equal(index.policy.filesCopied, false);
    assert.equal(index.policy.providerCalls, 0);
    assert.deepEqual(index.videos.map((video) => video.relativePath), [
      "aftermagics-1780457769000.mp4",
      "nested/abstract-reference.mp4",
    ]);
    for (const video of index.videos) {
      assert.equal(path.isAbsolute(video.path), true);
      assert.match(video.sha256, /^[a-f0-9]{64}$/);
      assert.equal(video.classification, "inspiration-evidence");
      assert.equal(video.usage, "local-study-only");
      assert.equal(video.providerInputPolicy, "explicit-authorization-required");
      assert.equal(video.media.durationSeconds, 3.25);
      assert.equal(video.media.streams[0].codec, "h264");
    }
    assert.equal(await readFile(path.join(root, "aftermagics-1780457769000.mp4"), "utf8"), "abcd");
    assert.equal(await readFile(path.join(root, "nested", "abstract-reference.mp4"), "utf8"), "efgh");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("índice e autorização são sidecars novos e nunca sobrescrevem arquivo existente", async () => {
  const { directory, index } = await fixture();
  try {
    const indexFile = path.join(directory, "diagnosticos", "reference-index.json");
    await writeReferenceIndex(indexFile, index);
    const reread = await readReferenceIndex(indexFile);
    assert.equal(reread.fingerprint, index.fingerprint);
    await assert.rejects(() => writeReferenceIndex(indexFile, index), /exist|EEXIST/i);

    const authorization = createProviderInputAuthorization({
      index,
      reference: "aftermagics-1780457769000.mp4",
      actor: "Ana",
      scope: "piloto-streaks-de-luz",
      role: "edit-source-video",
      operation: "edit",
      confirmed: true,
      issuedAt: new Date("2026-07-23T18:30:00.000Z"),
    });
    const authorizationFile = path.join(directory, "autorizacoes", "provider-input.json");
    await writeProviderInputAuthorization(authorizationFile, authorization);
    const rereadAuthorization = await readProviderInputAuthorization(authorizationFile);
    assert.equal(rereadAuthorization.reference.sha256, index.videos[0].sha256);
    await assert.rejects(() => writeProviderInputAuthorization(authorizationFile, authorization), /exist|EEXIST/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider-input exige confirmação explícita e fica preso a caminho, hash, escopo, papel e operação", async () => {
  const { directory, index } = await fixture();
  try {
    const base = {
      index,
      reference: "aftermagics-1780457769000.mp4",
      actor: "Ana",
      scope: "piloto-controlado",
      role: "edit-source-video",
      operation: "edit",
      issuedAt: new Date("2026-07-23T18:30:00.000Z"),
    };
    assert.throws(() => createProviderInputAuthorization(base), /confirmação explícita/);
    const authorization = createProviderInputAuthorization({ ...base, confirmed: true });
    const verified = assertProviderInputAuthorized({
      index,
      authorization,
      reference: base.reference,
      scope: base.scope,
      role: base.role,
      operation: base.operation,
      now: new Date("2026-07-23T19:00:00.000Z"),
    });
    assert.equal(verified.reference.relativePath, base.reference);
    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization,
      reference: base.reference,
      scope: "outro-piloto",
    }), /não cobre scope/);

    const changedIndex = structuredClone(index);
    changedIndex.videos[0].sha256 = "f".repeat(64);
    assert.throws(() => assertProviderInputAuthorized({
      index: changedIndex,
      authorization,
      reference: base.reference,
    }), /fingerprint diverge/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejeita índice forjado por forma, contagem, política, escape da raiz ou fingerprint divergente", async () => {
  const { directory, root, index } = await fixture();
  try {
    const extraField = structuredClone(index);
    extraField.unexpected = true;
    assert.throws(() => validateReferenceIndex(extraField), /forma incompatível.*inesperados: unexpected/);

    const wrongCount = structuredClone(index);
    wrongCount.videoCount += 1;
    assert.throws(() => validateReferenceIndex(wrongCount), /videoCount deve corresponder/);

    const relaxedPolicy = structuredClone(index);
    relaxedPolicy.policy.providerCalls = 1;
    assert.throws(() => validateReferenceIndex(relaxedPolicy), /policy\.providerCalls/);

    const escaped = structuredClone(index);
    escaped.videos[0].path = path.resolve(root, "..", "outside.mp4");
    assert.throws(() => validateReferenceIndex(escaped), /sob a raiz registrada/);

    const pathMismatchWithFreshFingerprint = refreshIndexFingerprint(structuredClone(index));
    pathMismatchWithFreshFingerprint.videos[0].path = path.resolve(root, "nested", "different.mp4");
    assert.throws(() => validateReferenceIndex(pathMismatchWithFreshFingerprint), /corresponder ao relativePath/);

    const contentTamper = structuredClone(index);
    contentTamper.videos[0].sizeBytes += 1;
    assert.throws(() => validateReferenceIndex(contentTamper), /fingerprint diverge/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejeita autorização manual ou adulterada mesmo quando o atacante recalcula o ID local", async () => {
  const { directory, index } = await fixture();
  try {
    const context = {
      index,
      reference: "aftermagics-1780457769000.mp4",
      actor: "Ana",
      scope: "film:piloto-controlado",
      role: "edit-source-video",
      operation: "edit",
      confirmed: true,
      issuedAt: new Date("2026-07-23T18:30:00.000Z"),
      expiresAt: new Date("2026-07-23T20:30:00.000Z"),
    };
    const authorization = createProviderInputAuthorization(context);

    const alteredBody = structuredClone(authorization);
    alteredBody.note = "alteração manual";
    assert.throws(() => validateProviderInputAuthorization(alteredBody), /id diverge do corpo/);
    await assert.rejects(
      () => writeProviderInputAuthorization(path.join(directory, "invalid.json"), alteredBody),
      /id diverge do corpo/,
    );
    const manualFile = path.join(directory, "manual.json");
    await writeFile(manualFile, `${JSON.stringify(alteredBody)}\n`);
    await assert.rejects(
      () => readProviderInputAuthorization(manualFile),
      /id diverge do corpo/,
    );

    const inventedClaim = refreshAuthorizationId(structuredClone(authorization));
    inventedClaim.signature = "não existe";
    assert.throws(() => validateProviderInputAuthorization(inventedClaim), /inesperados: signature/);

    const missingActor = structuredClone(authorization);
    delete missingActor.actor;
    assert.throws(() => validateProviderInputAuthorization(missingActor), /ausentes: actor/);

    const wrongIndex = refreshAuthorizationId(structuredClone(authorization));
    wrongIndex.reference.indexFingerprint = "b".repeat(64);
    refreshAuthorizationId(wrongIndex);
    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization: wrongIndex,
      reference: context.reference,
      scope: context.scope,
      role: context.role,
      operation: context.operation,
      now: new Date("2026-07-23T19:00:00.000Z"),
    }), /fingerprint atual do índice/);

    const wrongRoot = structuredClone(authorization);
    wrongRoot.reference.libraryRoot = path.dirname(index.root);
    wrongRoot.reference.relativePath = `${path.basename(index.root)}/${wrongRoot.reference.relativePath}`;
    refreshAuthorizationId(wrongRoot);
    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization: wrongRoot,
      reference: context.reference,
      scope: context.scope,
      role: context.role,
      operation: context.operation,
      now: new Date("2026-07-23T19:00:00.000Z"),
    }), /raiz atual da biblioteca/);

    const wrongReference = structuredClone(authorization);
    wrongReference.reference = {
      ...wrongReference.reference,
      path: index.videos[1].path,
      relativePath: index.videos[1].relativePath,
      sha256: index.videos[1].sha256,
    };
    refreshAuthorizationId(wrongReference);
    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization: wrongReference,
      reference: context.reference,
      scope: context.scope,
      role: context.role,
      operation: context.operation,
      now: new Date("2026-07-23T19:00:00.000Z"),
    }), /caminho e SHA-256 atuais/);

    const wrongHash = structuredClone(authorization);
    wrongHash.reference.sha256 = "f".repeat(64);
    refreshAuthorizationId(wrongHash);
    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization: wrongHash,
      reference: context.reference,
      scope: context.scope,
      role: context.role,
      operation: context.operation,
      now: new Date("2026-07-23T19:00:00.000Z"),
    }), /caminho e SHA-256 atuais/);

    for (const [field, expected, forged] of [
      ["scope", context.scope, "film:outro"],
      ["role", context.role, "visual-reference"],
      ["operation", context.operation, "generate"],
    ]) {
      const wrongContext = structuredClone(authorization);
      wrongContext[field] = forged;
      refreshAuthorizationId(wrongContext);
      assert.throws(() => assertProviderInputAuthorized({
        index,
        authorization: wrongContext,
        reference: context.reference,
        scope: field === "scope" ? expected : context.scope,
        role: field === "role" ? expected : context.role,
        operation: field === "operation" ? expected : context.operation,
        now: new Date("2026-07-23T19:00:00.000Z"),
      }), new RegExp(`não cobre ${field}`));
    }

    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization,
      reference: context.reference,
      scope: context.scope,
      role: context.role,
      operation: context.operation,
      now: new Date("2026-07-23T18:00:00.000Z"),
    }), /ainda não entrou em validade/);
    assert.throws(() => assertProviderInputAuthorized({
      index,
      authorization,
      reference: context.reference,
      scope: context.scope,
      role: context.role,
      operation: context.operation,
      now: new Date("2026-07-23T20:30:00.000Z"),
    }), /expirou/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("lint anti-imitação rejeita fórmulas, handles e nomes de criadores da biblioteca", async () => {
  const { directory, index } = await fixture();
  try {
    assert.deepEqual(deriveCreatorIdentifiers(index), ["aftermagics"]);
    assert.equal(lintPromptForImitation(
      "Movimento abstrato com trilhas de luz, easing suave e composição original.",
      { referenceIndex: index },
    ).valid, true);

    const english = lintPromptForImitation("Make it in the style of Jane Doe.", { creatorNames: ["Jane Doe"] });
    assert.equal(english.valid, false);
    assert.deepEqual(new Set(english.violations.map((item) => item.code)), new Set(["imitation-phrase-en", "creator-name"]));

    const portuguese = lintPromptForImitation("Faça no estilo de @motion_master.");
    assert.equal(portuguese.valid, false);
    assert.deepEqual(new Set(portuguese.violations.map((item) => item.code)), new Set(["imitation-phrase-pt", "creator-handle"]));

    const libraryName = lintPromptForImitation("Use a estética aftermagics como referência.", { referenceIndex: index });
    assert.equal(libraryName.valid, false);
    assert.equal(libraryName.violations[0].code, "creator-name");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
