import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execute = promisify(execFile);

export const bootstrapTestFiles = ["test/cli-bootstrap.test.mjs"];
const fastTestFiles = ["test/cli-errors.test.mjs", "test/direction-presets.test.mjs"];
const stressTestFiles = ["test/direct-video-multiprocess.test.mjs", "test/mixed-routes-multiprocess.test.mjs", "test/production-pool.test.mjs", "test/resource-broker-multiprocess.test.mjs"];

export const structuralChecks = [
  ["commands", "scripts/generate-governance-docs.mjs", "--check"],
  ["styles", "scripts/generate-style-catalog.mjs", "--check"],
  ["techniques", "scripts/generate-technique-catalog.mjs", "--check"],
  ["knowledge-packs", "scripts/generate-knowledge-pack-catalog.mjs", "--check"],
  ["ontology", "scripts/generate-audiovisual-ontology.mjs", "--check"],
  ["recipe-contracts", "scripts/generate-recipe-contracts.mjs", "--check"],
  ["agent-contract", "scripts/generate-agent-contract.mjs", "--check"],
  ["recipes", "scripts/omni-cli.mjs", "receitas", "--action", "validar"],
  ["exports", "scripts/check-orphan-exports.mjs"],
];

export function selectVerification({ mode, changed, testFiles, selectedFiles = [], impact = null }) {
  const all = [...testFiles].sort();
  if (selectedFiles.length) {
    if (mode !== "affected") throw new Error("--file exige --mode affected; seleção explícita nunca é regressão completa.");
    const files = [...new Set(selectedFiles.map((file) => file.replaceAll("\\", "/")))].sort();
    for (const file of files) if (!all.includes(file)) throw new Error(`Arquivo de teste não descoberto: ${file}`);
    return { scope: "targeted", reason: "Seleção explícita para a frente em edição; dependências indiretas não são inferidas e a integração permanece pendente.", files };
  }
  if (mode === "full") return { scope: "full", reason: "Regressão completa solicitada.", files: all };
  if (mode === "fast") {
    for (const file of fastTestFiles) if (!all.includes(file)) throw new Error(`Contrato obrigatório do modo rápido não descoberto: ${file}`);
    return { scope: "fast", reason: "Bootstrap, contratos puros de erros/estilos e gates; aprovação parcial, sem dispensar integração.", files: [...fastTestFiles] };
  }
  if (mode === "stress") {
    for (const file of stressTestFiles) if (!all.includes(file)) throw new Error(`Contrato obrigatório de concorrência não descoberto: ${file}`);
    return { scope: "stress", reason: "Disputas entre processos, limites do pool e rotas mistas; aprovação parcial, sem dispensar integração.", files: [...stressTestFiles] };
  }
  if (mode !== "affected") throw new Error(`Modo desconhecido: ${mode}`);
  if (impact) {
    if (impact.status === "partial-selection" && impact.files.length && impact.files.every((file) => all.includes(file))) {
      return { scope: "affected", reason: "Imports transitivos e consumidores incertos selecionados; aprovação parcial, sem dispensar integração completa.", files: impact.files, impact };
    }
    return { scope: "full", reason: "Mapa de impacto exige ampliação para a suíte completa.", files: all, impact };
  }
  // Não fingir que imports estáticos cobrem strings de CLI, leitura de schemas,
  // fixtures e importações dinâmicas. Estes vínculos ampliam para a suíte toda.
  if (!changed.length) return { scope: "full", reason: "Árvore sem diff não implica evidência anterior; executar a suíte.", files: all };
  if (changed.every((file) => all.includes(file))) return { scope: "affected", reason: "Apenas arquivos de teste alterados; executar esses arquivos integralmente.", files: [...new Set(changed)].sort() };
  return { scope: "full", reason: "Mudança produtiva, documento, fixture, configuração ou remoção exige cobertura completa até existir mapa de impacto comprovado.", files: all };
}

