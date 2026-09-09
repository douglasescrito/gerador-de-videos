import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { createCookieVideoTransport } from "../scripts/cookie-studio-operations.mjs";

function mp4() {
  return Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(40)]);
}

test("transporte cookie-only usa um único generate e devolve bytes sem recibo paralelo", async () => {
  const handles = [];
  let calls = 0;
  const transport = createCookieVideoTransport({
    generate: async (options) => {
      calls += 1;
      await options.onProviderHandle?.({
        attemptId: options.attemptId,
        fileId: "file-cookie",
        interactionId: "interaction-cookie",
      });
      await writeFile(options.outputFile, mp4(), { flag: "wx" });
      return {
        fileId: "file-cookie",
        interactionId: "interaction-cookie",
        startedAt: "2026-07-30T12:00:00.000Z",
        completedAt: "2026-07-30T12:01:00.000Z",
      };
    },
    reconcile: async () => {
      throw new Error("reconcile inesperado");
    },
  });
  const result = await transport.generate({
    prompt: "literal",
    task: "text_to_video",
    aspectRatio: "16:9",
    attemptId: "attempt:cookie",
    onProviderHandle: (value) => handles.push(value),
  });
  assert.equal(calls, 1);
  assert.equal(result.fileId, "file-cookie");
  assert.equal(result.buffer.toString("ascii", 4, 8), "ftyp");
  assert.equal(handles[0].fileId, "file-cookie");
  assert.equal(result.authMode, "windows-credential-manager");
});

test("reconcile do transporte é zero POST e mantém fileId", async () => {
  let generateCalls = 0;
  const transport = createCookieVideoTransport({
    generate: async () => {
      generateCalls += 1;
      throw new Error("generate inesperado");
    },
    reconcile: async ({ fileId, outputFile }) => {
      await writeFile(outputFile, mp4(), { flag: "wx" });
      return { fileId, classification: "ready", checkedAt: "2026-07-30T12:00:00.000Z" };
    },
  });
  const result = await transport.reconcile({ fileId: "known-file" });
  assert.equal(result.zeroPost, true);
  assert.equal(result.fileId, "known-file");
  assert.equal(generateCalls, 0);
});
