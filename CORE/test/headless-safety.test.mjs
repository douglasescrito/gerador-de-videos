import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  cleanupHeadlessResources,
  loadHarCookies,
  loadCookieTableCookies,
  sanitizeSensitiveText,
  sanitizedPostData,
  sanitizedUrl,
  sourceFileNameFromTreeItem,
} from "../scripts/ai-studio-headless.mjs";
import {
  assertOutputsAvailable,
  buildImageBrowserRequest,
  buildVideoBrowserRequest,
  commitNewFileAtomically,
  requireSuccessfulVideoPayload,
  validateMp4Download,
} from "../scripts/omni-product-studio-submit.mjs";

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function box(type, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, "ascii");
  payload.copy(value, 8);
  return value;
}

function mp4() {
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isom")), box("mdat", Buffer.from("video"))]);
}

test("inspeção headless omite POST não JSON e redige URLs e textos sensíveis", () => {
  const raw = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz";
  assert.equal(sanitizedPostData({ postData: () => raw }), `<non-JSON body omitted: ${raw.length} chars>`);
  assert.deepEqual(
    sanitizedPostData({ postData: () => JSON.stringify({ token: "secret-value", safe: "ok" }) }),
    { token: "<redacted>", safe: "ok" },
  );
  assert.equal(sanitizedUrl("https://example.test/token/private-value?api_key=secret#fragment"), "https://example.test/token/<redacted>");
  assert.equal(sanitizedUrl("https://example.test/users/296bff62-801a-4291-81a8-47c95652079a/playlists"), "https://example.test/users/<redacted-id>/playlists");
  const syntheticGoogleKey = `AI${"za"}${"A".repeat(32)}`;
  const sanitized = sanitizeSensitiveText(`Authorization='Bearer abcdefghijklmnopqrstuvwxyz' apiKey=${syntheticGoogleKey}`);
  assert.doesNotMatch(sanitized, /abcdefghijklmnopqrstuvwxyz/i);
  assert.doesNotMatch(sanitized, /AIza/);
});

test("cleanup tenta todos os recursos, apaga perfil e zera cookies mesmo se close falha", async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "headless-cleanup-test-"));
  t.after(() => rm(profile, { recursive: true, force: true }));
  await writeFile(path.join(profile, "Cookies"), "secret");
  const calls = [];
  const cookies = [{ name: "SID", value: "secret" }];
  const errors = await cleanupHeadlessResources({
    context: { async close() { calls.push("context"); throw new Error("context close failed"); } },
    browser: { async close() { calls.push("browser"); } },
    temporaryProfile: profile,
    credentialCookies: cookies,
  });
  assert.deepEqual(calls, ["context", "browser"]);
  assert.equal(errors.length, 1);
  assert.equal(await exists(profile), false);
  assert.deepEqual(cookies, []);
});

test("HAR importa somente cookies Google e não reaproveita cabeçalhos sensíveis", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "headless-har-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.har");
  await writeFile(file, JSON.stringify({
    log: {
      entries: [{
        request: {
          url: "https://aistudio.google.com/generate-speech",
          headers: [
            { name: "authorization", value: "Bearer must-not-be-imported" },
            { name: "x-goog-api-key", value: "must-not-be-imported" },
          ],
          cookies: [
            { name: "SID", value: "google-session", domain: ".google.com", path: "/", httpOnly: true },
            { name: "AEC", value: "aistudio-session", path: "/", secure: true, sameSite: "Lax" },
            { name: "foreign", value: "ignore", domain: ".example.test", path: "/" },
          ],
        },
      }],
    },
  }));
  const cookies = await loadHarCookies(file);
  assert.deepEqual(cookies.map(({ name, domain, sameSite }) => ({ name, domain, sameSite })), [
    { name: "SID", domain: ".google.com", sameSite: undefined },
    { name: "AEC", domain: "aistudio.google.com", sameSite: "Lax" },
  ]);
  assert.doesNotMatch(JSON.stringify(cookies), /must-not-be-imported|foreign/);
});

test("tabela do Chrome aceita somente cookies Google e Flow Music", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "headless-cookie-table-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "cookies.txt");
  await writeFile(file, [
    "SID google-secret .google.com / 2027-08-21T14:05:01.499Z 10 ✓ ✓ High",
    "sb-sb-auth-token.0 flow-secret .flowmusic.app / 2027-08-21T14:05:01.499Z 10 ✓ Lax High",
    "foreign reject-me .example.test / 2027-08-21T14:05:01.499Z 10 ✓",
  ].join("\n"));
  const cookies = await loadCookieTableCookies(file);
  assert.deepEqual(cookies.map(({ name, domain }) => ({ name, domain })), [
    { name: "SID", domain: ".google.com" },
    { name: "sb-sb-auth-token.0", domain: ".flowmusic.app" },
  ]);
  assert.doesNotMatch(JSON.stringify(cookies), /reject-me/);
});

