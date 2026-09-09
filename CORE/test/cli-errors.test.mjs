import assert from "node:assert/strict";
import test from "node:test";
import { CliError, classifyError, ERROR_CODES } from "../lib/cli/cli-errors.mjs";

test("CliError exige um code reconhecido e carrega hint/retryable", () => {
  const error = new CliError("mensagem humana", { code: ERROR_CODES.CONFIRMATION_REQUIRED, hint: "repita com --confirm-provider-input true" });
  assert.equal(error.message, "mensagem humana");
  assert.equal(error.name, "CliError");
  assert.equal(error.code, ERROR_CODES.CONFIRMATION_REQUIRED);
  assert.equal(error.hint, "repita com --confirm-provider-input true");
  assert.equal(error.retryable, false);
  assert.ok(error instanceof Error);
});

test("CliError falha fechado para code desconhecido", () => {
  assert.throws(() => new CliError("x", { code: "not-a-real-code" }), /code inválido/);
});

test("classifyError só classifica CliError; Error comum sai como code null", () => {
  const cliError = new CliError("bloqueado", { code: ERROR_CODES.POLICY_DENIED, retryable: false });
  assert.deepEqual(classifyError(cliError), { code: ERROR_CODES.POLICY_DENIED, hint: null, retryable: false });

  const plain = new Error("qualquer coisa");
  assert.deepEqual(classifyError(plain), { code: null, hint: null, retryable: false });

  assert.deepEqual(classifyError("string não é Error"), { code: null, hint: null, retryable: false });
});

