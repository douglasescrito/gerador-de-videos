import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PROMPT_PROVENANCE_LINK_SCHEMA = "mkt-videos/prompt-provenance-link@1";
export const PROMPT_BACKFILL_REPORT_SCHEMA = "mkt-videos/prompt-backfill-report@1";
export const PROMPT_LINK_SUFFIX = ".prompt-link.json";

const SOURCE_NAMES = new Set(["jobs.json", "omni-jobs.json", "summary.json"]);
const OUTPUT_KEYS = ["file", "outputFile", "videoFile", "outputPath", "videoPath"];

function hashBuffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(file) {
  return hashBuffer(fs.readFileSync(file));
}

function jsonFiles(root) {
  const files = [];
  const walk = (directory) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_NAMES.has(entry.name.toLowerCase())) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

function relativeDeclaredOutput(outputsRoot, sourceFile, declared) {
  const raw = String(declared ?? "").trim();
  if (!raw || !raw.toLowerCase().endsWith(".mp4")) return null;
  const normalized = raw.replace(/\\/g, "/");
  const marker = "/outputs/";
  const markerAt = normalized.toLowerCase().lastIndexOf(marker);
  const relative = markerAt >= 0
    ? normalized.slice(markerAt + marker.length)
    : path.isAbsolute(raw)
      ? path.relative(outputsRoot, path.resolve(raw)).replace(/\\/g, "/")
      : path.relative(outputsRoot, path.resolve(path.dirname(sourceFile), raw)).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  const target = path.resolve(outputsRoot, relative);
  const prefix = `${path.resolve(outputsRoot)}${path.sep}`;
  if (!target.startsWith(prefix) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return relative;
}

function collectCandidates(value, pointer, context, output) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectCandidates(entry, `${pointer}/${index}`, context, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  const prompt = typeof value.prompt === "string" && value.prompt.trim() ? value.prompt.trim() : null;
  if (prompt) {
    for (const key of OUTPUT_KEYS) {
      const relPath = relativeDeclaredOutput(context.outputsRoot, context.sourceFile, value[key]);
      if (!relPath) continue;
      output.push({
        relPath,
        prompt,
        sourcePointer: `${pointer}/${key}`,
        promptPointer: `${pointer}/prompt`,
      });
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    collectCandidates(entry, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, context, output);
  }
}

export function inspectPromptBackfill({ outputsRoot, promptIndex }) {
  const byVideo = new Map();
  let unreadableSources = 0;
  for (const sourceFile of jsonFiles(outputsRoot)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
    } catch {
      unreadableSources += 1;
      continue;
    }
    const found = [];
    collectCandidates(parsed, "", { outputsRoot, sourceFile }, found);
    for (const candidate of found) {
      if (promptIndex?.entries?.[candidate.relPath]) continue;
      const values = byVideo.get(candidate.relPath) ?? [];
      values.push({
        ...candidate,
        sourceFile: path.relative(outputsRoot, sourceFile).replace(/\\/g, "/"),
        sourceFileHash: fileHash(sourceFile),
      });
      byVideo.set(candidate.relPath, values);
    }
  }
  const candidates = [];
  const ambiguous = [];
  for (const [relPath, values] of byVideo) {
    const unique = new Map(values.map((entry) => [`${entry.prompt}\0${entry.sourceFile}\0${entry.promptPointer}`, entry]));
    const promptSet = new Set([...unique.values()].map(({ prompt }) => prompt));
    if (promptSet.size !== 1) {
      ambiguous.push({
        relPath,
        sources: [...unique.values()].map(({ sourceFile, promptPointer }) => ({ sourceFile, promptPointer })),
      });
      continue;
    }
    const chosen = [...unique.values()].sort((a, b) =>
      `${a.sourceFile}${a.promptPointer}`.localeCompare(`${b.sourceFile}${b.promptPointer}`))[0];
    candidates.push({
      ...chosen,
      videoHash: fileHash(path.join(outputsRoot, relPath)),
    });
  }
  return {
    schema: PROMPT_BACKFILL_REPORT_SCHEMA,
    inspectedAt: new Date().toISOString(),
    outputsRoot,
    sourceFiles: jsonFiles(outputsRoot).length,
    unreadableSources,
    candidateCount: candidates.length,
    ambiguousCount: ambiguous.length,
    candidates: candidates.sort((a, b) => a.relPath.localeCompare(b.relPath)),
    ambiguous: ambiguous.sort((a, b) => a.relPath.localeCompare(b.relPath)),
  };
}

export function applyPromptBackfill({
  outputsRoot,
  report,
  selectedRelPaths = null,
  confirmHuman,
  clock = () => new Date(),
}) {
  if (confirmHuman !== true) throw new Error("Backfill exige confirmHuman=true.");
  if (report?.schema !== PROMPT_BACKFILL_REPORT_SCHEMA) throw new Error("Relatório de backfill inválido.");
  const selected = selectedRelPaths == null ? null : new Set(selectedRelPaths.map(String));
  const written = [];
  for (const candidate of report.candidates) {
    if (selected && !selected.has(candidate.relPath)) continue;
    const videoFile = path.join(outputsRoot, candidate.relPath);
    const sourceFile = path.join(outputsRoot, candidate.sourceFile);
    if (
      !fs.existsSync(videoFile)
      || !fs.existsSync(sourceFile)
      || fileHash(videoFile) !== candidate.videoHash
      || fileHash(sourceFile) !== candidate.sourceFileHash
    ) {
      throw new Error(`Fonte ou vídeo mudou desde a inspeção: ${candidate.relPath}.`);
    }
    const linkFile = `${videoFile}${PROMPT_LINK_SUFFIX}`;
    if (fs.existsSync(linkFile)) throw new Error(`Link de proveniência já existe: ${candidate.relPath}.`);
    const link = {
      schema: PROMPT_PROVENANCE_LINK_SCHEMA,
      id: `prompt-link:${randomUUID()}`,
      relPath: candidate.relPath,
      prompt: candidate.prompt,
      videoHash: candidate.videoHash,
      source: {
        file: candidate.sourceFile,
        fileHash: candidate.sourceFileHash,
        promptPointer: candidate.promptPointer,
        outputPointer: candidate.sourcePointer,
      },
      method: "exact-declared-output",
      createdAt: clock().toISOString(),
      createdBy: "human-confirmed-backfill",
    };
    const temporary = `${linkFile}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(link, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, linkFile);
    written.push({ relPath: candidate.relPath, linkFile: path.relative(outputsRoot, linkFile).replace(/\\/g, "/") });
  }
  return {
    schema: "mkt-videos/prompt-backfill-apply-result@1",
    writtenCount: written.length,
    written,
  };
}

export function resolveHistoricalCollectionRecipe({ outputsRoot, relPath }) {
  if (!outputsRoot || !relPath) return null;
  const parts = relPath.replace(/\\/g, "/").split("/");
  if (parts.length < 2) return null;
  const collectionFolder = path.join(outputsRoot, parts[0]);
  if (!fs.existsSync(collectionFolder)) return null;

  const fileName = parts.at(-1) || "";
  const fileBasename = path.basename(fileName, path.extname(fileName));
  const indexMatch = fileBasename.match(/^(\d{1,3})/);
  const indexNum = indexMatch ? indexMatch[1] : null;

  const jsonFilesToInspect = [];
  const walkCollection = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkCollection(full);
      } else if (entry.name.toLowerCase().endsWith(".json") && !entry.name.endsWith(PROMPT_LINK_SUFFIX)) {
        jsonFilesToInspect.push(full);
      }
    }
  };
  walkCollection(collectionFolder);

  const matchedPrompts = [];

  for (const jsonFile of jsonFilesToInspect) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    } catch {
      continue;
    }

    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.blocks)
        ? parsed.blocks
        : Array.isArray(parsed?.jobs)
          ? parsed.jobs
          : [parsed];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      const promptCandidate = typeof item.prompt === "string" && item.prompt.trim()
        ? item.prompt.trim()
        : typeof item.text === "string" && item.text.trim()
          ? item.text.trim()
          : typeof item.direction === "string" && item.direction.trim()
            ? item.direction.trim()
            : null;

      if (!promptCandidate) continue;

      let matched = false;
      for (const key of OUTPUT_KEYS) {
        if (typeof item[key] === "string" && (item[key].toLowerCase().endsWith(fileName.toLowerCase()) || item[key].replace(/\\/g, "/").endsWith(relPath.toLowerCase()))) {
          matched = true;
          break;
        }
      }

      if (!matched && indexNum && path.basename(jsonFile).includes("-meta.json")) {
        const itemId = String(item.id ?? item.filmId ?? item.pieceId ?? "").toLowerCase();
        if (itemId.startsWith(indexNum) || itemId.includes(`-${indexNum}-`)) {
          matched = true;
        }
      }

      if (matched) {
        matchedPrompts.push({
          prompt: promptCandidate,
          jsonFile,
        });
      }
    }
  }

  // Se houver conflito de múltiplos prompts no mesmo arquivo genérico (sem link explícito), não forçar
  if (matchedPrompts.length === 0) return null;
  const uniquePrompts = new Set(matchedPrompts.map((m) => m.prompt));
  if (uniquePrompts.size > 1) return null;

  const chosen = matchedPrompts[0];
  const relSourceFile = path.relative(outputsRoot, chosen.jsonFile).replace(/\\/g, "/");
  return {
    schema: PROMPT_PROVENANCE_LINK_SCHEMA,
    id: `legacy-recipe:${parts[0]}:${fileBasename}`,
    relPath,
    prompt: chosen.prompt,
    videoHash: "legacy-recipe",
    source: {
      file: relSourceFile,
      fileHash: "legacy-recipe",
      promptPointer: "/prompt",
      outputPointer: "/declared",
    },
    method: "exact-declared-output",
    createdAt: new Date().toISOString(),
    createdBy: "historical-recipe-fallback",
  };
}

export function readPromptProvenanceLink({ outputsRoot, relPath }) {
  const videoFile = path.join(outputsRoot, relPath);
  const linkFile = `${videoFile}${PROMPT_LINK_SUFFIX}`;
  try {
    const link = JSON.parse(fs.readFileSync(linkFile, "utf8"));
    if (
      link?.schema === PROMPT_PROVENANCE_LINK_SCHEMA
      && link.relPath === relPath
      && link.method === "exact-declared-output"
      && fileHash(videoFile) === link.videoHash
      && fileHash(path.join(outputsRoot, link.source.file)) === link.source.fileHash
      && typeof link.prompt === "string"
      && link.prompt.trim()
    ) return link;
  } catch {
    // Fall through
  }

  return resolveHistoricalCollectionRecipe({ outputsRoot, relPath });
}
