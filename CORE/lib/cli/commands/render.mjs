import { readFile, mkdir, writeFile } from "node:fs/promises";
import { describeThreeDesign, normalizeThreeSpec, buildThreePreset } from "../../media-pipeline/three-design.mjs";
import { describeLocalRenderEngine } from "../../media-pipeline/local-render-engines.mjs";
import { createHtmlMotionScene, renderHtmlMotionPilot } from "../../media-pipeline/html-motion-pilot.mjs";
import { requireStudioMode, operationFingerprint, assertPathAvailable } from "../../media-pipeline/pipeline-operation.mjs";

export async function executar(contexto) {
  const { options, path, coreRoot, required, explicitBoolean } = contexto;
  const action = options.action ?? "engines";
  if (action === "engines") {
    if (Object.keys(options).some(key => key !== "action")) throw new Error("render --action engines não aceita opções de execução.");
    console.log(JSON.stringify({ schema: "mkt-videos/local-render-engines@1", engines: [...await Promise.all(["hyperframes", "remotion"].map(describeLocalRenderEngine)), await describeThreeDesign()] }, null, 2));
    return;
  }
  if (action !== "render") throw new Error("render --action deve ser engines ou render.");
  requireStudioMode(options.mode, "Motor de vídeo local");
  const isThree = options.engine === "threejs";
  const engine = isThree ? await describeThreeDesign() : await describeLocalRenderEngine(required(options.engine, "--engine"));
  const spec = JSON.parse(await readFile(path.resolve(required(options.spec, "--spec")), "utf8"));
  const allowed = ["id", "title", "subtitle", "cta", "width", "height", "fps", "durationSeconds", "aspect", "fontFamily", "background", "accent", "motionStyle", "motionControls", "captureFormat", "premiumStyle", "motionKeyframes", "playRecipe"];
  if (!isThree && (!spec || typeof spec !== "object" || Array.isArray(spec) || Object.keys(spec).some(key => !allowed.includes(key)))) throw new Error("Cena exige objeto JSON apenas com os campos paramétricos documentados.");
  if (options.words && engine.id !== "hyperframes") throw new Error("--words exige HyperFrames.");
  const wordMotion = options.words ? JSON.parse(await readFile(path.resolve(String(options.words)), "utf8")) : null;
  const threeSpec = isThree ? normalizeThreeSpec(spec) : null;
  const scene = createHtmlMotionScene({ ...(threeSpec ?? spec), ...(isThree ? { graphicsApi: "webgl2" } : {}), ...(wordMotion ? { wordMotion } : {}) });
  if (scene.motionStyle === "typographic-play@1" && engine.id !== "hyperframes") throw new Error("Typographic Play exige HyperFrames.");
  if (!Number.isInteger(scene.fps) || scene.width % 2 || scene.height % 2 || scene.width > 1920 || scene.height > 1920 || scene.frameCount > 3600) throw new Error("Motores locais exigem fps inteiro, dimensões pares até 1920 e no máximo 3600 frames.");
  const collection = String(options.collection ?? `motor-${engine.id}`);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(collection)) throw new Error("Coleção exige slug simples, sem caminhos.");
  const root = path.join(coreRoot, "outputs", collection);
  const outputFile = options.out ? path.resolve(String(options.out)) : path.join(root, "videos-unidos", `${engine.id}-${operationFingerprint(threeSpec ?? scene).slice(0, 16)}.mp4`);
  if (path.extname(outputFile).toLowerCase() !== ".mp4") throw new Error("--out exige extensão .mp4.");
  const receiptFile = options.out ? `${outputFile}.receipt.json` : path.join(root, "receitas", `${path.basename(outputFile)}.receipt.json`);
  const metadataDirectory = options.out ? path.join(path.dirname(outputFile), "metadados", path.basename(outputFile)) : path.join(root, "metadados");
  const dryRun = explicitBoolean(options["dry-run"], "--dry-run", true);
  const recoverExisting = explicitBoolean(options["recover-existing"], "--recover-existing", false);
  if (!recoverExisting) for (const file of [outputFile, receiptFile]) await assertPathAvailable(file);
  if (dryRun) {
    console.log(JSON.stringify({ schema: "mkt-videos/local-render-preflight@1", dryRun: true, providerCalls: 0, mode: "studio", engine, scene, ...(threeSpec ? { threeSpec } : {}), outputFile, receiptFile, metadataDirectory, recoverExisting }, null, 2));
    return;
  }
  let documentFile = null, metadata = {};
  if (isThree) {
    const bundle = await buildThreePreset(threeSpec);
    documentFile = path.join(metadataDirectory, `${path.basename(outputFile)}.three.html`);
    const content = bundle.html + `<!-- bundle ${operationFingerprint(bundle.binding)} -->`;
    await mkdir(metadataDirectory, { recursive: true });
    try { await writeFile(documentFile, content, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST" || !recoverExisting || await readFile(documentFile, "utf8") !== content) throw error; }
    metadata = { threeDesign: bundle.binding, threeSpec, addedTextOverlays: false };
  }
  const result = await renderHtmlMotionPilot({ engine: isThree ? "playwright" : engine.id, scene, documentFile, metadata, outputFile, receiptFile, metadataDirectory, recoverExisting, maxWallMs: 600000 });
  console.log(JSON.stringify(result, null, 2));
}
