export const PRODUCT_PROMPT_MODEL = 'gemini-3.1-flash-lite';

export function buildProductPromptRequest({ prompt, atmosphere = '' } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) throw new Error('Informe --prompt com até 20000 caracteres.');
  if (typeof atmosphere !== 'string' || atmosphere.length > 10000) throw new Error('Atmosfera inválida (máximo 10000 caracteres).');
  return { productDesc: prompt.trim(), atmosphereDesc: atmosphere.trim(), productImages: [], atmosphereImages: [] };
}

// Contrato observado no server.ts do app oficial em 2026-09-06.
// O sistema remoto dirige comerciais de produto: não é chat genérico.
export async function requestProductPrompt(frame, body) {
  let raw;
  try {
    raw = await frame.evaluate(async (requestBody) => {
      const response = await fetch('/api/generate-prompt', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody), signal: AbortSignal.timeout(180000),
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    }, body);
  } catch {
    throw new Error('external_effect_unknown: resposta de texto não recebida; não reenviar automaticamente.');
  }
  if (!raw.ok) throw new Error(`Resposta de texto HTTP ${raw.status}; sem repetição automática.`);
  let payload;
  try { payload = JSON.parse(raw.text); } catch {}
  if (typeof payload?.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > 100000) {
    throw new Error('Resposta de texto inválida; sem repetição automática.');
  }
  return payload.prompt.trim();
}
