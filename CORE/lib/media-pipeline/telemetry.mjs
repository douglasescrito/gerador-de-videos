import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const TELEMETRY_EVENT_SCHEMA = "mkt-videos/telemetry-event@1";
const SECRET_KEY = /(cookie|authorization|api.?key|token|password|secret|sesskey|prompt|personal)/i;

export function sanitizeTelemetryAttributes(attributes = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (SECRET_KEY.test(key)) continue;
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) clean[key] = typeof value === "string"
      ? value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/(cookie|api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]").slice(0, 256)
      : value;
  }
  return clean;
}

export function createTelemetryEvent({ name, kind = "event", status = "ok", attributes = {}, at = new Date() } = {}) {
  if (!String(name ?? "").trim()) throw new Error("Evento de telemetria exige name.");
  return { schema: TELEMETRY_EVENT_SCHEMA, signal: "trace", name: String(name), kind: String(kind), status: String(status), at: (at instanceof Date ? at : new Date(at)).toISOString(), attributes: sanitizeTelemetryAttributes(attributes) };
}

export async function appendTelemetryEvent({ file, event } = {}) {
  if (event?.schema !== TELEMETRY_EVENT_SCHEMA) throw new Error("Evento de telemetria inválido.");
  const target = path.resolve(String(file));
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
  return target;
}
