import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const schema = "gerador-de-videos/syntax-evidence@1";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const serialize = (value) => JSON.stringify(value);
const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const same = (a, b) => serialize(a) === serialize(b);

async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

/** Apenas sintaxe de formato explícito; nunca cache de execução de testes. */
export function createSyntaxEvidence({ root, env, enabled = true, reuse = true }) {
  const directory = path.join(root, ".cache", "verification", "syntax-evidence-v1");
  // Metadata do host REPL não é lida pelo processo Node --check.
  const allowedNodeEnvironment = new Set(["NODE_ENV", "NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE", "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S"]);
  const unsupportedEnvironmentKeys = Object.entries(env).filter(([key, value]) => key.startsWith("NODE_") && value && !allowedNodeEnvironment.has(key)).map(([key]) => key).sort();
  const unknownEnvironment = unsupportedEnvironmentKeys.length > 0;
  const available = enabled && !unknownEnvironment;
  const reason = !enabled ? "disabled" : unknownEnvironment ? "unknown-node-startup-environment" : null;
  const origins = new Map();
  let originReads = 0;
  let enginePromise;
  let engineValue = null;
  const engine = () => enginePromise ??= Promise.all([
    hashFile(process.execPath),
    readFile(path.join(root, "scripts/run-verification.mjs")),
    readFile(path.join(root, "scripts/verification-syntax-evidence.mjs")),
  ]).then(([nodeHash, runner, implementation]) => engineValue = {
    node: process.version, nodeHash, platform: process.platform, arch: process.arch,
    driverHash: hash(Buffer.concat([runner, Buffer.from([0]), implementation])),
  });

  const prepare = async (file) => {
    if (!available || !/\.(?:mjs|cjs)$/.test(file)) return null;
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    if (normalize(await realpath(absolute)) !== normalize(absolute)) return null;
    const source = await readFile(absolute);
    const input = { file: relative.replaceAll("\\", "/"), sourceHash: hash(source),
      format: file.endsWith(".mjs") ? "module" : "commonjs", engine: await engine() };
    return { source, input, key: hash(serialize(input)) };
  };

  const readOrigin = async (proof) => {
    if (typeof proof?.report !== "string" || !/^diagnosticos\/verificacoes\/[^/]+\/report\.json$/.test(proof.report) ||
        !/^[a-f0-9]{64}$/.test(proof.reportHash ?? "")) throw new Error("Origem inválida.");
    const originFile = path.resolve(root, proof.report);
    const base = await realpath(path.join(root, "diagnosticos/verificacoes"));
    const resolved = await realpath(originFile);
    const relative = path.relative(normalize(base), normalize(resolved));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Origem fora dos relatórios.");
    const key = `${resolved}:${proof.reportHash}`;
    const bytes = await readFile(resolved);
    originReads++;
    if (hash(bytes) !== proof.reportHash) throw new Error("Relatório alterado.");
    if (!origins.has(key)) origins.set(key, JSON.parse(bytes));
    return origins.get(key);
  };

  const lookupWithOrigin = async (prepared, readProof) => {
    if (!reuse || !prepared) return null;
    try {
      const bytes = await readFile(path.join(directory, `${prepared.key}.json`));
      const record = JSON.parse(bytes);
      if (record.body?.schema !== schema || record.digest !== hash(serialize(record.body)) || !same(record.body.input, prepared.input)) return null;
      const report = await readProof(record.body.proof);
      if (report.schema !== "gerador-de-videos/verification@1" || !["passed", "partial-passed"].includes(report.status) || report.sourceStable !== true ||
          report.syntaxEvidence?.engineStable !== true || !same(report.syntaxEvidence.engine, prepared.input.engine)) return null;
      const row = report.syntax?.find((row) => row.name === record.body.proof.check);
      if (!row || row.status !== "passed" || row.exitCode !== 0 || row.execution !== "executed" || !same(row.syntaxInput, prepared.input) ||
          !same(row.args, ["--check", `--input-type=${prepared.input.format}`])) return null;
      return { key: prepared.key, recordHash: hash(bytes), recordFile: path.join(directory, `${prepared.key}.json`), ...record.body.proof };
    } catch { return null; } // Cache ausente, corrompido ou inacessível exige nova execução.
  };

  const lookup = (prepared) => lookupWithOrigin(prepared, readOrigin);
  const lookupBatch = async (prepared) => {
    // Um snapshot por origem nesta consulta finita. Cada registro e cada linha
    // continuam validados; uma nova consulta relê e verifica os bytes da origem.
    const snapshots = new Map();
    const readProof = (proof) => {
      const key = serialize([proof?.report, proof?.reportHash]);
      if (!snapshots.has(key)) snapshots.set(key, readOrigin(proof));
      return snapshots.get(key);
    };
    const results = [];
    for (let start = 0; start < prepared.length; start += 8) {
      results.push(...await Promise.all(prepared.slice(start, start + 8).map((item) => lookupWithOrigin(item, readProof))));
    }
    return results;
  };

  const verifyEngine = async () => !engineValue || same(engineValue, {
    ...engineValue, nodeHash: await hashFile(process.execPath),
    driverHash: hash(Buffer.concat([await readFile(path.join(root, "scripts/run-verification.mjs")), Buffer.from([0]), await readFile(path.join(root, "scripts/verification-syntax-evidence.mjs"))])),
  });

  const publish = async (report, reportFile) => {
    const result = { schema: "gerador-de-videos/syntax-evidence-publication@1", published: 0, errors: [] };
    if (!available || report.sourceStable !== true || report.syntaxEvidence.engineStable !== true || !["passed", "partial-passed"].includes(report.status)) return result;
    const candidates = report.syntax.filter((row) => row.status === "passed" && row.exitCode === 0 && row.execution === "executed" && row.syntaxInput);
    if (!candidates.length) return result;
    const proof = { report: path.relative(root, reportFile).replaceAll("\\", "/"), reportHash: hash(await readFile(reportFile)) };
    await mkdir(directory, { recursive: true });
    for (const row of candidates) {
      const body = { schema, input: row.syntaxInput, proof: { ...proof, check: row.name } };
      const key = hash(serialize(body.input));
      const temporary = path.join(directory, `${key}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, serialize({ body, digest: hash(serialize(body)) }) + "\n", { flag: "wx" });
        await rename(temporary, path.join(directory, `${key}.json`));
        result.published++;
      } catch (error) { result.errors.push({ key, code: String(error.code ?? error.name) }); }
    }
    return result;
  };
  return { prepare, lookup, lookupBatch, verifyEngine, publish,
    describe: () => ({ available, reason, unsupportedEnvironmentKeys, reuseAllowed: available && reuse, directory, engine: engineValue, originReads }) };
}
