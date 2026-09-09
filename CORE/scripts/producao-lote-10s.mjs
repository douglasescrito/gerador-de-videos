#!/usr/bin/env node

/**
 * Produz um lote de peças de dez segundos com a receita `tipografia-intencao`.
 *
 *   node scripts/producao-lote-10s.mjs --plano <plano.json> [--paralelo 3]
 *
 * Uma peça = três chamadas de provedor:
 *   1. voz    — bloco de narração Omni, só o áudio é aproveitado
 *   2. visual — tipografia nativa nos tempos medidos; o áudio dele vai fora
 *   3. trilha — clipe SEM TEXTO, cuja única serventia é o áudio
 *
 * O terceiro existe porque clipe com texto narra o que desenha, e clipe sem
 * texto não narra. Se a peça tem logo, o visual vira `reference_to_video` com o
 * PNG oficial: logo se compõe em pixel, nunca se redesenha por descrição.
 *
 * Reaproveita as funções puras do orquestrador de um minuto — agrupamento de
 * linhas por respiração, trava ortográfica gerada e comparação de fala por
 * alinhamento.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { agruparLinhas, travaOrtografica, normalizarFala, diferencaDeFala } from "./producao-paralela.mjs";

const exec = promisify(execFile);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GANHO_TRILHA_DB = -9;
/** Documento do Google Vids que hospeda as cenas de narração. Aponte para o seu. */
const VIDS_DOC = process.env.VIDS_DOC ?? "https://docs.google.com/videos/d/USER_DOCUMENT_ID/edit";

