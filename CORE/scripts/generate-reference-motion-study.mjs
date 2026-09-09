import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildReferenceTemporalStudy,
  renderReferenceMotionGrammarMarkdown,
} from "../lib/media-pipeline/reference-motion-grammar.mjs";
import { readReferenceIndex } from "../lib/media-pipeline/reference-governance.mjs";
import { pathExists, replaceFileAtomic, writeJsonAtomic, writeFileAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!new Set(["--index", "--metadata", "--frames", "--out", "--docs"]).has(key)) throw new Error(`Opção desconhecida: ${key}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${key} exige caminho.`);
    options[key.slice(2)] = path.resolve(value);
  }
  for (const key of ["index", "metadata", "frames", "out", "docs"]) if (!options[key]) throw new Error(`--${key} é obrigatório.`);
  return options;
}

const options = parse(process.argv.slice(2));
const [referenceIndex, motionMetadata] = await Promise.all([
  readReferenceIndex(options.index),
  readFile(options.metadata, "utf8").then(JSON.parse),
]);
const study = await buildReferenceTemporalStudy({
  referenceIndex,
  motionMetadata,
  framesRoot: options.frames,
});
if (await pathExists(options.out)) throw new Error(`Estudo temporal já existe: ${options.out}`);
await writeJsonAtomic(options.out, study, { label: "Estudo temporal de referências" });
const markdown = renderReferenceMotionGrammarMarkdown(study);
if (await pathExists(options.docs)) await replaceFileAtomic(options.docs, Buffer.from(markdown), { label: "Gramática temporal" });
else await writeFileAtomic(options.docs, Buffer.from(markdown), { label: "Gramática temporal" });
process.stdout.write(`${JSON.stringify({
  study: options.out,
  docs: options.docs,
  videoCount: study.videoCount,
  sampledFrameCount: study.sampledFrameCount,
  familyCount: study.taxonomy.familyCount,
  fingerprint: study.fingerprint,
})}\n`);
