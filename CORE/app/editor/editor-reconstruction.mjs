import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeMedia } from '../../lib/media-pipeline/media-tools.mjs';
import { createRecipeLibrary } from './receitas-library.mjs';
import { recipeTimeline } from './receitas-timeline-model.js';
import { durationOf, fpsOf } from './receitas-model.js';
import { servirArquivo } from './acervo-stream.mjs';
import { createLocalProductionReader } from './editor-local-production.mjs';

const exec = promisify(execFile);
export const EXAMPLE_RECIPE = 'filme-30s.receita.json';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = n => Number.isFinite(n) && n > 0;
const clean = s => String(s || '').replace(/\.mp4$/i, '').replace(/^\d+-/, '').replace(/-/g, ' ');
const finite = n => Number.isFinite(Number(n)) ? Number(n) : 0;
const stamp = stat => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

// Leitura de registros existentes para a UI. Não compila, executa ou salva montagens.
export async function resolveOutputFile(root, file) {
  const resolved = path.resolve(root, file), realRoot = await fs.realpath(root);
  const lexical = path.relative(path.resolve(root), resolved);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) throw fail('Material fora das entregas.');
  const real = await fs.realpath(resolved), rel = path.relative(realRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail('Material fora das entregas.');
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw fail('Material não encontrado.', 404);
  return { file: real, stat, rel: path.relative(realRoot, real).replaceAll('\\', '/') };
}

export function readConcatList(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(line => {
    const m = /^file '([^']+)'$/.exec(line);
    if (!m) throw fail('Lista de montagem não reconhecida.');
    return m[1];
  });
}

export function receiptCuts(receipt, normalizedDurations) {
  if (receipt.schema !== 'gerador-de-videos/dual-voice-assembly-receipt@1' || !Array.isArray(receipt.scenes)) throw fail('Formato de montagem ainda não reconstruído.');
  if (normalizedDurations.length !== receipt.scenes.length + 1 || !normalizedDurations.every(positive)) throw fail('Faltam durações dos trechos montados.');
  let cursor = 0, plannedCursor = 0;
  return normalizedDurations.map((duration, i) => {
    const s = receipt.scenes[i], sourceIn = finite(s?.start);
    if (s && (!positive(s.duration) || sourceIn < 0)) throw fail('Corte inválido no recibo.');
    const span = { id: s?.id || 'fechamento', title: s ? clean(s.id) : 'Encerramento', start: cursor, end: cursor + duration, sourceIn,
      requestedDuration: s?.duration || receipt.ending?.durationSeconds || duration, receiptStart: plannedCursor, receiptEnd: plannedCursor + (s?.duration || duration), ending: !s };
    cursor += duration; plannedCursor = span.receiptEnd; return span;
  });
}

export function waveformPeaks(buffer, bins = 1600) {
  const count = Math.floor(buffer.length / 4), peaks = [];
  for (let i = 0; i < bins; i++) {
    let peak = 0;
    for (let j = Math.floor(i * count / bins); j < Math.floor((i + 1) * count / bins); j++) {
      const value = buffer.readFloatLE(j * 4); if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
    }
    peaks.push(Math.min(1, Math.round(peak * 10000) / 10000));
  }
  return peaks;
}

async function readVideoPackets(file) {
  const {stdout}=await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','packet=pts_time,flags,data_hash','-show_data_hash','sha256','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024*1024});
  const packets=JSON.parse(stdout).packets || [];
  // A concatenação pode reinserir SPS/PPS nos keyframes H.264. Compara as
  // unidades de imagem (VCL), preservando os timestamps lidos do contêiner.
  const normalized=await exec('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','filter_units=pass_types=1-5','-f','framehash','-hash','sha256','pipe:1'],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024*1024});
  const hashes=normalized.stdout.split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
  if(hashes.length!==packets.length || hashes.some(h=>!/^[a-f0-9]{64}$/.test(h))) throw fail('Não foi possível conferir as unidades de imagem.');
  return packets.map((p,i)=>({...p,data_hash:hashes[i]}));
}

