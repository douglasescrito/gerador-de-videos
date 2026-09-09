import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const RUNTIME_DB_ENV = "MKT_VIDEOS_RUNTIME_DB";

/**
 * Origem única do runtime operacional compartilhado.
 *
 * Processos que apontam para bancos diferentes não disputam nada: cada um
 * acha que tem o estúdio inteiro e o limite global deixa de existir. Por
 * isso a resolução mora aqui, e o CLI, o motor da série e qualquer outro
 * chamador usam esta função em vez de recalcular o caminho.
 */
export function resolveRuntimeDbFile({ env = process.env, coreRoot = null } = {}) {
  const configured = env[RUNTIME_DB_ENV];
  if (configured) return path.resolve(String(configured));
  if (env.NODE_ENV === "test") {
    // Sem override explícito, cada processo de teste fica com o próprio
    // banco: teste não pode disputar capacidade com produção real.
    return path.resolve(path.join(env.TEMP ?? os.tmpdir(), `mkt-videos-runtime-test-${process.pid}-${randomUUID()}.sqlite`));
  }
  const base = env.LOCALAPPDATA ?? env.USERPROFILE ?? coreRoot ?? os.homedir();
  return path.resolve(path.join(base, "GeradorDeVideos", "Runtime", "runtime.sqlite"));
}
