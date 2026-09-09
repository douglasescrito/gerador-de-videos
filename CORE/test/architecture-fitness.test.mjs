import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const boundariesFile = path.join(coreRoot, "docs", "ARCHITECTURE-BOUNDARIES.md");

function normalized(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function extractManifest(markdown) {
  const match = markdown.match(
    /<!-- architecture-fitness-manifest:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- architecture-fitness-manifest:end -->/,
  );
  assert.ok(match, "Manifesto executável não encontrado em ARCHITECTURE-BOUNDARIES.md.");
  const manifest = JSON.parse(match[1]);
  assert.equal(manifest.schema, "mkt-videos/architecture-boundaries@1");
  return manifest;
}

function importedSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[^"'`;]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function sourceFiles(root, extension) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute);
  }
  return files;
}

test("analisador reconhece import, reexport e carregamento dinâmico literais", () => {
  const source = [
    'import "./side-effect.mjs";',
    'import { a } from "./static.mjs";',
    'export { b } from "./reexport.mjs";',
    'const dynamic = await import("./dynamic.mjs");',
  ].join("\n");
  assert.deepEqual(
    importedSpecifiers(source).sort(),
    ["./dynamic.mjs", "./reexport.mjs", "./side-effect.mjs", "./static.mjs"],
  );
});

test("manifesto de boundaries é válido e aponta somente para componentes existentes", async () => {
  const manifest = extractManifest(await readFile(boundariesFile, "utf8"));
  assert.equal(
    manifest.status,
    "phase-10-decision-shadow-console",
  );
  assert.equal(manifest.revision, 35);
  assert.ok(manifest.decisionRefs.length >= 34);

  for (const reference of manifest.decisionRefs) {
    assert.equal((await stat(path.join(coreRoot, reference))).isFile(), true, `ADR ausente: ${reference}`);
  }
  for (const component of manifest.canonicalComponents) {
    assert.equal(
      (await stat(path.join(coreRoot, component.path))).isFile(),
      true,
      `Componente canônico ausente (${component.role}): ${component.path}`,
    );
  }
});

test("regras estáticas de dependência preservam raw e compilador canônico", async () => {
  const manifest = extractManifest(await readFile(boundariesFile, "utf8"));

  for (const rule of manifest.staticDependencyRules) {
    for (const subject of rule.subjects) {
      const source = await readFile(path.join(coreRoot, subject), "utf8");
      const imports = importedSpecifiers(source);
      for (const forbidden of rule.forbiddenImportPatterns) {
        const pattern = new RegExp(forbidden);
        const violation = imports.find((specifier) => pattern.test(specifier.replaceAll("\\", "/")));
        assert.equal(
          violation,
          undefined,
          `${rule.id}: ${subject} importa dependência proibida ${violation ?? ""}`,
        );
      }
    }
  }
});

test("módulos de conhecimento permanecem provider-free e isolam o owner SQLite", async () => {
  const manifest = extractManifest(await readFile(boundariesFile, "utf8"));

  for (const rule of manifest.scopedDependencyRules) {
    const files = await sourceFiles(path.join(coreRoot, rule.searchRoot), ".mjs");
    const subjectPattern = new RegExp(rule.subjectPattern);
    const subjects = files.filter((file) => subjectPattern.test(normalized(path.relative(coreRoot, file))));
    if (!rule.allowNoSubjects) assert.ok(subjects.length, `${rule.id}: nenhum subject encontrado.`);

    for (const file of subjects) {
      const subject = normalized(path.relative(coreRoot, file));
      if (rule.allowedSubjects?.includes(subject)) continue;
      const imports = importedSpecifiers(await readFile(file, "utf8"));
      for (const forbidden of rule.forbiddenImportPatterns) {
        const pattern = new RegExp(forbidden);
        const violation = imports.find((specifier) => pattern.test(specifier.replaceAll("\\", "/")));
        assert.equal(
          violation,
          undefined,
          `${rule.id}: ${subject} importa dependência proibida ${violation ?? ""}`,
        );
      }
    }
  }
});

test("declarações singleton continuam pertencendo aos owners registrados", async () => {
  const manifest = extractManifest(await readFile(boundariesFile, "utf8"));

  for (const singleton of manifest.singletonDeclarations) {
    const searchRoot = path.join(coreRoot, singleton.searchRoot);
    const files = await sourceFiles(searchRoot, singleton.extension);
    const owners = [];
    for (const file of files) {
      if ((await readFile(file, "utf8")).includes(singleton.needle)) {
        owners.push(normalized(path.relative(coreRoot, file)));
      }
    }
    assert.deepEqual(owners, [singleton.owner], `${singleton.id}: owners encontrados ${owners.join(", ")}`);
  }
});
