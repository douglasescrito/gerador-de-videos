#!/usr/bin/env node

/**
 * QA de conferência de uma peça montada.
 *
 * Roda checagens que a máquina consegue provar sozinha e prepara o que só o
 * olho humano resolve. Nada aqui adivinha gosto: ou é um número medido, ou é
 * uma folha de contato para alguém olhar.
 *
 *   node scripts/qa-peca.mjs --raiz outputs/<peca> --filme <mp4> [--voz <wav>] [--trilha <wav>]
 */

import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const QA_SCHEMA = "mkt-videos/qa-peca@1";
export const JANELA_ARREMATE = Object.freeze({ min: 3.0, max: 5.0, ideal: 4.0 });
// Termos vetados pela marca, aplicados a roteiro, tela e prompt. Nasce vazia:
// cada marca declara os seus em marca.palavrasVetadas na receita, e o produtor
// aplica a lista de la antes de gastar qualquer chamada.
export const PALAVRAS_VETADAS = Object.freeze([]);
// Tokens que o modelo já letrou como se fossem arte, medidos em 2026-08-28.
export const VAZAMENTOS_DE_PROMPT = Object.freeze([
  { nome: "codigo hex", padrao: /#[0-9A-Fa-f]{6}\b/ },
  { nome: "palavra de instrucao", padrao: /\b(EXACTLY|RULE|MOTION|SCENE|TYPE|SPELLING)\b/ },
  { nome: "marcador de negativo", padrao: /NEGATIVE AUDIO PROMPT/i },
]);

const ffprobe = async (args) => (await exec("ffprobe", ["-v", "error", ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
const duracao = async (arquivo) => Number(await ffprobe(["-show_entries", "format=duration", "-of", "csv=p=0", arquivo]));

async function existe(f) { try { await access(f); return true; } catch { return false; } }

export function avaliarArremate(duracaoTrilha, duracaoVoz) {
  if (!Number.isFinite(duracaoTrilha) || !Number.isFinite(duracaoVoz)) return null;
  const delta = +(duracaoTrilha - duracaoVoz).toFixed(2);
  const dentro = delta >= JANELA_ARREMATE.min && delta <= JANELA_ARREMATE.max;
  return { delta, dentro, distanciaDoIdeal: +Math.abs(delta - JANELA_ARREMATE.ideal).toFixed(2) };
}

export function conferirSincronia(spec) {
  const cenas = spec?.scenes ?? [];
  let cursor = 0;
  let pior = 0;
  const desvios = [];
  for (const cena of cenas) {
    const desvio = +Math.abs(cursor - cena.span[0]).toFixed(3);
    if (desvio > pior) pior = desvio;
    if (desvio > 0.04) desvios.push({ id: cena.id, esperado: cena.span[0], naTimeline: +cursor.toFixed(3), desvio });
    cursor = +(cursor + (cena.span[1] - cena.span[0])).toFixed(3);
  }
  return { cenas: cenas.length, piorDesvio: pior, forasDeLugar: desvios, totalPlanejado: +cursor.toFixed(2) };
}

/**
 * Regra de marca sobre qualquer texto — roteiro, tela ou prompt.
 *
 * O vazamento de prompt (hex, palavra de instrução, aspas) NÃO entra aqui de
 * propósito: esses tokens vivem legitimamente dentro do prompt, e o defeito é
 * eles aparecerem desenhados na tela. Sem OCR, isso é conferência do olho — a
 * lista viaja no relatório como roteiro de revisão, não como reprovação.
 */
export function conferirTexto(textos) {
  const achados = [];
  for (const { origem, texto } of textos) {
    for (const padrao of PALAVRAS_VETADAS) {
      const m = String(texto).match(padrao);
      if (m) achados.push({ origem, tipo: "palavra vetada pela marca", trecho: m[0] });
    }
  }
  return achados;
}

/**
 * O texto que aparece na tela precisa ser o roteiro inteiro, palavra por
 * palavra. O Whisper devolve um token onde o roteiro tem três ("38" para
 * "trinta e oito") e, sem esta conferência, as palavras sem par saíam do spec
 * em silêncio: a tela dizia "a casa dorme às meia" e nada reprovava.
 */
export function conferirFidelidadeDoTexto(spec, roteiro) {
  const partir = (t) => String(t).trim().split(/\s+/).filter(Boolean);
  const daTela = partir((spec?.scenes ?? []).map((c) => c.text).join(" "));
  const doRoteiro = partir(roteiro);
  const perdidas = [];
  let i = 0;
  for (const palavra of doRoteiro) {
    if (i < daTela.length && daTela[i] === palavra) { i += 1; continue; }
    perdidas.push(palavra);
  }
  const sobrando = daTela.length - (doRoteiro.length - perdidas.length);
  return { palavrasRoteiro: doRoteiro.length, palavrasTela: daTela.length, perdidas, sobrando };
}

async function medirAudio(arquivo) {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-i", arquivo, "-af", "volumedetect", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 }).catch((e) => e);
  const pico = Number((String(stderr).match(/max_volume:\s*(-?[\d.]+) dB/) ?? [])[1]);
  const medio = Number((String(stderr).match(/mean_volume:\s*(-?[\d.]+) dB/) ?? [])[1]);
  return { picoDb: Number.isFinite(pico) ? pico : null, medioDb: Number.isFinite(medio) ? medio : null, clipping: Number.isFinite(pico) && pico > -0.5 };
}

/**
 * Conta quadros idênticos ao anterior. É a assinatura direta do tremor: o
 * zoompan sem sobreamostragem suficiente congela a imagem dois ou três quadros
 * e depois salta um pixel inteiro. O cartão de marca no fim é congelado de
 * propósito, então ele fica de fora da conta — por isso a medição prefere o
 * corpo do filme, e só cai no filme inteiro (sem os últimos segundos) quando o
 * corpo não está mais em disco.
 */
export async function medirCongelamento(arquivo, { pularFinalSegundos = 0 } = {}) {
  const W = 320, H = 180, px = W * H;
  const args = ["-v", "error", "-i", arquivo];
  if (pularFinalSegundos > 0) {
    const d = await duracao(arquivo);
    args.push("-t", String(Math.max(0, d - pularFinalSegundos)));
  }
  args.push("-vf", `scale=${W}:${H},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "-");

  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
    let resto = Buffer.alloc(0);
    let anterior = null, quadros = 0, congelados = 0;
    p.stdout.on("data", (bloco) => {
      resto = resto.length ? Buffer.concat([resto, bloco]) : bloco;
      while (resto.length >= px) {
        const atual = resto.subarray(0, px);
        resto = resto.subarray(px);
        quadros += 1;
        if (anterior) {
          let s = 0;
          for (let i = 0; i < px; i += 1) s += Math.abs(atual[i] - anterior[i]);
          if (s / px < 0.02) congelados += 1;
        }
        anterior = Buffer.from(atual);
      }
    });
    p.on("error", reject);
    p.on("close", (c) => (c === 0
      ? resolve({ quadros, congelados, fracao: quadros > 1 ? congelados / (quadros - 1) : 0 })
      : reject(new Error(`ffmpeg saiu ${c}`))));
  });
}

function lerArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) { o[k] = true; continue; }
    o[k] = v; i += 1;
  }
  return o;
}

export async function qaPeca({ raiz, filme, voz = null, trilha = null, folhaDeContato = true }) {
  const base = path.resolve(raiz);
  const relatorio = { schema: QA_SCHEMA, peca: path.basename(base), geradoEm: new Date().toISOString(), aprovado: true, checagens: [], paraOlhoHumano: [] };
  const falha = (nome, detalhe) => { relatorio.aprovado = false; relatorio.checagens.push({ nome, ok: false, detalhe }); };
  const passa = (nome, detalhe) => relatorio.checagens.push({ nome, ok: true, detalhe });

  // 1. o filme existe e tem o formato de entrega
  const alvo = path.resolve(filme);
  if (!await existe(alvo)) { falha("filme presente", `não encontrei ${alvo}`); return relatorio; }
  const info = await ffprobe(["-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "default=noprint_wrappers=1", alvo]);
  const largura = Number((info.match(/width=(\d+)/) ?? [])[1]);
  const altura = Number((info.match(/height=(\d+)/) ?? [])[1]);
  const temAudio = /codec_name=aac|codec_name=mp3/.test(info);
  const dur = await duracao(alvo);
  relatorio.filme = { arquivo: alvo, duracao: +dur.toFixed(2), largura, altura, temAudio };
  (largura >= 1280 && altura >= 720 ? passa : falha)("resolução de entrega", `${largura}x${altura}`);
  (temAudio ? passa : falha)("trilha de áudio presente", temAudio ? "aac" : "sem faixa de áudio");

  // 2. áudio sem estouro
  const audio = await medirAudio(alvo);
  relatorio.audio = audio;
  (audio.clipping ? falha : passa)("áudio sem clipping", `pico ${audio.picoDb} dB, médio ${audio.medioDb} dB`);

  // 3. regra de ouro do arremate
  if (voz && trilha && await existe(voz) && await existe(trilha)) {
    const arremate = avaliarArremate(await duracao(trilha), await duracao(voz));
    relatorio.arremate = arremate;
    (arremate.dentro ? passa : falha)("arremate na janela 3–5s", `Δ ${arremate.delta}s (ideal ${JANELA_ARREMATE.ideal}s)`);
  }

  // 4. sincronia palavra-a-palavra e regra de marca, a partir do spec
  const specFile = path.join(base, "metadados/spec.json");
  if (await existe(specFile)) {
    const spec = JSON.parse(await readFile(specFile, "utf8"));
    const sinc = conferirSincronia(spec);
    relatorio.sincronia = sinc;
    (sinc.piorDesvio <= 0.04 ? passa : falha)("sincronia com a fala", `pior desvio ${sinc.piorDesvio}s em ${sinc.cenas} cenas`);

    const textos = spec.scenes.map((c) => ({ origem: c.id, texto: c.text }));
    const roteiro = path.join(base, "metadados/roteiro.txt");
    if (await existe(roteiro)) textos.push({ origem: "roteiro", texto: await readFile(roteiro, "utf8") });
    const jobsFile = path.join(base, "metadados/imagem-jobs.json");
    if (await existe(jobsFile)) {
      const { jobs = [] } = JSON.parse(await readFile(jobsFile, "utf8"));
      for (const j of jobs) textos.push({ origem: `${j.id} (prompt)`, texto: j.prompt });
    }
    const achados = conferirTexto(textos);
    relatorio.texto = achados;
    (achados.length === 0 ? passa : falha)("regra de marca", achados.length ? `${achados.length} ocorrência(s)` : "limpo");

    if (await existe(roteiro)) {
      const fid = conferirFidelidadeDoTexto(spec, await readFile(roteiro, "utf8"));
      relatorio.fidelidade = fid;
      (fid.perdidas.length === 0 ? passa : falha)(
        "texto na tela é o roteiro inteiro",
        fid.perdidas.length
          ? `${fid.perdidas.length} palavra(s) sumiram: ${fid.perdidas.slice(0, 8).join(", ")}`
          : `${fid.palavrasTela} palavras, nenhuma perdida`,
      );
    }
  }

  // 5. tremor: quadro congelado no meio do filme denuncia zoompan sem
  // sobreamostragem. O corpo é medido sozinho quando ainda está em disco;
  // senão o filme inteiro menos os últimos 6s, que são o cartão de marca.
  const corpo = path.join(base, "videos-unidos/_pecas/corpo.mp4");
  const temCorpo = await existe(corpo);
  const congel = await medirCongelamento(temCorpo ? corpo : alvo, { pularFinalSegundos: temCorpo ? 0 : 6 });
  relatorio.movimento = { ...congel, medidoEm: temCorpo ? "corpo" : "filme sem o fecho" };
  const pct = (congel.fracao * 100).toFixed(1);
  (congel.fracao <= 0.02 ? passa : falha)(
    "movimento sem tremor",
    `${congel.congelados} quadro(s) congelado(s) em ${congel.quadros} (${pct}%)` +
      (congel.fracao > 0.02 ? " — suba movimento.sobreamostragem na receita" : ""),
  );

  // 5. folha de contato: o que só o olho resolve
  if (folhaDeContato) {
    const diag = path.join(base, "diagnosticos");
    await mkdir(diag, { recursive: true });
    const cenasDir = path.join(base, "videos-soltos");
    const quadros = [];
    if (await existe(cenasDir)) {
      const arquivos = (await readdir(cenasDir)).filter((f) => f.endsWith(".mp4")).sort();
      for (const f of arquivos) {
        const saida = path.join(diag, `qa-${f.replace(".mp4", "")}.png`);
        await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "3.0", "-i", path.join(cenasDir, f), "-frames:v", "1", "-vf", "scale=320:-1", saida]).catch(() => {});
        if (await existe(saida)) quadros.push(saida);
      }
    }
    if (quadros.length) {
      const linhas = Math.ceil(quadros.length / 4);
      const layout = quadros.map((_, i) => (i % 4 === 0 ? (i === 0 ? "0_0" : `0_h0*${Math.floor(i / 4)}`) : `${"w0+".repeat(i % 4).slice(0, -1)}_${i < 4 ? "0" : `h0*${Math.floor(i / 4)}`}`)).join("|");
      const folha = path.join(diag, "QA-FOLHA-DE-CONTATO.png");
      await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...quadros.flatMap((q) => ["-i", q]), "-filter_complex", `${quadros.map((_, i) => `[${i}]`).join("")}xstack=inputs=${quadros.length}:layout=${layout}`, folha]).catch(() => {});
      if (await existe(folha)) {
        relatorio.paraOlhoHumano.push({
          o_que: "conferir cena a cena: grafia e acentos corretos, e nenhum token do prompt desenhado na arte",
          procurar_na_tela: VAZAMENTOS_DE_PROMPT.map((v) => v.nome).concat("aspas em volta da frase"),
          onde: folha, cenas: quadros.length, linhas,
        });
      }
      for (const q of quadros) await exec("cmd", ["/c", "del", "/q", q]).catch(() => {});
    }
  }

  const saida = path.join(base, "diagnosticos", "qa.json");
  await mkdir(path.dirname(saida), { recursive: true });
  await writeFile(saida, JSON.stringify(relatorio, null, 2), "utf8");
  relatorio.relatorio = saida;
  return relatorio;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const o = lerArgs(process.argv.slice(2));
  if (!o.raiz || !o.filme) {
    console.error('uso: node scripts/qa-peca.mjs --raiz outputs/<peca> --filme <mp4> [--voz <wav>] [--trilha <wav>]');
    process.exit(2);
  }
  const r = await qaPeca({ raiz: o.raiz, filme: o.filme, voz: o.voz ?? null, trilha: o.trilha ?? null });
  console.log(r.aprovado ? "QA: APROVADO" : "QA: REPROVADO");
  for (const c of r.checagens) console.log(`  ${c.ok ? "ok  " : "FALHA"} ${c.nome} — ${c.detalhe}`);
  for (const h of r.paraOlhoHumano) console.log(`  olho  ${h.o_que}\n        ${h.onde} (${h.cenas} cenas)`);
  if (r.texto?.length) for (const a of r.texto) console.log(`        ${a.origem}: ${a.tipo} → ${a.trecho}`);
  console.log(`\nrelatório: ${r.relatorio}`);
  process.exit(r.aprovado ? 0 : 1);
}
