import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand, runFfmpeg } from "../../lib/media-pipeline/media-tools.mjs";
import { measureFixturePreparation } from "./preparation-profile.mjs";

// Somente entradas sintéticas PCM; nenhum master, receipt ou resultado de teste
// entra no cache. O conteúdo fica privado em memória até dispose(), sem reuso
// entre arquivos de teste ou execuções da suíte.
export function createSyntheticToneFixtures() {
  const tones = new Map();
  const environments = new Map();
  const pending = new Set();
  let directory = null;
  let closed = false;
  let generated = 0;
  let copies = 0;
  const materialize = async (outputFile, { frequency, duration, channels = 1, sampleRate = 48000 }) => {
    if (closed) throw new Error("Fixture de tons já encerrada.");
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(duration) || duration <= 0 || duration > 60 ||
      ![1, 2].includes(channels) || ![16000, 44100, 48000].includes(sampleRate)) throw new Error("Configuração de tom inválida.");
    if (path.extname(outputFile).toLowerCase() !== ".wav") throw new Error("Fixture PCM exige destino WAV.");
    const environment = JSON.stringify([process.version, process.platform, process.arch, process.env.PATH ?? process.env.Path ?? ""]);
    if (!environments.has(environment)) environments.set(environment, runCommand("ffmpeg", ["-version"]).then(({ stdout }) => stdout));
    const version = await environments.get(environment);
    const key = createHash("sha256").update(JSON.stringify(["synthetic-tone@1", environment, version, frequency, duration, channels, sampleRate, "pcm_s16le"])).digest("hex");
    if (!tones.has(key)) {
      const prepared = (async () => {
        directory ??= mkdtemp(path.join(os.tmpdir(), "synthetic-tone-fixtures-"));
        const file = path.join(await directory, key + ".wav");
        await runFfmpeg(["-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${duration}`, "-ac", String(channels), "-ar", String(sampleRate), "-c:a", "pcm_s16le", file]);
        const bytes = await readFile(file);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await rm(file);
        generated++;
        return { bytes, sha256 };
      })();
      tones.set(key, prepared);
    }
    const tone = await tones.get(key);
    // Cada consumidor recebe arquivo novo. Alterar uma cópia não muda a base.
    await writeFile(outputFile, tone.bytes, { flag: "wx" });
    copies++;
    return { file: outputFile, sha256: tone.sha256, bytes: tone.bytes.length, fixtureKey: key };
  };
  return {
    materialize(...args) {
      const operation = measureFixturePreparation("synthetic-tone", () => materialize(...args));
      pending.add(operation);
      operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return operation;
    },
    stats: () => ({ generated, copies }),
    async dispose() {
      closed = true;
      await Promise.allSettled(pending);
      await Promise.allSettled(tones.values());
      tones.clear(); environments.clear();
      if (directory) await rm(await directory, { recursive: true, force: true });
    },
  };
}
