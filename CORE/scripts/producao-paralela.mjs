#!/usr/bin/env node

/**
 * Produz vários filmes de tipografia nativa em paralelo, ponta a ponta.
 *
 *   node scripts/producao-paralela.mjs --plano <plano.json> [--projetos 5] [--paralelo 2]
 *   node scripts/producao-paralela.mjs --plano <plano.json> --so-qa
 *
 * A receita é `tipografia-intencao-10s`, esticada para um minuto: a locução
 * manda no tempo, o Whisper mede cada palavra, o cronograma medido entra no
 * PROMPT e quem desenha a letra é o Omni. Nada de overlay.
 *
 * Por que este arquivo existe em vez de um laço no shell: cada projeto tem sete
 * etapas com dependência entre elas (a imagem não pode ser pedida antes da voz
 * ser medida), cada etapa é idempotente, e um projeto que falha não pode
 * derrubar os outros quatro. Isso é orquestração, não script de conveniência.
 *
 * Idempotência: se a saída de uma etapa já existe, a etapa é pulada. Dá para
 * interromper e retomar sem gastar cota de novo.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { avaliarArremate } from "./qa-peca.mjs";

const exec = promisify(execFile);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Janela de arremate canônica da casa: a música termina de 3 a 5s após a voz. */
const ARREMATE_ALVO = 4.0;
/**
 * Ganho da trilha sob a voz.
 *
 * -5dB foi reprovado duas vezes ("a trilha ficou alta ainda"). -14dB corrigiu
 * demais: medido em 03/09/2026, o arremate dos cinco filmes ficou em -45dB
 * contra -17dB da fala, ou seja, inaudível — a música não subia quando a voz
 * saía, ela sumia. -9dB é o meio-termo: cama discreta sob a locução e arremate
 * que ainda tem corpo.
 */
const GANHO_TRILHA_DB = -9;
const DUCK_THRESHOLD = 0.04;
const DUCK_RATIO = 9;

