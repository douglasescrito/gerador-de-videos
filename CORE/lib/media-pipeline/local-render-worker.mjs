import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// This file is only launched by the adapter with an explicit scene and clean env.
if (!process.send) throw new Error("Worker de captura exige IPC do adapter.");

const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const safeJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");

async function hyperframes({ executable, frameRoot, scene, source, fontFile }) {
  const hf = await import("@hyperframes/engine");
  const font = (await readFile(fontFile)).toString("base64");
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>@font-face{font-family:Arial;src:url(data:font/ttf;base64,${font})}</style>${source}<script>window.__hf={duration:${scene.durationSeconds},seek(t){return window.__setFrame(Math.round(t*${scene.fps}),${scene.frameCount})}};</script>`;
  const url = "http://studio-render.invalid";
  const format = scene.captureFormat ?? "png";
  const frameExtension = format === "jpeg" ? "jpg" : "png";
  const session = await hf.createCaptureSession(url, frameRoot, { width: scene.width, height: scene.height, fps: { num: scene.fps, den: 1 }, format, quality: 100, deviceScaleFactor: 1, compositionDurationSeconds: scene.durationSeconds }, null,
    { chromePath: executable, forceScreenshot: true, staticFrameDedup: false, enableBrowserPool: false, browserGpuMode: "software", disableGpu: true, concurrency: 1, useDrawElement: false, protocolTimeout: 30000 });
  let networkRequests = 0;
  let pageErrors = 0;
  try {
    await session.page.setOfflineMode(true);
    await session.page.setRequestInterception(true);
    session.page.on("request", req => { if (req.url() === `${url}/index.html`) void req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: html }); else if (req.url().startsWith("data:font/") || req.url().startsWith("data:image/")) void req.continue(); else { networkRequests++; console.error("INTERCEPTED_REQUEST:", req.url().slice(0, 100)); void req.abort(); } });
    session.page.on("pageerror", err => { pageErrors++; console.error("PAGE_ERROR:", err); });
    await session.page.emulateTimezone("UTC");
    await session.page.evaluateOnNewDocument(organic => {
      // GSAP reads Date.now during initialization. This trusted template receives
      // only the explicit frame clock, never elapsed browser/wall time.
      window.__studioTimeMs = 0;
      Date.now = organic ? () => window.__studioTimeMs : () => { throw new Error("Use o frame da cena."); };
      Math.random = () => 0.5;
    }, ["organic-launch@1", "typographic-play@1", "focus-motion-zak@1", "nano-banana-motion@1"].includes(scene.motionStyle));
    await hf.initializeSession(session);
    if (scene.motionStyle === "typographic-play@1") await session.page.evaluate(() => window.__playReady);
    await session.page.evaluate(async () => {
      await document.fonts.load("900 142px Arial");
      await document.fonts.ready;
      const imgs = Array.from(document.querySelectorAll("img"));
      await Promise.all(imgs.map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
    });
    // HyperFrames clears body backgrounds for PNG alpha capture. This route
    // declares an opaque scene background; restore it before h264 encoding.
    await session.page.evaluate(background => {
      for (const element of [document.documentElement, document.body]) element.style.setProperty("background", background, "important");
    }, scene.background);
    for (let index = 0; index < scene.frameCount; index++) {
      const result = await hf.captureFrameToBuffer(session, index, index / scene.fps);
      await writeFile(path.join(frameRoot, `frame-${String(index).padStart(6, "0")}.${frameExtension}`), result.buffer, { flag: "wx" });
    }
    if (networkRequests || pageErrors) throw new Error("Captura HyperFrames violou isolamento ou apresentou erro de página.");
    const motionDiagnostics = scene.motionStyle === "typographic-play@1" ? await session.page.evaluate(() => window.__playDiagnostics) : null;
    return { browserVersion: await session.browser.version(), networkRequests, pageErrors, ...(motionDiagnostics ? { motionDiagnostics } : {}), captureMode: session.captureMode, frameExtension, captureFormat: format, captureQuality: format === "jpeg" ? 100 : "lossless", capturePerformance: hf.getCapturePerfSummary(session) };
  } finally { await hf.closeCaptureSession(session); await hf.drainBrowserPool(); }
}

async function remotion({ executable, frameRoot, scene, fontFile }) {
  const { bundle } = await import("@remotion/bundler");
  const { openBrowser, renderFrames } = await import("@remotion/renderer");
  const font = (await readFile(fontFile)).toString("base64");
  const entry = path.join(frameRoot, "composition.jsx");
  // Only this repository-owned template is bundled. User input is JSON text,
  // never executable JSX, an import, a filesystem path or a URL.
  await writeFile(entry, `import React from 'react';
import {registerRoot,Composition,AbsoluteFill,useCurrentFrame,interpolate} from 'remotion';
const s=${safeJson(scene)};
function Visual(){const frame=useCurrentFrame();const p=interpolate(frame,[0,Math.max(1,s.frameCount-1)],[0,1]);const e=1-Math.pow(1-p,3);
return <AbsoluteFill style={{background:s.background,color:'#f8fafc',fontFamily:'Arial',overflow:'hidden'}}>
<style>{${safeJson(`@font-face{font-family:Arial;src:url(data:font/ttf;base64,${font})}`)}}</style>
<div style={{position:'absolute',width:s.width*.42,height:s.width*.42,borderRadius:'50%',background:s.accent,opacity:.22,top:-s.height*.15,right:(1-e)*s.width*.5-s.width*.12}}/>
<div style={{position:'absolute',left:'7%',top:'32%',width:'86%',transform:'translateY('+((1-e)*40)+'px)',opacity:e}}>
<div style={{fontSize:s.width*.056,fontWeight:700,letterSpacing:2}}>{s.title}</div>
<div style={{fontSize:s.width*.024,marginTop:16,opacity:.72}}>{s.subtitle}</div>
<div style={{fontSize:s.width*.025,color:s.accent,marginTop:22,opacity:e>.72?1:0}}>{s.cta}</div></div>
<div style={{position:'absolute',bottom:'10%',left:'7%',height:4,width:(p*86)+'%',background:s.accent}}/>
</AbsoluteFill>}
registerRoot(()=> <Composition id="StudioScene" component={Visual} durationInFrames={s.frameCount} fps={s.fps} width={s.width} height={s.height}/>);
`, { flag: "wx" });
  const publicDir = path.join(frameRoot, "public");
  await mkdir(publicDir);
  const serveUrl = await bundle({ entryPoint: entry, outDir: path.join(frameRoot, "bundle"), publicDir, enableCaching: false, gitSource: null });
  const indexFile = path.join(serveUrl, "index.html");
  const html = await readFile(indexFile, "utf8");
  await writeFile(indexFile, html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`));
  const browser = await openBrowser("chrome", { browserExecutable: executable, logLevel: "error", chromiumOptions: { disableWebSecurity: false, headless: true } });
  let networkRequests = 0;
  let origin = null;
  const original = browser.newPage.bind(browser);
  // Pinned renderer exposes a CDP page before navigating. Deny everything except
  // the exact ephemeral bundle origin; no external requests or implicit downloads.
  browser.newPage = async (...args) => {
    const page = await original(...args);
    const client = page._client();
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["file://*", "https://*", "ws://*", "wss://*"] });
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    client.on("Fetch.requestPaused", event => {
      const url = new URL(event.request.url);
      const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if (!origin && loopback && event.resourceType === "Document") origin = url.origin;
      const allowed = loopback && url.origin === origin && event.request.method === "GET";
      if (!allowed) networkRequests++;
      void client.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" });
    });
    await client.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
    return page;
  };
  try {
    const version = await browser.connection.send("Browser.getVersion");
    await browser.connection.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await renderFrames({ serveUrl, puppeteerInstance: browser, composition: { id: "StudioScene", width: scene.width, height: scene.height, fps: scene.fps, durationInFrames: scene.frameCount, props: {}, defaultProps: {} },
      inputProps: {}, envVariables: {}, concurrency: 1, muted: true, imageFormat: "png", outputDir: null, logLevel: "error", timeoutInMilliseconds: 30000,
      onStart: () => {}, onFrameUpdate: () => {}, onFrameBuffer: (buffer, frame) => writeFile(path.join(frameRoot, `frame-${String(frame).padStart(6, "0")}.png`), buffer, { flag: "wx" }) });
    if (networkRequests) throw new Error("Remotion tentou acessar recurso fora do bundle declarado.");
    return { browserVersion: version.value.product, networkRequests, pageErrors: 0, captureMode: "remotion-renderFrames" };
  } finally { await browser.close({ silent: true }); }
}

process.once("message", async request => {
  try {
    const capture = request.engine === "hyperframes" ? hyperframes : request.engine === "remotion" ? remotion : null;
    if (!capture) throw new Error("Motor desconhecido.");
    const result = await capture(request);
    result.enforcement = { network: request.engine === "hyperframes" ? "offline+csp+request-interception" : "csp+cdp-exact-bundle-origin", cookies: "fresh-disposable-browser", fonts: request.scene.motionStyle === "typographic-play@1" ? "embedded-ofl-manifest-sha256" : "embedded-arial", input: "trusted-template+json", clock: "explicit-frame", maxWallMs: request.maxWallMs, processMemoryLimitEnforced: false };
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) { process.send({ ok: false, error: String(error.message).replace(/data:[^\s]+/g, "[embedded-data]").slice(0, 1800) }, () => process.exit(1)); }
});
