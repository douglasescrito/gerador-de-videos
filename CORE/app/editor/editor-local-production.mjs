import fs from 'node:fs/promises';
import path from 'node:path';
import { scenesOf } from './receitas-model.js';
import { classificarEntrega } from '../../lib/media-pipeline/archive-delivery.mjs';

const VIDEO = /\.(mp4|webm|mov|mkv|m4v)$/i;
const AUDIO = /\.(wav|mp3|m4a|aac|ogg|flac)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const slug = s => typeof s === 'string' && /^[a-z\d][a-z\d_-]*$/i.test(s);
const norm = s => path.resolve(s).toLowerCase();
const name = s => path.basename(s).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
const refs = a => Array.isArray(a) ? a.map(r => typeof r === 'string' ? { file:r } : r).filter(r => r && typeof r.file === 'string') : [];
const finite = n => Number.isFinite(Number(n));
const range = (start,end) => finite(start) && finite(end) && Number(start)>=0 && Number(end)>Number(start);
const inside = (root,file) => { const r=path.relative(root,file); return !r.startsWith('..') && !path.isAbsolute(r); };

// This is a reader for the existing editor, not a montage generator. It never
// changes receipts or media and never invents a relationship from a similar title.
export function createLocalProductionReader({ roots, resolveFile, readConcatList }) {
  let foldersCache;
  async function folders() {
    if (foldersCache && Date.now()-foldersCache.at<30000) return foldersCache.items;
    const items=[];
    for (const root of roots) {
      const entries=await fs.readdir(root.root,{withFileTypes:true}).catch(()=>[]);
      for(const e of entries) if(e.isDirectory() && slug(e.name)) items.push({id:root.id+':'+e.name,folder:e.name,root:root.root,source:root.id});
    }
    foldersCache={at:Date.now(),items}; return items;
  }
  async function discover(document) {
    const keys=[document.collection,document.id,document.identity?.id].filter(slug);
    return (await folders()).filter(f=>keys.some(k=>f.folder===k || (f.folder.startsWith(k+'-') && /^\d[\d_-]*$/.test(f.folder.slice(k.length+1)))))
      .map(f=>({...f,association:keys.includes(f.folder)?'Coleção da receita':'Nome da coleção com sufixo de execução',exact:keys.includes(f.folder)}))
      .sort((a,b)=>Number(b.exact)-Number(a.exact) || Number(b.folder===document.collection)-Number(a.folder===document.collection) || a.id.localeCompare(b.id,'pt-BR',{numeric:true}));
  }
  async function inventory(production) {
    const dir=path.join(production.root,production.folder), files=[];
    const real=await fs.realpath(dir); if(!inside(await fs.realpath(production.root),real)) throw Error('Coleção fora da pasta permitida.');
    let limited=false;
    async function walk(folder,depth) {
      if(depth>7 || files.length>=6000){limited=true;return;}
      const entries=await fs.readdir(folder,{withFileTypes:true});
      for(const e of entries){if(files.length>=6000){limited=true;break;} const p=path.join(folder,e.name);
        if(e.isDirectory() && !/^(_versoes-antigas|node_modules|\.git)$/.test(e.name)) await walk(p,depth+1);
        else if(e.isFile()) files.push(p); // Do not follow directory or file symlinks.
      }
    }
    await walk(dir,0);
    const records=[],lists=[],known=new Map(files.map(f=>[norm(f),f]));
    // Resolve known references first; only explicit paths can reach a sibling collection.
    async function reference(ref,owner=dir) {
      if(typeof ref!=='string' || !ref || /^(https?:|file:)/i.test(ref)) return null;
      const candidates=path.isAbsolute(ref)?[ref]:[path.resolve(owner,ref),path.resolve(dir,ref),path.resolve(production.root,ref),path.resolve(path.dirname(production.root),ref)];
      const hits=new Map();
      for(const p of new Set(candidates)) {
        try {const a=await resolveFile(p);if(a.stat.isFile())hits.set(norm(a.file),a.file);} catch { /* absent or outside permitted roots */ }
      }
      return hits.size===1 ? [...hits.values()][0] : null;
    }
    let unreadable=0;
    for(const f of files.filter(f=>/\.receipt\.json$|(?:manifest|timeline|spec|cards)\.json$/i.test(f)).slice(0,800)) {
      try {const safe=await resolveFile(f);if(safe.stat.size>2*1024*1024){unreadable++;continue;}const doc=JSON.parse(await fs.readFile(safe.file,'utf8'));records.push({file:f,doc});} catch {unreadable++;}
    }
    for(const f of files.filter(f=>/(?:concat|lista)[^/\\]*\.txt$/i.test(f))) {
      try {const safe=await resolveFile(f);if(safe.stat.size>256000)continue;const entries=readConcatList(await fs.readFile(safe.file,'utf8'));if(!entries.length || entries.length>300)continue;
        const paths=await Promise.all(entries.map(e=>reference(e,path.dirname(f))));
        if(paths.every(p=>p && VIDEO.test(p))) lists.push({file:f,paths});
      } catch { /* Unsupported directives are not interpreted as plain concatenation. */ }
    }
    return {dir,files,records,lists,reference,known,unreadable,limited};
  }
  async function enrich({ recipe, base, addAsset, selectedProduction }) {
    const productions=await discover(recipe.document);
    base.productions=productions.map(({id,folder,association})=>({id,label:folder,association}));
    if(selectedProduction && !productions.some(p=>p.id===selectedProduction)) throw Object.assign(Error('Produção não vinculada a esta receita.'),{status:400});
    const production=productions.find(p=>p.id===selectedProduction)||productions[0];
    if(!production){base.notes=['Não foram encontrados arquivos nas coleções vinculadas a esta receita. A estrutura continua disponível como planejamento.'];return;}
    base.production=production.id;
    const {dir,files,records,lists,reference,unreadable,limited}=await inventory(production);
    base.notes=[production.association+': '+production.folder+'.'];
    if(!production.exact)base.notes.push('Associação provável pelo nome da execução. Confira a produção selecionada; esta leitura não altera a receita.');
    if(unreadable)base.notes.push(`${unreadable} registros ilegíveis ou grandes foram ignorados; os demais materiais continuam disponíveis.`);
    if(limited)base.notes.push('A coleção excedeu o limite de inspeção desta abertura; parte dos materiais pode não aparecer.');
    const completed=records.filter(r=>r.doc?.schema==='mkt-videos/receipt@1' && r.doc.status==='completed');
    const finalRefs=new Map(), producers=new Map(), consumers=new Set();
    for(const r of completed) {
      const inputs=await Promise.all(refs(r.doc.inputs).map(a=>reference(a.file,path.dirname(r.file))));
      r.inputs=inputs.filter(Boolean);r.outputs=[];
      for(const ref of refs(r.doc.artifacts)) {
        const f=await reference(ref.file,path.dirname(r.file));if(!f)continue;
        const safe=await resolveFile(f);if(ref.bytes!=null && ref.bytes!==safe.stat.size)continue;
        r.outputs.push(f);producers.set(norm(f),r);
        if(VIDEO.test(f) && /^(final-master|delivery-video|mastered-video|motion-master|final-sophisticated-collection|joined-video|collection-master)$/.test(ref.role||''))finalRefs.set(norm(f),{file:f,ref,record:r});
      }
      if(r.outputs.length)for(const f of r.inputs)consumers.add(norm(f));
    }
    for(const r of records.filter(r=>/^mkt-videos\/collection-(assembly|manifest)@1$/.test(r.doc?.schema||''))) {
      const f=await reference(r.doc.finalFile,path.dirname(r.file));if(f && VIDEO.test(f))finalRefs.set(norm(f),{file:f,ref:{},record:r});
    }
    const candidates=files.filter(f=>VIDEO.test(f)).map(f=>{
      const ref=finalRefs.get(norm(f)),rel=path.relative(dir,f).replaceAll('\\','/');
      const inferred= /(^|\/)videos-unidos\/[^/]+$/.test(rel) || (!rel.includes('/') && /(?:^|[-_])(final|master)(?:[-_.]|$)/i.test(rel));
      const delivery=classificarEntrega({relPath:rel,source:production.source,isMaster:inferred},{finals:ref?[{basis:'Papel do artefato: '+(ref.ref.role||'finalFile')}]:[]});
      return {file:f,ref,delivery,score:(ref?100:0)+(ref?.ref.role==='delivery-video'?40:0)-(consumers.has(norm(f))?80:0)+(/(?:-web|1080p)\.mp4$/i.test(f)?3:0),eligible:delivery.status!=='component' && (ref||inferred)};
    }).filter(c=>c.eligible).sort((a,b)=>b.score-a.score || a.file.localeCompare(b.file));
    const byPath=new Map();
    async function add(f,id,label) {
      if(!f)return null;if(byPath.has(norm(f)))return byPath.get(norm(f));
      const a=await addAsset(f,id,label);if(a)byPath.set(norm(f),a);return a;
    }
    let master=null;
    for(const candidate of candidates) {
      const a=await add(candidate.file,master?'version-'+base.assets.length:'master',master?'Outra versão · '+name(candidate.file):name(candidate.file));
      if(a?.kind==='video' && !master){master=a;base.masterStatus=candidate.ref?'recorded':'candidate';base.masterId=a.id;base.receipt=candidate.ref?path.relative(production.root,candidate.ref.record.file).replaceAll('\\','/'):null;}
      if(base.assets.length>=8)break;
    }
    const plannedVisual=base.unit==='seconds'?base.tracks.find(t=>t.id==='visual')?.clips || []:[];
    const track=(id,code,title,kind,clips)=>({id,code,name:title,kind,clips});
    let clips=[],basis='',sequenceRows=[],sequenceFile=null;
    const timeline=records.find(r=>Array.isArray(r.doc?.cenas) && r.doc.cenas.every(c=>range(c.inicio,Number(c.inicio)+Number(c.janela)) && typeof c.arquivo==='string'));
    const spec=records.find(r=>r.doc?.schema==='mkt-videos/commercial-spec@1' && Array.isArray(r.doc.scenes) && r.doc.scenes.every(s=>Array.isArray(s.span)&&range(...s.span)));
    if(timeline){
      sequenceFile=timeline.file;basis='Posições registradas na timeline';
      for(const [i,c] of timeline.doc.cenas.entries()) {
        const origin=await reference(c.arquivo,path.dirname(timeline.file));
        const piece=files.find(f=>norm(f)===norm(path.join(dir,'videos-unidos','_pecas',`parte-${String(i).padStart(2,'0')}.mp4`)));
        sequenceRows.push({file:piece||origin,origin:piece?origin:null,title:name(c.clipe||c.arquivo),start:Number(c.inicio),end:Number(c.inicio)+Number(c.janela),sourceIn:piece?0:Number(c.corte)||0,originIn:Number(c.corte)||0,note:c.frase||''});
      }
    }else if(spec){
      sequenceFile=spec.file;basis='Janelas registradas na especificação de montagem';
      for(const s of spec.doc.scenes)sequenceRows.push({file:files.find(f=>norm(f)===norm(path.join(dir,'videos-unidos','_pecas',`p-${s.id}.mp4`))),title:s.text||s.id,start:Number(s.span[0]),end:Number(s.span[1]),sourceIn:0});
      // Opening/closing spans outside the narrated scenes are kept visible as
      // whole-master sections, not falsely attributed to an original shot.
    }else {
      const join=completed.find(r=>/concat|join|assembl/.test(r.doc.operation||'') && r.inputs.filter(f=>VIDEO.test(f)).length>1 && (!master || r.outputs.some(f=>norm(f)===norm(candidates[0]?.file||''))));
      const list=lists.sort((a,b)=>b.paths.length-a.paths.length || a.file.localeCompare(b.file))[0];
      const ordered=join?join.inputs.filter(f=>VIDEO.test(f)):list?.paths;
      if(ordered){sequenceFile=join?.file||list.file;basis='Ordem registrada · posições por duração dos arquivos';sequenceRows=ordered.map(f=>({file:f,title:name(f),sourceIn:0}));}
      else {
        const scenes=scenesOf(recipe.document);
        sequenceRows=scenes.map((s,i)=>{
          const stem=String(s.id).toLowerCase();
          const matches=files.filter(f=>VIDEO.test(f) && !/[/\\](videos-unidos|montagem|_pecas|_versoes-antigas)[/\\]/.test(f) && (path.basename(f).replace(/\.[^.]+$/,'').toLowerCase()===stem || path.basename(f).replace(/^\d+[-_]/,'').replace(/\.[^.]+$/,'').toLowerCase()===stem));
          return {file:matches.length===1?matches[0]:null,title:s.name,duration:s.duration,note:s.prompt,sceneIndex:i};
        });
        if(!sequenceRows.some(r=>r.file)){
          // Old recipe executions used parte-001, parte-002...; the numbering
          // supplies an inspection order, not evidence of final editing.
          const numbered=files.filter(f=>VIDEO.test(f) && /^parte-\d+\.mp4$/i.test(path.basename(f)) && !f.includes(path.sep+'_pecas'+path.sep)).sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
          if(numbered.length)sequenceRows=numbered.map(f=>({file:f,title:name(f)}));
        }
        basis='Clipes disponíveis · ordem da receita ou numeração dos arquivos';
      }
    }
    let cursor=0;
    for(const [i,row] of sequenceRows.slice(0,300).entries()){
      const a=await add(row.file,'clip-'+i,row.title),origin=await add(row.origin,'origin-'+i,'Original · '+row.title);
      const start=row.start??cursor,duration=row.end!=null?row.end-start:a?.duration||row.duration;
      if(!(duration>0))continue;
      const end=start+duration;cursor=end;
      clips.push({id:'v-'+i,kind:'video',title:row.title,start,end,assetId:a?.id,originId:origin?.id,sourceIn:row.sourceIn||0,originIn:row.originIn,missing:!a,evidence:a?basis:'Material da cena não encontrado',note:row.note||basis});
    }
    const physical=clips.filter(c=>c.assetId);
    if(!physical.length)clips=[];
    const extent=master?.duration || (physical.length?Math.max(...clips.map(c=>c.end)):base.duration);
    if(master) {
      // Preserve uncovered sections of the physical output, including tails and
      // legacy endings, without inventing cuts or stretching preceding clips.
      const filled=[];let cursor=0;
      for(const c of clips){if(c.start>cursor+.05)filled.push({id:'unmapped-'+filled.length,kind:'video',title:'Trecho do vídeo · corte não mapeado',start:cursor,end:Math.min(c.start,extent),assetId:master.id,sourceIn:cursor,evidence:'Vídeo disponível · origem do corte não identificada'});if(c.start<extent)filled.push({...c,end:Math.min(c.end,extent)});cursor=Math.max(cursor,c.end);}
      if(cursor<extent-.001)filled.push({id:'unmapped-tail',kind:'video',title:clips.length?'Fecho / trecho não mapeado':master.label,start:cursor,end:extent,assetId:master.id,sourceIn:cursor,evidence:'Arquivo físico · sem cortes reconstruídos'});
      clips=filled;
    }
    if(master || physical.length){
      base.mode=master?(physical.length?'reconstructed':'media'):'clips';base.unit='seconds';base.duration=extent;base.fps=master?.fps || base.assets.find(a=>a.kind==='video')?.fps || base.fps;base.exactCuts=false;
      base.tracks=[track('video','V1',master?'Montagem de imagem':'Sequência de clipes','video',clips)];
      if(master && !physical.length && plannedVisual.length)base.tracks.unshift({...track('recipe-chapters','R','Capítulos da receita','annotation',plannedVisual.filter(c=>c.start<extent).map(c=>({...c,id:'planned-'+c.id,end:Math.min(c.end,extent),kind:'annotation',evidence:'Planejamento · não é um corte comprovado',note:'Janela prevista na receita. O vídeo abaixo é real, mas estes capítulos não comprovam pontos de edição no arquivo final.'}))),planned:true});
      base.notes.push(master?(base.masterStatus==='recorded'?'Vídeo final indicado por recibo concluído; arquivo e tamanho conferidos.':'Vídeo localizado pelo nome ou pasta de entrega; a condição de master não está comprovada.'):'Prévia montada no navegador com os clipes existentes, incluindo seu áudio original. Não representa uma mixagem final.');
      if(physical.length)base.notes.push(basis+'. Os cortes não foram conferidos quadro a quadro no vídeo final.');
      if(sequenceFile)base.notes.push('Origem dos cortes: '+path.relative(production.root,sequenceFile).replaceAll('\\','/'));
      if(master?.hasAudio)base.tracks.push(track('mix','A1','Áudio do vídeo','audio',[{id:'mix',title:'Mixagem presente no vídeo',start:0,end:extent,sourceIn:0,assetId:master.id,kind:'audio',evidence:'Amostras do arquivo reproduzido'}]));
      else if(physical.some(c=>base.assets.find(a=>a.id===c.assetId)?.hasAudio))base.tracks.push(track('scene-audio','A1','Áudio original dos clipes','audio',physical.filter(c=>base.assets.find(a=>a.id===c.assetId)?.hasAudio).map(c=>({...c,id:'audio-'+c.id,kind:'audio'}))));
      const motion=completed.find(r=>r.doc.operation==='render-motion-graphics' && Array.isArray(r.doc.parameters?.cards));
      const cards=motion?.doc.parameters.cards || records.find(r=>path.basename(r.file)==='cards.json' && Array.isArray(r.doc))?.doc;
      if(cards)base.tracks.unshift(track('graphics','V2','Textos / grafismos','annotation',cards.filter(c=>range(c.start,c.end)&&c.start<extent).map((c,i)=>({id:'card-'+i,title:c.text||'Grafismo',start:Number(c.start),end:Math.min(extent,Number(c.end)),kind:'annotation',evidence:'Tempos registrados · incorporado ao vídeo',note:'Efeito: '+(c.effect||'texto')+'. Este elemento já faz parte da imagem.'}))));
      if(spec)base.tracks.unshift(track('text','T','Texto sincronizado','annotation',spec.doc.scenes.filter(s=>s.span[0]<extent).map((s,i)=>({id:'text-'+i,title:s.text||s.id,start:s.span[0],end:Math.min(extent,s.span[1]),kind:'annotation',evidence:'Janela registrada na especificação',note:'Texto sincronizado previsto na especificação materializada desta produção.'}))));
    }
    // Read the finalization chain before placing separated audio. Unpositioned
    // files still go in the bin and can be auditioned, without fake alignment.
    const chain=new Set();
    function visit(f,depth=0){const r=producers.get(norm(f));if(!r||chain.has(r)||depth>12)return;chain.add(r);r.inputs.forEach(p=>visit(p,depth+1));}
    if(master)visit(candidates.find(c=>byPath.get(norm(c.file))?.id===master.id)?.file);
    const motionScene=[...chain].find(r=>r.doc.operation==='render-html-motion-pilot' && Array.isArray(r.doc.parameters?.scene?.wordMotion));
    if(motionScene && base.mode!=='planned'){
      const words=motionScene.doc.parameters.scene.wordMotion.filter(w=>range(w.start,w.end) && w.start<extent).slice(0,1500);
      base.tracks.unshift(track('word-motion','T','Palavras em movimento','annotation',words.map((w,i)=>({id:'word-'+i,title:w.word,start:Number(w.start),end:Math.min(extent,Number(w.end)),kind:'annotation',evidence:'Tempo da palavra no recibo de renderização',note:'Palavra incorporada ao motion. A posição foi lida da cena usada pelo renderizador, vinculada à cadeia do vídeo final.'}))));
      base.notes.push('Tempos das palavras recuperados do recibo de renderização do motion, vinculado ao vídeo da produção.');
    }
    let audioIndex=0;
    for(const r of chain)if(r.doc.operation==='mix-audio')for(const ref of refs(r.doc.inputs)){
      const f=await reference(ref.file,path.dirname(r.file));if(!f||!AUDIO.test(f))continue;
      const a=await add(f,'audio-'+audioIndex++,ref.role==='voice'?'Voz na mixagem':ref.role==='music'?'Trilha na mixagem':name(f));
      if(a?.kind==='audio' && base.mode!=='planned')base.tracks.push(track('stem-'+a.id,'A'+(base.tracks.filter(t=>t.kind==='audio').length+1),a.label,'audio',[{id:'stem-'+a.id,title:a.label,start:0,end:Math.min(extent,a.duration),sourceIn:0,assetId:a.id,kind:'audio',evidence:'Entrada da mixagem registrada',gain:r.doc.parameters?.[ref.role+'Gain'],note:'Arquivo fornecido à mixagem. A escuta isolada não aplica o processamento do master.'}]));
    }
    const extras=files.filter(f=>(VIDEO.test(f)||AUDIO.test(f)||(IMAGE.test(f) && (path.dirname(f)===dir || /[/\\](imagens|images|keyframes|marca)[/\\]/.test(f)))) && !byPath.has(norm(f)) && !/[/\\](_pecas|_tmp|alinhamento|diagnosticos|deriva)[/\\]/.test(f));
    for(const f of extras.slice(0,60))await add(f,'origin-'+base.assets.length,name(f));
    if(base.mode==='planned' && base.assets.length)base.notes.push('Materiais encontrados sem relação temporal suficiente. Abra os arquivos em “Outros materiais” para conferir; a régua permanece planejada.');
    base.notes.push('Ondas extraídas do áudio real. Materiais sem posição comprovada ficam no painel, disponíveis para inspeção.');
    base.coverage={assets:base.assets.length,mappedClips:physical.length,missingClips:clips.filter(c=>c.missing).length,hasVideo:Boolean(master||physical.length)};
  }
  return { discover, enrich };
}
