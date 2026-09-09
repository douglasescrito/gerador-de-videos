import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intervaloDeBytes, servirArquivo } from '../app/editor/acervo-stream.mjs';

test('intervalos incluem sufixo, limite do arquivo e rejeitam seeks inválidos', () => {
  assert.deepEqual(intervaloDeBytes('bytes=20-', 100), { start: 20, end: 99 });
  assert.deepEqual(intervaloDeBytes('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(intervaloDeBytes('bytes=0-99999', 100), { start: 0, end: 99 });
  for (const range of ['bytes=100-', 'bytes=9-2', 'bytes=-0', 'bytes=a-3', 'bytes=-', 'bytes=0-2,4-6']) assert.equal(intervaloDeBytes(range, 100), null);
});

test('stream entrega trechos, revalida cache e invalida versão alterada', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-stream-'));
  const file = path.join(root, 'sample.mp4');
  fs.writeFileSync(file, '0123456789');
  const server = http.createServer((req, res) => servirArquivo(req, res, file, 'video/mp4'));
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/sample.mp4`;
  let r = await fetch(url, { headers: { Range: 'bytes=2-5' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await r.text(), '2345');
  const etag = r.headers.get('etag');
  r = await fetch(url, { method: 'HEAD' });
  assert.equal(r.headers.get('content-length'), '10');
  assert.equal(await r.text(), '');
  r = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(r.status, 304);
  r = await fetch(url, { headers: { Range: 'bytes=99-' } });
  assert.equal(r.status, 416);
  r = await fetch(url, { headers: { Range: 'bytes=2-5', 'If-Range': '"antigo"' } });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '0123456789');
  fs.writeFileSync(file, '0123456789new');
  r = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(r.status, 200);
  assert.notEqual(r.headers.get('etag'), etag);
  assert.equal(await r.text(), '0123456789new');
});
