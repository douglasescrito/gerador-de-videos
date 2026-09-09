import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, sha256File, verifyArtifact } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import {
  assertPathAvailable,
  pathExists,
  operationFingerprint,
  commitTemporaryFile,
  createStageReceipt,
  readVerifiedReceipt,
  writeFileAtomic,
  writeJsonAtomic,
  writeStageReceipt,
} from "./pipeline-operation.mjs";

export const VIDEO_RESEARCH_PROFILE_SCHEMA =
  "mkt-videos/video-research-profile@1";

export const VIDEO_RESEARCH_PROFILES = Object.freeze({
  "react-audiovisual@1": Object.freeze({
    schema: VIDEO_RESEARCH_PROFILE_SCHEMA,
    id: "react-audiovisual@1",
    label: "Pesquisa audiovisual orientada por React",
    mode: "studio",
    style: "react-audiovisual@1",
    purpose:
      "Testar como o gerador interpreta JSX, CSS, timelines, narração e efeitos sonoros vinculados a eventos visuais.",
    outputPolicy: Object.freeze({
      preserveOriginals: true,
      assembleJoinedPreview: true,
      order: "jobs-file",
      join: "clean-cut-stream-copy",
      fadeOutSeconds: 0,
      requireAllJobs: true,
      validatePartsAndFinal: true,
    }),
  }),
});

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

export function resolveVideoResearchProfile(value) {
  if (value === undefined || value === null || value === false) return null;
  const requested = requiredText(value, "--research-profile");
  const profile =
    VIDEO_RESEARCH_PROFILES[requested]
    ?? VIDEO_RESEARCH_PROFILES[`${requested}@1`]
    ?? null;
  if (!profile) {
    throw new Error(
      `Perfil de pesquisa desconhecido: ${requested}. Disponível: ${Object.keys(VIDEO_RESEARCH_PROFILES).join(", ")}.`,
    );
  }
  return structuredClone(profile);
}

export function createVideoResearchOutputPlan({
  profile,
  coreRoot,
  outDir = null,
  generatedName,
} = {}) {
  if (!profile) return null;
  const resolvedProfile = resolveVideoResearchProfile(profile.id ?? profile);
  const workspace = path.resolve(requiredText(coreRoot, "coreRoot"));
  const requested = path.resolve(
    outDir
      ? String(outDir)
      : path.join(workspace, "outputs", requiredText(generatedName, "generatedName")),
  );
  const requestedIsVideosDir =
    path.basename(requested).toLowerCase() === "videos-soltos";
  const root = requestedIsVideosDir ? path.dirname(requested) : requested;
  const name = path.basename(root);
  return {
    schema: "mkt-videos/video-research-output-plan@1",
    profile: resolvedProfile,
    name,
    root,
    videosDir: path.join(root, "videos-soltos"),
    receiptsDir: path.join(root, "receitas"),
    finalDir: path.join(root, "videos-unidos"),
    metadataDir: path.join(root, "metadados"),
    concatList: path.join(root, "metadados", "concat.txt"),
    finalFile: path.join(root, "videos-unidos", `${name}-unido.mp4`),
    assemblyReceipt: path.join(
      root,
      "receitas",
      `${name}-unido.assembly.receipt.json`,
    ),
    manifestFile: path.join(root, "manifest.json"),
  };
}

export async function assertVideoResearchOutputPlanAvailable(plan) {
  if (!plan) return;
  await Promise.all([
    assertPathAvailable(plan.concatList, "Lista de concatenação da pesquisa"),
    assertPathAvailable(plan.finalFile, "Vídeo unido da pesquisa"),
    assertPathAvailable(plan.assemblyReceipt, "Recibo de montagem da pesquisa"),
    assertPathAvailable(plan.manifestFile, "Manifesto da pesquisa"),
  ]);
}

