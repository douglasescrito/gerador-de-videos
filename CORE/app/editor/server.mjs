import { discoverEditorCollections } from "./editor-collections.mjs";
import http from "node:http";
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { servirArquivo } from './acervo-stream.mjs';
import { recipeRoutes } from './receitas-routes.mjs';
import { generatorRoutes } from './gerador-routes.mjs';
import { editorReconstructionRoutes, resolveOutputFile } from './editor-reconstruction.mjs';
import { listarFavoritos, salvarFavorito } from './acervo-favorites.mjs';
import { medirMidia } from './acervo-metadata.mjs';
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { runFfmpeg, probeMedia } from "../../lib/media-pipeline/media-tools.mjs";
import { CORE_DIR, buscarPorPrompt, catalogoParaGrade, dossieCompleto, atualizarCatalogo, dossie, miniatura, resolverArquivo } from "./acervo.mjs";

// O servidor precisa achar o CORE mesmo quando é aberto por um atalho da área
// de trabalho, onde o diretório atual não é o do projeto.
const ROOT_DIR = CORE_DIR;
const OUTPUTS_DIR = path.join(CORE_DIR, "outputs");
const PORT = 5599;
const compactar = promisify(gzip);
let respostaGrade;

function prepararRespostaGrade() {
  const payload = catalogoParaGrade();
  if (respostaGrade?.payload === payload) return respostaGrade;
  const json = JSON.stringify(payload);
  respostaGrade = { payload, json, gzip: null };
  return respostaGrade;
}
const servirReceitas = recipeRoutes({ recipesDir: path.join(CORE_DIR, 'recipes') });
const servirGerador = generatorRoutes({ coreDir: CORE_DIR });
const servirReconstrucao = editorReconstructionRoutes({ coreDir: CORE_DIR });

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".json": "application/json",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

