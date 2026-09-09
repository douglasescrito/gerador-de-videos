import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER_CAPABILITIES, PROVIDER_CAPABILITY_STATUSES } from "./provider-registry.mjs";
import { listCommands, PROTECTED_COMMAND_IDS } from "../cli/command-registry.mjs";

export const COMMAND_GOVERNANCE_SCHEMA = "mkt-videos/command-governance@1";
export const DEFAULT_GOVERNANCE_CORE_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const PROTECTED_COMMANDS = PROTECTED_COMMAND_IDS;

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownText(value) {
  const normalized = value == null || value === "" ? "—" : String(value);
  return normalized.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function inlineCode(value) {
  if (value == null || value === "") return "—";
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function codeList(values) {
  if (!Array.isArray(values) || values.length === 0) return "—";
  return values.map(inlineCode).join(", ");
}

// O nome de um arquivo não prova que ele implementa o comando. A cobertura
// confere também o contrato executar(contexto), sem importar os módulos:
// gerar documentação nunca pode inicializar adapters ou tocar provedores.
function handlerSourceCode(source) {
  return source.replace(
    /(["'`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (text) => text.replace(/[^\r\n]/g, " "),
  );
}

function validateCommandModuleCoverage(commandModules, commandIds) {
  if (!commandModules || typeof commandModules !== "object" || Array.isArray(commandModules)) {
    throw new Error("commandModules é obrigatório: mapa de id para código do módulo.");
  }
  const dispatched = new Set(Object.keys(commandModules));
  const idSet = new Set(commandIds);
  const missingHandlers = commandIds.filter((id) => !dispatched.has(id));
  const undocumentedHandlers = [...dispatched].filter((id) => !idSet.has(id));
  if (missingHandlers.length > 0) throw new Error(`Comandos sem módulo em lib/cli/commands: ${missingHandlers.join(", ")}.`);
  if (undocumentedHandlers.length > 0) throw new Error(`Handlers fora do registry: ${undocumentedHandlers.join(", ")}.`);
  const invalidHandlers = commandIds.filter((id) => {
    const source = commandModules[id];
    return typeof source !== "string" || !/^\s*export\s+async\s+function\s+executar\s*\(\s*contexto\s*\)\s*\{/m.test(handlerSourceCode(source));
  });
  if (invalidHandlers.length > 0) {
    throw new Error(`Módulos sem export async function executar(contexto): ${invalidHandlers.join(", ")}.`);
  }
}

function capabilityForCommand(command) {
  if (!command.capability) return null;
  const capability = PROVIDER_CAPABILITIES[command.capability];
  if (!capability) throw new Error(`Capacidade desconhecida na política de comando: ${command.capability}.`);
  return capability;
}

export function buildCommandGovernance({ commandModules, consumers = {} } = {}) {
  const registryCommands = listCommands();
  validateCommandModuleCoverage(commandModules, registryCommands.map((entry) => entry.id));
  const commands = registryCommands.map((entry) => {
    const capability = capabilityForCommand(entry);
    const status = entry.statusOverride ?? (entry.capabilityRequired && capability?.status !== "supported" ? capability.status : "supported");
    return {
      id: entry.id,
      status,
      protected: entry.protected,
      options: entry.options,
      actionValues: entry.actionValues,
      confirmationRequired: entry.confirmationRequired,
      conditionalConfirmations: entry.conditionalConfirmations,
      capability: capability?.id ?? null,
      capabilityStatus: capability?.status ?? null,
      replacement: entry.replacement ?? capability?.replacement ?? null,
      limitation: entry.limitation ?? capability?.limitation ?? null,
      consumers: consumers[entry.id] ?? { scripts: [], library: [], tests: [], docs: [] },
    };
  });
  for (const id of PROTECTED_COMMAND_IDS) {
    const command = commands.find((entry) => entry.id === id);
    if (!command) throw new Error(`Comando protegido ausente: ${id}.`);
    if (command.status !== "supported") throw new Error(`Comando protegido não suportado: ${id}.`);
  }
  const refine = commands.find((entry) => entry.id === "refine");
  if (!refine || refine.status !== "blocked" || !refine.replacement) {
    throw new Error("refine deve permanecer bloqueado com substituto explícito.");
  }
  return {
    schema: COMMAND_GOVERNANCE_SCHEMA,
    source: "lib/cli/command-registry.mjs",
    commands,
    summary: Object.fromEntries([...new Set(commands.map((entry) => entry.status))].sort(compareText).map((status) => [
      status,
      commands.filter((entry) => entry.status === status).length,
    ])),
  };
}

async function regularFiles(directory, accept) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(absolute, accept));
    else if (entry.isFile() && accept(absolute)) files.push(absolute);
  }
  return files;
}

function commandMatcher(command) {
  const literal = String(command);
  const id = escapeRegExp(command);
  const invocation = new RegExp(`npm\\s+run\\s+(?:video|image)\\s+--\\s+(?:\\([^\\r\\n]*\\)\\s*)?${id}(?=\\s|$)`, "m");
  const codeLiteral = new RegExp(`(?:command\\s*===\\s*|command:\\s*|\\[\\s*)[\"']${id}[\"']`);
  const proseLiteral = new RegExp(`\\\`${id}\\\``);
  return (source) => source.includes(literal) && (invocation.test(source) || codeLiteral.test(source) || proseLiteral.test(source));
}

function commandMentionIndex(commandIds) {
  // IDs do registry têm gramática fechada. Entradas genéricas da API mantêm
  // os matchers anteriores, inclusive metacaracteres e nomes com espaços.
  if (!commandIds.every((id) => typeof id === "string" && /^[a-z][a-z0-9-]*$/.test(id))) {
    const matchers = commandIds.map((id) => [id, commandMatcher(id)]);
    return (source) => new Set(matchers.filter(([, match]) => match(source)).map(([id]) => id));
  }
  const ids = new Set(commandIds);
  const alternatives = commandIds.map(escapeRegExp).join("|");
  const code = new RegExp(`(?=(?:command\\s*===\\s*|command:\\s*|\\[\\s*)["'](${alternatives})["'])`, "g");
  // Lookahead mantém menções que compartilham a crase de fechamento/abertura.
  const prose = new RegExp(`(?=\`(${alternatives})\`)`, "g");
  const name = /[a-z][a-z0-9-]*(?=\s|$)/y;
  const whitespace = /\s*/y;
  return (source) => {
    const found = new Set();
    for (const matcher of [code, prose]) for (const match of source.matchAll(matcher)) found.add(match[1]);
    const at = (offset) => {
      name.lastIndex = offset;
      const candidate = name.exec(source)?.[0];
      if (ids.has(candidate)) found.add(candidate);
    };
    for (const prefix of source.matchAll(/npm\s+run\s+(?:video|image)\s+--\s+/g)) {
      const start = prefix.index + prefix[0].length;
      at(start);
      if (source[start] !== "(") continue;
      const ends = [source.indexOf("\r", start), source.indexOf("\n", start)].filter((index) => index !== -1);
      const end = ends.length ? Math.min(...ends) : source.length;
      // O padrão antigo retrocede sobre cada fechamento possível. Enumerar
      // todos preserva inclusive duas invocações/parenteses na mesma linha.
      for (let close = source.indexOf(")", start + 1); close !== -1 && close < end; close = source.indexOf(")", close + 1)) {
        whitespace.lastIndex = close + 1;
        const spaces = whitespace.exec(source)[0];
        at(close + 1 + spaces.length);
      }
    }
    return found;
  };
}

export async function collectCommandConsumers({
  coreRoot = DEFAULT_GOVERNANCE_CORE_ROOT,
  commandIds,
} = {}) {
  if (!Array.isArray(commandIds) || commandIds.length === 0) throw new Error("commandIds é obrigatório.");
  const mentions = commandMentionIndex(commandIds);
  const absoluteRoot = path.resolve(coreRoot);
  const groups = {
    scripts: await regularFiles(path.join(absoluteRoot, "scripts"), (file) =>
      file.endsWith(".mjs") &&
      path.basename(file) !== "omni-cli.mjs" &&
      path.basename(file) !== "generate-governance-docs.mjs"),
    library: await regularFiles(path.join(absoluteRoot, "lib"), (file) => file.endsWith(".mjs") && path.basename(file) !== "command-registry.mjs"),
    tests: await regularFiles(path.join(absoluteRoot, "test"), (file) =>
      file.endsWith(".test.mjs") && path.basename(file) !== "governance-docs.test.mjs"),
    docs: (await readdir(absoluteRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(absoluteRoot, entry.name))
      .sort(compareText),
  };
  const contents = {};
  for (const [group, files] of Object.entries(groups)) {
    contents[group] = await Promise.all(files.map(async (file) => ({
      file,
      commands: mentions(await readFile(file, "utf8")),
    })));
  }
  return Object.fromEntries(commandIds.map((command) => [
    command,
    Object.fromEntries(Object.entries(contents).map(([group, files]) => [
      group,
      files
        .filter((entry) => entry.commands.has(command))
        .map((entry) => path.relative(absoluteRoot, entry.file).replaceAll("\\", "/"))
        .sort(compareText),
    ])),
  ]));
}

export async function loadCommandGovernance({ coreRoot = DEFAULT_GOVERNANCE_CORE_ROOT } = {}) {
  const absoluteRoot = path.resolve(coreRoot);
  const commandsDirectory = path.join(absoluteRoot, "lib", "cli", "commands");
  const moduleFiles = (await regularFiles(commandsDirectory, (file) => file.endsWith(".mjs")))
    .filter((file) => path.dirname(file) === commandsDirectory);
  const commandModules = Object.fromEntries(await Promise.all(moduleFiles.map(async (file) => [
    path.basename(file, ".mjs"),
    await readFile(file, "utf8"),
  ])));
  const commandIds = listCommands().map((entry) => entry.id);
  validateCommandModuleCoverage(commandModules, commandIds);
  const consumers = await collectCommandConsumers({ coreRoot: absoluteRoot, commandIds });
  return buildCommandGovernance({ commandModules, consumers });
}

export function renderCapabilityDocumentation({ capabilities = PROVIDER_CAPABILITIES } = {}) {
  const entries = Object.values(capabilities).sort((left, right) => compareText(left.id, right.id));
  if (entries.length === 0) throw new Error("Provider registry vazio.");
  for (const entry of entries) {
    if (!PROVIDER_CAPABILITY_STATUSES.includes(entry.status)) throw new Error(`Status inválido para ${entry.id}: ${entry.status}.`);
  }
  const summary = Object.fromEntries(PROVIDER_CAPABILITY_STATUSES.map((status) => [
    status,
    entries.filter((entry) => entry.status === status).length,
  ]));
  const lines = [
    "# Capacidades dos provedores",
    "",
    "> Documento gerado de `lib/media-pipeline/provider-registry.mjs`. Não editar manualmente.",
    "> Regere com `node scripts/generate-governance-docs.mjs`.",
    "",
    "Este mapa registra capacidade operacional, contrato de autenticação e elegibilidade como dependência de entrega. Ele não executa probes nem chama provedores.",
    "",
    `Total: ${entries.length}. ${PROVIDER_CAPABILITY_STATUSES.map((status) => `${summary[status]} ${inlineCode(status)}`).join("; ")}.`,
    "",
    "| Provedor | Status | Operações | Autenticação | Reconcile | Pode ser dependência de entrega | Evidência |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...entries.map((entry) => [
      inlineCode(entry.id),
      inlineCode(entry.status),
      codeList(entry.operations),
      inlineCode(entry.authContract),
      entry.reconcile ? "sim" : "não",
      entry.deliveryDependencyAllowed ? "sim" : "não",
      `${inlineCode(entry.evidence)} (${markdownText(entry.evidenceAt)})`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Limitações e substitutos",
    "",
    ...entries.flatMap((entry) => [
      `### ${inlineCode(entry.id)}`,
      "",
      `- Limitação: ${markdownText(entry.limitation)}`,
      `- Substituto: ${markdownText(entry.replacement)}`,
      `- Estabilidade: ${inlineCode(entry.stability)}`,
      `- TTL da evidência: ${entry.ttlSeconds == null ? "não definido" : `${entry.ttlSeconds} segundos`}`,
      "",
    ]),
    "## Regra operacional",
    "",
    "Somente capacidades `supported` com `deliveryDependencyAllowed: true` podem ser dependência obrigatória de entrega. Estados `pending`, `blocked` e `deprecated` falham fechados; não autorizam repetição automática nem consumo de cota.",
    "",
  ];
  return lines.join("\n");
}

function consumerSummary(consumers) {
  return ["scripts", "library", "tests", "docs"]
    .map((group) => `${group}:${consumers?.[group]?.length ?? 0}`)
    .join("; ");
}

export function renderCommandStatusDocumentation(governance) {
  if (governance?.schema !== COMMAND_GOVERNANCE_SCHEMA || !Array.isArray(governance.commands)) {
    throw new Error(`Governança de comandos deve usar ${COMMAND_GOVERNANCE_SCHEMA}.`);
  }
  const lines = [
    "# Status dos comandos",
    "",
    "> Documento gerado de `lib/cli/command-registry.mjs` (opções e política de cada comando) e de `lib/cli/commands/<id>.mjs` (cobertura do contrato `executar(contexto)`), mais o provider registry.",
    "> Não editar manualmente. Regere com `node scripts/generate-governance-docs.mjs`.",
    "",
    `Total: ${governance.commands.length} comandos. ${Object.entries(governance.summary).map(([status, count]) => `${count} ${inlineCode(status)}`).join("; ")}.`,
    "",
    `Contratos protegidos: ${PROTECTED_COMMANDS.map(inlineCode).join(", ")}. Todos permanecem suportados.`,
    "",
    "Consumidores são uma varredura conservadora de menções explícitas, agrupada em `scripts`, `library`, `tests` e documentos Markdown da raiz. A biblioteca inclui o contexto e os módulos de comandos do CLI. Os números orientam revisão; não provam uso em produção.",
    "",
    "| Comando | Status | Protegido | Opções | Confirmação | Capacidade | Consumidores | Substituto ou limitação |",
    "| --- | --- | --- | ---: | --- | --- | --- | --- |",
    ...governance.commands.map((entry) => {
      const replacement = entry.replacement ? String(entry.replacement).replace(/[.\s]+$/, "") : null;
      const guidance = [replacement ? `Substituto: ${replacement}.` : null, entry.limitation].filter(Boolean).join(" ");
      const capability = entry.capability ? `${inlineCode(entry.capability)} (${inlineCode(entry.capabilityStatus)})` : "—";
      return [
        inlineCode(entry.id),
        inlineCode(entry.status),
        entry.protected ? "sim" : "não",
        entry.options.length,
        [
          ...entry.conditionalConfirmations.map((rule) =>
            `${inlineCode(rule.flag)} quando ${inlineCode(rule.when)}`
          ),
        ].filter(Boolean).join("; ") || "não",
        capability,
        markdownText(consumerSummary(entry.consumers)),
        markdownText(guidance),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
    }),
    "",
    "## Decisões protegidas",
    "",
    "- `approve`, `status`, `resume` e `reconcile` são contratos suportados e não são candidatos a poda.",
    "- `refine` por `interactionId` permanece bloqueado; a edição suportada envia o MP4 com `generate --task edit --video`.",
    "- `tts` usa Google Vids e `music` usa Flow Music; rotas alternativas de áudio não fazem parte do CLI.",
    "- `qa` semântico permanece bloqueado; QA técnico e `align` são provider-free e report-only. Uma produção que declare `automaticCorrections: true` pode consumir essa evidência no executor existente, dentro da autorização e do limite de tentativas.",
    "",
  ];
  return lines.join("\n");
}
