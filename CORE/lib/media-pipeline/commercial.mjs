// Receita de comercial "flat 2D motion graphics" 100% Omni, gravada em código.
//
// Técnicas reutilizáveis de composição comercial:
//  - o Omni só renderiza texto na tela LIMPO em estilo flat 2D, fundo escuro,
//    com UMA frase curta por cena; cena 3D cheia borra e erra as letras;
//  - o texto do Omni leva ~4s para se formar, então a montagem apara cada cena
//    na janela de texto já formado e a encaixa na duração do seu bloco de narração;
//  - a logo do fechamento sai fiel via reference_to_video com a logo oficial.
//
// Este módulo concentra a lógica pura (prompts, split de roteiro, jobs, aparo)
// e helpers de ffmpeg. A orquestração (geração via `batch`, IO) fica no CLI.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { mediaDuration } from "./narrated-video.mjs";
import { assertPathAvailable, commitTemporaryFile } from "./pipeline-operation.mjs";
import { DEFAULT_COMMERCIAL_BRAND_KIT, findBrandTermViolations } from "./studio-policies.mjs";

export const COMMERCIAL_SPEC_SCHEMA = "mkt-videos/commercial-spec@1";

// As restrições vêm da política configurada para esta instalação.
export const BRAND_BANNED_PATTERNS = Object.freeze(DEFAULT_COMMERCIAL_BRAND_KIT.forbiddenTerms.map((entry) => ({ rule: entry.label, regex: new RegExp(entry.pattern, entry.flags) })));

// Retorna os termos vetados encontrados no texto (case/acento-insensível).
export function findBannedTerms(text) {
  return findBrandTermViolations(text, DEFAULT_COMMERCIAL_BRAND_KIT).map((entry) => ({ rule: entry.rule, terms: entry.terms }));
}

// Lança se o texto violar uma regra de marca. `where` contextualiza o erro.
export function assertBrandSafe(text, where = "texto") {
  const hits = findBannedTerms(text);
  if (hits.length) {
    const detail = hits.map((hit) => `${hit.rule} — encontrado: ${hit.terms.join(", ")}`).join("; ");
    throw new Error(`Regra de marca violada em ${where}: ${detail}. Reescreva sem esse termo.`);
  }
}

// Padrões de montagem (a "janela de texto formado" e o respiro final).
export const ASSEMBLY_DEFAULTS = Object.freeze({
  settleOffsetSeconds: 4.6, // início do trecho onde o texto do Omni já está formado
  closerOffsetSeconds: 3.3, // o fechamento com logo forma mais devagar
  holdTailSeconds: 1.0, // segurar a logo após a última palavra
  fps: 30,
  size: "1280:720",
});

