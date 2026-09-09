import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import {
  VIDEO_RESEARCH_PROFILE_SCHEMA,
  VIDEO_RESEARCH_PROFILES,
  assembleVideoResearchBatch,
  createVideoResearchOutputPlan,
  resolveVideoResearchProfile,
} from "../lib/media-pipeline/video-research-profile.mjs";

test("perfil React audiovisual congela estilo e política de entrega da pesquisa", () => {
  const profile = resolveVideoResearchProfile("react-audiovisual");
  assert.equal(profile.schema, VIDEO_RESEARCH_PROFILE_SCHEMA);
  assert.equal(profile.id, "react-audiovisual@1");
  assert.equal(profile.mode, "studio");
  assert.equal(profile.style, "react-audiovisual@1");
  assert.equal(profile.outputPolicy.preserveOriginals, true);
  assert.equal(profile.outputPolicy.assembleJoinedPreview, true);
  assert.equal(profile.outputPolicy.requireAllJobs, true);
  assert.equal(profile.outputPolicy.fadeOutSeconds, 0);
  profile.outputPolicy.fadeOutSeconds = 9;
  assert.equal(
    VIDEO_RESEARCH_PROFILES["react-audiovisual@1"].outputPolicy.fadeOutSeconds,
    0,
  );
  assert.throws(
    () => resolveVideoResearchProfile("desconhecido"),
    /Perfil de pesquisa desconhecido/,
  );
});

test("output plan aceita raiz da pesquisa ou caminho videos-soltos", () => {
  const coreRoot = path.resolve("C:\\workspace\\CORE");
  const rootPlan = createVideoResearchOutputPlan({
    profile: "react-audiovisual@1",
    coreRoot,
    outDir: path.join(coreRoot, "outputs", "teste-a"),
    generatedName: "ignorado",
  });
  const videosPlan = createVideoResearchOutputPlan({
    profile: "react-audiovisual@1",
    coreRoot,
    outDir: path.join(coreRoot, "outputs", "teste-b", "videos-soltos"),
    generatedName: "ignorado",
  });
  assert.equal(rootPlan.videosDir, path.join(rootPlan.root, "videos-soltos"));
  assert.equal(videosPlan.root, path.join(coreRoot, "outputs", "teste-b"));
  assert.equal(
    videosPlan.finalFile,
    path.join(videosPlan.root, "videos-unidos", "teste-b-unido.mp4"),
  );
});

test("pesquisa monta clipes compatíveis, valida o unido e preserva originais", async (context) => {
  try {
    await runCommand("ffmpeg", ["-version"]);
    await runCommand("ffprobe", ["-version"]);
  } catch {
    context.skip("FFmpeg/ffprobe não estão disponíveis.");
    return;
  }
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mkt-video-research-"),
  );
  try {
    const plan = createVideoResearchOutputPlan({
      profile: "react-audiovisual@1",
      coreRoot: temporaryRoot,
      outDir: path.join(temporaryRoot, "outputs", "react-test"),
      generatedName: "ignorado",
    });
    await mkdir(plan.videosDir, { recursive: true });
    const first = path.join(plan.videosDir, "01-first.mp4");
    const second = path.join(plan.videosDir, "02-second.mp4");
    await Promise.all([
      runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:r=24:d=0.35",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        "0.35",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        first,
      ]),
      runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=purple:s=320x180:r=24:d=0.35",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        "0.35",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        second,
      ]),
    ]);
    const originalFirst = await readFile(first);
    const result = await assembleVideoResearchBatch({
      plan,
      results: [
        { index: 1, id: "first", ok: true, file: first, receipt: `${first}.receipt.json` },
        { index: 2, id: "second", ok: true, file: second, receipt: `${second}.receipt.json` },
      ],
    });
    assert.equal(result.status, "completed");
    assert.equal(result.parts, 2);
    assert.equal(result.method, "ffmpeg-concat-stream-copy");
    assert.equal(result.validation.fullDecodePassed, true);
    await Promise.all([
      access(first),
      access(second),
      access(result.file),
      access(result.receipt),
      access(result.manifest),
    ]);
    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    assert.equal(manifest.profile.id, "react-audiovisual@1");
    assert.equal(manifest.parts.length, 2);
    assert.equal(manifest.validation.compatibleStreams, true);
    const receipt = JSON.parse(await readFile(result.receipt, "utf8"));
    assert.equal(receipt.operation, "assemble-video-research");
    assert.equal(receipt.parameters.fadeOutSeconds, 0);
    assert.equal(receipt.metadata.videoReencoded, false);
    assert.equal(receipt.metadata.validation.fullDecodePassed, true);
    const results = receipt.metadata.parts.map((part) => ({ ...part, ok: true }));
    const originalMaster = await readFile(result.file);
    const originalManifest = await readFile(result.manifest);
    const reused = await assembleVideoResearchBatch({ plan, results: [...results].reverse(), resume: true });
    assert.equal(reused.reused, true);
    assert.deepEqual(await readFile(result.file), originalMaster);

    // Queda entre receipt e manifest: só o manifesto derivado é materializado.
    await rm(result.manifest);
    await assembleVideoResearchBatch({ plan, results, resume: true });
    assert.deepEqual(await readFile(result.manifest), originalManifest);
    await writeFile(result.manifest, JSON.stringify({ ...manifest, finalFile: "outro.mp4" }));
    await assert.rejects(assembleVideoResearchBatch({ plan, results, resume: true }), /Manifesto.*diverge/);

    // Queda entre MP4 e receipt: a mesma montagem deve comprovar os bytes.
    await rm(result.manifest);
    await rm(result.receipt);
    await assembleVideoResearchBatch({ plan, results, resume: true });
    assert.deepEqual(await readFile(result.file), originalMaster);
    assert.deepEqual(await readFile(first), originalFirst);

    await writeFile(result.file, "MP4 divergente");
    await assert.rejects(assembleVideoResearchBatch({ plan, results, resume: true }), /integridade/);
    await rm(result.receipt);
    await rm(result.manifest);
    await assert.rejects(assembleVideoResearchBatch({ plan, results, resume: true }), /diverge/);
    assert.equal(await readFile(result.file, "utf8"), "MP4 divergente");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
