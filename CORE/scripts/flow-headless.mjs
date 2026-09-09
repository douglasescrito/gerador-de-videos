#!/usr/bin/env node
import { studioLocalPath } from '../lib/studio-local-config.mjs';

/**
 * Adapter cookie-only do Google Flow (labs.google/fx/tools/flow).
 *
 * Terceiro caminho de mídia do projeto, independente do app empacotado do AI
 * Studio (fora desde 17/08/2026) e do Google Vids. O backend é o
 * `aisandbox-pa.googleapis.com`, e a mesma submissão entrega vídeo pelo
 * `Omni 1.1 Flash` ou imagem pelo `Nano Banana 2`.
 *
 * Três coisas aprendidas na observação de 28/08/2026 e que este arquivo
 * encapsula:
 *
 * 1. A chamada de geração carrega um token reCAPTCHA Enterprise. Por isso o
 *    adapter dirige a página real e deixa que ela emita o próprio token pelo
 *    fluxo normal — não existe cliente HTTP puro para este provedor.
 * 2. O download NÃO pode sair de dentro da página: `media.getMediaUrlRedirect`
 *    responde 307 para outra origem e o `fetch` do documento morre em CORS. O
 *    caminho certo é o request context do Playwright, que leva os cookies.
 * 3. Os rótulos do painel ("Vídeo", "16:9") não são nós folha e não respondem a
 *    clique por texto; quem responde é a ligatura do ícone (`videocam`,
 *    `crop_16_9`). Confundir isso gera no modo errado e gasta crédito à toa —
 *    por isso o adapter confere o custo anunciado antes de submeter.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { assertPathAvailable, writeJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { commitNewFileAtomically } from "./omni-product-studio-submit.mjs";

const execFileAsync = promisify(execFile);

export const FLOW_ATTEMPT_SCHEMA = "google-flow-attempt@1";
export const FLOW_VIDEO_MODEL = "flow-omni-1.1-flash";
export const FLOW_IMAGE_MODEL = "flow-nano-banana-2";
export const FLOW_CREDENTIAL_SERVICE = "GoogleLabsFlow";
export const FLOW_HOME = "https://labs.google/fx/pt/tools/flow";
export const FLOW_PROJECT_PREFIX = "https://labs.google/fx/pt/tools/flow/project/";
export const FLOW_GENERATE_MARKER = "flowMedia:batchGenerate";
export const FLOW_ASPECTS = Object.freeze({ "16:9": "crop_16_9", "9:16": "crop_9_16" });
export const FLOW_RESOLUTIONS = Object.freeze(["360p", "720p"]);
export const FLOW_DURATIONS = Object.freeze([4, 6, 8, 10]);
export const FLOW_MAX_COUNT = 4;

const DEFAULT_CHROME = studioLocalPath('chromePath') ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CREDENTIAL_SCRIPT = path.join(import.meta.dirname, "credential-cookies.ps1");

/** URL de download de uma mídia do Flow, a partir do id devolvido pela geração. */
export function flowMediaUrl(mediaName) {
  const name = String(mediaName ?? "").trim();
  if (!name) throw new Error("mediaName é obrigatório.");
  return `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(name)}`;
}

function stripAntiHijackPrefix(text) {
  const value = String(text ?? "");
  if (!value.startsWith(")]}'")) return value;
  const newline = value.indexOf("\n");
  return newline === -1 ? "" : value.slice(newline + 1);
}

function generatedNode(entry) {
  return entry?.video?.generatedVideo ?? entry?.image?.generatedImage ?? null;
}

/**
 * Lê a resposta de `flowMedia:batchGenerate*`. Cada item traz o id da mídia, o
 * workflow em que ela nasceu e o que o provedor entendeu do pedido.
 */
export function parseFlowMediaResponse(rawText) {
  let payload = null;
  try { payload = JSON.parse(stripAntiHijackPrefix(rawText)); } catch { return []; }
  const media = Array.isArray(payload?.media) ? payload.media : [];
  return media
    .map((entry) => {
      const gerado = generatedNode(entry);
      return {
        name: entry?.name ?? null,
        workflowId: entry?.workflowId ?? gerado?.workflowId ?? null,
        kind: entry?.video ? "video" : entry?.image ? "image" : null,
        seed: gerado?.seed ?? null,
        prompt: gerado?.prompt ?? null,
        modelNameType: gerado?.modelNameType ?? null,
        fifeUrl: gerado?.fifeUrl ?? null,
      };
    })
    .filter((entry) => entry.name);
}

