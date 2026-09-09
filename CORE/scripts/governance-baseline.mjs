import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { studioLocalPath } from '../lib/studio-local-config.mjs';

const execFileAsync = promisify(execFile);

export const GOVERNANCE_BASELINE_SCHEMA = "mkt-videos/governance-baseline@1";
export const DEFAULT_CORE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_VIDEO_REFS_ROOT = studioLocalPath('referenceRoot') ?? path.resolve(DEFAULT_CORE_ROOT, '..', 'REFERENCIAS', 'VIDEO REFS');

export const DEFAULT_CORE_CONTRACT_FILES = Object.freeze([
  { id: "workspace-policy", scope: "repository", path: "AGENTS.md" },
  { id: "workspace-text-policy", scope: "repository", path: ".gitattributes" },
  { id: "core-package", scope: "core", path: "package.json" },
  { id: "core-package-lock", scope: "core", path: "package-lock.json" },
  { id: "core-readme", scope: "core", path: "README.md" },
  { id: "studio-production-manual", scope: "core", path: "MANUAL-PRODUCAO-DE-PECAS.md" },
  { id: "governance-plan", scope: "core", path: "PLANO-GOVERNANCA-VIDEO-STUDIO.md" },
  { id: "intelligence-evolution-plan", scope: "core", path: "PLANO-EVOLUCAO-VIDEO-STUDIO-INTELIGENTE.md" },
  { id: "knowledge-governance-policy", scope: "core", path: "docs/KNOWLEDGE-GOVERNANCE-POLICY.md" },
  { id: "architecture-boundaries", scope: "core", path: "docs/ARCHITECTURE-BOUNDARIES.md" },
  { id: "intelligence-implementation-status", scope: "core", path: "docs/INTELLIGENCE-IMPLEMENTATION-STATUS.md" },
  { id: "architecture-adr-single-spine", scope: "core", path: "docs/adr/0001-uma-espinha-um-planner-um-journal.md" },
  { id: "architecture-adr-boundaries", scope: "core", path: "docs/adr/0002-boundaries-raw-studio-knowledge.md" },
  { id: "architecture-adr-private-store", scope: "core", path: "docs/adr/0003-armazenamento-privado-e-runtime-guard.md" },
  { id: "architecture-adr-governed-backup", scope: "core", path: "docs/adr/0004-backup-single-root-e-inventario-governado.md" },
  { id: "architecture-adr-typed-payloads", scope: "core", path: "docs/adr/0005-payloads-tipados-e-fechamento-de-referencias.md" },
  { id: "architecture-adr-domain-packs", scope: "core", path: "docs/adr/0006-knowledge-packs-globais-versionados.md" },
  { id: "architecture-adr-audiovisual-ontology", scope: "core", path: "docs/adr/0007-ontologia-audiovisual-global-candidata.md" },
  { id: "architecture-adr-reference-rights", scope: "core", path: "docs/adr/0008-referencias-direitos-e-estudo-provider-free.md" },
  { id: "architecture-adr-direct-provider-input", scope: "core", path: "docs/adr/0009-autorizacao-direta-de-provider-input.md" },
  { id: "knowledge-pack-terms", scope: "core", path: "knowledge/DOMAIN-PACK-TERMS.md" },
  { id: "knowledge-pack-catalog-doc", scope: "core", path: "docs/KNOWLEDGE-PACKS.md" },
  { id: "audiovisual-ontology-data", scope: "core", path: "knowledge/audiovisual-ontology@1.json" },
  { id: "audiovisual-ontology-doc", scope: "core", path: "docs/AUDIOVISUAL-ONTOLOGY.md" },
  { id: "cli-contract", scope: "core", path: "scripts/omni-cli.mjs" },
  { id: "governance-baseline-generator", scope: "core", path: "scripts/governance-baseline.mjs" },
  { id: "knowledge-pack-catalog-generator", scope: "core", path: "scripts/generate-knowledge-pack-catalog.mjs" },
  { id: "audiovisual-ontology-generator", scope: "core", path: "scripts/generate-audiovisual-ontology.mjs" },
  { id: "governance-docs-generator", scope: "core", path: "lib/media-pipeline/governance-docs.mjs" },
  { id: "direction-presets", scope: "core", path: "lib/media-pipeline/direction-presets.mjs" },
  { id: "style-evidence-reconciliation", scope: "core", path: "lib/media-pipeline/style-evidence-reconciliation.mjs" },
  { id: "knowledge-domain-pack-catalog", scope: "core", path: "lib/media-pipeline/knowledge-domain-pack-catalog.mjs" },
  { id: "knowledge-domain-pack-action", scope: "core", path: "lib/media-pipeline/knowledge-domain-pack-action.mjs" },
  { id: "knowledge-domain-pack-docs", scope: "core", path: "lib/media-pipeline/knowledge-domain-pack-docs.mjs" },
  { id: "knowledge-audiovisual-ontology", scope: "core", path: "lib/media-pipeline/knowledge-audiovisual-ontology.mjs" },
  { id: "knowledge-audiovisual-ontology-docs", scope: "core", path: "lib/media-pipeline/knowledge-audiovisual-ontology-docs.mjs" },
  { id: "commercial-scene-styles", scope: "core", path: "lib/media-pipeline/commercial.mjs" },
  { id: "recipe-v2", scope: "core", path: "lib/media-pipeline/recipe.mjs" },
  { id: "film-compiler", scope: "core", path: "lib/media-pipeline/film-compiler.mjs" },
  { id: "film-orchestrator", scope: "core", path: "lib/media-pipeline/film-orchestrator.mjs" },
  { id: "provider-registry", scope: "core", path: "lib/media-pipeline/provider-registry.mjs" },
  { id: "archive-index", scope: "core", path: "lib/media-pipeline/archive-index.mjs" },
  { id: "knowledge-schema-registry", scope: "core", path: "lib/media-pipeline/knowledge-schema-registry.mjs" },
  { id: "knowledge-record-contracts", scope: "core", path: "lib/media-pipeline/knowledge-record-contracts.mjs" },
  { id: "knowledge-store", scope: "core", path: "lib/media-pipeline/knowledge-store.mjs" },
  { id: "knowledge-service", scope: "core", path: "lib/media-pipeline/knowledge-service.mjs" },
  { id: "knowledge-governance-envelope", scope: "core", path: "lib/media-pipeline/knowledge-governance-envelope.mjs" },
  { id: "knowledge-backup", scope: "core", path: "lib/media-pipeline/knowledge-backup.mjs" },
  { id: "knowledge-asset-integrity", scope: "core", path: "lib/media-pipeline/knowledge-asset-integrity.mjs" },
  { id: "knowledge-schema-replay", scope: "core", path: "lib/media-pipeline/knowledge-schema-replay.mjs" },
  { id: "knowledge-importers", scope: "core", path: "lib/media-pipeline/knowledge-importers.mjs" },
  { id: "knowledge-reference-inventory", scope: "core", path: "lib/media-pipeline/knowledge-reference-inventory.mjs" },
  { id: "knowledge-reference-rights", scope: "core", path: "lib/media-pipeline/knowledge-reference-rights.mjs" },
  { id: "knowledge-reference-materialization", scope: "core", path: "lib/media-pipeline/knowledge-reference-materialization.mjs" },
  { id: "knowledge-effective-rights", scope: "core", path: "lib/media-pipeline/knowledge-effective-rights.mjs" },
  { id: "knowledge-reference-analysis-guard", scope: "core", path: "lib/media-pipeline/knowledge-reference-analysis-guard.mjs" },
  { id: "knowledge-reference-technique-candidate", scope: "core", path: "lib/media-pipeline/knowledge-reference-technique-candidate.mjs" },
  { id: "knowledge-reference-technique-materialization", scope: "core", path: "lib/media-pipeline/knowledge-reference-technique-materialization.mjs" },
  { id: "direct-provider-input-permit", scope: "core", path: "lib/media-pipeline/direct-provider-input-permit.mjs" },
  { id: "knowledge-migration-001", scope: "core", path: "knowledge/migrations/001-knowledge-store.sql" },
  { id: "knowledge-migration-002", scope: "core", path: "knowledge/migrations/002-knowledge-release-activation.sql" },
  { id: "knowledge-migration-003", scope: "core", path: "knowledge/migrations/003-knowledge-review-decisions.sql" },
  { id: "pipeline-operation", scope: "core", path: "lib/media-pipeline/pipeline-operation.mjs" },
  { id: "studio-policies", scope: "core", path: "lib/media-pipeline/studio-policies.mjs" },
  { id: "studio-governance", scope: "core", path: "lib/media-pipeline/studio-governance.mjs" },
]);

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function canonicalSha256(value) {
  return sha256Text(JSON.stringify(canonicalize(value)));
}

