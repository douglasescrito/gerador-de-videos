import path from "node:path";
import { readFile } from "node:fs/promises";
import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File } from "./artifact.mjs";
import { optionalMotionBindingFiles } from "./optional-motion-templates.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const engines = {
  hyperframes: { package: "@hyperframes/engine", version: "0.8.30", license: "Apache-2.0", docs: "https://hyperframes.app/docs/5-packages/engine" },
  remotion: { package: "@remotion/renderer", version: "4.0.521", license: "Remotion License", docs: "https://www.remotion.dev/docs/renderer" },
};

export async function describeLocalRenderEngine(engine) {
  const entry = engines[engine];
  if (!entry) throw new Error("Motor deve ser hyperframes ou remotion.");
  const packages = engine === "remotion" ? [entry.package, "@remotion/bundler", "remotion", "react", "react-dom"] : [entry.package, "opentype.js", "gsap"];
  const installed = [];
  for (const name of packages) {
    const file = path.join(root, "node_modules", name, "package.json");
    const pkg = JSON.parse(await readFile(file, "utf8"));
    const expected = name === "gsap" ? "3.14.2" : name === "opentype.js" ? "2.0.0" : name.startsWith("react") ? "19.2.0" : entry.version;
    if (pkg.version !== expected) throw new Error(`Versão divergente de ${name}: esperado ${expected}. Execute npm ci.`);
    installed.push({ name, version: pkg.version, file });
  }
  const bindingFiles = [...optionalMotionBindingFiles(), path.join(root, "package-lock.json"), fileURLToPath(import.meta.url), path.join(import.meta.dirname, "local-render-worker.mjs"), path.join(import.meta.dirname, "html-motion-pilot.mjs"), path.join(import.meta.dirname, "kinetic-launch.mjs"), path.join(import.meta.dirname, "integrated-launch.mjs"), path.join(import.meta.dirname, "premium-morph.mjs"), path.join(root, "node_modules/opentype.js/package.json"), ...installed.map(p => p.file)];
  if (engine === "hyperframes") bindingFiles.push(path.join(root, "node_modules/opentype.js/dist/opentype.js"));
  bindingFiles.push(path.join(import.meta.dirname, "organic-launch.mjs"));
  bindingFiles.push(path.join(import.meta.dirname, "mcp-ui-reconstruction.mjs"));
  bindingFiles.push(path.join(import.meta.dirname, "typographic-play.mjs"));
  return { id: engine, ...entry, installed, bindingFiles, providerFree: true, auth: "none", input: "parametric-scene", audio: "silent-visual; Studio mix is separate" };
}

// A bounded capture adapter process isolates third-party logs and environment.
// Encoding, verification, receipts and recovery remain in renderHtmlMotionPilot.
export async function captureLocalRenderFrames(options) {
  await options.beforeLoad();
  const { beforeLoad, ...request } = options;
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "PATHEXT"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  env.NODE_ENV = "production";
  env.PUPPETEER_SKIP_DOWNLOAD = "true";
  const worker = fork(path.join(import.meta.dirname, "local-render-worker.mjs"), [], { env, execArgv: [], windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let log = "";
  for (const stream of [worker.stdout, worker.stderr]) stream.on("data", chunk => { log = (log + chunk.toString()).slice(-12000); });
  const result = await new Promise((resolve, reject) => {
    let response;
    let timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(worker.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else worker.kill("SIGKILL");
    }, options.maxWallMs);
    worker.on("message", value => { response = value; });
    worker.once("error", error => { clearTimeout(timer); reject(error); });
    worker.once("exit", code => {
      clearTimeout(timer);
      if (timeout) reject(new Error("Motor local excedeu limite de parede; captura cancelada."));
      else if (code !== 0 || !response?.ok) reject(new Error(response?.error ?? `Captura local falhou (${code}): ${log.slice(-2000)}`));
      else resolve(response.result);
    });
    worker.send(request);
  });
  const ext = result.frameExtension ?? "png";
  if (!["png", "jpg"].includes(ext)) throw new Error("Extensão de captura inválida.");
  return { ...result, firstFrameHash: await sha256File(path.join(options.frameRoot, `frame-000000.${ext}`)), lastFrameHash: await sha256File(path.join(options.frameRoot, `frame-${String(options.scene.frameCount - 1).padStart(6, "0")}.${ext}`)) };
}