/** Extrai o número da linha "A geração vai usar N créditos". */
export function parseFlowCreditsLine(text) {
  const match = String(text ?? "").match(/vai usar\s+([\d.]+)\s+cr[ée]dito/i);
  if (!match) return null;
  const valor = Number(match[1].replace(/\./g, ""));
  return Number.isFinite(valor) ? valor : null;
}

/**
 * O Flow substitui o botão de envio por um alerta quando o saldo da conta não
 * cobre a configuração escolhida. Detectar essa mensagem antes de procurar o
 * botão evita classificar falta de cota como mudança de seletor da interface.
 */
export function parseFlowAvailabilityError(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (/não há cr[ée]ditos(?: de IA e do Google Flow)? suficientes/i.test(value)) {
    return "Cota insuficiente no Google Flow para esta geração. Nenhuma submissão foi realizada.";
  }
  return null;
}

export function resolveFlowAspect(aspect = "16:9") {
  const normalizado = String(aspect ?? "16:9").trim();
  const icone = FLOW_ASPECTS[normalizado];
  if (!icone) throw new Error(`O Flow só aceita ${Object.keys(FLOW_ASPECTS).join(" ou ")}; recebido: ${normalizado || "(vazio)"}.`);
  return { aspect: normalizado, icone };
}

export function resolveFlowResolution(resolution = "720p") {
  const normalizado = String(resolution ?? "720p").trim().toLowerCase();
  if (!FLOW_RESOLUTIONS.includes(normalizado)) {
    throw new Error(`Resolução inválida no Flow: ${normalizado || "(vazio)"}. Use ${FLOW_RESOLUTIONS.join(" ou ")}.`);
  }
  return normalizado;
}

export function resolveFlowDuration(duration = 8) {
  const numero = Number(duration ?? 8);
  if (!FLOW_DURATIONS.includes(numero)) {
    throw new Error(`Duração inválida no Flow: ${duration}. Use ${FLOW_DURATIONS.join(", ")} segundos.`);
  }
  return numero;
}

export function resolveFlowCount(count = 1) {
  const numero = Number(count ?? 1);
  if (!Number.isInteger(numero) || numero < 1 || numero > FLOW_MAX_COUNT) {
    throw new Error(`Quantidade inválida no Flow: ${count}. Use um inteiro de 1 a ${FLOW_MAX_COUNT}.`);
  }
  return numero;
}

/** Nomes de saída para um lote: o primeiro usa --out, os demais ganham sufixo. */
export function flowOutputPaths(outputFile, count) {
  const alvo = path.resolve(outputFile);
  const extensao = path.extname(alvo);
  const base = extensao ? alvo.slice(0, -extensao.length) : alvo;
  return Array.from({ length: count }, (_, indice) => (indice === 0 ? alvo : `${base}-${indice + 1}${extensao}`));
}

export async function loadFlowCookies({ service = FLOW_CREDENTIAL_SERVICE } = {}) {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", CREDENTIAL_SCRIPT,
    "-Mode", "Get", "-Service", service,
  ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const encoded = stdout.trim();
  if (!encoded) throw new Error(`Cookies para ${service} ausentes no Gerenciador de Credenciais.`);
  const cookies = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (!Array.isArray(cookies) || !cookies.length) throw new Error(`Cookies para ${service} vazios.`);
  return cookies;
}

function requireProjectUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return null;
  if (!url.startsWith(FLOW_PROJECT_PREFIX)) {
    throw new Error(`--project-url deve apontar para um projeto do Flow (${FLOW_PROJECT_PREFIX}...) ou ser omitido para criar um projeto novo.`);
  }
  return url;
}

/**
 * Faixa vertical do painel de opções. Ela existe porque ligaturas como
 * `crop_16_9` aparecem duas vezes: no painel e dentro do chip do compositor.
 * Clicar na cópia do chip fecha o painel em vez de escolher a opção — foi o que
 * fez a trava de custo disparar sem motivo aparente.
 */
export const FLOW_PANEL_BAND = Object.freeze({ minY: 400, maxY: 920 });

