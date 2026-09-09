import { readFile } from "node:fs/promises";
import {
  DEFAULT_REFERENCE_ROOT,
  assertProviderInputAuthorized,
  createProviderInputAuthorization,
  lintPromptForImitation,
  readProviderInputAuthorization,
  readReferenceIndex,
  scanReferenceLibrary,
  writeProviderInputAuthorization,
  writeReferenceIndex,
} from "../lib/media-pipeline/reference-governance.mjs";

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Argumento inesperado: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    const value = next == null || next.startsWith("--") ? true : next;
    if (value !== true) index += 1;
    if (options[key] == null) options[key] = value;
    else options[key] = Array.isArray(options[key]) ? [...options[key], value] : [options[key], value];
  }
  return { command, options };
}

function required(options, key) {
  const value = options[key];
  if (value == null || value === true || !String(value).trim()) throw new Error(`--${key} é obrigatório.`);
  return String(value);
}

function asArray(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function isTrue(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function help() {
  return `Governança provider-free da biblioteca de referências

  node scripts/reference-governance.mjs index --out diagnosticos/reference-index.json [--root "${DEFAULT_REFERENCE_ROOT}"]
  node scripts/reference-governance.mjs lint (--prompt "direção" | --prompt-file prompt.txt) [--index diagnosticos/reference-index.json] [--creator "Nome"]
  node scripts/reference-governance.mjs authorize --index diagnosticos/reference-index.json --reference <caminho-relativo|absoluto|sha256> --actor <nome> --scope <escopo> --role <papel> --operation <operação> --confirm-provider-input true --out <registro.json>
  node scripts/reference-governance.mjs verify-authorization --index <índice.json> --authorization <registro.json> --reference <referência> [--scope <escopo>] [--role <papel>] [--operation <operação>]

index lê somente cabeçalhos/metadados, caminho e SHA-256; não abre frames, não move
nem copia vídeos e não chama provedor. Todas as entradas permanecem
inspiration-evidence/local-study-only. authorize cria um sidecar explícito e não
altera essa classificação no índice. Arquivos existentes nunca são sobrescritos.`;
}

const { command, options } = parseArgs(process.argv.slice(2));
let result;

if (command === "help" || options.help) {
  result = { help: help() };
} else if (command === "index") {
  const index = await scanReferenceLibrary({
    root: options.root === true ? DEFAULT_REFERENCE_ROOT : options.root ?? DEFAULT_REFERENCE_ROOT,
    extensions: options.extensions == null ? undefined : String(options.extensions).split(","),
  });
  const out = await writeReferenceIndex(required(options, "out"), index);
  result = {
    schema: index.schema,
    out,
    root: index.root,
    fingerprint: index.fingerprint,
    videoCount: index.videoCount,
    policy: index.policy,
  };
} else if (command === "lint") {
  if (options.prompt != null && options["prompt-file"] != null) throw new Error("Use somente --prompt ou --prompt-file.");
  const prompt = options["prompt-file"] == null
    ? required(options, "prompt")
    : await readFile(required(options, "prompt-file"), "utf8");
  const referenceIndex = options.index == null ? null : await readReferenceIndex(required(options, "index"));
  result = lintPromptForImitation(prompt, {
    referenceIndex,
    creatorNames: asArray(options.creator),
  });
  if (!result.valid) process.exitCode = 2;
} else if (command === "authorize") {
  const index = await readReferenceIndex(required(options, "index"));
  const authorization = createProviderInputAuthorization({
    index,
    reference: required(options, "reference"),
    actor: required(options, "actor"),
    scope: required(options, "scope"),
    role: required(options, "role"),
    operation: required(options, "operation"),
    confirmed: isTrue(options["confirm-provider-input"]),
    issuedAt: options["issued-at"] ?? new Date(),
    expiresAt: options["expires-at"] ?? null,
    note: options.note ?? null,
  });
  const out = await writeProviderInputAuthorization(required(options, "out"), authorization);
  result = { ...authorization, out };
} else if (command === "verify-authorization") {
  const index = await readReferenceIndex(required(options, "index"));
  const authorization = await readProviderInputAuthorization(required(options, "authorization"));
  const verified = assertProviderInputAuthorized({
    index,
    authorization,
    reference: required(options, "reference"),
    scope: options.scope ?? null,
    role: options.role ?? null,
    operation: options.operation ?? null,
  });
  result = {
    valid: true,
    authorizationId: verified.authorization.id,
    reference: verified.reference.relativePath,
    sha256: verified.reference.sha256,
  };
} else {
  throw new Error(`Comando desconhecido: ${command}`);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
