import { GROUPS, SCHEMAS, FIELD_HELP, fieldName, titleOf, summaryOf, scenesOf, durationLabel, getAt, setAt, cleanName } from './receitas-model.js';
import { renderOrganization } from './receitas-organization-view.js';
import { organizationOf } from './receitas-organization.js';
import { renderStructureMap } from './receitas-structure-map.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (text, cls, action) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = action; return b; };
let items = [], filter = 'all', limit = 24, current = null, draft = null, editing = false, dirty = false, tab = 'overview', sceneIndex = 0;
let history = [], validation = null, validationTimer, validationSequence = 0, readSequence = 0, jsonError = null, leaveAction, toastTimer, saveAttempt = null;
const clone = value => structuredClone(value);
let visualizationCleanup = null, mapCleanup = null;
function clearVisualizations() { visualizationCleanup?.(); visualizationCleanup = null; mapCleanup?.(); mapCleanup = null; $('structure-map').replaceChildren(); $('recipe-content').replaceChildren(); }

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result;
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
function guard(action) {
  if (!dirty) return action();
  leaveAction = action; $('leave-dialog').showModal();
}
$('stay-editing').onclick = () => $('leave-dialog').close();
$('discard-edit').onclick = () => { dirty = false; $('leave-dialog').close(); leaveAction?.(); };
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
document.querySelectorAll('.studio-header a').forEach(a => a.addEventListener('click', e => { if (dirty) { e.preventDefault(); guard(() => location.assign(a.href)); } }));

