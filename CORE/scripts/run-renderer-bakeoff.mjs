import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { studioLocalPath } from '../lib/studio-local-config.mjs';
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";
import {
  buildRendererBakeOffReport,
  createRendererContract,
  createRendererSandboxManifest,
} from "../lib/media-pipeline/renderer-contract.mjs";

const SHA256 = /^[a-f0-9]{64}$/;

async function sha256File(file) {
  const digest = createHash("sha256");
  digest.update(await readFile(file));
  return digest.digest("hex");
}

async function findChromium() {
  const configured = studioLocalPath('chromePath');
  if (configured) {
    if (!(await stat(configured).catch(() => null))?.isFile()) throw new Error('Chrome configurado não encontrado.');
    return { executable: configured, version: 'local-configured-hash-pinned' };
  }
  const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return null; }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  for (const entry of candidates) {
    const executable = path.join(root, entry.name, "chrome-win64", process.platform === "win32" ? "chrome.exe" : "chrome");
    try {
      if ((await stat(executable)).isFile()) return { executable, version: entry.name };
    } catch { /* candidate absent */ }
  }
  return null;
}

function findFfmpeg() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, ["ffmpeg"], { encoding: "utf8", windowsHide: true });
  const file = String(result.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return file || null;
}

const CASES = [
  {
    id: "offline-typography-card",
    expected: "frame-exact",
    omitBackground: false,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:640px;height:360px;background:#0f1f3d;color:#fff;font-family:Arial,sans-serif}main{box-sizing:border-box;width:100%;height:100%;display:grid;place-items:center}div{font-size:42px;font-weight:700;letter-spacing:.04em;text-align:center}small{display:block;font-size:14px;font-weight:400;opacity:.75;margin-top:12px}</style></head><body><main><div data-testid="motion-card">MOTION IR<small>frame 0000 · offline</small></div></main></body></html>`,
  },
  {
    id: "offline-alpha-overlay",
    expected: "frame-exact",
    omitBackground: true,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:640px;height:360px;background:transparent}main{box-sizing:border-box;width:100%;height:100%;display:grid;place-items:center}div{width:280px;height:120px;border:8px solid #67e8f9;border-radius:24px;box-shadow:0 0 32px #67e8f9;transform:rotate(-3deg)}</style></head><body><main><div data-testid="alpha-overlay"></div></main></body></html>`,
  },
];

async function renderFrame({ executable, outputFile, html, omitBackground }) {
  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];
  let fontLoaded = false;
  const startedAt = performance.now();
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
      locale: "pt-BR",
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.on("request", (request) => requests.push(request.url()));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    await page.addInitScript({ content: "Date.now = () => 1700000000000; Math.random = () => 0.5;" });
    await page.setContent(html, { waitUntil: "load" });
    fontLoaded = await page.evaluate(() => document.fonts.check("42px Arial"));
    await page.screenshot({ path: outputFile, type: "png", animations: "disabled", omitBackground });
    await context.close();
  } finally {
    await browser.close();
  }
  const png = await readFile(outputFile);
  return {
    sha256: await sha256File(outputFile),
    requests,
    consoleErrors,
    pageErrors,
    fontLoaded,
    alpha: png[25] === 6,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

async function main() {
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  const outputFile = path.resolve(outArg ? outArg.slice("--out=".length) : path.join(import.meta.dirname, "..", "diagnosticos", "governanca", "renderer-bakeoff.json"));
  const chromiumCandidate = await findChromium();
  const ffmpeg = findFfmpeg();
  const font = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "arial.ttf");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mkt-renderer-bakeoff-"));
  let report;
  try {
    if (!chromiumCandidate || !ffmpeg || !(await stat(font).catch(() => null))) {
      report = {
        schema: "mkt-videos/renderer-bake-off@1",
        providerFree: true,
        promotionPerformed: false,
        decision: "pending",
        status: "blocked",
        blockers: [
          ...(!chromiumCandidate ? ["browser_pinned_absent"] : []),
          ...(!ffmpeg ? ["ffmpeg_pinned_absent"] : []),
          ...(!await stat(font).catch(() => null) ? ["font_pinned_absent"] : []),
        ],
      };
      report.fingerprint = operationFingerprint(Object.fromEntries(Object.entries(report).filter(([key]) => key !== "fingerprint")));
    } else {
      const browserSha = await sha256File(chromiumCandidate.executable);
      const nodeSha = await sha256File(process.execPath);
      const ffmpegSha = await sha256File(ffmpeg);
      const fontSha = await sha256File(font);
      if (![browserSha, nodeSha, ffmpegSha, fontSha].every((value) => SHA256.test(value))) throw new Error("Hash de ambiente inválido.");
      const sandbox = createRendererSandboxManifest({
        browser: { name: "chromium", version: chromiumCandidate.version, sha256: browserSha },
        node: { version: process.versions.node, sha256: nodeSha },
        ffmpeg: { version: "path-pinned", sha256: ffmpegSha },
        fonts: [{ id: "Arial", license: "system-font-license-review-required", sha256: fontSha }],
        viewport: { width: 640, height: 360 },
        dpr: 1,
        locale: "pt-BR",
        timezone: "UTC",
        seed: "renderer-bakeoff@1",
      });
      const candidate = createRendererContract({
        id: "playwright-canvas@local",
        name: "Playwright Canvas mínimo",
        version: chromiumCandidate.version,
        license: "Apache-2.0 (Playwright) + browser license review",
        capabilities: ["typography", "composition", "alpha", "offline-frame", "font-check", "debug-capture"],
        sandbox,
        status: "tested",
      });
      const results = [];
      for (const testCase of CASES) {
        const first = await renderFrame({ executable: chromiumCandidate.executable, outputFile: path.join(tempRoot, `${testCase.id}-a.png`), html: testCase.html, omitBackground: testCase.omitBackground });
        const second = await renderFrame({ executable: chromiumCandidate.executable, outputFile: path.join(tempRoot, `${testCase.id}-b.png`), html: testCase.html, omitBackground: testCase.omitBackground });
        const networkRequests = [...first.requests, ...second.requests];
        results.push({
          id: testCase.id,
          expected: testCase.expected,
          status: first.sha256 === second.sha256 && networkRequests.length === 0 && first.pageErrors.length === 0 && second.pageErrors.length === 0 ? "pass" : "blocked",
          firstSha256: first.sha256,
          secondSha256: second.sha256,
          exact: first.sha256 === second.sha256,
          networkRequests: networkRequests.length,
          alpha: first.alpha && second.alpha,
          fontLoaded: first.fontLoaded && second.fontLoaded,
          consoleErrors: first.consoleErrors.length + second.consoleErrors.length,
          pageErrors: first.pageErrors.length + second.pageErrors.length,
          durationMs: Math.max(first.durationMs, second.durationMs),
        });
      }
      report = buildRendererBakeOffReport({
        candidates: [candidate],
        corpus: results.map((result) => ({ id: result.id, expected: result.expected, results: { [candidate.id]: result } })),
        decision: "pending",
      });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ ok: true, output: outputFile, schema: report.schema, decision: report.decision, promotionPerformed: report.promotionPerformed, status: report.status ?? "tested" })}\n`);
}

await main();
