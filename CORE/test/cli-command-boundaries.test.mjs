import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { listCommands } from "../lib/cli/command-registry.mjs";

import { cliFile, coreRoot, runNode } from "./fixtures/cli-boundary-runtime.mjs";

const invalidOption = "cli-boundary-option-that-does-not-exist";

// Cada processo usa cwd e runtime descartáveis. A largura limitada evita
// transformar uma verificação de CLI em disputa pelos recursos da máquina.
async function inspectCommands(commands, inspect) {
  let cursor = 0;
  const failures = [];
  await Promise.all(Array.from({ length: Math.min(4, commands.length) }, async () => {
    while (cursor < commands.length) {
      const command = commands[cursor++];
      try {
        await inspect(command);
      } catch (error) {
        failures.push(`${command.id}: ${error.message}`);
      }
    }
  }));
  return failures.sort();
}

test("todos os comandos importam, exibem ajuda e validam opções fora do cwd do projeto", { timeout: 240_000 }, async (context) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cli-command-boundaries-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const commands = listCommands();

  // --help retorna antes de executar o handler. Importar cada módulo também
  // detecta dependências relativas quebradas que a ajuda não alcançaria.
  const modules = commands.map(({ id }) => ({
    id,
    url: pathToFileURL(path.join(coreRoot, "lib", "cli", "commands", `${id}.mjs`)).href,
  }));
  const importScript = `
    const failures = [];
    globalThis.fetch = async () => { throw new Error("PROVIDER_FREE_IMPORT_GUARD"); };
    for (const { id, url } of ${JSON.stringify(modules)}) {
      try {
        const module = await import(url);
        if (typeof module.executar !== "function") throw new Error("export executar ausente");
      } catch (error) {
        failures.push(id + ": " + error.message);
      }
    }
    console.log(JSON.stringify({ checked: ${modules.length}, failures }));
  `;
  const imported = await runNode(["--input-type=module", "-e", importScript], { cwd, name: "imports" });
  const failures = [];
  if (imported.code !== 0) {
    failures.push(`importação dos handlers: ${imported.stderr || imported.failure}`);
  } else {
    try {
      const report = JSON.parse(imported.stdout);
      assert.equal(report.checked, commands.length);
      failures.push(...report.failures.map((failure) => `import: ${failure}`));
    } catch (error) {
      failures.push(`relatório de importação: ${error.message}`);
    }
  }

  failures.push(...await inspectCommands(commands, async ({ id }) => {
    const result = await runNode([cliFile, id, "--help"], { cwd, name: `help-${id}`, isolate: true });
    assert.equal(result.code, 0, `--help falhou: ${result.stderr || result.failure}`);
    assert.ok(result.stdout.trim(), "--help não produziu saída");
    if (id !== "help") assert.ok(result.stdout.startsWith(`${id} — `), "ajuda pertence a outro comando");
  }));

  failures.push(...await inspectCommands(commands, async ({ id }) => {
    const result = await runNode([cliFile, id, `--${invalidOption}`, "value"], { cwd, name: `invalid-${id}`, isolate: true });
    assert.equal(result.code, 1, `opção inválida não retornou erro de uso: ${result.stderr || result.failure}`);
    // Doctor preserva seu contrato próprio: falhas também saem como JSON
    // em stdout. Os demais comandos usam texto e classificação em stderr.
    const message = id === "doctor" ? JSON.parse(result.stdout).error?.message : result.stderr;
    assert.ok(message?.includes(`Opção desconhecida para ${id}: --${invalidOption}`), `validação não alcançada: ${message || result.failure}`);
    if (id !== "doctor") {
      const classification = JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1));
      assert.equal(classification.schema, "mkt-videos/cli-error@1");
      assert.equal(classification.code, "usage");
    }
  }));

  assert.deepEqual(failures, [], `Falhas nas fronteiras do CLI:\n${failures.join("\n")}`);
});
