import { parentPort } from 'node:worker_threads';
import { construirCatalogo } from './acervo.mjs';

parentPort.on('message', () => {
  try { parentPort.postMessage({ catalogo: construirCatalogo({ forcar: true }) }); }
  catch { parentPort.postMessage({ error: 'Não foi possível atualizar o índice local.' }); }
});
