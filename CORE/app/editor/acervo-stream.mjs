import fs from 'node:fs';

export function intervaloDeBytes(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!match || !(size > 0) || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

// Compartilha o cache HTTP entre prévias, busca de trechos e apresentação.
export function servirArquivo(req, res, file, tipo, cache = 'private, max-age=3600, must-revalidate') {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let stat;
  try { stat = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
  if (!stat.isFile()) { res.writeHead(404); return res.end(); }
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}-${stat.ctimeMs.toString(16)}"`;
  const headers = { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': cache,
    ETag: etag, 'Last-Modified': stat.mtime.toUTCString() };
  const nenhum = req.headers['if-none-match'];
  const modificadoDesde = req.headers['if-modified-since'];
  if (nenhum ? nenhum.split(',').some(v => v.trim().replace(/^W\//, '') === etag || v.trim() === '*')
    : modificadoDesde && Math.floor(stat.mtimeMs / 1000) <= Date.parse(modificadoDesde) / 1000) {
    res.writeHead(304, headers); return res.end();
  }
  let range = req.method === 'GET' ? req.headers.range : null;
  const seIntervalo = req.headers['if-range'];
  if (range && seIntervalo && seIntervalo !== etag && !(Date.parse(seIntervalo) >= Math.floor(stat.mtimeMs / 1000) * 1000)) range = null;
  const intervalo = range ? intervaloDeBytes(range, stat.size) : null;
  if (range && !intervalo) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
  if (intervalo) headers['Content-Range'] = `bytes ${intervalo.start}-${intervalo.end}/${stat.size}`;
  headers['Content-Length'] = intervalo ? intervalo.end - intervalo.start + 1 : stat.size;
  res.writeHead(intervalo ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, intervalo || {});
  // Um seek substituído ou card fechado não continua lendo o disco.
  res.once('close', () => stream.destroy());
  stream.once('error', () => res.destroy());
  stream.pipe(res);
}