function normalizeCapturedAt(value) {
  const date = value == null ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("capturedAt inválido.");
  return date.toISOString();
}

function isSensitiveRelativePath(value) {
  const normalized = toPosix(value).toLowerCase();
  const basename = path.posix.basename(normalized);
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  if (/\.(?:har|pem|p12|pfx|key)$/.test(basename)) return true;
  return /^(?:cookies?|credentials?|secrets?|tokens?)(?:[._-].*)?\.json$/.test(basename);
}

export function sanitizeRelativePath(value) {
  const raw = toPosix(value);
  const invalid =
    !raw ||
    raw.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    path.posix.isAbsolute(raw) ||
    /^[A-Za-z]:\//.test(raw);
  const normalized = invalid ? null : path.posix.normalize(raw.replace(/^\.\//, ""));
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    return { path: `[invalid-path:${sha256Text(raw).slice(0, 12)}]`, redacted: true };
  }
  if (isSensitiveRelativePath(normalized)) {
    return { path: `[sensitive-path:${sha256Text(normalized).slice(0, 12)}]`, redacted: true };
  }
  return { path: normalized, redacted: false };
}

async function hashRegularFile(file) {
  const before = await lstat(file);
  if (!before.isFile()) throw new Error("O caminho não é um arquivo regular.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const after = await lstat(file);
  if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("O arquivo mudou durante o cálculo de hash.");
  }
  return { bytes: after.size, sha256: hash.digest("hex") };
}

async function readDirectory(directory) {
  try {
    return { status: "available", entries: await readdir(directory, { withFileTypes: true }) };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", entries: [] };
    throw error;
  }
}

async function walkRegularFiles(root, accept = () => true) {
  const rootState = await readDirectory(root);
  if (rootState.status !== "available") return { status: rootState.status, files: [], skippedSymlinks: 0 };
  const files = [];
  let skippedSymlinks = 0;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1;
      } else if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && accept(entry.name, absolute)) {
        files.push(absolute);
      }
    }
  }

  await visit(root);
  files.sort((left, right) => compareText(toPosix(path.relative(root, left)), toPosix(path.relative(root, right))));
  return { status: "available", files, skippedSymlinks };
}

