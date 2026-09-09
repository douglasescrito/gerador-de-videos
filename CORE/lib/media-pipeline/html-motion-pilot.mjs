import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { createArtifactFromFile, sha256File, verifyArtifact } from "./artifact.mjs";
import { createRendererSandboxManifest } from "./renderer-contract.mjs";
import { runFfmpeg, probeMedia } from "./media-tools.mjs";
import { probeTiming } from "./audio-first.mjs";
import { assertPathAvailable, createStageReceipt, operationFingerprint, pathExists, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { commitOrVerifyLocalFile, readMatchingLocalReceipt } from "./local-publication-recovery.mjs";
import { createAdapterContract } from "./adapter-contract.mjs";
import { validateKineticWords, kineticLaunchDocument } from "./kinetic-launch.mjs";
import { requireOptionalMotionTemplate } from "./optional-motion-templates.mjs";
import { integratedLaunchDocument, validateMotionControls, validateIntegratedScript } from "./integrated-launch.mjs";
import { PREMIUM_STYLES, premiumMorphDocument, validatePremiumKeyframes, premiumBindingFiles } from "./premium-morph.mjs";
import { organicLaunchDocument, validateOrganicControls, organicBindingFiles } from "./organic-launch.mjs";
import { mcpUiReconstructionDocument } from "./mcp-ui-reconstruction.mjs";
import { PLAY_STYLE, PLAY_FONT, PLAY_RECIPES, validatePlayRecipe, typographicPlayAssets, typographicPlayDocument } from "./typographic-play.mjs";

export const HTML_MOTION_PILOT_SCHEMA = "mkt-videos/html-motion-pilot@1";
export const HTML_MOTION_PILOT_RENDERER = "playwright-canvas@local";

const adpAnchors = (...args) => requireOptionalMotionTemplate('adp-explainer').adpAnchors(...args);
const adpExplainerDocument = (...args) => requireOptionalMotionTemplate('adp-explainer').adpExplainerDocument(...args);
const focusMotionZakDocument = (...args) => requireOptionalMotionTemplate('focus-motion-zak').focusMotionZakDocument(...args);
const nanoBananaMotionDocument = (...args) => requireOptionalMotionTemplate('nano-banana-motion').nanoBananaMotionDocument(...args);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function text(value, label, max = 256) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function integer(value, label, { min = 1, max = 16_000 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min || normalized > max) throw new Error(`${label} deve ser inteiro entre ${min} e ${max}.`);
  return normalized;
}

export function createHtmlMotionScene({
  id = "pilot-b-scene",
  title = "IDEIAS EM MOVIMENTO",
  subtitle = "HTML local · frames exatos · sem rede",
  cta = "COMEÇAR",
  width = 640,
  height = 360,
  fps = 24,
  durationSeconds = 8,
  aspect = "16:9",
  fontFamily = "Arial",
  background = "#09111f",
  accent = "#67e8f9",
  wordMotion = null,
  motionStyle = "kinetic-launch@1",
  motionControls = null,
  captureFormat = "png",
  premiumStyle = null,
  motionKeyframes = null,
  playRecipe = null,
  graphicsApi = "canvas2d",
} = {}) {
  const scene = {
    schema: HTML_MOTION_PILOT_SCHEMA,
    id: text(id, "scene.id"),
    title: text(title, "scene.title", 128),
    subtitle: text(subtitle, "scene.subtitle", 256),
    cta: text(cta, "scene.cta", 64),
    width: integer(width, "scene.width"),
    height: integer(height, "scene.height"),
    fps: Number(fps),
    durationSeconds: Number(durationSeconds),
    aspect: text(aspect, "scene.aspect", 16),
    fontFamily: text(fontFamily, "scene.fontFamily", 128),
    background: text(background, "scene.background", 32),
    accent: text(accent, "scene.accent", 32),
    safeArea: { left: 0.07, right: 0.07, top: 0.08, bottom: 0.10 },
    network: "blocked",
    cookies: "blocked",
    providerFree: true,
  };
  if (!["canvas2d", "webgl2"].includes(graphicsApi)) throw new Error("graphicsApi deve ser canvas2d ou webgl2.");
  if (graphicsApi === "webgl2") scene.graphicsApi = graphicsApi;
  if (!["png", "jpeg"].includes(captureFormat)) throw new Error("captureFormat deve ser png ou jpeg.");
  if (captureFormat === "jpeg") scene.captureFormat = captureFormat;
  if (!Number.isFinite(scene.durationSeconds) || scene.durationSeconds <= 0 || scene.durationSeconds > (wordMotion ? 120 : 60)) throw new Error("scene.durationSeconds inválido.");
  if (wordMotion) {
    if (scene.aspect !== "16:9") throw new Error("Motion tipográfico exige 16:9.");
    scene.wordMotion = validateKineticWords(wordMotion, scene.durationSeconds);
    if (!["kinetic-launch@1", "integrated-launch@1", "premium-morph@1", "organic-launch@1", "adp-explainer@1"].includes(motionStyle)) throw new Error("motionStyle desconhecido.");
    if (motionStyle === "adp-explainer@1") {
      adpAnchors(scene.wordMotion);
      scene.motionStyle = motionStyle;
      if (motionControls) throw new Error("ADP usa ancoras medidas, sem motionControls.");
    } else if (motionStyle === "integrated-launch@1") {
      validateIntegratedScript(scene.wordMotion);
      scene.motionStyle = motionStyle;
      scene.motionControls = validateMotionControls(motionControls ?? {});
    } else if (motionStyle === "organic-launch@1") {
      validateIntegratedScript(scene.wordMotion);
      if (scene.durationSeconds < scene.wordMotion.at(-1).end + 3) throw new Error("Motion orgânico exige arremate de pelo menos três segundos após a voz.");
      scene.motionStyle = motionStyle;
      scene.motionControls = validateOrganicControls(motionControls ?? {});
    } else if (motionStyle === "premium-morph@1") {
      if (!PREMIUM_STYLES[premiumStyle]) throw new Error("premiumStyle desconhecido.");
      validateIntegratedScript(scene.wordMotion);
      scene.motionStyle = motionStyle;
      scene.premiumStyle = premiumStyle;
      scene.motionKeyframes = validatePremiumKeyframes(motionKeyframes, scene.wordMotion).map(({time,...key})=>key);
      if (motionControls) throw new Error("Premium usa curvas por keyframe.");
    } else if (motionControls) throw new Error("motionControls exige integrated-launch@1.");
  }
  else if (motionStyle === PLAY_STYLE && !motionControls) {
    if (scene.aspect !== "16:9" || scene.durationSeconds !== 14) throw new Error("Typographic Play exige 16:9 e 14 segundos.");
    scene.motionStyle = motionStyle;
    scene.playRecipe = validatePlayRecipe(playRecipe);
    if (scene.fontFamily !== PLAY_FONT) throw new Error(`Typographic Play exige o pacote ${PLAY_FONT}.`);
    if (scene.background !== PLAY_RECIPES[playRecipe].palette[0] || scene.accent !== PLAY_RECIPES[playRecipe].palette[2]) throw new Error("Typographic Play exige a paleta declarada na receita.");
  }
  else if (motionStyle === "mcp-ui-reconstruction@1" && !motionControls) {
    if (scene.aspect !== "16:9" || scene.durationSeconds !== 41.84) throw new Error("Reconstrução MCP exige 16:9 e 41.84 segundos.");
    scene.motionStyle = motionStyle;
  }
  else if (motionStyle === "focus-motion-zak@1" && !motionControls) {
    requireOptionalMotionTemplate('focus-motion-zak');
    if (scene.aspect !== "1:1" || scene.durationSeconds !== 14.5) throw new Error("Reconstrução ZAK exige 1:1 e 14.5 segundos.");
    scene.motionStyle = motionStyle;
  }
  else if (motionStyle === "nano-banana-motion@1" && !motionControls) {
    requireOptionalMotionTemplate('nano-banana-motion');
    if (scene.aspect !== "1:1" || scene.durationSeconds !== 6) throw new Error("Nano Banana motion exige 1:1 e 6 segundos.");
    scene.motionStyle = motionStyle;
  }
  else if (motionStyle !== "kinetic-launch@1" || motionControls) throw new Error("Direção de motion exige palavras medidas.");
  if (motionStyle !== PLAY_STYLE && playRecipe !== null) throw new Error("playRecipe exige typographic-play@1.");
  if (motionStyle !== "premium-morph@1" && (premiumStyle || motionKeyframes)) throw new Error("Controles premium exigem premium-morph@1.");
  if (!Number.isFinite(scene.fps) || scene.fps < 1 || scene.fps > 120) throw new Error("scene.fps deve ficar entre 1 e 120.");
  const ratios = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1] };
  const ratio = ratios[scene.aspect];
  if (!ratio || scene.width * ratio[1] !== scene.height * ratio[0]) throw new Error("HTML exige dimensões correspondentes ao aspecto 16:9, 9:16 ou 1:1.");
  if (scene.motionStyle !== PLAY_STYLE && scene.fontFamily !== "Arial") throw new Error("HTML exige a fonte pinada Arial.");
  if (![scene.background, scene.accent].every(value => /^#[a-f0-9]{6}$/i.test(value))) throw new Error("Cor HTML exige hexadecimal de seis dígitos.");
  scene.frameCount = Math.round(scene.durationSeconds * scene.fps);
  if (scene.frameCount < 1) throw new Error("HTML exige ao menos um frame.");
  return Object.freeze(scene);
}

export function assertHtmlMotionScene(value) {
  const scene = createHtmlMotionScene(value);
  if (value?.schema !== HTML_MOTION_PILOT_SCHEMA || value.frameCount !== scene.frameCount) throw new Error("html-motion-pilot@1 adulterado.");
  if (value.network !== "blocked" || value.cookies !== "blocked" || value.providerFree !== true) throw new Error("Piloto HTML não é offline/provider-free.");
  return scene;
}

function htmlDocument(scene) {
  const safe = scene.safeArea;
  scene = { ...scene, title: escapeHtml(scene.title), subtitle: escapeHtml(scene.subtitle), cta: escapeHtml(scene.cta) };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --ease: 0; --frame: 0; --cta-opacity: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${scene.width}px; height: ${scene.height}px; overflow: hidden; background: ${scene.background}; color: #f8fafc; font-family: ${scene.fontFamily}, sans-serif; }
    body { display: grid; place-items: center; }
    .safe { position: relative; width: ${Math.round(scene.width * (1 - safe.left - safe.right))}px; height: ${Math.round(scene.height * (1 - safe.top - safe.bottom))}px; overflow: hidden; }
    .grid { position: absolute; inset: 0; opacity: .14; background-image: linear-gradient(${scene.accent} 1px, transparent 1px), linear-gradient(90deg, ${scene.accent} 1px, transparent 1px); background-size: 42px 42px; transform: scale(calc(.82 + var(--ease) * .18)) rotate(calc((1 - var(--ease)) * -2deg)); transform-origin: center; }
    .orb { position: absolute; width: 220px; height: 220px; right: -58px; top: -84px; border-radius: 50%; background: ${scene.accent}; opacity: calc(.08 + var(--ease) * .18); filter: blur(1px); transform: translate(calc((1 - var(--ease)) * 80px), calc((1 - var(--ease)) * -40px)); }
    .copy { position: absolute; left: 0; bottom: 12%; max-width: 90%; transform: translateY(calc((1 - var(--ease)) * 42px)); opacity: var(--ease); }
    h1 { margin: 0; font-size: 42px; line-height: 1.02; letter-spacing: .04em; }
    p { margin: 14px 0 0; font-size: 15px; letter-spacing: .08em; opacity: .72; }
    .cta { position: absolute; right: 0; bottom: 12%; padding: 11px 18px; border: 2px solid ${scene.accent}; color: ${scene.accent}; font-size: 14px; font-weight: 700; letter-spacing: .12em; transform: translateX(calc((1 - var(--ease)) * 54px)); opacity: var(--cta-opacity); }
    .frame { position: absolute; right: 0; top: 0; font: 11px Arial; color: ${scene.accent}; opacity: .6; }
  </style></head><body><main class="safe" aria-label="${scene.title}"><div class="grid"></div><div class="orb"></div><div class="copy"><h1>${scene.title}</h1><p>${scene.subtitle}</p></div><div class="cta">${scene.cta}</div><div class="frame" id="frame"></div></main><script>
    window.__setFrame = (frame, total) => { const p = Math.max(0, Math.min(1, frame / Math.max(1, total - 1))); const ease = 1 - Math.pow(1 - p, 3); document.documentElement.style.setProperty('--frame', String(frame)); document.documentElement.style.setProperty('--ease', String(ease)); document.documentElement.style.setProperty('--cta-opacity', ease > .72 ? '1' : '0'); document.getElementById('frame').textContent = String(frame).padStart(4, '0'); };
  </script></body></html>`;
}

async function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-*/chrome-win64/chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const candidate of candidates.filter(Boolean)) {
    if (candidate.includes("*")) continue;
    try { await access(candidate); return candidate; } catch {}
  }
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => /^chromium-\d+$/u.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const entry of entries) {
      const executable = path.join(root, entry.name, "chrome-win64", "chrome.exe");
      try { await access(executable); return executable; } catch {}
    }
  } catch {}
  throw new Error("Nenhum Chromium/Chrome local encontrado para o piloto HTML.");
}

async function sha256Process(file) {
  return sha256File(file);
}

function findCommand(command) {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8", windowsHide: true });
  return String(probe.stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
}

async function findFontFile(fontFamily) {
  const candidates = fontFamily.toLowerCase() === "arial"
    ? [path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "arial.ttf")]
    : [];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error(`Fonte pinada ausente: ${fontFamily}.`);
}

function documentBootstrap(studio) {
  const failures = [];
  const graphicsContexts = new Set();
  const fail = (reason) => { failures.push(reason); throw new Error(reason); };
  let seed = 0x71ca1234;
  Object.defineProperty(Math, "random", { configurable: false, writable: false, value: () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  } });
  Object.defineProperty(Date, "now", { configurable: false, writable: false, value: () => fail("Use timeSeconds do terceiro argumento de __setFrame, não Date.now.") });
  Object.defineProperty(window, "crypto", { configurable: false, writable: false, value: undefined });
  Object.defineProperty(window, "studio", { configurable: false, writable: false, value: Object.freeze(studio) });
  addEventListener("securitypolicyviolation", () => failures.push("CSP bloqueou recurso não declarado."), true);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && (node.matches("iframe,frame,object,embed") || node.querySelector("iframe,frame,object,embed"))) failures.push("Subdocumento não permitido.");
    }
  }).observe(document, { childList: true, subtree: true });
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const font = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");
  Object.defineProperty(CanvasRenderingContext2D.prototype, "font", { configurable: false, get: font.get, set(value) {
    if (!/\s(?:Arial|"Arial"|'Arial')$/i.test(String(value))) return fail("Canvas exige fonte Arial pinada.");
    font.set.call(this, value);
  } });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: false, writable: false, value(kind, ...args) {
    if (kind !== "2d" && !(studio.graphicsApi === "webgl2" && kind === "webgl2")) return fail("Contexto gráfico não autorizado pela cena HTML.");
    const context = originalGetContext.call(this, kind, ...args);
    if (kind === "webgl2" && context) graphicsContexts.add(context);
    if (kind === "2d" && context && context.font === "10px sans-serif") context.font = "10px Arial";
    return context;
  } });
  Object.defineProperty(window, "__graphicsInfo", { configurable: false, writable: false, value: () => [...graphicsContexts].map(gl => {
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return { version: gl.getParameter(gl.VERSION), vendor: gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  }) });
  Object.defineProperty(window, "OffscreenCanvas", { configurable: false, writable: false, value: undefined });
  Object.defineProperty(window, "__renderFrame", { configurable: false, writable: false, value: async (frame, total, fps) => {
    if (typeof window.__setFrame === "function") await window.__setFrame(frame, total, Object.freeze({ ...studio, frame, timeSeconds: frame / fps }));
    for (const gl of graphicsContexts) {
      if (gl.isContextLost()) fail("Contexto WebGL perdido durante o render.");
      gl.finish();
      if (gl.getError() !== gl.NO_ERROR) fail("WebGL reportou erro durante o render.");
    }
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = frame * 1000 / fps; }
    await document.fonts.ready;
    if (document.querySelector("iframe,frame,object,embed")) fail("Documento não pode criar subdocumentos.");
    for (const element of document.querySelectorAll("*")) {
      if (!/^(?:Arial|"Arial"|'Arial')(?:,\s*sans-serif)?$/i.test(getComputedStyle(element).fontFamily)) fail("Documento exige fonte Arial pinada.");
    }
    if (failures.length) throw new Error("Documento violou contrato local.");
  } });
}

async function renderDocumentFrames({ executable, scene, source, fontFile, frameRoot, onScreenText, maxWallMs, beforeLoad }) {
  const graphicsArgs = scene.graphicsApi === "webgl2" ? ["--use-gl=angle", "--use-angle=d3d11"] : ["--disable-webgl"];
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run", ...graphicsArgs, "--js-flags=--max-old-space-size=1024"] });
  let deadline;
  let requests = 0;
  let pageErrors = 0;
  const render = async () => {
    const context = await browser.newContext({ viewport: { width: scene.width, height: scene.height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "UTC", serviceWorkers: "block", acceptDownloads: false, offline: true });
    await context.route("**/*", (route) => { requests++; return route.abort(); });
    await context.routeWebSocket("**/*", (socket) => { requests++; socket.close(); });
    const page = await context.newPage();
    page.on("pageerror", () => pageErrors++);
    page.on("download", (download) => { requests++; void download.cancel(); });
    page.on("dialog", (dialog) => { pageErrors++; void dialog.dismiss(); });
    // Install before the fixed pause target: parallel browser startup can take
    // longer than 1 ms. No artwork or application timers are loaded yet.
    await page.clock.install({ time: new Date("2019-12-31T23:00:00.000Z") });
    await page.clock.pauseAt(new Date("2020-01-01T00:00:00.001Z"));
    await page.setContent('<!doctype html><style>html,body{margin:0;background:transparent}iframe{border:0;display:block}</style><iframe name="render-document" sandbox="allow-scripts"></iframe>');
    const fontBytes = (await readFile(fontFile)).toString("base64");
    const studio = { text: String(onScreenText ?? ""), width: scene.width, height: scene.height, fps: scene.fps, frameCount: scene.frameCount, durationSeconds: scene.durationSeconds, graphicsApi: scene.graphicsApi ?? "canvas2d" };
    const boot = `(${documentBootstrap.toString()})(${JSON.stringify(studio).replaceAll("<", "\\u003c")});`;
    const document = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
      `<style>@font-face{font-family:Arial;src:url(data:font/ttf;base64,${fontBytes})}*{font-family:Arial}html,body{margin:0;background:transparent;overflow:hidden}</style><script>${boot}</script>${source}`;
    await beforeLoad();
    await page.locator("iframe").evaluate((element, value) => { element.width = String(value.width); element.height = String(value.height); element.srcdoc = value.document; }, { width: scene.width, height: scene.height, document });
    const frame = page.frame({ name: "render-document" });
    await frame.waitForFunction(() => typeof window.__renderFrame === "function", null, { polling: 10, timeout: 10_000 });
    // O frame de origem opaca pode ser pintado em outro processo. Concluir
    // evaluate não confirma que a superfície já chegou ao compositor pai.
    // O mundo isolado usa rAF nativo, sem expor o relógio real ao documento.
    const paintWorlds = [];
    for (const target of [frame, page]) {
      const session = await context.newCDPSession(target);
      const { frameTree } = await session.send("Page.getFrameTree");
      const { executionContextId } = await session.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: `studio-paint-${randomUUID()}` });
      paintWorlds.push({ session, executionContextId });
    }
    let firstFrameHash;
    let lastFrameHash;
    for (let index = 0; index < scene.frameCount; index++) {
      if (index) await page.clock.runFor(1000 / scene.fps);
      await frame.evaluate(({ index, total, fps }) => window.__renderFrame(index, total, fps), { index, total: scene.frameCount, fps: scene.fps });
      for (const { session, executionContextId } of paintWorlds) {
        const result = await session.send("Runtime.evaluate", { contextId: executionContextId, expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))", awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails || result.result?.value !== true) throw new Error("Navegador não confirmou a pintura do frame HTML.");
      }
      if (requests || pageErrors) throw new Error("Renderer HTML bloqueou acesso ou erro do documento.");
      const jpeg = scene.captureFormat === "jpeg";
      const file = path.join(frameRoot, `frame-${String(index).padStart(6, "0")}.${jpeg ? "jpg" : "png"}`);
      await page.screenshot({ path: file, type: jpeg ? "jpeg" : "png", ...(jpeg ? { quality: 90 } : { omitBackground: true }), animations: "allow" });
      if (index === 0) firstFrameHash = await sha256Process(file);
      if (index === scene.frameCount - 1) lastFrameHash = await sha256Process(file);
    }
    if (requests || pageErrors) throw new Error("Renderer HTML violou isolamento.");
    const graphics = scene.graphicsApi === "webgl2" ? { api: "webgl2", backend: "angle-d3d11", contexts: await frame.evaluate(() => window.__graphicsInfo()) } : null;
    if (graphics && !graphics.contexts.length) throw new Error("Cena WebGL não criou um contexto WebGL 2.");
    return { firstFrameHash, lastFrameHash, frameExtension: scene.captureFormat === "jpeg" ? "jpg" : "png", browserVersion: browser.version(), networkRequests: requests, pageErrors, ...(graphics ? { graphics } : {}) };
  };
  try {
    return await Promise.race([render(), new Promise((_, reject) => { deadline = setTimeout(() => { reject(new Error("Renderer HTML excedeu limite de parede.")); void browser.close(); }, maxWallMs); })]);
  } finally { clearTimeout(deadline); await browser.close(); }
}

async function writeOrVerifyHtmlJson(file, value, recoverExisting) {
  if (recoverExisting && await pathExists(file)) {
    if (operationFingerprint(JSON.parse(await readFile(file, "utf8"))) !== operationFingerprint(value)) throw new Error("Publicação HTML existente diverge do pedido retomado.");
    return;
  }
  await writeJsonAtomic(file, value, { label: "Metadado HTML" });
}

export async function renderHtmlMotionPilot({ scene: inputScene = {}, outputFile, receiptFile, metadataDirectory, executablePath = null,
  documentFile = null, videoFile = null, onScreenText = "", beforeRender = null, parentReceipts = [], metadata = {}, maxWallMs = 120_000, recoverExisting = false, engine = "playwright" } = {}) {
  if (!["playwright", "hyperframes", "remotion"].includes(engine)) throw new Error("Motor local desconhecido.");
  if (engine !== "playwright" && documentFile) throw new Error("Motores externos aceitam cenas paramétricas; documento executável exige o sandbox HTML canônico.");
  const backend = engine === "playwright" ? null : await import("./local-render-engines.mjs");
  const engineBinding = backend ? await backend.describeLocalRenderEngine(engine) : null;
  const scene = assertHtmlMotionScene(createHtmlMotionScene(inputScene));
  if (scene.graphicsApi === "webgl2" && (engine !== "playwright" || !documentFile || process.platform !== "win32")) throw new Error("WebGL 2 exige documento no sandbox Playwright e backend ANGLE/D3D11 do Windows.");
  if (scene.wordMotion && (engine !== "hyperframes" || documentFile)) throw new Error("Motion tipográfico exige HyperFrames e não aceita documento externo.");
  if (scene.captureFormat === "jpeg" && engine !== "hyperframes" && !(scene.graphicsApi === "webgl2" && documentFile && !videoFile)) throw new Error("Captura JPEG exige HyperFrames ou documento WebGL autônomo, sem overlay de vídeo.");
  if (scene.motionStyle === "mcp-ui-reconstruction@1" && engine !== "hyperframes") throw new Error("Reconstrução MCP exige HyperFrames.");
  if (scene.motionStyle === "focus-motion-zak@1" && engine !== "hyperframes") throw new Error("Reconstrução ZAK exige HyperFrames.");
  if (scene.motionStyle === "nano-banana-motion@1" && engine !== "hyperframes") throw new Error("Nano Banana motion exige HyperFrames.");
  if (scene.motionStyle === PLAY_STYLE && (engine !== "hyperframes" || documentFile || videoFile)) throw new Error("Typographic Play exige HyperFrames em composição silenciosa autônoma.");
  if (engine !== "playwright" && (!Number.isInteger(scene.fps) || scene.width % 2 || scene.height % 2 || scene.width > 1920 || scene.height > 1920 || scene.frameCount > 3600)) throw new Error("Motor local exige fps inteiro, dimensões pares até 1920 e até 3600 frames.");
  if (![outputFile, receiptFile, metadataDirectory].every(value => typeof value === "string" && value.trim())) throw new Error("Renderer HTML exige caminhos de saída, recibo e metadados.");
  if (!Number.isSafeInteger(maxWallMs) || maxWallMs < 1 || maxWallMs > 600_000) throw new Error("Limite de parede HTML inválido.");
  if (beforeRender != null && typeof beforeRender !== "function") throw new Error("beforeRender deve ser função.");
  if (typeof recoverExisting !== "boolean") throw new Error("recoverExisting deve ser booleano.");
  const target = path.resolve(String(outputFile));
  const receiptTarget = path.resolve(String(receiptFile));
  const metadataRoot = path.resolve(String(metadataDirectory));
  const executable = executablePath ? path.resolve(executablePath) : await findBrowserExecutable();
  await access(executable);
  const ffmpegFile = findCommand("ffmpeg");
  if (!ffmpegFile) throw new Error("FFmpeg local ausente para o piloto HTML.");
  const playAssets = scene.motionStyle === PLAY_STYLE ? await typographicPlayAssets(scene.playRecipe) : null;
  const fontFile = playAssets ? playAssets.fonts[0].file : await findFontFile(scene.fontFamily);
  await beforeRender?.();
  const inputs = [];
  if (documentFile) inputs.push(await createArtifactFromFile({ file: documentFile, kind: "document", role: "graphics-document" }));
  if (videoFile) inputs.push(await createArtifactFromFile({ file: videoFile, kind: "video", role: "source-video" }));
  const verifyInputs = async () => {
    for (const artifact of inputs) if (!(await verifyArtifact(artifact)).valid) throw new Error("Entrada HTML mudou antes da publicação.");
  };
  const source = documentFile ? await readFile(documentFile, "utf8") : playAssets ? await typographicPlayDocument(scene, playAssets) : scene.motionStyle === "nano-banana-motion@1" ? await nanoBananaMotionDocument(scene) : scene.motionStyle === "focus-motion-zak@1" ? await focusMotionZakDocument(scene) : scene.motionStyle === "mcp-ui-reconstruction@1" ? mcpUiReconstructionDocument(scene) : scene.motionStyle === "organic-launch@1" ? await organicLaunchDocument(scene) : scene.motionStyle === "premium-morph@1" ? await premiumMorphDocument(scene) : scene.motionStyle === "integrated-launch@1" ? integratedLaunchDocument(scene) : scene.motionStyle === "adp-explainer@1" ? adpExplainerDocument(scene) : scene.wordMotion ? kineticLaunchDocument(scene) : htmlDocument(scene);
  if (source.includes("\u0000") || !source.trim()) throw new Error("Documento HTML vazio ou inválido.");
  await verifyInputs();
  const toolFiles = [executable, process.execPath, ffmpegFile, fontFile, ...(scene.graphicsApi === "webgl2" ? [fileURLToPath(import.meta.url)] : []), ...(playAssets?.files ?? []), ...(scene.premiumStyle ? premiumBindingFiles(scene.premiumStyle) : []), ...(scene.motionStyle === "organic-launch@1" ? organicBindingFiles() : []), ...(engineBinding?.bindingFiles ?? [])];
  const toolHashes = await Promise.all(toolFiles.map(sha256Process));
  const ffmpegVersion = spawnSync(ffmpegFile, ["-version"], { encoding: "utf8", windowsHide: true }).stdout?.split(/\r?\n/)[0];
  const sceneFile = path.join(metadataRoot, `${path.basename(target)}.scene.json`);
  const sandboxFile = path.join(metadataRoot, `${path.basename(target)}.sandbox.json`);
  const bindingFile = path.join(metadataRoot, `${path.basename(target)}.binding.json`);
  const preparedFile = path.join(metadataRoot, `${path.basename(target)}.prepared.json`);
  const authorization = metadata.documentAuthorization;
  const binding = { schema: "mkt-videos/html-publication-binding@1", consumer: engineBinding ? `${engine}@${engineBinding.version}/studio-1` : scene.graphicsApi === "webgl2" ? "html-webgl2@1.0.0" : "html-canvas@1.2.0", ...(engineBinding ? { engineBinding } : {}), scene, onScreenText,
    composition: videoFile ? "overlay-preserve-audio" : "standalone", outputFile: target, receiptFile: receiptTarget, maxWallMs,
    inputs: inputs.map(({ file, role, kind, hash, bytes, mimeType }) => ({ file, role, kind, hash, bytes, mimeType })),
    tools: toolFiles.map((file, index) => ({ file, sha256: toolHashes[index] })),
    parentReceipts: [...new Set(parentReceipts)].sort(),
    authorization: authorization ? { rootScopeId: authorization.rootScopeId, itemId: authorization.itemId, itemHash: authorization.itemHash, sha256: authorization.sha256, bytes: authorization.bytes } : null };
  const requestFingerprint = operationFingerprint(binding);
  if (!recoverExisting || !await pathExists(bindingFile)) {
    for (const file of [target, receiptTarget, sceneFile, sandboxFile, preparedFile]) await assertPathAvailable(file, "Publicação HTML sem vínculo de retomada");
  }
  await writeOrVerifyHtmlJson(bindingFile, binding, recoverExisting);
  const match = { operation: "render-html-motion-pilot", inputFiles: [...inputs.map(input => input.file), sceneFile, sandboxFile, bindingFile], outputFile: target,
    parameters: { consumer: binding.consumer, requestFingerprint }, parentReceipts };
  const resultFromReceipt = (receipt, recoveredPublication) => ({ file: target, receiptFile: receiptTarget, sceneFile, sandboxFile, bindingFile, preparedFile, receipt, probe: receipt.metadata.probe, recoveredPublication });
  if (recoverExisting) {
    const receipt = await readMatchingLocalReceipt({ ...match, file: receiptTarget });
    if (receipt) { await beforeRender?.(); await verifyInputs(); return resultFromReceipt(receipt, "completed-receipt"); }
    if (await pathExists(preparedFile)) {
      const prepared = JSON.parse(await readFile(preparedFile, "utf8"));
      if (prepared.schema !== "mkt-videos/html-publication-prepared@1" || prepared.requestFingerprint !== requestFingerprint) throw new Error("Preparação HTML diverge do pedido retomado.");
      const stagingFile = prepared.receipt?.metadata?.publication?.stagingFile;
      const prefix = `${path.basename(target)}.`;
      if (typeof stagingFile !== "string" || path.dirname(path.resolve(stagingFile)) !== path.dirname(target) || !path.basename(stagingFile).startsWith(prefix) ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp\.mp4$/i.test(path.basename(stagingFile).slice(prefix.length))) throw new Error("Temporário HTML fora da publicação declarada.");
      const outputExists = await pathExists(target);
      const candidate = outputExists ? target : stagingFile;
      const candidateStat = await lstat(candidate);
      if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw new Error("Candidato HTML deve ser arquivo regular sem link simbólico.");
      await readMatchingLocalReceipt({ ...match, file: preparedFile, receipt: prepared.receipt, outputCandidateFile: candidate });
      await beforeRender?.(); await verifyInputs();
      if (!outputExists) await commitOrVerifyLocalFile(stagingFile, target, { recoverExisting: true, preserveOnFailure: true, label: "HTML preparado" });
      await readMatchingLocalReceipt({ ...match, file: preparedFile, receipt: prepared.receipt });
      await writeStageReceipt(receiptTarget, prepared.receipt);
      return resultFromReceipt(prepared.receipt, outputExists ? "missing-receipt" : "staged-output");
    }
    if (await pathExists(target)) throw new Error("MP4 HTML existente sem recibo preparado; não atribuir nova receita ao arquivo.");
  }
  await mkdir(metadataRoot, { recursive: true });
  const unique = randomUUID();
  const frameRoot = path.join(metadataRoot, `.frames-${process.pid}-${unique}`);
  await mkdir(frameRoot, { recursive: true });
  const startedAt = new Date();
  const temporary = `${target}.${unique}.tmp.mp4`;
  let publicationPrepared = false;
  try {
    const capture = backend ? backend.captureLocalRenderFrames : renderDocumentFrames;
    const frames = await capture({ engine, executable, scene, source, fontFile, frameRoot, onScreenText, maxWallMs, beforeLoad: async () => { await beforeRender?.(); await verifyInputs(); } });
    await beforeRender?.();
    await verifyInputs();
    await mkdir(path.dirname(target), { recursive: true });
  const frameExtension = frames.frameExtension ?? "png";
  if (!["png", "jpg"].includes(frameExtension)) throw new Error("Extensão de frame inválida.");
  const imageInput = ["-framerate", String(scene.fps), "-start_number", "0", "-i", path.join(frameRoot, `frame-%06d.${frameExtension}`)];
    await runFfmpeg([...(videoFile ? ["-i", videoFile, ...imageInput, "-filter_complex", `[0:v]scale=${scene.width}:${scene.height},setsar=1,fps=${scene.fps}[base];[base][1:v]overlay=shortest=1:format=auto[v]`, "-map", "[v]", "-map", "0:a?", "-c:a", "copy"] : imageInput),
      "-t", String(scene.durationSeconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", temporary]);
    const rendered = await probeTiming({ mediaFile: temporary, expectedFrames: scene.frameCount });
    if (rendered.streams.find(stream => stream.codec_type === "video")?.decodedFrames !== scene.frameCount) throw new Error("Render HTML diverge da contagem de frames congelada.");
    for (let index = 0; index < toolFiles.length; index++) if (await sha256Process(toolFiles[index]) !== toolHashes[index]) throw new Error("Ferramenta HTML mudou durante o render.");
    await beforeRender?.();
    await verifyInputs();
    const sandbox = createRendererSandboxManifest({
      browser: { name: "chromium", version: frames.browserVersion, sha256: toolHashes[0] },
      node: { version: process.versions.node, sha256: toolHashes[1] },
      ffmpeg: { version: ffmpegVersion, sha256: toolHashes[2] },
      fonts: playAssets ? playAssets.fonts.map(font => ({ id: path.basename(font.file), license: "OFL-1.1", sha256: font.sha256 })) : [{ id: scene.fontFamily, license: "system-font-license-review-required", sha256: toolHashes[3] }],
      viewport: { width: scene.width, height: scene.height }, dpr: 1, locale: "pt-BR", timezone: "UTC", seed: "html-motion-pilot@1", cpuLimitMs: maxWallMs,
    });
    await writeOrVerifyHtmlJson(sceneFile, scene, recoverExisting);
    await writeOrVerifyHtmlJson(sandboxFile, sandbox, recoverExisting);
    const [sceneArtifact, sandboxArtifact, bindingArtifact, stagedArtifact] = await Promise.all([
      createArtifactFromFile({ file: sceneFile, kind: "json", role: "html-motion-scene", source: { provider: "local-html" } }),
      createArtifactFromFile({ file: sandboxFile, kind: "json", role: "renderer-sandbox", source: { provider: "local-html" } }),
      createArtifactFromFile({ file: bindingFile, kind: "json", role: "html-publication-binding", source: { provider: "local-html" } }),
      createArtifactFromFile({ file: temporary, kind: "video", role: "html-motion-master", source: { provider: "local-html" } }),
    ]);
    const outputArtifact = { ...stagedArtifact, file: target, name: path.basename(target) };
    const after = await probeMedia(temporary);
    const receipt = createStageReceipt({ operation: "render-html-motion-pilot", provider: "local-html", mode: "studio", stage: "html-motion", parentReceipts,
      parameters: { schema: HTML_MOTION_PILOT_SCHEMA, renderer: engineBinding ? engine : HTML_MOTION_PILOT_RENDERER, consumer: binding.consumer, requestFingerprint, scene, onScreenText, sandboxFingerprint: sandbox.fingerprint, composition: binding.composition },
      inputs: [...inputs, sceneArtifact, sandboxArtifact, bindingArtifact], artifacts: [outputArtifact], metadata: { ...metadata, publication: { stagingFile: temporary }, providerFree: true, providerCalls: 0, changed: Boolean(documentFile || videoFile), frameCount: scene.frameCount, ...frames, exactText: documentFile ? null : true,
        enforcement: frames.enforcement ?? { origin: "opaque-sandbox-frame", network: "offline+csp+route", clock: "playwright-clock+frame-callback", fonts: "embedded-arial", maxWallMs, javascriptHeapMb: 1024, processMemoryLimitEnforced: false }, safeArea: scene.safeArea, probe: after }, startedAt, completedAt: new Date() });
    await writeJsonAtomic(preparedFile, { schema: "mkt-videos/html-publication-prepared@1", requestFingerprint, receipt }, { label: "Preparação HTML" });
    publicationPrepared = true;
    await commitOrVerifyLocalFile(temporary, target, { recoverExisting, preserveOnFailure: true, label: "HTML MP4" });
    await readMatchingLocalReceipt({ ...match, file: preparedFile, receipt });
    await writeStageReceipt(receiptTarget, receipt);
    return resultFromReceipt(receipt, null);
  } finally {
    if (!publicationPrepared) await rm(temporary, { force: true });
    await rm(frameRoot, { recursive: true, force: true });
  }
}

/**
 * Local, unpaid adapter projection for the deterministic HTML renderer. It
 * delegates to the pilot renderer and never creates a second executor.
 */
export function createHtmlMotionAdapter({ engine = "playwright" } = {}) {
  if (!["playwright", "hyperframes", "remotion"].includes(engine)) throw new Error("Motor local desconhecido.");
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: `${engine}-html-motion`,
    providerId: `${engine}-html-local`,
    kind: "video",
    operations: ["html-render"],
    authMode: "none",
    authContract: "local-no-auth",
    paidOperations: [],
    reconcileOperations: [],
    resultKinds: ["video"],
    estimate: async ({ request } = {}) => ({ paidCalls: 0, localOperations: 1, provider: "local-html", frameCount: request?.scene?.frameCount ?? null }),
    execute: async ({ request } = {}) => {
      const result = await renderHtmlMotionPilot({ ...request, engine });
      return {
        status: "ready",
        artifacts: result.receipt.artifacts,
        receipt: result.receipt,
        file: result.file,
        metadata: { probe: result.probe, frameCount: result.receipt.metadata.frameCount },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
