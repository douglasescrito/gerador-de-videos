import { operationFingerprint } from "./pipeline-operation.mjs";

export const RENDERER_CONTRACT_SCHEMA = "mkt-videos/renderer-contract@1";
export const RENDERER_SANDBOX_SCHEMA = "mkt-videos/renderer-sandbox@1";
export const RENDERER_BAKE_OFF_SCHEMA = "mkt-videos/renderer-bake-off@1";

const DETERMINISM_CLASSES = new Set(["bit-exact", "frame-exact", "perceptual-stable", "non-deterministic"]);
const CANDIDATE_STATUSES = new Set(["candidate", "tested", "rejected", "selected"]);

function text(value, label, max = 256) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) throw new Error(`${label} é inválido.`);
  return normalized;
}

function hash(value, label) {
  const normalized = text(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} exige SHA-256.`);
  return normalized;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} deve ser booleano explícito.`);
  return value;
}

function canonical(value) {
  const body = structuredClone(value);
  delete body.fingerprint;
  return Object.freeze({ ...body, fingerprint: operationFingerprint(body) });
}

function assertFingerprint(value, label) {
  if (value?.fingerprint !== operationFingerprint(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "fingerprint")))) throw new Error(`${label} diverge do fingerprint.`);
  return value;
}

export function createRendererSandboxManifest({
  browser,
  node,
  ffmpeg,
  fonts = [],
  viewport,
  dpr = 1,
  locale = "pt-BR",
  timezone = "UTC",
  seed,
  cpuLimitMs = 120_000,
  memoryLimitMb = 1_024,
} = {}) {
  const body = {
    schema: RENDERER_SANDBOX_SCHEMA,
    network: false,
    cookies: false,
    implicitDownloads: false,
    filesystem: { mode: "declared-only", followSymlinks: false, followJunctions: false },
    browser: { name: text(browser?.name, "sandbox.browser.name"), version: text(browser?.version, "sandbox.browser.version"), sha256: hash(browser?.sha256, "sandbox.browser.sha256") },
    node: { version: text(node?.version, "sandbox.node.version"), sha256: hash(node?.sha256, "sandbox.node.sha256") },
    ffmpeg: { version: text(ffmpeg?.version, "sandbox.ffmpeg.version"), sha256: hash(ffmpeg?.sha256, "sandbox.ffmpeg.sha256") },
    fonts: (fonts ?? []).map((font, index) => ({ id: text(font?.id, `sandbox.fonts[${index}].id`), license: text(font?.license, `sandbox.fonts[${index}].license`), sha256: hash(font?.sha256, `sandbox.fonts[${index}].sha256`) })),
    viewport: { width: Number(viewport?.width), height: Number(viewport?.height) },
    dpr: Number(dpr),
    locale: text(locale, "sandbox.locale", 64),
    timezone: text(timezone, "sandbox.timezone", 64),
    clock: { mode: "frame-clock", dateNow: "blocked", performanceNow: "frame-clock", random: "seeded" },
    seed: text(seed, "sandbox.seed", 256),
    limits: { cpuLimitMs: Number(cpuLimitMs), memoryLimitMb: Number(memoryLimitMb) },
  };
  if (!Number.isSafeInteger(body.viewport.width) || body.viewport.width <= 0 || !Number.isSafeInteger(body.viewport.height) || body.viewport.height <= 0) throw new Error("sandbox.viewport exige dimensões inteiras positivas.");
  if (!Number.isFinite(body.dpr) || body.dpr <= 0 || body.dpr > 4) throw new Error("sandbox.dpr inválido.");
  if (!Number.isSafeInteger(body.limits.cpuLimitMs) || body.limits.cpuLimitMs < 1 || !Number.isSafeInteger(body.limits.memoryLimitMb) || body.limits.memoryLimitMb < 1) throw new Error("sandbox.limits inválido.");
  return canonical(body);
}