export async function collectVideoReferenceManifest(videoRefsRoot = DEFAULT_VIDEO_REFS_ROOT) {
  const absoluteRoot = path.resolve(videoRefsRoot);
  const walked = await walkRegularFiles(absoluteRoot, (name) => /\.mp4$/i.test(name));
  if (walked.status !== "available") {
    return {
      location: "configured-video-references",
      status: walked.status,
      mp4Count: 0,
      skippedSymlinks: walked.skippedSymlinks,
      aggregateSha256: null,
      files: [],
    };
  }

  const files = [];
  for (const file of walked.files) {
    const metadata = await hashRegularFile(file);
    const sanitized = sanitizeRelativePath(path.relative(absoluteRoot, file));
    files.push({ path: sanitized.path, pathRedacted: sanitized.redacted, ...metadata });
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    location: "configured-video-references",
    status: "available",
    mp4Count: files.length,
    skippedSymlinks: walked.skippedSymlinks,
    aggregateSha256: canonicalSha256(files),
    files,
  };
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Objeto JavaScript sem fechamento.");
}

export function extractTopLevelObjectKeys(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Declaração não encontrada: ${marker}`);
  const openIndex = source.indexOf("{", markerIndex + marker.length);
  if (openIndex < 0) throw new Error(`Objeto não encontrado depois de: ${marker}`);
  const closeIndex = findMatchingBrace(source, openIndex);
  const body = source.slice(openIndex + 1, closeIndex);
  const keys = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^ {2}(?:(["'])(.*?)\1|([A-Za-z_$][\w$]*))\s*:/.exec(line);
    const key = match?.[2] ?? match?.[3];
    if (key) keys.push(key);
  }
  if (keys.length === 0) throw new Error(`Nenhuma chave de primeiro nível encontrada em: ${marker}`);
  if (new Set(keys).size !== keys.length) throw new Error(`Chaves duplicadas em: ${marker}`);
  return keys;
}

export async function collectSourceCatalogCounts(coreRoot = DEFAULT_CORE_ROOT) {
  const absoluteCore = path.resolve(coreRoot);
  const presetFile = path.join(absoluteCore, "lib", "media-pipeline", "direction-presets.mjs");
  const registryFile = path.join(absoluteCore, "lib", "cli", "command-registry.mjs");
  const [presetSource, registrySource, commercialSource] = await Promise.all([
    readFile(presetFile, "utf8"),
    readFile(registryFile, "utf8"),
    readFile(path.join(absoluteCore, "lib", "media-pipeline", "commercial.mjs"), "utf8"),
  ]);
  // This canonical module is deliberately pure/provider-free. Importing it is
  // necessary because DIRECTION_PRESETS may be a compatibility view derived
  // from STYLE_SPECS rather than another object literal.
  const presetModuleUrl = `${pathToFileURL(presetFile).href}?baseline=${sha256Text(presetSource).slice(0, 16)}`;
  const presetModule = await import(presetModuleUrl);
  if (!presetModule.DIRECTION_PRESETS || typeof presetModule.DIRECTION_PRESETS !== "object") {
    throw new Error("DIRECTION_PRESETS não foi exportado pelo catálogo canônico.");
  }
  // O CLI declara os comandos como dado (lib/cli/command-registry.mjs), não
  // mais como literal em scripts/omni-cli.mjs; a contagem importa o módulo
  // do próprio coreRoot em vez de reparsear código-fonte.
  const registryModuleUrl = `${pathToFileURL(registryFile).href}?baseline=${sha256Text(registrySource).slice(0, 16)}`;
  const registryModule = await import(registryModuleUrl);
  if (typeof registryModule.listCommands !== "function") {
    throw new Error("command-registry.mjs não exportou listCommands().");
  }
  const commands = registryModule.listCommands().map((entry) => entry.id);
  const directionPresets = Object.keys(presetModule.DIRECTION_PRESETS).sort(compareText);
  const styleSpecs = Object.keys(presetModule.STYLE_SPECS ?? presetModule.DIRECTION_PRESETS).sort(compareText);
  const sceneStyles = extractTopLevelObjectKeys(commercialSource, "export const SCENE_STYLES =");
  return {
    cli: {
      commandCount: commands.length,
      commandCountWithoutHelp: commands.filter((command) => command !== "help").length,
      includesHelp: commands.includes("help"),
      commands,
    },
    styles: {
      directionPresetCount: directionPresets.length,
      directionPresetIds: directionPresets,
      canonicalStyleSpecCount: styleSpecs.length,
      canonicalStyleSpecIds: styleSpecs,
      commercialSceneStyleCount: sceneStyles.length,
      commercialSceneStyleIds: sceneStyles,
    },
  };
}

export async function collectCoreRootCounts(coreRoot = DEFAULT_CORE_ROOT) {
  const state = await readDirectory(path.resolve(coreRoot));
  if (state.status !== "available") throw new Error("CORE não foi encontrado.");
  const files = state.entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort(compareText);
  const directories = state.entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareText);
  const symlinkCount = state.entries.filter((entry) => entry.isSymbolicLink()).length;
  const markdownFiles = files.filter((name) => /\.md$/i.test(name));
  const workFiles = files.filter((name) => name.endsWith(".blocos.json") || name.endsWith("jobs.json"));
  return {
    fileCount: files.length,
    directoryCount: directories.length,
    symlinkCount,
    markdownFileCount: markdownFiles.length,
    markdownFiles,
    rootWorkFileCount: workFiles.length,
    rootWorkFiles: workFiles,
  };
}

export async function collectOutputsTopLevel(coreRoot = DEFAULT_CORE_ROOT) {
  const outputsRoot = path.join(path.resolve(coreRoot), "outputs");
  const state = await readDirectory(outputsRoot);
  if (state.status !== "available") {
    return { location: "CORE/outputs", status: state.status, topLevelDirectoryCount: 0, skippedSymlinks: 0, directories: [] };
  }
  const directories = state.entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => sanitizeRelativePath(entry.name).path)
    .sort(compareText);
  return {
    location: "CORE/outputs",
    status: "available",
    topLevelDirectoryCount: directories.length,
    skippedSymlinks: state.entries.filter((entry) => entry.isSymbolicLink()).length,
    directories,
  };
}

async function defaultRunGit(args, cwd) {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return String(result.stdout);
}

async function tryGit(runGit, args, cwd) {
  try {
    return { ok: true, stdout: await runGit(args, cwd) };
  } catch (error) {
    return { ok: false, code: String(error?.code ?? "git-error").slice(0, 64) };
  }
}

function parseGitStatus(value) {
  const entries = [];
  for (const record of String(value).split("\0")) {
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") {
      entries.push({
        indexStatus: "?",
        worktreeStatus: "?",
        path: `[invalid-status-record:${sha256Text(record).slice(0, 12)}]`,
        pathRedacted: true,
      });
      continue;
    }
    const sanitized = sanitizeRelativePath(record.slice(3));
    entries.push({
      indexStatus: record[0],
      worktreeStatus: record[1],
      path: sanitized.path,
      pathRedacted: sanitized.redacted,
    });
  }
  entries.sort((left, right) => compareText(`${left.path}\0${left.indexStatus}${left.worktreeStatus}`, `${right.path}\0${right.indexStatus}${right.worktreeStatus}`));
  return entries;
}

function sanitizeGitRef(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export async function collectGitSnapshot({ coreRoot = DEFAULT_CORE_ROOT, runGit = defaultRunGit } = {}) {
  const rootResult = await tryGit(runGit, ["rev-parse", "--show-toplevel"], path.resolve(coreRoot));
  if (!rootResult.ok) {
    return {
      repositoryRoot: null,
      snapshot: {
        available: false,
        reason: rootResult.code,
        head: null,
        branch: null,
        status: { dirty: null, entryCount: 0, untrackedCount: 0, entries: [], sha256: null },
      },
    };
  }

  const repositoryRoot = path.resolve(String(rootResult.stdout).trim());
  const [headResult, branchResult, statusResult] = await Promise.all([
    tryGit(runGit, ["rev-parse", "--verify", "HEAD"], repositoryRoot),
    tryGit(runGit, ["symbolic-ref", "--quiet", "--short", "HEAD"], repositoryRoot),
    tryGit(
      runGit,
      ["-c", "core.quotepath=false", "-c", "status.relativePaths=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
      repositoryRoot,
    ),
  ]);
  const entries = statusResult.ok ? parseGitStatus(statusResult.stdout) : [];
  const headCandidate = headResult.ok ? String(headResult.stdout).trim().toLowerCase() : "";
  const head = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(headCandidate) ? headCandidate : null;
  const status = {
    dirty: statusResult.ok ? entries.length > 0 : null,
    entryCount: entries.length,
    untrackedCount: entries.filter((entry) => entry.indexStatus === "?" && entry.worktreeStatus === "?").length,
    entries,
    sha256: statusResult.ok ? canonicalSha256(entries) : null,
    ...(statusResult.ok ? {} : { reason: statusResult.code }),
  };
  return {
    repositoryRoot,
    snapshot: {
      available: true,
      head,
      branch: branchResult.ok ? sanitizeGitRef(branchResult.stdout) : null,
      detached: !branchResult.ok,
      status,
    },
  };
}

function contractDisplayPath(spec) {
  const relative = toPosix(spec.path);
  return spec.scope === "repository" ? relative : `CORE/${relative}`;
}

async function collectSchemaContractSpecs(coreRoot) {
  const schemaRoot = path.join(coreRoot, "schemas");
  const walked = await walkRegularFiles(schemaRoot);
  if (walked.status !== "available") return [];
  return walked.files.map((file) => {
    const relative = toPosix(path.relative(coreRoot, file));
    return { id: `schema:${relative}`, scope: "core", path: relative };
  });
}

async function collectDomainPackContractSpecs(coreRoot) {
  const packRoot = path.join(coreRoot, "knowledge", "domain-packs");
  const walked = await walkRegularFiles(packRoot);
  if (walked.status !== "available") return [];
  return walked.files.map((file) => {
    const relative = toPosix(path.relative(coreRoot, file));
    return {
      id: `domain-pack:${relative}`,
      scope: "core",
      path: relative,
    };
  });
}

function uniqueContractSpecs(specs) {
  const byId = new Map();
  const byPath = new Map();
  const unique = [];
  for (const spec of specs) {
    const id = String(spec?.id ?? "").trim();
    const scope = spec?.scope;
    const relative = toPosix(spec?.path ?? "");
    if (!id || !new Set(["core", "repository"]).has(scope) || !relative) {
      throw new Error("Contrato de baseline inválido.");
    }
    const pathKey = `${scope}:${relative}`;
    const existingId = byId.get(id);
    if (existingId && existingId !== pathKey) {
      throw new Error(`ID de contrato duplicado: ${id}.`);
    }
    const existingPath = byPath.get(pathKey);
    if (existingPath && existingPath !== id) {
      throw new Error(`Path de contrato duplicado com IDs diferentes: ${relative}.`);
    }
    if (existingId) continue;
    byId.set(id, pathKey);
    byPath.set(pathKey, id);
    unique.push({ ...spec, id, scope, path: relative });
  }
  return unique;
}

export async function collectCoreContractHashes({
  coreRoot = DEFAULT_CORE_ROOT,
  repositoryRoot = path.resolve(coreRoot, ".."),
  contractFiles = DEFAULT_CORE_CONTRACT_FILES,
  includeSchemas = true,
  includeDomainPacks = true,
} = {}) {
  const absoluteCore = path.resolve(coreRoot);
  const absoluteRepository = path.resolve(repositoryRoot);
  const specs = [...contractFiles];
  if (includeSchemas) specs.push(...(await collectSchemaContractSpecs(absoluteCore)));
  if (includeDomainPacks) {
    specs.push(...(await collectDomainPackContractSpecs(absoluteCore)));
  }
  const uniqueSpecs = uniqueContractSpecs(specs);
  const files = [];

  for (const spec of uniqueSpecs) {
    const base = spec.scope === "repository" ? absoluteRepository : absoluteCore;
    const file = path.resolve(base, spec.path);
    const relativeCheck = path.relative(base, file);
    if (!relativeCheck || relativeCheck === "." || relativeCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCheck)) {
      throw new Error(`Contrato fora do escopo permitido: ${spec.id}`);
    }
    try {
      const metadata = await hashRegularFile(file);
      files.push({ id: spec.id, path: contractDisplayPath(spec), status: "available", ...metadata });
    } catch (error) {
      if (error?.code === "ENOENT") {
        files.push({ id: spec.id, path: contractDisplayPath(spec), status: "missing", bytes: null, sha256: null });
      } else {
        throw error;
      }
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    fileCount: files.length,
    availableFileCount: files.filter((file) => file.status === "available").length,
    missingFileCount: files.filter((file) => file.status === "missing").length,
    aggregateSha256: canonicalSha256(files),
    files,
  };
}

function withoutCaptureTime(manifest) {
  const copy = structuredClone(manifest);
  delete copy.capturedAt;
  delete copy.baselineSha256;
  return copy;
}

export async function collectGovernanceBaseline({
  coreRoot = DEFAULT_CORE_ROOT,
  videoRefsRoot = DEFAULT_VIDEO_REFS_ROOT,
  capturedAt = null,
  runGit = defaultRunGit,
  repositoryRoot = null,
  contractFiles = DEFAULT_CORE_CONTRACT_FILES,
  includeSchemas = true,
} = {}) {
  const absoluteCore = path.resolve(coreRoot);
  const [gitResult, root, sourceCatalogs, outputs, videoReferences] = await Promise.all([
    collectGitSnapshot({ coreRoot: absoluteCore, runGit }),
    collectCoreRootCounts(absoluteCore),
    collectSourceCatalogCounts(absoluteCore),
    collectOutputsTopLevel(absoluteCore),
    collectVideoReferenceManifest(videoRefsRoot),
  ]);
  const effectiveRepositoryRoot = repositoryRoot ? path.resolve(repositoryRoot) : gitResult.repositoryRoot ?? path.resolve(absoluteCore, "..");
  const coreContracts = await collectCoreContractHashes({
    coreRoot: absoluteCore,
    repositoryRoot: effectiveRepositoryRoot,
    contractFiles,
    includeSchemas,
  });
  const manifest = {
    schema: GOVERNANCE_BASELINE_SCHEMA,
    capturedAt: normalizeCapturedAt(capturedAt),
    generator: {
      file: "CORE/scripts/governance-baseline.mjs",
      providerFree: true,
      writesOnlyWhenOutputIsExplicit: true,
    },
    methods: {
      git: "HEAD, symbolic branch and porcelain-v1 NUL status; no diffs or file contents; sensitive paths are replaced by one-way labels.",
      counts: "Direct fs entries sorted by code point; symbolic links are counted or skipped and never followed.",
      hashes: "SHA-256 of regular-file bytes; relative POSIX paths; deterministic sorted manifests.",
      fingerprint: "SHA-256 of the canonical manifest excluding only capturedAt and baselineSha256.",
    },
    git: gitResult.snapshot,
    root,
    cli: sourceCatalogs.cli,
    styles: sourceCatalogs.styles,
    outputs,
    videoReferences,
    coreContracts,
  };
  manifest.baselineSha256 = canonicalSha256(withoutCaptureTime(manifest));
  return manifest;
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

export function resolveGovernanceOutputPath(outputFile, coreRoot = DEFAULT_CORE_ROOT) {
  const requested = String(outputFile ?? "").trim();
  if (!requested) throw new Error("--out é obrigatório; nenhuma escrita ocorre sem caminho explícito.");
  const absoluteCore = path.resolve(coreRoot);
  const governanceRoot = path.join(absoluteCore, "diagnosticos", "governanca");
  const target = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(absoluteCore, requested);
  if (!samePath(path.dirname(target), governanceRoot)) {
    throw new Error("A saída deve ser um arquivo direto em CORE/diagnosticos/governanca.");
  }
  if (path.extname(target).toLowerCase() !== ".json") throw new Error("A saída da linha de base deve usar extensão .json.");
  return target;
}

async function ensureRealDirectory(directory, { parent = null } = {}) {
  try {
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`Diretório de diagnóstico inseguro: ${path.basename(directory)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (parent && !samePath(path.dirname(directory), parent)) throw new Error("Diretório de diagnóstico fora do escopo.");
    await mkdir(directory);
  }
}

