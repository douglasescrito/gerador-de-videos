// Controles da sequência do editor existente. A exportação usa join/assembleFilm.
export function installEditing(ctx) {
  const $ = id => document.getElementById(id), make = (tag,text) => { const n=document.createElement(tag);if(text!=null)n.textContent=text;return n; };
  const action = (text,fn,id) => { const b=make('button',text);if(id)b.id=id;b.onclick=()=>Promise.resolve().then(fn).catch(e=>ctx.status(e.message));return b; };
  let original, edits=[], undo=[], redo=[], active=false, selected=0, base, token, exportRequest, exporting=false, audioContext, gainNode;
  const bar=make('div');bar.className='exp-edit-tools';
  const start=action('Editar uma cópia',begin,'edit-start'), back=action('Ver original',compare,'edit-compare'), undoButton=action('↶',()=>history(false),'edit-undo'), redoButton=action('↷',()=>history(true),'edit-redo');
  const exportButton=action('Exportar MP4',exportVideo,'edit-export');bar.append(start,back,undoButton,redoButton,exportButton);
  const format=make('select');format.id='edit-aspect';format.setAttribute('aria-label','Formato da exportação');['16:9','9:16','1:1'].forEach(v=>{const o=make('option',v);format.append(o);});bar.append(format);
  const result=make('span');result.id='edit-result';result.setAttribute('role','status');bar.append(result);
  document.querySelector('.exp-sequence-bar').before(bar);
  const panel=make('section');panel.className='exp-cut-inspector';panel.hidden=true;document.querySelector('.exp-inspector').prepend(panel);
  const overlay=make('div');overlay.className='exp-edit-overlay';document.querySelector('.exp-screen').append(overlay);
  let selectedClip;
  function begin() {
    if(active)return;
    if(!ctx.project())throw Error('Aguarde o carregamento da receita.');
    if(!audioContext)try{const video=$('exp-video');audioContext=new AudioContext();gainNode=audioContext.createGain();audioContext.createMediaElementSource(video).connect(gainNode);gainNode.connect(audioContext.destination);video.addEventListener('play',()=>audioContext.resume().catch(()=>{}));}catch{ctx.status('Ganho aplicado na exportação; prévia usa volume padrão.');}
    if(!original) {
      base=ctx.project();original=structuredClone(base);
      const clips=base.tracks.find(t=>t.kind==='video')?.clips || [];
      const master=base.assets.find(a=>a.id===base.masterId);
      if(master) {
        const cuts=clips.length?clips:[{start:0,end:master.duration,title:base.title}];
        edits=cuts.map(c=>({assetId:master.id,stamp:master.stamp,sourceIn:c.start,sourceOut:Math.min(c.end,master.duration),title:c.title || master.label,gainDb:0,text:'',textPosition:'bottom'}));
      } else edits=clips.filter(c=>c.assetId&&!c.missing).map(c=>{const a=base.assets.find(a=>a.id===c.assetId);return {assetId:c.assetId,stamp:a?.stamp,sourceIn:c.sourceIn||0,sourceOut:Math.min((c.sourceIn||0)+c.end-c.start,a?.duration||0),title:c.title,gainDb:0,text:'',textPosition:'bottom'};}).filter(c=>c.sourceOut>c.sourceIn);
      if(!edits.length){original=null;throw Error('Esta receita ainda não tem vídeo local para editar.');}
      format.value=master&&master.height>master.width?'9:16':'16:9';
      try { const saved=JSON.parse(localStorage.getItem('studio-montage:'+base.file+'|'+(base.production||'')));if(saved?.recipeHash===base.recipeHash&&saved.edits?.every(c=>base.assets.some(a=>a.id===c.assetId&&a.stamp===c.stamp))){edits=saved.edits;format.value=saved.aspect;ctx.status('Edição local restaurada.');} }catch{}
    }
    active=true;rebuild();
  }
  function rebuild() {
    let time=0;const clips=edits.map((e,i)=>{const start=time;time+=e.sourceOut-e.sourceIn;return {...e,id:'edit-'+i,start,end:time,kind:'video',evidence:'Edição local',gain:10**(e.gainDb/20),editIndex:i};});
    ctx.replace({...structuredClone(original),mode:'clips',masterId:null,exactCuts:false,duration:time,unit:'seconds',tracks:[{id:'video',code:'V1',name:'Montagem editada',kind:'video',clips}]},clips[selected]);
    localStorage.setItem('studio-montage:'+base.file+'|'+(base.production||''),JSON.stringify({recipeHash:base.recipeHash,edits,aspect:format.value}));
    back.textContent='Ver original';panel.hidden=false;controls();inspect(clips[selected]);
    ctx.status('Edição local · áudio já mixado acompanha os cortes. Textos novos são sobrepostos; os textos gravados no vídeo permanecem.');
  }
  function compare(){if(!original)return;if(active){active=false;ctx.replace(structuredClone(original));panel.hidden=true;overlay.hidden=true;back.textContent='Voltar à edição';controls();}else{active=true;rebuild();}}
  function change(fn){undo.push(structuredClone(edits));if(undo.length>40)undo.shift();redo=[];fn();exportRequest=null;selected=Math.max(0,Math.min(selected,edits.length-1));rebuild();}
  function history(forward){const from=forward?redo:undo,to=forward?undo:redo;if(!from.length)return;to.push(structuredClone(edits));edits=from.pop();selected=Math.min(selected,edits.length-1);exportRequest=null;rebuild();}
  function controls(){start.hidden=!!original;back.hidden=!original;undoButton.disabled=!active||!undo.length;redoButton.disabled=!active||!redo.length;exportButton.disabled=!active||exporting;format.disabled=!active;}
  function field(label,type,value,id,fn){const l=make('label',label),input=make(type==='select'?'select':'input');input.id=id;if(type==='select')['top','center','bottom'].forEach((v,i)=>{const o=make('option',['Acima','Centro','Abaixo'][i]);o.value=v;input.append(o);});else input.type=type;input.value=value;input.onchange=()=>{try{fn(input.value);}catch(e){ctx.status(e.message);input.value=value;}};l.append(input);panel.append(l);return input;}
  function inspect(clip){
    if(!active||clip?.editIndex==null)return;selected=clip.editIndex;selectedClip=clip;const e=edits[selected];panel.hidden=false;panel.replaceChildren(make('b','Editar trecho '+(selected+1)));
    field('Nome do trecho','text',e.title,'edit-title',v=>change(()=>e.title=v.slice(0,120)));
    const fps=Math.round(base.fps)||24,snap=value=>Math.round(Number(value)*fps)/fps;
    const trim=(key,value)=>{const n=snap(value),a=base.assets.find(a=>a.id===e.assetId);if(!Number.isFinite(n)||n<0||(key==='sourceIn'?n>=e.sourceOut:n<=e.sourceIn||n>a.duration+.001))throw Error('Mantenha entrada e saída dentro do vídeo original.');change(()=>e[key]=n);};
    field('Entrada na origem · s','number',Number(e.sourceIn.toFixed(4)),'edit-in',v=>trim('sourceIn',v)).step=String(1/fps);field('Saída na origem · s','number',Number(e.sourceOut.toFixed(4)),'edit-out',v=>trim('sourceOut',v)).step=String(1/fps);
    const gain=field('Ganho do áudio · dB','number',e.gainDb,'edit-gain',v=>{if(!Number.isFinite(+v)||+v< -60||+v>12)throw Error('Use ganho entre −60 e +12 dB.');change(()=>e.gainDb=+v);});gain.min=-60;gain.max=12;
    field('Novo texto sobre o vídeo','text',e.text,'edit-text',v=>{if(v.length>240)throw Error('Use até 240 caracteres.');change(()=>e.text=v);});field('Posição do texto','select',e.textPosition,'edit-text-position',v=>change(()=>e.textPosition=v));
    const buttons=make('div');buttons.className='exp-cut-actions';
    const move=d=>change(()=>{const [c]=edits.splice(selected,1);selected+=d;edits.splice(selected,0,c);});
    const left=action('← Antes',()=>move(-1),'edit-left'),right=action('Depois →',()=>move(1),'edit-right');left.disabled=selected===0;right.disabled=selected===edits.length-1;
    const split=action('Dividir no cursor',()=>{const offset=snap(ctx.cursor()-selectedClip.start);if(offset<1/fps||offset>e.sourceOut-e.sourceIn-1/fps)throw Error('Posicione o cursor dentro do trecho para dividir.');change(()=>{const cut=e.sourceIn+offset;edits.splice(selected,1,{...e,sourceOut:cut},{...e,sourceIn:cut});});},'edit-split');
    const remove=action('Remover',()=>change(()=>edits.splice(selected,1)),'edit-remove');remove.disabled=edits.length<=1;buttons.append(left,right,split,remove);panel.append(buttons);
  }
  async function exportVideo(){
    exportButton.disabled=true;exporting=true;
    try {
      token ||= (await (await fetch('/api/gerador/config')).json()).token;
      exportRequest ||= {requestId:crypto.randomUUID(),file:base.file,production:base.production||'',recipeHash:base.recipeHash,clips:structuredClone(edits),aspect:format.value,fps:[24,25,30,60].includes(Math.round(base.fps))?Math.round(base.fps):24};
      const response=await fetch('/api/gerador/export',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(exportRequest)}),job=await response.json();if(!response.ok)throw Error(job.error);
      result.textContent='Exportando a montagem…';
      const poll=async()=>{try{const r=await fetch('/api/gerador/job?id='+job.id),j=await r.json();if(j.status==='complete'){result.replaceChildren();const link=make('a','Assistir ao novo MP4 ↗');link.href='/api/gerador/media?id='+job.id;link.target='_blank';link.rel='noopener';result.append(link);exporting=false;controls();}else if(['attention','interrupted'].includes(j.status)){result.textContent=j.message;exporting=false;controls();}else setTimeout(poll,1500);}catch{result.textContent='Conexão interrompida. Consulte Produção no Gerador antes de exportar novamente.';exporting=false;controls();}};
      poll();
    }catch(e){exporting=false;controls();throw e;}
  }
  format.onchange=()=>{exportRequest=null;rebuild();};
  document.addEventListener('keydown',e=>{if(!active||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();$('edit-split')?.click();}});
  controls();
  return { select:inspect, update(time,video) {if(!active){overlay.hidden=true;if(gainNode)gainNode.gain.value=1;return;}const c=ctx.project().tracks[0].clips.find(c=>time>=c.start&&time<c.end);overlay.hidden=!c?.text;overlay.textContent=c?.text||'';overlay.dataset.position=c?.textPosition||'bottom';if(c&&gainNode){video.volume=Number($('exp-volume').value);gainNode.gain.value=10**(c.gainDb/20);}} };
}