export function assertRendererSandboxManifest(value) {
  if (value?.schema !== RENDERER_SANDBOX_SCHEMA) throw new Error(`Schema esperado: ${RENDERER_SANDBOX_SCHEMA}.`);
  if (value.network !== false || value.cookies !== false || value.implicitDownloads !== false) throw new Error("Sandbox renderer exige rede, cookies e downloads bloqueados.");
  if (value.filesystem?.mode !== "declared-only" || value.filesystem.followSymlinks !== false || value.filesystem.followJunctions !== false) throw new Error("Sandbox renderer exige filesystem declarado sem links.");
  if (value.clock?.mode !== "frame-clock" || value.clock.dateNow !== "blocked" || value.clock.random !== "seeded") throw new Error("Sandbox renderer exige relógio por frame e aleatoriedade semântica.");
  return assertFingerprint(value, "renderer-sandbox@1");
}

export function createRendererContract({
  id,
  name,
  version,
  license,
  determinismClass = "frame-exact",
  capabilities = [],
  sandbox,
  inputKinds = ["timeline@2", "motion-ir@1"],
  outputKinds = ["image-sequence", "video-mezzanine"],
  status = "candidate",
} = {}) {
  if (!DETERMINISM_CLASSES.has(determinismClass)) throw new Error("Classe de determinismo do renderer inválida.");
  if (!CANDIDATE_STATUSES.has(status)) throw new Error("Status do renderer inválido.");
  const sandboxManifest = assertRendererSandboxManifest(sandbox);
  const body = {
    schema: RENDERER_CONTRACT_SCHEMA,
    id: text(id, "renderer.id"),
    name: text(name, "renderer.name"),
    version: text(version, "renderer.version"),
    license: text(license, "renderer.license"),
    determinismClass,
    capabilities: [...new Set((capabilities ?? []).map((value, index) => text(value, `renderer.capabilities[${index}]`)))].sort(),
    inputKinds: [...new Set((inputKinds ?? []).map((value, index) => text(value, `renderer.inputKinds[${index}]`)))].sort(),
    outputKinds: [...new Set((outputKinds ?? []).map((value, index) => text(value, `renderer.outputKinds[${index}]`)))].sort(),
    sandbox: sandboxManifest,
    status,
    providerFree: true,
    network: "blocked",
    cookies: "blocked",
  };
  return canonical(body);
}

export function assertRendererContract(value) {
  if (value?.schema !== RENDERER_CONTRACT_SCHEMA) throw new Error(`Schema esperado: ${RENDERER_CONTRACT_SCHEMA}.`);
  if (value.providerFree !== true || value.network !== "blocked" || value.cookies !== "blocked") throw new Error("Renderer contract não é provider-free ou não bloqueia sessão.");
  if (!DETERMINISM_CLASSES.has(value.determinismClass) || !CANDIDATE_STATUSES.has(value.status)) throw new Error("Renderer contract possui estado inválido.");
  assertRendererSandboxManifest(value.sandbox);
  return assertFingerprint(value, "renderer-contract@1");
}

export function buildRendererBakeOffReport({ candidates = [], corpus = [], decision = "pending" } = {}) {
  if (!Array.isArray(candidates) || !Array.isArray(corpus)) throw new Error("Bake-off exige candidates e corpus.");
  if (!new Set(["pending", "human-approved", "rejected"]).has(decision)) throw new Error("Decisão de bake-off inválida.");
  const normalized = candidates.map((candidate) => assertRendererContract(candidate)).sort((a, b) => a.id.localeCompare(b.id));
  const cases = corpus.map((entry, index) => ({
    id: text(entry?.id ?? `case-${index + 1}`, `bakeoff.corpus[${index}].id`),
    expected: text(entry?.expected, `bakeoff.corpus[${index}].expected`),
    results: Object.fromEntries(Object.entries(entry?.results ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  }));
  const body = {
    schema: RENDERER_BAKE_OFF_SCHEMA,
    candidates: normalized.map((candidate) => ({ id: candidate.id, fingerprint: candidate.fingerprint, status: candidate.status, determinismClass: candidate.determinismClass })),
    corpus: cases,
    decision,
    promotionPerformed: false,
    providerFree: true,
  };
  return canonical(body);
}

