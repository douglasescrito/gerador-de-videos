// Uma única janela de informação, fora do recorte dos cartões virtualizados.
let infoCardAtual = null;
let abrirInfoTimer;
let fecharInfoTimer;
let pedidoInfo;
let painelInfo;
let sequenciaInfo = 0;
const cacheInfoCard = new Map();

function janelaInfoCard() {
  if (painelInfo) return painelInfo;
  painelInfo = document.createElement('section');
  painelInfo.id = 'info-card';
  painelInfo.className = 'info-card';
  painelInfo.hidden = true;
  painelInfo.setAttribute('role', 'dialog');
  painelInfo.setAttribute('aria-label', 'Informações do vídeo');
  painelInfo.addEventListener('mouseenter', () => clearTimeout(fecharInfoTimer));
  painelInfo.addEventListener('mouseleave', agendarFecharInfo);
  painelInfo.addEventListener('focusin', () => clearTimeout(fecharInfoTimer));
  painelInfo.addEventListener('focusout', (e) => { if (!painelInfo.contains(e.relatedTarget)) agendarFecharInfo(); });
  document.body.appendChild(painelInfo);
  return painelInfo;
}

function fecharInfoCard(devolverFoco = false) {
  clearTimeout(abrirInfoTimer); clearTimeout(fecharInfoTimer);
  pedidoInfo?.abort(); sequenciaInfo++;
  const botao = infoCardAtual?.botao;
  infoCardAtual = null;
  if (painelInfo) painelInfo.hidden = true;
  botao?.setAttribute('aria-expanded', 'false');
  if (devolverFoco && botao?.isConnected) botao.focus({ preventScroll: true });
}
function agendarFecharInfo() {
  clearTimeout(abrirInfoTimer); clearTimeout(fecharInfoTimer);
  if (infoCardAtual?.fixado) return;
  fecharInfoTimer = setTimeout(() => {
    if (!painelInfo?.contains(document.activeElement)) fecharInfoCard();
  }, 230);
}

function posicionarInfoCard() {
  if (!infoCardAtual || !painelInfo) return;
  const rect = infoCardAtual.botao.getBoundingClientRect();
  const largura = Math.min(400, innerWidth - 20);
  painelInfo.style.width = largura + 'px';
  let x = rect.right + 8;
  if (x + largura > innerWidth - 10) x = rect.left - largura - 8;
  painelInfo.style.left = Math.max(10, Math.min(x, innerWidth - largura - 10)) + 'px';
  painelInfo.style.top = Math.max(10, Math.min(rect.top, innerHeight - painelInfo.offsetHeight - 10)) + 'px';
}

function campoInfoCard(rotulo, valor) {
  const texto = typeof valor === 'string' ? valor : valor == null ? '' : JSON.stringify(valor, null, 2);
  return `<section class="info-card-secao"><h3>${escapar(rotulo)}</h3><p>${escapar(texto || 'Não informado.')}</p></section>`;
}
function conteudoInfoCard(video, info) {
  const recibo = info.receipt || {};
  const receita = info.receita?.conteudo;
  const resumo = recibo.summary || recibo.description || recibo.metadata?.summary || receita?.description || receita?.sinopse;
  const prompt = recibo.userPrompt || recibo.prompt || recibo.effectivePrompt || recibo.request?.prompt;
  const hash = recibo.sha256 || recibo.artifactHash || recibo.metadata?.outputSha256;
  const tipo = video.delivery?.status === 'final' ? 'Final registrado' : video.delivery?.status === 'candidate' ? 'A confirmar' : 'Clipe / intermediário';
  return campoInfoCard('Classificação', tipo + (video.delivery?.reason ? '\n' + video.delivery.reason : ''))
    + (video.delivery?.evidence ? campoInfoCard('Registro consultado', video.delivery.evidence.document + '\n' + video.delivery.evidence.basis) : '')
    + campoInfoCard('Resumo', resumo)
    + campoInfoCard('Prompt', prompt)
    + (receita ? `<section class="info-card-secao"><h3>Receita</h3><p>${escapar(receita.label || receita.name || receita.identity?.name || 'Receita disponível')}</p><details><summary>Ver receita</summary><pre>${escapar(JSON.stringify(receita, null, 2))}</pre></details></section>` : campoInfoCard('Receita', 'Nenhuma receita vinculada.'))
    + campoInfoCard('Coleção', nomeColecao(video.colecaoCurta))
    + campoInfoCard('Criação do arquivo no disco', video.createdAtMs > 0 ? new Date(video.createdAtMs).toLocaleString('pt-BR') : null)
    + campoInfoCard('Última modificação', new Date(video.mtimeMs).toLocaleString('pt-BR'))
    + campoInfoCard('Arquivo original', video.relPath)
    + (hash ? campoInfoCard('Hash registrado', hash) : '')
    + (info.receipt ? `<details class="info-card-secao"><summary>Dados técnicos do recibo</summary><pre>${escapar(JSON.stringify(info.receipt, null, 2))}</pre></details>` : '');
}