const log = (projeto, etapa, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${String(projeto).padEnd(12)} ${String(etapa).padEnd(12)} ${msg}`);

async function existe(f) { try { await access(f); return true; } catch { return false; } }
async function jsonDe(f) { return JSON.parse(await readFile(f, "utf8")); }
async function escreverJson(f, v) { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, JSON.stringify(v, null, 2) + "\n"); }

/**
 * Fila global do CLI — só um `omni-cli` por vez, sempre.
 *
 * Medido em 02/09/2026: com três projetos rodando `batch` ao mesmo tempo, os
 * processos brigam pelo broker de sessão e pelo SQLite dos recibos, e o lote
 * morre com "Broker global bloqueou o job: timeout" e "database is locked".
 * O paralelismo útil mora DENTRO de um batch (`--parallel`), não entre
 * processos. O pool de projetos continua valendo: ele sobrepõe o trabalho
 * local (ffmpeg, Whisper) com a espera do provedor de outro projeto.
 */
let filaCli = Promise.resolve();
async function cli(args, { timeout = 900_000 } = {}) {
  const minhaVez = filaCli.then(() => {}, () => {});
  let liberar;
  filaCli = new Promise((r) => { liberar = r; });
  await minhaVez;
  try {
    const { stdout } = await exec(process.execPath, [path.join(RAIZ, "scripts", "omni-cli.mjs"), ...args], { cwd: RAIZ, timeout, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } finally { liberar(); }
}
async function ff(bin, args, { timeout = 900_000 } = {}) {
  const r = await exec(bin, args, { cwd: RAIZ, timeout, maxBuffer: 64 * 1024 * 1024 });
  return r.stdout.trim();
}
const duracaoDe = (f) => ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).then(Number);

/**
 * Agrupa as palavras medidas em linhas de tela.
 *
 * O corte segue a PONTUAÇÃO do roteiro, não uma contagem fixa: é a pontuação
 * que marca onde o locutor respira, e linha que ignora a respiração lê como
 * metralhadora. Foi essa a crítica de "texto muito duro". Depois disso, linha
 * comprida demais é partida e fragmento de uma palavra só é colado no vizinho.
 */
export function agruparLinhas(palavras, { maxPalavras = 6 } = {}) {
  const fechaFrase = (p) => /[.!?]$/.test(p.word);
  const grupos = [];
  let atual = [];
  for (const p of palavras) {
    atual.push(p);
    const fechaClausula = /[,;:]$/.test(p.word);
    if (fechaFrase(p) || (fechaClausula && atual.length >= 2) || atual.length >= maxPalavras) {
      grupos.push(atual);
      atual = [];
    }
  }
  if (atual.length) grupos.push(atual);

  // Fragmento de uma palavra só não sustenta um beat: cola no vizinho.
  //
  // Mas nunca ATRAVESSANDO ponto final: juntar "diferente." com "Do mesmo
  // jeito" põe duas frases na mesma linha e o ponto aparece desenhado no meio
  // dela. Grupo que fecha frase só pode ser absorvido para trás.
  for (let i = 0; i < grupos.length; i += 1) {
    if (grupos[i].length > 1 || grupos.length === 1) continue;
    const anterior = grupos[i - 1];
    const proximo = grupos[i + 1];
    const terminaFrase = fechaFrase(grupos[i][grupos[i].length - 1]);
    const anteriorFechaFrase = anterior && fechaFrase(anterior[anterior.length - 1]);
    const podeAtras = anterior && !anteriorFechaFrase && anterior.length < maxPalavras;
    const podeFrente = proximo && !terminaFrase && proximo.length < maxPalavras;
    if (!podeAtras && !podeFrente) continue;
    const paraTras = podeAtras && (!podeFrente || anterior.length <= proximo.length);
    if (paraTras) anterior.push(...grupos[i]); else proximo.unshift(...grupos[i]);
    grupos.splice(i, 1);
    i -= 1;
  }

  return grupos.map((g) => ({
    // A pontuação sai inteira, não só a do fim: vírgula desenhada no meio de
    // uma linha em caixa alta lê como sujeira, e o Omni tende a inventar em
    // cima dela.
    texto: g.map((p) => p.word).join(" ").replace(/[.,;:!?"']/g, "").replace(/\s+/g, " ").trim().toUpperCase(),
    inicio: g[0].start,
    fim: g[g.length - 1].end,
  })).filter((l) => l.texto);
}

const MARCAS_DE_ACENTO = {
  "Ç": "a cedilla on the C", "Ã": "a tilde on the A", "Õ": "a tilde on the O",
  "Á": "an acute on the A", "É": "an acute on the E", "Í": "an acute on the I",
  "Ó": "an acute on the O", "Ú": "an acute on the U",
  "Â": "a circumflex on the A", "Ê": "a circumflex on the E", "Ô": "a circumflex on the O", "À": "a grave on the A",
};

/**
 * Trava ortográfica montada a partir das palavras reais do ato.
 *
 * Escrita à mão, ela erra: foi assim que "UMA" virou "UMÁ" num lote inteiro.
 * Gerada, ela enumera acento por acento o que existe e — o que mais importa —
 * o que NÃO existe, além de proibir forma parecida com letra fora da lista.
 */
export function travaOrtografica(linhas) {
  const palavras = [...new Set(linhas.flatMap((l) => l.texto.split(/[\s,]+/).filter(Boolean)))];
  const com = [];
  const sem = [];
  for (const p of palavras) {
    const marcas = [...new Set([...p].filter((c) => MARCAS_DE_ACENTO[c]))];
    if (marcas.length) com.push(`${p} has ${marcas.map((m) => MARCAS_DE_ACENTO[m]).join(" and ")}`);
    else sem.push(p);
  }
  return [
    "SPELLING LOCK - read this twice before drawing anything:",
    "The ONLY words allowed to appear anywhere in this video, at any moment, are the ones in the list above. Nothing else written, ever.",
    com.length ? `These carry an accent and it must be drawn exactly: ${com.join(". ")}.` : "None of the words in this act carries an accent.",
    sem.length ? `These carry NO accent at all and must be drawn bare: ${sem.join(", ")}. Never invent an accent on any of them.` : "",
    "Never merge two words into one and never split one word into two.",
    "NOTHING ELSE IN THE FRAME MAY LOOK LIKE WRITING. Every other shape must be plainly abstract - a bar, a disc, a ring, a tick, a fragment. No micro-lettering, no tiny text inside small panels, no fake interface labels, no fake subtitles, no numbers, no logos, no watermark, no signature. If you are tempted to fill a small area with texture that reads as text, leave it empty instead.",
  ].filter(Boolean).join("\n");
}

const SEM_FALA = "THIS VIDEO HAS NO SPEAKING IN IT. Nobody talks. There is no narrator and no voice-over. The words listed below are GRAPHIC OBJECTS - flat letterforms that are part of the artwork - they are NOT dialogue and NOT a script. Do not read them aloud.";
const SEM_OVERLAY = "NATIVE ANIMATED TEXT DRAWN BY YOU INSIDE THE VIDEO. The lettering is part of the artwork itself, rendered in the pixels of the frame - it is never a subtitle strip, never a caption bar, never a lower third.";
const LIMPEZA = "KEEP IT CLEAN. Generous empty space. Few elements on screen at once. Every element must earn its place: if a shape does not serve the idea of this act, do not draw it. No clutter, no decorative confetti, no busy backgrounds, no gratuitous particles.";
const MUDO = "AUDIO: silence is fine. [NEGATIVE AUDIO PROMPT: ABSOLUTELY NO NARRATION, NO VOICE, NO SPEECH, NO SINGING].";
const flat = (fundo) => `RENDER CHECK for the direction above: draw it strictly as flat vector shapes and flat letterforms on the flat ${fundo} field. It is a diagram in motion, never a physical object inside a room: no wall, no floor, no ground plane, no table, no horizon, no set, no studio lighting, no shading, no drop shadow, no perspective, no thickness, no volume, no extruded or 3D type.`;
const hhmmss = (s) => `00:${String(Math.floor(s)).padStart(2, "0")}.${String(Math.round((s % 1) * 100)).padStart(2, "0")}`;

export function promptDoAto({ ato, indice, total, estilo, linhas }) {
  const itens = linhas.map((l) => `- [${hhmmss(l.inicio)}s - ${hhmmss(l.fim)}s]: draw ${JSON.stringify(l.texto)}. Draw it once and never again.`);
  return [
    SEM_FALA, "", SEM_OVERLAY, "",
    `ACT ${indice + 1} OF ${total} OF A SIXTY-SECOND COMMERCIAL. THE IDEA THIS ACT HAS TO MAKE VISIBLE: ${ato.tese} The viewer should be able to name that idea just from watching how things move.`, "",
    estilo.look, "", ato.motion, "", LIMPEZA, "",
    "Draw exactly these lines at exactly these times, showing only the words listed and nothing more:",
    ...itens, "",
    travaOrtografica(linhas), "",
    flat(estilo.fundo), "",
    `${ato.fim}, clean stable final frame, no fade-out.`, "",
    MUDO,
  ].join("\n");
}

// ---------------------------------------------------------------- etapas

/**
 * Gera só o que falta, tentativa por tentativa, e recolhe para um diretório
 * canônico onde cada arquivo se chama `<id>.mp4`.
 *
 * Tudo-ou-nada é caro: um lote de seis onde cinco saíram não pode ser refeito
 * inteiro. E o `--out-dir` precisa de basename único por tentativa, senão o
 * requestId colide e o lote morre sem gastar. Por isso cada tentativa escreve
 * na sua própria pasta e o resultado é copiado para a canônica.
 *
 * O `align` casa bloco com arquivo por sufixo (`base === id`), então o nome
 * canônico `<id>.mp4` serve tanto para ele quanto para o `join`.
 */
async function gerarFaltantes({ projeto, etapa, canonico, meta, ids, montarJobs, tentativas = 3, timeout = 1_800_000 }) {
  const { readdir, copyFile } = await import("node:fs/promises");
  const colher = async (dir) => {
    for (const f of await readdir(dir).catch(() => [])) {
      const m = /^(?:\d+-)?(.+)\.mp4$/.exec(f);
      if (!m || !ids.includes(m[1])) continue;
      const destino = path.join(canonico, `${m[1]}.mp4`);
      if (path.resolve(path.join(dir, f)) !== path.resolve(destino) && !(await existe(destino))) await copyFile(path.join(dir, f), destino);
    }
  };
  const faltando = async () => {
    const out = [];
    for (const id of ids) if (!(await existe(path.join(canonico, `${id}.mp4`)))) out.push(id);
    return out;
  };

  await colher(canonico); // aproveita o que uma execução anterior já deixou aqui
  for (let t = 1; t <= tentativas; t += 1) {
    const pendentes = await faltando();
    if (!pendentes.length) break;
    const arquivo = path.join(meta, `jobs-${etapa}-t${t}.json`);
    const saida = `${canonico}-t${t}`;
    await mkdir(saida, { recursive: true });
    await escreverJson(arquivo, montarJobs(pendentes));
    log(projeto, etapa, `tentativa ${t}: ${pendentes.length} de ${ids.length} faltando`);
    await cli(["batch", "--jobs", arquivo, "--parallel", "4", "--out-dir", saida], { timeout })
      .catch((e) => log(projeto, etapa, `lote t${t} retornou erro; colhendo o que saiu (${String(e?.message ?? e).slice(0, 80)})`));
    await colher(saida);
  }
  const pendentes = await faltando();
  if (pendentes.length) throw new Error(`${etapa}: faltaram ${pendentes.join(", ")} após ${tentativas} tentativas`);
  log(projeto, etapa, `${ids.length}/${ids.length} ok`);
}

async function etapaNarracao(p, dirs) {
  await escreverJson(path.join(dirs.meta, "blocos.json"), p.blocos);
  const jobsFile = path.join(dirs.meta, "narration-jobs.json");
  // O comando se recusa a sobrescrever a saída, e numa retomada o arquivo já
  // está lá: só gera quando falta.
  if (!(await existe(jobsFile))) {
    await cli(["commercial", "--step", "narration-jobs", "--blocks", path.join(dirs.meta, "blocos.json"), "--out", jobsFile]);
  }
  const todos = await jsonDe(jobsFile);
  await gerarFaltantes({
    projeto: p.id, etapa: "narracao", canonico: dirs.voz, meta: dirs.meta,
    ids: p.blocos.map((b) => b.id),
    montarJobs: (pendentes) => todos.filter((j) => pendentes.includes(j.id)),
  });
}

async function etapaAlinhamento(p, dirs) {
  const palavras = path.join(dirs.align, "palavras-master.json");
  if (await existe(palavras)) { log(p.id, "align", "pulada (já existe)"); return; }
  log(p.id, "align", "medindo com Whisper");
  await cli(["align", "--blocks", path.join(dirs.meta, "blocos.json"), "--scenes-dir", dirs.voz,
    "--out-dir", dirs.align, "--whisper-model", "small", "--language", "pt", "--corrigir", "true"], { timeout: 1_800_000 });
  const w = await jsonDe(palavras);
  log(p.id, "align", `${(Array.isArray(w) ? w : w.words).length} palavras medidas`);
}

/** Deriva as linhas de tela de cada ato a partir dos spans medidos. */
async function etapaLinhas(p, dirs) {
  const destino = path.join(dirs.meta, "linhas.json");
  if (await existe(destino)) return jsonDe(destino);
  const spans = await jsonDe(path.join(dirs.align, "spans.json"));
  const bruto = await jsonDe(path.join(dirs.align, "palavras-master.json"));
  const palavras = Array.isArray(bruto) ? bruto : bruto.words;
  const porAto = spans.spans.map((s, i) => {
    const offset = i * 10;
    // wordRange é INCLUSIVO nas duas pontas. Com slice(a, b) a última palavra
    // de cada ato some da tela em silêncio — foi assim que "FALA", "CHUTE" e
    // "VÍDEOS" quase ficaram de fora de cinco filmes.
    const linhas = agruparLinhas(palavras.slice(s.wordRange[0], s.wordRange[1] + 1))
      .map((l) => ({ ...l, inicio: Math.max(0, +(l.inicio - offset).toFixed(2)), fim: Math.min(9.95, +(l.fim - offset).toFixed(2)) }))
      .filter((l) => l.fim > l.inicio);
    return { id: s.id, offset, linhas };
  });
  await escreverJson(destino, porAto);
  log(p.id, "linhas", porAto.map((a) => a.linhas.length).join("+") + " linhas de tela");
  return porAto;
}

async function etapaVisuais(p, dirs, porAto) {
  const jobs = porAto.map((a, i) => ({
    id: a.id, task: "text_to_video", aspect: "16:9",
    prompt: promptDoAto({ ato: p.atos[i], indice: i, total: p.atos.length, estilo: p.estilo, linhas: a.linhas }),
  }));
  await escreverJson(path.join(dirs.meta, "jobs-atos.json"), jobs);
  await gerarFaltantes({
    projeto: p.id, etapa: "visuais", canonico: dirs.atos, meta: dirs.meta,
    ids: jobs.map((j) => j.id),
    montarJobs: (pendentes) => jobs.filter((j) => pendentes.includes(j.id)),
    timeout: 2_400_000,
  });
}

/**
 * Trilha com arremate de verdade.
 *
 * `--duration N` NÃO faz o Lyria compor N segundos: ele compõe uma peça inteira
 * e o pipeline corta em N, no meio da frase. O acorde resolvido fica no
 * original do provedor. Por isso a cama sai do FIM do original, e não do começo.
 */
async function etapaTrilha(p, dirs) {
  const destino = path.join(dirs.meta, "trilha-arremate.wav");
  if (await existe(destino)) { log(p.id, "trilha", "pulada (já existe)"); return duracaoDe(destino); }
  const voz = await duracaoDe(path.join(dirs.align, "narracao-master.wav"));
  const alvo = Math.round(voz + ARREMATE_ALVO);
  const bruta = path.join(dirs.meta, "trilha.wav");
  if (!(await existe(bruta))) {
    await writeFile(path.join(dirs.meta, "trilha-prompt.txt"), p.trilha);
    log(p.id, "trilha", `pedindo ${alvo}s ao Flow Music`);
    await cli(["music", "--mode", "studio", "--backend", "flow-music", "--prompt-file", path.join(dirs.meta, "trilha-prompt.txt"),
      "--duration", String(alvo), "--out", bruta], { timeout: 1_800_000 });
  }
  const original = path.join(dirs.meta, "trilha.provider.m4a");
  const fonte = (await existe(original)) ? original : bruta;
  const dur = await duracaoDe(fonte);
  const inicio = Math.max(0, +(dur - alvo).toFixed(3));
  await ff("ffmpeg", ["-y", "-v", "error", "-ss", String(inicio), "-t", String(alvo), "-i", fonte, "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", destino]);
  log(p.id, "trilha", `${alvo}s do fim do original (offset ${inicio}s), arremate ${(alvo - voz).toFixed(2)}s`);
  return alvo;
}

/**
 * Montagem.
 *
 * Dois detalhes que custaram uma peça inteira para descobrir: o `sidechaincompress`
 * termina quando a cadeia lateral termina, então a voz PRECISA ser preenchida com
 * silêncio até a duração da trilha, senão o arremate morre junto com a locução; e
 * o `mux-audio` adota a duração do ÁUDIO, então o vídeo precisa sobrar.
 */
async function etapaMontagem(p, dirs) {
  const final = path.join(dirs.saida, `${p.id}.mp4`);
  if (await existe(final)) { log(p.id, "montagem", "pulada (já existe)"); return final; }

  const unido = path.join(dirs.saida, "atos-unidos.mp4");
  if (!(await existe(unido))) {
    // Nome canônico posto por gerarFaltantes: `<id>.mp4`, na ordem dos atos.
    const manifesto = p.atos.map((a) => path.relative(dirs.meta, path.join(dirs.atos, `${a.id}.mp4`)).split(path.sep).join("/"));
    await escreverJson(path.join(dirs.meta, "assembly.json"), manifesto);
    await cli(["join", "--mode", "studio", "--manifest", path.join(dirs.meta, "assembly.json"), "--out", unido]);
  }

  const trilha = path.join(dirs.meta, "trilha-arremate.wav");
  const durTrilha = await duracaoDe(trilha);
  const durVideo = await duracaoDe(unido);

  const estendido = path.join(dirs.saida, "atos-estendido.mp4");
  if (!(await existe(estendido))) {
    const sobra = Math.max(0.5, durTrilha - durVideo + 1);
    await ff("ffmpeg", ["-y", "-v", "error", "-i", unido, "-vf", `tpad=stop_mode=clone:stop_duration=${sobra.toFixed(2)}`,
      "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", estendido], { timeout: 1_800_000 });
  }

  const vozCheia = path.join(dirs.meta, "voz-cheia.wav");
  if (!(await existe(vozCheia))) {
    await ff("ffmpeg", ["-y", "-v", "error", "-i", path.join(dirs.align, "narracao-master.wav"),
      "-af", `apad=whole_dur=${durTrilha.toFixed(3)}`, "-c:a", "pcm_s16le", vozCheia]);
  }

  const master = path.join(dirs.meta, "master-audio.wav");
  if (!(await existe(master))) {
    await cli(["mix", "--mode", "studio", "--voice", vozCheia, "--music", trilha,
      "--music-gain", `${p.ganhoTrilhaDb ?? GANHO_TRILHA_DB}dB`,
      "--ducking-threshold", String(DUCK_THRESHOLD), "--ducking-ratio", String(DUCK_RATIO),
      "--fade-in", "0.2", "--fade-out", "0", "--out", master], { timeout: 900_000 });
  }

  await cli(["mux-audio", "--mode", "studio", "--video", estendido, "--audio", master, "--out", final], { timeout: 1_800_000 });
  log(p.id, "montagem", `${(await duracaoDe(final)).toFixed(2)}s`);
  return final;
}

/**
 * Normaliza a fala antes de comparar.
 *
 * O Whisper escreve o que a norma culta pede, não o que o locutor disse: "pra"
 * volta como "para", "tá" como "está". Contar isso como divergência enche o
 * relatório de ruído e esconde o erro de verdade.
 */
export function normalizarFala(texto) {
  const equivalentes = { para: "pra", esta: "ta", estao: "tao", voce: "vc" };
  return String(texto).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?—–"'()]/g, " ")
    .split(/\s+/).filter(Boolean)
    .map((p) => equivalentes[p] ?? p);
}

/**
 * Diferença por alinhamento, não por posição.
 *
 * Comparar índice a índice faz uma única palavra a mais no começo desalinhar
 * tudo o que vem depois: foi assim que um filme com um deslize acusou 121
 * divergências em 130 palavras. A subsequência comum máxima separa o que
 * realmente falta do que só escorregou de lugar.
 */
export function diferencaDeFala(alvo, ouvido) {
  const n = alvo.length, m = ouvido.length;
  const tabela = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      tabela[i][j] = alvo[i] === ouvido[j] ? tabela[i + 1][j + 1] + 1 : Math.max(tabela[i + 1][j], tabela[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (alvo[i] === ouvido[j]) { i += 1; j += 1; }
    else if (tabela[i + 1][j] >= tabela[i][j + 1]) { out.push({ tipo: "faltou", palavra: alvo[i] }); i += 1; }
    else { out.push({ tipo: "sobrou", palavra: ouvido[j] }); j += 1; }
  }
  while (i < n) { out.push({ tipo: "faltou", palavra: alvo[i] }); i += 1; }
  while (j < m) { out.push({ tipo: "sobrou", palavra: ouvido[j] }); j += 1; }
  return out;
}

/** Conferência: fidelidade do texto falado, arremate e níveis. */
async function etapaQa(p, dirs, final) {
  const roteiro = p.blocos.map((b) => b.text).join(" ");
  const wav = path.join(dirs.meta, "qa-final.wav");
  await ff("ffmpeg", ["-y", "-v", "error", "-i", final, "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", wav]);
  await exec("whisper", [wav, "--model", "small", "--language", "pt", "--output_dir", dirs.meta, "--output_format", "txt", "--device", "cuda"],
    { cwd: RAIZ, timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 }).catch(() => null);

  let ouvido = null;
  const txt = path.join(dirs.meta, "qa-final.txt");
  if (await existe(txt)) ouvido = (await readFile(txt, "utf8")).replace(/\s+/g, " ").trim();

  const alvo = normalizarFala(roteiro);
  const got = ouvido ? normalizarFala(ouvido) : [];
  const divergencias = diferencaDeFala(alvo, got);

  const durVoz = await duracaoDe(path.join(dirs.align, "narracao-master.wav"));
  const durTrilha = await duracaoDe(path.join(dirs.meta, "trilha-arremate.wav"));
  const nivel = async (ini, dur) => {
    const { stderr } = await exec("ffmpeg", ["-hide_banner", "-ss", String(ini), "-t", String(dur), "-i", path.join(dirs.meta, "master-audio.wav"), "-af", "volumedetect", "-f", "null", "-"], { cwd: RAIZ, maxBuffer: 32 * 1024 * 1024 }).catch((e) => e);
    return Number((String(stderr).match(/mean_volume:\s*(-?[\d.]+) dB/) ?? [])[1]);
  };

  const rel = {
    projeto: p.id,
    duracaoFinal: +(await duracaoDe(final)).toFixed(2),
    voz: +durVoz.toFixed(2),
    trilha: +durTrilha.toFixed(2),
    arremate: avaliarArremate(durTrilha, durVoz),
    nivelDuranteFala: +(await nivel(Math.max(0, durVoz / 2), 8)).toFixed(1),
    nivelNoArremate: +(await nivel(durVoz + 0.3, Math.max(1, durTrilha - durVoz - 0.5))).toFixed(1),
    palavrasRoteiro: alvo.length,
    palavrasOuvidas: got.length,
    divergencias,
    fidelidade: divergencias.length === 0 ? "exata" : `${divergencias.length} divergência(s)`,
  };
  rel.arremateSobe = Number.isFinite(rel.nivelNoArremate) && Number.isFinite(rel.nivelDuranteFala) && rel.nivelNoArremate > rel.nivelDuranteFala;
  await escreverJson(path.join(dirs.meta, "qa.json"), rel);
  log(p.id, "qa", `${rel.fidelidade} | arremate ${rel.arremate?.delta}s ${rel.arremate?.dentro ? "dentro" : "FORA"} | sobe: ${rel.arremateSobe}`);
  return rel;
}

/**
 * Cronômetro por etapa.
 *
 * Sem isto, o tempo de cada fase só existia como diferença entre duas linhas de
 * log — legível para uma pessoa, inútil para comparar rodadas. Aqui cada etapa
 * grava início, fim e duração no relatório, junto do que ela produziu.
 */
async function cronometrar(tempos, nome, tarefa) {
  const t0 = Date.now();
  try { return await tarefa(); }
  finally { tempos.push({ etapa: nome, segundos: +((Date.now() - t0) / 1000).toFixed(1) }); }
}

async function produzir(p, raizSaida) {
  const base = path.join(raizSaida, p.id);
  const dirs = {
    base,
    meta: path.join(base, "metadados"),
    voz: path.join(base, `voz-${p.id}`),
    align: path.join(base, "metadados", "alinhamento"),
    atos: path.join(base, `atos-${p.id}`),
    saida: path.join(base, "videos-unidos"),
  };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });

  const tempos = [];
  const t0 = Date.now();
  await cronometrar(tempos, "narracao", () => etapaNarracao(p, dirs));
  await cronometrar(tempos, "alinhamento", () => etapaAlinhamento(p, dirs));
  const porAto = await cronometrar(tempos, "linhas", () => etapaLinhas(p, dirs));
  await cronometrar(tempos, "trilha", () => etapaTrilha(p, dirs));
  await cronometrar(tempos, "visuais", () => etapaVisuais(p, dirs, porAto));
  const final = await cronometrar(tempos, "montagem", () => etapaMontagem(p, dirs));
  const rel = await cronometrar(tempos, "qa", () => etapaQa(p, dirs, final));
  rel.tempos = tempos;
  rel.minutosTotais = +((Date.now() - t0) / 60000).toFixed(1);
  await escreverJson(path.join(dirs.meta, "qa.json"), rel);
  return rel;
}

/** Pool: um projeto que quebra não derruba os outros. */
async function comPool(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo; proximo += 1;
      try { resultados[i] = { ok: true, valor: await tarefa(itens[i]) }; }
      catch (e) { resultados[i] = { ok: false, projeto: itens[i].id, erro: String(e?.message ?? e).slice(0, 400) }; log(itens[i].id, "ERRO", String(e?.message ?? e).slice(0, 200)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const planoFile = opt("plano");
  if (!planoFile) throw new Error("--plano <arquivo.json> é obrigatório.");
  const plano = await jsonDe(path.resolve(planoFile));
  const projetos = plano.projetos ?? plano;
  const raizSaida = path.resolve(opt("raiz", path.join(RAIZ, "outputs", plano.colecao ?? "producao-paralela")));
  const paralelo = Number(opt("paralelo", 3));

  console.log(`\n${projetos.length} projetos | pool ${paralelo} | saída ${raizSaida}\n`);
  const inicio = Date.now();
  const resultados = await comPool(projetos, paralelo, (p) => produzir(p, raizSaida));
  const relatorio = {
    schema: "gerador-de-videos/producao-paralela@1",
    colecao: plano.colecao ?? null,
    minutos: +((Date.now() - inicio) / 60000).toFixed(1),
    ok: resultados.filter((r) => r.ok).length,
    falhas: resultados.filter((r) => !r.ok),
    projetos: resultados.filter((r) => r.ok).map((r) => r.valor),
  };
  await escreverJson(path.join(raizSaida, "relatorio.json"), relatorio);
  console.log(`\n=== ${relatorio.ok}/${projetos.length} em ${relatorio.minutos} min ===`);
  for (const r of relatorio.projetos) console.log(`  ${r.projeto.padEnd(14)} ${String(r.duracaoFinal).padStart(6)}s  ${r.fidelidade.padEnd(18)} arremate ${r.arremate?.delta}s`);
  for (const f of relatorio.falhas) console.log(`  FALHOU ${f.projeto}: ${f.erro}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
