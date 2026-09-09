import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalDomainPackHash,
  loadDomainPackCatalog,
} from "../lib/media-pipeline/knowledge-domain-pack-catalog.mjs";
import {
  renderDomainPackCatalogMarkdown,
} from "../lib/media-pipeline/knowledge-domain-pack-docs.mjs";

const CORE_ROOT = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const CATALOG_FILE = path.join(CORE_ROOT, "docs", "KNOWLEDGE-PACKS.md");
const EXPECTED_PACKS = [
  "brand-and-channel@2",
  "commercial-storytelling@1",
  "documentary-practice@1",
  "hybrid-rendering@2",
  "motion-foundations@1",
  "short-film-language@1",
  "sound-and-music@2",
];

test("projeção documenta exatamente os sete packs candidatos", async () => {
  const catalog = await loadDomainPackCatalog({ coreRoot: CORE_ROOT });
  const first = renderDomainPackCatalogMarkdown({ catalog });
  const second = renderDomainPackCatalogMarkdown({ catalog });

  assert.equal(first, second);
  assert.deepEqual(
    catalog.manifest.packs.map((entry) => entry.ref),
    EXPECTED_PACKS,
  );
  assert.deepEqual(
    [...new Set(catalog.manifest.packs.map((entry) => entry.status))],
    ["candidate"],
  );
  assert.match(first, /aprovados: 0; candidatos: 7/);
  assert.match(first, /não podem influenciar retrieval ou planejamento/);
  assert.match(first, /Base epistemológica/);
  assert.match(first, /Atestação/);
});

test("catálogo Markdown versionado é projeção exata dos dados", async () => {
  const catalog = await loadDomainPackCatalog({ coreRoot: CORE_ROOT });
  const expected = renderDomainPackCatalogMarkdown({ catalog });
  const current = await readFile(CATALOG_FILE, "utf8");
  assert.equal(current, expected);
});

test("renderer neutraliza HTML e destinos Markdown vindos dos packs", async () => {
  const catalog = structuredClone(
    await loadDomainPackCatalog({ coreRoot: CORE_ROOT }),
  );
  const pack = catalog.packs[0].document;
  pack.summary =
    "<img src=x onerror=alert(1)> [atalho](javascript:alert(2)) "
    + "\u001b[31m\u202Espoof";
  pack.sources[0].title =
    "fonte ](javascript:alert(3)) <svg onload=alert(4)>";
  pack.sources[0].uri =
    "https://user:super-secret@example.test/source";
  pack.authors[0].name = "**autor** <iframe src=x>";
  const entry = catalog.packs[0];
  entry.contentHash = canonicalDomainPackHash(entry.document);
  const manifestEntry = catalog.manifest.packs.find(
    ({ ref }) => ref === entry.ref,
  );
  manifestEntry.contentHash = entry.contentHash;
  const { manifestHash: _ignored, ...manifestBody } = catalog.manifest;
  catalog.manifest.manifestHash = canonicalDomainPackHash(manifestBody);

  const markdown = renderDomainPackCatalogMarkdown({ catalog });
  assert.doesNotMatch(markdown, /<img|<svg|<iframe/iu);
  assert.doesNotMatch(markdown, /\]\(javascript:/iu);
  assert.match(markdown, /&lt;img/);
  assert.match(markdown, /&lt;svg/);
  assert.match(markdown, /&lt;iframe/);
  assert.doesNotMatch(markdown, /\u001b|\u202E/u);
  assert.doesNotMatch(markdown, /user:super-secret/);
  assert.match(markdown, /destino inválido omitido/);
});

test("renderer rejeita catálogo com conteúdo ou manifest adulterado", async () => {
  const contentTampered = structuredClone(
    await loadDomainPackCatalog({ coreRoot: CORE_ROOT }),
  );
  contentTampered.packs[0].document.summary = "conteúdo adulterado";
  assert.throws(
    () => renderDomainPackCatalogMarkdown({ catalog: contentTampered }),
    /Hash canônico inválido/,
  );

  const manifestTampered = structuredClone(
    await loadDomainPackCatalog({ coreRoot: CORE_ROOT }),
  );
  manifestTampered.manifest.packCount = 6;
  assert.throws(
    () => renderDomainPackCatalogMarkdown({ catalog: manifestTampered }),
    /Hash do manifest/,
  );

  const forgedIdentity = structuredClone(
    await loadDomainPackCatalog({ coreRoot: CORE_ROOT }),
  );
  forgedIdentity.manifest.packs[0].id = "forged";
  {
    const { manifestHash: _ignored, ...body } = forgedIdentity.manifest;
    forgedIdentity.manifest.manifestHash = canonicalDomainPackHash(body);
  }
  assert.throws(
    () => renderDomainPackCatalogMarkdown({ catalog: forgedIdentity }),
    /não corresponde integralmente/,
  );

  const omittedLoadOrder = structuredClone(
    await loadDomainPackCatalog({ coreRoot: CORE_ROOT }),
  );
  omittedLoadOrder.manifest.loadOrder = [];
  {
    const { manifestHash: _ignored, ...body } = omittedLoadOrder.manifest;
    omittedLoadOrder.manifest.manifestHash = canonicalDomainPackHash(body);
  }
  assert.throws(
    () => renderDomainPackCatalogMarkdown({ catalog: omittedLoadOrder }),
    /mesmo conjunto|não corresponde integralmente/,
  );
});
