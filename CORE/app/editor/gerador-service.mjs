import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRecipeLibrary } from './receitas-library.mjs';
import { createEditorReconstruction } from './editor-reconstruction.mjs';
import { descreverReceita } from '../../lib/media-pipeline/recipe-validation.mjs';
import { validateAssemblyEdits } from '../../lib/media-pipeline/film-assembly.mjs';
import { CONTEXT_TEXT_PURPOSES } from '../../lib/media-pipeline/context-text.mjs';
import { scenesOf, titleOf, durationOf } from './receitas-model.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value || '');
const safe = message => String(message).replace(/(cookie|authorization|token|secret|api.?key)\s*[:=]\s*[^\s,]+/gi, '$1=[removido]').slice(0, 2400);
const busy = new Set(['planning', 'running', 'writing']);

// Host HTTP do CLI existente. O planejamento, execução, retries e journal
// continuam exclusivamente no motor canônico.
export function runStudioCommand(coreDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(coreDir, 'scripts/omni-cli.mjs'), ...args], { cwd: coreDir, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-4 * 1024 * 1024); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(fail(safe(stderr || `Operação encerrada com código ${code}.`), 422));
      try { resolve(JSON.parse(stdout)); } catch { reject(fail('O motor terminou sem uma resposta JSON legível. Confira a produção antes de continuar.', 502)); }
    });
  });
}

