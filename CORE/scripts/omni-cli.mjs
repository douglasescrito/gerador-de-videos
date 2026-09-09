#!/usr/bin/env node
import { createCliBootstrap } from "../lib/cli/bootstrap.mjs";
import { loadCommandContext } from "../lib/cli/context-loader.mjs";

const contexto = createCliBootstrap();
const {
  getCommand,
  listCommands,
  CliError,
  ERROR_CODES,
  dicaDeSugestao,
  args,
  command,
  parse,
  validateOptions,
  validateKnowledgeActionOptions,
  printCommandHelp,
} = contexto;

async function main() {
  const options = parse(args);
  validateOptions(command, options);
  validateKnowledgeActionOptions(command, options);
  if (command !== "help" && options.help) {
    printCommandHelp(command);
    return;
  }
  const endpoint = String(options.endpoint ?? process.env.OMNI_ENDPOINT ?? "http://127.0.0.1:3000").replace(/\/$/, "");

  if (!getCommand(command)) {
    // Antes: 147 linhas de ajuda sem dizer que o comando não existe. Quem
    // digitou errado tinha de descobrir sozinho o que aconteceu.
    throw new CliError(`Comando desconhecido: ${command}.`, {
      code: ERROR_CODES.USAGE,
      hint: dicaDeSugestao(command, listCommands().map((entrada) => entrada.id), {
        ondeProcurar: "Veja os comandos com: npm run video -- commands",
      }),
    });
  }
  const { executar } = await import(`../lib/cli/commands/${command}.mjs`);
  const commandContext = await loadCommandContext(contexto);
  await executar({ ...commandContext, options, endpoint });
}

main().catch(contexto.reportError);