test("inspeção reconhece arquivos no treeitem mesmo com ícones e ações", () => {
  assert.equal(sourceFileNameFromTreeItem("segment\nsrc/services/genaiService.ts\nmore_vert"), "src/services/genaiService.ts");
  assert.equal(sourceFileNameFromTreeItem("draft\n.env.example\nmore_vert"), ".env.example");
  assert.equal(sourceFileNameFromTreeItem("folder\nsrc"), null);
});

test("builders headless preservam contratos de imagem e vídeo sem carregar credenciais", () => {
  const image = { mimeType: "image/png", data: "AA==" };
  assert.deepEqual(buildImageBrowserRequest({ prompt: "  literal  ", images: [image] }), {
    prompt: "literal",
    productImages: [image],
    model: "gemini-3.1-flash-image",
    aspectRatio: "1:1",
    imageSize: "2K",
  });
  assert.deepEqual(buildVideoBrowserRequest({ prompt: "animar", images: [image], task: "image_to_video" }), {
    prompt: "animar",
    aspectRatio: "16:9",
    task: "image_to_video",
    productImages: [image],
  });
  const referenceVideo = { mimeType: "video/mp4", data: "AA==" };
  assert.deepEqual(buildVideoBrowserRequest({ prompt: "editar", referenceVideo, task: "edit" }), {
    prompt: "editar",
    aspectRatio: "16:9",
    referenceVideo,
  });
  assert.deepEqual(buildVideoBrowserRequest({ prompt: "gerar", task: "text_to_video", model: "gemini-omni-flash-preview" }), {
    prompt: "gerar",
    aspectRatio: "16:9",
    model: "gemini-omni-flash-preview",
    task: "text_to_video",
  });
  assert.throws(() => buildVideoBrowserRequest({ prompt: "inválido", task: "text_to_video", images: [image] }), /não aceita/);
});

test("submit exige resposta de vídeo bem-sucedida com fileId", () => {
  assert.throws(() => requireSuccessfulVideoPayload(false, 500, { fileId: "x" }), /HTTP 500/);
  assert.throws(() => requireSuccessfulVideoPayload(true, 200, {}), /não retornou fileId/);
  assert.equal(requireSuccessfulVideoPayload(true, 200, { fileId: "file-1" }), "file-1");
});

test("submit valida MP4 e faz commit novo sem sobrescrever nem deixar temporário", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "headless-submit-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const receipt = path.join(directory, "result.json");
  const output = path.join(directory, "result.mp4");
  const video = mp4();

  assert.deepEqual(validateMp4Download({
    buffer: video,
    contentType: "video/mp4; charset=binary",
    reportedBytes: video.length,
    contentLength: String(video.length),
  }), { bytes: video.length, contentType: "video/mp4" });
  assert.throws(() => validateMp4Download({ buffer: video, contentType: "text/html" }), /Content-Type incompatível/);
  assert.throws(() => validateMp4Download({ buffer: Buffer.from("not-mp4"), contentType: "video/mp4" }), /assinatura ftyp/);
  assert.throws(() => validateMp4Download({ buffer: video, contentType: "video/mp4", contentLength: video.length + 1 }), /Content-Length divergente/);

  await assertOutputsAvailable(receipt, output);
  await commitNewFileAtomically(output, video, "MP4");
  assert.deepEqual(await readFile(output), video);
  await assert.rejects(commitNewFileAtomically(output, Buffer.from("replacement"), "MP4"), /não será sobrescrito/);
  assert.deepEqual(await readFile(output), video);

  const racingOutput = path.join(directory, "racing.mp4");
  const racing = await Promise.allSettled([
    commitNewFileAtomically(racingOutput, Buffer.from("first"), "MP4"),
    commitNewFileAtomically(racingOutput, Buffer.from("second"), "MP4"),
  ]);
  assert.equal(racing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(racing.filter((result) => result.status === "rejected").length, 1);
  assert.ok(["first", "second"].includes(await readFile(racingOutput, "utf8")));
  assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
  await assert.rejects(assertOutputsAvailable(receipt, output), /MP4 já existe/);
});
