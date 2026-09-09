import { STRUCTURE_PATTERNS, patternTimeline } from './receitas-timeline-model.js';
import { mountTimeline } from './receitas-timeline-view.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
export function renderStructureMap(container, { onBack, pattern = 'comercial-desenvolvido' }) {
  let selected = STRUCTURE_PATTERNS.some(p => p.id === pattern) ? pattern : 'comercial-desenvolvido', timeline;
  container.replaceChildren();
  const heading = el('div', 'structure-map-heading'), back = el('button', 'quiet', '←'); back.type = 'button'; back.setAttribute('aria-label', 'Voltar à biblioteca'); back.onclick = onBack;
  const intro = el('div'); intro.append(el('span', 'eyebrow', 'Como as receitas organizam um vídeo'), el('h1', '', 'Mapa de estruturas'), el('p', '', 'Escolha um padrão e acompanhe o papel de cada etapa. As faixas mostram como narrativa, imagem, voz e som trabalham juntos. Clique em um bloco para entender sua função.')); heading.append(back, intro); container.append(heading);
  const controls = el('div', 'structure-map-controls'), patterns = el('div', 'structure-patterns'); patterns.setAttribute('role', 'group'); patterns.setAttribute('aria-label', 'Padrões de estrutura');
  const buttons = new Map();
  for (const p of STRUCTURE_PATTERNS) { const b = el('button', 'quiet', p.name); b.type = 'button'; b.onclick = () => { selected = p.id; render(); }; buttons.set(p.id, b); patterns.append(b); }
  const presentation = el('label', 'structure-presentation', 'Forma de apresentar'), select = el('select'); select.setAttribute('aria-label', 'Forma de apresentar');
  for (const [value, text] of [['narration', 'Narração sobre imagens'], ['alternate', 'Apresentador + narração'], ['sync', 'Palavras sincronizadas']]) { const option = el('option', '', text); option.value = value; select.append(option); }
  select.onchange = render; presentation.append(select); controls.append(patterns, presentation); container.append(controls);
  const experiment = el('a', 'button quiet', 'Abrir editor experimental ↗'); experiment.href = '/editor?experimental=1';
  const experimentRow = el('div', 'library-map-entry'); const explanation = el('div'); explanation.append(el('b', '', 'Veja uma produção como ela foi montada'), el('p', '', 'Monitor de vídeo, trechos usados, cortes de entrada e ondas de áudio dos arquivos reais.')); experimentRow.append(explanation, experiment); container.append(experimentRow);
  const host = el('div'); container.append(host);
  function render() {
    timeline?.dispose(); host.replaceChildren();
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(selected === id));
    timeline = mountTimeline(host, patternTimeline(selected, select.value));
    window.history.replaceState(null, '', '/receitas?mapa=estruturas&padrao=' + encodeURIComponent(selected));
  }
  render();
  return () => timeline?.dispose();
}
