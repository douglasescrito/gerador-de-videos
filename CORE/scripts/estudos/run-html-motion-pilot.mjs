#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createHtmlMotionScene, renderHtmlMotionPilot } from "../../lib/media-pipeline/html-motion-pilot.mjs";

const coreRoot = path.resolve(import.meta.dirname, "..", "..");
const collectionArg = process.argv.find((arg) => arg.startsWith("--collection="));
const collection = path.resolve(collectionArg ? collectionArg.slice("--collection=".length) : path.join(coreRoot, "outputs", "html-motion-pilot-local"));
const videos = path.join(collection, "videos-soltos");
const receipts = path.join(collection, "receitas");
const metadata = path.join(collection, "metadados");
await Promise.all([mkdir(videos, { recursive: true }), mkdir(receipts, { recursive: true }), mkdir(metadata, { recursive: true })]);
const result = await renderHtmlMotionPilot({
  scene: createHtmlMotionScene({
    id: "pilot-b-safe-area-cta",
    title: "SISTEMA VISUAL",
    subtitle: "HTML local · frames exatos · sem rede",
    cta: "COMEÇAR",
  }),
  outputFile: path.join(videos, "pilot-b-safe-area-cta.mp4"),
  receiptFile: path.join(receipts, "pilot-b-safe-area-cta.receipt.json"),
  metadataDirectory: metadata,
});
process.stdout.write(`${JSON.stringify({ ok: true, collection, file: result.file, receipt: result.receiptFile, duration: result.probe.duration, frameCount: result.receipt.metadata.frameCount, providerCalls: result.receipt.metadata.providerCalls })}\n`);
