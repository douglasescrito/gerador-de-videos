import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { probeVideo, loadJsonCache, saveJsonCache } from '../../lib/media-pipeline/media-archive.mjs';
import { resolverArquivo, chaveDeCache, CACHE_DIR, registrarMedicaoNoCatalogo } from './acervo.mjs';

// Medição sob demanda, compartilhada entre abas e limitada a dois processos.
const pendentes = new Map();
const falhas = new Map();
const fila = [];
let ativos = 0;
const cachePath = path.join(CACHE_DIR, 'cinemateca-probe-cache.json');
function drenar() {
  while (ativos < 2 && fila.length) {
    const tarefa = fila.shift(); ativos++;
    tarefa().finally(() => { ativos--; drenar(); });
  }
}
export async function medirMidia(source, rel) {
  const arquivo = resolverArquivo(source, rel);
  if (!arquivo || path.extname(arquivo).toLowerCase() !== '.mp4') return null;
  const stat = fs.statSync(arquivo);
  const chave = chaveDeCache(source, rel);
  const identidade = `${chave}:${stat.size}:${stat.mtimeMs}`;
  if (pendentes.has(identidade)) return pendentes.get(identidade);
  const hit = loadJsonCache(cachePath)[chave];
  if (hit?.size === stat.size && hit.mtimeMs === stat.mtimeMs && hit.duration > 0 && hit.width > 0 && hit.height > 0) {
    registrarMedicaoNoCatalogo(source, rel, hit);
    return { duration: hit.duration, width: hit.width, height: hit.height, status: 'measured' };
  }
  if (falhas.has(identidade)) return { status: 'unavailable' };
  const promessa = new Promise((resolve) => {
    fila.push(async () => {
      try {
        const info = await probeVideo(arquivo, { exec: (cmd, args, opts, cb) => execFile(cmd, args, { ...opts, timeout: 15000 }, cb) });
        const depois = fs.statSync(arquivo);
        if (depois.size !== stat.size || depois.mtimeMs !== stat.mtimeMs) return resolve({ status: 'changed' });
        if (!info || !(info.duration > 0)) { falhas.set(identidade, true); return resolve({ status: 'unavailable' }); }
        // Relê antes de mesclar, preservando medições feitas por outras rotas.
        const cache = loadJsonCache(cachePath);
        cache[chave] = { size: stat.size, mtimeMs: stat.mtimeMs, ...info };
        saveJsonCache(cachePath, cache);
        registrarMedicaoNoCatalogo(source, rel, info);
        resolve({ ...info, status: 'measured' });
      } catch { resolve({ status: 'unavailable' }); }
    });
    drenar();
  }).finally(() => pendentes.delete(identidade));
  pendentes.set(identidade, promessa);
  return promessa;
}
