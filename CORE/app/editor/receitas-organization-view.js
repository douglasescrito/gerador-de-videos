import { organizationOf } from './receitas-organization.js';
import { durationLabel, formatOf } from './receitas-model.js';
import { recipeTimeline } from './receitas-timeline-model.js';
import { mountTimeline } from './receitas-timeline-view.js';

const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
const button = (label, action, cls = 'quiet') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = action; return b; };
function source(paths) {
  if (!paths?.length) return el('span');
  const d = el('details', 'org-source'); d.append(el('summary', '', 'Ver origem da informação'));
  paths.forEach(path => d.append(el('code', '', path.join('.')))); return d;
}
function block(title, value, note, paths) {
  const cell = el('div', 'org-cell'); cell.append(el('h4', '', title));
  if (value) cell.append(el('p', 'org-value', value));
  if (note) cell.append(el('p', 'org-note', note));
  cell.append(source(paths)); return cell;
}
function facts(container, values) {
  for (const f of values) container.append(block(f.label, f.value, '', [f.path]));
}

export function renderOrganization(content, recipe, { onScene, onSection, editing }) {
  const o = organizationOf(recipe);
  content.append(el('h2', 'section-title', 'Como este vídeo é organizado'), el('p', 'section-intro', 'Leia a sequência, as falas e as escolhas de montagem. Tudo abaixo vem da receita; os tempos são planejados.'));
  const intro = el('div', 'org-intro');
  intro.append(el('span', 'eyebrow', 'Lógica da sequência'), el('h3', '', o.headline), el('p', 'org-summary', o.summary));
  if (o.principle) intro.append(el('p', 'org-principle', o.principle));
  if (typeof recipe.description === 'string' && recipe.description) intro.append(el('p', 'org-description', recipe.description));
  content.append(intro);
  const timeline = mountTimeline(content, recipeTimeline(recipe), { onScene, onSection });
  const metrics = el('div', 'org-metrics');
  for (const [title, value] of [['Sequência', `${o.scenes.length} ${recipe.kind === 'lote' ? 'peças' : 'etapas'}`], ['Soma das etapas', durationLabel(o.sum)], ['Formato', formatOf(recipe) || 'Não definido']]) { const m = el('div'); m.append(el('span', '', title), el('b', '', value)); metrics.append(m); }
  content.append(metrics);
  const cadence = el('div', 'org-cadence'); cadence.append(el('b', '', 'Ritmo e duração'), el('p', '', o.cadence));
  o.timing.forEach(note => cadence.append(el('p', 'org-note', note))); content.append(cadence);

  const title = el('div', 'org-heading'); title.append(el('h3', '', 'O vídeo, etapa por etapa'));
  const sequence = el('div', 'org-sequence');
  if (o.scenes.length) {
    const expand = button('Expandir todas', () => { const rows = [...sequence.querySelectorAll('.org-scene')]; const open = rows.some(n => !n.open); rows.forEach(n => { n.open = open; }); expand.textContent = open ? 'Recolher etapas' : 'Expandir todas'; }); title.append(expand);
    content.append(title);
  } else content.append(title, el('p', 'org-note', 'Esta receita não declara uma lista de etapas. O roteiro e as regras gerais estão abaixo.'));
  o.scenes.forEach((scene, i) => {
    const row = el('details', 'org-scene ' + scene.speech.kind); row.open = i === 0;
    const heading = el('summary'); const number = el('span', 'org-number', String(i + 1).padStart(2, '0'));
    const name = el('span', 'org-scene-name'); name.append(el('b', '', scene.name), el('small', '', scene.position));
    heading.append(number, name, el('span', 'org-voice-tag ' + scene.speech.kind, scene.speech.label), el('span', 'org-duration', durationLabel(scene.duration)));
    row.append(heading); const inside = el('div', 'org-scene-body');
    if (scene.purpose) inside.append(block('Papel declarado da etapa', scene.purpose));
    const cells = el('div', 'org-cells');
    const visual = block('O que aparece e acontece', scene.visual.text, scene.visual.text ? 'Direção declarada no idioma original da receita.' : 'A receita não descreve o conteúdo visual desta etapa.', [scene.visual.path]);
    if (scene.visual.full !== scene.visual.text) { const full = el('details', 'org-full-direction'); full.append(el('summary', '', 'Ler direção completa'), el('p', 'org-value', scene.visual.full)); visual.append(full); }
    cells.append(visual);
    const speech = block('Quem fala e o que é dito', scene.speech.text, scene.speech.note, scene.speech.paths);
    if (scene.speech.voice) speech.prepend(el('span', 'tag purple', `Voz: ${scene.speech.voice}`));
    cells.append(speech, block('Texto que aparece na tela', scene.screen.text, scene.screen.note, scene.screen.paths));
    cells.append(block('Som e música nesta etapa', scene.sound, o.music.declared ? 'Há trilha prevista para a produção. Entradas e saídas por cena precisam estar descritas na direção ou nas regras de áudio.' : 'Não há trilha declarada em campo próprio. Confira a direção sonora do prompt.', scene.sound ? [scene.visual.path] : []));
    inside.append(cells);
    const foot = el('div', 'org-scene-foot'); foot.append(el('p', '', scene.transition), button(editing ? 'Editar esta etapa' : 'Abrir campos desta etapa', () => onScene(i)));
    inside.append(foot); if (scene.transitionPath.length) inside.append(source([scene.transitionPath])); row.append(inside); sequence.append(row);
  }); content.append(sequence);

  const globalHeading = el('div', 'org-heading'); globalHeading.append(el('h3', '', 'O que conecta as etapas')); content.append(globalHeading);
  const audio = el('details', 'org-global'); audio.open = o.narration.unmappedCount > 0;
  audio.append(el('summary', '', 'Roteiro, voz e sincronismo'));
  const audioBody = el('div', 'org-global-body');
  audioBody.append(block('Organização da voz', o.narration.hasNarration ? `${o.narration.blocks.length} blocos de fala declarados${o.narration.voice ? ` · voz: ${o.narration.voice}` : ''}.` : 'Narração não declarada em campo próprio.', o.narration.syncNote));
  if (o.narration.unmappedCount) audioBody.append(el('p', 'org-mapping-note', `${o.narration.unmappedCount} bloco(s) de voz não têm vínculo identificável com uma etapa. Eles aparecem abaixo, sem associação inventada.`));
  if (o.narration.fullText) audioBody.append(block('Roteiro completo', o.narration.fullText, '', [o.narration.fullTextPath]));
  o.narration.blocks.filter(b => !b.mapped).forEach((b, i) => audioBody.append(block(`Bloco sem etapa vinculada · ${b.id || i + 1}`, b.text || 'Texto não informado', b.direction || '')));
  audioBody.append(button('Abrir configurações de voz e som', () => onSection('audio'))); audio.append(audioBody); content.append(audio);
  const music = el('details', 'org-global'); music.append(el('summary', '', 'Trilha, efeitos e mixagem'));
  const musicBody = el('div', 'org-global-body'); musicBody.append(el('p', 'org-note', o.music.declared ? 'A trilha está prevista. Estas são as instruções de duração, intenção e volume declaradas para a produção.' : 'A receita não declara uma trilha em campo próprio. Ela ainda pode pedir som dentro dos prompts.'));
  facts(musicBody, o.music.facts); musicBody.append(button('Abrir configurações de áudio', () => onSection('audio'))); music.append(musicBody); content.append(music);
  if (o.direction.length) { const visual = el('details', 'org-global'); visual.append(el('summary', '', 'Linguagem visual que se repete nas cenas')); const visualBody = el('div', 'org-global-body'); facts(visualBody, o.direction); visualBody.append(button('Abrir direção visual', () => onSection('visual'))); visual.append(visualBody); content.append(visual); }
  const ending = el('details', 'org-global'); ending.open = true; ending.append(el('summary', '', 'Como o vídeo termina'));
  const endingBody = el('div', 'org-global-body');
  if (o.finish.length) facts(endingBody, o.finish);
  else endingBody.append(el('p', 'org-note', 'A receita não declara uma regra específica de encerramento nos campos de finalização. A direção da última etapa pode trazer essa intenção.'));
  endingBody.append(button('Abrir montagem e entrega', () => onSection('finalizacao'))); ending.append(endingBody); content.append(ending);
  if (editing) content.append(el('p', 'route-note', 'Este mapa acompanha os campos da versão que você está editando. Salve uma derivação para preservar as alterações.'));
  return () => timeline.dispose();
}
