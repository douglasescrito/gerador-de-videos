import { operationFingerprint } from "./pipeline-operation.mjs";
import { compileFilmSpec } from "./film-compiler.mjs";
import { createStudioBrief, assertStudioBrief } from "./studio-context.mjs";

export const STUDIO_GOLDEN_CORPUS_SCHEMA = "mkt-videos/studio-golden-briefs@1";
export const STUDIO_GOLDEN_REPORT_SCHEMA = "mkt-videos/studio-golden-report@1";

const REQUIRED_CATEGORIES = [
  "commercial",
  "documentary",
  "short-film",
  "motion",
  "official-person",
  "brand-conflict",
  "multi-client",
  "rights-unknown",
  "capability-unavailable",
  "preference-scope",
];

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function assertCorpus(value, label = "corpus") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  if (value.schema !== STUDIO_GOLDEN_CORPUS_SCHEMA) throw new Error(`${label}.schema inválido.`);
  if (value.version !== 1 || value.providerFree !== true || !Array.isArray(value.cases)) throw new Error(`${label} exige versão 1, providerFree e cases.`);
  if (value.cases.length !== 20) throw new Error(`${label} exige exatamente 20 briefs gold.`);
  const ids = new Set();
  for (const [index, entry] of value.cases.entries()) {
    const prefix = `${label}.cases[${index}]`;
    const id = text(entry?.id, `${prefix}.id`);
    if (ids.has(id)) throw new Error(`${prefix}.id duplicado.`);
    ids.add(id);
    text(entry?.category, `${prefix}.category`);
    if (!entry?.brief || typeof entry.brief !== "object" || Array.isArray(entry.brief)) throw new Error(`${prefix}.brief ausente.`);
    if (!entry?.expected || typeof entry.expected !== "object" || Array.isArray(entry.expected)) throw new Error(`${prefix}.expected ausente.`);
  }
  return clone(value);
}

function filmSpecForBrief(brief, entry) {
  const aspect = brief.format === "9:16" ? "9:16" : "16:9";
  const duration = Number(brief.durationSeconds ?? 8);
  return {
    schema: "mkt-videos/film-spec@2",
    name: `gold-${brief.briefId}`,
    brief,
    source: { request: brief.userBrief, directionPreset: null, effectiveDirection: null },
    narration: { mode: "none", text: null, blocks: [] },
    music: { mode: "none", intent: null, fit: "none", tailSeconds: 0 },
    timeline: { fps: { numerator: 24, denominator: 1 }, holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0 },
    scenes: [{
      id: `${entry.id}-scene`,
      role: brief.genre === "motion" ? "typography" : "spectacle",
      objective: brief.objective,
      visualPrompt: brief.userBrief,
      motionPrompt: brief.userBrief,
      onScreenText: brief.requiredText[0] ?? null,
      references: [],
      referenceAuthorizations: [],
      runtimeInputRoles: [],
      restrictions: brief.restrictions,
      generationTask: "text_to_video",
      durationHint: duration,
      image: { model: "gemini-3-pro-image", size: "2K" },
    }],
    formats: { master: aspect, variants: [] },
    brandKit: null,
    captions: { mode: "none" },
    qa: { enabled: false },
    reuse: { policy: "off" },
    execution: { concurrency: { draft: 1, video: 1, localCpu: 1 }, budget: {}, providers: {} },
    finishing: { audio: {}, assembly: {}, delivery: null },
  };
}

function countPaidNodes(plan) {
  return plan.nodes.filter((node) => String(node.costClass ?? node.executionClass ?? "").includes("paid") || String(node.capability ?? "").includes("paid")).length;
}

export function buildStudioGoldenReport(input) {
  const corpus = assertCorpus(input);
  const categories = Object.fromEntries(REQUIRED_CATEGORIES.map((category) => [category, 0]));
  const clients = new Set();
  const cases = corpus.cases.map((entry) => {
    const brief = assertStudioBrief(createStudioBrief({ ...entry.brief }));
    const plan = compileFilmSpec(filmSpecForBrief(brief, entry));
    const secondPlan = compileFilmSpec(filmSpecForBrief(brief, entry));
    if (plan.fingerprint !== secondPlan.fingerprint) throw new Error(`Caso ${entry.id} não é determinístico.`);
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    if (brief.clientId) clients.add(brief.clientId);
    return {
      id: entry.id,
      category: entry.category,
      clientId: brief.clientId,
      projectId: brief.projectId,
      briefHash: brief.hash,
      planFingerprint: plan.fingerprint,
      nodeCount: plan.nodes.length,
      paidNodeCount: countPaidNodes(plan),
      expected: clone(entry.expected),
      context: { status: "not-loaded", authority: "none", plannerInfluence: "none" },
      humanVerdict: "pending",
    };
  });
  const missingCategories = REQUIRED_CATEGORIES.filter((category) => !categories[category]);
  if (missingCategories.length) throw new Error(`Corpus gold sem cobertura: ${missingCategories.join(", ")}.`);
  const body = {
    schema: STUDIO_GOLDEN_REPORT_SCHEMA,
    corpusSchema: STUDIO_GOLDEN_CORPUS_SCHEMA,
    caseCount: cases.length,
    categories,
    clientCount: clients.size,
    cases,
    providerFree: true,
    providerCalls: 0,
    changed: false,
    crossClientIsolation: "asserted-by-brief-scope",
    humanVerdict: "pending",
    promotionPerformed: false,
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertStudioGoldenReport(value) {
  if (value?.schema !== STUDIO_GOLDEN_REPORT_SCHEMA) throw new Error("Schema de relatório gold inválido.");
  if (value.providerFree !== true || value.providerCalls !== 0 || value.changed !== false || value.promotionPerformed !== false) throw new Error("Relatório gold não é provider-free/read-only.");
  if (value.humanVerdict !== "pending") throw new Error("Relatório gold só pode aguardar veredito humano nesta fase.");
  if (value.caseCount !== 20 || !Array.isArray(value.cases) || value.cases.length !== 20) throw new Error("Relatório gold exige 20 casos.");
  if (value.fingerprint !== operationFingerprint(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "fingerprint")))) throw new Error("Relatório gold adulterado.");
  return clone(value);
}
