import { previewClipAt, previewSourceTime, previewSequenceTime } from './editor-preview-model.js';
import { installEditing } from './editor-editing.js';
const $ = id => document.getElementById(id);
const el = (tag,cls,text) => {const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const button = (text,fn,cls='quiet') => {const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
const root=$('exp-editor'),video=$('exp-video'),viewport=$('exp-timeline'),sheet=$('exp-sheet');
let project,selected,cursor=0,zoom=1,extent=1,width=500,source=null,showOriginals=false,raf=0,pendingSeek=null;
let previewClip=null,loopSequence=false,switching=false;
let editing;
const clipNodes=new Map(),waves=new Map(), assetById=new Map();
const file=new URLSearchParams(location.search).get('file') || 'filme-30s.receita.json';
const production=new URLSearchParams(location.search).get('production') || '';
document.body.classList.toggle('embedded-mode',new URLSearchParams(location.search).get('embedded')==='1');
const api=(kind='',id='')=>'/api/editor/reconstruction'+kind+'?file='+encodeURIComponent(file)+(production?'&production='+encodeURIComponent(production):'')+(id?'&asset='+encodeURIComponent(id):'');
const poster=a=>'/api/acervo/miniatura?source='+encodeURIComponent(a.source||'entregas')+'&rel='+encodeURIComponent(a.rel);
const videoClips=()=>project?.tracks.find(t=>t.kind==='video')?.clips || [];
const isSequence=()=>!project?.masterId && project?.mode==='clips';
const hasPreview=()=>Boolean(project?.masterId || isSequence());
const seconds=n=>`${Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:2})} s`;
const tc=n=>{const fps=Math.round(project?.fps || 24),frames=Math.max(0,Math.floor((Number(n)||0)*fps+1e-5));return [Math.floor(frames/fps/3600),Math.floor(frames/fps/60)%60,Math.floor(frames/fps)%60,frames%fps].map(v=>String(v).padStart(2,'0')).join(':');};
const position=n=>project?.unit==='steps'?`Etapa ${Math.min(Math.floor(n)+1,Math.ceil(extent))}`:tc(n);
const colors={video:'#8e9ee7',audio:'#70b998',annotation:'#c7a268'};
const setStatus=t=>{$('exp-status').textContent=t;};

async function load(){
  try{
    const response=await fetch(api());const data=await response.json();if(!response.ok)throw new Error(data.error);project=data;
    extent=project.duration || Math.max(1,...project.tracks.flatMap(t=>t.clips.map(c=>c.end)));
    project.assets.forEach(a=>assetById.set(a.id,a));
    $('exp-title').textContent=project.title;$('exp-recipe').href='/receitas?file='+encodeURIComponent(file);
    $('exp-provenance').textContent=project.mode==='reconstructed'?'Montagem recuperada dos arquivos locais':project.mode==='media'?'Vídeo disponível · cortes não mapeados':project.mode==='clips'?'Prévia dos clipes disponíveis · sem mixagem final':project.assets.length?'Materiais disponíveis · sequência ainda planejada':'Receita planejada · sem mídia vinculada';
    $('exp-sequence').textContent=hasPreview()?(isSequence()?'Sequência de clipes':'Sequência 01 · vídeo da produção'):'Sequência planejada';
    $('exp-duration-comparison').textContent=hasPreview()?`Receita ${project.recipeDuration?seconds(project.recipeDuration):'sem duração'} → ${isSequence()?'clipes':'vídeo'} ${seconds(project.duration)}`:'Tempos previstos na receita';
    $('exp-total').textContent=position(extent);const master=assetById.get(project.masterId);
    const format=master || project.assets.find(a=>a.kind==='video');
    $('exp-format').textContent=format?`${format.width} × ${format.height} · ${project.fps} fps`:project.unit==='steps'?'Etapas sem duração definida':'Planejamento';
    $('exp-evidence').replaceChildren(...project.notes.map(n=>el('p','',n)));
    if(project.receipt)$('exp-evidence').append(el('code','',project.receipt));
    renderBin();renderTimeline();select(project.tracks.find(t=>t.kind==='video')?.clips[0] || project.tracks[0]?.clips[0],false);
    video.volume=.7;restoreMonitor();
    if(master){video.poster=poster(master);video.src=api('/media',master.id);$('exp-no-video').hidden=true;}
    else if(isSequence())seek(videoClips().find(c=>c.assetId)?.start || 0);
    else showGap();
    const choices=$('exp-production-select');choices.replaceChildren(...(project.productions||[]).map(p=>{const o=el('option','',p.label);o.value=p.id;o.title=p.association;return o;}));choices.value=project.production||'';$('exp-production-choice').hidden=choices.options.length<2;
    setStatus(hasPreview()?'Selecione um clipe ou arraste a régua. Consulte a origem e a precisão nos detalhes.':project.notes[0]);
  }catch(e){$('exp-error').hidden=false;$('exp-error').textContent=e.message;$('exp-error').append(button('Tentar novamente',()=>location.reload()));$('exp-no-video').replaceChildren(el('b','','Não foi possível abrir o projeto'));}
}
function renderBin(){
  const query=$('exp-search').value.toLocaleLowerCase('pt-BR');
  const rank=id=>id==='master'?0:id.startsWith('clip-')?1:id.startsWith('origin-')?2:3;
  const used=new Set([project.masterId,...project.tracks.flatMap(t=>t.clips.map(c=>c.assetId))].filter(Boolean));
  const items=project.assets.filter(a=>showOriginals?!used.has(a.id):used.has(a.id)).sort((a,b)=>rank(a.id)-rank(b.id)||a.id.localeCompare(b.id,'pt-BR',{numeric:true}));
  $('exp-count').textContent=items.length+' arquivos';$('exp-assets').replaceChildren();
  for(const a of items.filter(a=>a.label.toLocaleLowerCase('pt-BR').includes(query))){
    const b=button('',()=>{const clip=project.tracks.flatMap(t=>t.clips).find(c=>c.assetId===a.id || c.originId===a.id);if(clip)select(clip);if(showOriginals || !clip)showSource(a,clip);},'exp-asset');
    b.setAttribute('aria-label','Material: '+a.label);const thumb=el('span','exp-asset-thumb',a.kind==='audio'?'AUDIO':a.kind==='image'?'IMG':'');
    if(a.kind==='video'){thumb.style.backgroundImage=`url("${poster(a)}")`;}
    const info=el('span','exp-asset-info');info.append(el('b','',a.label),el('small','',`${a.duration?seconds(a.duration):'Imagem'} · ${(a.size/1048576).toFixed(1)} MB`));b.append(thumb,info);$('exp-assets').append(b);
  }
  if(!items.length)$('exp-assets').append(el('p','exp-no-track','Sem materiais vinculados nesta leitura.'));
}
function renderTimeline(){
  sheet.replaceChildren();clipNodes.clear();
  const rulerRow=el('div','exp-ruler-row');rulerRow.append(el('div','exp-track-label',project.unit==='steps'?'ETAPAS':'TEMPO · '+project.fps+' FPS'));
  const ruler=el('div','exp-ruler');ruler.id='exp-ruler';ruler.tabIndex=0;ruler.setAttribute('role','slider');ruler.setAttribute('aria-label','Cursor de edição');ruler.setAttribute('aria-valuemin','0');ruler.setAttribute('aria-valuemax',String(extent));rulerRow.append(ruler);sheet.append(rulerRow);
  for(const track of project.tracks){
    const row=el('div','exp-track '+track.kind);row.style.setProperty('--clip-color',colors[track.kind] || colors.annotation);
    const label=el('div','exp-track-label');label.append(el('b','',track.code),el('span','',track.name),el('small','',project.mode==='planned' || track.planned || track.id==='recipe-chapters'?'Planejado na receita':track.kind==='annotation'?'Tempos registrados':track.kind==='video'?(project.exactCuts?'Quadros conferidos':'Ver origem nos detalhes'):'Forma de onda real'));row.append(label);
    const lane=el('div','exp-lane');if(!track.clips.length)lane.append(el('span','exp-no-track','Sem material posicionado'));
    for(const clip of track.clips){
      const b=button('',()=>select(clip),'exp-clip '+clip.kind);b.style.left=clip.start/extent*100+'%';b.style.width=(clip.end-clip.start)/extent*100+'%';b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',`${track.code} · ${clip.title}`);b.title=clip.title;
      const asset=assetById.get(clip.assetId);
      b.classList.toggle('missing',Boolean(clip.missing));
      if(track.kind==='video' && asset?.kind==='video')b.style.backgroundImage=`url("${api('/strip',asset.id)}")`;
      b.append(el('span','exp-clip-title',clip.title),el('small','exp-clip-time',project.unit==='steps'?'Planejado':seconds(clip.end-clip.start)));
      if(track.kind==='audio' && asset?.hasAudio){const wave=el('div','exp-clip-wave');b.append(wave);const pending=el('span','exp-wave-pending','Lendo áudio…');b.append(pending);loadWave(asset).then(data=>{if(!b.isConnected)return;wave.append(waveform(data,clip));pending.remove();}).catch(()=>{pending.textContent='Onda indisponível';});}
      if(clip.fadeOut>0){const fade=el('span','exp-fade');fade.style.width=Math.min(1,clip.fadeOut/(clip.end-clip.start))*100+'%';b.append(fade);}
      lane.append(b);clipNodes.set(clip.id,b);
    }row.append(lane);sheet.append(row);
  }
  const head=el('div','exp-playhead');head.id='exp-playhead';head.setAttribute('aria-hidden','true');sheet.append(head);
  let resume=false;
  const drag=e=>{const rect=ruler.getBoundingClientRect();seek((e.clientX-rect.left)/rect.width*extent,false);};
  ruler.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();resume=!video.paused;video.pause();ruler.focus({preventScroll:true});ruler.setPointerCapture(e.pointerId);drag(e);};
  ruler.onpointermove=e=>{if(ruler.hasPointerCapture(e.pointerId))drag(e);};
  ruler.onpointerup=e=>{if(ruler.hasPointerCapture(e.pointerId)){drag(e);ruler.releasePointerCapture(e.pointerId);if(resume)play();}};
  ruler.onpointercancel=()=>{resume=false;};resize();
}
function loadWave(asset){if(!waves.has(asset.id))waves.set(asset.id,fetch(api('/wave',asset.id)).then(async r=>{if(!r.ok)throw Error('wave');return r.json();}));return waves.get(asset.id);}
function waveform(data,clip){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 40');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-label','Forma de onda extraída do arquivo');
  const max=Math.max(.001,...data.peaks),begin=clip.sourceIn || 0,duration=clip.end-clip.start,points=[];
  for(let i=0;i<260;i++){const t=begin+i/259*duration,index=Math.floor(t/data.duration*data.peaks.length),amplitude=Math.min(1,(data.peaks[index]||0)/max);points.push([i/259*1000,amplitude*18]);}
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M'+points.map(([x,y])=>`${x.toFixed(1)},${(20-y).toFixed(1)}`).join(' L')+' L'+points.reverse().map(([x,y])=>`${x.toFixed(1)},${(20+y).toFixed(1)}`).join(' L')+' Z');svg.append(path);return svg;
}
function select(clip,move=true){
  if(!clip)return;selected=clip;for(const [id,n]of clipNodes)n.setAttribute('aria-pressed',String(id===clip.id));
  // Entra 0,1 ms no quadro para evitar arredondamento do seek para o quadro anterior.
  if(move)seek(clip.start + (project.exactCuts && clip.kind==='video' ? .0001 : 0));const details=$('exp-details');details.replaceChildren(el('h2','',clip.title),el('span','exp-evidence-tag',clip.evidence || 'Planejado'));
  const grid=el('div','exp-detail-grid');for(const [label,value]of [['Entrada na montagem',position(clip.start)],['Saída na montagem',position(clip.end)],['Duração do trecho',project.unit==='steps'?'Não temporizada':seconds(clip.end-clip.start)],['Entrada na origem',clip.sourceIn!=null?tc(clip.sourceIn):'Não informada']]){const item=el('label','',label);item.append(el('output','',value));grid.append(item);}details.append(grid);
  if(clip.gain!=null)details.append(el('p','',`Ganho na mixagem: ${(20*Math.log10(clip.gain)).toLocaleString('pt-BR',{maximumFractionDigits:1})} dB · fade de saída: ${seconds(clip.fadeOut)}.`));
  if(clip.extension>.05)details.append(el('p','',`${seconds(clip.extension)} além da mídia original: extensão do quadro final prevista pela montagem.`));
  details.append(el('p','',clip.note || 'Conteúdo previsto pela receita.'));
  const a=assetById.get(clip.assetId),origin=assetById.get(clip.originId);
  if(a){details.append(button(a.kind==='audio'?'Ouvir arquivo de áudio':'Ver material isolado',()=>showSource(a,clip)));if(a.kind==='audio')details.append(el('p','','A escuta isolada usa o arquivo original, sem os ganhos e o fade da mixagem final.'));
    const paths=el('details');paths.append(el('summary','','Arquivo de origem'),el('code','',a.rel));if(origin)paths.append(el('code','',origin.rel));details.append(paths);}
  if(origin)details.append(button('Comparar com o clipe original',()=>showSource(origin,clip,true)));
  setStatus(`${clip.title} · ${position(clip.start)} → ${position(clip.end)}`);
  editing?.select(clip);
}
function sourceSeek(time){const value=Math.max(0,Number(time)||0);if(video.readyState>=1)video.currentTime=Math.min(value,Math.max(0,video.duration-.001));else pendingSeek=value;}
function showSource(asset,clip,original=false){
  video.pause();pendingSeek=null;video.removeAttribute('poster');source={asset,clip};if(asset.kind!=='image')video.src=api('/media',asset.id);else{video.removeAttribute('src');video.load();}video.hidden=asset.kind==='image';
  $('exp-monitor-title').textContent='Origem · '+asset.label;$('exp-screen-badge').textContent=asset.kind==='audio'?'ÁUDIO ISOLADO':'MATERIAL ISOLADO';$('exp-return').hidden=false;
  $('exp-no-video').hidden=asset.kind==='video';$('exp-sound-label').textContent='Arquivo original · sem a mixagem final';
  $('exp-no-video').replaceChildren(el('b','',asset.label),el('span','',asset.kind==='audio'?'Escuta isolada do arquivo de áudio.':'Imagem encontrada nos materiais da produção.'));
  if(asset.kind==='image'){const img=el('img');img.src=api('/media',asset.id);img.style.maxWidth='75%';img.style.maxHeight='70%';$('exp-no-video').prepend(img);}
  if(asset.kind!=='image')sourceSeek(original?clip?.originIn ?? clip?.sourceIn ?? 0:clip?.sourceIn || 0);$('exp-play').disabled=asset.kind==='image';$('exp-total').textContent=tc(asset.duration);switchPanel('monitor');
}
function restoreMonitor(){
  $('exp-return').hidden=true;$('exp-monitor-title').textContent='Monitor da montagem';
  $('exp-screen-badge').textContent=isSequence()?'CLIPES':project.masterStatus==='candidate'?'VÍDEO LOCAL':project.masterId?'MASTER':'PLANEJAMENTO';
  $('exp-sound-label').textContent=isSequence()?'Áudio original dos clipes':project.masterId?'Áudio do vídeo da produção':'Sem mídia na sequência';
  $('exp-total').textContent=position(extent);$('exp-play').disabled=!hasPreview();video.hidden=!hasPreview();
}
function showGap(){
  video.pause();video.hidden=true;$('exp-no-video').hidden=false;
  $('exp-no-video').replaceChildren(el('b','',hasPreview()?'Material ausente neste trecho':project.assets.length?'Materiais sem posição na sequência':'Esta receita ainda não tem mídia vinculada'),el('span','',hasPreview()?'A posição permanece visível. Reproduzir avança até o próximo clipe disponível.':project.assets.length?'Abra “Outros materiais” para ver ou ouvir os arquivos encontrados.':'O planejamento está disponível abaixo. Escolha outra receita no painel para explorar uma produção existente.'));
}
function returnMaster(){
  if(!source)return;video.pause();source=null;previewClip=null;restoreMonitor();
  if(project.masterId){video.poster=poster(assetById.get(project.masterId));video.src=api('/media',project.masterId);$('exp-no-video').hidden=true;sourceSeek(cursor);}
  else if(isSequence())loadSequenceClip(cursor);else showGap();
}
function loadSequenceClip(time){
  const clip=previewClipAt(videoClips(),time);if(!clip){previewClip=null;showGap();return;}
  video.hidden=false;$('exp-no-video').hidden=true;
  if(previewClip?.assetId!==clip.assetId || !video.getAttribute('src')){video.pause();pendingSeek=null;video.poster=poster(assetById.get(clip.assetId));video.src=api('/media',clip.assetId);}
  previewClip=clip;sourceSeek(previewSourceTime(clip,time));
}
function seek(time,pan=true){
  returnMaster();cursor=Math.min(Math.max(0,time),extent);if(project.masterId)sourceSeek(cursor);else if(isSequence())loadSequenceClip(cursor);updateCursor(pan);
}
function updateCursor(pan=false){
  $('exp-timecode').textContent=source?tc(video.currentTime):position(cursor);
  const h=$('exp-playhead');if(h)h.style.left=`calc(var(--track-label) + ${cursor/extent*width}px)`;
  const ruler=$('exp-ruler');if(ruler){ruler.setAttribute('aria-valuenow',String(cursor));ruler.setAttribute('aria-valuetext',position(cursor));}
  const active=(project.tracks.find(t=>t.kind==='video') || project.tracks.find(t=>t.id==='visual'))?.clips.find(c=>cursor>=c.start && cursor<c.end);
  $('exp-now').textContent=source?`ORIGEM ${tc(video.currentTime)} / ${tc(source.asset.duration)}`:active?.title || (cursor>=extent?'Fim da sequência':hasPreview()?'Intervalo sem clipe':'Estrutura planejada');
  for(const [id,n]of clipNodes)n.classList.toggle('playing',id===active?.id);
  editing?.update(cursor,video);
  if(pan){const label=parseFloat(getComputedStyle(root).getPropertyValue('--track-label')),x=label+cursor/extent*width;if(x>viewport.scrollLeft+viewport.clientWidth-20)viewport.scrollLeft=x-viewport.clientWidth/2;else if(x<viewport.scrollLeft+label)viewport.scrollLeft=Math.max(0,x-label-15);}
}
function resize(){
  if(!project)return;const label=parseFloat(getComputedStyle(root).getPropertyValue('--track-label'));width=Math.max(240,viewport.clientWidth-label)*zoom;sheet.style.width=width+label+'px';
  const ruler=$('exp-ruler');ruler.replaceChildren();const desired=extent/(width/90),step=project.unit==='steps'?1:[.25,.5,1,2,5,10,15,30,60,120,300,600].find(v=>v>=desired)||600;
  sheet.style.setProperty('--grid-size',step/extent*width+'px');for(let t=0;t<extent;t+=step){const tick=el('span','',project.unit==='steps'?String(t+1).padStart(2,'0'):tc(t).slice(3));tick.style.left=t/extent*100+'%';ruler.append(tick);}updateCursor();
}
async function play(){if($('exp-play').disabled)return;
  if(!source && isSequence() && !previewClip){const next=videoClips().find(c=>c.assetId && !c.missing && c.start>=cursor) || videoClips().find(c=>c.assetId && !c.missing);if(!next)return;seek(next.start);}
  try{await video.play();}catch(e){if(e.name!=='AbortError')setStatus('Não foi possível reproduzir este material. Confira se o arquivo continua disponível.');}}