const log = (p, e, m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${String(p).padEnd(22)} ${String(e).padEnd(10)} ${m}`);
const existe = async (f) => { try { await access(f); return true; } catch { return false; } };
const jsonDe = async (f) => JSON.parse(await readFile(f, "utf8"));
const escreverJson = async (f, v) => { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, JSON.stringify(v, null, 2) + "\n"); };

/** Um `omni-cli` por vez: batches concorrentes brigam pelo broker e pelo SQLite. */
let fila = Promise.resolve();
async function cli(args, { timeout = 1_800_000 } = {}) {
  const vez = fila.then(() => {}, () => {});
  let liberar; fila = new Promise((r) => { liberar = r; });
  await vez;
  try { return (await exec(process.execPath, [path.join(RAIZ, "scripts", "omni-cli.mjs"), ...args], { cwd: RAIZ, timeout, maxBuffer: 64 * 1024 * 1024 })).stdout; }
  finally { liberar(); }
}
const ff = async (bin, args) => (await exec(bin, args, { cwd: RAIZ, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
const duracaoDe = (f) => ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).then(Number);

const SEM_FALA = "THIS VIDEO HAS NO SPEAKING IN IT. Nobody talks. There is no narrator and no voice-over. The words listed below are GRAPHIC OBJECTS - flat letterforms that are part of the artwork - they are NOT dialogue and NOT a script. Do not read them aloud.";
const SEM_OVERLAY = "NATIVE ANIMATED TEXT DRAWN BY YOU INSIDE THE VIDEO. The lettering is part of the artwork itself, rendered in the pixels of the frame - it is never a subtitle strip, never a caption bar, never a lower third.";
const LIMPEZA = "KEEP IT CLEAN. Generous empty space, few elements on screen at once, and every element must earn its place. No clutter, no decorative confetti, no busy background, no gratuitous particles.";
const MUDO = "AUDIO: silence is fine. [NEGATIVE AUDIO PROMPT: ABSOLUTELY NO NARRATION, NO VOICE, NO SPEECH, NO SINGING].";

function promptVisual(p, linhas) {
  const itens = linhas.map((l) => `- [00:${String(Math.floor(l.inicio)).padStart(2, "0")}.${String(Math.round((l.inicio % 1) * 100)).padStart(2, "0")}s - 00:${String(Math.floor(l.fim)).padStart(2, "0")}.${String(Math.round((l.fim % 1) * 100)).padStart(2, "0")}s]: draw ${JSON.stringify(l.texto)}. Draw it once and never again.`);
  const comLogo = Boolean(p.logo);
  return [
    SEM_FALA, "", SEM_OVERLAY, "",
    `THE IDEA THIS FILM HAS TO MAKE VISIBLE: ${p.tese} The viewer should be able to name that idea just from watching how things move.`, "",
    p.look, "", p.motion, "", LIMPEZA, "",
    "Draw exactly these lines at exactly these times, showing only the words listed and nothing more:",
    ...itens, "",
    travaOrtografica(linhas), "",
    `RENDER CHECK for the direction above: draw it strictly as flat vector shapes and flat letterforms on the flat ${p.fundo} field. It is a diagram in motion, never a physical object inside a room: no wall, no floor, no ground plane, no table, no horizon, no set, no studio lighting, no shading, no drop shadow, no perspective, no thickness, no volume, no extruded or 3D type.`, "",
    comLogo
      ? `THE SUPPLIED REFERENCE IMAGE IS THE OFFICIAL BRAND LOGO. In the last moment of the film it must appear EXACTLY as supplied - same shapes, same proportions, same colours, same spacing between the mark and the wordmark. Never redraw it, never restyle it, never change its colours, never add or remove anything from it, never letter it yourself. Compose it into the frame as a finished graphic. ${p.fim}, clean stable final frame, no fade-out.`
      : `${p.fim}, clean stable final frame, no fade-out.`,
    "", MUDO,
  ].join("\n");
}

const promptTrilha = (p) => [
  "THIS IS A SCORE CLIP. The audio is the entire point of it and the picture does not matter.",
  "",
  "PICTURE: an abstract flat 2D field of colour and simple moving shapes, in the mood described below. Absolutely no text of any kind - no letters, no words, no numbers, no symbols, no captions, no logos, no watermark, nothing written anywhere at any moment. No people, no faces.",
  "",
  `THE IDEA THIS MUSIC HAS TO CARRY: ${p.tese}`,
  "",
  `AUDIO - THIS IS WHAT MATTERS. Compose one continuous ten-second cue with its sound design fused into the arrangement rather than laid on top of it: ${p.trilha}`,
  "",
  "Leave generous headroom: do not master loud, do not brickwall, do not clip. Fill the whole ten seconds, no silence at the start, no fade-out at the end.",
  "",
  "[NEGATIVE AUDIO PROMPT: ABSOLUTELY NO NARRATION, NO VOICE, NO VOICES, NO SPEECH, NO SPOKEN WORDS, NO SINGING, NO CHANTING, NO CHOIR, NO HUMAN VOCAL SOUND OF ANY KIND].",
].join("\n");

/** Gera só o que falta, colhendo para `<id>.mp4` num diretório canônico. */
async function gerarFaltantes({ peca, etapa, canonico, meta, ids, montarJobs, tentativas = 3 }) {
  const colher = async (dir) => {
    for (const f of await readdir(dir).catch(() => [])) {
      const m = /^(?:\d+-)?(.+)\.mp4$/.exec(f);
      if (!m || !ids.includes(m[1])) continue;
      const destino = path.join(canonico, `${m[1]}.mp4`);
      if (path.resolve(path.join(dir, f)) !== path.resolve(destino) && !(await existe(destino))) await copyFile(path.join(dir, f), destino);
    }
  };
  const faltando = async () => { const o = []; for (const id of ids) if (!(await existe(path.join(canonico, `${id}.mp4`)))) o.push(id); return o; };
  await colher(canonico);
  for (let t = 1; t <= tentativas; t += 1) {
    const pend = await faltando();
    if (!pend.length) break;
    const arq = path.join(meta, `jobs-${etapa}-t${t}.json`);
    const saida = `${canonico}-t${t}`;
    await mkdir(saida, { recursive: true });
    await escreverJson(arq, montarJobs(pend));
    log(peca, etapa, `tentativa ${t}: ${pend.length}/${ids.length} faltando`);
    // Job com `images` manda arquivo local para o provedor externo, e o CLI
    // exige confirmação explícita para isso. Só acrescenta a flag quando há
    // mesmo entrada externa — lote de texto puro não precisa dela.
    const temEntradaExterna = montarJobs(pend).some((j) => Array.isArray(j.images) && j.images.length);
    await cli(["batch", "--jobs", arq, "--parallel", "4", "--out-dir", saida,
      ...(temEntradaExterna ? ["--confirm-provider-input", "true"] : [])], { timeout: 2_400_000 })
      .catch((e) => log(peca, etapa, `lote t${t} deu erro: ${String(e?.message ?? e).split("\n").pop().slice(0, 120)}`));
    await colher(saida);
  }
  const pend = await faltando();
  if (pend.length) throw new Error(`${etapa}: faltaram ${pend.join(", ")}`);
}

async function produzirPeca(p, raiz) {
  const base = path.join(raiz, p.id);
  const d = { meta: path.join(base, "metadados"), voz: path.join(base, `voz-${p.id}`), clipes: path.join(base, `clipes-${p.id}`), saida: path.join(base, "final") };
  for (const x of Object.values(d)) await mkdir(x, { recursive: true });
  const final = path.join(d.saida, `${p.id}.mp4`);
  if (await existe(final)) { log(p.id, "pronto", "pulada"); return { peca: p.id, arquivo: final, pulada: true }; }

  // 1. voz — TTS do Google Vids.
  //
  // Antes a narração saía como VÍDEO: o `text_to_video` do Omni desenhava uma
  // tela azul vazia e a gente extraía só o WAV. Custava 60,5s por bloco (mais
  // caro que o clipe visual, 42,5s), jogava a imagem fora e ainda entulhava o
  // acervo com um "Voz" de 2,3 MB por peça que ninguém ia assistir.
  const roteiroFile = path.join(d.meta, "roteiro.txt");
  await writeFile(roteiroFile, p.roteiro, "utf8");
  const vozEscolhida = p.vozVids ?? (/feminina/i.test(p.voz ?? "") ? "Orla" : "Jett");
  const wavVoz = path.join(d.voz, "narracao.wav");
  if (!(await existe(wavVoz))) {
    log(p.id, "voz", `TTS Google Vids · ${vozEscolhida}`);
    await cli(["tts", "--mode", "studio", "--provider", "google-vids", "--document-url", VIDS_DOC,
      "--text-file", roteiroFile, "--voice", vozEscolhida, "--out", wavVoz]);
  }

  // 2. medida — modo contínuo: um WAV inteiro contra o roteiro, sem blocos.
  const align = path.join(d.meta, "alinhamento");
  if (!(await existe(path.join(align, "palavras-master.json")))) {
    log(p.id, "align", "medindo");
    await cli(["align", "--audio", wavVoz, "--script-file", roteiroFile, "--out-dir", align,
      "--whisper-model", "small", "--language", "pt", "--corrigir", "true"]);
  }
  const bruto = await jsonDe(path.join(align, "palavras-master.json"));
  const linhas = agruparLinhas(Array.isArray(bruto) ? bruto : bruto.words).map((l) => ({ ...l, fim: Math.min(9.95, l.fim) }));
  await escreverJson(path.join(d.meta, "linhas.json"), linhas);
  log(p.id, "linhas", linhas.map((l) => l.texto).join(" / "));

  // 3. visual + trilha, no mesmo lote
  const jobVisual = { id: "visual", task: p.logo ? "reference_to_video" : "text_to_video", aspect: "16:9", prompt: promptVisual(p, linhas), ...(p.logo ? { images: [p.logo] } : {}) };
  const jobTrilha = { id: "trilha", task: "text_to_video", aspect: "16:9", prompt: promptTrilha(p) };
  await gerarFaltantes({ peca: p.id, etapa: "clipes", canonico: d.clipes, meta: d.meta, ids: ["visual", "trilha"], montarJobs: (pend) => [jobVisual, jobTrilha].filter((j) => pend.includes(j.id)) });

  // 4. som: voz + trilha do clipe mudo, com o áudio do visual descartado
  const wavTrilha = path.join(d.meta, "trilha.wav");
  await ff("ffmpeg", ["-y", "-v", "error", "-i", path.join(d.clipes, "trilha.mp4"), "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", wavTrilha]);
  // Em modo contínuo o `align` não escreve um master novo: o `masterFile` do
  // spans.json aponta de volta para o WAV que entrou. Só o modo por blocos
  // concatena e gera `narracao-master.wav`.
  const master = path.join(d.meta, "master.wav");
  if (!(await existe(master))) {
    await cli(["mix", "--mode", "studio", "--voice", wavVoz, "--music", wavTrilha,
      "--music-gain", `${GANHO_TRILHA_DB}dB`, "--ducking-threshold", "0.05", "--ducking-ratio", "8", "--fade-in", "0.15", "--fade-out", "0", "--out", master]);
  }
  const durVisual = await duracaoDe(path.join(d.clipes, "visual.mp4"));
  const cheio = path.join(d.meta, "master-cheio.wav");
  await ff("ffmpeg", ["-y", "-v", "error", "-i", master, "-af", `apad=whole_dur=${durVisual.toFixed(3)}`, "-c:a", "pcm_s16le", cheio]);
  await cli(["mux-audio", "--mode", "studio", "--video", path.join(d.clipes, "visual.mp4"), "--audio", cheio, "--out", final]);

  // 5. conferência
  const wav = path.join(d.meta, "qa.wav");
  await ff("ffmpeg", ["-y", "-v", "error", "-i", final, "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", wav]);
  await exec("whisper", [wav, "--model", "small", "--language", "pt", "--output_dir", d.meta, "--output_format", "txt", "--device", "cuda"], { cwd: RAIZ, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 }).catch(() => null);
  const txt = path.join(d.meta, "qa.txt");
  const ouvido = (await existe(txt)) ? (await readFile(txt, "utf8")).replace(/\s+/g, " ").trim() : "";
  const div = diferencaDeFala(normalizarFala(p.roteiro), normalizarFala(ouvido));
  const rel = { peca: p.id, arquivo: final, duracao: +(await duracaoDe(final)).toFixed(2), linhas: linhas.length, divergencias: div, fidelidade: div.length ? `${div.length} divergência(s)` : "exata" };
  await escreverJson(path.join(d.meta, "qa.json"), rel);
  log(p.id, "qa", `${rel.duracao}s | ${rel.fidelidade}`);
  return rel;
}

async function comPool(itens, limite, tarefa) {
  const res = new Array(itens.length);
  let prox = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (prox < itens.length) {
      const i = prox; prox += 1;
      try { res[i] = { ok: true, valor: await tarefa(itens[i]) }; }
      catch (e) { res[i] = { ok: false, peca: itens[i].id, erro: String(e?.message ?? e).slice(0, 300) }; log(itens[i].id, "ERRO", String(e?.message ?? e).slice(0, 160)); }
    }
  }));
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const plano = await jsonDe(path.resolve(opt("plano")));
  const raiz = path.resolve(opt("raiz", path.join(RAIZ, "outputs", plano.colecao)));
  const t0 = Date.now();
  console.log(`\n${plano.pecas.length} peças de 10s | pool ${opt("paralelo", 3)} | ${raiz}\n`);
  const res = await comPool(plano.pecas, Number(opt("paralelo", 3)), (p) => produzirPeca(p, raiz));
  const rel = { schema: "gerador-de-videos/lote-10s@1", colecao: plano.colecao, minutos: +((Date.now() - t0) / 60000).toFixed(1), ok: res.filter((r) => r.ok).length, falhas: res.filter((r) => !r.ok), pecas: res.filter((r) => r.ok).map((r) => r.valor) };
  await escreverJson(path.join(raiz, "relatorio.json"), rel);
  console.log(`\n=== ${rel.ok}/${plano.pecas.length} em ${rel.minutos} min ===`);
  for (const p of rel.pecas) console.log(`  ${p.peca.padEnd(24)} ${String(p.duracao).padStart(6)}s  ${p.fidelidade}`);
  for (const f of rel.falhas) console.log(`  FALHOU ${f.peca}: ${f.erro}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