// Presets de estilo flat 2D. O corpo de cada preset é a direção visual que,
// comprovadamente, faz o Omni acertar o texto. `reference` marca estilos que
// exigem imagem de referência (a logo oficial no fechamento).
export const SCENE_STYLES = Object.freeze({
  default: {
    reference: false,
    body: "Flat 2D motion graphics in a clean modern vector style, premium and minimal. Deep navy blue background (#0f1f3d). One short line of large, bold, WHITE sans-serif Brazilian Portuguese text, centered, crisp and perfectly legible, dynamic kinetic motion. Subtle flat geometric accents in cobalt and electric blue. No 3D, no photorealism, no clutter, no logo, no watermark.",
  },
  tense: {
    reference: false,
    body: "Flat 2D motion graphics, clean modern vector style, premium and minimal, dramatic and quiet. Deep near-black navy background. One short line of large, bold, ELECTRIC BLUE sans-serif Brazilian Portuguese text, centered, crisp and perfectly legible, with a lot of empty dark space. No 3D, no photorealism, no logo, no watermark.",
  },
  brand: {
    reference: false,
    body: "Flat 2D motion graphics, clean modern vector style, premium, bright and confident. Vibrant cobalt blue background. Very large, bold, WHITE sans-serif Brazilian Portuguese text, centered, crisp and perfectly legible, energetic kinetic pop with a burst of light. No 3D, no photorealism, no watermark.",
  },
  forward: {
    reference: false,
    body: "Flat 2D motion graphics in a clean modern vector style, premium and minimal. Deep navy blue background (#0f1f3d). One short line of large, bold, WHITE sans-serif Brazilian Portuguese text, centered, crisp and perfectly legible, forward-moving kinetic motion with subtle flat cobalt arrows and paths advancing. No 3D, no photorealism, no logo, no watermark.",
  },
  warm: {
    reference: false,
    body: "Flat 2D motion graphics, clean modern vector style, premium, warm and proud. Deep navy background with a warm golden glow. One short line of large, bold, WARM GOLDEN-WHITE sans-serif Brazilian Portuguese text, centered, crisp and perfectly legible, uplifting kinetic motion with soft light particles. No 3D, no photorealism, no logo, no watermark.",
  },
  closer: {
    reference: true,
    body: "Flat 2D motion graphics in a clean modern vector style, premium and minimal, elegant brand closing. Deep navy blue background (#0f1f3d) with a soft radial glow. Use the supplied image as the exact official logo and REPRODUCE IT WITH ABSOLUTE FIDELITY to its original form: do not redraw, redesign, restyle, recolor, re-letter, rotate, stretch or distort it; preserve its exact original shapes, proportions, spacing, lettering and colors; add nothing and remove nothing; the logo must look identical to the supplied artwork. Reveal it cleanly and centered in the upper half with a smooth premium reveal. Below the logo, one short line of bold WHITE sans-serif Brazilian Portuguese text appears, crisp and perfectly legible. Subtle electric-blue accents, no 3D, no photorealism, no clutter, no watermark. Hold the finished logo and line cleanly at the end.",
  },
});

// Prompt de bloco de narração: tela quase preta, a voz é a protagonista.
// Usado para gerar a locução PT-BR pelo Omni (text_to_video) e extrair o áudio.
// `voice` substitui a descrição padrão de voz (locutor grave maduro) quando a
// peça pede outro timbre (ex.: voz jovem vibrante de campanha digital).
const DEFAULT_NARRATION_VOICE = "a deep, mature, warm, full-bodied announcer voice of an experienced television commercial narrator";

export function buildNarrationBlockPrompt(spokenText, { direction = "", seconds = 10, voice = "" } = {}) {
  const line = cleanText(spokenText);
  if (!line) throw new Error("buildNarrationBlockPrompt exige texto falado.");
  assertBrandSafe(line, "narração");
  const dir = cleanText(direction);
  const voiceDescription = cleanText(voice) || DEFAULT_NARRATION_VOICE;
  return [
    `Create one continuous ${Number(seconds).toFixed(2)}-second premium ambient video: a near-black screen with an extremely subtle, very slow drift of deep cobalt-blue light and soft out-of-focus glow, elegant and minimal, almost still. No people, no objects, no text of any kind on screen, no subtitles, no logos, no watermark.`,
    `The audio is the hero: one single voice-over in Brazilian Portuguese from Brazil, neutral Brazilian accent, Brazilian cadence, not European Portuguese; ${voiceDescription}.${dir ? ` ${dir}` : ""}`,
    `The narrator says exactly, word for word, with no additions, no omissions and no repetitions, saying each word a single time: ${JSON.stringify(line)}`,
    "No music, no soundtrack, no sound effects, no other voices; only this voice-over over near silence.",
  ].join("\n");
}

