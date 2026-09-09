import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DIRECT_PROVIDER_INPUT_PERMIT_SCHEMA,
  assertDirectProviderInputPermit,
  assertDirectProviderInputPermitJit,
  createDirectProviderInputPermit,
  createDirectProviderInputPermitFromProductionAuthorization,
  createProductionProviderInputAuthorization,
  projectDirectProviderInputPermit,
  validateDirectProviderInputPermitProjection,
  validateProductionProviderInputAuthorization,
} from "../lib/media-pipeline/direct-provider-input-permit.mjs";

test("autorização única da produção reemite permits efêmeros só para os mesmos hashes", async (context) => {
  const source = await fixture(context);
  const inputs = [{ file: source.image, role: "reference-image", operation: "generate-video" }];
  const authorization = await createProductionProviderInputAuthorization({
    confirmProviderInput: true,
    productionId: "producao-exemplo-v1",
    inputs,
    maxAttempts: 3,
    clock: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  assert.equal(validateProductionProviderInputAuthorization(structuredClone(authorization), {
    expectedProductionId: "producao-exemplo-v1",
  }), true);
  const permit = await createDirectProviderInputPermitFromProductionAuthorization({
    authorization: structuredClone(authorization),
    productionId: "producao-exemplo-v1",
    inputs,
  });
  assert.equal(assertDirectProviderInputPermit(permit, { expectedInputCount: 1 }), permit);
  await writeFile(source.image, Buffer.from("imagem-alterada"));
  await assert.rejects(
    createDirectProviderInputPermitFromProductionAuthorization({
      authorization,
      productionId: "producao-exemplo-v1",
      inputs,
    }),
    /não pertence à autorização/,
  );
  await assert.rejects(
    createDirectProviderInputPermitFromProductionAuthorization({
      authorization,
      productionId: "outra-producao",
      inputs,
    }),
    /outra produção/,
  );
});

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-input-permit-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const image = path.join(root, "frame.png");
  const video = path.join(root, "source.mp4");
  const imageBytes = Buffer.from("provider-input-image");
  const videoBytes = Buffer.from("provider-input-video");
  await Promise.all([
    writeFile(image, imageBytes),
    writeFile(video, videoBytes),
  ]);
  return { root, image, video, imageBytes, videoBytes };
}

test("preflight emite permit efêmero exato e projeção sem path ou mídia", async (context) => {
  const source = await fixture(context);
  const permit = await createDirectProviderInputPermit({
    confirmProviderInput: true,
    invocationId: "invocation-test-001",
    purpose: "batch-video-generation",
    clock: () => new Date("2026-07-24T12:00:00.000Z"),
    inputs: [
      {
        file: source.image,
        role: "reference-image",
        operation: "generate-video",
      },
      {
        file: source.video,
        role: "reference-video",
        operation: "generate-video",
      },
    ],
  });

  assert.equal(permit.schema, DIRECT_PROVIDER_INPUT_PERMIT_SCHEMA);
  assert.equal(permit.version, 1);
  assert.equal(permit.invocationId, "invocation-test-001");
  assert.equal(permit.actor, "local-cli-human");
  assert.equal(permit.purpose, "batch-video-generation");
  assert.equal(permit.authority, "explicit-single-invocation-confirmation");
  assert.equal(permit.reusable, false);
  assert.equal(permit.knowledgeCoreAuthority, false);
  assert.equal(permit.createdAt, "2026-07-24T12:00:00.000Z");
  assert.deepEqual(
    permit.inputs.map(({ inputId, bytes, mimeType, role, operation }) => ({
      inputId,
      bytes,
      mimeType,
      role,
      operation,
    })),
    [
      {
        inputId: "input-001",
        bytes: source.imageBytes.length,
        mimeType: "image/png",
        role: "reference-image",
        operation: "generate-video",
      },
      {
        inputId: "input-002",
        bytes: source.videoBytes.length,
        mimeType: "video/mp4",
        role: "reference-video",
        operation: "generate-video",
      },
    ],
  );
  assert.equal(
    permit.inputs[0].sha256,
    createHash("sha256").update(source.imageBytes).digest("hex"),
  );
  assert.equal(
    permit.inputs[1].sha256,
    createHash("sha256").update(source.videoBytes).digest("hex"),
  );
  assert.match(permit.permitHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(permit), true);
  assert.equal(Object.isFrozen(permit.inputs), true);
  assert.equal(Object.isFrozen(permit.inputs[0]), true);

  assert.equal(
    assertDirectProviderInputPermit(permit, {
      expectedInputCount: 2,
      expectedOperations: "generate-video",
    }),
    permit,
  );
  const projection = projectDirectProviderInputPermit(permit);
  assert.deepEqual(projection, permit);
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /[\\/](frame\.png|source\.mp4)/i);
  assert.doesNotMatch(serialized, /"file"|"path"|"data"|"base64"/i);
  assert.equal(serialized.includes(source.imageBytes.toString("base64")), false);
  assert.equal(
    validateDirectProviderInputPermitProjection(projection, {
      expectedActor: "local-cli-human",
    }),
    true,
  );
});