const leafByText = (page, alvo, banda = FLOW_PANEL_BAND) => page.evaluate(([texto, y0, y1]) => {
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length) continue;
    if ((el.innerText || "").trim() !== texto) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const centro = r.y + r.height / 2;
    if (centro < y0 || centro > y1) continue;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(centro) };
  }
  return null;
}, [alvo, banda.minY, banda.maxY]);

const controls = (page) => page.evaluate(() => {
  const out = []; const seen = new Set();
  for (const el of document.querySelectorAll("button,[role='button'],[role='tab'],[role='menuitem'],textarea,[contenteditable='true']")) {
    const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 90) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (seen.has(label)) continue; seen.add(label);
    out.push({ label, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  return out;
});

async function clickLeaf(page, alvo, banda = FLOW_PANEL_BAND) {
  const ponto = await leafByText(page, alvo, banda);
  if (!ponto) return false;
  await page.mouse.click(ponto.x, ponto.y);
  await page.waitForTimeout(1200);
  return true;
}

/**
 * O número de créditos é um link dentro da frase, então a linha não é um nó
 * folha: pegamos o menor elemento que contém a frase inteira.
 */
export const FLOW_MAX_REFERENCIAS = 3;

/**
 * Anexa imagens de referência pelo painel "Ingredientes" do compositor.
 *
 * É o equivalente do `reference_to_video` do Omni do AI Studio: em peça com
 * rosto real, a foto precisa entrar em TODOS os planos, senão a pessoa muda
 * entre um corte e outro. O painel aceita até três.
 *
 * Falha fechado de propósito: gerar sem a referência anexada produz um
 * estranho no lugar da pessoa, e isso custa crédito para descobrir depois.
 */
async function anexarReferencias(page, arquivos) {
  if (!arquivos.length) return 0;
  if (arquivos.length > FLOW_MAX_REFERENCIAS) {
    throw new Error(`O painel do Flow aceita no máximo ${FLOW_MAX_REFERENCIAS} referências; recebidas ${arquivos.length}.`);
  }
  const abriu = await clickLeaf(page, "Ingredientes", { minY: 400, maxY: 980 });
  if (!abriu) throw new Error("Botão Ingredientes não encontrado no compositor; nenhuma referência foi anexada.");
  await page.waitForTimeout(2500);

  const entrada = page.locator("input[type='file']").last();
  await entrada.waitFor({ state: "attached", timeout: 15_000 }).catch(() => {
    throw new Error("O seletor de arquivo dos Ingredientes não apareceu.");
  });
  await entrada.setInputFiles(arquivos.map((a) => path.resolve(a)));
  await page.waitForTimeout(6_000);

  // Confere que o painel realmente registrou as imagens antes de submeter.
  const anexadas = await page.evaluate(() => {
    const painel = [...document.querySelectorAll("*")].find((e) => /Ingredientes/i.test(e.innerText ?? "") && e.getBoundingClientRect().width < 700);
    if (!painel) return 0;
    return painel.querySelectorAll("img[src]:not([src=''])").length;
  });
  if (anexadas < arquivos.length) {
    throw new Error(`O Flow confirmou ${anexadas} de ${arquivos.length} referência(s); nenhuma geração foi submetida.`);
  }
  return anexadas;
}

async function readAnnouncedCredits(page) {
  const linha = await page.evaluate(() => {
    let melhor = null;
    for (const el of document.querySelectorAll("*")) {
      const texto = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!/vai usar\s+[\d.]+\s+cr[ée]dito/i.test(texto)) continue;
      if (texto.length > 120) continue;
      if (melhor === null || texto.length < melhor.length) melhor = texto;
    }
    return melhor;
  });
  return { linha, creditos: parseFlowCreditsLine(linha) };
}

/** Fecha o painel do agente e desliga a pílula, deixando o compositor clássico. */
async function ensureClassicComposer(page) {
  const fechar = (await controls(page)).find((c) => /^closeFechar$/i.test(c.label) && c.y < 200);
  if (fechar) { await page.mouse.click(fechar.x, fechar.y); await page.waitForTimeout(3000); }
  const chipVisivel = async () => (await controls(page)).find((c) => c.y > 900 && /nano banana|veo|omni|v[ií]deo|imagem/i.test(c.label));
  let chip = await chipVisivel();
  if (!chip) {
    const pilula = (await controls(page)).find((c) => /^Agente$/i.test(c.label));
    if (pilula) { await page.mouse.click(pilula.x, pilula.y); await page.waitForTimeout(4000); }
    chip = await chipVisivel();
  }
  if (!chip) throw new Error("O compositor clássico do Flow não apareceu; o modo Agente pode ter mudado de lugar.");
  return chip;
}

async function openProject(context, projectUrl) {
  const page = await context.newPage();
  if (projectUrl) {
    await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(13_000);
    return page;
  }
  await page.goto(FLOW_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(9_000);
  const novo = (await controls(page)).find((c) => /Novo projeto/i.test(c.label));
  if (!novo) throw new Error("Botão 'Novo projeto' não encontrado na home do Flow.");
  await page.mouse.click(novo.x, novo.y);
  await page.waitForTimeout(13_000);
  return page;
}

/** Extensão real do arquivo, para não gravar JPEG dentro de um .png. */
export function resolveMediaPath(destino, contentType) {
  const tipo = String(contentType ?? "").toLowerCase();
  const correta = tipo.includes("video/mp4") ? ".mp4"
    : tipo.includes("image/png") ? ".png"
    : tipo.includes("image/jpeg") ? ".jpg"
    : tipo.includes("image/webp") ? ".webp"
    : null;
  const alvo = path.resolve(destino);
  if (!correta) return alvo;
  const atual = path.extname(alvo).toLowerCase();
  if (atual === correta || (correta === ".jpg" && atual === ".jpeg")) return alvo;
  return `${atual ? alvo.slice(0, -atual.length) : alvo}${correta}`;
}

/**
 * O objeto no CDN nem sempre está pronto no instante em que o provedor devolve
 * o id; a primeira tentativa pode falhar em rede. Repetimos algumas vezes e
 * nunca deixamos o erro cru do Playwright vazar — o log dele imprime a sessão.
 */
/**
 * Ids de mídia visíveis no projeto agora. A imagem volta no corpo da própria
 * submissão, mas o vídeo é assíncrono e só aparece depois — por isso a espera
 * observa o DOM, que serve aos dois casos sem depender do formato da API.
 */
export function mediaIdsFromSources(sources = []) {
  const ids = [];
  for (const src of sources) {
    const texto = String(src ?? "");
    if (!texto.includes("getMediaUrlRedirect")) continue;
    if (texto.includes("THUMBNAIL")) continue;
    const match = texto.match(/[?&]name=([^&]+)/);
    if (match) ids.push(decodeURIComponent(match[1]));
  }
  return [...new Set(ids)];
}

const mediaIdsOnPage = async (page) => mediaIdsFromSources(await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("video, video source, img")) {
    const src = el.currentSrc || el.src || el.getAttribute("src") || "";
    if (src) out.push(src);
    const poster = el.getAttribute("poster");
    if (poster) out.push(poster);
  }
  return out;
}));

