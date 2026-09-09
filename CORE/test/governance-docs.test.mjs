import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listCommands } from "../lib/cli/command-registry.mjs";
import { KNOWLEDGE_ACTION_VALUES } from "../lib/knowledge-actions.mjs";
import {
  buildCommandGovernance,
  collectCommandConsumers,
  loadCommandGovernance,
  PROTECTED_COMMANDS,
  renderCapabilityDocumentation,
  renderCommandStatusDocumentation,
} from "../lib/media-pipeline/governance-docs.mjs";

const capabilityDocument = fileURLToPath(new URL("../docs/CAPABILITIES.md", import.meta.url));
const commandDocument = fileURLToPath(new URL("../docs/COMMAND-STATUS.md", import.meta.url));
const handlerSource = "export async function executar(contexto) { return contexto; }\n";

function completeCommandModules() {
  return Object.fromEntries(listCommands().map(({ id }) => [id, handlerSource]));
}

test("documentação de capacidades deriva deterministicamente do provider registry", async () => {
  const first = renderCapabilityDocumentation();
  const second = renderCapabilityDocumentation();
  assert.equal(first, second);
  assert.match(first, /\| `gemini-omni` \| `supported` \|/);
  assert.doesNotMatch(first, /`gemini-tts`|`lyria`/);
  assert.match(first, /\| `google-vids` \| `supported` \|/);
  assert.match(first, /Somente capacidades `supported` com `deliveryDependencyAllowed: true`/);
  assert.equal(await readFile(capabilityDocument, "utf8"), first);
});

test("mapa de comandos cobre todos os módulos do registry, protege fluxo oficial e bloqueia refine", async () => {
  const governance = await loadCommandGovernance();
  assert.equal(governance.commands.length, listCommands().length);
  for (const id of PROTECTED_COMMANDS) {
    const command = governance.commands.find((entry) => entry.id === id);
    assert.equal(command?.protected, true);
    assert.equal(command?.status, "supported");
  }
  const refine = governance.commands.find((entry) => entry.id === "refine");
  assert.equal(refine?.status, "blocked");
  assert.match(refine?.replacement, /generate --task edit --video/);
  assert.equal(governance.commands.find((entry) => entry.id === "tts")?.status, "supported");
  assert.equal(governance.commands.find((entry) => entry.id === "music")?.status, "supported");
  const knowledge = governance.commands.find((entry) => entry.id === "knowledge");
  assert.equal(knowledge?.status, "supported");
  assert.equal(knowledge?.confirmationRequired, false);
  assert.deepEqual(knowledge?.conditionalConfirmations, [{
    when: "--action em activate-release, rollback-release, review-item, provision-scopes, register-asset-link, capture-feedback, create-feedback-interpretation-candidate, review-feedback-interpretation ou canonicalize-feedback-interpretation",
    flag: "--confirm-human true",
  }]);
  assert.deepEqual(knowledge?.actionValues, KNOWLEDGE_ACTION_VALUES);
  assert.equal(knowledge?.capability, null);
  assert.match(knowledge?.limitation, /Provider-free.*raw.*não geram mídia.*cota/i);
  const commandsManifest = governance.commands.find((entry) => entry.id === "commands");
  assert.equal(commandsManifest?.status, "supported");
  const rendered = renderCommandStatusDocumentation(governance);
  assert.equal(await readFile(commandDocument, "utf8"), rendered);
});

test("checagem de cobertura recusa módulo ausente ou comando fora do registry", () => {
  const missingHandler = completeCommandModules();
  delete missingHandler.resume;
  assert.throws(
    () => buildCommandGovernance({ commandModules: missingHandler }),
    /Comandos sem módulo em lib\/cli\/commands: resume/,
  );

  assert.throws(
    () => buildCommandGovernance({ commandModules: { ...completeCommandModules(), ghost: handlerSource } }),
    /Handlers fora do registry: ghost/,
  );

  assert.doesNotThrow(() => buildCommandGovernance({ commandModules: completeCommandModules() }));
});

