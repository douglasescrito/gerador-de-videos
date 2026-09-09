#!/usr/bin/env node

import { spawn } from "node:child_process";
import { open, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { replaceJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { scrubSensitiveObjects } from "./session-broker.mjs";
import { studioLocalPath } from "../lib/studio-local-config.mjs";

export const PERSISTENT_SESSION_SCHEMA = "mkt-videos/persistent-browser-session@1";
export const DEFAULT_CHROME = studioLocalPath('chromePath') ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export const PERSISTENT_SESSION_PROVIDERS = Object.freeze({
  google: Object.freeze({
    id: "google",
    profileDirectory: "google-ai-studio",
    credentialServices: ["GoogleAIStudio", "OmniProductStudio", "GoogleLabsFlow"],
    startUrl: "https://aistudio.google.com/",
    refreshUrls: [
      "https://aistudio.google.com/app/apps/bundled/omni-product-studio?showPreview=true&showAssistant=true",
      "https://aistudio.google.com/app/generate-speech?model=gemini-3.1-flash-tts-preview",
      "https://aistudio.google.com/apps/bundled/promptdj",
      "https://docs.google.com/videos/",
      // O Labs Flow entra por SSO do mesmo login. Pendurar aqui, em vez de um
      // provedor separado, é o que faz o token de labs.google ser renovado
      // junto — o provedor separado exigia login próprio e ficava parado.
      "https://labs.google/fx/pt/tools/flow",
    ],
    allowedDomains: ["google.com", "aistudio.google.com", "docs.google.com", "drive.google.com", "labs.google"],
    requiredCookies: ["SID", "__Secure-1PSID"],
  }),
  "flow-music": Object.freeze({
    id: "flow-music",
    profileDirectory: "google-ai-studio",
    credentialServices: ["FlowMusic"],
    startUrl: "https://www.flowmusic.app/",
    refreshUrls: ["https://www.flowmusic.app/"],
    allowedDomains: ["flowmusic.app"],
    requiredCookies: ["sb-sb-auth-token.0"],
  }),
  // O Google Labs Flow entra pelo mesmo login Google do perfil persistente: o
  // next-auth de labs.google é emitido por SSO quando o perfil já está logado.
  // Os cookies 1PSIDCC/1PSIDTS rotacionam em poucas horas, e foi essa rotação
  // que derrubou um lote no meio em 2026-08-28 — daí a renovação existir.
  "google-labs-flow": Object.freeze({
    id: "google-labs-flow",
    profileDirectory: "google-ai-studio",
    credentialServices: ["GoogleLabsFlow"],
    startUrl: "https://labs.google/fx/pt/tools/flow",
    refreshUrls: ["https://labs.google/fx/pt/tools/flow"],
    allowedDomains: ["google.com", "labs.google"],
    requiredCookies: ["__Secure-1PSID", "__Secure-next-auth.session-token"],
  }),
});

function sanitizeError(error) {
  return String(error?.message ?? error ?? "unknown")
    .replace(/(cookie|authorization|token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]")
    .slice(0, 500);
}

export function resolvePersistentSessionProvider(value) {
  const requested = String(value ?? "").trim().toLowerCase();
  const alias = requested === "google-ai-studio" || requested === "omni" ? "google" : requested === "flow" ? "flow-music" : requested;
  const provider = PERSISTENT_SESSION_PROVIDERS[alias];
  if (!provider) throw new Error(`Provedor de sessão inválido: ${requested || "ausente"}. Use google ou flow-music.`);
  return provider;
}

export function persistentSessionRoot(env = process.env) {
  const configured = String(env.MKT_VIDEO_SESSION_ROOT ?? "").trim();
  if (configured) return path.resolve(configured);
  const localAppData = String(env.LOCALAPPDATA ?? "").trim();
  if (!localAppData) throw new Error("LOCALAPPDATA indisponível para o perfil persistente.");
  return path.join(localAppData, "GeradorDeVideos", "BrowserSessions");
}

export function persistentSessionPaths(providerValue, root = persistentSessionRoot()) {
  const provider = resolvePersistentSessionProvider(providerValue);
  const profile = path.resolve(root, provider.profileDirectory);
  return {
    provider,
    profile,
    state: path.join(profile, provider.id === "google" ? "mkt-session-state.json" : `mkt-session-${provider.id}.json`),
    lock: path.join(profile, ".mkt-session.lock"),
  };
}

async function exists(file) {
  try { await stat(file); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

async function acquireProfileLock(lockFile) {
  await mkdir(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      return async () => {
        await handle.close().catch(() => {});
        await rm(lockFile, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = null;
      try { owner = JSON.parse(await readFile(lockFile, "utf8")); } catch {}
      if (processIsAlive(Number(owner?.pid))) throw new Error("O perfil persistente já está em uso por outro processo do gerador.");
      await rm(lockFile, { force: true });
    }
  }
  throw new Error("Não foi possível adquirir o perfil persistente.");
}

function domainAllowed(domain, allowedDomains) {
  const normalized = String(domain ?? "").replace(/^\./, "").toLowerCase();
  return allowedDomains.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

export function filterSessionCookies(cookies, providerValue, nowSeconds = Math.floor(Date.now() / 1000)) {
  const provider = resolvePersistentSessionProvider(providerValue);
  const unique = new Map();
  for (const cookie of cookies ?? []) {
    if (!cookie?.name || !cookie?.value || !domainAllowed(cookie.domain, provider.allowedDomains)) continue;
    if (Number.isFinite(cookie.expires) && cookie.expires > 0 && cookie.expires <= nowSeconds) continue;
    unique.set(`${cookie.domain}\n${cookie.path}\n${cookie.name}`, { ...cookie });
  }
  return [...unique.values()];
}

export function validatePersistentCookieSet(cookies, providerValue) {
  const provider = resolvePersistentSessionProvider(providerValue);
  const names = new Set((cookies ?? []).map((cookie) => cookie.name));
  const missing = provider.requiredCookies.filter((name) => !names.has(name));
  const minimum = provider.id === "google" ? 8 : 2;
  if (cookies.length < minimum || missing.length) return { ready: false, missing: missing.length ? missing : ["minimum-cookie-count"] };
  return { ready: true, missing: [] };
}

function runCredentialScript({ mode, service, input = null, spawnProcess = spawn } = {}) {
  const script = path.join(import.meta.dirname, "credential-cookies.ps1");
  return new Promise((resolve, reject) => {
    const child = spawnProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-Mode", mode,
      "-Service", service,
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => { if (stdout.length < 100_000) stdout += chunk; });
    child.stderr?.on?.("data", (chunk) => { if (stderr.length < 20_000) stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Credential Manager recusou ${mode} para ${service}: ${sanitizeError(stderr || `exit ${code}`)}`));
    });
    if (input == null) child.stdin?.end();
    else child.stdin?.end(input, "utf8");
  });
}

export async function storeSessionCookies(service, cookies, options = {}) {
  await runCredentialScript({ mode: "ImportStdin", service, input: JSON.stringify(cookies), spawnProcess: options.spawnProcess });
  return { service, cookieCount: cookies.length };
}

export async function credentialSessionStatus(service, options = {}) {
  const text = await runCredentialScript({ mode: "Status", service, spawnProcess: options.spawnProcess });
  return JSON.parse(text);
}

async function readSessionState(stateFile) {
  try { return JSON.parse(await readFile(stateFile, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function persistentSessionStatus({ provider: providerValue, root = persistentSessionRoot(), credentialStatus = credentialSessionStatus } = {}) {
  const paths = persistentSessionPaths(providerValue, root);
  const state = await readSessionState(paths.state);
  const credentials = await Promise.all(paths.provider.credentialServices.map(async (service) => {
    try { return await credentialStatus(service); }
    catch { return { schema: "mkt-videos/credential-cookie-meta@1", service, configured: false }; }
  }));
  return {
    schema: PERSISTENT_SESSION_SCHEMA,
    provider: paths.provider.id,
    configured: Boolean(state?.configured && await exists(paths.profile)),
    classification: state?.classification ?? "not_configured",
    lastRefreshAt: state?.lastRefreshAt ?? null,
    credentialManager: credentials.map(({ service, configured, cookies, updatedAt }) => ({ service, configured, cookies: cookies ?? null, updatedAt: updatedAt ?? null })),
    secretMaterialPersistedInProject: false,
  };
}

async function writeSessionState(paths, value) {
  await replaceJsonAtomic(paths.state, {
    schema: PERSISTENT_SESSION_SCHEMA,
    provider: paths.provider.id,
    configured: Boolean(value.configured),
    classification: value.classification,
    lastRefreshAt: value.lastRefreshAt ?? null,
    cookieCount: value.cookieCount ?? null,
    credentialServices: paths.provider.credentialServices,
    secretMaterialPersistedInProject: false,
  }, { label: "Estado da sessão persistente" });
}

async function waitForAuthentication({ context, page, provider, timeoutMs, interactive }) {
  const deadline = Date.now() + (interactive ? timeoutMs : Math.min(timeoutMs, 15_000));
  while (Date.now() < deadline) {
    const rawCookies = await context.cookies([provider.startUrl]).catch(() => []);
    const cookies = filterSessionCookies(rawCookies, provider.id);
    const validation = validatePersistentCookieSet(cookies, provider.id);
    const loginPage = /accounts\.google\.com|signin|login/i.test(page.url());
    scrubSensitiveObjects(cookies);
    if (validation.ready && !loginPage) return true;
    await page.waitForTimeout(interactive ? 1_000 : 2_000);
  }
  return false;
}

export async function refreshPersistentSession({
  provider: providerValue,
  interactive = false,
  timeoutMs = interactive ? 10 * 60_000 : 30_000,
  chrome = process.env.CHROME_PATH ?? DEFAULT_CHROME,
  root = persistentSessionRoot(),
  browserType = chromium,
  storeCookies = storeSessionCookies,
  allowInTests = false,
  allowUnconfiguredProfile = false,
} = {}) {
  if (process.env.NODE_ENV === "test" && !allowInTests) throw new Error("Provider-free test guard: perfil Chrome real é proibido em NODE_ENV=test.");
  const paths = persistentSessionPaths(providerValue, root);
  const wasConfigured = Boolean((await readSessionState(paths.state))?.configured);
  if (!interactive && !wasConfigured && !allowUnconfiguredProfile) {
    return { schema: PERSISTENT_SESSION_SCHEMA, provider: paths.provider.id, configured: false, ready: false, classification: "not_configured", refreshed: false };
  }

  const releaseLock = await acquireProfileLock(paths.lock);
  let context = null;
  let capturedCookies = [];
  try {
    context = await browserType.launchPersistentContext(paths.profile, {
      executablePath: chrome,
      headless: !interactive,
      args: ["--disable-background-networking"],
      locale: "pt-BR",
      viewport: { width: 1440, height: 960 },
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(paths.provider.startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const authenticated = await waitForAuthentication({ context, page, provider: paths.provider, timeoutMs, interactive });
    if (!authenticated) {
      await writeSessionState(paths, { configured: wasConfigured, classification: "login_required", lastRefreshAt: new Date().toISOString() });
      return { schema: PERSISTENT_SESSION_SCHEMA, provider: paths.provider.id, configured: wasConfigured, ready: false, classification: "login_required", refreshed: false };
    }

    for (const target of paths.provider.refreshUrls) {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null);
      await page.waitForTimeout(interactive ? 1_500 : 750);
    }
    capturedCookies = filterSessionCookies(await context.cookies(), paths.provider.id);
    const validation = validatePersistentCookieSet(capturedCookies, paths.provider.id);
    if (!validation.ready) throw new Error("A sessão autenticada não forneceu o conjunto mínimo de cookies esperado.");

    const stored = [];
    for (const service of paths.provider.credentialServices) stored.push(await storeCookies(service, capturedCookies));
    const refreshedAt = new Date().toISOString();
    await writeSessionState(paths, { configured: true, classification: "ready", lastRefreshAt: refreshedAt, cookieCount: capturedCookies.length });
    return {
      schema: PERSISTENT_SESSION_SCHEMA,
      provider: paths.provider.id,
      configured: true,
      ready: true,
      classification: "ready",
      refreshed: true,
      refreshedAt,
      cookieCount: capturedCookies.length,
      credentialServices: stored.map((entry) => entry.service),
      secretMaterialPersistedInProject: false,
    };
  } catch (error) {
    await writeSessionState(paths, { configured: wasConfigured, classification: "unavailable", lastRefreshAt: new Date().toISOString() }).catch(() => {});
    return {
      schema: PERSISTENT_SESSION_SCHEMA,
      provider: paths.provider.id,
      configured: wasConfigured,
      ready: false,
      classification: "unavailable",
      refreshed: false,
      error: sanitizeError(error),
    };
  } finally {
    scrubSensitiveObjects(capturedCookies);
    await context?.close().catch(() => {});
    await releaseLock();
  }
}

function launchOrdinaryChrome({ chrome, profile, url, timeoutMs, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(chrome, [
      `--user-data-dir=${profile}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--new-window",
      url,
    ], { windowsHide: false, stdio: "ignore" });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill?.();
      reject(new Error("Tempo esgotado aguardando o fechamento do Chrome de autenticação."));
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Chrome de autenticação encerrou com código ${code}.`));
    });
  });
}

export async function setupPersistentSession({
  provider: providerValue,
  timeoutMs = 10 * 60_000,
  chrome = process.env.CHROME_PATH ?? DEFAULT_CHROME,
  root = persistentSessionRoot(),
  launchLogin = launchOrdinaryChrome,
  refresh = refreshPersistentSession,
  allowInTests = false,
} = {}) {
  if (process.env.NODE_ENV === "test" && !allowInTests) throw new Error("Provider-free test guard: Chrome real é proibido em NODE_ENV=test.");
  const paths = persistentSessionPaths(providerValue, root);
  const releaseLock = await acquireProfileLock(paths.lock);
  try {
    await launchLogin({ chrome, profile: paths.profile, url: paths.provider.startUrl, timeoutMs });
  } catch (error) {
    await writeSessionState(paths, { configured: false, classification: "login_required", lastRefreshAt: new Date().toISOString() }).catch(() => {});
    return { schema: PERSISTENT_SESSION_SCHEMA, provider: paths.provider.id, configured: false, ready: false, classification: "login_required", refreshed: false, error: sanitizeError(error) };
  } finally {
    await releaseLock();
  }
  return refresh({
    provider: paths.provider.id,
    interactive: false,
    timeoutMs: 30_000,
    chrome,
    root,
    allowUnconfiguredProfile: true,
    allowInTests,
  });
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) throw new Error(`Argumento inesperado: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${token}.`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

export async function runPersistentSessionCommand(argv = process.argv.slice(2)) {
  const [action = "status", ...rest] = argv;
  const options = parseOptions(rest);
  if (action === "status") {
    const providers = options.provider ? [resolvePersistentSessionProvider(options.provider)] : Object.values(PERSISTENT_SESSION_PROVIDERS);
    return { schema: "mkt-videos/persistent-session-status@1", sessions: await Promise.all(providers.map((provider) => persistentSessionStatus({ provider: provider.id }))) };
  }
  if (!new Set(["setup", "capture", "refresh"]).has(action)) throw new Error("Ação de sessão inválida. Use setup, capture, refresh ou status.");
  const provider = resolvePersistentSessionProvider(options.provider);
  if (action === "setup") {
    console.error(`Um Chrome comum será aberto para autenticar ${provider.id}. Entre normalmente e feche essa janela para concluir a captura.`);
    return setupPersistentSession({
      provider: provider.id,
      timeoutMs: Number(options.timeout ?? 10 * 60_000),
      chrome: options.chrome ?? process.env.CHROME_PATH ?? DEFAULT_CHROME,
    });
  }
  return refreshPersistentSession({
    provider: provider.id,
    interactive: false,
    timeoutMs: Number(options.timeout ?? 30_000),
    chrome: options.chrome ?? process.env.CHROME_PATH ?? DEFAULT_CHROME,
    allowUnconfiguredProfile: action === "capture",
  });
}

if (process.argv[1] && path.basename(process.argv[1]) === "persistent-session.mjs" && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPersistentSessionCommand().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.ready === false && result.classification !== "not_configured") process.exitCode = 2;
  }).catch((error) => {
    console.error(sanitizeError(error));
    process.exitCode = 1;
  });
}
