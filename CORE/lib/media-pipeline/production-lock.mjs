import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const PRODUCTION_LOCK_SCHEMA = "mkt-videos/production-lock@1";
// A posse passa ao filho por um token que só o dono real consegue produzir —
// o lockId gravado no arquivo. Não é nome de harness nem flag arbitrária:
// quem não segura o lock não tem o token, e quem tem não precisa esperar por
// si mesmo. É isto que impede o motor da série e o CLI que ele chama de
// entrarem em espera circular.
export const PRODUCTION_LOCK_ENV = "MKT_VIDEOS_PRODUCTION_LOCK";
export const PRODUCTION_LOCK_FILE = ".producao.lock";
// Uma montagem inteira de episódio passa de meia hora. O TTL precisa cobrir
// a etapa mais longa mesmo que o heartbeat falhe uma vez.
export const DEFAULT_PRODUCTION_LEASE_MS = 900_000;
export const DEFAULT_PRODUCTION_HEARTBEAT_MS = 30_000;
// Registro ilegível só é recuperado depois disso: antes, pode ser escrita
// em curso de outro processo.
export const MALFORMED_PRODUCTION_LOCK_STALE_MS = 3_600_000;

function defaultIsProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// Mesmo raciocínio do lock de destino: junction, symlink e caixa diferente
// alcançam o mesmo diretório, e cada alias criaria a própria posse.
async function canonicalDirectory(directory) {
  const absolute = path.resolve(directory);
  await mkdir(absolute, { recursive: true });
  try { return await realpath(absolute); } catch { return absolute; }
}

function inheritedTokens() {
  try { return JSON.parse(process.env[PRODUCTION_LOCK_ENV] ?? "{}") ?? {}; }
  catch { return {}; }
}

function tokenKey(directory) {
  return process.platform === "win32" ? directory.toLowerCase() : directory;
}

async function readLockRecord(file) {
  try {
    const record = JSON.parse(await readFile(file, "utf8"));
    return record?.schema === PRODUCTION_LOCK_SCHEMA ? record : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

// Recuperação conservadora: só toma a posse de quem comprovadamente sumiu,
// ou de um registro vencido cujo dono não está mais vivo. Processo vivo e
// silencioso mantém a posse — recuperar lock nunca autoriza reenviar nada.
async function recoverOrphanedLock(file, { now, isProcessAlive, malformedStaleMs }) {
  const record = await readLockRecord(file);
  if (record == null) {
    // Arquivo ilegível pode ser escrita em curso. Só recupera quando for
    // velho demais para ser isso.
    const info = await stat(file).catch(() => null);
    if (info == null) return true;
    if (now.getTime() - info.mtimeMs < malformedStaleMs) return false;
  } else if (isProcessAlive(Number(record.pid))) {
    // Processo vivo mantém a posse mesmo calado: expiração sozinha não
    // prova abandono, e tomar a posse de quem ainda escreve corromperia a
    // montagem.
    return false;
  }
  const orphan = `${file}.${process.pid}.${randomUUID()}.orphan`;
  try { await rename(file, orphan); }
  catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  await rm(orphan, { force: true });
  return true;
}

/**
 * Posse exclusiva de escrita sobre uma coleção. Protege os manifestos
 * compartilhados de uma produção — timeline, jobs, stems, master — de dois
 * escritores simultâneos, sem serializar produções diferentes: cada coleção
 * tem a sua, e duas coleções distintas avançam juntas.
 */
export async function acquireProductionLock(directory, {
  leaseMs = DEFAULT_PRODUCTION_LEASE_MS,
  heartbeatMs = DEFAULT_PRODUCTION_HEARTBEAT_MS,
  label = null,
  now = () => new Date(),
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  const canonical = await canonicalDirectory(directory);
  const key = tokenKey(canonical);
  const file = path.join(canonical, PRODUCTION_LOCK_FILE);
  const inherited = inheritedTokens();

  if (inherited[key]) {
    const record = await readLockRecord(file);
    if (record && record.lockId === inherited[key]) {
      // O pai já é o dono. O filho trabalha sob a posse dele.
      return Object.freeze({
        schema: PRODUCTION_LOCK_SCHEMA,
        directory: canonical,
        file,
        lockId: record.lockId,
        inherited: true,
        childEnv: () => ({ [PRODUCTION_LOCK_ENV]: JSON.stringify({ ...inherited, [key]: record.lockId }) }),
        release: async () => false,
      });
    }
  }

  const current = now();
  const lockId = randomUUID();
  let handle;
  for (;;) {
    try {
      handle = await open(file, "wx");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await recoverOrphanedLock(file, { now: current, isProcessAlive, malformedStaleMs: MALFORMED_PRODUCTION_LOCK_STALE_MS })) continue;
      const record = await readLockRecord(file);
      throw new Error(`Produção em uso por outro processo: ${label ?? canonical}${record?.pid ? ` (PID ${record.pid})` : ""}. Acompanhe essa execução em vez de abrir outra.`);
    }
  }

  async function write(expiresAt) {
    await handle.truncate(0);
    await handle.write(`${JSON.stringify({
      schema: PRODUCTION_LOCK_SCHEMA,
      lockId,
      pid: process.pid,
      label: label ?? null,
      directory: canonical,
      createdAt: current.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })}\n`, 0);
    await handle.sync();
  }

  try {
    await write(new Date(current.getTime() + leaseMs));
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(file, { force: true }).catch(() => {});
    throw error;
  }

  const timer = setInterval(() => {
    write(new Date(now().getTime() + leaseMs)).catch(() => {});
  }, heartbeatMs);
  timer.unref?.();

  let released = false;
  return Object.freeze({
    schema: PRODUCTION_LOCK_SCHEMA,
    directory: canonical,
    file,
    lockId,
    inherited: false,
    childEnv: () => ({ [PRODUCTION_LOCK_ENV]: JSON.stringify({ ...inherited, [key]: lockId }) }),
    async release() {
      if (released) return false;
      released = true;
      clearInterval(timer);
      await handle.close().catch(() => {});
      await rm(file, { force: true }).catch(() => {});
      return true;
    },
  });
}

/**
 * Executa `run` sob posse exclusiva da coleção, liberando sempre.
 */
export async function withProductionLock(directory, options, run) {
  const lock = await acquireProductionLock(directory, options);
  try { return await run(lock); }
  finally { await lock.release(); }
}
