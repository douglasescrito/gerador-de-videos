import { chromium } from "playwright-core";

export const SESSION_BROKER_SCHEMA = "mkt-videos/session-broker@1";
export const SESSION_EVIDENCE_SCHEMA = "mkt-videos/session-evidence@1";

export const SESSION_PROFILES = Object.freeze({
  "google-ai-studio": Object.freeze({
    id: "google-ai-studio",
    credentialServices: ["GoogleAIStudio", "OmniProductStudio"],
    allowedOrigins: ["https://aistudio.google.com", "https://docs.google.com", "https://drive.google.com"],
  }),
  "omni-product-studio": Object.freeze({
    id: "omni-product-studio",
    credentialServices: ["OmniProductStudio"],
    allowedOrigins: [
      "https://aistudio.google.com",
      "https://docs.google.com",
      "https://drive.google.com",
    ],
    // O applet do Studio é servido num host próprio do Cloud Run, e esse host
    // muda de instalação para instalação. Fixar o host de uma máquina só faria
    // a sessão de qualquer outra pessoa ser recusada aqui.
    allowAppletOrigin: true,
  }),
  "google-vids": Object.freeze({
    id: "google-vids",
    credentialServices: ["GoogleAIStudio", "OmniProductStudio"],
    allowedOrigins: ["https://aistudio.google.com", "https://docs.google.com", "https://drive.google.com"],
  }),
  "flow-music": Object.freeze({
    id: "flow-music",
    credentialServices: ["FlowMusic"],
    allowedOrigins: ["https://www.flowmusic.app", "https://flowmusic.app"],
  }),
  grok: Object.freeze({
    id: "grok",
    credentialServices: ["Grok"],
    allowedOrigins: ["https://grok.com", "https://x.ai", "https://api.x.ai"],
  }),
});

// Host do applet: nome do serviço, região e run.app. Nada de subdomínio livre.
export const OMNI_PRODUCT_STUDIO_ORIGIN = /^https:\/\/omni-product-studio-[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/;
function message(error) {
  return String(error?.message ?? error ?? "unknown");
}

export function resolveSessionProfile(profile) {
  const id = String(profile ?? "").trim();
  const resolved = SESSION_PROFILES[id];
  if (!resolved) throw new Error(`Perfil de sessão desconhecido: ${id || "ausente"}.`);
  return resolved;
}

export function assertAllowedSessionTarget(profile, targetUrl) {
  const resolved = typeof profile === "string" ? resolveSessionProfile(profile) : profile;
  let origin;
  try { origin = new URL(String(targetUrl)).origin; }
  catch { throw new Error("URL de sessão inválida."); }
  const allowed = resolved.allowedOrigins.includes(origin) || (resolved.allowAppletOrigin === true && OMNI_PRODUCT_STUDIO_ORIGIN.test(origin));
  if (!allowed) throw new Error(`Origem não permitida para ${resolved.id}: ${origin}.`);
  return origin;
}

export function scrubSensitiveObjects(values) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    for (const key of Object.keys(value)) value[key] = "";
  }
  values.splice(0, values.length);
}

export function classifySessionProbe({ finalUrl = null, authenticated = false, ready = false, httpStatus = null, error = null } = {}) {
  const status = Number(httpStatus);
  const detail = message(error).toLowerCase();
  if (status === 401 || /unauthenticated|login required|sign in/.test(detail)) return "login_required";
  if (status === 403 || /permission|forbidden|does not have permission/.test(detail)) return "permission_denied";
  if (status === 429 || /quota|rate limit/.test(detail)) return "quota_exhausted";
  if (/selector|not found|não encontrado|nao encontrado|ui changed/.test(detail)) return "ui_changed";
  if (error) return "unavailable";
  if (ready) return "ready";
  if (authenticated) return "authenticated";
  if (finalUrl && /accounts\.google\.com|signin|login/i.test(String(finalUrl))) return "login_required";
  return "unknown";
}

