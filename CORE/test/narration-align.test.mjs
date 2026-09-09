import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { alignTokenSequences, correctWordsAgainstScript, planNarrationMaster, renderNarrationMaster, repartirJanelasDasVagas, scriptTokens } from "../lib/media-pipeline/narration-align.mjs";
import { probeMedia, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { probeWhisperRuntime, resolveWhisperRuntime } from "../lib/media-pipeline/whisper-runtime.mjs";

const timed = (pairs) => pairs.map(([word, start, end], index) => ({ word, start: start ?? index * 0.5, end: end ?? index * 0.5 + 0.4, probability: 0.95 }));

test("runtime Whisper no Windows independe do PATH quando há instalação Python local", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "whisper-runtime-"));
  try {
    const older = path.join(root, "Programs", "Python", "Python310", "Scripts");
    const current = path.join(root, "Programs", "Python", "Python311", "Scripts");
    await Promise.all([mkdir(older, { recursive: true }), mkdir(current, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(older, "whisper.exe"), "fixture"),
      writeFile(path.join(current, "whisper.exe"), "fixture"),
    ]);
    const runtime = await resolveWhisperRuntime({ platform: "win32", env: { LOCALAPPDATA: root } });
    assert.equal(runtime.command, path.join(current, "whisper.exe"));
    assert.equal(runtime.source, "python-user-install");
    const probe = await probeWhisperRuntime({ platform: "win32", env: { LOCALAPPDATA: root } });
    assert.equal(probe.available, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime Whisper respeita override explícito e variável de ambiente", async () => {
  assert.deepEqual(
    await resolveWhisperRuntime({ command: "D:\\runtime\\whisper.exe", platform: "win32", env: {} }),
    { command: "D:\\runtime\\whisper.exe", source: "explicit" },
  );
  assert.deepEqual(
    await resolveWhisperRuntime({ command: "whisper", platform: "linux", env: { WHISPER_COMMAND: "/opt/whisper" } }),
    { command: "/opt/whisper", source: "environment" },
  );
});

test("adota a grafia do roteiro mantendo o tempo medido", () => {
  const result = correctWordsAgainstScript({
    script: "Você não precisa de sorte.",
    words: timed([["Voce"], ["nao"], ["precisa"], ["de"], ["sorte"]]),
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.words.map((word) => word.word), ["Você", "não", "precisa", "de", "sorte."]);
  // acento e pontuação normalizam para o mesmo token: não conta como correção.
  assert.equal(result.spellingCorrections, 0);
  assert.equal(result.words[0].start, 0);
  assert.equal(result.words[4].end, 2.4);
});

test("hipótese lexical divergente nunca substitui o roteiro nem bloqueia timestamps válidos", () => {
  const asr = correctWordsAgainstScript({ script: "Guarde o recibo agora.", words: timed([["Guarde"], ["o"], ["recebo"], ["agora"]]) });
  assert.equal(asr.status, "pass");
  assert.equal(asr.spellingCorrections, 1);
  assert.equal(asr.words[2].word, "recibo");
  assert.equal(asr.words[2].transcribed, "recebo");

  const swapped = correctWordsAgainstScript({ script: "Ela transforma tudo.", words: timed([["Ela"], ["transportou"], ["tudo"]]) });
  assert.equal(swapped.status, "pass");
  assert.deepEqual(swapped.words.map((word) => word.word), ["Ela", "transforma", "tudo."]);
  assert.equal(swapped.words[1].transcribed, "transportou");
  assert.equal(swapped.findings.some((entry) => entry.code === "whisper_lexical_divergence" && entry.severity === "info"), true);
});

test("dicionário fonético da marca aceita Fókus, Focos e Focus sem mudar o roteiro", () => {
  for (const measured of ["Fókus", "Focos", "Focus", "Fócus"]) {
    const result = correctWordsAgainstScript({
      script: "Faculdade Fókus.",
      words: timed([["Faculdade"], [measured]]),
    });
    assert.equal(result.status, "pass", measured);
    assert.deepEqual(result.words.map((word) => word.word), ["Faculdade", "Fókus."], measured);
  }
});

test("palavra sem timestamp bloqueia; token extra do Whisper é descartado sem desalinhar", () => {
  const missing = correctWordsAgainstScript({ script: "um dois três quatro", words: timed([["um"], ["dois"], ["quatro"]]) });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.findings.find((entry) => entry.code === "missing_word").expected, "três");
  assert.deepEqual(missing.words.map((word) => word.word), ["um", "dois", "quatro"]);

  const repeated = correctWordsAgainstScript({ script: "um dois três", words: timed([["um"], ["dois"], ["dois"], ["três"]]) });
  assert.equal(repeated.status, "pass");
  assert.equal(repeated.findings.some((entry) => entry.code === "whisper_extra_token_ignored" && entry.severity === "info"), true);
  // o alinhamento continua pareando "três" com "três", não com o duplicado.
  assert.equal(repeated.words.at(-1).word, "três");
});