test("arquivo existente só conta se declara o handler executar(contexto)", () => {
  const invalidSources = [
    "",
    "export const executar = null;",
    "async function executar(contexto) {}",
    "export function executar(contexto) {}",
    "export async function outro(contexto) {}",
    `// ${handlerSource}`,
    `/*\n${handlerSource}*/`,
    `const exemplo = '${handlerSource.trim()}';`,
    `const exemplo = \`\n${handlerSource}\`;`,
  ];
  for (const source of invalidSources) {
    assert.throws(
      () => buildCommandGovernance({ commandModules: { ...completeCommandModules(), resume: source } }),
      /Módulos sem export async function executar\(contexto\): resume/,
      `Código sem handler aceito: ${JSON.stringify(source)}`,
    );
  }
  assert.doesNotThrow(() => buildCommandGovernance({ commandModules: {
    ...completeCommandModules(),
    resume: `// Documentação do comando.\n/* Sem carregar provider. */\n${handlerSource}`,
  } }));
});

test("loader inventaria arquivos reais sem importar os comandos nem executar código de topo", async (t) => {
  const coreRoot = await mkdtemp(path.join(os.tmpdir(), "cli-command-governance-"));
  t.after(() => rm(coreRoot, { recursive: true, force: true }));
  const commandsDirectory = path.join(coreRoot, "lib", "cli", "commands");
  await mkdir(commandsDirectory, { recursive: true });
  await Promise.all(listCommands().map(({ id }) => writeFile(
    path.join(commandsDirectory, `${id}.mjs`),
    `throw new Error("O inventário importou um comando.");\n${handlerSource}`,
  )));
  const governance = await loadCommandGovernance({ coreRoot });
  assert.deepEqual(governance.commands.map(({ id }) => id), listCommands().map(({ id }) => id));

  await rm(path.join(commandsDirectory, "status.mjs"));
  await assert.rejects(loadCommandGovernance({ coreRoot }), /Comandos sem módulo em lib\/cli\/commands: status/);
  await writeFile(path.join(commandsDirectory, "status.mjs"), "export const status = true;");
  await assert.rejects(loadCommandGovernance({ coreRoot }), /Módulos sem export async function executar\(contexto\): status/);
  await writeFile(path.join(commandsDirectory, "status.mjs"), handlerSource);
  await writeFile(path.join(commandsDirectory, "ghost.mjs"), handlerSource);
  await assert.rejects(loadCommandGovernance({ coreRoot }), /Handlers fora do registry: ghost/);
});

test("entrypoint não reintroduz a cadeia de comandos depois da extração completa", async () => {
  const source = await readFile(new URL("../scripts/omni-cli.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bcommand\s*===\s*["']/);
  assert.doesNotMatch(source, /\bswitch\s*\(\s*(?:contexto\.)?command\s*\)/);
});

test("buscas preparadas preservam sobreposição, metacaracteres e limites dos comandos", async (t) => {
  const coreRoot = await mkdtemp(path.join(os.tmpdir(), "command-consumer-matchers-"));
  t.after(() => rm(coreRoot, { recursive: true, force: true }));
  await mkdir(path.join(coreRoot, "scripts"));
  const sources = {
    "prose.mjs": '`go`go-long` e `a.+?`',
    "code.mjs": 'command === "go"; command: \'go-long\'; [ "a.+?" ]',
    "invocation.mjs": 'npm run video -- (primeiro) go --x (segundo) go-long\nnpm run image -- a.+?\n',
    "prefix.mjs": 'npm run video -- go-longer\ncommand === "go-longer"; `go-longer`',
  };
  for (const [name, source] of Object.entries(sources)) await writeFile(path.join(coreRoot, "scripts", name), source);
  const result = await collectCommandConsumers({ coreRoot, commandIds: ["go", "go-long", "a.+?", "missing"] });
  for (const command of ["go", "go-long", "a.+?"]) assert.deepEqual(result[command].scripts,
    ["scripts/code.mjs", "scripts/invocation.mjs", "scripts/prose.mjs"]);
  assert.deepEqual(result.missing.scripts, []);
  const indexed = await collectCommandConsumers({ coreRoot, commandIds: ["go", "go-long", "missing"] });
  for (const command of ["go", "go-long", "missing"]) assert.deepEqual(indexed[command], result[command]);
});