function toggle(){video.paused?play():video.pause();}
function syncCursor(){if(source || switching || pendingSeek!=null || video.seeking)return;if(isSequence()){if(previewClip)cursor=previewSequenceTime(previewClip,video.currentTime);}else if(project.masterId)cursor=Math.min(video.currentTime,extent);}
async function nextPreviewClip(){
  if(switching || !isSequence() || source)return;switching=true;
  const next=videoClips().find(c=>c.assetId && !c.missing && c.start>=(previewClip?.end ?? cursor)-.001);
  if(next){seek(next.start);await play();}else if(loopSequence){seek(videoClips().find(c=>c.assetId)?.start||0);await play();}else{video.pause();previewClip=null;cursor=extent;updateCursor();}
  switching=false;
}
function frame(){if(!project)return;syncCursor();updateCursor(!source);if(!source && isSequence() && previewClip && cursor>=previewClip.end-.015){nextPreviewClip();return;}if(!video.paused)raf=requestAnimationFrame(frame);}
video.onplay=()=>{$('exp-play').textContent='Ⅱ';$('exp-play').setAttribute('aria-label','Pausar');cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);};
video.onpause=()=>{$('exp-play').textContent='▶';$('exp-play').setAttribute('aria-label','Reproduzir');cancelAnimationFrame(raf);};
video.onloadedmetadata=()=>{if(pendingSeek!=null){const t=pendingSeek;pendingSeek=null;sourceSeek(t);}updateCursor();};
video.ontimeupdate=()=>{syncCursor();updateCursor();};
video.onended=()=>{if(!source && isSequence()){nextPreviewClip();return;}if(video.loop)return;$('exp-play').textContent='▶';$('exp-play').setAttribute('aria-label','Reproduzir');};
video.onerror=()=>setStatus('Material indisponível ou formato não reproduzível. Os registros da montagem continuam visíveis.');
$('exp-play').onclick=toggle;$('exp-return').onclick=returnMaster;
function adjacent(direction){const clips=project.tracks.find(t=>t.kind==='video')?.clips || project.tracks[0]?.clips || [],points=[0,...clips.map(c=>c.start),extent].sort((a,b)=>a-b);const target=direction>0?points.find(t=>t>cursor+.02):points.reverse().find(t=>t<cursor-.02);seek(target??(direction>0?extent:0));const clip=clips.find(c=>Math.abs(c.start-cursor)<.02);if(clip)select(clip);}
$('exp-prev').onclick=()=>adjacent(-1);$('exp-next').onclick=()=>adjacent(1);
$('exp-loop').onclick=()=>{loopSequence=!loopSequence;video.loop=!isSequence() && loopSequence;$('exp-loop').setAttribute('aria-pressed',String(loopSequence));};
$('exp-mute').onclick=()=>{video.muted=!video.muted;$('exp-mute').setAttribute('aria-pressed',String(video.muted));$('exp-mute').textContent=video.muted?'Mudo':'Som';};
$('exp-volume').oninput=e=>{video.volume=Number(e.target.value);};
$('exp-zoom').oninput=e=>{zoom=Number(e.target.value);resize();updateCursor(true);};$('exp-fit').onclick=()=>{zoom=1;$('exp-zoom').value='1';viewport.scrollLeft=0;resize();};
$('exp-search').oninput=renderBin;
$('exp-used').onclick=()=>{showOriginals=false;$('exp-used').setAttribute('aria-pressed','true');$('exp-originals').setAttribute('aria-pressed','false');renderBin();};
$('exp-originals').onclick=()=>{showOriginals=true;$('exp-used').setAttribute('aria-pressed','false');$('exp-originals').setAttribute('aria-pressed','true');renderBin();};
function switchPanel(panel){root.dataset.panel=panel;document.querySelectorAll('[data-panel]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.panel===panel));});}
document.querySelectorAll('.exp-mobile-tabs button').forEach(b=>b.onclick=()=>switchPanel(b.dataset.panel));
$('exp-fullscreen').onclick=async()=>{try{document.fullscreenElement?await document.exitFullscreen():await root.requestFullscreen();}catch{setStatus('O navegador não permitiu ampliar.');}};
document.addEventListener('fullscreenchange',()=>{$('exp-fullscreen').textContent=document.fullscreenElement?'Reduzir editor':'Ampliar editor';resize();});
document.addEventListener('keydown',e=>{if(!project || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();toggle();}else if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();video.pause();if(e.key==='Home')seek(0);else if(e.key==='End')seek(extent);else seek(cursor+(e.key==='ArrowRight'?1:-1)*(project.unit==='steps'?1:1/project.fps));}});
const observer=new ResizeObserver(resize);observer.observe(viewport);window.addEventListener('pagehide',()=>{video.pause();cancelAnimationFrame(raf);observer.disconnect();});
editing=installEditing({project:()=>project,cursor:()=>cursor,status:setStatus,replace:(next,clip)=>{
  video.pause();cancelAnimationFrame(raf);source=null;previewClip=null;pendingSeek=null;project=next;extent=next.duration;cursor=0;
  assetById.clear();project.assets.forEach(a=>assetById.set(a.id,a));video.loop=false;
  $('exp-sequence').textContent=project.tracks[0]?.name==='Montagem editada'?'Montagem editada · cópia local':'Sequência da produção';
  $('exp-duration-comparison').textContent=`Receita ${seconds(project.recipeDuration)} → sequência ${seconds(extent)}`;
  renderBin();renderTimeline();restoreMonitor();
  if(project.masterId){video.src=api('/media',project.masterId);$('exp-no-video').hidden=true;}
  select(clip||videoClips()[0]);seek(clip?.start||0);
}});
load();
fetch('/api/receitas').then(r=>r.json()).then(data=>{const select=$('exp-recipe-select');select.replaceChildren(...data.items.map(r=>{const o=el('option','',r.title);o.value=r.file;return o;}));select.value=file;}).catch(()=>{$('exp-recipe-select').replaceChildren(el('option','','Biblioteca indisponível'));});
$('exp-recipe-select').onchange=e=>location.assign('/editor?experimental=1&file='+encodeURIComponent(e.target.value));
$('exp-production-select').onchange=e=>location.assign('/editor?experimental=1&file='+encodeURIComponent(file)+'&production='+encodeURIComponent(e.target.value));
