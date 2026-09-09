import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createGeneratorService } from './gerador-service.mjs';
import { servirArquivo } from './acervo-stream.mjs';
import { listPresenterReferences } from './presenter-catalog.mjs';

export function generatorRoutes({ coreDir, service = createGeneratorService({ coreDir }) }) {
  const token = randomBytes(32).toString('hex');
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/gerador')) return false;
    res.removeHeader('Access-Control-Allow-Origin');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (!['localhost:5599', '127.0.0.1:5599'].includes(req.headers.host) || (req.headers.origin && !['http://localhost:5599', 'http://127.0.0.1:5599'].includes(req.headers.origin))) { send(403, { error: 'Abra o gerador pelo endereço local do Studio.' }); return true; }
      if (req.method === 'GET') {
        if (url.pathname === '/api/gerador/config') {
          const [{ buildEffectiveCapabilityMap }, { googleVidsVoiceCatalog }, { listStyleSpecs }] = await Promise.all([import('../../lib/media-pipeline/provider-registry.mjs'), import('../../lib/media-pipeline/google-vids-voices.mjs'), import('../../lib/media-pipeline/direction-presets.mjs')]);
          send(200, { token, presenterReferences: await listPresenterReferences(coreDir), capabilities: (await buildEffectiveCapabilityMap()).capabilities, voices: googleVidsVoiceCatalog(), styles: listStyleSpecs({ includeConcepts: false, includeDeprecated: false }).map(s => ({ id: s.id, name: s.name || s.label || s.id })) });
        } else if (url.pathname === '/api/gerador/catalog') send(200, await service.catalog());
        else if (url.pathname === '/api/gerador/jobs') {
          const items = await service.list();
          send(200, { items: url.searchParams.get('view') === 'summary' ? items.map(job => ({
            id: job.id, name: job.name, type: job.type, createdAt: job.createdAt,
            status: job.status, message: job.message, stateFile: job.stateFile,
            mediaAvailable: job.mediaAvailable, progress: job.progress,
            checklist: job.checklist?.map(scene => ({ id: scene.id })),
          })) : items });
        }
        else if (url.pathname === '/api/gerador/scene-media') await servirArquivo(req, res, await service.sceneMedia(url.searchParams.get('id'), url.searchParams.get('scene')), 'video/mp4', 'private, no-cache');
        else if (url.pathname === '/api/gerador/job') send(200, await service.read(url.searchParams.get('id')));
        else if (url.pathname === '/api/gerador/media') await servirArquivo(req, res, await service.media(url.searchParams.get('id')), 'video/mp4', 'private, no-cache');
        else send(404, { error: 'Recurso não encontrado.' });
      } else if (req.method === 'POST') {
        const given = Buffer.from(String(req.headers['x-studio-token'] || ''));
        if (given.length !== token.length || !timingSafeEqual(given, Buffer.from(token))) { send(403, { error: 'Reabra o gerador para renovar a sessão local.' }); return true; }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { send(415, { error: 'Envie JSON.' }); return true; }
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) { send(413, { error: 'Documento muito grande.' }); return true; } chunks.push(chunk); }
        let input; try { input = JSON.parse(Buffer.concat(chunks)); } catch { send(400, { error: 'JSON inválido.' }); return true; }
        if (url.pathname === '/api/gerador/compatibility') send(200, await service.compatibility(input.document));
        else if (url.pathname === '/api/gerador/export') send(202, await service.exportEdit(input));
        else if (url.pathname === '/api/gerador/plan') send(202, await service.plan(input));
        else if (url.pathname === '/api/gerador/run') send(202, await service.execute(input));
        else if (url.pathname === '/api/gerador/resume') send(202, await service.execute(input, true));
        else if (url.pathname === '/api/gerador/approve') send(202, await service.execute(input, true, true));
        else if (url.pathname === '/api/gerador/text') send(202, await service.text(input));
        else send(404, { error: 'Ação não encontrada.' });
      } else send(405, { error: 'Método não permitido.' });
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir a operação. Acompanhe o estado antes de tentar novamente.' }); }
    return true;
  };
}