async function loadCredentialCookies(profile, loader) {
  const failures = [];
  for (const service of profile.credentialServices) {
    try {
      const cookies = await loader(service);
      if (Array.isArray(cookies) && cookies.length) return { cookies, service };
    } catch {
      failures.push(service);
    }
  }
  throw new Error(`Nenhum cookie utilizável no Credential Manager para ${profile.id}. Serviços consultados: ${failures.join(", ") || "nenhum"}.`);
}

export function createSessionBroker({
  browserType = chromium,
  executablePath,
  loadCredentialCookies: credentialLoader,
  loadHarCookies: harLoader,
  loadCookieFileCookies: cookieFileLoader,
  waitAfterNavigationMs = 9_000,
} = {}) {
  if (!browserType?.launch) throw new Error("Session Broker exige browserType.launch.");
  if (!executablePath) throw new Error("Session Broker exige executablePath.");

  return {
    schema: SESSION_BROKER_SCHEMA,
    async open({ profile: profileId, targetUrl, authMode = "credential-manager", harFile = null, cookieFile = null, browserArgs = [], beforeNavigate = null } = {}) {
      const profile = resolveSessionProfile(profileId);
      const origin = assertAllowedSessionTarget(profile, targetUrl);
      const mode = String(authMode ?? "credential-manager");
      let credentialCookies = [];
      let credentialService = null;
      let browser = null;
      let context = null;
      let page = null;
      try {
        if (mode === "credential-manager") {
          if (typeof credentialLoader !== "function") throw new Error("Loader do Credential Manager indisponível.");
          const loaded = await loadCredentialCookies(profile, credentialLoader);
          credentialCookies = loaded.cookies;
          credentialService = loaded.service;
        } else if (mode === "har") {
          if (!harFile || typeof harLoader !== "function") throw new Error("Sessão HAR exige harFile e loader.");
          credentialCookies = await harLoader(harFile);
        } else if (mode === "cookie-file") {
          if (!cookieFile || typeof cookieFileLoader !== "function") throw new Error("Sessão cookie-file exige arquivo e loader.");
          credentialCookies = await cookieFileLoader(cookieFile);
        } else {
          throw new Error(`Modo de autenticação de sessão inválido: ${mode}.`);
        }
        if (!Array.isArray(credentialCookies) || !credentialCookies.length) throw new Error("A sessão não recebeu cookies utilizáveis.");

        browser = await browserType.launch({ executablePath, headless: true, args: ["--disable-background-networking", ...browserArgs] });
        context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1600, height: 1000 } });
        await context.addCookies(credentialCookies);
        page = await context.newPage();
        if (beforeNavigate) await beforeNavigate(page);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        if (waitAfterNavigationMs > 0) await page.waitForTimeout(waitAfterNavigationMs);

        let closed = false;
        return {
          schema: SESSION_BROKER_SCHEMA,
          profile: profile.id,
          origin,
          authSource: mode === "credential-manager" ? "credential-manager" : mode === "har" ? "har-cookie-import" : "cookie-file-import",
          credentialService,
          browser,
          context,
          page,
          evidence(extra = {}) {
            return {
              ...extra,
              schema: SESSION_EVIDENCE_SCHEMA,
              profile: profile.id,
              origin,
              authSource: mode === "credential-manager" ? "credential-manager" : mode === "har" ? "har-cookie-import" : "cookie-file-import",
              secretMaterialPersisted: false,
            };
          },
          async close() {
            if (closed) return [];
            closed = true;
            const errors = [];
            try { await context?.close(); } catch (error) { errors.push(error); }
            try { await browser?.close(); } catch (error) { errors.push(error); }
            scrubSensitiveObjects(credentialCookies);
            return errors;
          },
        };
      } catch (error) {
        const errors = [];
        try { await context?.close(); } catch (closeError) { errors.push(closeError); }
        try { await browser?.close(); } catch (closeError) { errors.push(closeError); }
        scrubSensitiveObjects(credentialCookies);
        if (errors.length) throw new AggregateError([error, ...errors], "Falha ao abrir e limpar sessão headless.");
        throw error;
      }
    },
  };
}
