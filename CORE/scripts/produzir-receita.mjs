#!/usr/bin/env node

/**
 * Executa uma receita de peça sincronizada por imagem, ponta a ponta.
 *
 *   node scripts/produzir-receita.mjs --receita recipes/<id>.receita.json [--paralelo 4]
 *
 * A arquitetura: a locução manda no tempo, o Whisper mede cada palavra, cada
 * fatia de fala vira UMA imagem (grátis no Flow), e o movimento nasce em pós.
 * Vídeo gerado só entra onde movimento real for indispensável — aqui, nenhum.
 *
 * Cada etapa é idempotente: se a saída já existe, ela é pulada. Dá para
 * interromper e retomar sem gastar de novo.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runFlowImage } from "./flow-headless.mjs";
import { qaPeca } from "./qa-peca.mjs";

const exec = promisify(execFile);
const FPS = 30;
const LARGURA = 1280;
const ALTURA = 720;

/**
 * REGRA DO MOVIMENTO — por que a imagem é ampliada antes do zoompan.
 *
 * O zoompan trunca x, y e o tamanho do recorte para pixel INTEIRO da entrada.
 * Um gesto lento pede menos de um pixel por quadro, e o filtro não sabe andar
 * meio pixel: ele repete o quadro duas ou três vezes e depois salta um pixel
 * inteiro. É isso que se vê como tremor — a imagem não desliza, ela pulsa.
 *
 * A correção é ampliar a fonte antes, para que o pixel inteiro do zoompan
 * valha uma fração do pixel de saída. Medido em 2026-09-01, gesto vertical
 * lento, 36 quadros:
 *
 *     sobreamostragem   quadros congelados   irregularidade
 *     2x (o que havia)         19                 1,892
 *     4x                        0                 0,556
 *     6x                        0                 0,151   <- adotado
 *     8x                        0                 0,137
 *
 * 6x zera os congelados até no gesto mais lento e custa +27% de tempo; 8x não
 * paga o que cobra. A ida e volta não amolece a arte: SSIM 0,98 contra o que
 * havia, sem halo em traço fino. Bicubic na ampliação porque lanczos toca
 * halo em arte chapada.
 */
export const SOBREAMOSTRAGEM_PADRAO = 6;
export const SOBREAMOSTRAGEM_MINIMA = 4;
const SWS = "bicubic+accurate_rnd+full_chroma_int";

const CLI = "scripts/omni-cli.mjs";

export const RECEITA_SCHEMA = "gerador-de-videos/receita-sincronia-imagem@1";

