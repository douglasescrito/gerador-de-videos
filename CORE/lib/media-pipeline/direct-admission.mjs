import { statfs } from "node:fs/promises";
import path from "node:path";
import { assertDirectProviderInputPermitJit } from "./direct-provider-input-permit.mjs";
import { evaluateRuntimeAdmission } from "./runtime-admission.mjs";

// Estimativas conservadoras de espaço por classe de saída. Não precisam ser
// exatas: servem para recusar antes do efeito quando o disco encheu — o que
// pode ter acontecido enquanto o job esperava vaga.
export const DIRECT_REQUIRED_BYTES = Object.freeze({
  video: 512 * 1024 * 1024,
  image: 128 * 1024 * 1024,
  audio: 128 * 1024 * 1024,
});

async function freeBytesFor(target) {
  try {
    const info = await statfs(path.dirname(path.resolve(String(target))));
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    // Sem medição confiável, não invente número: `null` faz o avaliador
    // pular a checagem de disco em vez de bloquear ou liberar por engano.
    return null;
  }
}

/**
 * Admissão para as rotas diretas e de lote, montada só com o que a rota
 * realmente tem em mãos.
 *
 * A capability vem do preflight que a própria invocação já calculou contra
 * o registro de capacidades; os rights vêm do permit de provider input
 * quando existe, e do escopo `no-provider-input` quando a chamada não tem
 * entrada nenhuma — que é como o journal já modela esse caso. Nada aqui é
 * sintetizado para satisfazer o portão: se a rota não prova, o relatório diz
 * que não prova.
 */
export function createDirectAdmission({
  invocation = null,
  preflight = null,
  permit = null,
  permitDescriptors = null,
  outputFile = null,
  requiredBytes = DIRECT_REQUIRED_BYTES.video,
  clock = () => new Date(),
} = {}) {
  // Ou a rota já construiu a invocação (e o preflight vem dela), ou passa o
  // preflight que calculou com capabilityPreflight. Sem um dos dois não há
  // o que afirmar sobre capability — e afirmar mesmo assim seria mentir.
  const resolvedPreflight = preflight ?? invocation?.preflight ?? null;
  if (resolvedPreflight == null) throw new Error("createDirectAdmission exige invocation ou preflight.");
  return async function admission({ phase } = {}) {
    const capabilityEntry = resolvedPreflight.capability ?? null;
    // Depois da fila, o permit pode ter vencido. É exatamente a verificação
    // que não pode ser reaproveitada de antes da espera.
    let permitBlocker = null;
    if (permit) {
      try {
        await assertDirectProviderInputPermitJit(permit, permitDescriptors ?? [], { requireAll: true });
      } catch (error) {
        permitBlocker = `provider_input_permit_invalid:${String(error?.message ?? error).slice(0, 120)}`;
      }
    }
    const evaluated = evaluateRuntimeAdmission({
      capability: capabilityEntry == null ? null : {
        id: capabilityEntry.id,
        status: capabilityEntry.status,
        proof: { valid: resolvedPreflight.status === "ready", hash: invocation?.fingerprint ?? null },
        expiresAt: capabilityEntry.freshness?.expiresAt ?? null,
      },
      rights: permitBlocker
        ? { id: null, status: "denied", revoked: false }
        : permit
          ? { id: permit.permitId ?? permit.fingerprint ?? "direct-provider-input-permit", status: "allowed", revoked: false }
          : { id: "no-provider-input", status: "allowed", revoked: false },
      freeBytes: outputFile == null ? null : await freeBytesFor(outputFile),
      requiredBytes,
      circuit: { status: "closed" },
      pendingAmbiguous: false,
      now: clock(),
    });
    if (!permitBlocker) return evaluated;
    return Object.freeze({
      ...evaluated,
      status: "blocked",
      blockers: [...new Set([...evaluated.blockers, permitBlocker])].sort(),
      checks: { ...evaluated.checks, phase: phase ?? null },
    });
  };
}