async function downloadMedia(context, mediaName, referer, { tentativas = 4, esperaMs = 4000 } = {}) {
  let ultimoMotivo = "desconhecido";
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      const resposta = await context.request.get(flowMediaUrl(mediaName), { headers: referer ? { referer } : {} });
      if (!resposta.ok()) {
        ultimoMotivo = `HTTP ${resposta.status()}`;
      } else {
        const contentType = String(resposta.headers()["content-type"] ?? "");
        const bytes = Buffer.from(await resposta.body());
        if (bytes.length) return { bytes, contentType };
        ultimoMotivo = "corpo vazio";
      }
    } catch (error) {
      ultimoMotivo = String(error?.message ?? error).split("\n")[0].slice(0, 160);
    }
    if (tentativa < tentativas) await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }
  throw new Error(`Download da mídia ${mediaName} falhou após ${tentativas} tentativas: ${ultimoMotivo}.`);
}

function assertKind(contentType, esperado, mediaName) {
  const tipo = String(contentType).toLowerCase();
  if (esperado === "video" && !tipo.includes("video")) {
    throw new Error(`A mídia ${mediaName} não é vídeo (Content-Type ${tipo || "ausente"}); o painel provavelmente estava em modo imagem.`);
  }
  if (esperado === "image" && !tipo.includes("image")) {
    throw new Error(`A mídia ${mediaName} não é imagem (Content-Type ${tipo || "ausente"}).`);
  }
}

/**
 * Roda uma geração no Flow e devolve os arquivos já em disco.
 *
 * @param {"video"|"image"} kind
 */
