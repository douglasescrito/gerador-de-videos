import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliError, ERROR_CODES } from "./cli-errors.mjs";

const briefFields = {
  brief: "userBrief", objective: "objective", audience: "audience", message: "message",
  genre: "genre", channel: "channel", aspect: "format", duration: "durationSeconds",
  "brief-id": "briefId", "project-id": "projectId", language: "language", cta: "cta", intent: "intent",
  "required-text": "requiredText", restriction: "restrictions", reference: "references",
  preference: "preferences", accessibility: "accessibility",
};
const listFields = new Set(["required-text", "restriction", "reference", "preference", "accessibility"]);
const inputActions = new Set(["suggest", "upcast", "validate", "resolve", "explain", "preflight", "diff", "dispatch", "plan"]);
const suggestionFiles = ["techniques-file", "story-file", "modules-file", "shots-file", "direction-file", "composition-file"];

function usage(message) {
  throw new CliError(message, { code: ERROR_CODES.USAGE, hint: "Veja os canais e exemplos com: npm run video -- recipe --help" });
}

function text(value, flag) {
  if (typeof value !== "string" || !value.trim()) usage(`--${flag} exige texto não vazio.`);
  return value.trim();
}

/** Seleção pura e barata, usada antes de importar o pipeline e também pelo handler. */
export function selectRecipeInput(options) {
  const action = String(options.action ?? "validate").trim().toLowerCase();
  const suppliedBriefFields = Object.keys(briefFields).filter((key) => options[key] !== undefined);
  if (options.profile !== undefined) {
    if (action !== "suggest") usage("--profile pertence a recipe suggest; consulte recipe profiles para listar.");
    text(options.profile, "profile");
  }
  if (action !== "suggest" && suggestionFiles.some((key) => options[key] !== undefined)) usage(`${suggestionFiles.map((key) => `--${key}`).join(", ")} pertencem a recipe suggest.`);
  if (action !== "suggest" && suppliedBriefFields.length) usage("Texto e parâmetros de brief pertencem a recipe suggest.");
  if (options.stdin != null && ![true, false, "true", "false"].includes(options.stdin)) usage("--stdin deve ser true ou false.");
  const channels = [
    ...(options.file !== undefined ? ["file"] : []),
    ...(options.stdin === true || options.stdin === "true" ? ["stdin"] : []),
    ...(options.json !== undefined ? ["json"] : []),
    ...(suppliedBriefFields.length ? ["flags"] : []),
  ];
  if (!inputActions.has(action)) {
    if (channels.length) usage(`recipe ${action} não recebe --file, --stdin, --json ou parâmetros de brief.`);
    return null;
  }
  if (channels.length !== 1) usage(`Use exatamente um canal de entrada: --file <arquivo.json>, --stdin, --json <JSON>${action === "suggest" ? " ou --brief <pedido> com os parâmetros do brief" : ""}.`);
  const channel = channels[0];
  if (channel === "file") return { channel, file: path.resolve(text(options.file, "file")) };
  if (channel === "stdin") return { channel };
  if (channel === "json") {
    const bytes = text(options.json, "json");
    try { JSON.parse(bytes); } catch { usage("--json contém JSON inválido; no PowerShell, --file ou --stdin evitam problemas de aspas."); }
    return { channel, bytes };
  }
  const required = ["brief", "objective", "duration", "aspect", "project-id", "root-scope-id", ...(options.profile ? [] : ["style"])];
  const missing = required.filter((key) => options[key] == null || options[key] === "");
  if (missing.length) usage(`recipe suggest por texto exige ${missing.map((key) => `--${key}`).join(", ")}. Exemplo: recipe suggest --brief "Explique o processo" --objective "Ensinar" --duration 12 --aspect 16:9 --project-id project:exemplo --root-scope-id client:exemplo --style flat-2d@1.`);
  const body = {};
  for (const [flag, field] of Object.entries(briefFields)) {
    if (options[flag] === undefined) continue;
    body[field] = listFields.has(flag)
      ? (Array.isArray(options[flag]) ? options[flag] : [options[flag]]).map((value) => text(value, flag))
      : text(options[flag], flag);
  }
  if (!/^client:[a-z0-9][a-z0-9:_-]*$/.test(options["root-scope-id"])) usage("--root-scope-id deve ser explícito no formato client:<id>.");
  body.clientId = options["root-scope-id"];
  body.durationSeconds = Number(body.durationSeconds);
  if (!Number.isSafeInteger(body.durationSeconds * 24) || body.durationSeconds * 24 < 3) usage("--duration deve representar ao menos três frames inteiros a 24 fps.");
  if (!["16:9", "9:16"].includes(body.format)) usage("--aspect deve ser 16:9 ou 9:16.");
  if (!body.briefId) body.briefId = `brief-${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 24)}`;
  return { channel, bytes: JSON.stringify(body) };
}

export async function readRecipeInput(selection, stdin) {
  if (selection.channel === "file") return { ...selection, bytes: await readFile(selection.file) };
  if (selection.channel === "stdin") {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return { channel: "stdin", bytes: Buffer.concat(chunks) };
  }
  return selection;
}
