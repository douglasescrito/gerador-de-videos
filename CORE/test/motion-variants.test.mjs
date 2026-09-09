import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { motionAssDocument, renderMotionGraphics } from "../lib/media-pipeline/motion-graphics.mjs";
import { runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { buildReframeFilter, createVideoVariant } from "../lib/media-pipeline/variants.mjs";

test("motion typography preserva texto exato e margens responsivas", () => {
  const horizontal = motionAssDocument([{ start: 0, end: 1, text: "Marketing em movimento" }], { aspect: "16:9" });
  const vertical = motionAssDocument([{ start: 0, end: 1, text: "Marketing em movimento" }], { aspect: "9:16" });
  const animated = motionAssDocument([{ start: 0, end: 1, text: "AÇÃO", effect: "punch", position: "center", color: "#67E8F9", fontSize: 88 }], { aspect: "16:9" });
  const impact = motionAssDocument([{ start: 0, end: 1, text: "IMPACTO", effect: "impact", position: "center", fontName: "Arial Black", outline: 7, shadow: 4 }], { aspect: "16:9" });
  const chapter = motionAssDocument([{ start: 0, end: 1, text: "01 / IGNIÇÃO", effect: "fade", position: "top-left", fontName: "Bahnschrift SemiBold", blur: 0 }], { aspect: "16:9" });
  const lower = motionAssDocument([{ start: 0, end: 1, text: "DUAS\\NLINHAS", effect: "impact", position: "lower", fontSize: 136 }], { aspect: "16:9" });
  assert.match(horizontal, /Marketing em movimento/);
  assert.match(vertical, /PlayResX: 1080/);
  assert.match(animated, /\\fscx70/);
  assert.match(animated, /\\pos\(960,540\)/);
  assert.match(animated, /\\c&H00F9E867&/);
  assert.match(animated, /\\fs88/);
  assert.match(impact, /\\fscx185/);
  assert.match(impact, /\\blur6/);
  assert.match(impact, /\\fnArial Black/);
  assert.match(impact, /\\bord7/);
  assert.match(impact, /\\shad4/);
  assert.match(chapter, /\\an7\\pos\(134,97\)/);
  assert.match(chapter, /\\fnBahnschrift SemiBold/);
  assert.match(lower, /\\pos\(960,799\)/);
  assert.notEqual(horizontal, vertical);
  assert.match(buildReframeFilter("9:16"), /force_original_aspect_ratio=decrease/);
  const literal = motionAssDocument([{ start: 0, end: 1, text: String.raw`{EXATO} C:\Nova\n\h` + "\r\nFIM" }]);
  assert.ok(literal.includes("\\{EXATO\\}"));
  assert.ok(literal.includes("C:\\\u2060Nova\\\u2060n\\\u2060h\\NFIM"));
  assert.throws(() => motionAssDocument([{ start: 0, end: 1, text: "controle\u0000" }]), /controle não renderizável/);
});

test("frames preservam chaves e barras literais, distinguem quebra real e não executam tags do texto", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "motion-literal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const texts = ["EXATO", "{EXATO}", String.raw`\N`, "N", "N\nN", String.raw`{\alpha&HFF&}`, "EX\u2060ATO"];
  const source = path.join(root, "source.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", `color=c=black:s=640x360:r=24:d=${texts.length}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const cards = texts.map((text, index) => ({ text, start: index, end: index + 1, position: "center", fontName: "Consolas", fontSize: 108, outline: 0, shadow: 0, fadeInMs: 0, fadeOutMs: 0 }));
  const result = await renderMotionGraphics({ videoFile: source, cards, outputFile: path.join(root, "literal.mp4"), preserveAudio: false });
  assert.deepEqual(result.receipt.parameters.cards.map(card => card.text), texts);
  assert.equal(result.receipt.parameters.textEncoding, "libass-literal@1");
  const frameFile = path.join(root, "frames.gray");
  await runFfmpeg(["-i", result.file, "-vf", "select=" + texts.map((_, i) => `eq(n\\,${i * 24 + 12})`).join("+"), "-fps_mode", "vfr", "-pix_fmt", "gray", "-f", "rawvideo", frameFile]);
  const bytes = await readFile(frameFile);
  const size = 640 * 360;
  assert.equal(bytes.length, texts.length * size);
  const masks = texts.map((_, index) => bytes.subarray(index * size, (index + 1) * size));
  const bounds = masks.map(mask => {
    const xs = [], ys = [];
    for (let i = 0; i < size; i++) if (mask[i] > 180) { xs.push(i % 640); ys.push(Math.floor(i / 640)); }
    return { pixels: xs.length, width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
  });
  assert.ok(bounds[1].width > bounds[0].width + 10, "chaves aparecem além da palavra");
  assert.ok(bounds[2].width > bounds[3].width + 5, "barra literal aparece ao lado do N");
  assert.ok(bounds[4].height > bounds[2].height * 1.5, "quebra real ocupa duas linhas; barra-N permanece numa");
  assert.ok(bounds[5].pixels > 500, "alpha do texto é visível e não deixa a camada transparente");
  assert.equal(bounds[6].width, bounds[0].width, "WORD JOINER não acrescenta largura");
  let intersection = 0, union = 0;
  for (let i = 0; i < size; i++) { const a = masks[0][i] > 180, b = masks[6][i] > 180; if (a && b) intersection++; if (a || b) union++; }
  assert.ok(intersection / union > 0.97, "separador não acrescenta glifo nem muda o texto visível");
});

test("motion e variantes são derivados locais, mantêm duração e removem áudio Omni quando pedido", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-motion-"));
  try {
    const source = path.join(root, "source.mp4");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=#312e81:s=640x360:r=24:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    const motion = await renderMotionGraphics({ videoFile: source, cards: [{ start: 0.1, end: 0.9, text: "CTA EXATO" }], outputFile: path.join(root, "motion.mp4"), aspect: "16:9", preserveAudio: false, timelineFingerprint: "timeline:test" });
    assert.equal(Boolean(motion.probe.audio), false);
    await assert.rejects(createVideoVariant({ inputFile: source, outputFile: path.join(root, "square.mp4"), format: "1:1", timelineFingerprint: "timeline:test" }), /aprovação explícita/);
    const vertical = await createVideoVariant({ inputFile: source, outputFile: path.join(root, "vertical.mp4"), format: "9:16", timelineFingerprint: "timeline:test" });
    assert.equal(vertical.after.video.width, 1080);
    assert.equal(vertical.after.video.height, 1920);
    assert.ok(Math.abs(vertical.after.duration - vertical.before.duration) <= 0.05);
  } finally { await rm(root, { recursive: true, force: true }); }
});
