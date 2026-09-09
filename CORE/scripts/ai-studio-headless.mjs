#!/usr/bin/env node
import { studioLocalPath } from '../lib/studio-local-config.mjs';

import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { assertPathAvailable, writeFileAtomic, writeJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { refreshPersistentSession, runPersistentSessionCommand } from "./persistent-session.mjs";
import { createSessionBroker } from "./session-broker.mjs";

const DEFAULT_URL = "https://aistudio.google.com/app/apps/bundled/omni-product-studio?showPreview=true&showAssistant=true";
const DEFAULT_CHROME = studioLocalPath('chromePath') ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const execFileAsync = promisify(execFile);

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Argumento inesperado: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para --${key}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

export function sanitizeSensitiveText(value, maxLength = 8_000) {
  let text = String(value ?? "");
  text = text
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, "<omitted data URL>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "<redacted-api-key>")
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<redacted-jwt>")
    .replace(/((?:api[_-]?key|authorization|cookie|token|secret|session|password|passwd|credential|sid|hsid|ssid)\s*[:=]\s*)(["'`])([^"'`\r\n]+)\2/gi, "$1$2<redacted>$2")
    .replace(/((?:api[_-]?key|authorization|cookie|token|secret|session|password|passwd|credential|sid|hsid|ssid)\s*[:=]\s*)([^\s,;}\]]+)/gi, "$1<redacted>");
  return text.length > maxLength ? `${text.slice(0, maxLength)}<truncated>` : text;
}

export function redact(value, key = "") {
  if (/authorization|cookie|token|secret|api.?key|session|password|passwd|credential|^(?:sid|hsid|ssid)$/i.test(key)) return "<redacted>";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  if (typeof value === "string" && (/^(data:.*;base64,)/i.test(value) || value.length > 2_000)) {
    return `<omitted string: ${value.length} chars>`;
  }
  return typeof value === "string" ? sanitizeSensitiveText(value, 2_000) : value;
}

export function sanitizedPostData(request) {
  const raw = request.postData();
  if (!raw) return null;
  try {
    return redact(JSON.parse(raw));
  } catch {
    return `<non-JSON body omitted: ${raw.length} chars>`;
  }
}

function relevantRequest(request) {
  const url = request.url();
  return request.method() !== "GET" || /omni|interaction|generate|app(?:s)?\/|run/i.test(url);
}

export function sourceFileNameFromTreeItem(label) {
  const sourceFilePattern = /\.(?:[cm]?[jt]sx?|json|css|html|md|env(?:\.example)?)$/i;
  return String(label ?? "").trim().split(/\s+/).find((part) => sourceFilePattern.test(part)) ?? null;
}

export function sanitizedUrl(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/");
    const safeSegments = segments.map((segment, index) => {
      const prior = segments[index - 1] ?? "";
      if (/^(?:token|secret|key|auth|session|credential)s?$/i.test(prior)) return "<redacted>";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return "<redacted-id>";
      if (/^(?:token|secret|key|auth|session|credential)s?(?:=|:|-).+/i.test(segment)) return "<redacted>";
      return sanitizeSensitiveText(segment, 256);
    });
    return `${url.origin}${safeSegments.join("/")}`;
  } catch {
    return "<invalid URL omitted>";
  }
}

function resolveCredentialScriptPath() {
  const candidates = [
    path.join(import.meta.dirname, "credential-cookies.ps1"),
    path.join(import.meta.dirname, "..", "scripts", "credential-cookies.ps1"),
    path.join(import.meta.dirname, "..", "..", "scripts", "credential-cookies.ps1"),
    path.resolve(process.cwd(), "scripts", "credential-cookies.ps1"),
    path.resolve(process.cwd(), "CORE", "scripts", "credential-cookies.ps1"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return path.resolve(import.meta.dirname, "credential-cookies.ps1");
}

async function loadCredentialManagerCookies(service = "OmniProductStudio") {
  const script = resolveCredentialScriptPath();
  const getCookies = async () => {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", script,
        "-Mode", "Get",
        "-Service", service,
      ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      const encoded = stdout.trim();
      if (!encoded) return null;
      const cookies = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      return Array.isArray(cookies) && cookies.length > 0 ? cookies : null;
    } catch {
      return null;
    }
  };

  let cookies = await getCookies();
  if (!cookies) {
    // Tenta refresh automático transparente da sessão persistente do Chrome
    try {
      const { refreshPersistentSession } = await import("./persistent-session.mjs");
      const provider = service === "FlowMusic" ? "flow-music" : "google";
      await refreshPersistentSession({ provider });
      cookies = await getCookies();
    } catch {}
  }

  if (!cookies) {
    throw new Error(`Cookies para ${service} ausentes no Gerenciador de Credenciais.`);
  }
  return cookies;
}

function normalizeSameSite(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "lax") return "Lax";
  if (normalized === "none") return "None";
  return undefined;
}

function isAllowedGoogleCookieDomain(value) {
  const domain = String(value ?? "").trim().replace(/^\./, "").toLowerCase();
  return domain === "google.com" || domain.endsWith(".google.com");
}

export async function loadHarCookies(harFile) {
  const requestedFile = String(harFile ?? "").trim();
  if (!requestedFile) throw new Error("Arquivo HAR obrigatório.");
  const source = path.resolve(requestedFile);
  let har;
  try {
    har = JSON.parse(await readFile(source, "utf8"));
  } catch (error) {
    throw new Error(`Não foi possível ler o HAR: ${error?.message ?? error}`);
  }
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const unique = new Map();
  for (const entry of entries) {
    for (const raw of Array.isArray(entry?.request?.cookies) ? entry.request.cookies : []) {
      const name = String(raw?.name ?? "").trim();
      const value = String(raw?.value ?? "");
      let requestHost = "";
      try { requestHost = new URL(String(entry?.request?.url ?? "")).hostname.toLowerCase(); } catch {}
      const domain = String(raw?.domain ?? requestHost).trim().toLowerCase();
      const cookiePath = String(raw?.path ?? "/") || "/";
      if (!name || !value || !isAllowedGoogleCookieDomain(domain)) continue;
      const cookie = {
        name,
        value,
        domain,
        path: cookiePath,
        secure: Boolean(raw?.secure || name.startsWith("__Secure-")),
        httpOnly: Boolean(raw?.httpOnly),
      };
      const sameSite = normalizeSameSite(raw?.sameSite);
      if (sameSite) cookie.sameSite = sameSite;
      const expiresMs = Date.parse(String(raw?.expires ?? ""));
      if (Number.isFinite(expiresMs)) cookie.expires = Math.floor(expiresMs / 1000);
      unique.set(`${domain}\n${cookiePath}\n${name}`, cookie);
    }
  }
  const cookies = [...unique.values()];
  if (!cookies.length) throw new Error("O HAR não contém cookies Google utilizáveis.");
  return cookies;
}

function isAllowedCookieTableDomain(value) {
  const domain = String(value ?? "").trim().replace(/^\./, "").toLowerCase();
  return domain === "google.com"
    || domain.endsWith(".google.com")
    || domain === "flowmusic.app"
    || domain.endsWith(".flowmusic.app");
}

export async function loadCookieTableCookies(cookieFile) {
  const requestedFile = String(cookieFile ?? "").trim();
  if (!requestedFile) throw new Error("Arquivo de cookies obrigatório.");
  const source = path.resolve(requestedFile);
  const text = await readFile(source, "utf8");
  const unique = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const [name, value, domain, cookiePath, expiresText, ...tail] = parts;
    if (!name || !value || !isAllowedCookieTableDomain(domain)) continue;
    const checks = tail.filter((entry) => entry === "✓").length;
    const cookie = {
      name,
      value,
      domain: domain.toLowerCase(),
      path: cookiePath || "/",
      secure: true,
      httpOnly: checks >= 2,
    };
    const sameSite = tail.find((entry) => new Set(["Strict", "Lax", "None"]).has(entry));
    if (sameSite) cookie.sameSite = sameSite;
    const expiresMs = Date.parse(expiresText);
    if (Number.isFinite(expiresMs)) cookie.expires = Math.floor(expiresMs / 1000);
    unique.set(`${cookie.domain}\n${cookie.path}\n${cookie.name}`, cookie);
  }
  const cookies = [...unique.values()];
  if (!cookies.length) throw new Error("O arquivo não contém cookies Google ou Flow Music utilizáveis.");
  return cookies;
}