export function alignCutPackets(cuts, masterPackets, sourcePackets, duration, fps) {
  const flat=sourcePackets.flat();
  if(!flat.length || flat.length!==masterPackets.length || sourcePackets.length!==cuts.length || sourcePackets.some(p=>!p.length)) throw fail('Quantidade de quadros divergente.');
  if(flat.some((p,i)=>!p.data_hash || p.data_hash!==masterPackets[i].data_hash)) throw fail('Os trechos não correspondem aos quadros do master.');
  let offset=0;
  const starts=sourcePackets.map(p=>{const packet=masterPackets[offset];offset+=p.length;const t=Number(packet.pts_time);if(!Number.isFinite(t) || t<0 || !packet.flags?.includes('K'))throw fail('Ponto de corte não identificado.');return t;});
  const last=Math.min(duration,Math.max(...masterPackets.map(p=>Number(p.pts_time)))+1/fps);
  return cuts.map((c,i)=>{const end=starts[i+1]??last;if(!(end>starts[i]))throw fail('Ordem temporal inválida.');return {...c,containerStart:c.start,start:starts[i],end};});
}

export function createEditorReconstruction({ coreDir, probe = probeMedia, packets = readVideoPackets }) {
  const outputRoot = path.join(coreDir, 'outputs'), library = createRecipeLibrary({ recipesDir: path.join(coreDir, 'recipes') });
  const roots = [{id:'entregas',root:outputRoot},{id:'core-videos',root:path.join(coreDir,'videos')},{id:'producoes',root:path.join(coreDir,'producoes')},{id:'soltos',root:path.join(path.dirname(coreDir),'videos-soltos')}];
  async function resolveMediaFile(file) {
    if(typeof file!=='string' || !file) throw fail('Material não encontrado.',404);
    const absolute=path.resolve(outputRoot,file);
    for(const root of roots){const rel=path.relative(root.root,absolute);if(rel.startsWith('..') || path.isAbsolute(rel))continue;
      try{return {...await resolveOutputFile(root.root,absolute),root:root.root,source:root.id};}catch{ /* Try only the declared roots. */ }
    }
    throw fail('Material fora das pastas disponíveis ou ausente.',404);
  }
  const localReader=createLocalProductionReader({roots,resolveFile:resolveMediaFile,readConcatList});
  const mediaCache=new Map();
  const projects = new Map(), projectReads = new Map(), visualCache = new Map(), inflight = new Map();
  let processing = 0; const queue = [];
  const drain = () => { while (processing < 2 && queue.length) { processing++; const fn = queue.shift(); fn().finally(() => { processing--; drain(); }); } };
  const bounded = fn => new Promise((resolve, reject) => { queue.push(() => fn().then(resolve, reject)); drain(); });
  const readJson = async file => { const r = await resolveOutputFile(outputRoot, file); if (r.stat.size > 2 * 1024 * 1024) throw fail('Registro muito grande.'); return JSON.parse(await fs.readFile(r.file, 'utf8')); };
  async function asset(file, id, label, assets, privateAssets) {
    try {
      const resolved = await resolveMediaFile(file);
      if (!/\.(mp4|webm|mov|mkv|m4v|wav|mp3|m4a|aac|ogg|flac|png|jpe?g|webp)$/i.test(resolved.file)) throw fail('Formato não suportado.');
      const key=resolved.file+':'+stamp(resolved.stat);
      if(!mediaCache.has(key)){const job=/\.(mp4|webm|mov|mkv|m4v|wav|mp3|m4a|aac|ogg|flac)$/i.test(resolved.file)?bounded(()=>probe(resolved.file)):Promise.resolve({});mediaCache.set(key,job);job.catch(()=>mediaCache.delete(key));if(mediaCache.size>1500)mediaCache.delete(mediaCache.keys().next().value);}
      const media = await mediaCache.get(key);
      const info = { id, label, stamp: stamp(resolved.stat), source:resolved.source, rel: resolved.rel, duration: media.duration || null, width: media.video?.width || null, height: media.video?.height || null,
        fps: media.video?.r_frame_rate ? media.video.r_frame_rate.split('/').map(Number).reduce((a, b) => a / b) : null,
        kind: media.video ? 'video' : media.audio ? 'audio' : 'image', hasAudio: Boolean(media.audio), size: resolved.stat.size };
      assets.push(info); privateAssets.set(id, { ...resolved, stamp: stamp(resolved.stat), info }); return info;
    } catch { return null; }
  }
  async function buildProject(file, production = '') {
    const projectKey=file+'|'+production;
    const recipe = await library.read(file), hit = projects.get(projectKey);
    if (hit && hit.hash === recipe.hash && Date.now() - hit.at < 30000) return hit;
    const assets = [], privateAssets = new Map();
    const model = recipeTimeline(recipe.document);
    const base = { file, recipeHash: recipe.hash, title: recipe.title, recipeDuration: durationOf(recipe.document), fps: fpsOf(recipe.document), assets, mode: 'planned', duration: model.unit === 'seconds' ? model.extent : 0,
      tracks: model.tracks.map(t => ({ id: t.id, name: t.label, code: t.short, kind: ['voice','sound'].includes(t.id) ? 'audio' : 'annotation', clips: t.clips.map(c => ({ ...c, end: c.end, note: c.facts.map(f => `${f.label}: ${f.value}`).join('\n\n'), evidence: 'Planejado' })) })),
      notes: ['Esta receita ainda não tem uma montagem compatível com a reconstrução experimental. Os blocos abaixo mostram o planejamento.', model.note], pending: model.pending, unit: model.unit };
    const folder = recipe.document.collection;
    let integrityFailure=false;
    if ((!production || production==='entregas:'+folder) && typeof folder === 'string' && /^[a-zA-Z0-9_-]+$/.test(folder)) {
      try {
        const candidates = (await fs.readdir(path.join(outputRoot, folder, 'receitas'))).filter(f => f.endsWith('.receipt.json')).slice(0, 200);
        let receipt, receiptFile;
        for (const name of candidates) {
          const candidate = await readJson(`${folder}/receitas/${name}`).catch(()=>null);
          if(!candidate)continue;
          if (candidate.schema === 'gerador-de-videos/dual-voice-assembly-receipt@1' && candidate.collection === folder) {
            if (receipt) throw fail('Há mais de uma montagem compatível.'); receipt = candidate; receiptFile = `${folder}/receitas/${name}`;
          }
        }
        if (receipt) {
          // Este leitor legado reconcilia o recibo com a lista efetivamente concatenada.
          const concat = await resolveOutputFile(outputRoot, `${folder}/montagem/concat-final.txt`);
          if (concat.stat.size > 256000) throw fail('Lista de montagem muito grande.');
          const entries = readConcatList(await fs.readFile(concat.file, 'utf8'));
          if (entries.length !== receipt.scenes.length + 1 || entries.length > 100) throw fail('Lista e recibo divergentes.');
          receipt.scenes.forEach((s, i) => { if (path.basename(entries[i]) !== `${s.id}.mp4`) throw fail('Ordem da montagem divergente.'); });
          const master = await asset(receipt.finalFile, 'master', 'Master final', assets, privateAssets);
          if (!master) throw fail('Master não encontrado.');
          const hash = createHash('sha256'); for await (const chunk of createReadStream(privateAssets.get('master').file)) hash.update(chunk);
          if (hash.digest('hex') !== receipt.sha256) {integrityFailure=true;throw fail('O master mudou desde o recibo.');}
          const normalized = await Promise.all(entries.map((entry, i) => asset(entry, `clip-${i}`, clean(path.basename(entry)), assets, privateAssets)));
          if (normalized.some(a => !a)) throw fail('Um dos trechos montados está ausente.');
          let cuts = receiptCuts(receipt, normalized.map(a => a.duration)), exactCuts = false;
          if (Math.abs(cuts.at(-1).end - master.duration) > .25) throw fail('A duração dos trechos diverge do master.');
          try {
            const masterPackets=await bounded(()=>packets(privateAssets.get('master').file));
            const sources=await Promise.all(normalized.map(a=>bounded(()=>packets(privateAssets.get(a.id).file))));
            cuts=alignCutPackets(cuts,masterPackets,sources,master.duration,master.fps || base.fps);exactCuts=true;
          } catch { /* Recibos legados continuam legíveis, com precisão explicitamente limitada. */ }
          const origins = await Promise.all(receipt.scenes.map((s, i) => asset(s.source, `origin-${i}`, 'Original · ' + clean(s.id), assets, privateAssets)));
          const [voice, music, program, logo] = await Promise.all([
            asset(`${folder}/montagem/nyla-timeline.wav`, 'voice', 'Narração Nyla posicionada', assets, privateAssets),
            asset(`${folder}/audio/trilha-flow-70s.wav`, 'music', 'Trilha original', assets, privateAssets),
            asset(`${folder}/montagem/programa-visual-omni.mp4`, 'program', 'Programa antes da mixagem', assets, privateAssets),
            asset(receipt.ending?.officialLogo || '', 'logo', 'Logotipo do fechamento', assets, privateAssets),
          ]);
          const video = cuts.map((c, i) => ({ ...c, id: `v-${i}`, assetId: normalized[i].id, originId: origins[i]?.id, kind: 'video', evidence: exactCuts ? 'Quadros conferidos no master' : 'Posição aproximada por duração',
            note: c.ending ? 'Fechamento composto com marca e texto. Esses elementos já estão incorporados ao vídeo.' : exactCuts ? 'Corte de entrada recuperado do recibo. Os quadros dos trechos foram conferidos com os do master; a posição usa o timestamp do próprio arquivo final.' : 'Corte de entrada recuperado do recibo; posição aproximada pela concatenação e pela duração física dos trechos.',
            extension: origins[i] ? Math.max(0, c.sourceIn + c.requestedDuration - origins[i].duration) : 0 }));
          const ending = cuts.at(-1);
          const tracks = [
            { id: 'graphics', code: 'V2', name: 'Grafismos / efeitos', kind: 'annotation', clips: [{ id:'brand', title:'Marca + texto', start:ending.start, end:ending.end, kind:'annotation', assetId:logo?.id, evidence:'Incorporado à imagem', note:'Camada reconstruída do recibo de fechamento. Marca e texto já fazem parte do clipe V1; não são uma camada editável isolada.' }, { id:'dip', title:'Dip para preto', start:ending.end - finite(receipt.ending?.dipToBlackSeconds), end:ending.end, kind:'effect', evidence:'Efeito no recibo', note:'Saída para preto incorporada ao último clipe.' }].filter(c=>c.end>c.start) },
            { id:'video', code:'V1', name:'Montagem de imagem', kind:'video', clips:video },
            { id:'scene-audio', code:'A1', name:'Som das cenas', kind:'audio', clips: program ? cuts.slice(0,-1).map((c,i)=>({id:`a-${i}`,title:clean(receipt.scenes[i].id),start:c.start,end:c.end,sourceIn:c.containerStart ?? c.start,assetId:program.id,kind:'audio',evidence:'Áudio do programa',note:'Falas diretas e efeitos presentes no som original das cenas. A forma de onda vem do programa anterior à mixagem.'})) : [] },
            { id:'narration', code:'A2', name:'Narração · Nyla', kind:'audio', clips:voice ? cuts.filter(c=>/nyla/i.test(c.id)).map((c,i)=>({id:`n-${i}`,title:'Nyla · '+clean(c.id),start:c.receiptStart,end:c.receiptEnd,sourceIn:c.receiptStart,assetId:voice.id,kind:'audio',evidence:'Áudio posicionado',note:'Janela de narração da montagem registrada. A forma de onda é extraída do arquivo Nyla já posicionado, incluindo pausas.'})) : [] },
            { id:'music', code:'A3', name:'Trilha sonora', kind:'audio', clips:music ? [{id:'music-bed',title:'Flow Music · trilha contínua',start:0,end:Math.min(receipt.durationSeconds,master.duration,music.duration),sourceIn:0,assetId:music.id,kind:'audio',gain:receipt.music?.gain,fadeOut:receipt.music?.fadeOutSeconds,evidence:'Mixagem no recibo',note:'Forma de onda da trilha original. Ganho e fade do master aparecem como automação; o preview principal reproduz a mixagem final.'}] : [] },
          ];
          Object.assign(base,{mode:'reconstructed',unit:'seconds',masterId:master.id,duration:master.duration,fps:master.fps || base.fps,tracks,pending:[],receipt:receiptFile,exactCuts,
            notes:['Master conferido com o hash do recibo. '+(exactCuts?'Os hashes dos quadros codificados de cada trecho correspondem à sequência do master. Os cortes usam os timestamps desses quadros no arquivo final.':'Posições aproximadas a partir da concatenação e das durações físicas; não foi possível conferir os quadros individualmente.'), 'Grafismos incorporados não se tornam camadas separadas. O experimento permite inspecionar e ouvir materiais, sem modificar a montagem.', 'Ondas extraídas das amostras de áudio, normalizadas por arquivo apenas para visualização. Os ganhos e o fade da mixagem constam nas propriedades.']});
        }
      } catch (e) { base.assets.length = 0; privateAssets.clear(); base.notes.push(e.status ? e.message : 'Não foi possível reconstruir os registros desta produção.'); }
    }
    if(base.mode==='planned' && !integrityFailure)await localReader.enrich({recipe,base,selectedProduction:production,addAsset:(f,id,label)=>asset(f,id,label,assets,privateAssets)});
    else if(base.mode==='reconstructed'){base.productions=(await localReader.discover(recipe.document)).map(p=>({id:p.id,label:p.folder,association:p.association}));base.production='entregas:'+folder;base.masterStatus='verified';}
    const value = { hash:recipe.hash, at:Date.now(), data:base, privateAssets }; projects.set(projectKey, value);
    if (projects.size > 8) projects.delete(projects.keys().next().value);
    return value;
  }
  function reconstruct(file = EXAMPLE_RECIPE, production = '') {
    const key=file+'|'+production;
    if(projectReads.has(key)) return projectReads.get(key);
    const job=buildProject(file,production).finally(()=>projectReads.delete(key));projectReads.set(key,job);return job;
  }
  async function getAsset(file, id, production = '') {
    const key=file+'|'+production;
    const p = projects.get(key) || await reconstruct(file,production), a = p.privateAssets.get(id);
    if (!a) throw fail('Material indisponível.', 404);
    const now = await resolveMediaFile(a.file);
    if (stamp(now.stat) !== a.stamp) { projects.delete(key); throw fail('O material mudou. Reabra a montagem.', 409); }
    return a;
  }
  async function derived(file, id, type, production = '') {
    const a = await getAsset(file,id,production), key = `${a.source}:${a.rel}:${a.stamp}:${type}`;
    if (visualCache.has(key)) return visualCache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    if (type === 'wave' && !a.info.hasAudio || type === 'strip' && a.info.kind !== 'video') throw fail('Visualização indisponível.', 404);
    const job = bounded(async () => {
      const args = type === 'wave' ? ['-i',a.file,'-t','600','-vn','-ac','1','-ar','2000','-f','f32le','pipe:1']
        : ['-i',a.file,'-vf',`fps=${5 / a.info.duration},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=5x1`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'];
      const {stdout} = await exec('ffmpeg',['-hide_banner','-loglevel','error','-threads','1',...args],{encoding:'buffer',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
      const value = type === 'wave' ? {peaks:waveformPeaks(stdout),duration:Math.min(600,a.info.duration),source:'samples',assetId:id} : stdout;
      visualCache.set(key,value); if(visualCache.size>48) visualCache.delete(visualCache.keys().next().value); return value;
    }).finally(()=>inflight.delete(key)); inflight.set(key,job); return job;
  }
  return { reconstruct, getAsset, derived };
}

export function editorReconstructionRoutes(options) {
  const service = createEditorReconstruction(options);
  return async (req,res,url) => {
    if (!url.pathname.startsWith('/api/editor/reconstruction')) return false;
    const json = (status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      if(req.method!=='GET' && req.method!=='HEAD') throw fail('Esta tela apenas consulta a montagem.',405);
      const file=url.searchParams.get('file') || EXAMPLE_RECIPE, id=url.searchParams.get('asset'), production=url.searchParams.get('production') || '';
      if(url.pathname==='/api/editor/reconstruction') json(200,(await service.reconstruct(file,production)).data);
      else if(url.pathname.endsWith('/media')) {const a=await service.getAsset(file,id,production);const mime={'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};servirArquivo(req,res,a.file,mime[path.extname(a.file).toLowerCase()] || 'application/octet-stream');}
      else if(url.pathname.endsWith('/wave')) json(200,await service.derived(file,id,'wave',production));
      else if(url.pathname.endsWith('/strip')) {const bytes=await service.derived(file,id,'strip',production);res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=30','Content-Length':bytes.length});res.end(bytes);}
      else throw fail('Rota não encontrada.',404);
    } catch(e) { json(e.status || 503,{error:e.status?e.message:'Não foi possível ler a montagem.'}); }
    return true;
  };
}
