import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderStyleCatalogMarkdown } from "../lib/media-pipeline/style-catalog.mjs";

const catalogFile = fileURLToPath(new URL("../docs/STYLE-CATALOG.md", import.meta.url));

test("catálogo Markdown é determinístico, ordenado e sinaliza concept como não live", () => {
  const first = renderStyleCatalogMarkdown();
  const second = renderStyleCatalogMarkdown();
  assert.equal(first, second);
  assert.match(first, /Total: 13 estilos; 11 disponíveis para geração live; 0 validados por evidência\./);
  assert.match(first, /`produto\/streaks-de-luz@1` \| Streaks de luz \| `produto` \| `concept` \| não/);
  assert.match(first, /`duelo-de-ditados@1` \| Duelo de Ditados \| `narrative-typography` \| `concept` \| não/);
  assert.match(first, /`aquarela-2d@1` \| Aquarela 2D \| `illustration` \| `pilot` \| sim \| `not-evidence-validated`/);
  assert.match(first, /Evidência de referência: `not-declared`; 0 de 0 qualificadas/);
  assert.match(first, /Campos ausentes: `validation-model`/);
  assert.match(first, /`react-audiovisual@1` \| React audiovisual \| `motion-graphics` \| `pilot` \| sim/);
  assert.ok(first.indexOf("`aquarela-2d@1`") < first.indexOf("`cinematic-3d@1`"));
  assert.ok(first.endsWith("\n"));
});

test("documento versionado não diverge da fonte canônica", async () => {
  assert.equal(await readFile(catalogFile, "utf8"), renderStyleCatalogMarkdown());
});

test("renderer rejeita schema ou IDs duplicados em vez de publicar catálogo ambíguo", () => {
  const valid = {
    schema: "mkt-videos/style-spec@1",
    id: "teste@1",
    label: "Teste",
    family: "teste",
    status: "concept",
    studioOnly: true,
    direction: "Original abstract motion.",
    aspect: null,
    tags: [],
  };
  assert.throws(
    () => renderStyleCatalogMarkdown({ styles: [valid, structuredClone(valid)] }),
    /duplicado/,
  );
  assert.throws(
    () => renderStyleCatalogMarkdown({ styles: [{ ...valid, schema: "outro" }] }),
    /schema/,
  );
});

test("renderer falha fechado se uma entrada externa alegar validated sem prova", () => {
  const invalidClaim = {
    schema: "mkt-videos/style-spec@1",
    id: "sem-prova@1",
    label: "Sem prova",
    family: "teste",
    status: "validated",
    studioOnly: true,
    direction: "Original abstract motion.",
    aspect: null,
    tags: [],
  };
  assert.throws(
    () => renderStyleCatalogMarkdown({ styles: [invalidClaim] }),
    /status validated sem prova/,
  );
});
