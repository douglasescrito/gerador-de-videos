import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDeliveryFilter, DELIVERY_PROFILES, finishVideoRecipe, resolveDeliveryProfile } from "../lib/media-pipeline/delivery-profile.mjs";

test("perfis de entrega distinguem cópia, web e social", () => {
  assert.equal(resolveDeliveryProfile("archive-original").videoCodec, "copy");
  assert.match(buildDeliveryFilter("web-1080p"), /1920:1080/);
  assert.match(buildDeliveryFilter("social-1080x1920"), /1080:1920/);
  assert.deepEqual(Object.keys(DELIVERY_PROFILES), ["archive-original", "web-1080p", "social-1080x1920"]);
});

test("LUT é anexada ao filtro sem remover o perfil", () => {
  const filter = buildDeliveryFilter("web-1080p", { lut: "C:\\LUTs\\calor.cube" });
  assert.match(filter, /unsharp/);
  assert.match(filter, /lut3d/);
  assert.ok(filter.includes("C\\:/LUTs"));
  assert.throws(() => resolveDeliveryProfile("beauty"), /desconhecido/);
});

test("chave de acabamento distingue papel das entradas, LUT, encoder e exigência de integridade", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "delivery-recipe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputFile = path.join(root, "input.mp4");
  const lut = path.join(root, "color.cube");
  // Prova de chave por bytes; a prova do runtime usa MP4 e FFmpeg reais.
  await writeFile(inputFile, "video-content");
  await writeFile(lut, "lut-content");
  const options = { inputFile, lut, profile: "web-1080p" };
  const recipe = await finishVideoRecipe(options);
  assert.deepEqual(recipe.parameters.inputBindings.map(entry => entry.role), ["source-video", "delivery-lut"]);
  const nvenc = await finishVideoRecipe({ ...options, accel: "nvenc", capabilities: { nvenc: { h264: true } } });
  assert.notEqual(nvenc.hash, recipe.hash);
  assert.notEqual((await finishVideoRecipe({ ...options, strict: true })).hash, recipe.hash);
  await writeFile(inputFile, "lut-content");
  await writeFile(lut, "video-content");
  const swapped = await finishVideoRecipe(options);
  assert.deepEqual(swapped.inputHashes, recipe.inputHashes, "o conjunto de hashes é igual após a troca");
  assert.notEqual(swapped.hash, recipe.hash, "papéis distintos não podem trocar de conteúdo silenciosamente");
  await writeFile(inputFile, "video-content");
  await writeFile(lut, "lut-modified");
  assert.notEqual((await finishVideoRecipe(options)).hash, recipe.hash);
  await assert.rejects(finishVideoRecipe({ ...options, accel: "nvenc", capabilities: {} }), /NVENC exigido/);
});
