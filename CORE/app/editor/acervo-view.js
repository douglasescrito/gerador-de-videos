// Visualização local: a fila é sempre a lista filtrada do acervo existente.
let modoVisual = 'galeria';
let automatico = false;
let repetirSequencia = false;
let larguraDupla = 54;
const porId = (id) => document.getElementById(id);
const mesmaMidia = (a, b) => Boolean(a && b && a.source === b.source && a.relPath === b.relPath);

function salvarVisualizacao() {
  try { localStorage.setItem('acervo-visualizacao-v1', JSON.stringify({ larguraDupla, tamanho: LARGURA_ALVO, velocidade: porId('velocidade').value, colecoes: !document.body.classList.contains('sem-colecoes') })); } catch { /* armazenamento opcional */ }
}

function definirModo(modo, selecionar = true) {
  modoVisual = modo;
  document.body.dataset.modo = modo;
  document.querySelectorAll('[data-modo]').forEach((botao) => {
    const ativo = botao.dataset.modo === modo;
    botao.classList.toggle('ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });
  if (modo === 'galeria') {
    cancelarAntecipacao();
    porId('leitor').classList.remove('aberto');
    porId('player').pause();
    document.querySelectorAll('#dossie audio').forEach((a) => a.pause());
    automatico = false;
  } else {
    pararPrevia();
    porId('leitor').classList.add('aberto');
    if (selecionar && !videoNoLeitor && FILTRADOS.length) abrirLeitor(FILTRADOS[0]);
  }
  sincronizarApresentacao();
  agendarDesenho();
}

function sincronizarApresentacao() {
  if (!FILTRADOS.length) automatico = false;
  const indice = FILTRADOS.findIndex((v) => mesmaMidia(v, videoNoLeitor));
  porId('contador').textContent = `${indice + 1} / ${FILTRADOS.length}`;
  porId('anterior').disabled = indice <= 0 && !repetirSequencia;
  porId('proximo').disabled = !FILTRADOS.length || (indice === FILTRADOS.length - 1 && !repetirSequencia);
  porId('automatico').disabled = !FILTRADOS.length;
  porId('automatico').classList.toggle('ativo', automatico);
  porId('automatico').setAttribute('aria-pressed', String(automatico));
  porId('automatico').textContent = automatico ? 'Ⅱ Sequência' : '▶ Sequência';
  porId('titulo-atual').textContent = videoNoLeitor ? tituloDoCard(videoNoLeitor) : 'Selecione um vídeo na galeria';
  porId('contexto-atual').textContent = videoNoLeitor
    ? `${nomeColecao(videoNoLeitor.colecaoCurta || videoNoLeitor.source)}${indice < 0 ? ' · fora do filtro atual' : ''}`
    : 'Use os filtros para escolher sua sequência.';
  porId('detalhes-atuais').innerHTML = videoNoLeitor ? [videoNoLeitor.duration > 0 ? duracaoCurta(videoNoLeitor.duration) : videoNoLeitor.status === 'unavailable' ? 'Duração indisponível' : 'Medindo duração…', resumoMedida(videoNoLeitor), tamanhoLegivel(videoNoLeitor.sizeMb), dataLegivel(videoNoLeitor.mtimeMs), videoNoLeitor.delivery?.status === 'final' ? 'Final registrado' : videoNoLeitor.delivery?.status === 'candidate' ? 'A confirmar' : 'Clipe / intermediário'].map((s) => `<span>${escapar(s)}</span>`).join('') : '';
  porId('arquivo-atual').hidden = !videoNoLeitor;
  if (videoNoLeitor) porId('arquivo-atual').href = enderecoDaMidia(videoNoLeitor);
  prepararProximoVideo();
}

async function tocarPlayer() {
  const player = porId('player');
  const origem = player.getAttribute('src');
  porId('player-aviso').textContent = '';
  player.playbackRate = Number(porId('velocidade').value);
  try { await player.play(); } catch (erro) {
    if (player.getAttribute('src') !== origem || erro.name === 'AbortError') return;
    porId('player-aviso').textContent = 'Pressione reproduzir para iniciar o vídeo.';
  }
}

function navegarVideo(delta) {
  if (!FILTRADOS.length) return;
  let indice = FILTRADOS.findIndex((v) => mesmaMidia(v, videoNoLeitor));
  let proximo = indice < 0 ? 0 : indice + delta;
  if (repetirSequencia) proximo = (proximo + FILTRADOS.length) % FILTRADOS.length;
  if (proximo < 0 || proximo >= FILTRADOS.length) { automatico = false; sincronizarApresentacao(); return; }
  abrirLeitor(FILTRADOS[proximo]);
  const pos = layoutDoAcervo().itens[proximo];
  if (pos) area.scrollTop = Math.max(0, palco.offsetTop + pos.y - 8);
  desenhar();
}

async function maximizarApresentacao() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await porId('leitor').requestFullscreen();
  } catch { porId('player-aviso').textContent = 'Tela cheia indisponível neste navegador.'; }
}

function ajustarDivisor(valor) {
  larguraDupla = Math.min(70, Math.max(35, valor));
  document.body.style.setProperty('--largura-dupla', `${larguraDupla}%`);
  porId('divisor').setAttribute('aria-valuenow', String(Math.round(larguraDupla)));
  agendarDesenho();
}

function iniciarVisualizacao() {
  // O primeiro carregamento continua mostrando a galeria aberta, sem autoplay.
  try {
    const pref = JSON.parse(localStorage.getItem('acervo-visualizacao-v1') || '{}');
    if (Number.isFinite(pref.larguraDupla)) ajustarDivisor(pref.larguraDupla);
    if (Number.isFinite(pref.tamanho)) LARGURA_ALVO = Math.min(360, Math.max(150, pref.tamanho));
    if (['0.5', '1', '1.5', '2'].includes(pref.velocidade)) porId('velocidade').value = pref.velocidade;
    document.body.classList.toggle('sem-colecoes', pref.colecoes === false);
  } catch { /* preferências indisponíveis não bloqueiam o acervo */ }
  porId('densidade').value = LARGURA_ALVO;
  document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => definirModo(b.dataset.modo)));
  porId('btn-colecoes').onclick = () => { document.body.classList.toggle('sem-colecoes'); salvarVisualizacao(); desenhar(); };
  porId('densidade').oninput = (e) => { LARGURA_ALVO = Number(e.target.value); desenhar(); salvarVisualizacao(); };
  porId('anterior').onclick = () => navegarVideo(-1);
  porId('proximo').onclick = () => navegarVideo(1);
  porId('automatico').onclick = () => {
    automatico = !automatico;
    if (automatico) {
      if (!videoNoLeitor || !FILTRADOS.some((v) => mesmaMidia(v, videoNoLeitor))) navegarVideo(1);
      else if (porId('player').ended) navegarVideo(1);
      else tocarPlayer();
    }
    sincronizarApresentacao();
  };
  porId('repetir').onclick = (e) => {
    repetirSequencia = !repetirSequencia;
    e.currentTarget.classList.toggle('ativo', repetirSequencia);
    e.currentTarget.setAttribute('aria-pressed', String(repetirSequencia));
    sincronizarApresentacao();
  };
  porId('velocidade').onchange = () => { porId('player').playbackRate = Number(porId('velocidade').value); salvarVisualizacao(); };
  porId('maximizar').onclick = maximizarApresentacao;
  porId('player').addEventListener('ended', () => { if (automatico && modoVisual !== 'galeria') navegarVideo(1); });
  porId('player').addEventListener('loadeddata', prepararProximoVideo);
  porId('player').addEventListener('error', () => {
    if (!porId('player').hasAttribute('src')) return;
    automatico = false;
    porId('player-aviso').textContent = 'Não foi possível reproduzir este arquivo. Você pode avançar para o próximo.';
    sincronizarApresentacao();
  });
  porId('player').addEventListener('play', () => { porId('player-aviso').textContent = ''; pararPrevia(); document.querySelectorAll('#dossie audio').forEach((a) => a.pause()); });
  document.addEventListener('play', (e) => {
    if (e.target.matches?.('#dossie audio')) {
      porId('player').pause();
      document.querySelectorAll('#dossie audio').forEach((a) => { if (a !== e.target) a.pause(); });
    }
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pararPrevia(); porId('player').pause(); } });
  document.addEventListener('keydown', (e) => {
    if (modoVisual === 'galeria' || e.target.closest('input,select,textarea,button,[role="button"], [role="separator"], [contenteditable="true"]') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navegarVideo(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navegarVideo(1); }
    if (e.key.toLowerCase() === 'f') { e.preventDefault(); maximizarApresentacao(); }
    if (e.key === ' ') { e.preventDefault(); if (porId('player').paused) tocarPlayer(); else porId('player').pause(); }
  });
  const divisor = porId('divisor');
  divisor.onpointerdown = (e) => { divisor.setPointerCapture(e.pointerId); };
  divisor.onpointermove = (e) => { if (divisor.hasPointerCapture(e.pointerId)) ajustarDivisor((1 - e.clientX / innerWidth) * 100); };
  divisor.onpointerup = (e) => { divisor.releasePointerCapture(e.pointerId); salvarVisualizacao(); };
  divisor.onkeydown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); ajustarDivisor(larguraDupla + (e.key === 'ArrowLeft' ? 2 : -2)); salvarVisualizacao(); }
  };
  new ResizeObserver(agendarDesenho).observe(area);
  definirModo('galeria', false);
}
