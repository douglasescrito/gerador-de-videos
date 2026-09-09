export function normalizeEndpoint(endpoint) {
  const value = String(endpoint ?? "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("endpoint é obrigatório.");
  return value;
}

export function requireFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") throw new Error("Uma implementação de fetch é obrigatória.");
  return fetchImpl;
}

function unwrapErrorPayload(payload, fallbackStatus) {
  const wrapped = typeof payload?.error === "string" ? payload.error.match(/^\s*(\d{3})\s+(\{[\s\S]*\})\s*$/) : null;
  if (!wrapped) return { payload, status: fallbackStatus };
  try {
    return { payload: JSON.parse(wrapped[2]), status: Number(wrapped[1]) };
  } catch {
    return { payload, status: fallbackStatus };
  }
}

function errorDetail(payload, status) {
  const candidate = payload?.error ?? payload?.message;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (candidate?.message) return String(candidate.message);
  if (candidate && typeof candidate === "object") return JSON.stringify(candidate);
  return `HTTP ${status}`;
}

export class OmniHttpError extends Error {
  constructor(label, response, payload) {
    const normalized = unwrapErrorPayload(payload, response.status);
    const detail = errorDetail(normalized.payload, normalized.status);
    const providerError = normalized.payload?.error && typeof normalized.payload.error === "object" ? normalized.payload.error : normalized.payload;
    const code = providerError?.code ?? null;
    const inputBlocked = code === "invalid_request" && /input blocked/i.test(detail);
    const unsupportedExtension = /video extension is currently not supported/i.test(detail);
    const kind = inputBlocked ? "provider_input_blocked" : unsupportedExtension ? "unsupported_video_extension" : "provider_http_error";
    const retryable = normalized.status === 408 || normalized.status === 429 || normalized.status >= 500;
    const hint = inputBlocked
      ? "O filtro do provedor recusou o prompt ou a referência; para pessoa adulta reconhecível, tente reformular como personagem ficcional com inspiração solta da referência, 'not an exact likeness', em estilos como premium cinematic 3D, documentary-broadcast ou soft-realism; evite live-action, photorealistic real person, preserve identity e exact likeness."
      : unsupportedExtension
        ? "Extensão de vídeo não é suportada; gere o próximo clipe como uma nova interação."
        : null;
    super(`${label}: ${detail}${code ? ` [HTTP ${normalized.status}, ${code}]` : ` [HTTP ${normalized.status}]`}${hint ? ` ${hint}` : ""}`);
    this.name = "OmniHttpError";
    this.status = normalized.status;
    this.code = code;
    this.kind = kind;
    this.retryable = retryable;
    this.hint = hint;
    this.payload = normalized.payload;
  }
}

export async function responseJson(response, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new OmniHttpError(label, response, payload);
  return payload;
}

export function clockValue(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("O relógio retornou uma data inválida.");
  return date.toISOString();
}

export function requireText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}
