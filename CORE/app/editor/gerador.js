import { setPresenterReference } from './presenter-reference.js';
import { scenesOf, titleOf, durationOf, formatOf, fpsOf, durationLabel } from './receitas-model.js';
import { installWorkspace } from './gerador-workspace.js';
import { installContextAI } from './gerador-context-ai.js';
import { installGuidedGenerator } from './gerador-guided.js';
const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const button = (text, action, cls = '') => { const node = el('button', cls, text); node.onclick = () => guarded(action); return node; };
const clone = value => structuredClone(value);
let config, library = [], source, draft, selected = 0, undo = [], redo = [], validationTimer, validationVersion = 0, dirty = false, currentJob, planDocument, loadVersion = 0, pendingPlan, pendingText, pollTimer, toastTimer;
let workspace,guided,committedDraft='';
const statuses = { planning: 'Preparando', ready: 'Pronto para gerar', running: 'Gerando', writing: 'Escrevendo', complete: 'Concluído', attention: 'Precisa de atenção', interrupted: 'Interrompido', paused: 'Aguardando revisão' };
const stageNames = { tts: 'Voz', music: 'Trilha', alignment: 'Sincronia', draft: 'Imagens', video: 'Vídeos', sceneQa: 'Conferência', assembly: 'Montagem', audioMix: 'Mixagem', audioMux: 'Áudio final', graphics: 'Textos', captions: 'Legendas', postProduction: 'Acabamento', qa: 'Validação', delivery: 'Entrega' };
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
async function guarded(fn) { try { return await fn(); } catch (error) { notify(error.message); } }
async function api(url, input) { const response = await fetch(url, input === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': config?.token || '' }, body: JSON.stringify(input) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.'); return result; }
const pathValue = (object, path) => path.reduce((value, key) => value?.[key], object);
const scenes = () => draft ? scenesOf(draft) : [];
const simple = () => draft?.schema === 'gerador-de-videos/receita@1' && Array.isArray(draft.scenes);
const simpleAudio = () => simple() && (!draft.audio?.narration?.blocks?.length || (draft.audio.narration.blocks.length === 1 && draft.audio.narration.blocks[0].id === 'narracao-master')) && !draft.ending;
function change(fn, redraw = true) {
  if (!draft) return;
  undo.push(clone(draft)); if (undo.length > 40) undo.shift(); redo = [];
  fn(); dirty = true; pendingPlan = null; currentJob = null;
  if (simple()) draft.targetDurationSeconds = draft.scenes.reduce((n, s) => n + Number(s.duration), 0);
  selected = Math.max(0, Math.min(selected, scenes().length - 1));
  if (redraw) render(); else renderSummary();
  autosave(); validate();
}
function autosave() { if (!source || !draft) return; try { localStorage.setItem('studio-generator-draft-v1', JSON.stringify({ source, draft, selected, dirty })); } catch { $('save-status').textContent = 'Rascunho grande demais para salvar no navegador'; } }
function recipeLocation(file){const url=new URL(location.href);url.pathname='/gerador';url.searchParams.set('file',file);history.replaceState(null,'',url);}
function renderSummary() {
  $('summary').textContent = `${scenes().length} cenas · ${durationLabel(durationOf(draft))} · ${formatOf(draft) || 'Formato livre'}`;
  $('save-status').textContent = dirty ? 'Alterações em rascunho local' : 'Receita carregada · original preservado';
  $('undo').disabled = !undo.length; $('redo').disabled = !redo.length;
}
function renderLibrary() {
  const query = $('recipe-search').value.toLocaleLowerCase();
  const items = library.filter(item => `${item.title} ${item.family}`.toLocaleLowerCase().includes(query));
  $('recipe-count').textContent = library.length;
  $('recipe-list').replaceChildren(...items.map(item => { const node = button('', () => openRecipe(item.file), `recipe-choice${source?.file === item.file ? ' active' : ''}`); node.append(el('strong', '', item.title), el('small', '', `${item.sceneCount || 0} cenas · ${item.duration ? durationLabel(item.duration) : item.family}`)); if(item.compatibility){node.append(el('small','compat-badge '+item.compatibility.level,item.compatibility.label));node.title=item.compatibility.reasons.join('\n');} return node; }));
  if (!items.length) $('recipe-list').append(el('p', 'small muted', 'Nenhuma receita encontrada.'));
}
async function openRecipe(file, restoring = false) {
  if (dirty && JSON.stringify(draft)!==committedDraft && !restoring && !confirm('Trocar de receita? O rascunho atual ainda não foi salvo como versão.')) return false;
  const version = ++loadVersion;
  const result = await api('/api/receitas/item?file=' + encodeURIComponent(file));
  if (version !== loadVersion) return;
  committedDraft='';source = result; draft = clone(result.document); selected = 0; undo = []; redo = []; dirty = false; currentJob = null; pendingPlan = null;
  recipeLocation(file);
  $('editor-frame').hidden = true; $('editor-frame').removeAttribute('src'); $('view-editor').querySelector('.editor-empty').hidden = false; $('editor-full').hidden = true;
  render(); renderLibrary(); autosave(); validate();return true;
}
function render() {
  if (!draft) return;
  const all = scenes(), scene = all[selected];
  $('production-name').value = titleOf(draft);
  $('description').value = draft.description || '';
  $('recipe-json').value = JSON.stringify(draft, null, 2);
  renderSummary();
  $('monitor-format').textContent = formatOf(draft) || 'Formato da receita';
  $('scene-number').textContent = String(selected + 1).padStart(2, '0');
  $('scene-title').textContent = scene?.name || 'Estrutura avançada';
  const raw = scene ? pathValue(draft, scene.path) : {};
  $('scene-screen').textContent = raw.onScreenText || '';
  $('scene-position').textContent = `Cena ${selected + 1} de ${all.length}`;
  const start = all.slice(0, selected).reduce((n, s) => n + (s.duration || 0), 0);
  $('scene-range').textContent = `${start.toFixed(1)}s — ${(start + (scene?.duration || 0)).toFixed(1)}s`;
  $('inspector-index').textContent = `CENA ${String(selected + 1).padStart(2, '0')}`;
  $('clip-name').value = scene?.name || '';
  $('clip-duration').value = scene?.duration || '';
  $('clip-prompt').value = scene?.prompt || '';
  $('clip-text').value = raw.onScreenText || '';
  const person=(raw.references || []).find(r=>r.source==='pessoas')?.relPath || '';
  const choices=[...(config?.presenterReferences || [])];if(person&&!choices.some(p=>p.file===person))choices.push({file:person,label:person+' (referência da receita)'});
  $('presenter-reference').replaceChildren(...[{file:'',label:'Sem referência de pessoa'},...choices].map(p=>{const o=el('option','',p.label);o.value=p.file;return o;}));
  $('presenter-reference').value=person;
  $('presenter-reference').disabled = !simple();
  $('aspect').value = formatOf(draft) || '16:9';
  $('style').disabled = !simple();
  if (draft.style && ![...$('style').options].some(o=>o.value===draft.style)) { const option=el('option','',draft.style);option.value=draft.style;$('style').append(option); }
  $('style').value = draft.style || '';
  $('scene-notes').textContent = raw.references?.length ? `${raw.references.length} referência(s) vinculada(s). Confira os detalhes em Receita completa.` : 'Direção e tempos previstos. Confira o vídeo após a geração.';
  $('clip-name').disabled = !simple(); $('clip-text').disabled = !simple();
  $('clip-duration').disabled = !simple() && !draft.program?.shots;
  $('clip-prompt').disabled = !scene || scene.path[0] === 'identidade';
  $('add-scene').disabled = !simple(); $('delete-scene').disabled = !simple() || all.length <= 1;
  $('move-left').disabled = !simple() || selected === 0; $('move-right').disabled = !simple() || selected === all.length - 1;
  $('previous-scene').disabled = !selected; $('next-scene').disabled = selected >= all.length - 1;
  $('automatic').checked = draft.workflow?.humanReview === false;
  $('automatic').disabled = !simple(); $('auto-mode').disabled = !simple();
  $('workflow-label').textContent = draft.workflow?.humanReview === false ? '✦ Fluxo até a entrega' : 'Revisões conforme a receita';
  const total = durationOf(draft) || 0;
  $('timeline-ruler').replaceChildren(...[0, .25, .5, .75, 1].map(f => el('span', '', (f * total).toFixed(0) + 's')));
  $('video-track').replaceChildren(...all.map((s, i) => { const node=el('div','clip'+(i===selected?' selected':''));node.dataset.sceneIndex=i;node.style.flex=`${s.duration||10} 1 0`;const select=button('',()=>{selected=i;render();},'clip-select');select.setAttribute('aria-pressed',String(i===selected));select.title=s.name+' · clique para editar';select.ondblclick=()=>{$('clip-name').focus();$('clip-name').select();};select.append(el('b','',`${String(i+1).padStart(2,'0')}  ${s.name}`),el('small','',durationLabel(s.duration)));node.append(select);return node;}));
  const narration = draft.audio?.narration || draft.narration;
  const music = draft.audio?.music || draft.music;
  $('voice-track').textContent = narration ? `♪ Narração · ${narration.voice || narration.provider || 'conforme receita'} · sincronismo medido na produção` : 'Sem narração separada';
  $('music-track').textContent = music ? '♫ Trilha prevista · mixagem conforme receita' : 'Sem trilha separada';
  $('audio-options').hidden = !simpleAudio(); $('advanced-audio').hidden = simpleAudio();
  $('narration-enabled').checked = !!narration; $('narration-fields').hidden = !narration;
  $('narration-text').value = narration?.text || ''; $('voice').value = narration?.voice || 'Nyla'; $('vids-url').value = narration?.documentUrl || '';
  $('music-enabled').checked = !!music; $('music-fields').hidden = !music; $('music-intent').value = draft.audio?.musicIntent || '';
  $('narration-blocks').replaceChildren();
  if (simple() && !simpleAudio() && Array.isArray(narration?.blocks)) narration.blocks.forEach((block,index)=>{
    const label=el('label','',`Fala ${index+1} · ${block.voice || narration.voice || block.id}`);const field=el('textarea');field.rows=3;field.value=block.text || '';
    field.onchange=()=>change(()=>{draft.audio.narration.blocks[index].text=field.value;draft.audio.narration.text=draft.audio.narration.blocks.map(b=>b.text).join(' ');});
    label.append(field);$('narration-blocks').append(label);
  });
  workspace?.update();
  guided?.update();
}
function validate() {
  workspace?.validate();
  clearTimeout(validationTimer); const version = ++validationVersion;
  $('validation').textContent = 'Conferindo a receita…';
  validationTimer = setTimeout(async () => { try { const result = await api('/api/receitas/validar', { document: draft }); if (version !== validationVersion) return; $('validation').className = 'validation' + (result.valid ? '' : ' invalid'); $('validation').textContent = result.valid ? '✓ Estrutura válida. Prepare para conferir a execução.' : result.message; } catch (e) { if (version === validationVersion) { $('validation').className = 'validation invalid'; $('validation').textContent = e.message; } } }, 350);
}
function editScene(fn) { const s = scenes()[selected]; if (s) change(() => fn(pathValue(draft, s.path), s)); }
$('production-name').onchange = () => change(() => { const name = $('production-name').value.trim(); if (draft.identity) draft.identity.name = name; else draft.label = name; });
$('description').onchange = () => change(() => draft.description = $('description').value);
$('clip-name').onchange = () => editScene(raw => raw.label = $('clip-name').value);
$('clip-duration').onchange = () => guarded(() => { const seconds = Number($('clip-duration').value); if (!Number.isFinite(seconds) || seconds < 4 || seconds > 120) throw new Error('Use uma duração de 4 a 120 segundos.'); editScene(raw => { if (draft.program?.shots) { raw.durationFrames = Math.round(seconds * fpsOf(draft)); draft.program.durationFrames = draft.program.shots.reduce((n, s) => n + s.durationFrames, 0); } else raw.duration = seconds; }); });
$('clip-prompt').onchange = () => editScene((raw, scene) => { const target = scene.related?.length ? pathValue(draft, scene.related[0]) : raw; target.prompt = $('clip-prompt').value; });
$('clip-text').onchange = () => editScene(raw => { const text = $('clip-text').value.trim(); if (text) { raw.onScreenText = text; raw.textRendering = 'omni-native'; } else { delete raw.onScreenText; raw.textRendering = 'none'; } });
$('presenter-reference').onchange = () => editScene(raw => setPresenterReference(raw, $('presenter-reference').value));
$('aspect').onchange = () => change(() => { if (draft.format?.master) { draft.format.master.width = $('aspect').value === '16:9' ? 1920 : 1080; draft.format.master.height = $('aspect').value === '16:9' ? 1080 : 1920; } else draft.aspect = $('aspect').value; });
$('style').onchange = () => change(() => draft.style = $('style').value || null);
function automatic(enabled) { if (!simple()) return; change(() => { draft.workflow = { ...draft.workflow, humanReview: !enabled, completionMode: enabled ? 'complete' : 'pause-for-review', authorizationMode: enabled ? 'production-once' : 'per-invocation', automaticRetry: enabled, retryPolicy: enabled ? 'bounded-reconciled@1' : 'none', omniResubmit: enabled ? 'evidence-guided-automatic' : 'evidence-guided-human', automaticCorrections: enabled, acceptedAttemptPolicy: enabled ? 'whisper-pass' : 'whisper-pass-and-human-review', maxAttempts: enabled ? 2 : 1 }; }); }
$('automatic').onchange = () => automatic($('automatic').checked);
$('auto-mode').onclick = () => { automatic(true); notify('Fluxo automático ativado: a execução seguirá até a entrega depois de você gerar.'); };
$('add-scene').onclick = () => change(() => { draft.scenes.push({ id: 'cena-' + crypto.randomUUID().slice(0, 8), label: 'Nova cena', duration: 10, prompt: 'Descreva a direção desta cena.', generationTask: 'text_to_video', textRendering: 'none' }); selected = draft.scenes.length - 1; });
$('delete-scene').onclick = () => change(() => draft.scenes.splice(selected, 1));
function move(delta) { change(() => { const [scene] = draft.scenes.splice(selected, 1); selected += delta; draft.scenes.splice(selected, 0, scene); }); }
$('move-left').onclick = () => move(-1); $('move-right').onclick = () => move(1);
$('previous-scene').onclick = () => { selected--; render(); }; $('next-scene').onclick = () => { selected++; render(); };
$('undo').onclick = () => { if (!undo.length) return; redo.push(clone(draft)); draft = undo.pop(); dirty = true; currentJob = null; pendingPlan = null; selected = Math.min(selected, scenes().length - 1); render(); autosave(); validate(); };
$('redo').onclick = () => { if (!redo.length) return; undo.push(clone(draft)); draft = redo.pop(); dirty = true; currentJob = null; pendingPlan = null; render(); autosave(); validate(); };
function audioChange(fn) { if (simpleAudio()) change(() => { draft.audio ||= {}; fn(draft.audio); }); }
$('narration-enabled').onchange = () => audioChange(audio => { if ($('narration-enabled').checked) audio.narration = { provider: 'google-vids', text: '', voice: 'Nyla', documentUrl: '', fallbackProvider: null, blocks: [] }; else delete audio.narration; });
$('narration-text').onchange = () => audioChange(audio => { audio.narration.text = $('narration-text').value; audio.narration.blocks = [{ id: 'narracao-master', text: audio.narration.text }]; });
$('voice').onchange = () => audioChange(audio => audio.narration.voice = $('voice').value);
$('vids-url').onchange = () => audioChange(audio => audio.narration.documentUrl = $('vids-url').value);
$('music-enabled').onchange = () => audioChange(audio => { audio.music = $('music-enabled').checked; audio.musicDurationSeconds = durationOf(draft); audio.musicFadeOutSeconds = 0; });
$('music-intent').onchange = () => audioChange(audio => audio.musicIntent = $('music-intent').value);
$('apply-json').onclick = () => guarded(() => { const parsed = JSON.parse($('recipe-json').value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== source.document.schema) throw new Error('Mantenha o formato da receita de origem.'); change(() => draft = parsed); notify('Alterações aplicadas.'); });
function view(id) { document.body.classList.toggle('editor-mode',id==='editor'); document.body.dataset.workspaceView=id; document.querySelectorAll('[data-view]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.view === id))); ['story','editor','json'].forEach(name => $('view-' + name).hidden = name !== id); if (id === 'json') $('recipe-json').value = JSON.stringify(draft, null, 2); if(id!=='story')$('story-real')?.pause(); if(id!=='editor')$('editor-frame').contentDocument?.querySelectorAll('video,audio').forEach(media=>media.pause()); }
document.querySelectorAll('[data-view]').forEach(node => node.onclick = () => view(node.dataset.view));
function showAi(enabled) { if(enabled)guided?.advanced(true); $('scene-inspector').hidden = enabled; $('ai-inspector').hidden = !enabled; $('ai-tab').classList.toggle('active', enabled); $('inspector-tab').classList.toggle('active', !enabled); }
$('ai-tab').onclick = () => showAi(true); $('inspector-tab').onclick = () => showAi(false);
function openEditor(file = source?.file) { if (!file) return; guided?.advanced(true); const url = '/editor?experimental=1&file=' + encodeURIComponent(file); if($('editor-frame').getAttribute('src')!==url+'&embedded=1')$('editor-frame').src=url+'&embedded=1'; $('editor-frame').hidden = false; $('view-editor').querySelector('.editor-empty').hidden = true; $('editor-full').href = url; $('editor-full').hidden = false; view('editor'); }
$('load-editor').onclick = () => openEditor();
async function saveVersion() {
  if (!source) return;
  const result = await api('/api/receitas/derivar', { sourceFile: source.file, sourceHash: source.hash, document: draft, name: titleOf(draft), requestId: crypto.randomUUID(), draft: false });
  source = result; draft = clone(result.document); dirty = false; undo = []; redo = []; currentJob = null; pendingPlan = null; library = (await api('/api/gerador/catalog')).items; render(); renderLibrary(); autosave(); recipeLocation(result.file);validate();notify('Versão salva na biblioteca.');
}
$('save-version').onclick = () => guarded(saveVersion);
async function prepareDraft({autoStart=false}={}) {
  if (!source) throw new Error('Escolha uma receita.');
  $('prepare').disabled = true;
  try {
    if(pendingPlan&&!!pendingPlan.autoStart!==autoStart)pendingPlan=null;
    pendingPlan ||= { sourceFile: source.file, sourceHash: source.hash, document: clone(draft), name: titleOf(draft), requestId: crypto.randomUUID(), ...(autoStart?{autoStart:true}:{}) };
    currentJob = await api('/api/gerador/plan', pendingPlan); planDocument = clone(pendingPlan.document); committedDraft=JSON.stringify(planDocument);
    return currentJob;
  } finally { $('prepare').disabled = false; }
}
$('prepare').onclick = () => guarded(async()=>{await prepareDraft();notify('Preparação iniciada. Acompanhe na barra de produção.');await refreshJobs();});
async function review(job) {
  currentJob = job;
  const saved = await api('/api/receitas/item?file=' + encodeURIComponent(job.recipeFile)); planDocument = saved.document;
  $('plan-title').textContent = job.name; $('plan-description').textContent = `${job.checklist.length} cenas · ${durationLabel(job.duration)} · versão salva e preparada pelo motor do Studio.`;
  const narration = planDocument.audio?.narration || planDocument.narration;
  const music = planDocument.audio?.music || planDocument.music;
  $('plan-checklist').replaceChildren(...scenesOf(planDocument).map(scene => { const raw = pathValue(planDocument, scene.path); const row = el('tr'); const refs = raw.references || [];
    const voiceBlock = narration?.blocks?.find(b => b.id === scene.id || b.sceneId === scene.id);
    const voiceText = voiceBlock?.text || (narration ? 'Narração da receita; conferir vínculos' : 'Áudio conforme direção da cena');
    [scene.name, durationLabel(scene.duration), refs.length ? refs.map(r => r.relPath || r.assetId || 'Referência').join(', ') : 'Sem referência de imagem', voiceText, raw.onScreenText || '—', music ? 'Prevista' : 'Sem trilha separada'].forEach(value => row.append(el('td', '', value)));
    row.firstChild.append(el('p', 'muted small', scene.prompt)); return row; }));
  const calls = job.plan?.paidCalls || job.plan?.budget || {};
  $('plan-resources').replaceChildren(...Object.entries(calls).filter(([,value]) => typeof value === 'number' && value > 0).map(([name,value]) => el('span','tag',`${name}: ${value}`)));
  $('confirm-generate').disabled = job.status !== 'ready'; $('plan-dialog').showModal();
}
$('close-plan').onclick = $('review-later').onclick = () => $('plan-dialog').close();
$('confirm-generate').onclick = () => guarded(async () => { $('confirm-generate').disabled = true; try { await api('/api/gerador/run', { id: currentJob.id, recipeHash: currentJob.recipeHash }); $('plan-dialog').close(); notify('Produção iniciada. Você pode acompanhar nesta tela.'); await refreshJobs(); } catch(e) { $('confirm-generate').disabled = false; throw e; } });
async function refreshJobs() {
  let items=[];
  try {
  items = (await api('/api/gerador/jobs')).items;
  guided?.connection(true);window.dispatchEvent(new CustomEvent('studio:jobs',{detail:items}));
  workspace?.jobs(items);
  await guided?.jobs(items);
  const existingPlayers = new Map([...$('jobs').querySelectorAll('video[data-scene-media]')].map(video => [video.dataset.sceneMedia, video]));
  $('jobs').replaceChildren();
  for (const job of items.slice(0, 20)) {
    const card = el('article','job'); card.dataset.jobId=job.id; const head = el('div','job-head'); head.append(el('strong','',job.name), el('span','tag ' + (job.status==='complete'?'teal':'purple'),statuses[job.status] || job.status)); card.append(head);
    if (job.message) card.append(el('p','job-message',job.message));
    if (job.progress?.stages) { const list = el('div','stage-list'); job.progress.stages.filter(s=>s.status!=='skipped').forEach(s => {const label=({completed:'Concluído',running:'Em andamento',planned:'Preparado',pending:'Na fila',blocked:'Aguardando etapa anterior',failed:'Falhou',awaiting_approval:'Aguardando revisão',attention_required:'Verificar'})[s.status]||s.status;const n=el('span',s.status==='completed'?'done':s.status==='running'?'running':'',`${stageNames[s.name] || s.name}: ${label}`);if(s.message)n.title=s.message;list.append(n);}); card.append(list); }
    if(job.progress?.scenes?.length){const sceneList=el('div','job-scene-list');job.progress.scenes.forEach(s=>{const row=el('div','');row.append(el('b','',s.id),el('span','',s.available?'Vídeo disponível':({pending:'Na fila',planned:'Planejada',generating:'Gerando',failed:'Verificar',ready:'Preparada'})[s.status]||s.status));if(s.available){const key=job.id+':'+s.id;const v=existingPlayers.get(key)||el('video');if(!v.dataset.sceneMedia){v.dataset.sceneMedia=key;v.controls=true;v.preload='none';v.playsInline=true;v.src='/api/gerador/scene-media?id='+job.id+'&scene='+encodeURIComponent(s.id);}row.append(v);}if(s.message)row.append(el('p','',s.message));sceneList.append(row);});card.append(sceneList);}
    if(job.status==='attention'||job.status==='interrupted'){card.append(el('p','small muted',/session|sessão|login|cookie/i.test(job.message||'')?'Renove sua sessão no Studio e retome esta mesma produção.':/refer|direito|asset/i.test(job.message||'')?'Confira a referência indicada na receita antes de retomar.':'Retomar consulta o estado salvo e preserva as etapas concluídas. Não inicie uma cópia para recuperar esta execução.'));}
    const actions = el('div','job-actions'); if(job.type==='video')actions.append(button('Acompanhar no gerador',()=>guided.follow(job)));
    if (job.status === 'ready') actions.append(button('Conferir e gerar →', () => review(job),'primary'));
    if (job.progress?.status === 'awaiting_approval' && job.status === 'paused') actions.append(button('Aprovar prévia e continuar', async () => { await api('/api/gerador/approve', { id: job.id, recipeHash: job.recipeHash }); await refreshJobs(); }));
    if (job.type === 'video' && job.stateFile && ['attention','interrupted','paused'].includes(job.status)) actions.append(button('Retomar pelo estado salvo', async () => { await api('/api/gerador/resume', { id: job.id, recipeHash: job.recipeHash }); await refreshJobs(); }));
    if (job.recipeFile) actions.append(button('Abrir no editor', () => openEditor(job.recipeFile)), button('Carregar receita', () => openRecipe(job.recipeFile)));
    if (job.mediaAvailable) { const link=el('a','button','Assistir ao vídeo ↗');link.href='/api/gerador/media?id='+encodeURIComponent(job.id);link.target='_blank';link.rel='noopener';actions.append(link); }
    if (job.type === 'text' && job.text) actions.append(button('Ver direção da IA', () => { contextAI.showResult(job); showAi(true); }));
    card.append(actions); $('jobs').append(card);
    contextAI.receiveJob(job);
  }
  if (!items.length) $('jobs').append(el('p','muted small','Nenhuma produção preparada nesta interface.'));
  } catch(error) {guided?.connection(false);throw error;} finally {
  clearTimeout(pollTimer); pollTimer = setTimeout(() => guarded(refreshJobs), guided?.isWorking()||items.some(j => ['planning','running','writing'].includes(j.status)) ? 3000 : 12000);
  }
}
$('refresh-jobs').onclick = () => guarded(refreshJobs);
$('ai-result').oninput=()=>$('ai-apply').disabled=!$('ai-result').value.trim();
$('recipe-search').oninput=renderLibrary;
document.querySelectorAll('[data-preset]').forEach(node=>node.onclick=()=>guarded(()=>openRecipe(node.dataset.preset+'.receita.json')));
$('new-project').onclick=()=>{$('recipe-search').value='studio';renderLibrary();document.querySelector('.preset-list').scrollIntoView({block:'nearest'});};
window.addEventListener('beforeunload',event=>{if(dirty&&JSON.stringify(draft)!==committedDraft){event.preventDefault();event.returnValue='';}});
workspace=installWorkspace({config:()=>config,state:()=>({source,draft,selected,dirty,currentJob}),api,notify,select:i=>{selected=i;render();},replace:value=>change(()=>draft=clone(value)),openEditor,
  onCompatibility:result=>guided?.compatibility(result),
  // Gestures edit the existing recipe/history, never a separate execution timeline.
  canArrange:()=>simpleAudio(),
  resize:(index,seconds)=>{if(!simpleAudio())return;change(()=>{selected=index;draft.scenes[index].duration=seconds;});},
  reorder:(from,to)=>{if(!simpleAudio()||from===to)return;change(()=>{const [scene]=draft.scenes.splice(from,1);draft.scenes.splice(to,0,scene);selected=to;});}
});
const contextAI=installContextAI({state:()=>({source,draft,selected}),config:()=>config,api,notify,guarded,pending:(...args)=>args.length?(pendingText=args[0]):pendingText,refresh:refreshJobs,proposal:(before,after)=>workspace.proposal(before,after)});
guided=installGuidedGenerator({state:()=>({source,draft,selected,dirty,currentJob}),config:()=>config,library:()=>library,api,notify,openRecipe,openEditor,replace:value=>change(()=>draft=clone(value)),prepare:prepareDraft,refresh:refreshJobs,run:async job=>{currentJob=job;return api('/api/gerador/run',{id:job.id,recipeHash:job.recipeHash});}});
await guarded(async () => {
  const results=await Promise.all([api('/api/gerador/config'),api('/api/gerador/catalog')]);config=results[0];library=results[1].items;renderLibrary();
  contextAI.update();
  const voices=config.voices?.voices || []; $('voice').replaceChildren(...voices.map(v=>{const option=el('option','',v.name);option.value=v.name;return option;}));
  (config.styles || []).forEach(style=>{const option=el('option','',style.name);option.value=style.id;$('style').append(option);});
  $('capabilities').replaceChildren(...config.capabilities.filter(c=>['gemini-omni','google-vids','flow-music','gemini-product-text'].includes(c.id)).map(c=>{const row=el('span','',({'gemini-omni':'Vídeo Omni','google-vids':'Narração Vids','flow-music':'Trilha Flow','gemini-product-text':'Texto Gemini'})[c.id]);row.append(el('b','',c.status==='supported'?'Capacidade vigente':'Indisponível'));return row;}));
  let stored;try{stored=JSON.parse(localStorage.getItem('studio-generator-draft-v1'));}catch{}
  const params=new URLSearchParams(location.search);
  const requestedJob=params.get('job')?await api('/api/gerador/job?id='+encodeURIComponent(params.get('job'))):null;
  const file=requestedJob?.recipeFile||params.get('file');
  if(!requestedJob&&params.get('novo')!=='1'&&stored?.source&&stored?.draft&&stored.dirty&&(!file||file===stored.source.file)){source=await api('/api/receitas/item?file='+encodeURIComponent(stored.source.file));if(source.hash===stored.source.hash){draft=stored.draft;selected=stored.selected||0;dirty=true;render();renderLibrary();validate();notify('Rascunho local restaurado.');}else{await openRecipe(file||source.file,true);notify('A origem mudou; carreguei a versão atual da biblioteca.');}}
  else await openRecipe(file||'studio-produto.receita.json',true);
  if(requestedJob)guided.watch(requestedJob);
  else if(params.get('novo')==='1')await $('guide-new').onclick();
  if(params.get('escolher')==='1')guided.choose();
  await refreshJobs();
});

guided.ready();
