import { lstat } from "node:fs/promises";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const BRAND_KIT_SCHEMA = "mkt-videos/brand-kit@1";
export const QA_POLICY_SCHEMA = "mkt-videos/qa-policy@1";

const stripAccents = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function createBrandKit({ id, version = 1, palette = [], typography = {}, logos = [], requiredTerms = [], forbiddenTerms = [], maxOnScreenWords = 12, safeAreas = {}, captionStyle = "kinetic-word@1", motion = {} } = {}) {
  const base = {
    schema: BRAND_KIT_SCHEMA,
    id: String(id ?? "").trim(),
    version: Number(version),
    palette: [...palette],
    typography: structuredClone(typography),
    logos: structuredClone(logos),
    requiredTerms: [...requiredTerms],
    forbiddenTerms: forbiddenTerms.map((entry) => typeof entry === "string" ? { term: entry, match: "word" } : structuredClone(entry)),
    maxOnScreenWords: Number(maxOnScreenWords),
    safeAreas: structuredClone(safeAreas),
    captionStyle,
    motion: structuredClone(motion),
  };
  if (!base.id || !Number.isInteger(base.version) || base.version < 1) throw new Error("brand-kit exige id e version inteiro positivo.");
  if (!Number.isInteger(base.maxOnScreenWords) || base.maxOnScreenWords < 1) throw new Error("brand-kit.maxOnScreenWords deve ser inteiro positivo.");
  return { ...base, hash: operationFingerprint(base) };
}

// Keep the historical installation policy only when its private module exists.
// The clean distribution has no client rules, logos or palette by default.
const legacyUrl = new URL('./legacy-commercial-brand.mjs', import.meta.url);
let legacy = null;
let legacyEditorial = null;
try {
  const info = await lstat(legacyUrl);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Política legada deve ser arquivo regular.');
  const module = await import(legacyUrl.href);
  legacy = module.legacyCommercialBrand;
  legacyEditorial = module.legacyCommercialEditorial ?? null;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
export const NEUTRAL_BRAND_KIT = Object.freeze(createBrandKit({ id: 'unbranded', logos: [], forbiddenTerms: [] }));
export const DEFAULT_COMMERCIAL_BRAND_KIT = legacy ? Object.freeze(createBrandKit(legacy)) : NEUTRAL_BRAND_KIT;
export const LEGACY_COMMERCIAL_EDITORIAL = legacyEditorial;
// Compatibility export for old local recipes; no private policy is bundled here.


export function findBrandTermViolations(value, brandKit = DEFAULT_COMMERCIAL_BRAND_KIT) {
  const normalized = stripAccents(value).toLowerCase();
  const findings = [];
  for (const rule of brandKit.forbiddenTerms ?? []) {
    const regex = rule.pattern ? new RegExp(rule.pattern, `${rule.flags ?? "i"}`.includes("g") ? rule.flags : `${rule.flags ?? "i"}g`) : new RegExp(`\\b${stripAccents(rule.term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const terms = [...normalized.matchAll(regex)].map((match) => match[0]);
    if (terms.length) findings.push({ code: "brand_forbidden_term", severity: "block", rule: rule.label ?? rule.id ?? rule.term, terms: [...new Set(terms)] });
  }
  return findings;
}

export function lintFilmBrand(spec, brandKit = spec?.brandKit) {
  if (!brandKit) return { schema: "mkt-videos/brand-lint@1", status: "pass", brandKit: null, findings: [] };
  if (brandKit.schema !== BRAND_KIT_SCHEMA || brandKit.hash !== operationFingerprint(Object.fromEntries(Object.entries(brandKit).filter(([key]) => key !== "hash")))) throw new Error("brand-kit inválido ou hash divergente.");
  const findings = [];
  const texts = [
    { scope: "narration", value: spec.narration?.text },
    ...spec.scenes.flatMap((scene) => [{ scope: `scene:${scene.id}:visual`, value: scene.visualPrompt }, { scope: `scene:${scene.id}:screen`, value: scene.onScreenText }]),
  ];
  for (const entry of texts) for (const finding of findBrandTermViolations(entry.value, brandKit)) findings.push({ ...finding, scope: entry.scope });
  for (const scene of spec.scenes) {
    const words = String(scene.onScreenText ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length > brandKit.maxOnScreenWords) findings.push({ code: "brand_text_density", severity: "block", scope: `scene:${scene.id}:screen`, words: words.length, maximum: brandKit.maxOnScreenWords });
    const logoRequired = brandKit.logos?.some((logo) => logo.requiredForRoles?.includes(scene.role));
    if (logoRequired && !(scene.references?.length)) findings.push({ code: "brand_logo_reference_missing", severity: "block", scope: `scene:${scene.id}` });
  }
  for (const term of brandKit.requiredTerms ?? []) {
    if (!texts.some((entry) => stripAccents(entry.value).toLowerCase().includes(stripAccents(term).toLowerCase()))) findings.push({ code: "brand_required_term_missing", severity: "warn", term });
  }
  return { schema: "mkt-videos/brand-lint@1", status: findings.some((entry) => entry.severity === "block") ? "blocked" : findings.length ? "warning" : "pass", brandKit: { id: brandKit.id, version: brandKit.version, hash: brandKit.hash }, findings };
}

export function assertFilmBrand(spec, brandKit = spec?.brandKit) {
  const report = lintFilmBrand(spec, brandKit);
  const blocking = report.findings.filter((entry) => entry.severity === "block");
  if (blocking.length) throw new Error(`Brand lint bloqueou o plano antes de qualquer provedor: ${blocking.map((entry) => `${entry.code} em ${entry.scope}`).join("; ")}.`);
  return report;
}

function qaPolicy(id, rules) {
  const base = { schema: QA_POLICY_SCHEMA, id, version: 1, rules: structuredClone(rules), ocrUnavailable: "block", autoRefine: false };
  return Object.freeze({ ...base, hash: operationFingerprint(base) });
}

export const QA_POLICIES = Object.freeze({
  "strict@1": qaPolicy("strict@1", {
    receipt_invalid: "block", audio_missing: "block", duration_mismatch: "block", black_interval: "block",
    long_freeze: "block", audio_clipping: "block", expected_text_not_found: "block", part_count_mismatch: "block",
  }),
  "editorial@1": qaPolicy("editorial@1", {
    receipt_invalid: "block", audio_missing: "block", duration_mismatch: "block", black_interval: "warn",
    long_freeze: "warn", audio_clipping: "block", expected_text_not_found: "block", part_count_mismatch: "block",
  }),
});

export function resolveQaPolicy(value = "strict@1") {
  const policy = typeof value === "string" ? QA_POLICIES[value] : value;
  if (!policy || policy.schema !== QA_POLICY_SCHEMA || !policy.id || policy.autoRefine !== false) throw new Error(`QA policy inválida: ${typeof value === "string" ? value : "objeto"}.`);
  return structuredClone(policy);
}