async function runFlow(kind, options = {}) {
  if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Google Flow real é proibido em NODE_ENV=test.");
  const prompt = String(options.prompt ?? "").trim();
  if (!prompt) throw new Error("--prompt é obrigatório.");
  const projectUrl = requireProjectUrl(options["project-url"] ?? options.projectUrl);
  const aspect = resolveFlowAspect(options.aspect ?? "16:9");
  const count = resolveFlowCount(options.count ?? 1);
  const resolution = kind === "video" ? resolveFlowResolution(options.resolution ?? "720p") : null;
  const duration = kind === "video" ? resolveFlowDuration(options.duration ?? 8) : null;
  const referencias = []
    .concat(options.references ?? options.referencias ?? [])
    .filter(Boolean)
    .map((a) => path.resolve(String(a)));
  const outputFile = path.resolve(options.out ?? (kind === "video" ? "outputs/flow/clipe.mp4" : "outputs/flow/imagem.png"));
  const receiptPath = path.resolve(options.receipt ?? `${outputFile}.flow-attempt.json`);
  const timeoutMs = Number(options.timeout ?? 420_000);
  const chrome = options.chrome ?? DEFAULT_CHROME;
  const destinos = flowOutputPaths(outputFile, count);

  for (const destino of destinos) await assertPathAvailable(destino, "Mídia do Google Flow");
  await assertPathAvailable(receiptPath, "Recibo do Google Flow");

  const cookies = await loadFlowCookies();
  const startedAt = new Date().toISOString();
  let browser = null;
  let context = null;
  let submitted = false;
  let midias = [];
  let creditos = null;

  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-background-networking"] });
    context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1600, height: 1000 } });
    await context.addCookies(cookies);
    const page = await openProject(context, projectUrl);
    const projetoAtual = page.url();
    if (/accounts\.google\.com|signin|\/login/i.test(projetoAtual)) throw new Error("A sessão de cookies não autenticou no Google Flow.");

    page.on("response", async (res) => {
      if (!res.url().includes(FLOW_GENERATE_MARKER) || midias.length) return;
      const entradas = await res.text().then(parseFlowMediaResponse).catch(() => []);
      if (entradas.length) midias = entradas;
    });

    const chip = await ensureClassicComposer(page);
    await page.mouse.click(chip.x, chip.y);
    await page.waitForTimeout(3000);

    // O rótulo textual não é clicável; a ligatura do ícone é.
    if (!await clickLeaf(page, kind === "video" ? "videocam" : "image")) {
      throw new Error("O painel de opções do Flow não abriu; nada foi submetido.");
    }
    await clickLeaf(page, aspect.icone);
    if (kind === "video") {
      await clickLeaf(page, resolution);
      await clickLeaf(page, `${duration}s`);
    }
    await clickLeaf(page, `x${count}`);
    await page.waitForTimeout(1200);

    let referenciasAnexadas = 0;
    if (referencias.length) {
      referenciasAnexadas = await anexarReferencias(page, referencias);
      console.log(JSON.stringify({ stage: "references-attached", count: referenciasAnexadas }));
      await page.waitForTimeout(1200);
    }

    const anunciado = await readAnnouncedCredits(page);
    creditos = anunciado.creditos;
    if (kind === "video" && !(creditos > 0)) {
      throw new Error(`O painel do Flow não confirmou modo vídeo (custo anunciado: ${anunciado.linha ?? "ausente"}). Nada foi submetido.`);
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    const campo = (await controls(page)).find((c) => /quer criar/i.test(c.label));
    if (!campo) throw new Error("Campo de comando do Flow não encontrado.");
    await page.mouse.click(campo.x, campo.y);
    await page.waitForTimeout(800);
    await page.keyboard.insertText(prompt);
    await page.waitForTimeout(1800);

    let availabilityError = parseFlowAvailabilityError(await page.locator("body").innerText());
    let enviar = (await controls(page)).find((c) => /^arrow_forwardCriar$/i.test(c.label));
    if (!availabilityError && !enviar) {
      const alerta = page.locator("i.google-symbols").filter({ hasText: /^info$/ }).last();
      if (await alerta.isVisible().catch(() => false)) {
        await alerta.hover();
        await page.waitForTimeout(500);
        availabilityError = parseFlowAvailabilityError(await page.locator("body").innerText());
      }
    }
    if (availabilityError) throw new Error(availabilityError);

    enviar = enviar ?? (await controls(page)).find((c) => /^arrow_forwardCriar$/i.test(c.label));
    if (!enviar) throw new Error("Botão de envio do Flow não encontrado.");
    const antesDaSubmissao = new Set(await mediaIdsOnPage(page));
    submitted = true;
    await page.mouse.click(enviar.x, enviar.y);
    console.log(JSON.stringify({ stage: "submitted", provider: `google-flow-${kind}`, retryAllowed: false, creditosAnunciados: creditos }));

    const prazo = Date.now() + timeoutMs;
    while (Date.now() < prazo && midias.length < count) {
      await page.waitForTimeout(4000);
      if (midias.length >= count) break;
      const novos = (await mediaIdsOnPage(page)).filter((id) => !antesDaSubmissao.has(id));
      if (novos.length >= count) {
        midias = novos.slice(0, count).map((name) => ({ name, workflowId: null, kind, seed: null, prompt: null, modelNameType: null, fifeUrl: null }));
      }
    }

    if (!midias.length) {
      await writeJsonAtomic(receiptPath, {
        schema: FLOW_ATTEMPT_SCHEMA, status: "ambiguous", kind, submitted, retryAllowed: false,
        startedAt, completedAt: new Date().toISOString(),
        authSource: "windows-credential-manager", projectUrl: projetoAtual,
        aspect: aspect.aspect, resolution, duration, count, creditosAnunciados: creditos, timeoutMs,
      }, { label: "Recibo do Google Flow" });
      throw new Error("A geração foi submetida uma vez, mas o provedor não devolveu mídia no prazo. Estado ambíguo; repetição automática bloqueada.");
    }

    const arquivos = [];
    for (const [indice, midia] of midias.slice(0, count).entries()) {
      const { bytes, contentType } = await downloadMedia(context, midia.name, projetoAtual);
      assertKind(contentType, kind, midia.name);
      const destino = resolveMediaPath(destinos[indice], contentType);
      await assertPathAvailable(destino, "Mídia do Google Flow");
      await commitNewFileAtomically(destino, bytes, "Mídia do Google Flow");
      arquivos.push({ file: destino, bytes: bytes.length, contentType, mediaName: midia.name, workflowId: midia.workflowId, seed: midia.seed, modelNameType: midia.modelNameType });
    }

    const receipt = {
      schema: FLOW_ATTEMPT_SCHEMA, status: "succeeded", kind, submitted: true, retryAllowed: false,
      startedAt, completedAt: new Date().toISOString(),
      authSource: "windows-credential-manager", projectUrl: projetoAtual,
      model: kind === "video" ? FLOW_VIDEO_MODEL : FLOW_IMAGE_MODEL,
      aspect: aspect.aspect, resolution, duration, count,
      referencias: referencias.map((a) => path.basename(a)),
      creditosAnunciados: creditos, visibleWatermark: null, media: arquivos,
    };
    await writeJsonAtomic(receiptPath, receipt, { label: "Recibo do Google Flow" });
    console.log(JSON.stringify({ ok: true, arquivos: arquivos.map((a) => a.file), receipt: receiptPath, creditos }, null, 2));
    return {
      file: arquivos[0].file, files: arquivos.map((a) => a.file), receiptFile: receiptPath, receipt,
      model: receipt.model, aspect: aspect.aspect, resolution, duration, count,
      creditos, media: arquivos, referencias, projectUrl: projetoAtual, startedAt, completedAt: receipt.completedAt,
    };
  } catch (error) {
    if (error && typeof error === "object") error.submitted = submitted;
    throw error;
  } finally {
    await Promise.allSettled([context?.close(), browser?.close()].filter(Boolean));
  }
}

export const runFlowVideo = (options = {}) => runFlow("video", options);
export const runFlowImage = (options = {}) => runFlow("image", options);

function readOptions(argv) {
  const options = {};
  for (let indice = 0; indice < argv.length; indice += 1) {
    const token = argv[indice];
    if (!token.startsWith("--")) continue;
    const chave = token.slice(2);
    const proximo = argv[indice + 1];
    if (proximo === undefined || proximo.startsWith("--")) { options[chave] = true; continue; }
    options[chave] = proximo;
    indice += 1;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [comando = "video", ...resto] = process.argv.slice(2);
  const executar = comando === "image" ? runFlowImage : runFlowVideo;
  executar(readOptions(comando === "image" || comando === "video" ? resto : process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
