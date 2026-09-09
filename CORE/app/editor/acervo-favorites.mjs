import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, CORE_DIR, resolverArquivo, chaveDeCache } from './acervo.mjs';

const dbFile = path.join(CACHE_DIR, 'archive-index.sqlite');
export async function listarFavoritos() {
  if (!fs.existsSync(dbFile)) return [];
  const { listArchiveFavorites } = await import('../../lib/media-pipeline/archive-index.mjs');
  return listArchiveFavorites({ dbFile, root: path.join(CORE_DIR, 'outputs') }).map((v) => v.relPath);
}
export async function salvarFavorito({ source, rel, liked }) {
  if (typeof liked !== 'boolean' || !resolverArquivo(source, rel) || path.extname(rel).toLowerCase() !== '.mp4') throw new Error('Vídeo ou favorito inválido.');
  const { setArchiveFavorite } = await import('../../lib/media-pipeline/archive-index.mjs');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return setArchiveFavorite({ dbFile, relPath: chaveDeCache(source, rel), liked });
}
