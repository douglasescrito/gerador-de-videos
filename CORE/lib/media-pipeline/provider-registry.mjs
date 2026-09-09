export const PROVIDER_REGISTRY_SCHEMA = "mkt-videos/provider-registry@1";
export const CAPABILITY_MAP_SCHEMA = "mkt-videos/capability-map@1";
export const PROVIDER_CAPABILITY_STATUSES = Object.freeze(["supported", "pending", "blocked", "deprecated"]);

export const PROVIDER_CAPABILITIES = Object.freeze({
  'gemini-context-text': Object.freeze({
    id: 'gemini-context-text', intents: Object.freeze(['text.contextual']),
    operations: Object.freeze(['context-text']), auth: Object.freeze(['credential-manager']),
    authContract: 'cookie-only-browser', reconcile: false, aspects: Object.freeze([]),
    stability: 'experimental', status: 'blocked', deliveryDependencyAllowed: false,
    evidence: 'diagnosticos/generator-context-text-live.json + diagnosticos/generator-context-text-lite-live.json',
    checkedAt: '2026-09-07T00:07:00.000Z', evidenceAt: '2026-09-07', ttlSeconds: 604800,
    limitation: 'Chat autenticado inspecionado, mas Gemini 3 Flash e 3.5 Flash Lite retornaram erro interno sem texto. Não habilitar sem nova prova válida.', replacement: null,
  }),
  'gemini-product-text': Object.freeze({
    id: 'gemini-product-text', intents: Object.freeze(['product.prompt']),
    operations: Object.freeze(['product-prompt']), auth: Object.freeze(['credential-manager']),
    authContract: 'cookie-only-browser', reconcile: false, aspects: Object.freeze([]),
    stability: 'experimental', status: 'supported', deliveryDependencyAllowed: false,
    evidence: 'diagnosticos/omni-text-contract-inspect-refreshed.json + diagnosticos/omni-text-live-validation.json',
    checkedAt: '2026-09-06T21:00:00.000Z', evidenceAt: '2026-09-06', ttlSeconds: 2592000,
    limitation: 'Direção textual de comerciais de produto. Modelo identificado no código remoto; não é chat genérico.', replacement: null,
  }),
  "ffmpeg-local": Object.freeze({
    id: "ffmpeg-local",
    intents: Object.freeze(["media.compose.local"]),
    operations: Object.freeze(["hybrid-compose"]),
    auth: Object.freeze(["none"]),
    authContract: "local-process",
    reconcile: false,
    aspects: Object.freeze(["16:9", "9:16", "1:1"]),
    stability: "stable",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "hybrid-compositor-contract-and-provider-free-conformance",
    checkedAt: "2026-07-27T12:00:00.000Z",
    evidenceAt: "2026-07-27",
    ttlSeconds: null,
    limitation: "Composição local determinística; não gera mídia de provider.",
    replacement: null,
  }),
  "playwright-html-local": Object.freeze({
    id: "playwright-html-local",
    intents: Object.freeze(["graphics.render.html"]),
    operations: Object.freeze(["html-render"]),
    auth: Object.freeze(["none"]),
    authContract: "local-no-auth",
    reconcile: false,
    aspects: Object.freeze(["16:9"]),
    stability: "candidate",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "html-motion-pilot-b-byte-exact-offline-replay",
    checkedAt: "2026-07-27T18:15:19.593Z",
    evidenceAt: "2026-07-27",
    ttlSeconds: null,
    limitation: "Renderer local Studio-only; não acessa provider nem altera raw.",
    replacement: null,
  }),
  ...Object.fromEntries(["hyperframes", "remotion"].map(engine => [`${engine}-html-local`, Object.freeze({
    id: `${engine}-html-local`,
    intents: Object.freeze(["graphics.render.html"]),
    operations: Object.freeze(["html-render"]),
    auth: Object.freeze(["none"]),
    authContract: "local-no-auth",
    reconcile: false,
    aspects: Object.freeze(["16:9", "9:16", "1:1"]),
    stability: "candidate",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "local-render-engines-parametric-offline-replay",
    checkedAt: "2026-09-06T18:00:00.000Z",
    evidenceAt: "2026-09-06",
    ttlSeconds: null,
    limitation: "Studio local, entrada JSON paramétrica, sem projetos executáveis ou áudio implícito.",
    replacement: null,
  })])),
  "gemini-image": Object.freeze({
    id: "gemini-image",
    intents: Object.freeze(["image.generate"]),
    operations: Object.freeze(["image-generate"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    aspects: Object.freeze(["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16"]),
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "cookie-adapter-and-provider-free-contract-tests",
    checkedAt: "2026-08-24T12:00:00.000Z",
    evidenceAt: "2026-08-24",
    ttlSeconds: 2_592_000,
    limitation: "Imagem intermediária não garante aceitação posterior pelo Gemini Omni.",
    replacement: null,
  }),
  "gemini-omni": Object.freeze({
    id: "gemini-omni",
    intents: Object.freeze(["video.generate.text", "video.generate.image", "video.generate.reference", "video.edit"]),
    operations: Object.freeze(["text-to-video", "image-to-video", "reference-to-video", "edit"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: true,
    aspects: Object.freeze(["16:9", "9:16"]),
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "cookie-adapter-and-provider-free-contract-tests",
    checkedAt: "2026-08-24T12:00:00.000Z",
    evidenceAt: "2026-08-24",
    ttlSeconds: 2_592_000,
    limitation: "Modelo preview; não repetir automaticamente estado ambíguo ou rejeição terminal.",
    replacement: null,
  }),
  "google-vids": Object.freeze({
    id: "google-vids",
    intents: Object.freeze(["narration.generate.single-voice"]),
    operations: Object.freeze(["text-to-speech"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "google-vids-live-cookie-adapter-wav-62s-2026-08-11",
    checkedAt: "2026-08-24T12:00:00.000Z",
    evidenceAt: "2026-08-24",
    ttlSeconds: 2_592_000,
    limitation: "A UI do Google Vids é experimental; o catálogo autenticado observado em 2026-08-12 contém 37 vozes e pode mudar no provedor. O adapter valida e confirma a voz selecionada antes de submeter, cria uma nova cena por padrão e nunca repete automaticamente uma submissão ambígua.",
    replacement: "Use provider omni somente por decisão humana após falha de preflight ou reconciliação explícita.",
  }),
  "google-vids-multi-voice": Object.freeze({
    id: "google-vids-multi-voice",
    adapterProvider: "google-vids",
    intents: Object.freeze(["narration.generate.segmented-multi-voice"]),
    operations: Object.freeze(["segmented-text-to-speech"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: true,
    stability: "candidate",
    status: "pending",
    deliveryDependencyAllowed: false,
    evidence: "live-proof-and-provider-free-replay-required",
    checkedAt: "2026-08-13T12:00:00.000Z",
    evidenceAt: "2026-08-13",
    ttlSeconds: null,
    limitation: "Bloqueada até prova live autorizada com WAV e recibo distintos por segmento, concatenação/mix e alinhamento Whisper global reproduzíveis.",
    replacement: null,
  }),
  "google-vids-video": Object.freeze({
    id: "google-vids-video",
    intents: Object.freeze(["video.generate.text.secondary"]),
    operations: Object.freeze(["text-to-video"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    aspects: Object.freeze(["16:9", "9:16"]),
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "google-vids-omni-live-clip-1280x720-24fps-aac-10s-2026-08-28",
    checkedAt: "2026-08-28T12:35:00.000Z",
    evidenceAt: "2026-08-28",
    ttlSeconds: 2_592_000,
    limitation: "Secundário ao gemini-omni e nunca selecionado sozinho: o intent é próprio (video.generate.text.secondary) para que a escolha continue humana. Clipes de 10 s fixos em 1280x720, comando só em inglês, marca ✦ queimada no canto inferior direito e cota mensal de 50 gerações. Sem reconciliação: a URL do MP4 é temporária e expira com a sessão.",
    replacement: "Use gemini-omni assim que o provedor voltar; este caminho existe para a janela em que o Omni do AI Studio está fora.",
  }),
  "google-flow-video": Object.freeze({
    id: "google-flow-video",
    intents: Object.freeze(["video.generate.text.secondary"]),
    operations: Object.freeze(["text-to-video"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    aspects: Object.freeze(["16:9", "9:16"]),
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "flow-video-adapter-ponta-a-ponta-1280x720-24fps-aac-8s-12-creditos-2026-08-28",
    checkedAt: "2026-08-28T19:20:00.000Z",
    evidenceAt: "2026-08-28",
    ttlSeconds: 2_592_000,
    limitation: "Secundário ao gemini-omni e nunca selecionado sozinho: o intent é próprio (video.generate.text.secondary) para que a escolha continue humana. Clipes de 4 a 10 s em 1280x720 com áudio, 16:9 ou 9:16, lote de até 4 por submissão, ~12 créditos por clipe, sem marca-d'água. O vídeo é assíncrono: o adapter espera a mídia aparecer no projeto, e um estado ambíguo nunca é repetido sozinho. Sem reconciliação.",
    replacement: "Use gemini-omni quando o provedor principal voltar.",
  }),
  "google-flow-image": Object.freeze({
    id: "google-flow-image",
    intents: Object.freeze(["image.generate.secondary"]),
    operations: Object.freeze(["image-generate"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    aspects: Object.freeze(["16:9", "9:16"]),
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "flow-image-adapter-ponta-a-ponta-1376x768-nano-banana-2-2026-08-28",
    checkedAt: "2026-08-28T19:20:00.000Z",
    evidenceAt: "2026-08-28",
    ttlSeconds: 2_592_000,
    limitation: "Secundário ao gemini-image, com intent próprio (image.generate.secondary) para que a escolha continue humana. Serve de quadro-chave enquanto o AI Studio devolve 404 de instant-ramen. O provedor escolhe o formato do arquivo — pediu PNG e veio JPEG — e o adapter corrige a extensão pelo Content-Type. O painel anuncia 0 créditos, mas o custo é do provedor e pode mudar.",
    replacement: "Use gemini-image quando o provedor principal voltar.",
  }),
  "flow-music": Object.freeze({
    id: "flow-music",
    intents: Object.freeze(["music.generate.timeline"]),
    operations: Object.freeze(["session-inspect", "music-generate"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "flow-music-live-cookie-adapter-wav-receipt-2026-07-29",
    checkedAt: "2026-08-24T12:00:00.000Z",
    evidenceAt: "2026-08-24",
    ttlSeconds: 2_592_000,
    limitation: "Adapter acompanha a UI experimental do Flow; preserva o original, publica WAV com recibos e nunca repete automaticamente estado ambíguo.",
    replacement: null,
  }),
  "gemini-vision": Object.freeze({
    id: "gemini-vision",
    intents: Object.freeze(["qa.semantic"]),
    operations: Object.freeze(["semantic-qa"]),
    auth: Object.freeze(["browser-session"]),
    authContract: "cookie-only-browser-session",
    reconcile: false,
    stability: "candidate",
    status: "blocked",
    deliveryDependencyAllowed: false,
    evidence: "cookie-only-adapter-not-verified",
    checkedAt: "2026-08-24T12:00:00.000Z",
    evidenceAt: "2026-08-24",
    ttlSeconds: null,
    limitation: "QA semântico não possui adapter cookie-only verificável.",
    replacement: "Use QA técnico local explícito e report-only.",
  }),
  "grok-miner": Object.freeze({
    id: "grok-miner",
    intents: Object.freeze(["prompt.mine"]),
    operations: Object.freeze(["prompt-mining", "image-prompt-generation", "video-prompt-generation"]),
    auth: Object.freeze(["credential-manager", "browser-session"]),
    authContract: "credential-manager-grok-session",
    reconcile: false,
    aspects: Object.freeze(["16:9", "9:16", "1:1"]),
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: "grok-prompt-miner-dublee-contract-tests",
    checkedAt: "2026-08-24T12:00:00.000Z",
    evidenceAt: "2026-08-24",
    ttlSeconds: 2_592_000,
    limitation: "Mineração de prompts LLM/Vision com provedor externo Grok (xAI).",
    replacement: null,
  }),
});

function sanitizeMessage(error) {
  return String(error?.message ?? error ?? "unknown").replace(/(cookie|authorization|api[_-]?key|token|password)\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]").slice(0, 500);
}

function cloneCapability(capability) {
  return structuredClone(capability);
}

function projectCapabilityFreshness(capability, now = new Date()) {
  const projected = cloneCapability(capability);
  const current = new Date(now).getTime();
  const explicitExpiry = Date.parse(String(projected.expiresAt ?? ""));
  const checkedAt = Date.parse(String(projected.checkedAt ?? ""));
  const ttlMs = projected.ttlSeconds == null ? null : Number(projected.ttlSeconds) * 1000;
  const expiry = Number.isFinite(explicitExpiry) ? explicitExpiry : Number.isFinite(checkedAt) && Number.isFinite(ttlMs) ? checkedAt + ttlMs : null;
  if (expiry == null) return { ...projected, expiresAt: null, freshness: { status: "not-expiring", remainingMs: null } };
  const remainingMs = expiry - current;
  const expired = remainingMs <= 0;
  return {
    ...projected,
    ...(expired && projected.status === "supported" ? { status: "blocked", deliveryDependencyAllowed: false } : {}),
    expiresAt: new Date(expiry).toISOString(),
    freshness: {
      status: expired ? "expired" : remainingMs <= 7 * 86_400_000 ? "expiring-soon" : "valid",
      remainingMs,
      remainingDays: Math.floor(remainingMs / 86_400_000),
    },
  };
}

export function listProviderCapabilities({ status = null, now = new Date() } = {}) {
  const normalizedStatus = status == null ? null : String(status);
  if (normalizedStatus && !PROVIDER_CAPABILITY_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Status de capacidade inválido: ${normalizedStatus}.`);
  }
  return Object.values(PROVIDER_CAPABILITIES)
    .map((entry) => projectCapabilityFreshness(entry, now))
    .filter((entry) => normalizedStatus == null || entry.status === normalizedStatus);
}

export function buildCapabilityMap({ now = new Date() } = {}) {
  const checkedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const capabilities = listProviderCapabilities({ now });
  return {
    schema: CAPABILITY_MAP_SCHEMA,
    checkedAt,
    capabilities,
    summary: Object.fromEntries(PROVIDER_CAPABILITY_STATUSES.map((status) => [
      status,
      capabilities.filter((entry) => entry.status === status).length,
    ])),
  };
}

export async function loadEffectiveProviderCapabilities({ storeFile, now = new Date() } = {}) {
  const activations = await loadCapabilityActivations(storeFile ? { storeFile } : {});
  const merged = mergeActivatedCapabilities(PROVIDER_CAPABILITIES, activations, { now });
  return Object.freeze(Object.fromEntries(Object.entries(merged).map(([id, capability]) => [id, Object.freeze(projectCapabilityFreshness(capability, now))])));
}

export async function buildEffectiveCapabilityMap({ storeFile, now = new Date() } = {}) {
  const capabilitiesById = await loadEffectiveProviderCapabilities({ storeFile, now });
  const capabilities = Object.values(capabilitiesById).map(cloneCapability);
  return {
    schema: CAPABILITY_MAP_SCHEMA,
    checkedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    capabilities,
    summary: Object.fromEntries(PROVIDER_CAPABILITY_STATUSES.map((status) => [status, capabilities.filter((entry) => entry.status === status).length])),
  };
}

export function assertCapabilityExpiryWindow(capabilityMap, { minimumDays = 7, now = new Date() } = {}) {
  const threshold = new Date(now).getTime() + Number(minimumDays) * 86_400_000;
  const cliffs = capabilityEntries(capabilityMap).filter((entry) => entry.status === "supported"
    && entry.expiresAt != null
    && Date.parse(entry.expiresAt) <= threshold);
  if (cliffs.length) throw new Error(`Capabilities expiram em até ${minimumDays} dias: ${cliffs.map((entry) => `${entry.id} (${entry.expiresAt})`).join(", ")}.`);
  return true;
}

function capabilityEntries(capabilities) {
  if (Array.isArray(capabilities)) return capabilities;
  if (Array.isArray(capabilities?.providers)) return capabilities.providers;
  if (Array.isArray(capabilities?.capabilities)) return capabilities.capabilities;
  return Object.values(capabilities ?? {});
}

export function resolveCapabilityIntent(capabilities, { intent, operation = null, requireDelivery = true, capabilityId = null } = {}) {
  const normalizedIntent = String(intent ?? "").trim();
  if (!normalizedIntent) throw new Error("intent é obrigatório.");
  const candidates = capabilityEntries(capabilities).filter((entry) => Array.isArray(entry?.intents) && entry.intents.includes(normalizedIntent)
    && (capabilityId == null || entry.id === capabilityId));
  const eligible = candidates.filter((entry) => entry.status === "supported"
    && (!requireDelivery || entry.deliveryDependencyAllowed === true)
    && (operation == null || entry.operations?.includes(operation)));
  if (eligible.length > 1) throw new Error(`Intent ${normalizedIntent} possui mais de uma capability ativa; seleção automática é proibida.`);
  const capability = eligible[0] ?? null;
  return {
    schema: "mkt-videos/capability-intent-resolution@1",
    intent: normalizedIntent,
    operation,
    status: capability ? "ready" : "blocked",
    capability: capability ? cloneCapability(capability) : null,
    candidates: candidates.map((entry) => ({ id: entry.id, status: entry.status, evidence: entry.evidence ?? null })),
  };
}

export async function probeProviderRegistry({ probes = {}, now = new Date() } = {}) {
  const checkedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const providers = [];
  for (const capability of Object.values(PROVIDER_CAPABILITIES)) {
    const probe = probes[capability.id];
    if (!probe) {
      providers.push({ ...capability, health: { status: "unknown", checkedAt, reason: "probe_not_configured" } });
      continue;
    }
    try {
      const result = await probe();
      providers.push({ ...capability, health: { status: result?.ready === true ? "ready" : result?.ready === false ? "unavailable" : "unknown", checkedAt, detail: result?.status ?? null } });
    } catch (error) {
      providers.push({ ...capability, health: { status: "unavailable", checkedAt, error: sanitizeMessage(error) } });
    }
  }
  return { schema: PROVIDER_REGISTRY_SCHEMA, checkedAt, providers };
}

export function assertProviderCapability(registry, {
  provider,
  operation,
  auth = null,
  requireReconcile = false,
  requireDelivery = false,
  allowNonOperational = false,
  maxHealthAgeMs = null,
  now = new Date(),
} = {}) {
  const entry = registry?.providers?.find((item) => item.id === provider);
  if (!entry) throw new Error(`Provedor não registrado: ${provider}.`);
  if (!entry.operations.includes(operation)) throw new Error(`Operação ${operation} não declarada por ${provider}.`);
  if (auth && !entry.auth.includes(auth)) throw new Error(`Autenticação ${auth} não declarada por ${provider}.`);
  if (requireReconcile && !entry.reconcile) throw new Error(`${provider} não declara reconcile.`);
  if (!allowNonOperational && entry.status !== "supported") throw new Error(`${provider} está ${entry.status}; capacidade não operacional.`);
  if (requireDelivery && entry.deliveryDependencyAllowed !== true) throw new Error(`${provider} não pode ser dependência de entrega.`);
  if (entry.health?.status === "unavailable") throw new Error(`${provider} indisponível no último preflight.`);
  if (maxHealthAgeMs != null) {
    const age = (now instanceof Date ? now : new Date(now)).getTime() - Date.parse(entry.health?.checkedAt);
    if (!Number.isFinite(age) || age < 0 || age > Number(maxHealthAgeMs)) throw new Error(`${provider} possui health ausente ou vencido.`);
  }
  return entry;
}
import { loadCapabilityActivations, mergeActivatedCapabilities } from "./capability-lifecycle.mjs";