const privateEditorUrl = new URL('./legacy-editor-content.mjs', import.meta.url);
let privateEditor = null;
try {
  const info = fs.lstatSync(privateEditorUrl);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Conteúdo legado do editor deve ser arquivo regular.');
  privateEditor = await import(privateEditorUrl.href);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const WHISPER_TIMESTAMPS = privateEditor?.WHISPER_TIMESTAMPS ?? [];
async function discoverProjects() {
  return privateEditor ? privateEditor.discoverProjects() : discoverEditorCollections(ROOT_DIR);
}

/**
 * Converte um array de keyframes [{time, db}] em uma expressão de volume contínua para o FFmpeg.
 */
function buildFfmpegVolumeExpression(keyframes, defaultGainDb = 0) {
  if (!keyframes || keyframes.length === 0) {
    const lin = Math.pow(10, defaultGainDb / 20);
    return `${lin.toFixed(4)}`;
  }

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length === 1) {
    const lin = Math.pow(10, sorted[0].db / 20);
    return `${lin.toFixed(4)}`;
  }

  // Gera interpolação linear por trechos: if(between(t, t0, t1), v0 + (t-t0)*(v1-v0)/(t1-t0), ...)
  const clauses = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    const v0 = Math.pow(10, p0.db / 20);
    const v1 = Math.pow(10, p1.db / 20);
    const dt = Math.max(0.001, p1.time - p0.time);
    const dv = v1 - v0;

    const expr = `(${v0.toFixed(4)}+((t-${p0.time.toFixed(3)})*${dv.toFixed(4)}/${dt.toFixed(3)}))`;
    clauses.push(`between(t,${p0.time.toFixed(3)},${p1.time.toFixed(3)})*${expr}`);
  }

  // Cláusula antes do primeiro ponto e depois do último
  const firstVal = Math.pow(10, sorted[0].db / 20).toFixed(4);
  const lastVal = Math.pow(10, sorted[sorted.length - 1].db / 20).toFixed(4);
  const beforeFirst = `lt(t,${sorted[0].time.toFixed(3)})*${firstVal}`;
  const afterLast = `gte(t,${sorted[sorted.length - 1].time.toFixed(3)})*${lastVal}`;

  return `${beforeFirst}+${clauses.join("+")}+${afterLast}`;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/api/studio-health') {
    const allowed = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
    if (req.method !== 'GET' || !allowed.has(`http://${req.headers.host}`) || (req.headers.origin && !allowed.has(req.headers.origin))) {
      res.writeHead(403); return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ schema: 'mkt-videos/local-studio-health@1', coreDir: path.resolve(ROOT_DIR) }));
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (pathname === '/') {
    res.writeHead(302, { Location: `/acervo${parsedUrl.search}`, 'Cache-Control': 'no-store' });
    return res.end();
  }

  const paginasStudio = { '/home': 'home.html', '/home/': 'home.html', '/acervo': 'acervo.html', '/acervo/': 'acervo.html', '/receitas': 'receitas.html', '/receitas/': 'receitas.html' };
  if (Object.hasOwn(paginasStudio, pathname)) return servirArquivo(req, res, path.join(ROOT_DIR, 'app/editor', paginasStudio[pathname]), 'text/html; charset=utf-8', 'private, no-cache');
  if (pathname === '/gerador' || pathname === '/gerador/') return servirArquivo(req, res, path.join(ROOT_DIR, 'app/editor/gerador.html'), 'text/html; charset=utf-8', 'private, no-cache');
  if (await servirGerador(req, res, parsedUrl)) return;
  if (await servirReceitas(req, res, parsedUrl)) return;
  if (await servirReconstrucao(req, res, parsedUrl)) return;
  if ((pathname === '/editor' || pathname === '/editor/') && parsedUrl.searchParams.get('experimental') === '1') return servirArquivo(req, res, path.join(ROOT_DIR, 'app/editor/editor-experimental.html'), 'text/html; charset=utf-8', 'private, no-cache');

  // Sinal de vida barato: o lançador pergunta isso antes de subir outro
  // processo, e a varredura do acervo custaria meio segundo à toa.
  if (pathname === "/api/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, servico: "acervo" }));
  }

  if (pathname === "/api/desligar" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => process.exit(0), 120);
    return;
  }

  if (pathname === "/api/acervo") {
    const forcar = parsedUrl.searchParams.get("reindexar") === "1";
    try {
      await atualizarCatalogo({ forcar });
      const pronta = prepararRespostaGrade();
      let body = pronta.json;
      const headers = { "Content-Type": "application/json; charset=utf-8", 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        pronta.gzip ||= compactar(pronta.json).catch(error => { pronta.gzip = null; throw error; });
        body = await pronta.gzip;
        headers['Content-Encoding'] = 'gzip';
      }
      headers['Content-Length'] = Buffer.byteLength(body);
      res.writeHead(200, headers);
      return res.end(body);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Índice temporariamente indisponível.' }));
    }
  }

  if (pathname === '/api/acervo/favoritos') {
    try {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ favorites: await listarFavoritos() }));
      }
      if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json')) {
        res.writeHead(405); return res.end();
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) { res.writeHead(413); return res.end(); }
      }
      const result = await salvarFavorito(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Não foi possível atualizar os favoritos.' }));
    }
  }
  if (pathname === "/api/acervo/metadata") {
    const info = await medirMidia(parsedUrl.searchParams.get('source'), parsedUrl.searchParams.get('rel'));
    res.writeHead(info ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(info || { status: 'missing' }));
  }
  if (pathname === "/api/acervo/buscar-prompt") {
    const resultado = buscarPorPrompt(parsedUrl.searchParams.get("q"));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(resultado));
  }
  if (pathname === "/api/acervo/dossie") {
    const info = dossieCompleto(parsedUrl.searchParams.get("source"), parsedUrl.searchParams.get("rel"));
    if (!info) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ erro: "Vídeo não encontrado." }));
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(info));
  }

  if (pathname === "/api/acervo/miniatura") {
    const arquivo = await miniatura(parsedUrl.searchParams.get("source"), parsedUrl.searchParams.get("rel"));
    if (!arquivo) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("sem miniatura");
    }
    return servirArquivo(req, res, arquivo, "image/jpeg", "private, max-age=86400");
  }

  if (pathname === "/api/acervo/abrir-pasta" && req.method === "POST") {
    let corpo = "";
    req.on("data", (parte) => { corpo += parte; });
    req.on("end", () => {
      try {
        const { source, rel } = JSON.parse(corpo);
        const absoluto = resolverArquivo(source, rel);
        if (!absoluto) throw new Error("Vídeo não encontrado.");
        exec(`explorer /select,"${absoluto}"`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (erro) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ erro: String(erro.message ?? erro) }));
      }
    });
    return;
  }

  // Mídia de qualquer raiz declarada, com range para o player poder buscar.
  if (pathname.startsWith("/midia/")) {
    const resto = pathname.slice("/midia/".length);
    const corte = resto.indexOf("/");
    const absoluto = corte < 0 ? null : resolverArquivo(resto.slice(0, corte), resto.slice(corte + 1));
    if (!absoluto) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Vídeo não encontrado.");
    }
    return servirArquivo(req, res, absoluto, getMimeType(absoluto));
  }

  // 1. API: Listar Projetos & Receitas
  if (pathname === "/api/projects") {
    const projects = await discoverProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ projects, whisperWords: WHISPER_TIMESTAMPS }));
  }

  // 2. API: Abrir Pasta no Windows
  if (pathname === "/api/open-folder" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { folderRel } = JSON.parse(body || "{}");
        const full = path.resolve(ROOT_DIR, folderRel || "outputs");
        exec(`explorer.exe "${full}"`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, opened: full }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 2.5 API: Detectar Picos e Nivelar Trilha Automaticamente
  if (pathname === "/api/detect-surges") {
    try {
      const { detectAndCalculateAntiSurgeCurve } = await import("../../lib/media-pipeline/intelligent-music-leveler.mjs");
      const projectId = parsedUrl.searchParams.get('projectId');
      const project = (await discoverProjects()).find(entry => entry.id === projectId);
      if (!project?.audioMusic) throw new Error('Selecione uma coleção com trilha própria.');
      const musicFile = (await resolveOutputFile(OUTPUTS_DIR, path.relative(OUTPUTS_DIR, path.resolve(ROOT_DIR, project.audioMusic)))).file;
      const resAnalysis = await detectAndCalculateAntiSurgeCurve({ musicFile });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, ...resAnalysis }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // 3. API: Renderizar Master com Automação de Keyframes
  if (pathname === "/api/render" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { projectId, videoRawRel, voiceKeyframes, musicKeyframes, sfxKeyframes, outName } = payload;

        const project = (await discoverProjects()).find(entry => entry.id === projectId);
        if (!project?.videoRawRel || !project.audioVoice || !project.audioMusic || project.videoRawRel !== videoRawRel) throw new Error('A coleção exige vídeo bruto, voz e trilha próprios.');
        const resolveInput = async relative => (await resolveOutputFile(OUTPUTS_DIR, path.relative(OUTPUTS_DIR, path.resolve(ROOT_DIR, relative)))).file;
        const videoFile = await resolveInput(project.videoRawRel);
        const voiceFile = await resolveInput(project.audioVoice);
        const musicFile = await resolveInput(project.audioMusic);

        const voiceVolExpr = buildFfmpegVolumeExpression(voiceKeyframes, 5);
        const musicVolExpr = buildFfmpegVolumeExpression(musicKeyframes, 8);
        const sfxVolExpr = buildFfmpegVolumeExpression(sfxKeyframes, -10);

        const outDir = path.resolve(ROOT_DIR, "outputs/render-custom-editor");
        fs.mkdirSync(outDir, { recursive: true });
        const outputName = outName || `master-editor-${Date.now()}`;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(outputName)) throw new Error('Nome de saída inválido.');
        const outputMp4 = path.join(outDir, `${outputName}.mp4`);

        // Filtro complexo com volume por keyframes
        const filterComplex = [
          `[1:a]volume=eval=frame:volume='${voiceVolExpr}'[v_kf]`,
          `[2:a]volume=eval=frame:volume='${musicVolExpr}'[m_kf]`,
          `[0:a]volume=eval=frame:volume='${sfxVolExpr}'[s_kf]`,
          `[v_kf][m_kf][s_kf]amix=inputs=3:duration=first:dropout_transition=0,alimiter=limit=0.98[aout]`
        ].join(";");

        console.log(`🎬 Renderizando Master Customizado com Keyframes: ${outputMp4}`);

        await runFfmpeg([
          "-hide_banner",
          "-loglevel", "error",
          "-n",
          "-i", videoFile,
          "-i", voiceFile,
          "-i", musicFile,
          "-filter_complex", filterComplex,
          "-map", "0:v:0",
          "-map", "[aout]",
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "18",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "320k",
          "-shortest",
          outputMp4,
        ]);

        const probe = await probeMedia(outputMp4);
        const relOut = path.relative(ROOT_DIR, outputMp4).replace(/\\/g, "/");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          outputFile: relOut,
          duration: probe.duration,
          sizeFormatted: (fs.statSync(outputMp4).size / 1024 / 1024).toFixed(2) + " MB"
        }));
      } catch (err) {
        console.error("Erro no render:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 4. Servir Frontend do Editor & Arquivos Estáticos
  const paginaEditor = pathname === "/editor" || pathname === "/editor/";
  let filePath = path.join(ROOT_DIR, paginaEditor ? "app/editor/index.html" : pathname);
  if (!fs.existsSync(filePath)) {
    // Tenta caminho relativo a app/editor/
    filePath = path.join(ROOT_DIR, "app/editor", pathname);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found: " + pathname);
    }
  }

  return servirArquivo(req, res, filePath, getMimeType(filePath), "private, no-cache");

});

server.listen(PORT, '127.0.0.1', () => {
  atualizarCatalogo().then(() => prepararRespostaGrade()).catch(() => {});
  console.log(`================================================================`);
  console.log(`  ACERVO DE VÍDEOS: http://localhost:${PORT}`);
  console.log(`  Pista de edição:  http://localhost:${PORT}/editor`);
  console.log(`================================================================`);
});

// O lançador verifica a identidade da instância antes de reutilizar a porta.
server.on("error", (erro) => {
  if (erro?.code === "EADDRINUSE") {
    console.error(`Porta ${PORT} ocupada. Verifique a instância antes de iniciar outra cópia.`);
    process.exit(1);
  }
  throw erro;
});