async function copyIfPresent(source, destination) {
  try {
    if (!(await stat(source)).isFile()) return false;
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    if (error?.code === "EBUSY" && path.basename(source) === "Cookies") {
      const database = new DatabaseSync(source, { readOnly: true });
      try {
        await backup(database, destination);
        return true;
      } finally {
        database.close();
      }
    }
    throw error;
  }
}

async function createEphemeralChromeProfile(profileName) {
  const sourceRoot = process.env.CHROME_USER_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-ai-studio-headless-"));
  try {
    await copyIfPresent(path.join(sourceRoot, "Local State"), path.join(temporaryRoot, "Local State"));
    for (const relative of [
      "Preferences",
      "Secure Preferences",
      path.join("Network", "Cookies"),
      path.join("Network", "Cookies-journal"),
      path.join("Network", "Cookies-wal"),
      path.join("Network", "Cookies-shm"),
      "Cookies",
      "Cookies-journal",
    ]) {
      await copyIfPresent(path.join(sourceRoot, profileName, relative), path.join(temporaryRoot, profileName, relative));
    }
    return temporaryRoot;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupHeadlessResources({ session = null, context = null, browser = null, temporaryProfile = null, credentialCookies = [] } = {}) {
  const errors = [];
  if (session) {
    try { errors.push(...await session.close()); } catch (error) { errors.push(error); }
  } else {
    if (context) {
      try { await context.close(); } catch (error) { errors.push(error); }
    }
    if (browser) {
      try { await browser.close(); } catch (error) { errors.push(error); }
    }
  }
  if (temporaryProfile) {
    try { await rm(temporaryProfile, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  }
  for (const cookie of credentialCookies) {
    if (cookie && typeof cookie === "object") {
      for (const key of Object.keys(cookie)) cookie[key] = "";
    }
  }
  credentialCookies.splice(0, credentialCookies.length);
  return errors;
}

export async function openStudioPage({ chrome, targetUrl, profileName = null, harFile = null, cookieFile = null, beforeNavigate = null, browserArgs = [] }) {
  if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Chrome real é proibido em NODE_ENV=test.");
  if ([profileName, harFile, cookieFile].filter(Boolean).length > 1) throw new Error("Use somente --profile, --har ou --cookie-file.");
  if (profileName) {
    const temporaryProfile = await createEphemeralChromeProfile(profileName);
    const context = await chromium.launchPersistentContext(temporaryProfile, {
      executablePath: chrome,
      headless: true,
      args: ["--disable-background-networking", ...browserArgs, `--profile-directory=${profileName}`],
      locale: "pt-BR",
      viewport: { width: 1600, height: 1000 },
    });
    const page = await context.newPage();
    if (beforeNavigate) await beforeNavigate(page);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(9_000);
    return { browser: null, context, page, credentialCookies: [], temporaryProfile };
  }
  const broker = createSessionBroker({
    browserType: chromium,
    executablePath: chrome,
    loadCredentialCookies: loadCredentialManagerCookies,
    loadHarCookies,
    loadCookieFileCookies: loadCookieTableCookies,
  });
  const sessionProfile = targetUrl.includes("flowmusic.app") ? "flow-music" : "google-ai-studio";
  const sessionOptions = {
    profile: sessionProfile,
    targetUrl,
    authMode: harFile ? "har" : cookieFile ? "cookie-file" : "credential-manager",
    harFile,
    cookieFile,
    beforeNavigate,
    browserArgs,
  };
  let session = await broker.open(sessionOptions);
  let sessionRefresh = null;
  if (!harFile && !cookieFile && /accounts\.google\.com|signin|login/i.test(session.page.url())) {
    sessionRefresh = await refreshPersistentSession({ provider: sessionProfile === "flow-music" ? "flow-music" : "google" });
    if (sessionRefresh.ready) {
      await session.close();
      session = await broker.open(sessionOptions);
    }
  }
  return { session, sessionRefresh, browser: null, context: null, page: session.page, credentialCookies: [], temporaryProfile: null };
}

export async function dismissOverlays(page) {
  const dismissLabels = [
    "Fechar caixa de diálogo",
    "Fechar tour guiado",
    "Close dialog",
    "Close guided tour",
    "Skip",
    "No thanks",
    "Não, obrigado",
    "Dispensar",
    "Got it",
    "Entendi",
  ];
  for (let round = 0; round < 4; round += 1) {
    let clicked = false;
    for (const label of dismissLabels) {
      const button = page.getByRole("button", { name: label, exact: false });
      if (await button.count()) {
        await button.first().click({ timeout: 3_000 }).catch(() => {});
        await page.waitForTimeout(500);
        clicked = true;
      }
    }
    // Botão "Continuar" dentro do modal de boas-vindas.
    const continuar = page.getByRole("button", { name: /^(Continuar|Continue)$/i });
    if (await continuar.count()) {
      await continuar.first().click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(500);
      clicked = true;
    }
    if (!clicked) break;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(800);
}

function detectAudioExtension(buffer, contentType = "") {
  const type = String(contentType).toLowerCase();
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return ".wav";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return ".mp3";
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return ".ogg";
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return ".webm";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") return ".m4a";
  if (type.includes("wav")) return ".wav";
  if (type.includes("mpeg") || type.includes("mp3")) return ".mp3";
  if (type.includes("ogg")) return ".ogg";
  if (type.includes("webm")) return ".webm";
  if (type.includes("mp4") || type.includes("m4a")) return ".m4a";
  return ".bin";
}

export function mp3DurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 128) return null;
  let offset = 0;
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" && buffer.length > 10) {
    const tagSize = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + tagSize;
  }
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      const versionBits = (buffer[offset + 1] >> 3) & 0x03;
      const bitrateIdx = (buffer[offset + 2] >> 4) & 0x0F;
      const mpeg1L3Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
      const mpeg2L3Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
      const bitrates = versionBits === 3 ? mpeg1L3Bitrates : mpeg2L3Bitrates;
      const kbps = bitrates[bitrateIdx] || (versionBits === 3 ? 128 : 64);
      if (kbps > 0) {
        const audioBytes = buffer.length - offset;
        return (audioBytes * 8) / (kbps * 1000);
      }
      break;
    }
    offset += 1;
  }
  return null;
}