export async function worktreeSnapshot(cwd, { includeInventory = false } = {}) {
  const git = async (...args) => (await execute("git", args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })).stdout;
  const [identity, inventory, status] = await Promise.all([
    git("rev-parse", "HEAD", "--show-prefix"),
    git("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."),
    git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", "."),
  ]);
  const [revision, prefix = ""] = identity.split(/\r?\n/);
  // Porcelain -z reports root-relative literal paths, including spaces/unicode.
  // Disable rename folding so both old and new paths remain in the impact set.
  const changed = status.split("\0").filter(Boolean).map((entry) => {
    const file = entry.slice(3);
    if (entry[2] !== " " || !file.startsWith(prefix)) throw new Error("Status Git fora da raiz do snapshot.");
    return file.slice(prefix.length);
  });
  const files = [...new Set(inventory.split("\0").filter(Boolean))].sort();
  const digest = createHash("sha256");
  const testSourceHashes = {};
  const hashes = await runBounded(files, 8, async (file) => {
    try { return createHash("sha256").update(await readFile(path.join(cwd, file))).digest("hex"); }
    catch (error) { if (error.code !== "ENOENT") throw error; return "deleted"; }
  });
  for (const [index, file] of files.entries()) {
    const hash = hashes[index];
    digest.update(JSON.stringify([file, hash]));
    if (/^test\/[^/]+\.test\.mjs$/.test(file)) testSourceHashes[file] = hash;
  }
  return { revision: revision.trim(), fingerprint: digest.digest("hex"), files: files.length, testSourceHashes, ...(includeInventory ? { inventory: files } : {}),
    changed: [...new Set(changed)].sort() };
}

export async function runBounded(items, width, operation) {
  if (!Number.isSafeInteger(width) || width < 1) throw new Error("Concorrência inválida.");
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

export function summarizeTestEvents(events, files, root) {
  const summaries = events.filter((event) => event.type === "test:summary");
  const lastSummary = summaries.findLast((event) => !event.file);
  const observed = new Set(summaries.filter((event) => event.file).map((event) => path.resolve(event.file)));
  const complete = Boolean(lastSummary?.success && Number.isSafeInteger(lastSummary.counts?.tests) && lastSummary.counts.tests > 0 &&
    lastSummary.counts.failed === 0 && lastSummary.counts.cancelled === 0 &&
    observed.size === files.length && files.every((file) => observed.has(path.resolve(root, file))));
  return { summaries, requestedFiles: files.length, observedFiles: observed.size,
    slowestCases: events.filter((event) => event.durationMs != null && !event.skipped).sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
    ...(complete ? {} : { error: "Resumo final falhou, está incompleto ou não cobre os arquivos solicitados; não declarar aprovação." }) };
}

/** Combina execuções da mesma rodada; não reaproveita resultado de rodada anterior. */
export function combineTestGroups(groups, files, root) {
  const counts = {};
  const events = [];
  for (const group of groups) {
    events.push(...group.events.filter((event) => event.type !== "test:summary" || event.file));
    const summary = group.summaries.findLast((event) => !event.file);
    for (const [name, count] of Object.entries(summary?.counts ?? {})) counts[name] = (counts[name] ?? 0) + count;
  }
  const executedFiles = groups.flatMap((group) => group.files);
  const unique = new Set(executedFiles).size === executedFiles.length;
  const success = unique && groups.length > 0 && groups.every((group) => group.status === "passed" && !group.error);
  events.push({ type: "test:summary", success, counts });
  const coverage = summarizeTestEvents(events, files, root);
  return { events, report: { name: "tests", status: success && !coverage.error ? "passed" : "failed", exitCode: success && !coverage.error ? 0 : 1,
    durationMs: groups.reduce((sum, group) => sum + group.durationMs, 0), ...coverage,
    groups: groups.map(({ events: _events, ...group }) => group),
    ...(unique ? {} : { error: "Arquivo de teste executado em mais de um grupo na mesma rodada." }) } };
}
