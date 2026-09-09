// Grade regular virtualizada: todas as cartas reservam duas linhas para o título.
let ultimoLayout;
function layoutDoAcervo() {
  const largura = Math.max(1, palco.clientWidth);
  if (ultimoLayout?.videos === FILTRADOS && ultimoLayout.largura === largura && ultimoLayout.alvo === LARGURA_ALVO) return ultimoLayout;
  const quantidade = Math.max(1, Math.floor((largura + ESPACO) / (LARGURA_ALVO + ESPACO)));
  const larguraCarta = Math.floor((largura - ESPACO * (quantidade - 1)) / quantidade);
  const alturaCarta = 2 + (larguraCarta - 2) * 9 / 16 + 103;
  const passo = alturaCarta + ESPACO;
  ultimoLayout = { videos: FILTRADOS, largura, alvo: LARGURA_ALVO, larguraCarta, quantidade, passo, alturaCarta,
    altura: Math.max(0, Math.ceil(FILTRADOS.length / quantidade) * passo - ESPACO) };
  return ultimoLayout;
}
function posicoesVisiveis(layout, inicio, fim) {
  const primeiro = Math.max(0, Math.floor(inicio / layout.passo)) * layout.quantidade;
  const ultimo = Math.max(0, Math.ceil(fim / layout.passo)) * layout.quantidade;
  return Array.from({ length: Math.max(0, Math.min(layout.videos.length, ultimo) - primeiro) }, (_, offset) => {
    const indice = primeiro + offset;
    return { indice, x: (indice % layout.quantidade) * (layout.larguraCarta + ESPACO),
      y: Math.floor(indice / layout.quantidade) * layout.passo, altura: layout.alturaCarta };
  });
}
let desenhoAgendado = false;
function agendarDesenho() {
  if (desenhoAgendado) return;
  desenhoAgendado = true;
  requestAnimationFrame(() => { desenhoAgendado = false; desenhar(); });
}