test("fragmentos Whisper adjacentes usam a palavra canônica do roteiro e só unem seus tempos", () => {
  const result = correctWordsAgainstScript({
    script: "Você pode atravessá-la. Haverá caminho.",
    words: timed([["Você"], ["pode"], ["atravessá"], ["-la."], ["Há"], ["verá"], ["caminho."]]),
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.words.map((word) => word.word), ["Você", "pode", "atravessá-la.", "Haverá", "caminho."]);
  assert.equal(result.findings.filter((finding) => finding.code === "whisper_tokens_joined").length, 2);
  assert.equal(result.words[2].start, 1);
  assert.equal(result.words[2].end, 1.9);
});

test("confiança baixa avisa sem bloquear e tempo não monotônico bloqueia", () => {
  const low = correctWordsAgainstScript({ script: "teste", words: [{ word: "teste", start: 0, end: 0.5, probability: 0.2 }] });
  assert.equal(low.status, "pass");
  assert.equal(low.findings[0].code, "low_alignment_confidence");
  assert.equal(low.findings[0].severity, "warn");
  assert.throws(() => correctWordsAgainstScript({ script: "a b", words: [{ word: "a", start: 1, end: 0.5 }] }), /inválida/);
});

test("scriptTokens descarta pontuação solta e alinhamento pareia por similaridade", () => {
  assert.deepEqual(scriptTokens("Sim — não?").map((token) => token.text), ["Sim", "não?"]);
  const operations = alignTokenSequences(scriptTokens("a b c"), scriptTokens("a c"));
  assert.equal(operations.length, 3);
  assert.equal(operations.filter((entry) => entry.measuredIndex == null).length, 1);
});

test("master posiciona palavras em tempo absoluto com respiro entre blocos", () => {
  const plan = planNarrationMaster({
    blocks: [
      { id: "n01", duration: 10, words: [{ word: "Um", start: 1, end: 1.4 }, { word: "dois.", start: 1.5, end: 2 }] },
      { id: "n02", duration: 10, words: [{ word: "Três.", start: 3, end: 3.6 }] },
    ],
    leadInSeconds: 0.1,
    tailOutSeconds: 0.2,
    gapSeconds: 0.5,
  });
  // bloco 1 apara em [0.9, 2.2] => 1.3s; a primeira palavra cai em 1 - 0.9 = 0.1
  assert.deepEqual(plan.spans[0].trim, [0.9, 2.2]);
  assert.equal(plan.words[0].start, 0.1);
  // bloco 2 entra após 1.3s + respiro 0.5s
  assert.equal(plan.spans[1].span[0], 1.8);
  assert.equal(plan.words[2].start, 1.9);
  assert.equal(plan.duration, round(1.8 + 0.9));
  assert.deepEqual(plan.spans[0].wordRange, [0, 1]);
});

const round = (value) => Math.round(value * 1000) / 1000;

test("renderNarrationMaster entrega a duração planejada em áudio real", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "narracao-align-"));
  try {
    const blocks = [];
    for (const id of ["n01", "n02"]) {
      const file = path.join(root, `${id}.wav`);
      await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", file]);
      blocks.push({ id, duration: 3, audioFile: file, words: [{ word: "Palavra", start: 0.5, end: 1.5 }] });
    }
    const plan = planNarrationMaster({ blocks, leadInSeconds: 0.1, tailOutSeconds: 0.2, gapSeconds: 0.4 });
    const master = await renderNarrationMaster({ plan, outputFile: path.join(root, "master.wav") });
    const probe = await probeMedia(master.file);
    assert.ok(Math.abs(Number(probe.duration) - plan.duration) <= 0.05, `duração ${probe.duration} vs plano ${plan.duration}`);
    assert.equal(probe.audio.channels, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// O Whisper devolve "38" onde o roteiro diz "trinta e oito". Antes disto as
// duas palavras sem par sumiam do texto publicado e a tela dizia "Você tem
// oito anos" — em quatro filmes já entregues.
test("modo correção não deixa cair palavra do roteiro", () => {
  const script = "Você tem trinta e oito anos";
  const words = timed([["Você", 0, 0.3], ["tem", 0.3, 0.5], ["38", 0.5, 1.1], ["anos", 1.1, 1.4]]);
  const r = correctWordsAgainstScript({ script, words, spellingFloor: 0.3 });
  assert.deepEqual(r.words.map((w) => w.word), ["Você", "tem", "trinta", "e", "oito", "anos"]);
  assert.equal(r.status, "pass");
  assert.ok(r.findings.some((f) => f.code === "missing_word_filled"));
});

test("a palavra preenchida cabe dentro da janela que foi medida", () => {
  const script = "Você tem trinta e oito anos";
  const words = timed([["Você", 0, 0.3], ["tem", 0.3, 0.5], ["38", 0.5, 1.1], ["anos", 1.1, 1.4]]);
  const { words: saida } = correctWordsAgainstScript({ script, words, spellingFloor: 0.3 });
  const trinta = saida.find((w) => w.word === "trinta");
  const oito = saida.find((w) => w.word === "oito");
  assert.equal(trinta.start, 0.5, "a corrida começa onde o token medido começou");
  assert.equal(oito.end, 1.1, "e termina onde ele terminou: nenhum tempo é inventado");
  for (let i = 1; i < saida.length; i += 1) {
    assert.ok(saida[i].start >= saida[i - 1].start - 1e-9, "os tempos seguem em ordem");
    assert.ok(saida[i].end > saida[i].start, "nenhuma palavra tem janela vazia");
  }
});

test("sem --corrigir, palavra que falta continua bloqueando em vez de ser preenchida", () => {
  const script = "Você tem trinta e oito anos";
  const words = timed([["Você", 0, 0.3], ["tem", 0.3, 0.5], ["38", 0.5, 1.1], ["anos", 1.1, 1.4]]);
  const r = correctWordsAgainstScript({ script, words, spellingFloor: 0.75 });
  assert.equal(r.status, "blocked");
  assert.ok(r.findings.some((f) => f.code === "missing_word" && f.severity === "block"));
});

test("corrida de vagas no começo do roteiro toma emprestado da vizinha da frente", () => {
  const p = [
    { word: "São", start: null, end: null },
    { word: "onze", start: null, end: null },
    { word: "e", start: 0, end: 0.9 },
    { word: "quarenta", start: 0.9, end: 1.3 },
  ];
  repartirJanelasDasVagas(p);
  assert.equal(p[0].start, 0);
  assert.equal(p[2].end, 0.9);
  assert.ok(p[0].end <= p[1].start && p[1].end <= p[2].start);
});

test("repartir sem nenhuma palavra medida falha em vez de inventar tempo", () => {
  assert.throws(
    () => repartirJanelasDasVagas([{ word: "a", start: null, end: null }, { word: "b", start: null, end: null }]),
    /não há janela para repartir/,
  );
});
