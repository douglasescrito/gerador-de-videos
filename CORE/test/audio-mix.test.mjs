import assert from "node:assert/strict";
import test from "node:test";
import { audioMixRecipe, buildAudioMixFilter, mixAudio, resolveLoudnessProfile, validateMuxDuration } from "../lib/media-pipeline/audio-mix.mjs";
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { recipeFromReceipt } from "../lib/media-pipeline/recipe.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";

test("ducking é determinístico e mantém música depois que a voz termina", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mix-packets-"));
  const exec = promisify(execFile);
  const ff = (args) => exec("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
  try {
    const voice = path.join(root, "voice.wav"), music = path.join(root, "music.wav");
    await ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-af", "apad=whole_dur=4", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", voice]);
    await ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", music]);
    const hashes = [];
    for (let i = 0; i < 5; i++) {
      const outputFile = path.join(root, `master-${i}.wav`);
      const options = { voiceFile: voice, musicFile: music, outputFile, musicGain: "-7dB", duckingThreshold: 0.06, fadeOut: 0 };
      const mixed = await mixAudio(options);
      if (i === 0) {
        const recipe = await audioMixRecipe(options);
        assert.deepEqual(recipe, recipeFromReceipt(mixed.receipt));
        const swapped = await audioMixRecipe({ ...options, voiceFile: music, musicFile: voice });
        assert.deepEqual(swapped.inputHashes, recipe.inputHashes);
        assert.notEqual(swapped.hash, recipe.hash, "papéis distintos não colidem mesmo com o mesmo conjunto de hashes");
        const changed = path.join(root, "changed.wav");
        await copyFile(voice, changed);
        const blocked = path.join(root, "blocked.wav");
        await assert.rejects(mixAudio({ voiceFile: changed, outputFile: blocked, beforeMix: () => writeFile(changed, "changed before render") }), /Entrada da mixagem mudou/);
        await assert.rejects(access(blocked), { code: "ENOENT" });
        await assert.rejects(access(`${blocked}.receipt.json`), { code: "ENOENT" });
      }
      hashes.push(await sha256File(outputFile));
      const stats = (await exec("ffmpeg", ["-hide_banner", "-i", outputFile, "-af", "atrim=start=3.5,volumedetect", "-f", "null", "-"])).stderr;
      assert.ok(Number(stats.match(/mean_volume: (-?[\d.]+) dB/)?.[1]) > -60, stats);
    }
    assert.equal(new Set(hashes).size, 1, "mesmas entradas devem produzir as mesmas amostras nas cinco mixagens");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("mixagem cria ducking, ambience e loudness configurável", () => {
  const result = buildAudioMixFilter({ hasMusic: true, hasAmbience: true, loudness: "speech", duration: 10 });
  assert.match(result.graph, /sidechaincompress/);
  assert.match(result.graph, /apad=whole_dur=10\.000000/);
  assert.match(result.graph, /\[2:a\].*ambience/);
  assert.match(result.graph, /loudnorm=I=-16:TP=-1.5:LRA=9/);
  assert.doesNotMatch(result.graph, /afade=t=out/);
  const explicitFade = buildAudioMixFilter({ hasMusic: true, loudness: "speech", duration: 10, fadeOut: 0.5 });
  assert.match(explicitFade.graph, /afade=t=out:st=9.500/);
});

test("mixagem somente de voz não cria sidechain", () => {
  const result = buildAudioMixFilter({ hasMusic: false, hasAmbience: false, loudness: { integratedLufs: -15, truePeakDb: -1, lra: 8 } });
  assert.doesNotMatch(result.graph, /sidechain/);
  assert.match(result.graph, /loudnorm=I=-15:TP=-1:LRA=8/);
  assert.equal(resolveLoudnessProfile("broadcast").integratedLufs, -23);
});

test("mixagem sem voz usa trilha e ambiência reais sem entrada ou sidechain fictício", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mix-no-voice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const execute = promisify(execFile);
  const music = path.join(root, "music.wav");
  const ambience = path.join(root, "ambience.wav");
  for (const [file, frequency] of [[music, 220], [ambience, 440]]) await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=1`, "-ar", "48000", file]);
  for (const [name, inputs, roles] of [["ambience", { ambienceFile: ambience }, ["ambience"]], ["both", { musicFile: music, ambienceFile: ambience }, ["music", "ambience"]]]) {
    const outputFile = path.join(root, `${name}-master.wav`);
    await mixAudio({ ...inputs, outputFile, musicGain: "-6dB", ambienceGain: "-12dB", loudness: "raw", fadeIn: 0 });
    const receipt = JSON.parse(await readFile(`${outputFile}.receipt.json`, "utf8"));
    assert.deepEqual(receipt.inputs.map((entry) => entry.role), roles);
    assert.doesNotMatch(receipt.parameters.filterGraph, /voice|sidechain/);
    const analysis = (await execute("ffmpeg", ["-hide_banner", "-i", outputFile, "-af", "volumedetect", "-f", "null", "-"])).stderr;
    assert.ok(Number(analysis.match(/mean_volume: (-?[\d.]+) dB/)?.[1]) > -50);
  }
  await assert.rejects(mixAudio({ outputFile: path.join(root, "empty.wav") }), /ao menos uma entrada/);
});

test("mux bloqueia áudio maior que vídeo antes do FFmpeg", () => {
  assert.throws(
    () => validateMuxDuration({ videoDuration: 10, audioDuration: 10.2 }),
    /excede o vídeo.*mux bloqueado/i,
  );
  const accepted = validateMuxDuration({ videoDuration: 10, audioDuration: 10.04 });
  assert.equal(accepted.policy, "fail");
  assert.ok(Math.abs(accepted.differenceSeconds - 0.04) < 1e-9);
  assert.throws(() => validateMuxDuration({ videoDuration: 10, audioDuration: 10, policy: "loop" }), /ainda não suportada/);
});

test("ajuste musical explícito preserva afinação, final e original sem retimar a voz", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mix-tempo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const execute = promisify(execFile);
  const music = path.join(root, "music.wav");
  await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-ar", "48000", music]);
  const original = await sha256File(music);
  const options = { musicFile: music, musicDurationSeconds: 2.1, loudness: "raw", fadeIn: 0, fadeOut: 0, outputFile: path.join(root, "master.wav") };
  const result = await mixAudio(options);
  assert.ok(Math.abs(result.probe.duration - 2.1) < .05);
  assert.equal(result.receipt.parameters.musicFit.voiceTimingChanged, false);
  assert.equal(result.receipt.parameters.musicFit.loops, 0);
  assert.deepEqual(await audioMixRecipe(options), recipeFromReceipt(result.receipt));
  assert.equal(await sha256File(music), original);
  const { stdout } = await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", result.file, "-ac", "1", "-f", "f32le", "-"], { encoding: "buffer" });
  let crossings = 0, power = 0, tailSamples = 0;
  for (let i = 24001; i < 72000; i++) if (stdout.readFloatLE((i-1)*4) <= 0 && stdout.readFloatLE(i*4) > 0) crossings++;
  assert.ok(Math.abs(crossings - 220) < 3, `afinação observada ${crossings} Hz`);
  for (let i = Math.floor(1.95*48000); i < stdout.length/4; i++) { power += stdout.readFloatLE(i*4)**2; tailSamples++; }
  assert.ok(Math.sqrt(power/tailSamples) > .001, "conclusão musical continua audível");
  const graph = buildAudioMixFilter({ hasVoice: true, hasMusic: true, musicTempoRatio: .95 }).graph;
  assert.match(graph, /\[1:a\][^;]*atempo=0\.95000000/);
  assert.doesNotMatch(graph.split(";")[0], /atempo/);
  assert.doesNotMatch(buildAudioMixFilter().graph, /atempo/);
  assert.throws(() => buildAudioMixFilter({ musicTempoRatio: .5 }), /Andamento/);
  await assert.rejects(mixAudio({ ...options, musicDurationSeconds: 4, outputFile: path.join(root, "blocked.wav") }), /Andamento/);
  await assert.rejects(access(path.join(root, "blocked.wav")), { code: "ENOENT" });
  await assert.rejects(mixAudio({ ...options, musicDurationSeconds: 2.1, durationSeconds: 1.8 }), /cortaria/);
});
