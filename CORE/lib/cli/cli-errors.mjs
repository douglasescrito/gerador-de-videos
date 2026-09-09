// Classificação opcional de erro para agentes, aditiva ao contrato atual do
// CLI. scripts/omni-cli.mjs sempre sai com process.exitCode = 1 em erro
// (comportamento preservado; dezenas de testes dependem disso) e imprime a
// mensagem humana em stderr como hoje. Quando o erro é um CliError com
// `code` reconhecido, uma linha JSON adicional entra em stderr para quem
// quiser decidir programaticamente sem parsear texto em português.
//
// Erros comuns (new Error(...)) continuam funcionando exatamente como antes
// e são classificados como `code: null` — este módulo nunca adivinha a
// categoria a partir do texto da mensagem; só comandos que optam
// explicitamente por lançar CliError ganham classificação.

export const ERROR_CODES = Object.freeze({
  USAGE: "usage",
  CONFIRMATION_REQUIRED: "confirmation_required",
  POLICY_DENIED: "policy_denied",
  PROVIDER_REJECTED: "provider_rejected",
  AMBIGUOUS_STATE: "ambiguous_state",
  DEPENDENCY_MISSING: "dependency_missing",
  INTEGRITY_FAILURE: "integrity_failure",
});

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

export class CliError extends Error {
  constructor(message, { code, hint = null, retryable = false } = {}) {
    super(message);
    if (!KNOWN_CODES.has(code)) throw new Error(`CliError.code inválido: ${code}.`);
    this.name = "CliError";
    this.code = code;
    this.hint = hint;
    this.retryable = retryable;
  }
}

export function classifyError(error) {
  if (error instanceof CliError) {
    return { code: error.code, hint: error.hint, retryable: error.retryable };
  }
  return { code: null, hint: null, retryable: false };
}