// Monta o prompt de uma cena de texto (ou fechamento) a partir do preset.
export function buildScenePrompt(text, styleName = "default", { visual = null } = {}) {
  const style = SCENE_STYLES[styleName];
  if (!style) throw new Error(`Estilo de cena desconhecido: ${styleName}. Use ${Object.keys(SCENE_STYLES).join(", ")}.`);
  const line = cleanText(text);
  if (!line) throw new Error("buildScenePrompt exige o texto da cena.");
  assertBrandSafe(line, "texto de cena");
  const label = style.reference
    ? `Spell the line below the logo EXACTLY and correctly, letter by letter, showing only: ${JSON.stringify(line)}`
    : `Spell the text EXACTLY and correctly, letter by letter, showing only: ${JSON.stringify(line)}`;
  const body = visual && String(visual).trim() ? cleanText(visual) : style.body;
  return `${body}\n${label}`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isSentenceEnd(word) {
  return /[.!?…]$/.test(word);
}

// Quebra o alinhamento de palavras em cenas curtas (uma frase por cena):
// corta em fim de frase e ao atingir maxWords. Cada cena recebe um span
// contíguo [início, início-da-próxima] para ladrilhar toda a narração.
export function scaffoldCommercial({ words, name = "comercial", aspect = "16:9", maxWords = 7, narrationDuration } = {}) {
  if (!Array.isArray(words) || words.length === 0) throw new Error("scaffoldCommercial exige um alinhamento de palavras.");
  const groups = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (isSentenceEnd(word.word) || current.length >= maxWords) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  const totalEnd = Number.isFinite(Number(narrationDuration))
    ? Number(narrationDuration)
    : words[words.length - 1].end;

  const scenes = groups.map((group, index) => {
    const start = group[0].start;
    const nextStart = index + 1 < groups.length ? groups[index + 1][0].start : totalEnd;
    const last = index === groups.length - 1;
    const text = group.map((w) => w.word).join(" ");
    assertBrandSafe(text, `cena ${index + 1}`);
    return {
      id: `s${String(index + 1).padStart(2, "0")}`,
      text,
      style: last ? "closer" : "default",
      span: [round(start), round(Math.max(nextStart, group.at(-1).end))],
    };
  });

  return {
    schema: COMMERCIAL_SPEC_SCHEMA,
    name,
    aspect,
    assembly: { ...ASSEMBLY_DEFAULTS },
    scenes,
  };
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

// Valida e normaliza um spec de comercial. Lança erro com mensagem clara.
export function validateSpec(spec) {
  if (!spec || typeof spec !== "object") throw new Error("Spec de comercial inválido.");
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) throw new Error("O spec precisa de ao menos uma cena.");
  const aspect = spec.aspect ?? "16:9";
  if (!new Set(["16:9", "9:16"]).has(aspect)) throw new Error(`Aspecto inválido no spec: ${aspect}.`);
  const ids = new Set();
  const scenes = spec.scenes.map((scene, index) => {
    const id = cleanText(scene.id) || `s${String(index + 1).padStart(2, "0")}`;
    if (ids.has(id)) throw new Error(`Cena com id duplicado: ${id}.`);
    ids.add(id);
    if (!SCENE_STYLES[scene.style ?? "default"]) throw new Error(`Cena ${id}: estilo desconhecido "${scene.style}".`);
    if (!cleanText(scene.text)) throw new Error(`Cena ${id}: texto vazio.`);
    assertBrandSafe(scene.text, `cena ${id}`);
    if (!Array.isArray(scene.span) || scene.span.length !== 2) throw new Error(`Cena ${id}: span deve ser [início, fim].`);
    const [start, end] = scene.span.map(Number);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Cena ${id}: span inválido.`);
    return { ...scene, id, style: scene.style ?? "default", span: [start, end] };
  });
  return {
    ...spec,
    schema: spec.schema ?? COMMERCIAL_SPEC_SCHEMA,
    name: cleanText(spec.name) || "comercial",
    aspect,
    assembly: { ...ASSEMBLY_DEFAULTS, ...(spec.assembly ?? {}) },
    scenes,
  };
}

// Converte o spec em jobs para o comando `batch`: cenas de texto viram
// text_to_video; o fechamento vira reference_to_video com a logo.
export function buildCommercialJobs(spec, { logoImage } = {}) {
  const normalized = validateSpec(spec);
  return normalized.scenes.map((scene) => {
    const style = SCENE_STYLES[scene.style];
    const job = {
      id: scene.id,
      prompt: buildScenePrompt(scene.text, scene.style, { visual: scene.visual }),
      aspect: normalized.aspect,
      task: style.reference ? "reference_to_video" : "text_to_video",
    };
    if (style.reference) {
      const logo = scene.logo ?? logoImage;
      if (!logo) throw new Error(`Cena ${scene.id} (${scene.style}) exige uma imagem de logo: use --logo ou defina "logo" na cena.`);
      job.images = [logo];
    }
    return job;
  });
}

// Plano de montagem: para cada cena calcula o trecho da fonte a usar
// (offset na janela de texto formado) e a duração no master (do span da
// narração). Valida contra a duração real de cada clipe.
export function planAssembly(spec, { clipDurations = {} } = {}) {
  const normalized = validateSpec(spec);
  const a = normalized.assembly;
  let cursor = 0;
  const plan = normalized.scenes.map((scene, index) => {
    const isCloser = SCENE_STYLES[scene.style].reference;
    let duration = round(scene.span[1] - scene.span[0]);
    if (isCloser && Number(a.holdTailSeconds) > 0) duration = round(duration + Number(a.holdTailSeconds));
    const offset = Number(
      scene.settleOffset ?? (isCloser ? a.closerOffsetSeconds : a.settleOffsetSeconds),
    );
    const clip = clipDurations[scene.id];
    if (clip !== undefined && offset + duration > clip + 0.05) {
      throw new Error(
        `Cena ${scene.id}: offset ${offset.toFixed(2)}s + duração ${duration.toFixed(2)}s excede o clipe (${clip.toFixed(2)}s). ` +
          "Reduza settleOffset da cena ou encurte o texto/span.",
      );
    }
    const entry = {
      id: scene.id,
      index,
      style: scene.style,
      offset: round(offset),
      duration,
      timelineStart: round(cursor),
      timelineEnd: round(cursor + duration),
    };
    cursor = round(cursor + duration);
    return entry;
  });
  return { totalDuration: round(cursor), scenes: plan };
}

// ---- helpers de ffmpeg (mesmo estilo de narrated-video.mjs) ----

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => (status === 0 ? resolve() : reject(new Error(`ffmpeg falhou (${status}): ${stderr.trim()}`))));
  });
}

async function atomicFfmpegOutput(outputFile, buildArgs, label) {
  const target = await assertPathAvailable(outputFile, label);
  await mkdir(path.dirname(target), { recursive: true });
  const parsed = path.parse(target);
  const temporary = path.join(parsed.dir, `.${parsed.name}.${process.pid}.${randomUUID()}.tmp${parsed.ext}`);
  try {
    await runFfmpeg(buildArgs(temporary));
    await commitTemporaryFile(temporary, target, { label });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return target;
}

export async function trimScene({ sourceFile, offset, duration, outputFile, size = ASSEMBLY_DEFAULTS.size, fps = ASSEMBLY_DEFAULTS.fps }) {
  await access(sourceFile);
  const file = await atomicFfmpegOutput(outputFile, (temporary) => [
    "-ss", Number(offset).toFixed(3), "-i", sourceFile, "-t", Number(duration).toFixed(3),
    "-an", "-vf", `scale=${size},fps=${fps},format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", temporary,
  ], "Cena aparada");
  return { file, duration: await mediaDuration(file) };
}

export async function concatVideos(listFile, outputFile) {
  const file = await atomicFfmpegOutput(outputFile, (temporary) => ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", temporary], "Vídeo concatenado");
  return { file, duration: await mediaDuration(file) };
}

// Junta o vídeo mudo à narração-mestre. Sem -shortest: o vídeo pode ser
// mais longo (respiro da logo) e a última palavra fica sob a logo parada.
export async function muxNarration({ videoFile, audioFile, outputFile }) {
  await Promise.all([access(videoFile), access(audioFile)]);
  const file = await atomicFfmpegOutput(outputFile, (temporary) => [
    "-i", videoFile, "-i", audioFile, "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temporary,
  ], "Comercial narrado");
  return { file, duration: await mediaDuration(file) };
}

export async function extractVerifyFrame({ sourceFile, at, outputFile }) {
  await access(sourceFile);
  return atomicFfmpegOutput(outputFile, (temporary) => ["-ss", Number(at).toFixed(3), "-i", sourceFile, "-frames:v", "1", "-q:v", "3", temporary], "Frame de verificação");
}

export function concatPath(file) {
  return String(file).replace(/\\/g, "/").replace(/'/g, "'\\''");
}
