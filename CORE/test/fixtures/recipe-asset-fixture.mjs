import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Preflight de bytes sobre entradas sintéticas: não lê pessoas ou produções.
// Os contratos de autoria permanecem nos JSON versionados; apenas a cópia
// privada deste teste recebe locators, bytes e hashes dos assets mínimos.
export async function createRecipeAssetFixture(t, sourceFile) {
  const recipe = JSON.parse(await readFile(sourceFile, "utf8"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "recipe-assets-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await mkdir(path.join(workspaceRoot, "fixtures"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64");
  for (const [index, asset] of recipe.assets.entries()) {
    if (asset.source.kind !== "workspace") continue;
    if (!["image/png", "text/html"].includes(asset.mimeType)) throw new Error("Fixture exige asset sintético explicitamente suportado.");
    const body = asset.mimeType === "image/png" ? png : Buffer.from("<!doctype html><title>Fixture</title><p>Texto sintético</p>");
    // O modelo público de elenco usa este locator neutro. A imagem sintética
    // existe somente no workspace temporário, nunca na pasta oficial.
    asset.source.locator = asset.role === "person-reference" ? "PESSOAS/apresentador.png"
      : `fixtures/asset-${index}.${asset.mimeType === "image/png" ? "png" : "html"}`;
    asset.bytes = body.length;
    asset.sha256 = createHash("sha256").update(body).digest("hex");
    await mkdir(path.dirname(path.join(workspaceRoot, asset.source.locator)), { recursive: true });
    await writeFile(path.join(workspaceRoot, asset.source.locator), body);
  }
  return { recipe, workspaceRoot };
}
