import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const classes = new Set(["local", "media", "process", "exclusive"]);

// A configuração maior foi medida em dois pares alternados num host de
// 32 CPUs lógicas / 31,7 GiB. Outros hosts conservam o padrão anterior.
// É recomendação de admissão, não reserva de memória ou lease de produção.
export function recommendVerificationCapacities({ logicalCpus, totalMemoryBytes, freeMemoryBytes }) {
  const large = Number.isSafeInteger(logicalCpus) && logicalCpus >= 32
    && Number.isFinite(totalMemoryBytes) && totalMemoryBytes >= 30 * 1024 ** 3
    && Number.isFinite(freeMemoryBytes) && freeMemoryBytes >= 16 * 1024 ** 3;
  return large ? { concurrency: 8, heavy: 6, local: 2, reason: "measured-large-host-with-free-memory" }
    : { concurrency: 4, heavy: 4, local: 2, reason: "conservative-host-or-memory" };
}

export function resourcePolicyFromEvidence({ report, sourceHashes }) {
  if (report.status !== "passed" || report.sourceStable !== true || report.selection?.scope !== "full" ||
      !Array.isArray(report.subprocessProfile?.groups) || !Array.isArray(report.tests?.summaries) ||
      !(report.tests.requestedFiles > 0) || report.tests.requestedFiles !== report.tests.observedFiles ||
      !report.source?.testSourceHashes || !report.sourceAfter?.testSourceHashes) {
    throw new Error("Classificação exige integração completa, estável, instrumentada e hashes dos testes antes/depois.");
  }
  return Object.fromEntries(Object.entries(sourceHashes).map(([file, sourceHash]) => {
    const name = path.basename(file);
    const observed = report.tests.summaries.find(row => row.file && path.basename(row.file) === name);
    const matched = /^[a-f0-9]{64}$/.test(sourceHash) && report.source.testSourceHashes[file] === sourceHash && report.sourceAfter.testSourceHashes[file] === sourceHash;
    const commands = report.subprocessProfile.groups.filter(group => group.owner === name).map(group => group.command);
    const resource = !matched || !observed ? "exclusive" : commands.length === 0 ? "local" : commands.every(command => ["ffmpeg", "ffprobe"].includes(command)) ? "media" : "process";
    return [file, { resource, sourceHash, durationMs: matched && observed && Number.isFinite(observed.duration_ms) ? Math.max(0, observed.duration_ms) : 0 }];
  }));
}

export async function planTestResources({ root, files }) {
  let policy = null;
  try { policy = JSON.parse(await readFile(path.join(root, "test/verification-resource-policy.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (policy && (policy.schema !== "gerador-de-videos/verification-resources@1" || !policy.files || typeof policy.files !== "object")) throw new Error("Política de recursos inválida.");
  return Promise.all(files.map(async (file) => {
    const entry = policy?.files[file];
    const hash = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
    const verified = entry && entry.sourceHash === hash && classes.has(entry.resource);
    return { file, resource: verified ? entry.resource : "exclusive", reason: verified ? "declared-and-source-matched" : "unclassified-or-source-changed",
      expectedDurationMs: verified && Number.isFinite(entry.durationMs) && entry.durationMs >= 0 ? entry.durationMs : 0 };
  }));
}

// Reservas apenas desta rodada de testes; nenhum lease ou adapter produtivo.
export async function runWithTestResources(jobs, { concurrency = 4, heavy = 2, local = 2, stopOnResult = () => false } = {}, operation) {
  for (const value of [concurrency, heavy, local]) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Capacidade de testes inválida.");
  if (typeof stopOnResult !== "function") throw new Error("Condição de parada inválida.");
  if (jobs.some((job) => !classes.has(job.resource))) throw new Error("Classe de recurso desconhecida.");
  const queuedAt = performance.now();
  const waiting = jobs.map((job, index) => ({ ...job, index })).sort((a, b) => b.expectedDurationMs - a.expectedDurationMs || a.file.localeCompare(b.file));
  const active = new Map();
  const used = { heavy: 0, local: 0, exclusive: 0 };
  const results = new Array(jobs.length);
  const admissions = [];
  let rejected = null;
  let stoppedBy = null;
  const fits = (job) => {
    if (active.size >= concurrency || used.exclusive) return false;
    if (job.resource === "exclusive") return active.size === 0;
    return job.resource === "local" ? used.local < local : used.heavy < heavy;
  };
  while (waiting.length || active.size) {
    let next;
    while (!rejected && !stoppedBy && (next = waiting.findIndex(fits)) >= 0) {
      const job = waiting.splice(next, 1)[0];
      const kind = job.resource === "exclusive" ? "exclusive" : job.resource === "local" ? "local" : "heavy";
      used[kind]++;
      const started = performance.now();
      const row = { file: job.file, resource: job.resource, waitMs: Math.round(started - queuedAt), runMs: null };
      admissions.push(row);
      const promise = Promise.resolve().then(() => operation(job)).then((result) => {
        results[job.index] = result;
        if (stopOnResult(result)) stoppedBy ??= job.file;
      }).catch((error) => { rejected ??= error; })
        .finally(() => { row.runMs = Math.round(performance.now() - started); used[kind]--; active.delete(job.index); });
      active.set(job.index, promise);
    }
    if (active.size) await Promise.race(active.values());
    else if (rejected || stoppedBy) break;
    else if (waiting.length) throw new Error("Fila de testes sem admissão possível.");
  }
  if (rejected) throw rejected;
  return { results: results.filter(() => true), admissions, stoppedBy,
    notStarted: waiting.sort((a, b) => a.index - b.index).map((job) => ({ file: job.file, reason: "stopped-after-failure" })),
    durationMs: Math.round(performance.now() - queuedAt), capacities: { concurrency, heavy, local } };
}