async function loadLibrary() {
  const result = await api('/api/receitas');
  items = result.items;
  $('library-count').textContent = `${items.length} receitas no Studio`;
  renderFilters(); renderLibrary();
}
function renderFilters() {
  const choices = [['all', 'Todas as receitas', items.length], ['derived', 'Minhas derivações', items.filter(r => r.derived).length], ['drafts', 'Rascunhos', items.filter(r => r.draft).length],
    ...Object.entries(SCHEMAS).map(([id, label]) => [id, label, items.filter(r => r.schema === id).length]), ['music', 'Com trilha sonora', items.filter(r => r.music).length], ['review', 'Estrutura a revisar', items.filter(r => !r.validation?.valid).length]];
  $('library-filters').replaceChildren();
  choices.forEach(([id, label, count], i) => {
    if (i === 3 || i === 6) $('library-filters').append(el('div', 'side-divider'));
    const b = button(label, 'side-filter' + (filter === id ? ' active' : ''), () => { filter = id; limit = 24; renderFilters(); renderLibrary(); });
    b.setAttribute('aria-pressed', String(filter === id)); b.append(el('span', '', count)); $('library-filters').append(b);
  });
}
function renderLibrary() {
  const term = $('recipe-search').value.trim().toLocaleLowerCase('pt-BR');
  const result = items.filter(r => {
    if (filter === 'derived' && !r.derived || filter === 'drafts' && !r.draft || filter === 'music' && !r.music || filter === 'review' && r.validation?.valid) return false;
    if (SCHEMAS[filter] && r.schema !== filter) return false;
    if ($('recipe-aspect').value && r.aspect !== $('recipe-aspect').value) return false;
    return !term || [r.title, r.description, r.style, r.voice, r.family, r.file, r.organization?.headline, r.organization?.summary].join(' ').toLocaleLowerCase('pt-BR').includes(term);
  });
  const order = $('recipe-order').value;
  result.sort(order === 'recent' ? (a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)) : order === 'duration' ? (a, b) => (b.duration || 0) - (a.duration || 0) : (a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  $('result-caption').textContent = `${result.length} receita${result.length === 1 ? '' : 's'}${term ? ` para “${$('recipe-search').value.trim()}”` : ' para explorar'}`;
  $('recipe-grid').replaceChildren();
  for (const r of result.slice(0, limit)) {
    const card = button('', 'recipe-card', () => guard(() => openRecipe(r.file)));
    card.setAttribute('aria-label', `Abrir receita: ${r.title}`);
    card.dataset.family = r.schema?.includes('sincronia') ? 'sync' : r.schema?.endsWith('@2') ? 'master' : 'scenes';
    const head = el('div', 'recipe-card-head'); head.append(el('span', 'family-label', r.organization?.headline || r.family), el('span', `tag ${r.draft || !r.validation?.valid ? 'amber' : r.derived ? 'purple' : ''}`, r.draft ? 'Rascunho' : !r.validation?.valid ? 'Revisar' : r.derived ? 'Derivação' : 'Original'));
    const body = el('div', 'recipe-card-body'); body.append(el('h2', '', r.title), el('p', '', r.description || 'Abra para explorar a estrutura, os parâmetros e os recursos desta receita.'));
    const metrics = el('div', 'recipe-card-metrics'); metrics.append(el('span', '', durationLabel(r.duration)), el('span', '', r.aspect || 'Formato não definido'), el('span', '', `${r.sceneCount || 0} ${r.schema?.includes('sincronia') ? 'etapas' : 'cenas/partes'}`)); body.append(metrics);
    if (r.organization) { const organization = el('div', 'recipe-card-organization'); organization.append(el('b', '', 'Como organiza'), el('span', '', r.organization.summary), el('small', '', r.organization.cadence)); body.append(organization); }
    const tags = el('div', 'recipe-card-tags'); if (r.narration) tags.append(el('span', 'tag', r.voice ? `Voz · ${r.voice}` : 'Narração')); if (r.music) tags.append(el('span', 'tag teal', 'Trilha')); if (r.style) tags.append(el('span', 'tag', cleanName(r.style))); body.append(tags);
    const strip = el('div', 'recipe-strip'); for (let i = 0; i < Math.min(18, r.sceneCount || 1); i++) { const segment = el('span', r.organization?.roles?.[i] || ''); strip.append(segment); }
    const foot = el('div', 'recipe-card-foot'); foot.append(el('span', '', 'Explorar estrutura'), el('span', '', '↗')); card.append(head, body, strip, foot); $('recipe-grid').append(card);
  }
  if (!result.length) { const empty = el('div', 'empty library-error'); empty.append(el('b', '', 'Nenhuma receita neste filtro'), el('span', '', 'Tente outro termo ou volte a todas as receitas.')); $('recipe-grid').append(empty); }
  $('load-more').hidden = result.length <= limit;
}
for (const id of ['recipe-search', 'recipe-aspect', 'recipe-order']) $(id).addEventListener(id === 'recipe-search' ? 'input' : 'change', () => { limit = 24; renderLibrary(); });
$('load-more').onclick = () => { limit += 24; renderLibrary(); };

async function openRecipe(file) {
  const sequence = ++readSequence;
  try {
    const data = await api('/api/receitas/item?file=' + encodeURIComponent(file));
    if (sequence !== readSequence) return;
    clearTimeout(validationTimer); validationSequence++;
    current = data; draft = clone(data.document); editing = false; dirty = false; history = []; jsonError = null; validation = data.validation; tab = 'overview'; sceneIndex = 0; saveAttempt = null;
    clearVisualizations(); $('structure-map').hidden = true;
    $('library').hidden = true; $('editor').hidden = false;
    window.history.replaceState(null, '', '/receitas?file=' + encodeURIComponent(file));
    renderEditor(); window.scrollTo({ top: 0 });
  } catch (e) { toast(e.message); }
}
function backLibrary() { guard(() => { clearVisualizations(); readSequence++; clearTimeout(validationTimer); validationSequence++; current = null; dirty = false; editing = false; $('structure-map').hidden = true; $('editor').hidden = true; $('library').hidden = false; window.history.replaceState(null, '', '/receitas'); renderLibrary(); window.scrollTo({ top: 0 }); }); }
function showStructureMap(pattern) { guard(() => {
  clearVisualizations(); readSequence++; clearTimeout(validationTimer); validationSequence++; current = null; dirty = false; editing = false;
  $('editor').hidden = true; $('library').hidden = true; $('structure-map').hidden = false;
  mapCleanup = renderStructureMap($('structure-map'), { onBack: backLibrary, pattern }); window.scrollTo({ top: 0 });
}); }
$('open-structure-map').onclick = () => showStructureMap();
$('back-library').onclick = backLibrary;
$('start-edit').onclick = () => { editing = true; history = []; renderEditor(); toast('Edite os campos e salve como uma nova derivação.'); };
$('cancel-edit').onclick = () => guard(() => { clearTimeout(validationTimer); validationSequence++; draft = clone(current.document); dirty = false; editing = false; jsonError = null; validation = current.validation; renderEditor(); });
function remember() { const value = JSON.stringify(draft); if (history.at(-1) !== value) history.push(value); if (history.length > 40) history.shift(); }
function changed() { dirty = true; saveAttempt = null; validation = null; validationSequence++; updateHeader(); renderInspector(); clearTimeout(validationTimer); validationTimer = setTimeout(() => validateNow(), 700); }
$('undo-edit').onclick = () => { const previous = history.pop(); if (!previous) return; draft = JSON.parse(previous); jsonError = null; dirty = JSON.stringify(draft) !== JSON.stringify(current.document); clearTimeout(validationTimer); renderEditor(); validateNow(); };
function updateHeader() {
  $('recipe-title').textContent = titleOf(draft);
  $('editor-family').textContent = SCHEMAS[draft.schema] || 'Receita';
  $('editor-state').textContent = editing ? dirty ? 'Alterações não salvas' : 'Editando uma nova versão' : current.draft ? 'Rascunho' : current.derived ? 'Derivação' : 'Original';
  $('editor-state').className = 'tag ' + (editing ? 'editing-badge' : current.draft ? 'amber' : 'purple');
  $('start-edit').hidden = editing; $('save-edit').hidden = !editing; $('cancel-edit').hidden = !editing; $('undo-edit').hidden = !editing; $('undo-edit').disabled = !history.length;
}
function switchTab(id) {
  if (jsonError && id !== 'json') { toast('Corrija o JSON ou use Desfazer antes de trocar de seção.'); return; }
  tab = id; renderNav(); renderContent();
}
function renderNav() {
  $('section-nav').replaceChildren();
  for (const [id, label] of [['overview', 'Como organiza o vídeo'], ...GROUPS.map(g => [g.id, g.title]), ['json', 'JSON completo']]) {
    const b = button(label, 'section-button' + (tab === id ? ' active' : ''), () => switchTab(id)); b.setAttribute('aria-current', tab === id ? 'page' : 'false');
    if (id === 'estrutura') b.append(el('small', '', scenesOf(draft).length)); $('section-nav').append(b);
  }
}
function renderEditor() { updateHeader(); renderNav(); renderContent(); renderInspector(); }
function renderInspector() {
  const status = el('div', 'validation' + (validation ? validation.valid ? '' : ' invalid' : ' waiting'));
  status.append(el('b', '', jsonError ? 'JSON precisa de revisão' : validation ? validation.valid ? '✓ Estrutura válida' : 'Revisão necessária' : 'Conferindo alterações…'));
  status.append(el('p', '', jsonError || validation?.message || 'A conferência usa as regras do formato desta receita.'));
  $('validation-status').replaceChildren(status);
  const r = summaryOf(draft); const states = [['Roteiro e cenas', scenesOf(draft).length > 0 || Boolean(draft.roteiro)], ['Voz / narração', r.narration], ['Música', r.music], ['Direção visual', Boolean(draft.style || draft.identidade || draft.videoGeneration || draft.scenes)], ['Montagem e entrega', Boolean(draft.assembly || draft.delivery || draft.fecho)]];
  $('recipe-map').replaceChildren();
  for (const [label, present] of states) { const row = el('div', 'map-row' + (present ? '' : ' missing')); row.append(el('span', 'map-dot'), el('span', '', label + (present ? '' : ' · não definida'))); $('recipe-map').append(row); }
  const origin = el('div', 'origin'); origin.append(el('strong', '', current.derived ? 'Derivação salva' : 'Receita da biblioteca'), el('span', '', current.file));
  if (current.lineage?.source) { const p = el('p', '', 'Derivada de '); const a = el('a', '', current.lineage.source.file); a.href = '/receitas?file=' + encodeURIComponent(current.lineage.source.file); a.onclick = e => { e.preventDefault(); guard(() => openRecipe(current.lineage.source.file)); }; p.append(a); origin.append(p); }
  origin.append(el('p', '', 'Atualizada em ' + new Date(current.modifiedAt).toLocaleDateString('pt-BR')));
  const provenance = el('details'); provenance.append(el('summary', '', 'Identificação do arquivo'), el('code', '', current.hash)); origin.append(provenance); $('recipe-origin').replaceChildren(origin);
}
async function validateNow() {
  clearTimeout(validationTimer);
  const sequence = ++validationSequence;
  if (jsonError) { validation = { valid: false, message: jsonError }; renderInspector(); return validation; }
  try {
    const value = await api('/api/receitas/validar', { document: draft });
    if (sequence === validationSequence) { validation = value; renderInspector(); }
    return value;
  } catch (e) { const value = { valid: false, message: e.message }; if (sequence === validationSequence) { validation = value; renderInspector(); } return value; }
}
$('validate-recipe').onclick = validateNow;

function renderContent() {
  visualizationCleanup?.(); visualizationCleanup = null;
  const content = $('recipe-content'); content.replaceChildren();
  if (tab === 'overview') return renderOverview(content);
  if (tab === 'json') return renderJson(content);
  const group = GROUPS.find(g => g.id === tab);
  content.append(el('h2', 'section-title', group.title), el('p', 'section-intro', group.intro));
  if (tab === 'estrutura' && scenesOf(draft).length) renderScenes(content);
  const known = new Set(GROUPS.flatMap(g => g.keys));
  const keys = [...group.keys, ...(tab === 'tecnico' ? Object.keys(draft).filter(k => !known.has(k)) : [])].filter(k => Object.hasOwn(draft, k));
  let rendered = 0;
  for (const key of keys) {
    if (tab === 'estrutura' && ['scenes', 'parts'].includes(key) && Array.isArray(draft[key]) && draft[key].length) continue;
    if (tab === 'estrutura' && ['program', 'videoGeneration'].includes(key) && draft[key] && typeof draft[key] === 'object') {
      for (const field of Object.keys(draft[key])) if (field !== 'shots') { content.append(renderField([key, field])); rendered++; }
    } else { content.append(renderField([key])); rendered++; }
  }
  if (!rendered && !(tab === 'estrutura' && scenesOf(draft).length)) content.append(el('div', 'section-empty', 'Esta receita não declara campos nesta seção. O JSON completo permite consultar e acrescentar configurações compatíveis com seu formato.'));
}
function renderOverview(content) {
  const openSection = id => { switchTab(id); content.scrollIntoView({ block: 'start' }); };
  content.append(button('Comparar padrões de estrutura ↗', 'quiet', () => showStructureMap()));
  content.append(button('Abrir no editor experimental ↗', 'quiet', () => guard(() => location.assign('/editor?experimental=1&file=' + encodeURIComponent(current.file)))));
  content.append(button('Criar vídeo com esta receita →', 'primary', () => guard(() => location.assign('/gerador?file=' + encodeURIComponent(current.file)))));
  visualizationCleanup = renderOrganization(content, draft, { editing, onScene: index => { sceneIndex = index; openSection('estrutura'); }, onSection: openSection });
}
function renderScenes(content) {
  const scenes = scenesOf(draft); sceneIndex = Math.min(sceneIndex, scenes.length - 1);
  const tabs = el('div', 'scene-tabs'); scenes.forEach((s, i) => { const b = button(`${i + 1}. ${cleanName(s.name)}`, i === sceneIndex ? 'active' : '', () => { sceneIndex = i; renderContent(); }); b.setAttribute('aria-pressed', String(i === sceneIndex)); tabs.append(b); }); content.append(tabs);
  const scene = scenes[sceneIndex]; const toolbar = el('div', 'scene-toolbar'); toolbar.append(el('h3', '', cleanName(scene.name)));
  // Reordenação de receita@1 é direta. Vínculos da Receita Mestre ficam explícitos nos campos.
  if (editing && scene.path.length === 2 && ['scenes', 'parts'].includes(scene.path[0])) {
    const actions = el('div', 'actions');
    for (const [label, delta] of [['← Mover', -1], ['Mover →', 1]]) { const b = button(label, 'quiet', () => { remember(); const list = draft[scene.path[0]], target = sceneIndex + delta; [list[sceneIndex], list[target]] = [list[target], list[sceneIndex]]; sceneIndex = target; changed(); renderEditor(); }); b.disabled = sceneIndex + delta < 0 || sceneIndex + delta >= scenes.length; actions.append(b); }
    actions.append(button('Duplicar cena', 'quiet', () => { remember(); const list = draft[scene.path[0]], copy = clone(list[sceneIndex]); if (copy?.id) copy.id += '-copia-' + crypto.randomUUID().slice(0, 4); if (copy?.name) copy.name += ' cópia'; list.splice(sceneIndex + 1, 0, copy); sceneIndex++; changed(); renderEditor(); })); toolbar.append(actions);
  }
  content.append(toolbar, renderField(scene.path, 'Conteúdo da cena', true));
  for (const path of scene.related) content.append(renderField(path, 'Direção e referências desta cena', true));
  const organization = organizationOf(draft).scenes[sceneIndex];
  const voicePaths = organization.speech.paths.filter(path => path.includes('blocks'));
  if (voicePaths.length && organization.speech.inferred) content.append(el('p', 'org-note', organization.speech.note));
  for (const path of voicePaths) content.append(renderField(path, 'Narração vinculada a esta cena', true));
  for (const path of organization.screen.paths.filter(path => path[0] === 'graphics')) content.append(renderField(path, 'Texto e grafismos desta cena', true));
}
function renderField(path, override, open = false, depth = 0) {
  const value = getAt(draft, path), key = String(path.at(-1)), label = override || fieldName(key);
  if (value && typeof value === 'object') {
    const box = el('details', 'field-box'); box.open = open || depth === 0;
    const summary = el('summary', '', label); summary.append(el('small', '', Array.isArray(value) ? `${value.length} itens` : `${Object.keys(value).length} campos`)); box.append(summary);
    const body = el('div', 'field-box-body');
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const row = el('div', 'array-item');
        if (editing) { const tools = el('div', 'array-tools'); tools.append(button('Duplicar item', 'quiet', () => { remember(); const copy = clone(item); if (copy && typeof copy === 'object' && copy.id) copy.id += '-copia-' + crypto.randomUUID().slice(0, 4); value.splice(i + 1, 0, copy); changed(); renderEditor(); }), button('Remover item', 'quiet', () => { remember(); value.splice(i, 1); changed(); renderEditor(); })); row.append(tools); }
        row.append(renderField([...path, i], item?.label || item?.name || item?.nome || item?.id || `Item ${i + 1}`, false, depth + 1)); body.append(row);
      });
      if (!value.length) body.append(el('p', 'read-value null', 'Nenhum item declarado.'));
      if (editing) body.append(button('+ Adicionar item', 'quiet add-item', () => { remember(); const first = value[0]; const next = first && typeof first === 'object' ? clone(first) : typeof first === 'number' ? 0 : ''; if (next && typeof next === 'object' && next.id) next.id += '-novo-' + crypto.randomUUID().slice(0, 4); value.push(next); changed(); renderEditor(); }));
    } else {
      for (const child of Object.keys(value)) body.append(renderField([...path, child], null, false, depth + 1));
      if (!Object.keys(value).length) body.append(el('p', 'read-value null', 'Nenhum campo declarado. Use o JSON para acrescentar parâmetros.'));
    }
    box.append(body); return box;
  }
  const field = el('div', 'field'); const caption = el('label', 'field-label', label); const id = 'field-' + path.map(encodeURIComponent).join('-'); caption.htmlFor = id; caption.append(el('code', '', path.join('.'))); field.append(caption);
  if (!editing) field.append(el('div', 'read-value' + (value == null || value === '' ? ' null' : ''), typeof value === 'boolean' ? value ? 'Ativado' : 'Desativado' : value == null || value === '' ? 'Não definido' : String(value)));
  else {
    let control;
    if (typeof value === 'boolean') { control = el('input'); control.type = 'checkbox'; control.checked = value; }
    else if (typeof value === 'number') { control = el('input'); control.type = 'number'; control.step = 'any'; control.value = value; }
    else if (typeof value === 'string' && (value.length > 110 || /prompt|text|roteiro|description|intencao|intent|base|cena|tipografia/i.test(key))) { control = el('textarea'); control.rows = Math.min(12, Math.max(3, Math.ceil(value.length / 100))); control.value = value; }
    else { control = el('input'); control.type = 'text'; control.value = value == null ? '' : String(value); if (value == null) control.placeholder = 'Não definido'; }
    control.id = id; control.dataset.path = JSON.stringify(path);
    control.addEventListener('focus', remember);
    control.addEventListener('input', () => { setAt(draft, path, control.type === 'checkbox' ? control.checked : control.type === 'number' ? control.value === '' ? null : Number(control.value) : value == null && control.value === '' ? null : control.value); changed(); });
    field.append(control);
  }
  if (FIELD_HELP[key]) field.append(el('p', 'help', FIELD_HELP[key]));
  return field;
}
function renderJson(content) {
  content.append(el('h2', 'section-title', 'JSON completo'), el('p', 'section-intro', 'Todos os campos da receita, inclusive os específicos deste formato. A edição visual e o JSON trabalham sobre a mesma versão.'));
  const tools = el('div', 'code-toolbar'); tools.append(el('span', '', draft.schema || 'Formato não definido'), button('Copiar JSON', 'quiet', async () => { try { await navigator.clipboard.writeText(JSON.stringify(draft, null, 2)); toast('JSON copiado.'); } catch { toast('Selecione o texto e copie com Ctrl+C.'); } })); content.append(tools);
  const code = el('textarea'); code.id = 'json-editor'; code.spellcheck = false; code.setAttribute('aria-label', 'JSON da receita'); code.value = JSON.stringify(draft, null, 2); code.readOnly = !editing; code.onfocus = remember;
  code.oninput = () => { try { const parsed = JSON.parse(code.value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('A receita deve ser um objeto JSON.'); draft = parsed; jsonError = null; } catch (e) { jsonError = e.message; } $('json-error').textContent = jsonError || ''; changed(); };
  content.append(code, el('p', '', '')); const error = el('p'); error.id = 'json-error'; error.setAttribute('role', 'alert'); content.append(error);
}
$('save-edit').onclick = async () => {
  if (jsonError) return toast('Corrija o JSON antes de salvar.');
  $('derivation-name').value = `${titleOf(draft)} · minha versão`.slice(0, 160);
  $('save-error').hidden = true; $('save-validation').textContent = 'Conferindo a estrutura…'; $('confirm-save').disabled = true;
  $('save-dialog').showModal(); $('derivation-name').focus();
  const result = await validateNow();
  $('save-validation').textContent = result.valid ? '✓ Estrutura válida. A nova versão será salva na biblioteca.' : 'A estrutura precisa de revisão: ' + result.message + ' Você pode preservar a edição como rascunho.';
  $('confirm-save').disabled = !result.valid;
};
$('close-save').onclick = () => $('save-dialog').close();
async function saveDerivation(asDraft) {
  const name = $('derivation-name').value.trim();
  if (name.length < 3) { $('save-error').textContent = 'Dê um nome com pelo menos 3 caracteres.'; $('save-error').hidden = false; return; }
  const value = { name, sourceFile: current.file, sourceHash: current.hash, document: draft, draft: asDraft };
  const fingerprint = JSON.stringify(value);
  if (saveAttempt?.fingerprint !== fingerprint) saveAttempt = { fingerprint, requestId: crypto.randomUUID() };
  $('confirm-save').disabled = true; $('save-draft').disabled = true; $('close-save').disabled = true; $('derivation-name').disabled = true;
  $('save-error').hidden = true;
  try {
    const saved = await api('/api/receitas/derivar', { ...value, requestId: saveAttempt.requestId });
    dirty = false; $('save-dialog').close();
    await openRecipe(saved.file); await loadLibrary();
    toast(`${asDraft ? 'Rascunho' : 'Derivação'} salvo e conferido: ${saved.title}`);
  } catch (e) { $('save-error').textContent = e.message; $('save-error').hidden = false; }
  finally { $('confirm-save').disabled = !validation?.valid; $('save-draft').disabled = false; $('close-save').disabled = false; $('derivation-name').disabled = false; }
}
$('confirm-save').onclick = () => saveDerivation(false);
$('save-draft').onclick = () => saveDerivation(true);
const initialParams = new URLSearchParams(location.search);
if (initialParams.get('mapa') === 'estruturas') showStructureMap(initialParams.get('padrao'));
loadLibrary().then(() => { const file = initialParams.get('file'); if (file && initialParams.get('mapa') !== 'estruturas') openRecipe(file); }).catch(e => {
  const state = el('div', 'empty library-error'); state.append(el('b', '', 'Não foi possível ler as receitas'), el('p', '', e.message), button('Tentar novamente', 'quiet', () => loadLibrary().catch(error => toast(error.message)))); $('recipe-grid').replaceChildren(state);
});
