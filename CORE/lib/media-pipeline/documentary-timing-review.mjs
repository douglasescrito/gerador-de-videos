import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const key = (file) => file.replaceAll("\\", "/").toLowerCase();
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== "" && !path.isAbsolute(relative) && relative.split(path.sep).every((part) => part !== "..");
};
const range = (start, end, duration, label) => {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.001) {
    throw new Error(`${label}: intervalo inválido ou fora da duração física.`);
  }
};
const basename = (file) => typeof file === "string" && file.length > 0 &&
  path.basename(file) === file && path.win32.basename(file) === file && !file.includes(":") && file !== "." && file !== "..";

/** Explicit, source-bound measurements only. No inference, alignment rewrite or generation. */
export async function readDocumentaryTimingReview({ collectionRoot, reviewFile, measurements, words, offBlocks, sonoraDirectory, durationOf }) {
  if (reviewFile === undefined) return { measurements, words, offCuts: new Map(), binding: null };
  const root = await realpath(collectionRoot);
  const confined = async (relative) => {
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
      throw new Error("timingReview exige caminhos relativos confinados à coleção.");
    }
    const file = path.resolve(root, relative);
    if (!inside(root, file) || !inside(root, await realpath(file))) throw new Error("timingReview: caminho fora da coleção.");
    return file;
  };
  const reviewPath = await confined(reviewFile);
  const reviewBytes = await readFile(reviewPath);
  const review = JSON.parse(reviewBytes.toString("utf8"));
  if (review.schema !== "documentary-timing-review@1" || !Array.isArray(review.sources) || review.sources.length === 0) {
    throw new Error("timingReview exige schema documentary-timing-review@1 e sources verificáveis.");
  }
  const sources = new Map();
  for (const source of review.sources) {
    const file = await confined(source.file);
    const sourceKey = key(path.relative(root, file));
    if (sources.has(sourceKey) || !/^[a-f\d]{64}$/u.test(source.sha256 ?? "") || !Number.isSafeInteger(source.bytes) || source.bytes < 0) {
      throw new Error("timingReview: fonte duplicada ou hash/bytes inválidos.");
    }
    const bytes = await readFile(file);
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) throw new Error(`timingReview: fonte alterada: ${source.file}`);
    sources.set(sourceKey, { file, bytes });
  }
  const required = (relative) => {
    const source = sources.get(key(relative));
    if (!source) throw new Error(`timingReview: fonte obrigatória ausente: ${relative}`);
    return source;
  };
  const rawMeasurements = JSON.parse(required("metadados/medidas-sonoras.json").bytes.toString("utf8"));
  const rawWords = offBlocks ? JSON.parse(required("diagnosticos/align-off/palavras-master.json").bytes.toString("utf8")) : [];
  if (!Array.isArray(rawMeasurements) || !Array.isArray(rawWords)) throw new Error("timingReview: medições originais inválidas.");
  const reviewedMeasurements = rawMeasurements.map((measurement) => ({ ...measurement }));
  const reviewedWords = rawWords.map((word) => ({ ...word }));
  const offDuration = offBlocks ? await durationOf(required("audios/off.wav").file) : 0;
  const sonoraRelative = path.relative(root, path.resolve(sonoraDirectory));
  if (!inside(root, path.resolve(sonoraDirectory))) throw new Error("timingReview: diretório de sonoras fora da coleção.");
  for (const measurement of rawMeasurements) {
    if (!basename(measurement.arquivo)) throw new Error("timingReview: arquivo de sonora deve ser basename.");
    required(path.join(sonoraRelative, measurement.arquivo));
  }
  for (const field of ["offWords", "offCuts", "sonoras"]) {
    if (review[field] !== undefined && !Array.isArray(review[field])) throw new Error(`timingReview: ${field} deve ser uma lista.`);
  }
  const indices = new Set();
  for (const correction of review.offWords ?? []) {
    if (!Number.isSafeInteger(correction.index) || correction.index < 0 || correction.index >= rawWords.length ||
        indices.has(correction.index) || correction.word !== rawWords[correction.index].word) {
      throw new Error("timingReview: índice ou palavra original divergente.");
    }
    range(correction.start, correction.end, offDuration, "timingReview offWords");
    indices.add(correction.index);
    reviewedWords[correction.index] = { ...reviewedWords[correction.index], start: correction.start, end: correction.end };
  }
  let previousEnd = 0;
  for (const word of reviewedWords) {
    range(word.start, word.end, offDuration, "timingReview offWords");
    if (word.start + 0.001 < previousEnd) throw new Error("timingReview: palavras revistas fora de ordem ou sobrepostas.");
    previousEnd = word.end;
  }
  const spans = new Map();
  let index = 0;
  for (const block of offBlocks ?? []) {
    const count = block.texto.trim().split(/\s+/u).length;
    const first = reviewedWords[index];
    const last = reviewedWords[index + count - 1];
    if (!first || !last || spans.has(block.cena)) throw new Error("timingReview: bloco off não corresponde ao alinhamento original.");
    spans.set(block.cena, { start: first.start, end: last.end });
    index += count;
  }
  if (index !== reviewedWords.length) throw new Error("timingReview: contagem do off divergente do roteiro.");
  const offCuts = new Map();
  for (const cut of review.offCuts ?? []) {
    const span = spans.get(cut.cena);
    range(cut.start, cut.end, offDuration, "timingReview offCuts");
    if (!span || offCuts.has(cut.cena) || cut.start > span.start + 0.001 || cut.end + 0.001 < span.end) {
      throw new Error("timingReview: recorte off desconhecido, duplicado ou corta palavra medida.");
    }
    offCuts.set(cut.cena, [cut.start, cut.end]);
  }
  const scenes = new Set();
  for (const cut of review.sonoras ?? []) {
    const measurement = reviewedMeasurements.find((item) => item.cena === cut.cena);
    if (!measurement || scenes.has(cut.cena)) throw new Error("timingReview: sonora desconhecida ou duplicada.");
    const file = cut.arquivo ?? measurement.arquivo;
    if (!basename(file)) throw new Error("timingReview: arquivo de sonora deve ser basename.");
    const duration = await durationOf(required(path.join(sonoraRelative, file)).file);
    range(cut.corte, cut.fimRecorte, duration, "timingReview sonoras");
    scenes.add(cut.cena);
    Object.assign(measurement, { arquivo: file, reviewedCut: { corte: cut.corte, fimRecorte: cut.fimRecorte } });
  }
  return {
    measurements: reviewedMeasurements, words: reviewedWords, offCuts,
    binding: { schema: review.schema, file: path.relative(root, reviewPath).replaceAll("\\", "/"), sha256: sha256(reviewBytes), bytes: reviewBytes.length },
  };
}
