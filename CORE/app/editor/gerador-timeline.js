import { scenesOf, durationLabel } from './receitas-model.js';

// Presentation and gestures for the existing recipe. All mutations go through
// gerador.js, so validation, local draft, undo and the canonical planner agree.
export function installCompactWorkspace(ctx) {
  const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const button=(id,text,fn)=>{const b=make('button','quiet',text);b.id=id;b.type='button';b.onclick=fn;return b;};
  const shell=document.querySelector('.generator-shell'),production=document.querySelector('.production-bar'),timeline=document.querySelector('.timeline-panel'),library=document.querySelector('.library-panel'),inspector=document.querySelector('.inspector-panel'),operations=document.querySelector('.operations-panel');
  document.querySelector('.studio-header').after(production);
  shell.append(timeline);document.body.dataset.workspaceView='story';
  production.querySelector('.eyebrow').textContent='PROJETO';
  document.querySelector('[data-view=story]').textContent='Timeline & roteiro';
  document.querySelector('[data-view=editor]').textContent='Montagem';
  document.querySelector('[data-view=json]').textContent='Receita';
  document.querySelector('.monitor-label span').textContent='MONITOR';
  $('prepare').textContent='Preparar produção';
  document.querySelector('.library-panel .panel-heading b').textContent='Biblioteca';
  document.querySelector('.library-panel > p').remove();

  const toggles=make('div','panel-toggles');
  for(const [name,label] of [['library','Biblioteca'],['inspector','Propriedades']]){
    const b=button('toggle-'+name,label,()=>{const hidden=document.body.classList.toggle(name+'-hidden');b.setAttribute('aria-pressed',String(!hidden));});b.setAttribute('aria-pressed','true');b.setAttribute('aria-label','Mostrar ou ocultar '+label.toLowerCase());toggles.append(b);
  }
  production.prepend(toggles);

  const libraryTabs=make('div','library-tabs');
  const libraryContent=make('div','library-content');
  for(const n of [...library.children].filter(n=>!n.classList.contains('panel-heading')&&!n.classList.contains('library-bottom')))libraryContent.append(n);
  const storyboard=$('storyboard');
  for(const [id,label] of [['recipes','Receitas'],['materials','Cenas']]){
    const b=button('library-'+id,label,()=>{libraryContent.hidden=id!=='recipes';storyboard.hidden=id!=='materials';libraryTabs.querySelectorAll('button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));});b.setAttribute('aria-pressed',String(id==='recipes'));libraryTabs.append(b);
  }
  library.querySelector('.panel-heading').after(libraryTabs,libraryContent,storyboard);storyboard.hidden=true;
  const brief=document.querySelector('.brief-panel'),briefDetails=make('details','project-brief');briefDetails.append(make('summary','','Intenção da produção'),brief);$('scene-inspector').append(briefDetails);

  const jobsToggle=button('jobs-toggle','Produções',()=>showJobs(operations.hidden));jobsToggle.setAttribute('aria-expanded','false');jobsToggle.setAttribute('aria-controls','jobs-drawer');production.querySelector('.bar-actions').prepend(jobsToggle);
  operations.id='jobs-drawer';operations.setAttribute('aria-label','Produções e histórico');operations.hidden=true;document.body.append(operations);
  operations.querySelector('h2').textContent='Produções';operations.querySelector('.eyebrow').textContent='ANDAMENTO & HISTÓRICO';
  const closeJobs=button('close-jobs','×',()=>showJobs(false));closeJobs.setAttribute('aria-label','Fechar produções');operations.querySelector('.panel-heading').append(closeJobs);
  function showJobs(open){operations.hidden=!open;jobsToggle.setAttribute('aria-expanded',String(open));if(open)closeJobs.focus();else{operations.querySelectorAll('video,audio').forEach(media=>media.pause());jobsToggle.focus();}}
  operations.addEventListener('click',e=>{const action=e.target.closest('.job-actions button');if(action&&['Abrir no editor','Carregar receita','Ver direção da IA'].includes(action.textContent))showJobs(false);});
  const activity=make('section','generation-strip');activity.id='generation-strip';activity.hidden=true;activity.setAttribute('aria-label','Andamento da produção');
  const activityDot=make('span','activity-dot'),activityText=make('div','activity-text'),activityTitle=make('strong'),activityDetail=make('span');activityText.setAttribute('role','status');activityText.setAttribute('aria-live','polite');activityText.append(activityTitle,activityDetail);
  const steps=make('div','generation-steps'),details=button('generation-details','Acompanhar →',()=>showJobs(true));activity.append(activityDot,activityText,steps,details);production.after(activity);
  let items=[],zoom=1,cursor=0,lastSelection='',dragIndex=null,resize=null,canClick=true;
  const liveStatuses=['planning','running','writing'];
  const names={planning:'Preparando',running:'Gerando vídeo',writing:'Escrevendo com IA',ready:'Pronto para gerar',complete:'Concluído',attention:'Precisa de atenção',interrupted:'Interrompido',paused:'Aguardando revisão'};
  const stages={tts:'Voz',music:'Trilha',alignment:'Sincronia',draft:'Imagens',video:'Vídeos',assembly:'Montagem',audioMix:'Mixagem',audioMux:'Áudio',graphics:'Textos',captions:'Legendas',postProduction:'Acabamento',qa:'Validação',delivery:'Entrega',sceneQa:'Conferência'};
  function currentProduction(){const {currentJob,source,dirty}=ctx.state();return items.find(j=>j.id===currentJob?.id)||items.find(j=>j.type==='video'&&!dirty&&j.recipeFile===source?.file&&liveStatuses.includes(j.status))||items.find(j=>liveStatuses.includes(j.status))||null;}
  function renderProgress(){
    const job=currentProduction(),{currentJob,source,dirty}=ctx.state();
    const active=items.filter(j=>liveStatuses.includes(j.status)).length;jobsToggle.textContent=active?`Produções · ${active} ativa${active===1?'':'s'}`:`Produções · ${items.length}`;jobsToggle.classList.toggle('has-active',active>0);
    activity.hidden=!job;
    if(job){
      activity.dataset.status=job.status;
      const status=job.type==='export'&&job.status==='running'?'Exportando':names[job.status]||job.status;
      activityTitle.textContent=status+' · '+(job.name||'Produção');
      const sceneStates=job.progress?.scenes||[],done=sceneStates.filter(s=>s.available).length;
      const running=(job.progress?.stages||[]).filter(s=>s.status==='running').map(s=>stages[s.name]||s.name);
      activityDetail.textContent=[sceneStates.length?`${done}/${sceneStates.length} cenas com vídeo`:'',running.length?running.join(' + '):job.status==='ready'?'Confira a versão preparada para iniciar':job.message||'',active>1?`${active} operações em andamento`:''].filter(Boolean).join(' · ');
      activityDetail.title=activityDetail.textContent;
      steps.replaceChildren(...(job.progress?.stages||[]).filter(s=>s.status!=='skipped').slice(0,12).map(s=>{const n=make('span',s.status,stages[s.name]||s.name);n.title=(stages[s.name]||s.name)+': '+(({completed:'Concluído',running:'Em andamento',pending:'Na fila',planned:'Preparado',blocked:'Aguardando',failed:'Falhou',awaiting_approval:'Aguardando revisão',attention_required:'Verificar'})[s.status]||s.status);return n;}));
      details.textContent=job.status==='ready'?'Conferir e gerar →':['attention','interrupted','paused'].includes(job.status)?'Ver detalhes →':'Acompanhar →';
    }
    // Never paint a different recipe, or an edited draft, with a job's status.
    const matching=job?.type==='video'&&(job.id===currentJob?.id||(!dirty&&job.recipeFile===source?.file));
    timeline.classList.toggle('is-generating',!!matching&&liveStatuses.includes(job.status));
    for(const clip of $('video-track').children){
      const scene=scenesOf(ctx.state().draft||{})[Number(clip.dataset.sceneIndex)];
      const state=matching?job.progress?.scenes?.find(s=>s.id===scene?.id):null;
      clip.querySelector('.clip-status')?.remove();delete clip.dataset.generation;
      if(!state)continue;
      const value=state.available?'complete':['generating','running'].includes(state.status)?'running':['failed','attention','attention_required'].includes(state.status)?'attention':'pending';
      clip.dataset.generation=value;clip.append(make('span','clip-status',({complete:'✓ Vídeo pronto',running:'● Gerando',attention:'Verificar',pending:'Na fila'})[value]));
    }
  }

  const scroll=document.querySelector('.timeline-scroll'),sheet=make('div','timeline-sheet');
  sheet.append(...scroll.children);scroll.append(sheet);
  const textTrack=make('div','track text-track');textTrack.innerHTML='<span class="track-label">T1 <small>Texto</small></span><div id="text-track" class="text-clips"></div>';sheet.querySelector('.audio-track').before(textTrack);
  const playhead=make('div','recipe-playhead');sheet.append(playhead);
  const heading=document.querySelector('.timeline-heading');
  heading.firstElementChild.innerHTML='<b>Sequência</b><output id="timeline-time" class="mono" aria-label="Posição na sequência">00:00.0</output>';
  const zoomLabel=make('label','timeline-zoom','Zoom'),zoomInput=make('input');zoomInput.id='timeline-zoom';zoomInput.type='range';zoomInput.min=1;zoomInput.max=5;zoomInput.step=.25;zoomInput.value=1;zoomInput.setAttribute('aria-label','Zoom da timeline');zoomLabel.append(zoomInput);
  const fit=button('timeline-fit','Ajustar',()=>{zoom=1;zoomInput.value=1;layoutTimeline();});heading.lastElementChild.prepend(zoomLabel,fit);
  zoomInput.oninput=()=>{zoom=Number(zoomInput.value);layoutTimeline();};
  const handle=make('div','timeline-divider');handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-label','Altura da timeline');timeline.prepend(handle);
  const timelineHeight=n=>{const height=Math.round(Math.max(220,Math.min(shell.clientHeight-210,n)));shell.style.setProperty('--timeline-height',height+'px');handle.setAttribute('aria-valuenow',String(height));};
  handle.onpointerdown=e=>{if(e.button!==0)return;const start=e.clientY,height=timeline.getBoundingClientRect().height;handle.setPointerCapture(e.pointerId);handle.onpointermove=m=>timelineHeight(height+start-m.clientY);handle.onpointerup=handle.onpointercancel=()=>{handle.onpointermove=null;};};
  handle.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();timelineHeight(timeline.clientHeight+(e.key==='ArrowUp'?20:-20));}};
  const timeLabel=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;
  const list=()=>scenesOf(ctx.state().draft||{}),total=()=>list().reduce((n,s)=>n+(s.duration||0),0);
  function paintCursor(){const sum=total(),track=$('video-track');$('timeline-time').textContent=timeLabel(cursor);playhead.style.left=(track.offsetLeft+(sum?cursor/sum*track.clientWidth:0))+'px';$('timeline-ruler').setAttribute('aria-valuenow',String(Math.round(cursor*10)/10));}
  function layoutTimeline(){
    sheet.style.width=Math.max(scroll.clientWidth,list().length*78+68)*zoom+'px';
    const ruler=$('timeline-ruler');ruler.replaceChildren();
    for(let i=0;i<=8;i++){const tick=make('span','',timeLabel(total()*i/8));tick.style.left=(i*12.5)+'%';ruler.append(tick);}
    paintCursor();
  }
  function seek(time){const all=list();if(!all.length)return;cursor=Math.max(0,Math.min(total(),time));let start=0,index=all.length-1;for(let i=0;i<all.length;i++){if(cursor<start+(all[i].duration||0)||i===all.length-1){index=i;break;}start+=all[i].duration||0;}
    // Selection redraws the recipe; restore the exact scrub position afterward.
    const requested=cursor;ctx.seekPreview(index,Math.max(0,cursor-start));cursor=requested;paintCursor();
  }
  const ruler=$('timeline-ruler');ruler.tabIndex=0;ruler.setAttribute('role','slider');ruler.setAttribute('aria-label','Posição na timeline');ruler.setAttribute('aria-valuemin','0');
  ruler.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();ruler.setPointerCapture(e.pointerId);const move=m=>{const r=$('video-track').getBoundingClientRect();seek((m.clientX-r.left)/r.width*total());};move(e);ruler.onpointermove=move;ruler.onpointerup=ruler.onpointercancel=()=>ruler.onpointermove=null;};
  ruler.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();seek(e.key==='Home'?0:e.key==='End'?total():cursor+(e.key==='ArrowLeft'?-1:1));}};
  scroll.addEventListener('click',e=>{if(!canClick){e.preventDefault();e.stopImmediatePropagation();canClick=true;}},true);

  function update(){
    const {draft,source,selected}=ctx.state();if(!draft)return;
    const all=list(),selection=source.file+':'+selected;
    if(lastSelection!==selection){cursor=all.slice(0,selected).reduce((n,s)=>n+(s.duration||0),0);lastSelection=selection;}
    cursor=Math.min(cursor,total());ruler.setAttribute('aria-valuemax',String(total()));
    $('text-track').replaceChildren(...all.map(s=>{const raw=s.path.reduce((o,k)=>o?.[k],draft),n=make('span',raw?.onScreenText?'has-text':'',raw?.onScreenText||'—');n.style.flex=`${s.duration||10} 1 0`;n.title=raw?.onScreenText||'Sem texto nesta cena';return n;}));
    for(const [i,clip] of [...$('video-track').children].entries()){
      const select=clip.querySelector('.clip-select');if(!select)continue;
      select.draggable=ctx.canArrange();select.title=all[i].name+(ctx.canArrange()?' · arraste para reordenar · duplo clique para renomear':' · selecione para editar as propriedades');
      select.ondragstart=e=>{dragIndex=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-studio-scene',String(i));clip.classList.add('dragging');};
      select.ondragend=()=>{dragIndex=null;document.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(n=>n.classList.remove('drop-before','drop-after','dragging'));};
      clip.ondragover=e=>{if(dragIndex==null)return;e.preventDefault();e.dataTransfer.dropEffect='move';const before=e.clientX<clip.getBoundingClientRect().left+clip.clientWidth/2;document.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));clip.classList.add(before?'drop-before':'drop-after');};
      clip.ondrop=e=>{if(dragIndex==null)return;e.preventDefault();const from=dragIndex,before=e.clientX<clip.getBoundingClientRect().left+clip.clientWidth/2;let to=i+(before?0:1);if(to>from)to--;dragIndex=null;ctx.reorder(from,Math.max(0,Math.min(all.length-1,to)));};
      if(ctx.canArrange()&&!clip.querySelector('.clip-resize')){
        const edge=button('','',()=>{});edge.removeAttribute('id');edge.className='clip-resize';edge.setAttribute('aria-label','Ajustar duração da cena '+(i+1));edge.title='Arraste a borda · ← → ajustam 1 segundo';
        edge.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const seconds=Math.max(4,Math.min(120,all[i].duration+(e.key==='ArrowLeft'?-1:1)));ctx.resize(i,seconds);$('video-track').children[i]?.querySelector('.clip-resize')?.focus();}};
        edge.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();edge.setPointerCapture(e.pointerId);resize={x:e.clientX,seconds:all[i].duration,pixels:$('video-track').clientWidth/total(),next:all[i].duration};clip.classList.add('resizing');};
        edge.onpointermove=e=>{if(!resize)return;resize.next=Math.max(4,Math.min(120,Math.round(resize.seconds+(e.clientX-resize.x)/resize.pixels)));clip.style.flex=`0 0 ${resize.next*resize.pixels}px`;select.querySelector('small').textContent=durationLabel(resize.next);};
        edge.onpointerup=e=>{if(!resize)return;e.stopPropagation();const {next,seconds}=resize;resize=null;canClick=false;setTimeout(()=>{canClick=true;},0);if(next!==seconds)ctx.resize(i,next);else ctx.select(i);};
        edge.onpointercancel=()=>{resize=null;ctx.select(i);};clip.append(edge);
      }
    }
    document.querySelector('.timeline-foot > span:last-child').textContent=ctx.canArrange()?'Arraste as cenas ou suas bordas · tempos planejados':'Tempos planejados · vínculos avançados nas propriedades';
    layoutTimeline();renderProgress();
  }
  new ResizeObserver(layoutTimeline).observe(scroll);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!operations.hidden&&!document.querySelector('dialog[open]')){showJobs(false);} });
  return {update,jobs(next){items=next;renderProgress();},previewTime(index,offset){const all=list();cursor=all.slice(0,index).reduce((n,s)=>n+(s.duration||0),0)+Math.min(all[index]?.duration||0,offset);paintCursor();}};
}
