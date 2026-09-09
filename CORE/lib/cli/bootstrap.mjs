import { buildAllowedOptions, getCommand, listCommands, PROTECTED_COMMAND_IDS } from "./command-registry.mjs";
import { CliError, classifyError, ERROR_CODES } from "./cli-errors.mjs";
import { dicaDeSugestao, distanciaDeEdicao } from "./suggest.mjs";
import { validateResultFormat } from "./result-output.mjs";

// Argumentos, ajuda e erros não precisam de sessão, runtime ou adapters.
export function createCliBootstrap(argv = process.argv.slice(2)) {
  const args = [...argv];
  const command = args.shift() ?? "help";
  if (command === "recipe" && args[0] && !args[0].startsWith("--")) args.unshift("--action");

  const allowedOptions = buildAllowedOptions();

  const knowledgeActionAllowedOptions = {
    packs: new Set(["action", "help"]),
  };

  function parse(values) {
    const options = {};
    const unexpected = [];
    for (let index = 0; index < values.length; index += 1) {
      const token = values[index];
      if (!token.startsWith("--")) {
        unexpected.push(token);
        continue;
      }
      const key = token.slice(2);
      const next = values[index + 1];
      const value = next && !next.startsWith("--") ? values[++index] : true;
      if (command === "recipe" && ["root", "required-text", "restriction", "reference", "preference", "accessibility"].includes(key)) (options[key] ??= []).push(value);
      else if (command === "recipe" && Object.hasOwn(options, key)) throw new Error(`Opção repetida em recipe: --${key}. Forneça um único valor.`);
      else if (key === "image") (options.images ??= []).push(value);
      else if (key === "evidence-id") {
        (options["evidence-ids"] ??= []).push(value);
      }
      else if (key === "scene" && (command === "tts" || command === "reconcile" || command === "qa-scene-override")) options.scene = value;
      else if (key === "scene" || key === "tag" || key === "fallback-model" || key === "sidecar") (options[`${key}s`] ??= []).push(value);
      else options[key] = value;
    }
    if (unexpected.length) {
      throw new Error(`Argumentos posicionais inesperados: ${unexpected.join(" ")}. No PowerShell, use --prompt-file/--instruction-file para textos com aspas.`);
    }
    return options;
  }

  function validateOptions(commandName, options) {
    if (!allowedOptions[commandName]) return;
    for (const [key, value] of Object.entries(options)) {
      const displayKey = key === "images" ? "image" : key;
      if (!allowedOptions[commandName].has(key)) {
        // A opção certa quase sempre está a uma letra de distância, e o CLI
        // já sabe quais existem para este comando.
        throw new CliError(`Opção desconhecida para ${commandName}: --${displayKey}`, {
          code: ERROR_CODES.USAGE,
          hint: dicaDeSugestao(displayKey, [...allowedOptions[commandName]].map(displayOptionFlag).map((flag) => flag.slice(2)), {
            prefixo: "--",
            ondeProcurar: `Veja as opções deste comando com: npm run video -- ${commandName} --help`,
          }),
        });
      }
      const valuelessBoolean = commandName === "recipe" && key === "stdin";
      if (key !== "help" && !valuelessBoolean && (value === true || (Array.isArray(value) && value.some((item) => item === true)))) {
        throw new Error(`--${displayKey} exige um valor.`);
      }
    }
    if (options["output-format"] != null) validateResultFormat(options["output-format"], { command: commandName, action: options.action });
  }

  function validateKnowledgeActionOptions(commandName, options) {
    if (commandName !== "knowledge") return;
    const action = String(options.action ?? "status").trim().toLowerCase();
    const actionOptions = knowledgeActionAllowedOptions[action];
    if (!actionOptions) return;
    for (const key of Object.keys(options)) {
      if (actionOptions.has(key)) continue;
      const displayKey = key === "evidence-ids" ? "evidence-id" : key;
      throw new Error(
        `Opção desconhecida para knowledge --action ${action}: --${displayKey}`,
      );
    }
  }

  function required(value, label) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      // "--prompt é obrigatório." não dizia de qual comando, nem que existe
      // alternativa, nem como seria a linha certa. O registry tem as três
      // coisas.
      const definicao = getCommand(command);
      throw new CliError(`${label} é obrigatório em ${command}.`, {
        code: ERROR_CODES.USAGE,
        hint: definicao?.example ? `Exemplo: ${definicao.example}` : `Veja: npm run video -- ${command} --help`,
      });
    }
    return normalized;
  }

  function explicitBoolean(value, label, fallback = false) {
    if (value === undefined) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error(`${label} deve ser true ou false.`);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function resumoCurto(entrada) {
    return String(entrada.summary ?? "").split(/(?<=\.)\s/)[0];
  }

  function displayOptionFlag(option) {
    return `--${option === "images" ? "image" : option}`;
  }

  function printCommandHelp(id) {
    const command = getCommand(id);
    if (!command) {
      printHelp();
      process.exitCode = 1;
      return;
    }
    const policyLines = [
      command.statusOverride ? `Status: ${command.statusOverride}.` : null,
      command.capability ? `Capacidade: ${command.capability}${command.capabilityRequired ? " (obrigatória para entrega)" : ""}.` : null,
      command.replacement ? `Substituto: ${command.replacement}.` : null,
      command.limitation ? `Limitação: ${command.limitation}` : null,
      command.protected ? "Contrato protegido: sim." : null,
      ...command.conditionalConfirmations.map((rule) =>
        `Exige ${rule.flag} quando ${rule.when}.`
      ),
    ].filter((line) => line !== null);
    const lines = [
      `${command.id} — ${command.summary}`,
      ...(policyLines.length > 0 ? ["", ...policyLines] : []),
      "",
      `Opções: ${command.options.map(displayOptionFlag).join(", ")}`,
      ...(command.options.includes("output-format") ? ["Saída: --output-format json (padrão, completo) ou text (resumo).", ...(command.id === "recipe" ? ["Resumo em texto: suggest, validate, explain, preflight e plan."] : [])] : []),
      "",
      "Exemplo:",
      `  ${command.example}`,
      "",
      "Manifesto completo: npm run video -- commands --format json",
    ];
    console.log(lines.join("\n"));
  }

  function printHelp() {
    // Eram 147 linhas: todo fluxo e toda opção de 72 comandos numa parede de
    // texto que ninguém lê inteira. O detalhe não sumiu — mudou de lugar, para
    // `commands` (que agora agrupa e busca) e para o `--help` de cada comando,
    // que já traz resumo, opções e exemplo. Aqui fica o cartão: por onde se
    // começa, e como achar o resto.
    console.log(`Gemini Omni Video CLI — estúdio audiovisual cookie-only.

  Antes de gerar
    npm run video -- doctor                      pré-voo: sessão, endpoint, capacidades

  As rotas mais usadas
    npm run video -- generate --prompt "direção" --aspect 16:9 --collection <nome>
    npm run video -- batch --jobs jobs.json --parallel 3 --out-dir outputs/<lote>
    npm run video -- tts --text-file roteiro.txt --voice Nyla --out voz.wav
    npm run video -- music --prompt "motivo da trilha" --duration 30 --out trilha.wav
    npm run video -- join --mode studio --manifest metadados/assembly-selection.json --out filme.mp4

  Filme retomável (com aprovação e reconciliação)
    npm run video -- plan --spec filme.json
    npm run video -- run --state outputs/<filme>/metadados/film-state.json --confirm-fingerprint <hash>
    npm run video -- status --state outputs/<filme>/metadados/film-state.json

  Achar o comando certo
    npm run video -- commands                    as 8 famílias, com uma linha cada
    npm run video -- commands --grupo audio      só uma família
    npm run video -- commands --buscar trilha    busca por termo, tolera acento e plural
    npm run video -- <comando> --help            resumo, opções e exemplo do comando

  Depois de produzir
    npm run video -- colher --root outputs       registra o que de fato rodou em cada coleção
    npm run video -- jobs --root outputs         estado dos jobs, somente leitura
`);
  }

  function reportError(error) {
    if (command === "doctor") {
      const endpoint = String(process.env.OMNI_ENDPOINT ?? "http://127.0.0.1:3000").replace(/\/$/, "");
      console.log(JSON.stringify({ endpoint, reachable: false, configured: null, ready: false, health: "error", error: { message: errorMessage(error) } }, null, 2));
    } else {
      console.error(errorMessage(error));
      // A dica existia e só aparecia na linha JSON. Quem lê o terminal é
      // gente, e é para gente que ela foi escrita.
      if (error instanceof CliError && error.hint) console.error(error.hint);
      // Aditivo: process.exitCode continua sempre 1 (compatibilidade
      // preservada). Erros lançados como CliError ganham uma segunda linha em
      // stderr com code/hint/retryable para quem quiser decidir sem parsear
      // texto em português; erros comuns não são adivinhados e saem como
      // { code: null }.
      const classification = classifyError(error);
      if (classification.code) {
        console.error(JSON.stringify({ schema: "mkt-videos/cli-error@1", ...classification }));
      }
    }
    process.exitCode = 1;
  }

  return Object.freeze({
    buildAllowedOptions,
    getCommand,
    listCommands,
    PROTECTED_COMMAND_IDS,
    CliError,
    classifyError,
    ERROR_CODES,
    dicaDeSugestao,
    distanciaDeEdicao,
    args,
    command,
    allowedOptions,
    knowledgeActionAllowedOptions,
    parse,
    validateOptions,
    validateKnowledgeActionOptions,
    required,
    explicitBoolean,
    errorMessage,
    resumoCurto,
    displayOptionFlag,
    printCommandHelp,
    printHelp,
    reportError,
  });
}