const ff = (a) => exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { maxBuffer: 32 * 1024 * 1024 });
const dur = async (f) => Number((await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout.trim());
const existe = async (f) => { try { await access(f); return true; } catch { return false; } };
const acharImagem = async (base) => {
  for (const e of [".jpg", ".png", ".webp"]) if (await existe(base + e)) return base + e;
  return null;
};
const log = (etapa, msg) => console.log(`[${etapa}] ${msg}`);

// ---------------------------------------------------------------------------
// Contrato da receita: o que falta aqui derruba a peça antes de gastar nada.
// ---------------------------------------------------------------------------
export function validarReceita(r) {
  const erros = [];
  if (r?.schema !== RECEITA_SCHEMA) erros.push(`schema deve ser ${RECEITA_SCHEMA}`);
  for (const campo of ["id", "label", "roteiro", "narracao", "trilha", "identidade", "fecho"]) {
    if (!r?.[campo]) erros.push(`campo obrigatório ausente: ${campo}`);
  }
  if (r?.identidade && !Array.isArray(r.identidade.movimentos)) erros.push("identidade.movimentos deve ser lista");
  if (r?.identidade && !Array.isArray(r.identidade.gestos)) erros.push("identidade.gestos deve ser lista");

  // O zoompan anda de pixel inteiro. Abaixo de 4x de sobreamostragem o gesto
  // lento congela dois ou três quadros e depois salta — é o tremor. Medido em
  // 2026-09-01: 2x deixou 19 quadros congelados em 35; 6x deixou zero.
  const sa = r?.movimento?.sobreamostragem;
  if (sa !== undefined) {
    if (!Number.isInteger(sa) || sa < SOBREAMOSTRAGEM_MINIMA) {
      erros.push(`movimento.sobreamostragem = ${sa}: precisa ser inteiro >= ${SOBREAMOSTRAGEM_MINIMA}, ou o plano treme`);
    } else if (sa > 8) {
      erros.push(`movimento.sobreamostragem = ${sa}: acima de 8 não melhora nada e custa tempo à toa`);
    }
  }

  // Só os VALORES de texto entram na checagem. Serializar o objeto traria as
  // aspas do próprio JSON e acusaria um problema que não existe.
  const textos = [];
  const colher = (v) => {
    if (typeof v === "string") textos.push(v);
    else if (Array.isArray(v)) v.forEach(colher);
    else if (v && typeof v === "object") Object.values(v).forEach(colher);
  };
  colher(r?.roteiro);
  colher(r?.identidade);
  colher(r?.fecho);

  // String.raw porque "\b" escrito solto vira backspace, não fronteira de palavra.
  const vetadas = (r?.marca?.palavrasVetadas ?? []).map((p) => new RegExp(String.raw`\b${p}\b`, "i"));
  for (const texto of textos) {
    for (const re of vetadas) {
      const m = texto.match(re);
      if (m) erros.push("palavra vetada pela marca: " + m[0]);
    }
    // O modelo letra qualquer literal que enxergue no prompt — medido em
    // 2026-08-28: código hex virou rabisco, e aspas viraram aspas na arte.
    const hex = texto.match(/#[0-9A-Fa-f]{6}/);
    if (hex) erros.push("código hex no texto da identidade (" + hex[0] + ") — o modelo desenha o código na arte");
    if (/["“”]/.test(texto)) erros.push("aspas no texto da identidade — o modelo desenha as aspas na arte");
  }
  if (erros.length) throw new Error("receita inválida:\n  - " + erros.join("\n  - "));
  return r;
}

/** Monta o prompt de uma cena a partir da identidade da receita. */
export function montarPromptDeCena(receita, cena, indice, total) {
  const id = receita.identidade;
  const mov = id.movimentos.find((m) => (indice + 1) / total <= m.ate) ?? id.movimentos.at(-1);
  const gesto = id.gestos[indice % id.gestos.length];
  return {
    movimento: mov.nome,
    prompt: [
      id.base,
      "",
      `SETTING. ${mov.cena}`,
      "",
      `LETTERING. ${id.tipografia} ${gesto} The line reads, word for word:`,
      cena.text,
      "",
      id.fechamento,
    ].join("\n"),
  };
}

/**
 * Gesto de câmera de cada plano.
 *
 * Três coisas aqui não são estilo, são o que faz o plano não tremer:
 *
 * 1. d=1, porque o zoompan emite uma saída por entrada; com d>1 a duração
 *    explode (56s viraram 1947s antes disto ficar claro).
 * 2. O deslocamento é FRAÇÃO de iw/ih, nunca pixel fixo. Escrito em pixel, o
 *    gesto muda de tamanho sozinho quando a sobreamostragem muda — o mesmo
 *    "70" percorre metade do caminho numa fonte com o dobro da largura.
 * 3. E o -framerate na entrada existe porque o demuxer de imagem entrega
 *    25 fps e encolheria cada plano em 16,7%.
 */
export function gestoDoPlano(indice, duracao) {
  const n = Math.max(1, Math.round(duracao * FPS) - 1);
  const centro = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  const gestos = [
    { nome: "aproxima", z: `1+0.10*on/${n}`, ...centro },
    { nome: "afasta", z: `1.10-0.10*on/${n}`, ...centro },
    { nome: "deriva-esq", z: "1.08", x: `iw/2-(iw/zoom/2)+iw*0.027*on/${n}`, y: centro.y },
    { nome: "aproxima-forte", z: `1+0.14*on/${n}`, ...centro },
    { nome: "deriva-dir", z: "1.08", x: `iw/2-(iw/zoom/2)-iw*0.027*on/${n}`, y: centro.y },
    { nome: "sobe", z: "1.08", x: centro.x, y: `ih/2-(ih/zoom/2)+ih*0.035*on/${n}` },
  ];
  return gestos[indice % gestos.length];
}

/** Cadeia de um plano: amplia, recorta, move em pós e volta ao tamanho de entrega. */
export function filtroDoPlano(gesto, sobreamostragem = SOBREAMOSTRAGEM_PADRAO) {
  const w = LARGURA * sobreamostragem;
  const h = ALTURA * sobreamostragem;
  return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,` +
    `crop=${w}:${h},` +
    `zoompan=z='${gesto.z}':d=1:x='${gesto.x}':y='${gesto.y}':s=${LARGURA}x${ALTURA}:fps=${FPS},setsar=1`;
}

async function etapaNarracao(r, raiz) {
  const voz = path.join(raiz, "audios/voz.wav");
  if (await existe(voz)) { log("voz", "já existe"); return dur(voz); }
  const roteiro = path.join(raiz, "metadados/roteiro.txt");
  await writeFile(roteiro, r.roteiro.trim() + "\n", "utf8");
  await exec("node", [CLI, "tts", "--mode", "studio", "--provider", r.narracao.provider ?? "google-vids",
    "--document-url", r.narracao.documentUrl, "--text-file", roteiro, "--voice", r.narracao.voice, "--out", voz],
    { maxBuffer: 32 * 1024 * 1024 });
  const d = await dur(voz);
  log("voz", `${d.toFixed(2)}s (${r.roteiro.trim().split(/\s+/).length} palavras, ${(r.roteiro.trim().split(/\s+/).length / d).toFixed(2)} pal/s)`);
  return d;
}

async function etapaAlinhamento(r, raiz) {
  const palavras = path.join(raiz, "diagnosticos/palavras-master.json");
  if (await existe(palavras)) { log("whisper", "já existe"); return palavras; }
  await exec("node", [CLI, "align", "--audio", path.join(raiz, "audios/voz.wav"),
    "--script-file", path.join(raiz, "metadados/roteiro.txt"),
    "--out-dir", path.join(raiz, "diagnosticos"), "--language", r.narracao.language ?? "pt", "--corrigir", "true"],
    { maxBuffer: 64 * 1024 * 1024 });
  log("whisper", "alinhado");
  return palavras;
}

async function etapaSpec(r, raiz, duracaoVoz) {
  const spec = path.join(raiz, "metadados/spec.json");
  if (await existe(spec)) { log("spec", "já existe"); return JSON.parse(await readFile(spec, "utf8")); }
  await exec("node", [CLI, "commercial", "--step", "scaffold",
    "--words", path.join(raiz, "diagnosticos/palavras-master.json"),
    "--narration-duration", String(duracaoVoz), "--name", r.id, "--aspect", r.aspect ?? "16:9",
    "--max-words", String(r.segmentacao?.maxWords ?? 3), "--out", spec], { maxBuffer: 32 * 1024 * 1024 });
  const lido = JSON.parse(await readFile(spec, "utf8"));
  log("spec", `${lido.scenes.length} cenas`);
  return lido;
}

async function etapaPrompts(r, raiz, spec) {
  const arq = path.join(raiz, "metadados/imagem-jobs.json");
  if (await existe(arq)) {
    const cache = JSON.parse(await readFile(arq, "utf8")).jobs ?? [];
    // Idempotência não pode virar desencontro: se o spec mudou (o alinhamento
    // devolveu mais palavras, por exemplo), o cache antigo tem menos cenas e a
    // animação quebrava lá na frente pedindo uma imagem que ninguém gerou.
    const casa = cache.length === spec.scenes.length
      && cache.every((j, i) => j.id === spec.scenes[i].id && j.texto === spec.scenes[i].text);
    if (casa) { log("prompts", "já existem"); return cache; }
    log("prompts", `cache com ${cache.length} cenas não bate com o spec de ${spec.scenes.length}; refazendo`);
  }
  const jobs = spec.scenes.map((cena, i) => {
    const { movimento, prompt } = montarPromptDeCena(r, cena, i, spec.scenes.length);
    return { id: cena.id, movimento, span: cena.span, texto: cena.text, prompt, aspect: spec.aspect };
  });
  await writeFile(arq, JSON.stringify({ schema: "focus-imagem-jobs@1", receita: r.id, total: jobs.length, jobs }, null, 2), "utf8");
  log("prompts", `${jobs.length} montados`);
  return jobs;
}

async function etapaImagens(r, raiz, jobs, paralelo) {
  const destino = path.join(raiz, "imagens");
  await mkdir(destino, { recursive: true });
  const pendentes = [];
  for (const j of jobs) if (!await acharImagem(path.join(destino, j.id))) pendentes.push(j);
  if (!pendentes.length) { log("imagens", `${jobs.length} já em disco`); return; }
  log("imagens", `gerando ${pendentes.length} de ${jobs.length} (0 créditos, paralelo ${paralelo})`);
  // Uma imagem falha por rede ou por timeout do provedor com alguma frequência
  // (5 de 51 na primeira execução). Como custa zero, a rodada de repescagem é
  // barata; só depois dela a falta vira erro que derruba a peça.
  const rodada = async (lista, etiqueta) => {
    let cursor = 0;
    const falhas = [];
    const worker = async () => {
      while (cursor < lista.length) {
        const j = lista[cursor++];
        try {
          await runFlowImage({ prompt: j.prompt, out: path.join(destino, `${j.id}.png`),
            receipt: path.join(destino, `${j.id}.flow-attempt.json`),
            "project-url": r.fecho.projectUrl, aspect: j.aspect, count: 1, timeout: 300_000 });
        } catch (e) { falhas.push({ id: j.id, erro: String(e.message).split("\n")[0].slice(0, 110) }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(paralelo, lista.length) }, worker));
    if (falhas.length) log("imagens", `${etiqueta}: ${falhas.length} falha(s)`);
    const restam = [];
    for (const j of lista) if (!await acharImagem(path.join(destino, j.id))) restam.push(j);
    return restam;
  };

  let restam = await rodada(pendentes, "1ª rodada");
  if (restam.length) {
    log("imagens", `repescando ${restam.length}: ${restam.map((j) => j.id).join(", ")}`);
    // O adapter recusa sobrescrever; o recibo órfão da tentativa que falhou
    // bloquearia a repescagem.
    for (const j of restam) await exec("cmd", ["/c", "del", "/q", path.join(destino, `${j.id}.flow-attempt.json`)]).catch(() => {});
    restam = await rodada(restam, "repescagem");
  }
  if (restam.length) throw new Error(`imagens faltando após repescagem: ${restam.map((j) => j.id).join(", ")}`);
  log("imagens", `${jobs.length} prontas`);
}

async function etapaAnimacao(raiz, spec, sobreamostragem) {
  const T = path.join(raiz, "videos-unidos/_pecas");
  await mkdir(T, { recursive: true });
  const corpo = path.join(T, "corpo.mp4");
  if (await existe(corpo)) { log("animação", "já existe"); return corpo; }
  const partes = [];
  for (const [i, cena] of spec.scenes.entries()) {
    const fonte = await acharImagem(path.join(raiz, "imagens", cena.id));
    if (!fonte) throw new Error(`imagem da cena ${cena.id} não existe em ${path.join(raiz, "imagens")}; a etapa de imagens não cobriu o spec atual`);
    const d = +(cena.span[1] - cena.span[0]).toFixed(3);
    const g = gestoDoPlano(i, d);
    const saida = path.join(T, `p-${cena.id}.mp4`);
    if (!await existe(saida)) {
      await ff(["-sws_flags", SWS, "-loop", "1", "-framerate", String(FPS), "-t", String(d), "-i", fonte,
        "-vf", filtroDoPlano(g, sobreamostragem),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), saida]);
    }
    partes.push(saida);
  }
  const lista = path.join(T, "lista-corpo.txt");
  await writeFile(lista, partes.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n") + "\n", "utf8");
  await ff(["-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", corpo]);
  log("animação", `${partes.length} planos a ${sobreamostragem}x, corpo ${(await dur(corpo)).toFixed(2)}s`);
  return corpo;
}

async function etapaTrilha(r, raiz, duracaoVoz) {
  const trilha = path.join(raiz, "audios/trilha.wav");
  if (!await existe(trilha)) {
    const alvo = r.trilha.duracaoSegundos ?? Math.round(duracaoVoz + 4);
    await exec("node", [CLI, "music", "--mode", "studio", "--backend", r.trilha.backend ?? "flow-music",
      "--duration", String(alvo), "--prompt", r.trilha.intencao, "--out", trilha], { maxBuffer: 32 * 1024 * 1024 });
  }
  const T = path.join(raiz, "videos-unidos/_pecas");
  await mkdir(T, { recursive: true });
  const tratada = path.join(T, "trilha-tratada.wav");
  if (!await existe(tratada)) {
    // O provedor entrega no teto; reparar antes de qualquer ganho é regra fixa.
    await ff(["-i", trilha, "-af", "adeclip=window=55:overlap=75:arorder=8:threshold=10,alimiter=limit=0.794:level=disabled,aresample=48000", "-c:a", "pcm_s16le", tratada]);
  }
  const master = path.join(T, "master.wav");
  if (!await existe(master)) {
    await exec("node", [CLI, "mix", "--mode", "studio", "--voice", path.join(raiz, "audios/voz.wav"),
      "--music", tratada, "--music-gain", r.trilha.ganhoDb ?? "-5dB",
      "--ducking-threshold", "0.08", "--ducking-ratio", "7", "--fade-out", "0", "--out", master], { maxBuffer: 32 * 1024 * 1024 });
  }
  log("áudio", `trilha ${(await dur(trilha)).toFixed(2)}s · master ${(await dur(master)).toFixed(2)}s · Δ ${((await dur(trilha)) - duracaoVoz).toFixed(2)}s`);
  return master;
}

async function etapaFecho(r, raiz, segundos) {
  const T = path.join(raiz, "videos-unidos/_pecas");
  const fecho = path.join(T, "fecho.mp4");
  if (await existe(fecho)) return fecho;
  const fundo = await acharImagem(path.join(raiz, "marca/fundo"));
  if (!fundo) throw new Error("fundo do fecho ausente");
  // A logo NÃO é redesenhada nem recolorida: o branco sai por chroma e a forma
  // original pousa no fundo do próprio filme.
  if (!r.fecho?.logo) throw new Error("fecho.logo é obrigatório: aponte para o PNG da sua marca");
  const cartao = path.join(T, "cartao.png");
  await ff(["-i", fundo, "-i", path.resolve(r.fecho.logo),
    "-filter_complex", `[0:v]scale=${LARGURA}:${ALTURA},setsar=1[bg];[1:v]colorkey=0xFFFFFF:0.16:0.04,scale=${Math.round(LARGURA * 0.5625)}:-1[lg];[bg][lg]overlay=(W-w)/2:(H-h)/2`,
    "-frames:v", "1", cartao]);
  await ff(["-loop", "1", "-framerate", String(FPS), "-t", String(segundos), "-i", fundo,
    "-loop", "1", "-framerate", String(FPS), "-t", String(segundos), "-i", cartao,
    "-filter_complex", `[0:v]scale=${LARGURA}:${ALTURA},setsar=1,fps=${FPS}[bg];[1:v]scale=${LARGURA}:${ALTURA},setsar=1,fps=${FPS},fade=t=in:st=0:d=0.6:alpha=1[mk];[bg][mk]overlay,fade=t=out:st=${Math.max(0, segundos - 0.8).toFixed(2)}:d=0.8[v]`,
    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS), fecho]);
  return fecho;
}

async function etapaFundoDoFecho(r, raiz) {
  const base = path.join(raiz, "marca", "fundo");
  if (await acharImagem(base)) { log("fecho", "fundo já existe"); return; }
  await mkdir(path.join(raiz, "marca"), { recursive: true });
  await runFlowImage({ prompt: r.fecho.fundoPrompt, out: base + ".png",
    receipt: base + ".flow-attempt.json", "project-url": r.fecho.projectUrl, aspect: r.aspect ?? "16:9", count: 1, timeout: 300_000 });
  log("fecho", "fundo gerado (0 créditos)");
}

export async function produzirReceita(arquivoReceita, { paralelo = 4 } = {}) {
  const receita = validarReceita(JSON.parse(await readFile(path.resolve(arquivoReceita), "utf8")));
  const raiz = path.resolve(receita.saida ?? `outputs/${receita.id}`);
  for (const d of ["metadados", "audios", "imagens", "videos-unidos", "diagnosticos", "marca"]) {
    await mkdir(path.join(raiz, d), { recursive: true });
  }
  console.log(`\n=== ${receita.label} ===`);

  const duracaoVoz = await etapaNarracao(receita, raiz);
  await etapaAlinhamento(receita, raiz);
  const spec = await etapaSpec(receita, raiz, duracaoVoz);
  const jobs = await etapaPrompts(receita, raiz, spec);
  await etapaFundoDoFecho(receita, raiz);
  await etapaImagens(receita, raiz, jobs, paralelo);
  const corpoBruto = await etapaAnimacao(raiz, spec, receita.movimento?.sobreamostragem ?? SOBREAMOSTRAGEM_PADRAO);
  const master = await etapaTrilha(receita, raiz, duracaoVoz);

  const T = path.join(raiz, "videos-unidos/_pecas");
  const dCorpo = await dur(corpoBruto);
  const dMaster = await dur(master);
  const dFecho = +(dMaster - dCorpo).toFixed(2);
  if (dFecho < 1.5) throw new Error(`arremate de ${dFecho}s não comporta o cartão de marca; alongue a trilha ou encurte o roteiro`);

  const corpo = path.join(T, "corpo-abertura.mp4");
  if (!await existe(corpo)) {
    await ff(["-i", corpoBruto, "-an", "-vf", "fade=t=in:st=0:d=0.7", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS), corpo]);
  }
  const fecho = await etapaFecho(receita, raiz, dFecho);

  const lista = path.join(T, "lista-final.txt");
  await writeFile(lista, `file '${corpo.replace(/\\/g, "/")}'\nfile '${fecho.replace(/\\/g, "/")}'\n`, "utf8");
  const mudo = path.join(T, "mudo.mp4");
  if (!await existe(mudo)) await ff(["-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", mudo]);

  const final = path.join(raiz, "videos-unidos", `${receita.id.toUpperCase()}.mp4`);
  if (!await existe(final)) {
    await ff(["-i", mudo, "-i", master, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", final]);
  }
  log("montagem", `${(await dur(final)).toFixed(2)}s`);

  const qa = await qaPeca({ raiz, filme: final, voz: path.join(raiz, "audios/voz.wav"), trilha: path.join(raiz, "audios/trilha.wav") });
  console.log(`QA: ${qa.aprovado ? "APROVADO" : "REPROVADO"}`);
  for (const c of qa.checagens) console.log(`  ${c.ok ? "ok  " : "FALHA"} ${c.nome} — ${c.detalhe}`);
  return { receita: receita.id, filme: final, qa };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  const pega = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
  const alvo = pega("receita");
  if (!alvo) { console.error("uso: node scripts/produzir-receita.mjs --receita recipes/<id>.receita.json [--paralelo 4]"); process.exit(2); }
  const r = await produzirReceita(alvo, { paralelo: Number(pega("paralelo") ?? 4) });
  process.exit(r.qa.aprovado ? 0 : 1);
}
