import { positionLabel } from './receitas-timeline-model.js';

const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
const button = (label, fn, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };
const colors = { story:'#b39aff', visual:'#829df8', voice:'#ac8bea', text:'#e4bc6a', sound:'#73baa9', finish:'#dc9892' };

export function mountTimeline(parent, model, { onScene, onSection } = {}) {
  const root = el('section', 'recipe-timeline'); root.setAttribute('aria-label', 'Linha do tempo da estrutura'); root.tabIndex = -1;
  const head = el('div', 'tl-head'), caption = el('div');
  caption.append(el('span', 'eyebrow', model.mode === 'pattern' ? 'Mapa de estrutura' : 'Receita na linha do tempo'), el('h3', '', model.title));
  const expand = button('Ampliar', async () => { try { if (document.fullscreenElement === root) await document.exitFullscreen(); else await root.requestFullscreen(); } catch { status.textContent = 'O navegador não permitiu ampliar. O zoom da régua continua disponível.'; } }, 'quiet');
  if (!root.requestFullscreen) expand.hidden = true;
  head.append(caption, expand); root.append(head);
  const tools = el('div', 'tl-tools'), navigation = el('div', 'tl-navigation');
  let cursor = 0, selected = null, zoom = 1, selectedStage = 0, width = 500, disposed = false;
  const previous = button('←', () => selectStage(selectedStage - 1), 'quiet'); previous.setAttribute('aria-label', 'Etapa anterior');
  const next = button('→', () => selectStage(selectedStage + 1), 'quiet'); next.setAttribute('aria-label', 'Próxima etapa');
  const position = el('output', 'tl-position'); position.setAttribute('aria-label', 'Posição na estrutura');
  navigation.append(previous, next, position);
  const zoomLabel = el('label', 'tl-zoom', 'Zoom'), range = el('input'); range.type = 'range'; range.min = '1'; range.max = '4'; range.step = '.25'; range.value = '1'; range.setAttribute('aria-label', 'Zoom da linha do tempo');
  const fit = button('Ajustar', () => { range.value = '1'; zoom = 1; resize(); }, 'quiet');
  range.oninput = () => { zoom = Number(range.value); resize(); viewport.scrollLeft = Math.max(0, cursor / model.extent * width - viewport.clientWidth / 2); };
  zoomLabel.append(range); tools.append(navigation, el('span', 'tl-scale-caption', model.subtitle), zoomLabel, fit); root.append(tools);

  const layout = el('div', 'tl-layout'), viewport = el('div', 'tl-viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Faixas da estrutura; use as setas para percorrer');
  const sheet = el('div', 'tl-sheet'), rulerRow = el('div', 'tl-row tl-ruler-row');
  rulerRow.append(el('div', 'tl-row-label', model.unit === 'seconds' ? 'TEMPO' : 'ETAPAS'));
  const ruler = el('div', 'tl-ruler'); ruler.setAttribute('role', 'slider'); ruler.tabIndex = 0; ruler.setAttribute('aria-label', 'Cursor da linha do tempo'); ruler.setAttribute('aria-valuemin', '0'); ruler.setAttribute('aria-valuemax', String(model.extent));
  rulerRow.append(ruler); sheet.append(rulerRow);
  const allButtons = new Map();
  for (const track of model.tracks) {
    const row = el('div', 'tl-row'); row.style.setProperty('--track-color', colors[track.id]);
    const label = el('div', 'tl-row-label'); label.append(el('b', '', track.short), el('span', '', track.label)); row.append(label);
    const lane = el('div', 'tl-lane'); lane.dataset.track = track.id;
    if (!track.clips.length) lane.append(el('span', 'tl-empty', 'Sem bloco posicionado'));
    for (const clip of track.clips) {
      const b = button('', () => select(clip), 'tl-clip ' + (clip.window ? 'window ' : '') + clip.kind);
      b.style.left = `${clip.start / model.extent * 100}%`; b.style.width = `${(clip.end - clip.start) / model.extent * 100}%`;
      b.setAttribute('aria-label', `${track.label} · ${clip.title}`); b.setAttribute('aria-pressed', 'false'); b.title = clip.title;
      b.append(el('span', '', clip.title), el('small', '', model.unit === 'seconds' ? `${positionLabel(clip.start, 'seconds')} – ${positionLabel(clip.end, 'seconds')}` : `Etapa ${clip.index + 1}`));
      lane.append(b); allButtons.set(clip.id, b);
    }
    row.append(lane); sheet.append(row);
  }
  const playhead = el('div', 'tl-playhead'); playhead.setAttribute('aria-hidden', 'true'); sheet.append(playhead); viewport.append(sheet);
  const inspector = el('aside', 'tl-inspector'); inspector.setAttribute('aria-label', 'Detalhes do bloco selecionado');
  layout.append(viewport, inspector); root.append(layout);
  const status = el('p', 'tl-status', 'Selecione um bloco para ver sua função. Arraste o cursor na régua para percorrer a estrutura.'); status.setAttribute('role', 'status'); root.append(status);
  if (model.pending.length) {
    const pending = el('div', 'tl-pending'); pending.append(el('b', '', 'Sem posição definida na régua'));
    const chips = el('div'); for (const item of model.pending) { const b = button(item.title, () => select(item), 'tl-pending-chip ' + item.kind); b.setAttribute('aria-pressed', 'false'); allButtons.set(item.id, b); chips.append(b); } pending.append(chips); root.append(pending);
  }
  root.append(el('p', 'tl-explanation', model.note));
  root.append(el('p', 'tl-explanation', 'Clique nos blocos para ler os detalhes. Arraste o cursor na régua ou use as setas do teclado para percorrer.'));
  for (const note of model.notes || []) root.append(el('p', 'tl-explanation', note));
  parent.append(root);

  function rangeText(clip) {
    if (clip.start == null) return 'Posição não determinada';
    return model.unit === 'seconds' ? `${positionLabel(clip.start, 'seconds')} → ${positionLabel(clip.end, 'seconds')}${clip.window ? ' · janela da cena' : ''}` : `Etapa ${clip.index + 1} de ${model.spans.length}`;
  }
  function select(clip, move = true) {
    selected = clip;
    for (const [id, b] of allButtons) b.setAttribute('aria-pressed', String(id === clip.id));
    if (clip.index != null) { selectedStage = clip.index; if (move) { setCursor(clip.start); revealCursor(); } }
    previous.disabled = selectedStage <= 0; next.disabled = selectedStage >= model.spans.length - 1;
    inspector.replaceChildren(el('span', 'eyebrow', 'Bloco selecionado'), el('h4', '', clip.title), el('p', 'tl-detail-position', rangeText(clip)));
    const body = el('div', 'tl-detail-body');
    for (const fact of clip.facts || []) { const item = el('div'); item.append(el('b', '', fact.label), el('p', '', fact.value)); body.append(item); } inspector.append(body);
    if (clip.sceneIndex != null && onScene) inspector.append(button('Abrir campos desta cena', () => onScene(clip.sceneIndex), 'quiet'));
    else if (clip.section && onSection) inspector.append(button('Abrir configurações', () => onSection(clip.section), 'quiet'));
    status.textContent = clip.start == null ? `${clip.title} · posição ainda não definida.` : `${clip.title} · ${rangeText(clip)}.`;
  }
  function setCursor(value) {
    cursor = Math.min(Math.max(0, value), model.extent);
    const shown = model.unit === 'steps' ? Math.min(cursor, model.extent - .0001) : cursor;
    position.textContent = positionLabel(shown, model.unit);
    ruler.setAttribute('aria-valuenow', String(Math.round(cursor * 100) / 100)); ruler.setAttribute('aria-valuetext', position.textContent);
    playhead.style.left = `calc(var(--tl-label) + ${cursor / model.extent * width}px)`;
  }
  function selectStage(index, move = true) {
    index = Math.min(Math.max(0, index), model.spans.length - 1);
    const row = model.tracks.find(t => t.id === (model.mode === 'pattern' ? 'story' : 'visual'));
    const clip = row?.clips.find(c => c.index === index); if (clip) select(clip, move);
  }
  function revealCursor() {
    const label = parseFloat(getComputedStyle(root).getPropertyValue('--tl-label')) || 116;
    const x = label + cursor / model.extent * width;
    if (x < viewport.scrollLeft + label + 12) viewport.scrollLeft = Math.max(0, x - label - 12);
    else if (x > viewport.scrollLeft + viewport.clientWidth - 12) viewport.scrollLeft = x - viewport.clientWidth + 24;
  }
  function seek(value) {
    setCursor(value);
    const index = cursor === model.extent ? model.spans.length - 1 : model.spans.findIndex(s => cursor >= s.start && cursor < s.end);
    if (index >= 0 && index !== selectedStage) selectStage(index, false);
    revealCursor();
  }
  function pointer(e) { const rect = ruler.getBoundingClientRect(); seek((e.clientX - rect.left) / rect.width * model.extent); }
  ruler.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); ruler.focus({ preventScroll: true }); ruler.setPointerCapture(e.pointerId); pointer(e); };
  ruler.onpointermove = e => { if (ruler.hasPointerCapture(e.pointerId)) pointer(e); };
  ruler.onpointerup = e => { if (ruler.hasPointerCapture(e.pointerId)) { pointer(e); ruler.releasePointerCapture(e.pointerId); } };
  viewport.onkeydown = e => {
    if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(model.extent); selectStage(model.spans.length - 1, false); }
    else if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); const step = model.unit === 'seconds' ? e.shiftKey ? .1 : 1 : 1; seek(cursor + (e.key === 'ArrowRight' ? step : -step)); }
  };
  function resize() {
    if (disposed) return;
    const label = parseFloat(getComputedStyle(root).getPropertyValue('--tl-label')) || 116;
    width = Math.max(200, viewport.clientWidth - label) * zoom;
    sheet.style.width = `${width + label}px`;
    ruler.replaceChildren();
    const tickCount = model.unit === 'steps' ? Math.min(60, model.extent) : Math.max(2, Math.min(30, Math.floor(width / 80)));
    for (let i = 0; i <= tickCount; i++) {
      if (model.unit === 'steps' && i === tickCount) continue;
      const n = model.unit === 'steps' ? i : model.extent * i / tickCount;
      const tick = el('span', 'tl-tick', model.unit === 'steps' ? String(i + 1).padStart(2, '0') : positionLabel(n, 'seconds'));
      tick.style.left = `${n / model.extent * 100}%`; if (i === tickCount) tick.classList.add('last'); ruler.append(tick);
    }
    setCursor(cursor);
  }
  const observer = new ResizeObserver(() => { if (!root.isConnected) { observer.disconnect(); return; } resize(); }); observer.observe(viewport);
  const fullscreen = () => { expand.textContent = document.fullscreenElement === root ? 'Reduzir' : 'Ampliar'; resize(); };
  root.addEventListener('fullscreenchange', fullscreen);
  resize(); selectStage(0);
  if (!selected) { inspector.append(el('p', '', 'Esta receita não declara cenas. Os elementos sem posição ficam abaixo.')); previous.disabled = next.disabled = true; }
  return { root, dispose() { disposed = true; observer.disconnect(); if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {}); root.removeEventListener('fullscreenchange', fullscreen); } };
}