function ffmpegConcatPath(file) {
  return path.resolve(file).replace(/\\/gu, "/").replace(/'/gu, "'\\''");
}

function streamSignature(probe) {
  return JSON.stringify({
    video: probe.video
      ? {
          codec: probe.video.codec_name ?? null,
          width: probe.video.width ?? null,
          height: probe.video.height ?? null,
          frameRate: probe.video.r_frame_rate ?? null,
          pixelFormat: probe.video.pix_fmt ?? null,
        }
      : null,
    audio: probe.audio
      ? {
          codec: probe.audio.codec_name ?? null,
          sampleRate: probe.audio.sample_rate ?? null,
          channels: probe.audio.channels ?? null,
        }
      : null,
  });
}

async function validateResearchParts(results) {
  const ordered = [...results].sort((a, b) => a.index - b.index);
  if (!ordered.length || ordered.some((result) => !result.ok || !result.file)) {
    throw new Error(
      "Montagem de pesquisa exige todos os jobs concluídos com MP4 publicado.",
    );
  }
  const probes = [];
  for (const result of ordered) {
    const probe = await probeMedia(result.file);
    if (!probe.video || !Number.isFinite(probe.duration) || probe.duration <= 0) {
      throw new Error(`MP4 inválido para montagem de pesquisa: ${result.file}.`);
    }
    probes.push({ result, probe });
  }
  const signatures = new Set(probes.map(({ probe }) => streamSignature(probe)));
  if (signatures.size !== 1) {
    throw new Error(
      "Os clipes da pesquisa não são compatíveis com concatenação stream-copy.",
    );
  }
  return probes;
}

async function publishResearchManifest(plan, assembly, resume) {
  const manifest = {
    schema: "mkt-videos/video-research-manifest@1",
    status: "completed", profile: plan.profile, name: plan.name, root: plan.root,
    videosDir: plan.videosDir, receiptsDir: plan.receiptsDir,
    finalDir: plan.finalDir, metadataDir: plan.metadataDir,
    parts: assembly.parts, finalFile: plan.finalFile,
    assemblyReceipt: plan.assemblyReceipt, validation: assembly.validation,
    updatedAt: assembly.completedAt,
  };
  if (resume && await pathExists(plan.manifestFile)) {
    const previous = JSON.parse(await readFile(plan.manifestFile, "utf8"));
    if (operationFingerprint(previous) !== operationFingerprint(manifest)) throw new Error("Manifesto de pesquisa existente diverge do recibo verificado.");
  } else await writeJsonAtomic(plan.manifestFile, manifest, { label: "Manifesto da pesquisa" });
}

export async function assembleVideoResearchBatch({
  plan,
  results,
  mode = "studio",
  resume = false,
} = {}) {
  if (!plan) throw new Error("Montagem de pesquisa exige output plan.");
  if (resume) {
    let previous;
    try { previous = await readVerifiedReceipt(plan.assemblyReceipt); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous) {
      const expected = [...results].sort((a, b) => a.index - b.index).map(({ index, id, file, receipt }) => ({ index, id, file, receipt }));
      const actual = previous.metadata?.parts?.map(({ index, id, file, receipt }) => ({ index, id, file, receipt }));
      if (previous.operation !== "assemble-video-research" || previous.parameters?.profile !== plan.profile.id || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Montagem existente diverge das partes e do perfil deste batch.");
      if (results.some((result) => !result.ok) || previous.metadata.finalFile !== plan.finalFile || previous.artifacts?.length !== 1 || previous.artifacts[0].file !== plan.finalFile || previous.inputs?.length !== expected.length || previous.inputs.some((input, index) => input.file !== expected[index].file)) throw new Error("Montagem existente não comprova todos os destinos deste batch.");
      for (const artifact of [...previous.inputs, ...previous.artifacts]) {
        const checked = await verifyArtifact(artifact);
        if (!checked.valid) throw new Error(`Montagem existente sem integridade: ${checked.errors.join(" ")}`);
      }
      await publishResearchManifest(plan, previous.metadata, true);
      return { status: "completed", profile: plan.profile.id, file: plan.finalFile, receipt: plan.assemblyReceipt, manifest: plan.manifestFile, parts: results.length, durationSeconds: previous.metadata.outputDurationSeconds, method: previous.metadata.method, validation: previous.metadata.validation, reused: true };
    }
  }
  if (!resume) await assertVideoResearchOutputPlanAvailable(plan);
  else await assertPathAvailable(plan.manifestFile, "Manifesto sem recibo de montagem");
  const startedAt = new Date();
  const parts = await validateResearchParts(results);
  await Promise.all(
    [plan.videosDir, plan.receiptsDir, plan.finalDir, plan.metadataDir].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );

  const concatText =
    `${parts.map(({ result }) => `file '${ffmpegConcatPath(result.file)}'`).join("\n")}\n`;
  if (resume && await pathExists(plan.concatList)) {
    if (await readFile(plan.concatList, "utf8") !== concatText) throw new Error("Lista de concatenação existente diverge das partes deste batch.");
  } else await writeFileAtomic(plan.concatList, concatText, {
    label: "Lista de concatenação da pesquisa",
    encoding: "utf8",
  });

  const temporary = path.join(
    plan.finalDir,
    `.${path.basename(plan.finalFile)}.${process.pid}.${Date.now()}.tmp.mp4`,
  );
  try {
    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      plan.concatList,
      "-map",
      "0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      temporary,
    ]);
    if (resume && await pathExists(plan.finalFile)) {
      // Uma queda entre a publicação do MP4 e o receipt só permite reutilizar
      // bytes idênticos à montagem determinística refeita com as mesmas partes.
      const [expected, actual] = await Promise.all([sha256File(temporary), sha256File(plan.finalFile)]);
      if (expected !== actual) throw new Error("Vídeo unido existente diverge da montagem das partes verificadas.");
      await rm(temporary, { force: true });
    } else await commitTemporaryFile(temporary, plan.finalFile, {
      label: "Vídeo unido da pesquisa",
    });
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`Montagem local da pesquisa falhou: ${error.message}`);
  }

  const finalProbe = await probeMedia(plan.finalFile);
  await runFfmpeg([
    "-i",
    plan.finalFile,
    "-f",
    "null",
    process.platform === "win32" ? "NUL" : "/dev/null",
  ]);
  const completedAt = new Date();
  const inputArtifacts = await Promise.all(
    parts.map(({ result }) =>
      createArtifactFromFile({
        file: result.file,
        kind: "video",
        role: "research-part",
      })),
  );
  const outputArtifact = await createArtifactFromFile({
    file: plan.finalFile,
    kind: "video",
    role: "research-joined-preview",
    source: { provider: "ffmpeg-concat-stream-copy" },
  });
  const parentReceipts = [];
  for (const { result } of parts) {
    try {
      const receipt = await readVerifiedReceipt(result.receipt);
      if (receipt.id) parentReceipts.push(receipt.id);
    } catch {}
  }
  const sourceDurationSeconds = parts.reduce(
    (total, { probe }) => total + probe.duration,
    0,
  );
  const assembly = {
    schema: "mkt-videos/video-research-assembly@1",
    profile: plan.profile.id,
    collection: plan.name,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    method: "ffmpeg-concat-stream-copy",
    joinStyle: "clean-cut",
    fadeOutSeconds: 0,
    videoReencoded: false,
    audioReencoded: false,
    sourceDurationSeconds,
    outputDurationSeconds: finalProbe.duration,
    parts: parts.map(({ result, probe }) => ({
      index: result.index,
      id: result.id,
      file: result.file,
      receipt: result.receipt,
      durationSeconds: probe.duration,
    })),
    finalFile: plan.finalFile,
    concatList: plan.concatList,
    validation: {
      compatibleStreams: true,
      ffprobePassed: true,
      fullDecodePassed: true,
    },
  };
  const receipt = createStageReceipt({
    operation: "assemble-video-research",
    provider: "ffmpeg",
    mode,
    stage: "research-assembly",
    parameters: {
      profile: plan.profile.id,
      method: assembly.method,
      parts: parts.length,
      fadeOutSeconds: 0,
    },
    inputs: inputArtifacts,
    artifacts: [outputArtifact],
    metadata: assembly,
    parentReceipts,
    startedAt,
    completedAt,
  });
  await writeStageReceipt(plan.assemblyReceipt, receipt);
  await publishResearchManifest(plan, assembly, resume);
  return {
    status: "completed",
    profile: plan.profile.id,
    file: plan.finalFile,
    receipt: plan.assemblyReceipt,
    manifest: plan.manifestFile,
    parts: parts.length,
    durationSeconds: finalProbe.duration,
    method: assembly.method,
    validation: assembly.validation,
  };
}
