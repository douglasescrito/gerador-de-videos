// Os nomes originais permanecem no catálogo e nas informações; só o rótulo é limpo.
function limparRotuloMidia(valor) {
  return String(valor || '')
    .replace(/\b[0-9a-f]{8}[\s_-]+[0-9a-f]{4}[\s_-]+[0-9a-f]{4}[\s_-]+[0-9a-f]{4}[\s_-]+[0-9a-f]{12}\b/gi, '')
    .replace(/\b[0-9a-f]{12,64}\b/gi, '')
    .replace(/\b20\d{6}(?:[T_-]\d{6})?\b/g, '')
    .replace(/\.mp4$/i, '').replace(/^[.\s_-]+/, '')
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tituloDoCard(video) {
  const titulo = limparRotuloMidia(video.title);
  const colecao = limparRotuloMidia(video.colecaoCurta);
  if (/^(master|final|video|vídeo|output)$/i.test(titulo) && colecao) return `${colecao} · ${titulo}`;
  return titulo || colecao || 'Vídeo sem título';
}
function criacaoDoCard(video) {
  return Number.isFinite(video.createdAtMs) && video.createdAtMs > 0
    ? 'Criado em ' + new Date(video.createdAtMs).toLocaleDateString('pt-BR')
    : 'Criação não informada';
}