async function abrirInfoCard(botao, video, fixado = false) {
  clearTimeout(abrirInfoTimer); clearTimeout(fecharInfoTimer);
  if (infoCardAtual?.botao === botao) {
    if (fixado) infoCardAtual.fixado = true;
    return;
  }
  fecharInfoCard();
  pararPrevia();
  const painel = janelaInfoCard();
  infoCardAtual = { botao, video, fixado };
  botao.setAttribute('aria-expanded', 'true');
  painel.innerHTML = `<div class="info-card-cabeca"><b>${escapar(tituloDoCard(video))}</b><button type="button" aria-label="Fechar informações">×</button></div><div class="info-card-corpo" aria-live="polite">Carregando informações…</div>`;
  painel.querySelector('button').onclick = () => fecharInfoCard(true);
  painel.hidden = false;
  posicionarInfoCard();
  const ticket = ++sequenciaInfo;
  const chave = `${video.source}/${video.relPath}:${video.mtimeMs}`;
  try {
    let info = cacheInfoCard.get(chave);
    if (!info) {
      pedidoInfo = new AbortController();
      const resposta = await fetch('/api/acervo/dossie?source=' + encodeURIComponent(video.source) + '&rel=' + encodeURIComponent(video.relPath), { signal: pedidoInfo.signal });
      if (!resposta.ok) throw new Error('Informações indisponíveis');
      info = await resposta.json();
      if (cacheInfoCard.size >= 24) cacheInfoCard.delete(cacheInfoCard.keys().next().value);
      cacheInfoCard.set(chave, info);
    }
    if (ticket !== sequenciaInfo) return;
    painel.querySelector('.info-card-corpo').innerHTML = conteudoInfoCard(video, info);
    posicionarInfoCard();
  } catch (erro) {
    if (ticket !== sequenciaInfo || erro.name === 'AbortError') return;
    painel.querySelector('.info-card-corpo').textContent = 'Não foi possível carregar as informações. Feche e tente novamente.';
  }
}

function adicionarInfoCard(carta, video) {
  const botao = document.createElement('button');
  botao.className = 'botao-info-card'; botao.type = 'button';
  botao.setAttribute('aria-label', 'Informações: ' + tituloDoCard(video));
  botao.setAttribute('aria-haspopup', 'dialog');
  botao.setAttribute('aria-controls', 'info-card');
  botao.setAttribute('aria-expanded', 'false');
  botao.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 11v6M12 7v1"/></svg>';
  botao.addEventListener('mouseenter', () => { pararPrevia(); clearTimeout(abrirInfoTimer); abrirInfoTimer = setTimeout(() => abrirInfoCard(botao, video), 180); });
  botao.addEventListener('mouseleave', agendarFecharInfo);
  botao.addEventListener('blur', (e) => { if (!painelInfo?.contains(e.relatedTarget)) agendarFecharInfo(); });
  botao.addEventListener('click', (e) => {
    e.stopPropagation();
    if (infoCardAtual?.botao === botao && infoCardAtual.fixado) fecharInfoCard();
    else abrirInfoCard(botao, video, true);
  });
  botao.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && infoCardAtual?.botao === botao) {
      e.preventDefault(); painelInfo.querySelector('button').focus();
    }
  });
  carta.querySelector('.quadro').appendChild(botao);
}

document.addEventListener('pointerdown', (e) => {
  if (infoCardAtual && !painelInfo.contains(e.target) && !infoCardAtual.botao.contains(e.target)) fecharInfoCard();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoCardAtual) { e.preventDefault(); e.stopImmediatePropagation(); fecharInfoCard(true); }
}, true);
document.addEventListener('scroll', (e) => {
  if (infoCardAtual && (e.target.id === 'area' || e.target.id === 'lateral')) fecharInfoCard();
}, true);
window.addEventListener('resize', () => fecharInfoCard());