export function createGeneratorService({ coreDir, runner = args => runStudioCommand(coreDir, args), reconstruction = createEditorReconstruction({ coreDir }) }) {
  const root = path.join(coreDir, 'diagnosticos', 'gerador');
  const library = createRecipeLibrary({ recipesDir: path.join(coreDir, 'recipes') });
  const active = new Map();
  let queue = Promise.resolve();
  const serialize = fn => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };
  const jobPath = id => { if (!uuid(id)) throw fail('Identificador inválido.'); return path.join(root, id + '.json'); };
  async function persist(job) {
    const file = jobPath(job.id); const temp = file + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(job, null, 2), { flag: 'wx' });
    await fs.rename(temp, file);
  }
  async function read(id) {
    let job;
    try { job = JSON.parse(await fs.readFile(jobPath(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') throw fail('Produção não encontrada.', 404); throw e; }
    if (busy.has(job.status) && !active.has(id)) job = { ...job, status: 'interrupted', message: 'A operação foi interrompida. Verifique o estado antes de retomar.' };
    if (job.stateFile) {
      try {
        const file = await insideOutputs(job.stateFile);
        const state = JSON.parse(await fs.readFile(file, 'utf8'));
        job.progress = { status: state.status, updatedAt: state.updatedAt, stages: Object.entries(state.stages || {}).map(([name, value]) => ({ name, status: value.status, message: value.error ? safe(value.error.message || value.error) : null })) };
        job.progress.scenes = await readScenes(state);
        if (state.finalFile && ['complete', 'completed', 'delivered'].includes(state.status)) {
          const final = await insideOutputs(state.finalFile);
          if (/\.mp4$/i.test(final) && (await fs.stat(final)).size > 0) job.mediaAvailable = true;
        }
      } catch { /* O estado pode estar sendo publicado atomicamente. */ }
    }
    if (job.type === 'export' && job.status === 'complete' && job.result?.file) {
      try { job.mediaAvailable = (await fs.stat(await insideOutputs(job.result.file))).size > 0; } catch { job.mediaAvailable = false; }
    }
    return job;
  }
  async function readScenes(state) {
    if (!state.draftFile) return [];
    try {
      const draft = JSON.parse(await fs.readFile(await insideOutputs(state.draftFile), 'utf8'));
      return await Promise.all((draft.scenes || []).map(async scene => {
        let available = false;
        if (scene.videoFile) try { available = (await fs.stat(await insideOutputs(scene.videoFile))).size > 0; } catch {}
        return { id: scene.id, status: scene.status, available, message: scene.error ? safe(scene.error.message || scene.error) : null };
      }));
    } catch { return []; }
  }
  async function sceneMedia(id, sceneId) {
    const job = await read(id);
    if (!job.progress?.scenes?.some(s => s.id === sceneId && s.available)) throw fail('Cena ainda sem vídeo disponível.', 404);
    const state = JSON.parse(await fs.readFile(await insideOutputs(job.stateFile), 'utf8'));
    const draft = JSON.parse(await fs.readFile(await insideOutputs(state.draftFile), 'utf8'));
    return insideOutputs(draft.scenes.find(s => s.id === sceneId).videoFile);
  }
  async function compatibility(document) {
    try {
      const description = descreverReceita(document);
      if (description.motor !== 'filme' || document.kind === 'lote') return { level: 'edit', label: 'Edição e acervo', reasons: ['Esta estrutura usa outro executor. Você pode editar a receita e montar seus vídeos locais.'] };
      const reasons = (description.preflight?.blockers || []).map(b => typeof b === 'string' ? b : b.message || b.code || JSON.stringify(b));
      const voice = document.audio?.narration;
      if (voice?.provider === 'google-vids' && !voice.documentUrl) reasons.push('Informe o documento Google Vids em Voz & som.');
      if (document.schema.endsWith('@1') && document.audio?.music && !String(document.audio.musicIntent || '').trim() && !['institucional','tenso','epico','caloroso'].includes(document.audio.musicPreset)) reasons.push('Descreva o clima da música em Voz e música, ou desligue a trilha.');
      if (document.qa?.semantic || document.qa?.semanticScenes) reasons.push('QA semântico não possui contrato cookie-only vigente. Ajuste a receita.');
      return { level: reasons.length ? 'adjust' : 'ready', label: reasons.length ? 'Precisa de ajustes' : 'Pode preparar', reasons: reasons.length ? reasons : ['Estrutura aceita. Preparar confere capacidades, referências e execução antes de gerar.'] };
    } catch (e) { return { level: 'adjust', label: 'Precisa de ajustes', reasons: [safe(e.message)] }; }
  }
  async function catalog() {
    const { items } = await library.list();
    return { items: await Promise.all(items.map(async item => {
      try { return { ...item, compatibility: await compatibility((await library.read(item.file)).document) }; }
      catch { return { ...item, compatibility: { level: 'adjust', label: 'Arquivo inválido', reasons: ['Corrija o arquivo de receita.'] } }; }
    })) };
  }
  async function exportEdit(input) {
    return serialize(async () => {
      if (!uuid(input.requestId)) throw fail('Identificador de exportação inválido.');
      const fingerprint = hash(input);
      try { const old = await read(input.requestId); if (old.inputHash !== fingerprint) throw fail('Pedido de exportação já usado.', 409); return old; } catch (e) { if (e.status !== 404) throw e; }
      if (active.size) throw fail('Aguarde a operação atual.', 409);
      const saved = await library.read(input.file);
      if (saved.hash !== input.recipeHash) throw fail('A receita mudou. Reabra o editor.', 409);
      const project = await reconstruction.reconstruct(input.file, input.production || '');
      if (!Array.isArray(input.clips) || !input.clips.length || input.clips.length > 100) throw fail('Selecione de 1 a 100 trechos.');
      const assets = await Promise.all(input.clips.map(c => reconstruction.getAsset(input.file, c.assetId, input.production || '')));
      if (assets.some((a, i) => a.info.kind !== 'video' || a.stamp !== input.clips[i].stamp)) throw fail('Um material mudou ou não é vídeo. Reabra o editor.', 409);
      let edits;
      try { edits = validateAssemblyEdits(input.clips, assets.map(a => ({ duration: a.info.duration })), input.fps || 24); } catch(e) { throw fail(e.message); }
      if (!['16:9','9:16','1:1'].includes(input.aspect)) throw fail('Formato de exportação inválido.');
      if (edits.reduce((n,e) => n + e.sourceOut - e.sourceIn, 0) > 3600) throw fail('A montagem deve ter até uma hora.');
      const folder = path.join(coreDir, 'outputs', 'edicao-' + input.requestId);
      await fs.mkdir(path.join(folder, 'metadados'), { recursive: true }); await fs.mkdir(path.join(folder, 'videos-unidos'));
      const hashCache = new Map();
      for (const a of assets) if (!hashCache.has(a.file)) { const h = createHash('sha256'); for await (const bytes of createReadStream(a.file)) h.update(bytes); hashCache.set(a.file, h.digest('hex')); }
      const manifest = { schema: 'gerador-de-videos/assembly-edit@1', recipeHash: saved.hash, recipeFile: saved.file, fps: input.fps || 24, aspect: input.aspect,
        clips: edits.map((e,i) => ({ ...e, file: assets[i].file, sha256: hashCache.get(assets[i].file) })) };
      const manifestFile = path.join(folder, 'metadados', 'montagem.json');
      await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx' });
      await fs.mkdir(root, { recursive: true });
      const job = { schema: 'gerador-de-videos/app-operation@1', id: input.requestId, inputHash: fingerprint, name: 'Edição · ' + project.data.title, type: 'export', recipeFile: saved.file, createdAt: new Date().toISOString(), status: 'running', manifestFile };
      await fs.writeFile(jobPath(job.id), JSON.stringify(job), { flag: 'wx' });
      launch(job, async () => { job.result = await runner(['join','--mode','studio','--manifest',manifestFile,'--out',path.join(folder,'videos-unidos','master.mp4')]); job.status = 'complete'; await persist(job); });
      return job;
    });
  }
  async function insideOutputs(file) {
    const [allowed, real] = await Promise.all([fs.realpath(path.join(coreDir, 'outputs')), fs.realpath(file)]);
    const relative = path.relative(allowed, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw fail('Arquivo fora das entregas.', 403);
    return real;
  }
  async function list() {
    await fs.mkdir(root, { recursive: true });
    const files = (await fs.readdir(root)).filter(f => uuid(f.slice(0, -5)) && f.endsWith('.json'));
    const results = await Promise.all(files.map(f => read(f.slice(0, -5)).catch(() => null)));
    return results.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  function launch(job, operation) {
    const task = Promise.resolve().then(operation).catch(async error => { job.status = 'attention'; job.message = safe(error.message); await persist(job); }).finally(() => active.delete(job.id));
    active.set(job.id, task);
  }
  async function plan(input) {
    return serialize(async () => {
      if (!uuid(input.requestId)) throw fail('Identificador de preparação inválido.');
      if (input.autoStart != null && typeof input.autoStart !== 'boolean') throw fail('A escolha de iniciar a produção precisa ser explícita.');
      const fingerprint = hash({ sourceFile: input.sourceFile, sourceHash: input.sourceHash, document: input.document, name: input.name, ...(input.autoStart === true ? {autoStart:true} : {}) });
      try { const old = await read(input.requestId); if (old.inputHash !== fingerprint) throw fail('Esta preparação já pertence a outro conteúdo.', 409); return old; } catch (e) { if (e.status !== 404) throw e; }
      if (active.size) throw fail('Aguarde a operação atual antes de preparar outra produção.', 409);
      const doc = input.document;
      if (!doc || !['gerador-de-videos/receita@1', 'gerador-de-videos/receita@2'].includes(doc.schema)) throw fail('Esta receita pode ser editada, mas ainda não tem execução por filme nesta interface.', 422);
      if ((doc.schema.endsWith('@1') && doc.kind !== 'filme') || doc.kind === 'lote') throw fail('Esta receita usa um executor de peças ou lotes. Escolha uma receita de filme para gerar nesta tela.', 422);
      const derived = await library.derive({ ...input, draft: false });
      const saved = await library.read(derived.file);
      await fs.mkdir(root, { recursive: true });
      const job = { schema: 'gerador-de-videos/app-operation@1', id: input.requestId, inputHash: fingerprint, name: titleOf(saved.document), recipeFile: saved.file, recipeHash: saved.hash, type: 'video', createdAt: new Date().toISOString(), status: 'planning', checklist: scenesOf(saved.document).map(s => ({ id: s.id, duration: s.duration, prompt: s.prompt })), duration: durationOf(saved.document) };
      if (input.autoStart === true) job.autoStartRequested = true;
      await fs.writeFile(jobPath(job.id), JSON.stringify(job, null, 2), { flag: 'wx' });
      launch(job, async () => {
        const spec = path.join(coreDir, 'recipes', saved.file);
        const preview = await runner(['dry-run', '--spec', spec]);
        if ((preview.plan?.executionPlan?.governance?.executorCompatibility || preview.plan?.governance?.executorCompatibility)?.supported === false) throw fail('Esta estrutura ainda não pode ser executada pelo motor de produção.');
        const result = await runner(['plan', '--spec', spec]);
        if (!result.stateFile) throw fail('O motor não retornou um estado de produção.');
        job.stateFile = await insideOutputs(result.stateFile);
        job.plan = result.plan; job.status = 'ready';
        await persist(job);
        if (job.autoStartRequested) await runPrepared(job);
      });
      return job;
    });
  }
  async function runPrepared(job, resume = false, draftFile) {
    const saved = await library.read(job.recipeFile);
    if (saved.hash !== job.recipeHash) throw fail('A receita salva mudou. Prepare uma nova versão.', 409);
    await insideOutputs(job.stateFile);
    job.status = 'running'; job.message = null; await persist(job);
    if (draftFile) await runner(['approve', '--draft', draftFile]);
    const fingerprint = job.plan?.executionPlan?.governance?.approval?.fingerprint || job.plan?.governance?.approval?.fingerprint;
    const result = await runner([resume ? 'resume' : 'run', '--state', job.stateFile, ...(fingerprint ? ['--confirm-fingerprint', fingerprint] : [])]);
    job.status = ['complete', 'completed', 'delivered'].includes(result.status) ? 'complete' : 'paused';
    job.result = { status: result.status, stages: result.stages, finalFile: result.finalFile }; await persist(job);
  }
  async function execute(input, resume = false, approve = false) {
    return serialize(async () => {
      const job = await read(input.id);
      if (active.has(job.id)) return job;
      if (active.size) throw fail('Já existe uma operação em andamento.', 409);
      if (input.recipeHash !== job.recipeHash) throw fail('A versão preparada mudou. Prepare novamente.', 409);
      if ((!resume && job.status !== 'ready') || (resume && !['attention', 'interrupted', 'paused'].includes(job.status))) throw fail('Operação indisponível neste estado.', 409);
      if (!job.stateFile || job.type !== 'video') throw fail('Esta operação não tem produção retomável.');
      const saved = await library.read(job.recipeFile);
      if (saved.hash !== job.recipeHash) throw fail('A receita salva mudou. Prepare uma nova versão.', 409);
      await insideOutputs(job.stateFile);
      let draftFile;
      if (approve) {
        const state = JSON.parse(await fs.readFile(job.stateFile, 'utf8'));
        if (state.status !== 'awaiting_approval') throw fail('Não há prévia aguardando aprovação.', 409);
        draftFile = await insideOutputs(state.draftFile);
      }
      job.status = 'running'; job.message = null;
      await persist(job);
      launch(job, () => runPrepared(job, resume, draftFile));
      return job;
    });
  }
  async function text(input) {
    return serialize(async () => {
      if (!uuid(input.requestId) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20000 || (input.atmosphere && (typeof input.atmosphere !== 'string' || input.atmosphere.length > 10000))) throw fail('Descreva o produto e a direção desejada.');
      const purpose = input.purpose || 'product';
      if (purpose !== 'product' && !CONTEXT_TEXT_PURPOSES[purpose]) throw fail('Ação textual inválida.');
      if (purpose !== 'product') {
        const { loadEffectiveProviderCapabilities } = await import('../../lib/media-pipeline/provider-registry.mjs');
        if ((await loadEffectiveProviderCapabilities())['gemini-context-text']?.status !== 'supported') throw fail('IA contextual temporariamente indisponível: o AI Studio retornou erro interno. Direção de produto continua na integração disponível.', 422);
      }
      const fingerprint = hash({ prompt: input.prompt, atmosphere: input.atmosphere || '', purpose });
      try { const old = await read(input.requestId); if (old.inputHash !== fingerprint) throw fail('Pedido de IA já usado para outro texto.', 409); return old; } catch (e) { if (e.status !== 404) throw e; }
      if (active.size) throw fail('Aguarde a operação atual.', 409);
      await fs.mkdir(root, { recursive: true });
      const job = { schema: 'gerador-de-videos/app-operation@1', id: input.requestId, inputHash: fingerprint, name: purpose==='product'?'Direção de produto com Gemini':'Texto contextual com Gemini', type: 'text', purpose, createdAt: new Date().toISOString(), status: 'writing' };
      await fs.writeFile(jobPath(job.id), JSON.stringify(job), { flag: 'wx' });
      const promptFile = path.join(root, job.id + '.prompt.txt');
      await fs.writeFile(promptFile, input.prompt, { flag: 'wx' });
      launch(job, async () => {
        const result = await runner(['text', '--prompt-file', promptFile, ...(purpose!=='product'?['--purpose',purpose]:[]), ...(input.atmosphere ? ['--atmosphere', input.atmosphere] : []), '--out', path.join(root, job.id + '.text.json')]);
        job.text = result.text; job.status = 'complete'; await persist(job);
      });
      return job;
    });
  }
  async function media(id) {
    const job = await read(id);
    if (!job.mediaAvailable) throw fail('O vídeo final ainda não está disponível.', 404);
    if (job.type === 'export') return insideOutputs(job.result.file);
    const state = JSON.parse(await fs.readFile(await insideOutputs(job.stateFile), 'utf8'));
    return insideOutputs(state.finalFile);
  }
  return { list, read, plan, execute, text, media, catalog, compatibility, exportEdit, sceneMedia, idle: () => Promise.all([...active.values()]) };
}
