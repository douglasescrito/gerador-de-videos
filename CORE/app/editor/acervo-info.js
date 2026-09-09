const medicoesEmCurso = new Set();
const filaMedicoes = [];
let medindo = 0;
let resumoTimer;
const nomeColecao = (nome) => String(nome || 'Sem coleção').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const dataLegivel = (valor) => Number.isFinite(valor) ? new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Data indisponível';
const tamanhoLegivel = (mb) => mb >= 1024 ? (mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB' : mb > 0 && mb < 0.1 ? '< 0,1 MB' : Number(mb || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
const resumoMedida = (v) => v.width && v.height ? `${v.width} × ${v.height}` : ({ portrait: 'Vertical', landscape: 'Horizontal', square: 'Quadrado' }[v.aspect] || (v.status === 'unavailable' ? 'Formato indisponível' : 'Formato a medir'));

function atualizarResumo() {
  const conhecidos = FILTRADOS.filter((v) => v.duration > 0);
  const pendentes = FILTRADOS.length - conhecidos.length;
  const segundos = conhecidos.reduce((s, v) => s + v.duration, 0);
  const masters = FILTRADOS.filter((v) => v.isMaster).length;
  const tamanho = FILTRADOS.reduce((s, v) => s + v.sizeMb, 0);
  const metricas = [
    [FILTRADOS.length.toLocaleString('pt-BR'), 'vídeos nesta seleção'],
    [duracaoLonga(segundos), pendentes ? 'duração parcial' : 'duração total'],
    [tamanhoLegivel(tamanho), 'em arquivos'],
    [masters.toLocaleString('pt-BR'), 'finais registrados'],
  ];
  porId('status').innerHTML = metricas.map(([valor, rotulo]) => `<div class="metrica"><b>${escapar(valor)}</b><span>${rotulo}</span></div>`).join('');
  const colecao = COLECOES.find((c) => c.id === colecaoAtiva);
  porId('titulo-colecao').textContent = soFavoritos ? 'Favoritos' : colecao ? nomeColecao(colecao.name) : termo ? 'Resultados da busca' : 'Todos os vídeos';
  porId('abrir-favoritos').classList.toggle('ativo', soFavoritos);
  porId('abrir-favoritos').setAttribute('aria-pressed', String(soFavoritos));
  porId('resumo-nota').textContent = [pendentes ? `${pendentes.toLocaleString('pt-BR')} durações a verificar` : 'Durações disponíveis', soMasters ? FILTRADOS.filter(v => v.delivery?.status === 'candidate').length.toLocaleString('pt-BR') + ' a confirmar incluídos' : '', termo && idsPorPrompt ? `${porPromptVisiveis()} por prompt` : ''].filter(Boolean).join(' · ');
}

function receberMedicao(video, info) {
  if (info.status === 'measured' && info.duration > 0) {
    Object.assign(video, info);
    if (info.width > 0 && info.height > 0) video.aspect = info.width / info.height > 1.15 ? 'landscape' : info.width / info.height < 0.85 ? 'portrait' : 'square';
  } else if (!(video.duration > 0)) video.status = info.status;
  const chave = video.source + '/' + video.relPath;
  const carta = palco.querySelector('[data-chave="' + cssEscapar(chave) + '"]');
  if (carta) {
    carta.querySelector('.tempo').textContent = video.duration > 0 ? duracaoCurta(video.duration) : 'Indisponível';
    carta.querySelector('.tempo').title = video.duration > 0 ? 'Duração do arquivo' : 'Não foi possível medir este arquivo';
    carta.querySelector('.medida').textContent = resumoMedida(video);
  }
  clearTimeout(resumoTimer);
  resumoTimer = setTimeout(atualizarResumo, 160);
  if (mesmaMidia(video, videoNoLeitor)) sincronizarApresentacao();
}

function solicitarMedicao(video) {
  const chave = `${video.source}/${video.relPath}:${video.mtimeMs}`;
  if (medicoesEmCurso.has(chave) || video.status === 'measured' || video.status === 'unavailable' || (video.duration > 0 && video.width > 0 && video.height > 0)) return;
  medicoesEmCurso.add(chave);
  filaMedicoes.push({ video, chave });
  drenarMedicoes();
}
function drenarMedicoes() {
  while (medindo < 2 && filaMedicoes.length) {
    const { video, chave } = filaMedicoes.shift();
    medindo++;
    fetch('/api/acervo/metadata?source=' + encodeURIComponent(video.source) + '&rel=' + encodeURIComponent(video.relPath))
      .then((r) => { if (!r.ok) throw new Error('medição indisponível'); return r.json(); })
      .then((info) => receberMedicao(video, info))
      .catch(() => receberMedicao(video, { status: 'unavailable' }))
      .finally(() => { medicoesEmCurso.delete(chave); medindo--; drenarMedicoes(); });
  }
}
const observadorMedicao = new IntersectionObserver((entries) => {
  for (const entry of entries) if (entry.isIntersecting) {
    const video = entry.target._midia;
    observadorMedicao.unobserve(entry.target);
    if (video) solicitarMedicao(video);
  }
}, { rootMargin: '80px' });
function observarMedicao(carta, video) {
  carta._midia = video;
  observadorMedicao.observe(carta);
}
