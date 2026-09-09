// Um comando de consulta deve sobreviver mesmo sem a pilha produtiva disponível.
// O loader recusa dependências transitivas, não apenas imports do entrypoint.
import { assertQueryResolution, assertQuerySpecifier } from "./cli-query-import-guard.mjs";

export async function resolve(specifier, context, nextResolve) {
  assertQuerySpecifier(specifier);
  return assertQueryResolution(await nextResolve(specifier, context));
}
