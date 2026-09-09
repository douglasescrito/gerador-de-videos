// Um único decodificador de prévia, reaproveitado ao percorrer a grade.
let audioLiberado = false;
let cartaEmPrevia = null;
let temporizadorPrevia;
let descartePrevia;
let revisaoPrevia = 0;
let buscaPrevia = null;
let quadroBusca = 0;
const ATRASO_PREVIA = 220;
const playerPrevia = document.createElement('video');
playerPrevia.className = 'video-previa';
playerPrevia.muted = true;
playerPrevia.volume = 0.85;
playerPrevia.loop = true;
playerPrevia.playsInline = true;
playerPrevia.preload = 'auto';
playerPrevia.disablePictureInPicture = true;

function liberarAudio() {
  audioLiberado = true;
  if (cartaEmPrevia && buscaPrevia == null) playerPrevia.muted = false;
}
document.addEventListener('click', liberarAudio);
document.addEventListener('keydown', liberarAudio);

function agendarPrevia(carta, dados) {
  clearTimeout(temporizadorPrevia);
  if (carta === cartaEmPrevia) return;
  temporizadorPrevia = setTimeout(() => iniciarPrevia(carta, dados), ATRASO_PREVIA);
}
function cancelarPrevia(carta) {
  clearTimeout(temporizadorPrevia);
  if (carta === cartaEmPrevia) pararPrevia();
}
function tocarPrevia() {
  if (!cartaEmPrevia || buscaPrevia != null) return;
  const revisao = revisaoPrevia;
  playerPrevia.muted = !audioLiberado;
  playerPrevia.play().catch(erro => {
    if (revisao !== revisaoPrevia || buscaPrevia != null || erro.name === 'AbortError') return;
    playerPrevia.muted = true;
    playerPrevia.play().catch(() => { /* poster permanece disponível */ });
  });
}
function iniciarPrevia(carta, dados) {
  if (modoVisual !== 'galeria' || !carta.isConnected) return null;
  clearTimeout(temporizadorPrevia);
  if (cartaEmPrevia === carta) return playerPrevia;
  pararPrevia();
  clearTimeout(descartePrevia);
  cartaEmPrevia = carta;
  const src = fonteParaTocar(dados);
  if (playerPrevia.getAttribute('src') !== src) {
    playerPrevia.classList.remove('pronta');
    playerPrevia.src = src;
  }
  carta.querySelector('.quadro').appendChild(playerPrevia);
  carta.classList.add('previa');
  tocarPrevia();
  return playerPrevia;
}
function pararPrevia() {
  clearTimeout(temporizadorPrevia);
  clearTimeout(descartePrevia);
  revisaoPrevia++;
  buscaPrevia = null;
  cancelAnimationFrame(quadroBusca);
  quadroBusca = 0;
  playerPrevia.pause();
  playerPrevia.muted = true;
  if (cartaEmPrevia) {
    cartaEmPrevia.classList.remove('previa', 'checando');
    cartaEmPrevia.querySelector('.tempo').textContent = duracaoCurta(cartaEmPrevia._midia.duration || 0);
  }
  playerPrevia.remove();
  cartaEmPrevia = null;
  // Retém somente a última prévia por alguns segundos, sem reprodução em segundo plano.
  descartePrevia = setTimeout(() => { playerPrevia.removeAttribute('src'); playerPrevia.load(); }, 12000);
}
function atualizarBarraPrevia() {
  if (!cartaEmPrevia || !(playerPrevia.duration > 0)) return;
  const tempo = buscaPrevia == null ? playerPrevia.currentTime : buscaPrevia * playerPrevia.duration;
  const barra = cartaEmPrevia.querySelector('.barra-previa');
  barra.style.setProperty('--progresso', String(tempo / playerPrevia.duration));
  barra.setAttribute('aria-valuemax', String(Math.round(playerPrevia.duration)));
  barra.setAttribute('aria-valuenow', String(Math.round(tempo)));
  barra.setAttribute('aria-valuetext', duracaoCurta(tempo) + ' de ' + duracaoCurta(playerPrevia.duration));
  cartaEmPrevia.querySelector('.tempo').textContent = duracaoCurta(tempo) + ' / ' + duracaoCurta(playerPrevia.duration);
}
function executarBuscaPrevia() {
  quadroBusca = 0;
  if (buscaPrevia == null || !cartaEmPrevia || !Number.isFinite(playerPrevia.duration) || playerPrevia.duration <= 0) return;
  atualizarBarraPrevia();
  // Espera o seek atual antes de pedir o ponto mais recente do mouse.
  if (playerPrevia.seeking) return;
  const alvo = Math.min(playerPrevia.duration - 0.04, Math.max(0, buscaPrevia * playerPrevia.duration));
  if (Math.abs(playerPrevia.currentTime - alvo) > 0.04) playerPrevia.currentTime = alvo;
}
function buscarNaPrevia(carta, dados, fracao) {
  if (!iniciarPrevia(carta, dados)) return;
  buscaPrevia = Math.min(1, Math.max(0, fracao));
  carta.classList.add('checando');
  playerPrevia.pause();
  playerPrevia.muted = true;
  if (!quadroBusca) quadroBusca = requestAnimationFrame(executarBuscaPrevia);
}
function encerrarBuscaPrevia(carta) {
  if (carta !== cartaEmPrevia) return;
  carta.classList.remove('checando');
  buscaPrevia = null;
  tocarPrevia();
}
function adicionarBarraPrevia(carta, dados) {
  const barra = document.createElement('div');
  barra.className = 'barra-previa';
  barra.tabIndex = 0;
  barra.setAttribute('role', 'slider');
  barra.setAttribute('aria-label', 'Conferir trecho do vídeo');
  barra.setAttribute('aria-valuemin', '0');
  barra.setAttribute('aria-valuemax', String(Math.round(dados.duration || 100)));
  barra.setAttribute('aria-valuenow', '0');
  barra.innerHTML = '<span class="trilho-previa"><span></span></span>';
  const mover = e => {
    const rect = barra.getBoundingClientRect();
    buscarNaPrevia(carta, dados, (e.clientX - rect.left) / rect.width);
  };
  barra.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') mover(e); });
  barra.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' || barra.hasPointerCapture(e.pointerId)) mover(e); });
  barra.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); barra.focus({ preventScroll: true }); barra.setPointerCapture(e.pointerId); mover(e); });
  barra.addEventListener('pointerup', e => { if (barra.hasPointerCapture(e.pointerId)) barra.releasePointerCapture(e.pointerId); if (e.pointerType === 'touch') encerrarBuscaPrevia(carta); });
  barra.addEventListener('pointercancel', () => encerrarBuscaPrevia(carta));
  barra.addEventListener('pointerleave', e => { if (!barra.hasPointerCapture(e.pointerId)) encerrarBuscaPrevia(carta); });
  barra.addEventListener('blur', () => encerrarBuscaPrevia(carta));
  barra.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  barra.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Enter'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === ' ' || e.key === 'Enter') { encerrarBuscaPrevia(carta); return; }
    const duracao = dados.duration || 100;
    const atual = carta === cartaEmPrevia ? (buscaPrevia ?? playerPrevia.currentTime / duracao) : 0;
    buscarNaPrevia(carta, dados, e.key === 'Home' ? 0 : e.key === 'End' ? 1 : atual + (e.key === 'ArrowRight' ? 5 : -5) / duracao);
  });
  carta.querySelector('.quadro').appendChild(barra);
}
playerPrevia.addEventListener('loadeddata', () => { playerPrevia.classList.add('pronta'); atualizarBarraPrevia(); });
playerPrevia.addEventListener('loadedmetadata', executarBuscaPrevia);
playerPrevia.addEventListener('seeked', executarBuscaPrevia);
playerPrevia.addEventListener('timeupdate', atualizarBarraPrevia);
