import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { builtinModules } from "node:module";
import path from "node:path";
import { parse } from "acorn";
import { runBounded } from "./verification-plan.mjs";

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const opaqueBuiltins = /^(?:fs(?:\/|$)|child_process$|worker_threads$|module$|vm$|http2?$|https$|net$|tls$)/;
const sourceFile = /\.(?:mjs|cjs|js)$/;
const mappedDataFile = /^(?:schemas|knowledge|recipes|styles|test\/fixtures)\/.*\.(?:json|txt|html|css|ass|srt|vtt)$/;
const normalize = (file) => file.replaceAll("\\", "/");
const quote = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const digest = (value) => createHash("sha256").update(value).digest("hex");
const indexSchema = "gerador-de-videos/verification-impact-index@1";

async function dependencyIndex(root, inventory, enabled) {
  const evidence = { enabled, reused: 0, analyzed: 0, loaded: false, rejected: false, published: false };
  let stored = {};
  const entries = {};
  const directory = path.join(root, "diagnosticos", "verificacoes");
  const target = path.join(directory, "impact-index.json");
  let engineHash;
  const inventoryHash = digest(JSON.stringify([...inventory].sort()));
  if (enabled) {
    // Vincula o algoritmo, seu helper, o parser efetivamente carregado e Node.
    // Resultado de teste ou evidência de aprovação nunca entra neste índice.
    const engine = await Promise.all([
      readFile(new URL(import.meta.url)),
      readFile(new URL("./verification-plan.mjs", import.meta.url)),
      readFile(new URL(import.meta.resolve("acorn"))),
    ]);
    engineHash = digest(JSON.stringify([process.version, process.platform, process.arch, ...engine.map(digest)]));
    try {
      const { checksum, ...body } = JSON.parse(await readFile(target, "utf8"));
      if (checksum !== digest(JSON.stringify(body)) || body.schema !== indexSchema || body.engineHash !== engineHash ||
          body.inventoryHash !== inventoryHash || !body.entries || typeof body.entries !== "object" || Array.isArray(body.entries)) {
        evidence.rejected = true;
      } else { stored = body.entries; evidence.loaded = true; }
    } catch (error) { if (error.code !== "ENOENT") evidence.rejected = true; }
  }
  return {
    evidence,
    inspect(file, source) {
      const sourceHash = digest(source);
      const entry = stored[file];
      const valid = entry?.sourceHash === sourceHash && Array.isArray(entry.dependencies) && Array.isArray(entry.unknown) &&
        entry.dependencies.every((dependency) => typeof dependency === "string" && inventory.has(dependency)) &&
        entry.unknown.every((reason) => typeof reason === "string");
      let node;
      if (valid) {
        evidence.reused++;
        node = { dependencies: [...entry.dependencies], unknown: [...entry.unknown] };
      } else {
        evidence.analyzed++;
        node = inspectSource(file, source.toString("utf8"), inventory);
      }
      entries[file] = { sourceHash, ...node };
      return node;
    },
    async publish() {
      if (!enabled) return;
      const body = { schema: indexSchema, engineHash, inventoryHash,
        entries: Object.fromEntries(Object.keys(entries).sort().map((file) => [file, entries[file]])) };
      const temporary = path.join(directory, `.impact-index-${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(temporary, JSON.stringify({ ...body, checksum: digest(JSON.stringify(body)) }), { flag: "wx" });
        await rename(temporary, target);
        evidence.published = true;
      } catch (error) {
        // Índice opcional: perder cache não altera a análise feita nesta rodada.
        evidence.publicationError = typeof error.code === "string" ? error.code : "index-publication-failed";
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}

function inspectSource(file, source, inventory) {
  const dependencies = new Set();
  const unknown = new Set();
  const filesystemImports = new Map();
  const localPath = (specifier) => {
    try { return path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(specifier.split(/[?#]/, 1)[0]))); }
    catch { unknown.add("invalid-module-url"); return null; }
  };
  const addSpecifier = (specifier, declaration = null) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const dependency = localPath(specifier);
      if (dependency && inventory.has(dependency)) dependencies.add(dependency);
      else unknown.add("unresolved-local-import");
      return;
    }
    const builtin = specifier.replace(/^node:/, "");
    if (builtins.has(builtin)) {
      if (opaqueBuiltins.test(builtin)) unknown.add(`opaque-builtin:${builtin}`);
      if (builtin === "fs" || builtin === "fs/promises") {
        const uses = filesystemImports.get(builtin) ?? [];
        uses.push(declaration);
        filesystemImports.set(builtin, uses);
      }
    } else unknown.add("external-or-absolute-import");
  };
  const addImport = (node, declaration = null) => {
    if (node?.type === "Literal" && typeof node.value === "string") return addSpecifier(node.value, declaration);
    if (node?.type === "TemplateLiteral" && node.quasis.every((part) => part.value.cooked !== null)) {
      const pieces = node.quasis.map((part) => part.value.cooked);
      if (!node.expressions.length) return addSpecifier(pieces[0]);
      // Vínculo de registry/handlers: expande o template sobre o inventário
      // atual, sem avaliar JS nem importar handlers ou adapters.
      if (/^\.\.?\//.test(pieces[0])) {
        const prefix = localPath(pieces[0]);
        if (prefix) {
          // posix.normalize remove a barra final; ela pertence ao template.
          const first = prefix + (pieces[0].endsWith("/") && !prefix.endsWith("/") ? "/" : "");
          const pattern = new RegExp("^" + [first, ...pieces.slice(1)].map(quote).join(".*") + "$");
          const matches = [...inventory].filter((candidate) => pattern.test(candidate));
          for (const candidate of matches) dependencies.add(candidate);
          if (matches.length) {
            // Uma expressão ainda pode produzir ../ ou um caminho externo.
            // O inventário explica os vínculos possíveis, sem alegar que
            // restringe os valores que o código executado pode calcular.
            unknown.add("dynamic-import-template");
            return;
          }
        }
      }
    }
    unknown.add("unresolved-dynamic-import");
  };
  let ast;
  try { ast = parse(source, { ecmaVersion: "latest", sourceType: file.endsWith(".cjs") ? "script" : "module", allowHashBang: true }); }
  catch { return { dependencies: [], unknown: ["unsupported-or-invalid-syntax"] }; }
  const literal = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value
    : node?.type === "TemplateLiteral" && !node.expressions.length ? node.quasis[0].value.cooked : null;
  const moduleUrlPath = (node) => {
    if (node?.type !== "NewExpression" || node.callee?.type !== "Identifier" || node.callee.name !== "URL" || node.arguments.length !== 2) return null;
    const specifier = literal(node.arguments[0]);
    const base = node.arguments[1];
    if (!specifier || !/^\.\.?\//.test(specifier) || base?.type !== "MemberExpression" || base.computed ||
        base.property?.name !== "url" || base.object?.type !== "MetaProperty" || base.object.meta.name !== "import" || base.object.property.name !== "meta") return null;
    const dependency = localPath(specifier);
    return dependency && inventory.has(dependency) ? dependency : null;
  };
  const nodes = [];
  const pending = [{ node: ast, parent: null }];
  while (pending.length) {
    const { node, parent } = pending.pop();
    nodes.push({ node, parent });
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration" && node.source) addImport(node.source, node.type === "ImportDeclaration" ? node : null);
    if (node.type === "ImportExpression") addImport(node.source);
    const resource = moduleUrlPath(node);
    if (resource) dependencies.add(resource);
    if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require") addImport(node.arguments[0]);
    if (node.type === "CallExpression" && node.callee?.type === "MemberExpression") {
      const member = node.callee.computed ? node.callee.property?.value : node.callee.property?.name;
      if (["require", "getBuiltinModule", "binding", "createRequire"].includes(member)) unknown.add("indirect-module-loader");
    }
    if ((node.type === "CallExpression" || node.type === "NewExpression") && node.callee?.type === "Identifier" && ["eval", "Function"].includes(node.callee.name)) unknown.add("evaluated-code");
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value.filter((entry) => entry && typeof entry.type === "string").map((child) => ({ node: child, parent: node })));
      else if (value && typeof value === "object" && typeof value.type === "string") pending.push({ node: value, parent: node });
    }
  }
  // Só fecha a incerteza de fs quando cada binding é uma leitura direta de
  // URL literal deste módulo. Captura, alias, namespace, shadowing, require,
  // caminho calculado ou outra API conservam o comportamento abrangente.
  const unambiguousUrl = nodes.every(({ node, parent }) => node.type !== "Identifier" || node.name !== "URL" ||
    parent?.type === "NewExpression" && parent.callee === node);
  // Strings const são imutáveis; objetos URL guardados em variáveis não são.
  // Resolver somente bindings únicos evita interpretar parâmetros/sombras como
  // o const/import de módulo. Nunca avaliar funções ou caminhos do ambiente.
  const bindings = new Map();
  const bind = (pattern) => {
    if (!pattern) return;
    if (pattern.type === "Identifier") bindings.set(pattern.name, (bindings.get(pattern.name) ?? 0) + 1);
    else if (pattern.type === "RestElement") bind(pattern.argument);
    else if (pattern.type === "AssignmentPattern") bind(pattern.left);
    else if (pattern.type === "ArrayPattern") pattern.elements.forEach(bind);
    else if (pattern.type === "ObjectPattern") pattern.properties.forEach((item) => bind(item.type === "RestElement" ? item.argument : item.value));
  };
  for (const { node } of nodes) {
    if (node.type === "VariableDeclarator") bind(node.id);
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) { bind(node.id); node.params.forEach(bind); }
    if (/^(?:ClassDeclaration|ClassExpression)$/.test(node.type)) bind(node.id);
    if (node.type === "CatchClause") bind(node.param);
    if (/^Import(?:Default|Namespace)?Specifier$/.test(node.type)) bind(node.local);
  }
  const constants = new Map();
  const pathImports = new Map();
  const parents = new Map(nodes.map(({ node, parent }) => [node, parent]));
  const immutableModuleBase = nodes.every(({ node, parent }) => {
    if (node.type !== "MetaProperty" || node.meta.name !== "import") return true;
    if (parent?.type !== "MemberExpression" || parent.computed || !["url", "dirname"].includes(parent.property.name)) return false;
    const use = parents.get(parent);
    return !(use?.type === "AssignmentExpression" && use.left === parent || use?.type === "UpdateExpression" || use?.type === "UnaryExpression" && use.operator === "delete");
  });
  for (const statement of ast.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "VariableDeclaration" && declaration.kind === "const") {
      for (const item of declaration.declarations) if (item.id.type === "Identifier" && bindings.get(item.id.name) === 1) constants.set(item.id.name, item.init);
    }
    if (statement.type !== "ImportDeclaration") continue;
    const builtin = statement.source.value.replace(/^node:/, "");
    for (const specifier of statement.specifiers) {
      if (bindings.get(specifier.local.name) !== 1) continue;
      const imported = specifier.imported?.name;
      if (builtin === "url" && imported === "fileURLToPath" || builtin === "path" && ["join", "resolve"].includes(imported)) {
        const onlyCalls = nodes.every(({ node, parent }) => node.type !== "Identifier" || node.name !== specifier.local.name ||
          node.start >= statement.start && node.end <= statement.end || parent?.type === "CallExpression" && parent.callee === node);
        if (onlyCalls) pathImports.set(specifier.local.name, imported);
      }
      if (builtin === "path" && ["ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(specifier.type)) {
        const onlyCalls = nodes.every(({ node, parent }) => node.type !== "Identifier" || node.name !== specifier.local.name ||
          node.start >= statement.start && node.end <= statement.end || parent?.type === "MemberExpression" && parent.object === node && !parent.computed &&
          ["join", "resolve"].includes(parent.property.name) && parents.get(parent)?.type === "CallExpression" && parents.get(parent).callee === parent);
        if (onlyCalls) pathImports.set(specifier.local.name, "namespace");
      }
    }
  }
  const anchoredPath = (node, seen = new Set()) => {
    if (!node || !immutableModuleBase) return null;
    if (node.type === "Identifier" && constants.has(node.name) && !seen.has(node.name)) return anchoredPath(constants.get(node.name), new Set([...seen, node.name]));
    if (node.type === "MemberExpression" && !node.computed && node.property?.name === "dirname" && node.object?.type === "MetaProperty" &&
        node.object.meta.name === "import" && node.object.property.name === "meta") return path.posix.dirname(file);
    if (node.type !== "CallExpression") return null;
    const callee = node.callee;
    const operation = callee.type === "Identifier" ? pathImports.get(callee.name)
      : callee.type === "MemberExpression" && !callee.computed && pathImports.get(callee.object?.name) === "namespace" ? callee.property.name : null;
    if (operation === "fileURLToPath" && node.arguments.length === 1 && unambiguousUrl) return moduleUrlPath(node.arguments[0]);
    if (!["join", "resolve"].includes(operation) || node.arguments.length < 1) return null;
    const base = anchoredPath(node.arguments[0], seen);
    const parts = node.arguments.slice(1).map(literal);
    if (base === null || parts.some((part) => part === null || part.includes("\\") || path.posix.isAbsolute(part) || /^[a-z]:/i.test(part))) return null;
    const result = path.posix.normalize(path.posix.join(base, ...parts));
    return result === ".." || result.startsWith("../") ? null : result;
  };
  const resourcePath = (node) => {
    const candidate = moduleUrlPath(node) ?? anchoredPath(node);
    return candidate && inventory.has(candidate) ? candidate : null;
  };
  for (const { node } of nodes) {
    const dependency = resourcePath(node);
    if (dependency) dependencies.add(dependency);
  }
  for (const [builtin, declarations] of filesystemImports) {
    if (!unambiguousUrl || !immutableModuleBase || declarations.some((declaration) => !declaration || !declaration.specifiers.length)) continue;
    const precise = declarations.every((declaration) => declaration.specifiers.every((specifier) => {
      if (specifier.type !== "ImportSpecifier" || !["readFile", "readFileSync"].includes(specifier.imported.name) ||
          builtin === "fs/promises" && specifier.imported.name !== "readFile") return false;
      return nodes.every(({ node, parent }) => {
        if (node.type !== "Identifier" || node.name !== specifier.local.name || node.start >= declaration.start && node.end <= declaration.end) return true;
        return parent?.type === "CallExpression" && parent.callee === node && Boolean(resourcePath(parent.arguments[0]));
      });
    }));
    if (precise) unknown.delete(`opaque-builtin:${builtin}`);
  }
  return { dependencies: [...dependencies].sort(), unknown: [...unknown].sort() };
}

/** Análise estática, sem executar código do workspace ou reaproveitar aprovação. */
export async function buildVerificationImpact({ root, inventory, changed, testFiles, cache = false }) {
  const started = performance.now();
  const knownFiles = new Set(inventory.map(normalize));
  const changes = [...new Set(changed.map(normalize))].sort();
  const tests = [...new Set(testFiles.map(normalize))].sort();
  const result = { schema: "gerador-de-videos/verification-impact@1", files: [], reasons: [], fallbackReasons: [],
    limitation: "Seleção parcial. Imports e URLs literais locais têm vínculos explícitos; leituras diretas de fs só deixam de ser incertas quando todos os bindings são resolvidos. Demais consumidores de filesystem, subprocessos, loaders, pacotes externos ou imports irresolvidos são incluídos conservadoramente; não há cache de aprovação." };
  if (!changes.length) result.fallbackReasons.push("no-changes");
  for (const file of changes) {
    if (!knownFiles.has(file)) result.fallbackReasons.push(`removed-or-unlisted:${file}`);
    else if (!sourceFile.test(file) && !mappedDataFile.test(file)) result.fallbackReasons.push(`data-or-configuration:${file}`);
    else if (/^scripts\/(?:run-verification|verification-[^/]+)\.mjs$/.test(file) || /^test\/(?:test-environment|subprocess-profile|filesystem-profile|verification-resource-guard)\.mjs$/.test(file)) result.fallbackReasons.push(`verification-infrastructure:${file}`);
  }
  await runBounded(changes.filter((file) => mappedDataFile.test(file) && knownFiles.has(file)), 8, async (file) => {
    try { if (!(await stat(path.join(root, file))).isFile()) result.fallbackReasons.push(`data-not-file:${file}`); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      result.fallbackReasons.push(`data-disappeared:${file}`);
    }
  });
  const sources = [...knownFiles].filter((file) => sourceFile.test(file) && /^(?:lib|scripts|test)\//.test(file)).sort();
  const nodes = new Map();
  let index;
  // Analisar também mudanças produtivas fora das raízes conhecidas nunca
  // reduz escopo: o runner completo continua sendo o fallback.
  for (const file of changes) if (sourceFile.test(file) && !sources.includes(file)) result.fallbackReasons.push(`unmapped-source-root:${file}`);
  if (!result.fallbackReasons.length) {
    index = await dependencyIndex(root, knownFiles, cache);
    await runBounded(sources, 8, async (file) => {
      let node;
      try { node = index.inspect(file, await readFile(path.join(root, file))); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        result.fallbackReasons.push(`source-disappeared:${file}`);
        node = { dependencies: [], unknown: ["source-disappeared"] };
      }
      nodes.set(file, node);
    });
    const covered = new Set();
    for (const test of tests) {
      const routes = new Map([[test, [test]]]);
      const queue = [test];
      const uncertainties = [];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const file = queue[cursor];
        const node = nodes.get(file);
        if (!node) { uncertainties.push({ file, reasons: ["unmapped-source"] }); continue; }
        if (node.unknown.length) uncertainties.push({ file, reasons: node.unknown });
        for (const dependency of node.dependencies) {
          if (routes.has(dependency)) continue;
          routes.set(dependency, [...routes.get(file), dependency]);
          if (sourceFile.test(dependency)) queue.push(dependency);
        }
      }
      const dependencies = changes.filter((file) => routes.has(file)).map((file) => ({ changed: file, path: routes.get(file) }));
      dependencies.forEach(({ changed: file }) => covered.add(file));
      if (dependencies.length || uncertainties.length) {
        result.files.push(test);
        result.reasons.push({ file: test, dependencies, uncertainties: uncertainties.sort((a, b) => a.file.localeCompare(b.file)) });
      }
    }
    for (const file of changes) if (!covered.has(file)) result.fallbackReasons.push(`no-known-test-consumer:${file}`);
    if (!result.fallbackReasons.length) await index.publish();
  }
  result.fallbackReasons.sort();
  result.status = result.fallbackReasons.length ? "full-required" : "partial-selection";
  if (result.fallbackReasons.length) result.files = tests;
  result.statistics = { sourceFiles: sources.length, analyzedFiles: nodes.size, selectedFiles: result.files.length, totalTestFiles: tests.length, durationMs: Math.round(performance.now() - started) };
  result.index = index?.evidence ?? { enabled: cache, reused: 0, analyzed: 0, loaded: false, rejected: false, published: false };
  return result;
}
