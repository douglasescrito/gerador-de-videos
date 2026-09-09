// Orçamento de parede do Studio.
//
// O alvo de 300 s é um SLO do pipeline, não uma promessa sobre a latência dos
// provedores. Os budgets por chamada são sinais de observabilidade e
// reconciliação antecipada, nunca deadlines destrutivos. Uma chamada já
// submetida continua até concluir ou até o timeout operacional explicitamente
// configurado; ultrapassar o SLO nunca autoriza cancelamento ou nova submissão.

export const STUDIO_WALL_TARGET_MS = 300_000;

export const PROVIDER_WAIT_POLICY = Object.freeze({
  flow: Object.freeze({ defaultMs: 240_000, softBudgetMs: 90_000 }),
  omni: Object.freeze({ defaultMs: 900_000, softBudgetMs: 180_000 }),
  vids: Object.freeze({ defaultMs: 180_000, softBudgetMs: 60_000 }),
});

export function resolveProviderWaitMs(provider, requested = null) {
  const policy = PROVIDER_WAIT_POLICY[String(provider)];
  if (!policy) throw new Error(`Política de espera desconhecida: ${provider}.`);
  const value = requested == null ? policy.defaultMs : Number(requested);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`timeout de ${provider} deve ser positivo.`);
  }
  return value;
}

export function providerWaitProjection(provider, requested = null) {
  const policy = PROVIDER_WAIT_POLICY[String(provider)];
  if (!policy) throw new Error(`Política de espera desconhecida: ${provider}.`);
  const requestedMs = requested == null ? policy.defaultMs : Number(requested);
  return {
    provider: String(provider),
    requestedMs,
    effectiveMs: resolveProviderWaitMs(provider, requestedMs),
    softBudgetMs: policy.softBudgetMs,
    overBudgetBehavior: "continue-and-reconcile-same-attempt",
    destructiveDeadline: false,
    wallTargetMs: STUDIO_WALL_TARGET_MS,
  };
}
