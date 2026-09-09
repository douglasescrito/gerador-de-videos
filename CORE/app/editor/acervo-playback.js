// Cache de trabalho limitado: até 3 clipes de 8 MiB, somente o próximo é antecipado.
const cacheClipes = new Map();
const LIMITE_CLIPE = 8 * 1024 * 1024;
let antecipacao = null;
let antecipacaoTimer;
function fonteParaTocar(video) {
  const url = enderecoDaMidia(video);
  const hit = cacheClipes.get(url);
  if (!hit) return url;
  cacheClipes.delete(url); cacheClipes.set(url, hit);
  return hit.blobUrl;
}
function limitarCacheClipes() {
  const emUso = new Set([porId('player').getAttribute('src'), playerPrevia.getAttribute('src')]);
  for (const [url, hit] of cacheClipes) {
    if (cacheClipes.size <= 3) break;
    if (emUso.has(hit.blobUrl)) continue;
    URL.revokeObjectURL(hit.blobUrl);
    cacheClipes.delete(url);
  }
}
function cancelarAntecipacao() {
  clearTimeout(antecipacaoTimer);
  antecipacao?.controller.abort();
  antecipacao = null;
}
function prepararProximoVideo() {
  if (modoVisual === 'galeria' || document.hidden || navigator.connection?.saveData || porId('player').readyState < 2) return;
  const indice = FILTRADOS.findIndex(v => mesmaMidia(v, videoNoLeitor));
  if (indice < 0) return;
  const proximo = FILTRADOS[indice + 1] || (repetirSequencia ? FILTRADOS[0] : null);
  if (!proximo || mesmaMidia(proximo, videoNoLeitor)) return;
  const url = enderecoDaMidia(proximo);
  if (cacheClipes.has(url) || antecipacao?.url === url) return;
  cancelarAntecipacao();
  const controller = new AbortController();
  const tarefa = { url, controller };
  antecipacao = tarefa;
  antecipacaoTimer = setTimeout(async () => {
    try {
      // Grandes arquivos aquecem só 512 KiB no cache HTTP. Nunca baixar um master inteiro por antecipação.
      const limite = proximo.sizeMb <= 8 ? LIMITE_CLIPE : 512 * 1024;
      const resposta = await fetch(url, { headers: { Range: `bytes=0-${limite - 1}` }, signal: controller.signal, cache: 'default' });
      const total = Number(resposta.headers.get('Content-Range')?.split('/')[1]);
      const tamanho = Number(resposta.headers.get('Content-Length'));
      if (resposta.status !== 206 || !(tamanho > 0 && tamanho <= limite)) { await resposta.body?.cancel(); return; }
      const blob = await resposta.blob();
      if (controller.signal.aborted || antecipacao !== tarefa) return;
      if (total === blob.size && total <= LIMITE_CLIPE) {
        cacheClipes.set(url, { blobUrl: URL.createObjectURL(blob), size: blob.size });
        limitarCacheClipes();
      }
    } catch { /* antecipação é opcional, reprodução usa o arquivo original */ }
  }, 350);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelarAntecipacao(); else prepararProximoVideo(); });
window.addEventListener('pagehide', () => {
  cancelarAntecipacao(); pararPrevia();
  for (const hit of cacheClipes.values()) URL.revokeObjectURL(hit.blobUrl);
  cacheClipes.clear();
});
