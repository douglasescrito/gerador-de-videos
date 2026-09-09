import { registerHooks } from "node:module";
import { assertQueryResolution, assertQuerySpecifier } from "./cli-query-import-guard.mjs";

// Executa no próprio processo: dispensa o worker de --experimental-loader.
registerHooks({
  resolve(specifier, context, nextResolve) {
    assertQuerySpecifier(specifier);
    return assertQueryResolution(nextResolve(specifier, context));
  },
});
