import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, operationFingerprint, readVerifiedReceipt, writeFileAtomic, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";

export const ANIMATIC_APPROVAL_SCHEMA = "mkt-videos/animatic-approval@1";

function assTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 100));
  return `${Math.floor(total / 360000)}:${String(Math.floor((total % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((total % 6000) / 100)).padStart(2, "0")}.${String(total % 100).padStart(2, "0")}`;
}

function safeAss(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

export function animaticAssDocument(scenes, { width, height } = {}) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Card,Arial,${Math.round(height * 0.055)},&H00FFFFFF,&H00FFFFFF,&H00110A2E,&H88000000,1,0,0,0,100,100,0,0,1,4,2,2,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${Math.round(height * 0.1)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = scenes.filter((scene) => scene.onScreenText).map((scene) => `Dialogue: 0,${assTime(scene.start)},${assTime(scene.end)},Card,,0,0,0,,{\\fad(100,100)}${safeAss(scene.onScreenText)}`);
  return `${header}${events.join("\n")}\n`;
}

export async function validateKeyframeTechnical({ file, aspect = "16:9", minWidth = 512 } = {}) {
  const source = path.resolve(String(file));
  const probe = await probeMedia(source);
  const stream = probe.video;
  const expected = aspect === "9:16" ? 9 / 16 : aspect === "16:9" ? 16 / 9 : null;
  if (!expected) throw new Error(`Aspecto de keyframe inválido: ${aspect}.`);
  const findings = [];
  if (!stream) findings.push({ code: "keyframe_image_missing", severity: "block" });
  else {
    if (Number(stream.width) < Number(minWidth)) findings.push({ code: "keyframe_resolution_low", severity: "block", width: stream.width, minimum: Number(minWidth) });
    const ratio = Number(stream.width) / Number(stream.height);
    if (!Number.isFinite(ratio) || Math.abs(ratio - expected) > 0.02) findings.push({ code: "keyframe_aspect_mismatch", severity: "block", expected, actual: ratio });
  }
  return { file: source, status: findings.length ? "blocked" : "pass", aspect, probe, findings };
}

export async function createAnimatic({ scenes, outputFile, receiptFile = `${outputFile}.receipt.json`, assFile = `${outputFile}.cards.ass`, aspect = "16:9", fps = 24, audioFile = null, timelineFingerprint = null, parentReceipts = [] } = {}) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("Animatic exige cenas.");
  const [width, height] = aspect === "9:16" ? [720, 1280] : aspect === "16:9" ? [1280, 720] : (() => { throw new Error(`Aspecto inválido: ${aspect}.`); })();
  let cursor = 0;
  const normalized = [];
  for (const [index, scene] of scenes.entries()) {
    const duration = Number(scene.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Cena ${scene.id ?? index + 1} exige duração positiva medida/planejada.`);
    const keyframeFile = path.resolve(String(scene.keyframeFile));
    await access(keyframeFile);
    const technical = await validateKeyframeTechnical({ file: keyframeFile, aspect });
    if (technical.status !== "pass") throw new Error(`Keyframe ${scene.id ?? index + 1} falhou no QA técnico: ${technical.findings.map((entry) => entry.code).join(", ")}.`);
    normalized.push({ id: String(scene.id ?? `scene-${index + 1}`), keyframeFile, duration, start: cursor, end: cursor + duration, onScreenText: scene.onScreenText ?? null, technical });
    cursor += duration;
  }
  const totalDuration = cursor;
  const target = path.resolve(String(outputFile));
  const assTarget = path.resolve(String(assFile));
  await writeFileAtomic(assTarget, animaticAssDocument(normalized, { width, height }), { label: "Cards do animatic", encoding: "utf8" });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const args = [];
  for (const scene of normalized) args.push("-loop", "1", "-t", scene.duration.toFixed(6), "-i", scene.keyframeFile);
  if (audioFile) { await access(path.resolve(audioFile)); args.push("-i", path.resolve(audioFile)); }
  const filters = normalized.map((scene, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},trim=duration=${scene.duration.toFixed(6)},setpts=PTS-STARTPTS[v${index}]`);
  filters.push(`${normalized.map((_scene, index) => `[v${index}]`).join("")}concat=n=${normalized.length}:v=1:a=0[base]`);
  const escapedAss = assTarget.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  filters.push(`[base]subtitles='${escapedAss}'[video]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[video]");
  if (audioFile) args.push("-map", `${normalized.length}:a:0`, "-af", `apad,atrim=0:${totalDuration.toFixed(6)}`, "-c:a", "aac", "-b:a", "192k");
  args.push("-t", totalDuration.toFixed(6), "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", temporary);
  const startedAt = new Date();
  try {
    await runFfmpeg(["-y", ...args]);
    await commitTemporaryFile(temporary, target, { label: "Animatic" });
  } catch (error) {
    await Promise.all([rm(temporary, { force: true }), rm(assTarget, { force: true })]);
    throw error;
  }
  const inputArtifacts = await Promise.all(normalized.map((scene) => createArtifactFromFile({ file: scene.keyframeFile, kind: "image", role: `animatic-keyframe:${scene.id}` })));
  if (audioFile) inputArtifacts.push(await createArtifactFromFile({ file: path.resolve(audioFile), kind: "audio", role: "animatic-audio" }));
  const [assArtifact, outputArtifact] = await Promise.all([
    createArtifactFromFile({ file: assTarget, kind: "text", role: "animatic-cards" }),
    createArtifactFromFile({ file: target, kind: "video", role: "animatic", source: { provider: "ffmpeg" } }),
  ]);
  const receipt = createStageReceipt({
    operation: "create-animatic", provider: "ffmpeg", mode: "studio", stage: "animatic",
    parameters: { aspect, fps, totalDuration, timelineFingerprint, scenes: normalized.map(({ id, duration, start, end, onScreenText }) => ({ id, duration, start, end, onScreenText })) },
    inputs: inputArtifacts, artifacts: [assArtifact, outputArtifact], parentReceipts, startedAt, completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, assFile: assTarget, receiptFile: path.resolve(receiptFile), receipt, duration: totalDuration, scenes: normalized };
}

export async function approveAnimatic({ animaticFile, receiptFile = `${animaticFile}.receipt.json`, approvalFile = `${animaticFile}.approval.json`, author, justification = "Animatic aprovado para produção." } = {}) {
  const receipt = await readVerifiedReceipt(receiptFile);
  for (const artifact of receipt.artifacts ?? []) {
    const validation = await verifyArtifact(artifact);
    if (!validation.valid) throw new Error(`Animatic diverge do recibo: ${validation.errors.join(" ")}`);
  }
  const fingerprint = operationFingerprint({ receiptId: receipt.id, receiptHash: receipt.hash?.value, artifacts: receipt.artifacts?.map((artifact) => artifact.hash?.value) });
  const approval = { schema: ANIMATIC_APPROVAL_SCHEMA, author: String(author ?? "").trim(), justification: String(justification).trim(), approvedAt: new Date().toISOString(), animaticFile: path.resolve(animaticFile), receiptFile: path.resolve(receiptFile), fingerprint };
  if (!approval.author) throw new Error("Aprovação do animatic exige author.");
  await writeJsonAtomic(approvalFile, approval, { label: "Aprovação do animatic" });
  return { file: path.resolve(approvalFile), approval };
}

export async function verifyAnimaticApproval({ approvalFile, receiptFile = null } = {}) {
  const approval = JSON.parse(await readFile(path.resolve(approvalFile), "utf8"));
  if (approval.schema !== ANIMATIC_APPROVAL_SCHEMA) throw new Error("Aprovação de animatic incompatível.");
  const receipt = await readVerifiedReceipt(receiptFile ?? approval.receiptFile);
  const fingerprint = operationFingerprint({ receiptId: receipt.id, receiptHash: receipt.hash?.value, artifacts: receipt.artifacts?.map((artifact) => artifact.hash?.value) });
  return { valid: fingerprint === approval.fingerprint, expected: approval.fingerprint, actual: fingerprint, approval, receipt };
}
