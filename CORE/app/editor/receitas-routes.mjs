import { createRecipeLibrary } from './receitas-library.mjs';

export function recipeRoutes(options) {
  const library = createRecipeLibrary(options);
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/receitas')) return false;
    const send = (status, result) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result)); };
    try {
      if (req.method === 'GET' && url.pathname === '/api/receitas') send(200, await library.list());
      else if (req.method === 'GET' && url.pathname === '/api/receitas/item') send(200, await library.read(url.searchParams.get('file')));
      else if (req.method === 'POST' && ['/api/receitas/validar', '/api/receitas/derivar'].includes(url.pathname)) {
        const origin = req.headers.origin;
        if (origin && !['http://localhost:5599', 'http://127.0.0.1:5599'].includes(origin)) { send(403, { error: 'Origem não autorizada.' }); return true; }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { send(415, { error: 'Envie a receita como JSON.' }); return true; }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { send(413, { error: 'A receita excede o limite de 2 MB.' }); return true; }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks)); } catch { send(400, { error: 'JSON inválido. Confira as vírgulas e aspas.' }); return true; }
        send(url.pathname.endsWith('/derivar') ? 201 : 200, url.pathname.endsWith('/derivar') ? await library.derive(input) : await library.validate(input.document));
      } else send(405, { error: 'Operação não disponível.' });
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir a operação com a receita.' }); }
    return true;
  };
}