export async function writeGovernanceBaseline({ baseline, outputFile, coreRoot = DEFAULT_CORE_ROOT } = {}) {
  if (!baseline || baseline.schema !== GOVERNANCE_BASELINE_SCHEMA) throw new Error("Manifesto de linha de base inválido.");
  const absoluteCore = path.resolve(coreRoot);
  const target = resolveGovernanceOutputPath(outputFile, absoluteCore);
  const diagnosticsRoot = path.join(absoluteCore, "diagnosticos");
  const governanceRoot = path.join(diagnosticsRoot, "governanca");
  await ensureRealDirectory(diagnosticsRoot, { parent: absoluteCore });
  await ensureRealDirectory(governanceRoot, { parent: diagnosticsRoot });
  const [realCore, realGovernance] = await Promise.all([realpath(absoluteCore), realpath(governanceRoot)]);
  const relative = path.relative(realCore, realGovernance);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Diretório de governança resolveu fora de CORE.");
  return writeJsonAtomic(target, baseline, { label: "Linha de base de governança" });
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (!new Set(["--out", "--video-refs"]).has(token)) throw new Error(`Opção desconhecida: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} exige um caminho.`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    "Uso provider-free:",
    "  node scripts/governance-baseline.mjs --out diagnosticos/governanca/baseline-AAAA-MM-DD.json",
    "  [--video-refs \"C:\\caminho\\para\\VIDEO REFS\"]",
    "",
    "A saída deve ser um JSON novo diretamente em CORE/diagnosticos/governanca; arquivos existentes nunca são sobrescritos.",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const target = resolveGovernanceOutputPath(options.out, DEFAULT_CORE_ROOT);
  const baseline = await collectGovernanceBaseline({
    coreRoot: DEFAULT_CORE_ROOT,
    videoRefsRoot: options["video-refs"] ? path.resolve(options["video-refs"]) : DEFAULT_VIDEO_REFS_ROOT,
  });
  const written = await writeGovernanceBaseline({ baseline, outputFile: target, coreRoot: DEFAULT_CORE_ROOT });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: toPosix(path.relative(DEFAULT_CORE_ROOT, written)),
    baselineSha256: baseline.baselineSha256,
  })}\n`);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && samePath(invokedFile, fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const message = String(error?.message ?? error).replace(/[A-Za-z]:\\[^\r\n]+/g, "[local-path]");
    process.stderr.write(`Falha na linha de base: ${message}\n`);
    process.exitCode = 1;
  });
}
