// A mesma política atende os hooks síncrono e legado. Nenhum deles pode
// enfraquecer a barreira para tornar uma consulta mais rápida.
export function assertQuerySpecifier(specifier) {
  if (specifier === "node:sqlite" || /^(?:playwright|playwright-core)(?:\/|$)/.test(specifier)) {
    throw new Error(`CLI_QUERY_HEAVY_IMPORT_FORBIDDEN:${specifier}`);
  }
}

export function assertQueryResolution(result) {
  if (/\/(?:lib\/cli\/context|scripts\/cookie-studio-operations|lib\/media-pipeline\/index)\.mjs(?:$|[?#])/.test(result.url)) {
    throw new Error(`CLI_QUERY_HEAVY_IMPORT_FORBIDDEN:${result.url}`);
  }
  return result;
}