export function wavDurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    let byteRate = null;
    let dataBytes = null;
    for (let offset = 12; offset + 8 <= buffer.length;) {
      const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const dataOffset = offset + 8;
      if (dataOffset + chunkSize > buffer.length) break;
      if (chunkId === "fmt " && chunkSize >= 16) byteRate = buffer.readUInt32LE(dataOffset + 8);
      if (chunkId === "data") dataBytes = chunkSize;
      if (byteRate && dataBytes != null) break;
      offset = dataOffset + chunkSize + (chunkSize % 2);
    }
    if (byteRate && dataBytes != null) return dataBytes / byteRate;
  }
  return mp3DurationSeconds(buffer);
}

export function minimumNarrationDurationSeconds(wordCount) {
  const count = Number(wordCount);
  if (!Number.isFinite(count) || count <= 0) throw new Error("wordCount deve ser positivo.");
  // 330 palavras/minuto é um piso deliberadamente permissivo. Abaixo dele, o
  // corpo capturado só pode representar uma prévia, fragmento ou efeito de UI.
  return Math.max(3, count / 5.5);
}

export async function runVidsSpeech(options) {
  if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Google Vids real é proibido em NODE_ENV=test.");
  const targetUrl = String(options.url ?? "").trim();
  const cookieFile = options["cookie-file"] ? path.resolve(options["cookie-file"]) : null;
  const scriptText = String(options.text ?? "").trim();
  const requestedVoice = String(options.voice ?? "Nyla").trim();
  const wordCount = scriptText.split(/\s+/).filter(Boolean).length;
  const minimumDurationSeconds = minimumNarrationDurationSeconds(wordCount);
  const outputBase = path.resolve(options.out ?? "outputs/google-vids-tts/provider-audio");
  const receiptPath = path.resolve(options.receipt ?? `${outputBase}.receipt.json`);
  const chrome = options.chrome ?? process.env.CHROME_PATH ?? DEFAULT_CHROME;
  if (!targetUrl.startsWith("https://docs.google.com/videos/d/")) throw new Error("--url deve apontar para um documento do Google Vids.");
  if (wordCount < 3) throw new Error("O Google Vids exige pelo menos 3 palavras.");
  await assertPathAvailable(receiptPath, "Recibo do Google Vids TTS");

  let resources = null;
  let submitted = false;
  let operationError = null;
  const captured = [];
  const captureTasks = [];
  const startedAt = new Date().toISOString();
  try {
    resources = await openStudioPage({ chrome, targetUrl, cookieFile });
    const { page } = resources;
    if (/accounts\.google\.com|signin|login/i.test(page.url())) throw new Error("A sessão descartável não autenticou no Google Vids.");
    if (!/Google Vids/i.test(await page.title())) throw new Error("A página autenticada não foi reconhecida como Google Vids.");
    if (await page.locator(".goog-modalpopup-bg").count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
    const createNewScene = options["new-scene"] === true || options["new-scene"] === "true";
    if (createNewScene) {
      await page.waitForTimeout(1_500);
      const newScene = page.getByRole("button", { name: "Nova cena (Ctrl+M)", exact: true });
      if (await newScene.count()) {
        try {
          await newScene.last().click({ timeout: 8_000 });
        } catch {
          await page.keyboard.press("Control+m");
        }
      } else {
        await page.keyboard.press("Control+m");
      }
      await page.waitForTimeout(2_000);
    }
    const narration = page.getByText("Narração", { exact: true });
    if (await narration.count() !== 1) throw new Error("Controle Narração não encontrado de forma inequívoca.");
    await narration.click();
    await page.waitForTimeout(1_500);
    const workspace = page.locator(".appsFlixScriptsSidebarWorkspaceContainer");
    if (await workspace.count() !== 1) throw new Error("Editor de roteiro do Google Vids não encontrado.");
    const panelText = String(await page.locator("body").innerText().catch(() => ""));
    const normalizedPanelText = panelText.replace(/\s+/g, " ");
    const normalizedScript = scriptText.replace(/\s+/g, " ");
    await workspace.click({ position: { x: 100, y: 100 }, force: true });
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    await page.keyboard.insertText(scriptText);
    await page.waitForTimeout(1_500);
    const persistedPanelText = String(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    if (!persistedPanelText.includes(normalizedScript)) {
      throw new Error("O Google Vids não persistiu o roteiro completo na cena; nenhuma geração foi submetida.");
    }

    await page.waitForTimeout(1_500);
    await page.locator(".appsFlixScriptsSidebarPresetVoiceoverMode").waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    const voiceCardName = String(await page.locator(".appsFlixScriptsSidebarPresetVoiceoverMode .appsFlixPluginsVoiceoversVoicecardVoiceName").innerText().catch(() => "")).trim().toLocaleLowerCase("pt-BR");
    const sidebarText = String(await page.locator(".appsFlixScriptsSidebarPresetVoiceoverMode").innerText().catch(() => "")).trim().toLocaleLowerCase("pt-BR");
    const requestedLower = requestedVoice.toLocaleLowerCase("pt-BR");
    const selectedVoiceMatches = voiceCardName === requestedLower || voiceCardName.includes(requestedLower) || (sidebarText.length > 0 && sidebarText.includes(requestedLower));
    if (!selectedVoiceMatches) {
      const changeVoice = page.getByRole("button", { name: "Mudar a voz", exact: true }).or(page.locator("button:has-text('Mudar a voz')")).first();
      await changeVoice.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      await changeVoice.scrollIntoViewIfNeeded().catch(() => {});
      await changeVoice.click({ force: true }).catch(() => {});
      const voiceDialog = page.locator(".appsFlixPluginsVoiceoversVoicePickerDialog, [role='dialog']:not(#insertabletemplates-dialog-notforstyling):not(.getting-started-dialog)").filter({ hasText: /Selecionar|Voz/i }).first();
      if (!await voiceDialog.isVisible().catch(() => false)) {
        await page.waitForTimeout(1_500);
        await changeVoice.click({ force: true }).catch(() => {});
      }
      await voiceDialog.waitFor({ state: "visible", timeout: 20_000 });
      const requestedVoicePattern = requestedVoice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchBox = voiceDialog.locator("input[type='search'], input[type='text'], [role='searchbox']").first();
      const tabs = voiceDialog.locator("[role='tab']");
      const numTabs = await tabs.count().catch(() => 0);

      let voiceFound = false;
      let voiceCardToClick = null;

      const iterations = numTabs > 0 ? numTabs : 1;

      for (let i = 0; i < iterations; i++) {
        if (numTabs > 0) {
          await tabs.nth(i).click().catch(() => {});
          await page.waitForTimeout(500); // Esperar carregar a aba
        }

        if (await searchBox.count() > 0 && await searchBox.isVisible().catch(() => false)) {
          await searchBox.fill("").catch(() => {});
          await searchBox.fill(requestedVoice).catch(() => {});
          await page.waitForTimeout(600); // Mais tempo para a UI filtrar
        }

        let voiceName = voiceDialog.locator(".appsFlixPluginsVoiceoversVoicecardVoiceName").filter({ hasText: new RegExp(`^${requestedVoicePattern}$`, "i") });
        
        if (await voiceName.count() > 0) {
          voiceCardToClick = voiceName.locator("xpath=ancestor::*[@role='menuitem'][1]").first();
          voiceFound = true;
          break;
        }
        
        const menuItems = voiceDialog.locator("[role='menuitem']");
        const count = await menuItems.count().catch(() => 0);
        for (let idx = 0; idx < Math.min(count, 50); idx++) {
          const item = menuItems.nth(idx);
          const txt = String(await item.innerText().catch(() => "")).trim();
          if (new RegExp(`^${requestedVoicePattern}$`, "i").test(txt) || txt.toLowerCase().includes(requestedVoice.toLowerCase())) {
            await item.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(300);
            voiceFound = true;
            voiceCardToClick = item;
            break;
          }
        }
        if (voiceFound) break;
      }

      if (!voiceFound || !voiceCardToClick) {
        throw new Error(`A voz ${requestedVoice} não está disponível no seletor atual do Google Vids; nenhuma geração foi submetida.`);
      }

      await voiceCardToClick.click();

      const selectVoice = voiceDialog.getByRole("button", { name: "Selecionar", exact: true });
      if (await selectVoice.count() !== 1) throw new Error("Botão Selecionar voz não encontrado de forma inequívoca.");
      await selectVoice.click();
      await voiceDialog.waitFor({ state: "hidden", timeout: 10_000 });
      await page.waitForTimeout(1000);
    }
    
    let isConfirmed = selectedVoiceMatches;
    if (!isConfirmed) {
      const selectedVoiceCard = page.locator(".appsFlixScriptsSidebarPresetVoiceoverMode .appsFlixPluginsVoiceoversVoicecardVoiceName").first();
      for (let check = 0; check < 5; check++) {
        const txt = String(await selectedVoiceCard.innerText().catch(() => "")).trim().toLocaleLowerCase("pt-BR");
        const fullTxt = String(await page.locator(".appsFlixScriptsSidebarPresetVoiceoverMode").innerText().catch(() => "")).trim().toLocaleLowerCase("pt-BR");
        if (txt.includes(requestedVoice.toLocaleLowerCase("pt-BR")) || fullTxt.includes(requestedVoice.toLocaleLowerCase("pt-BR"))) {
          isConfirmed = true;
          break;
        }
        await page.waitForTimeout(500);
      }
    }

    if (!isConfirmed) {
      throw new Error(`O Google Vids não confirmou a voz ${requestedVoice}; nenhuma geração foi submetida.`);
    }

    let generationStarted = false;
    page.on("response", (response) => {
      if (!generationStarted || response.status() !== 200) return;
      const contentType = String(response.headers()["content-type"] ?? "").toLowerCase();
      const url = response.url();
      if (!contentType.startsWith("audio/") && !/(?:audio|voice|narrat|tts|media)/i.test(url)) return;
      const task = response.body().then((body) => {
        if (body.length < 1_024 || body.length > 50 * 1024 * 1024) return;
        const ext = detectAudioExtension(body, contentType);
        if (ext === ".bin") return;
        const duration = wavDurationSeconds(body);
        if (duration != null && duration > 0) {
          captured.push({ body, contentType, url: sanitizedUrl(url), durationSeconds: duration });
        }
      }).catch(() => {});
      captureTasks.push(task);
    });

    const insertButton = page.locator("button, div[role='button']").filter({ hasText: /Inserir narração|Atualizar narração/i }).first();
    await insertButton.waitFor({ state: "attached", timeout: 15_000 });
    await insertButton.scrollIntoViewIfNeeded().catch(() => {});
    await insertButton.waitFor({ state: "visible", timeout: 15_000 });
    generationStarted = true;
    submitted = true;
    await insertButton.click();
    console.log(JSON.stringify({ stage: "submitted", provider: "google-vids", retryAllowed: false }));

    // Se aparecer modal de confirmação "Substituir a narração atual?", clicar em "Substituir"
    const replaceConfirmBtn = page.locator("button, div[role='button']").filter({ hasText: /^Substituir$/i }).first();
    await page.waitForTimeout(1000);
    if (await replaceConfirmBtn.isVisible().catch(() => false)) {
      await replaceConfirmBtn.click().catch(() => {});
    }

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !captured.some((entry) => entry.durationSeconds != null && entry.durationSeconds >= minimumDurationSeconds)) {
      await page.waitForTimeout(2_000);
      // Inspect actual UI alerts only. The script editor itself may legitimately
      // contain words such as "erro", "erros" or "permissão".
      const alertText = await page
        .locator('[role="alert"], .docs-material-snackbar-content, .goog-snackbar-content')
        .allInnerTexts()
        .then((entries) => entries.join(" "))
        .catch(() => "");
      if (/\bnão foi possível\b|\berro\b|\berror\b|\bpermission\b|\bpermissão\b/i.test(alertText)) break;
    }
    await Promise.allSettled(captureTasks);
    const plausibleCaptured = captured.filter((entry) => entry.durationSeconds != null && entry.durationSeconds >= minimumDurationSeconds);
    if (!plausibleCaptured.length) {
      const bodyText = sanitizeSensitiveText(await page.locator("body").innerText().catch(() => ""), 4_000);
      await writeJsonAtomic(receiptPath, {
        schema: "google-vids-tts-attempt@1",
        status: "ambiguous",
        submitted,
        retryAllowed: false,
        startedAt,
        completedAt: new Date().toISOString(),
        authSource: cookieFile ? "cookie-file-ephemeral" : "windows-credential-manager",
        finalUrl: sanitizedUrl(page.url()),
        wordCount,
        minimumDurationSeconds,
        capturedCandidates: captured.map((entry) => ({
          bytes: entry.body.length,
          contentType: entry.contentType,
          durationSeconds: entry.durationSeconds,
          sourceUrl: entry.url,
        })),
        pageState: bodyText,
      }, { label: "Recibo do Google Vids TTS" });
      throw new Error("A narração foi submetida uma vez, mas nenhum áudio com duração compatível com o roteiro foi capturado. Estado ambíguo; repetição automática bloqueada.");
    }
    const selected = plausibleCaptured.sort((a, b) => b.durationSeconds - a.durationSeconds || b.body.length - a.body.length)[0];
    const extension = detectAudioExtension(selected.body, selected.contentType);
    const requestedExtension = path.extname(outputBase).toLowerCase();
    const audioPath = requestedExtension ? outputBase : `${outputBase}${extension}`;
    await assertPathAvailable(audioPath, "Áudio do Google Vids");
    if (requestedExtension === ".wav" && extension !== ".wav") {
      const tempPath = `${audioPath}.raw${extension}`;
      await writeFileAtomic(tempPath, selected.body, { label: "Áudio temporário do Google Vids" });
      await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", tempPath, "-ar", "48000", "-ac", "2", audioPath]);
      await rm(tempPath, { force: true });
    } else {
      await writeFileAtomic(audioPath, selected.body, { label: "Áudio do Google Vids" });
    }
    const receipt = {
      schema: "google-vids-tts-attempt@1",
      status: "succeeded",
      submitted: true,
      retryAllowed: false,
      startedAt,
      completedAt: new Date().toISOString(),
      authSource: cookieFile ? "cookie-file-ephemeral" : "windows-credential-manager",
      voice: requestedVoice,
      newScene: createNewScene,
      wordCount,
      scriptVerifiedBeforeSubmission: true,
      minimumDurationSeconds,
      audio: { path: audioPath, bytes: selected.body.length, durationSeconds: selected.durationSeconds, contentType: selected.contentType, sourceUrl: selected.url },
    };
    await writeJsonAtomic(receiptPath, receipt, { label: "Recibo do Google Vids TTS" });
    console.log(JSON.stringify({ ok: true, audio: audioPath, receipt: receiptPath, bytes: selected.body.length, contentType: selected.contentType }, null, 2));
    return { file: audioPath, audioPath, receiptFile: receiptPath, receipt, model: "google-vids-tts", voice: requestedVoice, startedAt, completedAt: receipt.completedAt };
  } catch (error) {
    operationError = error;
    if (error && typeof error === "object") error.submitted = submitted;
    throw error;
  } finally {
    const cleanupErrors = resources ? await cleanupHeadlessResources(resources) : [];
    if (!operationError && cleanupErrors.length) throw new AggregateError(cleanupErrors, "Falha ao limpar o contexto descartável do Google Vids.");
  }
}

async function main() {
  const [command = "inspect", ...rest] = process.argv.slice(2);
  if (command === "session") {
    const result = await runPersistentSessionCommand(rest);
    console.log(JSON.stringify(result, null, 2));
    if (result.ready === false && result.classification !== "not_configured") process.exitCode = 2;
    return result;
  }
  if (command === "vids-speech") return runVidsSpeech(readOptions(rest));
  if (command !== "inspect") throw new Error(`Comando desconhecido: ${command}`);
  if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Chrome real é proibido em NODE_ENV=test.");
  const options = readOptions(rest);
  const targetUrl = options.url ?? DEFAULT_URL;
  const output = path.resolve(options.out ?? "outputs/ai-studio-headless-inspect.json");
  const chrome = options.chrome ?? process.env.CHROME_PATH ?? DEFAULT_CHROME;
  const cookieSource = options.har ? "har" : options["cookie-file"] ? "cookie-file" : options.cookies ?? "none";
  if (!new Set(["none", "credential-manager", "flowmusic-credential-manager", "har", "cookie-file"]).has(cookieSource)) {
    throw new Error("--cookies deve ser none, credential-manager ou flowmusic-credential-manager; para arquivo use --har ou --cookie-file.");
  }
  const clonedProfileName = options.profile;
  const liveProfileName = options["live-profile"];
  if ([clonedProfileName, liveProfileName, options.har, options["cookie-file"]].filter(Boolean).length > 1) throw new Error("Use somente --profile, --live-profile, --har ou --cookie-file.");
  const profileName = clonedProfileName ?? liveProfileName ?? null;
  const liveUserData = liveProfileName
    ? process.env.CHROME_USER_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data")
    : null;
  const profileMode = liveProfileName ? "live" : clonedProfileName ? "ephemeral-copy" : "clean";
  const launchOptions = {
    executablePath: chrome,
    headless: true,
    args: ["--disable-background-networking", ...(profileName ? [`--profile-directory=${profileName}`] : [])],
  };
  let credentialCookies = [];
  let temporaryProfile = null;
  let browser = null;
  let context = null;
  let inspection;
  let operationError = null;
  try {
    credentialCookies = cookieSource === "credential-manager"
      ? await loadCredentialManagerCookies()
      : cookieSource === "flowmusic-credential-manager"
        ? await loadCredentialManagerCookies("FlowMusic")
      : cookieSource === "har"
        ? await loadHarCookies(options.har)
        : cookieSource === "cookie-file"
          ? await loadCookieTableCookies(options["cookie-file"])
        : [];
    temporaryProfile = clonedProfileName ? await createEphemeralChromeProfile(clonedProfileName) : null;
    browser = temporaryProfile || liveUserData ? null : await chromium.launch(launchOptions);
    context = temporaryProfile
      ? await chromium.launchPersistentContext(temporaryProfile, {
          ...launchOptions,
          locale: "pt-BR",
          viewport: { width: 1600, height: 1000 },
        })
      : liveUserData
        ? await chromium.launchPersistentContext(liveUserData, {
            ...launchOptions,
            locale: "pt-BR",
            viewport: { width: 1600, height: 1000 },
          })
        : await browser.newContext({ locale: "pt-BR", viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const requests = [];
    const responses = [];
    const consoleMessages = [];
    const pageErrors = [];

    page.on("request", (request) => {
      if (!relevantRequest(request)) return;
      requests.push({
        at: new Date().toISOString(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: sanitizedUrl(request.url()),
        postData: sanitizedPostData(request),
      });
    });
    page.on("response", (response) => {
      const request = response.request();
      if (!relevantRequest(request)) return;
      responses.push({
        at: new Date().toISOString(),
        method: request.method(),
        status: response.status(),
        url: sanitizedUrl(response.url()),
      });
    });
    page.on("console", (message) => consoleMessages.push({ type: message.type(), text: sanitizeSensitiveText(message.text(), 1_000) }));
    page.on("pageerror", (error) => pageErrors.push(sanitizeSensitiveText(error?.message ?? error, 2_000)));

    if (credentialCookies.length) await context.addCookies(credentialCookies);
    let profilePath = null;
    if (profileName) {
      await page.goto("chrome://version", { waitUntil: "domcontentloaded", timeout: 15_000 });
      profilePath = await page.locator("#profile_path").innerText().catch(() => null);
    }
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(8_000);

    if (options["inspect-panel"]) {
      if (await page.locator(".goog-modalpopup-bg").count()) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
      const panelTrigger = page.getByText(String(options["inspect-panel"]), { exact: true });
      if (await panelTrigger.count() !== 1) {
        throw new Error(`Painel de inspeção não encontrado de forma inequívoca: ${options["inspect-panel"]}`);
      }
      await panelTrigger.click();
      await page.waitForTimeout(2_000);
    }
    if (options["inspect-action"]) {
      const actionTrigger = page.getByText(String(options["inspect-action"]), { exact: options["inspect-action-partial"] !== "true" });
      if (await actionTrigger.count() !== 1) {
        throw new Error(`Ação de inspeção não encontrada de forma inequívoca: ${options["inspect-action"]}`);
      }
      await actionTrigger.click({ force: true });
      await page.waitForTimeout(1_000);
    }
    if (options["inspect-selector"]) {
      const selectorTrigger = page.locator(String(options["inspect-selector"]));
      if (await selectorTrigger.count() !== 1) {
        throw new Error(`Seletor de inspeção não encontrado de forma inequívoca: ${options["inspect-selector"]}`);
      }
      await selectorTrigger.click({ position: { x: 100, y: 100 }, force: true });
      await page.waitForTimeout(1_000);
    }

    const skipButton = page.getByRole("button", { name: "Skip", exact: true });
    if (await skipButton.count() === 1) {
      await skipButton.click();
      await page.waitForTimeout(500);
    }

    const codeButton = page.getByRole("button", { name: "Code", exact: true });
    const codeButtonCount = await codeButton.count();
    if (codeButtonCount === 1) {
      await codeButton.click();
      await page.waitForTimeout(1_000);
    }

    const serverFile = page.getByRole("treeitem", { name: /^server\.ts(?:\s|$)/ });
    const serverFileCount = await serverFile.count();
    if (serverFileCount === 1) {
      await serverFile.click();
      await page.waitForTimeout(500);
    }

    // Starter apps load Monaco models lazily. Visit each visible source file so
    // an inspection captures the app contract, not only whichever tab opened
    // by default. Folders and generated dependency declarations are skipped.
    const treeItems = page.getByRole("treeitem");
    const treeItemCount = await treeItems.count();
    const visitedSourceFiles = [];
    for (let index = 0; index < treeItemCount; index += 1) {
      const item = treeItems.nth(index);
      const label = String(await item.getAttribute("aria-label").catch(() => "") || await item.innerText().catch(() => "")).trim();
      const fileName = sourceFileNameFromTreeItem(label);
      if (!fileName || fileName.includes("node_modules")) continue;
      await item.click().catch(() => {});
      await page.waitForTimeout(150);
      visitedSourceFiles.push(fileName);
    }

    const monacoModels = await page.evaluate(() => {
      const models = globalThis.monaco?.editor?.getModels?.() ?? [];
      return models.map((model) => ({ uri: String(model.uri), value: model.getValue() }));
    });
    const visibleCode = await page.locator('.monaco-editor[data-uri="file:///server.ts"] .view-lines').count() === 1
      ? await page.locator('.monaco-editor[data-uri="file:///server.ts"] .view-lines').innerText()
      : null;
    const appFrame = page.frames().find((frame) => {
      try {
        const url = new URL(frame.url());
        return url.protocol.startsWith("http") && url.hostname !== "aistudio.google.com";
      } catch {
        return false;
      }
    });
    const appFrameText = appFrame ? (await appFrame.locator("body").innerText().catch(() => "")).slice(0, 8_000) : null;
    const links = await page.locator("a").evaluateAll((anchors) => anchors.map((anchor) => ({
      text: String(anchor.innerText ?? anchor.textContent ?? "").trim(),
      ariaLabel: anchor.getAttribute("aria-label"),
      href: anchor.href,
    })).filter((entry) => entry.text || entry.ariaLabel));
    const formControls = await page.locator("input, textarea, button, [role=button], [role=switch], [role=checkbox], [role=textbox], [contenteditable=true]").evaluateAll((controls) => controls.map((control) => ({
      tag: control.tagName.toLowerCase(),
      type: control.getAttribute("type"),
      role: control.getAttribute("role"),
      className: typeof control.className === "string" ? control.className : "",
      name: control.getAttribute("name"),
      ariaLabel: control.getAttribute("aria-label"),
      placeholder: control.getAttribute("placeholder"),
      contenteditable: control.getAttribute("contenteditable"),
      text: String(control.innerText ?? control.textContent ?? "").trim(),
      checked: "checked" in control ? Boolean(control.checked) : control.getAttribute("aria-checked"),
      disabled: "disabled" in control ? Boolean(control.disabled) : control.getAttribute("aria-disabled"),
    })).filter((entry) => entry.text || entry.ariaLabel || entry.placeholder || entry.name || entry.role || entry.className));
    const textMatches = await page.evaluate(() => [...document.querySelectorAll("*")]
      .filter((element) => ["Inserir narração", "Insert voiceover"].includes(String(element.textContent ?? "").trim()))
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        disabled: "disabled" in element ? Boolean(element.disabled) : element.getAttribute("aria-disabled"),
      })));
    const screenshotPath = options.screenshot ? await assertPathAvailable(path.resolve(options.screenshot), "Captura da inspeção") : null;
    if (screenshotPath) {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }

    inspection = {
      mode: "headless",
      profileMode,
      cookieSource,
      credentialCookieCount: credentialCookies.length,
      targetUrl: sanitizedUrl(targetUrl),
      finalUrl: sanitizedUrl(page.url()),
      title: sanitizeSensitiveText(await page.title(), 1_000),
      screenshot: screenshotPath,
      profilePath: profilePath == null ? null : sanitizeSensitiveText(profilePath, 2_000),
      codeButtonCount,
      serverFileCount,
      visitedSourceFiles,
      frames: page.frames().map((frame) => ({ name: sanitizeSensitiveText(frame.name(), 512), url: sanitizedUrl(frame.url()) })),
      bodyText: sanitizeSensitiveText(await page.locator("body").innerText(), 8_000),
      monacoModels: monacoModels.map((model) => ({
        uri: sanitizeSensitiveText(model.uri, 2_000),
        value: sanitizeSensitiveText(model.value, 200_000),
      })),
      visibleCode: visibleCode == null ? null : sanitizeSensitiveText(visibleCode, 200_000),
      appFrameText: appFrameText == null ? null : sanitizeSensitiveText(appFrameText, 8_000),
      links: links.map((entry) => ({
        text: sanitizeSensitiveText(entry.text, 500),
        ariaLabel: entry.ariaLabel == null ? null : sanitizeSensitiveText(entry.ariaLabel, 500),
        href: sanitizedUrl(entry.href),
      })),
      formControls: formControls.map((entry) => ({
        ...entry,
        name: entry.name == null ? null : sanitizeSensitiveText(entry.name, 500),
        ariaLabel: entry.ariaLabel == null ? null : sanitizeSensitiveText(entry.ariaLabel, 500),
        placeholder: entry.placeholder == null ? null : sanitizeSensitiveText(entry.placeholder, 500),
        text: sanitizeSensitiveText(entry.text, 500),
      })),
      textMatches,
      requests,
      responses,
      consoleMessages,
      pageErrors,
    };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    const cleanupErrors = await cleanupHeadlessResources({ context, browser, temporaryProfile, credentialCookies });
    if (!operationError && cleanupErrors.length) throw new AggregateError(cleanupErrors, "Falha ao limpar recursos do Chrome headless.");
  }

  await mkdir(path.dirname(output), { recursive: true });
  await writeJsonAtomic(output, inspection, { label: "Inspeção headless" });
  console.log(JSON.stringify({ ok: true, mode: "headless", output, finalUrl: inspection.finalUrl, title: inspection.title, codeButtonCount: inspection.codeButtonCount, serverFileCount: inspection.serverFileCount, requests: inspection.requests.length }, null, 2));
}

if (process.argv[1] && path.basename(process.argv[1]) === "ai-studio-headless.mjs" && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  });
}
