#!/usr/bin/env node

import path from "node:path";
import { renderWordCaptions } from "../lib/media-pipeline/captions.mjs";

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Use --video, --words, --script-file e --out.");
    result[token.slice(2)] = argv[++index];
  }
  return result;
}

const input = options(process.argv.slice(2));
if (!input.video || !input.words || !input.out) throw new Error("Use --video, --words e --out.");
const result = await renderWordCaptions({
  videoFile: path.resolve(input.video),
  wordsFile: path.resolve(input.words),
  scriptFile: input["script-file"] ? path.resolve(input["script-file"]) : null,
  outputFile: path.resolve(input.out),
  assFile: input.ass ? path.resolve(input.ass) : undefined,
});
console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, wordCount: result.wordCount, ass: result.assFile }, null, 2));