test("confirmação é boolean true explícito e clone JSON não vira autoridade", async (context) => {
  const { image } = await fixture(context);
  const input = [{
    file: image,
    role: "reference-image",
    operation: "generate-image",
  }];

  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: false,
      inputs: input,
    }),
    /--confirm-provider-input true/,
  );
  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: "true",
      inputs: input,
    }),
    /--confirm-provider-input true/,
  );

  const permit = await createDirectProviderInputPermit({
    confirmProviderInput: true,
    inputs: input,
  });
  const clone = JSON.parse(JSON.stringify(permit));
  assert.equal(validateDirectProviderInputPermitProjection(clone), true);
  assert.throws(
    () => assertDirectProviderInputPermit(clone),
    /não foi emitido pelo preflight desta execução/,
  );
  const extraField = { ...clone, path: "C:\\secret.png" };
  assert.throws(
    () => validateDirectProviderInputPermitProjection(extraField),
    /campos ausentes ou não permitidos/,
  );
  const extraInputField = structuredClone(clone);
  extraInputField.inputs[0].data = "base64";
  assert.throws(
    () => validateDirectProviderInputPermitProjection(extraInputField),
    /campos ausentes ou não permitidos/,
  );
  assert.throws(
    () => assertDirectProviderInputPermit(permit, { expectedInputCount: 2 }),
    /não cobre todas as entradas/,
  );
  assert.throws(
    () => assertDirectProviderInputPermit(permit, {
      expectedOperations: "generate-video",
    }),
    /não cobre a operação/,
  );

  const appPermit = await createDirectProviderInputPermit({
    confirmProviderInput: true,
    actor: "local-app-human",
    inputs: input,
  });
  assert.equal(
    validateDirectProviderInputPermitProjection(appPermit, {
      expectedActor: "local-app-human",
    }),
    true,
  );
  assert.throws(
    () => assertDirectProviderInputPermit(appPermit, {
      expectedActor: "local-cli-human",
    }),
    /não pertence ao actor esperado/,
  );
});

test("preflight falha fechado para arquivo ausente e combinação MIME/role inválida", async (context) => {
  const { root, image, video } = await fixture(context);
  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: true,
      inputs: [{
        file: path.join(root, "missing.png"),
        role: "reference-image",
        operation: "generate-image",
      }],
    }),
    /ENOENT/,
  );
  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: true,
      inputs: [{
        file: video,
        role: "reference-image",
        operation: "generate-video",
      }],
    }),
    /extensão de imagem/,
  );
  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: true,
      inputs: [{
        file: image,
        role: "reference-video",
        operation: "generate-video",
      }],
    }),
    /extensão de vídeo/,
  );
  const empty = path.join(root, "empty.png");
  await writeFile(empty, Buffer.alloc(0));
  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: true,
      inputs: [{
        file: empty,
        role: "reference-image",
        operation: "generate-image",
      }],
    }),
    /está vazia/,
  );
  await assert.rejects(
    createDirectProviderInputPermit({
      confirmProviderInput: true,
      inputs: Array.from({ length: 5 }, () => ({
        file: image,
        role: "reference-image",
        operation: "generate-video",
      })),
    }),
    /1 a 4 entradas/,
  );
});

test("guard JIT bloqueia troca de bytes antes do adapter e valida slice exato", async (context) => {
  const source = await fixture(context);
  const descriptors = [
    {
      file: source.image,
      role: "reference-image",
      operation: "generate-video",
    },
    {
      file: source.video,
      role: "reference-video",
      operation: "generate-video",
    },
  ];
  const permit = await createDirectProviderInputPermit({
    confirmProviderInput: true,
    inputs: descriptors,
  });
  await assertDirectProviderInputPermitJit(permit, descriptors, {
    requireAll: true,
  });
  await assertDirectProviderInputPermitJit(permit, [descriptors[1]], {
    expectedInputIds: ["input-002"],
  });
  await assert.rejects(
    assertDirectProviderInputPermitJit(permit, [descriptors[1]], {
      expectedInputIds: ["input-001"],
    }),
    /não pertence ao permit|fora de ordem/,
  );

  await writeFile(source.image, Buffer.from("changed-after-preflight"));
  let adapterCalls = 0;
  await assert.rejects(
    (async () => {
      await assertDirectProviderInputPermitJit(permit, descriptors, {
        requireAll: true,
      });
      adapterCalls += 1;
    })(),
    /diverge do preflight autorizado/,
  );
  assert.equal(adapterCalls, 0);
});
