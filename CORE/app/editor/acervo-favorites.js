let favoritos = new Set();
let soFavoritos = false;
const favoritosPendentes = new Set();
const chaveFavorito = (video) => video.source === 'entregas' ? video.relPath : `${video.source}/${video.relPath}`;
const ehFavorito = (video) => favoritos.has(chaveFavorito(video));
async function carregarFavoritos() {
  const resposta = await fetch('/api/acervo/favoritos');
  if (!resposta.ok) throw new Error('Favoritos indisponíveis');
  const dados = await resposta.json();
  favoritos = new Set(dados.favorites);
}
function abrirFavoritos() {
  soFavoritos = !soFavoritos;
  montarLateral(); aplicar();
}
function montarColecaoFavoritos(lateral) {
  const botao = document.createElement('button');
  botao.className = 'item-col colecao-favoritos' + (soFavoritos ? ' ativo' : '');
  botao.innerHTML = '<span class="rotulo">★ Favoritos</span><span class="n">' + TUDO.filter(ehFavorito).length + '</span>';
  botao.setAttribute('aria-pressed', String(soFavoritos));
  botao.onclick = abrirFavoritos;
  lateral.appendChild(botao);
}
function atualizarBotaoFavorito(carta, video) {
  const botao = carta.querySelector('.botao-favorito');
  if (!botao) return;
  const ativo = ehFavorito(video);
  botao.classList.toggle('marcado', ativo);
  botao.setAttribute('aria-pressed', String(ativo));
  botao.setAttribute('aria-label', (ativo ? 'Remover dos favoritos: ' : 'Adicionar aos favoritos: ') + tituloDoCard(video));
  botao.title = ativo ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
  botao.disabled = favoritosPendentes.has(chaveFavorito(video));
}
function adicionarFavorito(carta, video) {
  const botao = document.createElement('button');
  botao.className = 'botao-favorito';
  botao.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9Z"/></svg>';
  botao.type = 'button';
  botao.addEventListener('mouseenter', () => pararPrevia());
  botao.onclick = async (evento) => {
    evento.stopPropagation();
    const chave = chaveFavorito(video);
    if (favoritosPendentes.has(chave)) return;
    const liked = !ehFavorito(video);
    favoritosPendentes.add(chave); atualizarBotaoFavorito(carta, video);
    try {
      const resposta = await fetch('/api/acervo/favoritos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: video.source, rel: video.relPath, liked }) });
      if (!resposta.ok) throw new Error('Falha ao salvar');
      // Releitura confirma o estado persistido; não repete uma escrita incerta.
      await carregarFavoritos();
      if (ehFavorito(video) !== liked) throw new Error('Favorito não confirmado');
      porId('favorito-status').textContent = liked ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.';
    } catch {
      try { await carregarFavoritos(); } catch { /* preserva a seleção já conhecida */ }
      porId('favorito-status').textContent = 'Não foi possível confirmar o favorito. Recarregue para conferir.';
    } finally {
      favoritosPendentes.delete(chave);
      montarLateral();
      if (soFavoritos) aplicar();
      else desenhar();
    }
  };
  carta.querySelector('.quadro').appendChild(botao);
  atualizarBotaoFavorito(carta, video);
}
