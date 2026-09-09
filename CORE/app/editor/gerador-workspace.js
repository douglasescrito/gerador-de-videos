import { scenesOf, titleOf, durationLabel } from './receitas-model.js';
import { documentChanges, personalizeRecipe } from './gerador-personalization.js';
import { installCompactWorkspace } from './gerador-timeline.js';

export function installWorkspace(ctx) {
  const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(text,fn,id)=>{const b=node('button','',text);if(id)b.id=id;b.onclick=()=>Promise.resolve().then(fn).catch(e=>ctx.notify(e.message));return b;};
  let reconstruction, sourceFile='', mediaFile='', mediaVersion=0, proposal, beforeProposal, latestJob, compatibilityVersion=0;
  const toolbar=node('div','workspace-tools');
  toolbar.append(button('Personalizar receita',personalize,'personalize'),button('Comparar versões',compare,'compare-version'),button('Foco',()=>{document.body.classList.toggle('focus-mode');localStorage.setItem('studio-focus',document.body.classList.contains('focus-mode'));},'workspace-focus'));
  const layout=node('details','layout-menu');layout.append(node('summary','','Painéis'));
  for(const [id,label,min,max,value] of [['library','Biblioteca',180,360,238],['inspector','Inspetor',240,460,300]]){
    const l=node('label','',label),input=node('input');input.type='range';input.min=min;input.max=max;input.value=localStorage.getItem('studio-width-'+id)||value;input.setAttribute('aria-label','Largura do painel '+label);
    const apply=()=>{document.documentElement.style.setProperty('--'+id+'-width',input.value+'px');localStorage.setItem('studio-width-'+id,input.value);};input.oninput=apply;apply();l.append(input);layout.append(l);
  }
  const lite=node('label','','Prévias leves'),check=node('input');check.type='checkbox';check.id='light-previews';check.checked=localStorage.getItem('studio-light-previews')!=='false';lite.prepend(check);layout.append(lite);
  check.onchange=()=>{localStorage.setItem('studio-light-previews',check.checked);renderStoryboard();};toolbar.append(layout);
  document.querySelector('.workspace-tabs').after(toolbar);
  document.body.classList.toggle('focus-mode',localStorage.getItem('studio-focus')==='true');
  const assemble=document.querySelector('[data-view=editor]');assemble.id='flow-assemble';assemble.onclick=()=>ctx.openEditor();
  const compatibility=node('div','compatibility-summary');compatibility.id='recipe-compatibility';$('view-story').prepend(compatibility);
  const storyboard=node('div','storyboard-grid');storyboard.id='storyboard';document.querySelector('.story-monitor').after(storyboard);
  const real=node('video','story-real');real.id='story-real';real.controls=true;real.playsInline=true;real.preload='metadata';real.hidden=true;document.querySelector('.story-monitor').insertBefore(real,$('scene-preview'));
  const realNote=node('div','story-media-note');realNote.hidden=true;real.after(realNote);
  const compact=installCompactWorkspace({...ctx,seekPreview:seekPreview});
  let previewIndex=-1,previewBinding,previewSeekVersion=0;
  function seekPreview(index,offset){
    if(index!==ctx.state().selected)ctx.select(index);
    if(!previewBinding||real.hidden)return;
    const version=++previewSeekVersion,binding=previewBinding,url=real.dataset.source;
    const seek=()=>{if(version===previewSeekVersion&&real.dataset.source===url)real.currentTime=Math.max(0,Math.min((binding.time||0)+offset,Math.max(0,real.duration-.05)));};
    if(real.readyState)seek();else real.addEventListener('loadedmetadata',seek,{once:true});
  }
  real.addEventListener('timeupdate',()=>{if(previewBinding&&!real.hidden)compact.previewTime(ctx.state().selected,Math.max(0,real.currentTime-(previewBinding.time||0)));});
  const dialog=node('dialog','workspace-dialog');dialog.id='personalize-dialog';dialog.innerHTML='<div class="panel-heading"><div><span class="eyebrow">Uma nova versão</span><h2>Personalize sua receita</h2></div><button id="personalize-close" aria-label="Fechar personalização">×</button></div><p class="muted small">A estrutura original é mantida. Confira as mudanças de conteúdo e de tempo antes de aplicar.</p><form id="personalize-form"><div class="personalize-fields"><label>Título<input name="name" maxlength="140"></label><label>Tema ou produto<input name="theme" maxlength="2000" placeholder="Ex.: café artesanal"></label><label>Mensagem principal<textarea name="message" rows="2" maxlength="2000"></textarea></label><label>Público<input name="audience" maxlength="2000"></label><label>Duração total · segundos<input name="duration" type="number" placeholder="Manter os tempos"></label><label>Chamada final<input name="cta" maxlength="240" placeholder="Texto do encerramento"></label><label>Apresentador<select name="presenter"><option value="keep">Manter como está</option><option value="none">Sem apresentador nas cenas marcadas</option></select></label></div><fieldset id="presenter-scenes"><legend>Cenas para ajustar o apresentador</legend></fieldset><div class="actions"><button id="personalize-review" type="submit" class="primary">Revisar mudanças →</button></div></form><div id="personalize-diff"></div><button id="personalize-apply" class="primary" hidden>Aplicar esta proposta</button>';
  document.body.append(dialog);$('personalize-close').onclick=()=>dialog.close();
  function showDiff(before,after){
    const target=$('personalize-diff');target.replaceChildren();const changes=documentChanges(before,after);
    target.append(node('p','',`${changes.length} campo(s) alterado(s)`));
    for(const change of changes){const row=node('article','change-row');row.append(node('b','',change.path.join(' › ')));const columns=node('div','change-columns');columns.append(node('pre','before',String(change.before??'—')),node('pre','after',String(change.after??'—')));row.append(columns);target.append(row);}
    return changes.length;
  }
  function personalize(){const {draft}=ctx.state();if(!draft)return;dialog.querySelector('h2').textContent='Personalize sua receita';$('personalize-form').hidden=false;$('personalize-diff').replaceChildren();$('personalize-apply').hidden=true;proposal=null;beforeProposal=null;
    const form=$('personalize-form');form.reset();form.elements.presenter.replaceChildren(...[{file:'keep',label:'Manter como está'},{file:'none',label:'Sem apresentador nas cenas marcadas'},...(ctx.config?.()?.presenterReferences || [])].map(p=>{const o=node('option','',p.label);o.value=p.file;return o;}));form.elements.name.value=titleOf(draft);$('presenter-scenes').replaceChildren(node('legend','','Cenas para ajustar o apresentador'));
    scenesOf(draft).forEach((s,i)=>{const l=node('label','',s.name),c=node('input');c.type='checkbox';c.value=i;c.name='presenterScenes';l.prepend(c);$('presenter-scenes').append(l);});dialog.showModal();
  }
  $('personalize-form').onsubmit=e=>{e.preventDefault();try{const input=Object.fromEntries(new FormData(e.currentTarget));input.presenterScenes=[...e.currentTarget.querySelectorAll('[name=presenterScenes]:checked')].map(n=>+n.value);beforeProposal=structuredClone(ctx.state().draft);proposal=personalizeRecipe(beforeProposal,input);$('personalize-apply').hidden=!showDiff(beforeProposal,proposal);}catch(error){ctx.notify(error.message);}};
  $('personalize-apply').onclick=()=>{if(JSON.stringify(beforeProposal)!==JSON.stringify(ctx.state().draft))return ctx.notify('A receita mudou durante a revisão. Prepare a proposta novamente.');ctx.replace(proposal);dialog.close();ctx.notify('Proposta aplicada ao rascunho. Salve como versão quando terminar.');};
  function compare(){const {draft,source}=ctx.state();if(!draft)return;dialog.querySelector('h2').textContent='Origem → rascunho atual';$('personalize-form').hidden=true;$('personalize-apply').hidden=true;showDiff(source.document,draft);dialog.showModal();}
  function referenceFor(index){
    if(!reconstruction)return null;
    const all=scenesOf(ctx.state().draft),s=all[index],tracks=reconstruction.tracks.find(t=>t.kind==='video')?.clips||[];
    const match=tracks.find(c=>c.id===s.id||c.sceneId===s.id||c.id==='video-'+s.id);
    if(match?.assetId)return {asset:reconstruction.assets.find(a=>a.id===match.assetId),time:match.sourceIn||0,estimated:false};
    if(reconstruction.masterId)return {asset:reconstruction.assets.find(a=>a.id===reconstruction.masterId),time:Math.min(all.slice(0,index).reduce((n,c)=>n+c.duration,0),reconstruction.duration-.1),estimated:true};
    return null;
  }
  const mediaUrl=(asset)=>'/api/editor/reconstruction/media?file='+encodeURIComponent(mediaFile)+'&asset='+encodeURIComponent(asset.id)+(reconstruction.production?'&production='+encodeURIComponent(reconstruction.production):'');
  function renderStoryboard(){
    const {draft,selected,dirty}=ctx.state();if(!draft)return;
    storyboard.replaceChildren();
    for(const [i,s] of scenesOf(draft).entries()){
      const card=button('',()=>ctx.select(i));card.className='story-card'+(i===selected?' selected':'');card.dataset.sceneIndex=i;
      const r=referenceFor(i),fresh=latestJob?.progress?.scenes?.find(c=>c.id===s.id&&c.available);
      const thumb=node('div','story-thumb');
      if(r?.asset){const img=node('img');img.loading='lazy';img.alt='Material da origem';img.src='/api/acervo/miniatura?source='+encodeURIComponent(r.asset.source)+'&rel='+encodeURIComponent(r.asset.rel);thumb.append(img);}
      else thumb.append(node('span','',fresh?'▶':'○'));
      thumb.append(node('small','',durationLabel(s.duration)));card.append(thumb,node('b','',s.name));
      card.append(node('small','',fresh?'Vídeo desta produção':r?'Referência da origem':'Aguardando material'));
      const raw=s.path.reduce((o,k)=>o?.[k],draft),narration=draft.audio?.narration?.blocks?.find(b=>b.id===s.id||b.sceneId===s.id);
      if(narration?.text)card.append(node('p','',`Voz: ${narration.text}`));if(raw?.onScreenText)card.append(node('p','',`Tela: ${raw.onScreenText}`));
      storyboard.append(card);
      const clip=$('video-track').children[i];clip?.querySelector('.clip-thumb')?.remove();if(clip&&r?.asset){const img=node('img','clip-thumb');img.alt='';img.loading='lazy';img.src='/api/acervo/miniatura?source='+encodeURIComponent(r.asset.source)+'&rel='+encodeURIComponent(r.asset.rel);clip.prepend(img);}
    }
    const r=referenceFor(selected),s=scenesOf(draft)[selected],fresh=latestJob?.progress?.scenes?.find(c=>c.id===s?.id&&c.available);
    const url=fresh?'/api/gerador/scene-media?id='+latestJob.id+'&scene='+encodeURIComponent(s.id):r?.asset?mediaUrl(r.asset):null;
    real.hidden=!url;realNote.hidden=!url;$('scene-preview').hidden=!!url;
    if(previewIndex!==selected||real.dataset.source!==url)previewSeekVersion++;
    previewBinding=url?{time:fresh?0:r?.time||0}:null;
    if(url){const changed=real.dataset.source!==url||previewIndex!==selected;if(real.dataset.source!==url){real.pause();real.src=url;real.dataset.source=url;}real.preload=check.checked?'metadata':'auto';real.onloadedmetadata=()=>{if(r&&!fresh)real.currentTime=Math.max(0,r.time);};if(changed&&real.readyState&&r&&!fresh)real.currentTime=Math.max(0,r.time);
      realNote.textContent=fresh?'Vídeo gerado para esta produção':`Material da receita de origem${dirty?' · o rascunho ainda não foi gerado':''}${r.estimated?' · posição estimada pela receita':''}`;
    }else{real.pause();real.removeAttribute('src');delete real.dataset.source;}
    previewIndex=selected;compact.update();
  }
  async function update(){
    const {source,draft}=ctx.state();if(!draft)return;
    if(latestJob && latestJob.id!==ctx.state().currentJob?.id && (latestJob.recipeFile!==source.file||ctx.state().dirty))latestJob=null;
    if(sourceFile!==source.file){sourceFile=source.file;mediaFile=source.file;reconstruction=null;latestJob=null;const version=++mediaVersion;renderStoryboard();
      try{
        let item=source,data,originFile=source.file;
        for(let depth=0;depth<5;depth++){
          const response=await fetch('/api/editor/reconstruction?file='+encodeURIComponent(originFile));if(!response.ok)throw Error();data=await response.json();
          if(data.assets.some(a=>a.kind==='video')||!item.lineage?.source?.file)break;
          const parent=await ctx.api('/api/receitas/item?file='+encodeURIComponent(item.lineage.source.file));
          if(parent.hash!==item.lineage.source.hash)break;
          item=parent;originFile=item.file;
        }
        if(version===mediaVersion){mediaFile=originFile;reconstruction=data;renderStoryboard();}
      }catch{if(version===mediaVersion)reconstruction=null;}
    }
    else renderStoryboard();
  }
  async function validate(){const version=++compatibilityVersion,{draft}=ctx.state();try{const result=await ctx.api('/api/gerador/compatibility',{document:draft});if(version!==compatibilityVersion)return;compatibility.className='compatibility-summary '+result.level;compatibility.replaceChildren(node('b','',result.label),node('span','',result.reasons.join(' ')));$('prepare').disabled=result.level!=='ready';ctx.onCompatibility?.(result);}catch{if(version===compatibilityVersion){compatibility.textContent='Compatibilidade indisponível. Recarregue para conferir.';ctx.onCompatibility?.({level:'adjust',reasons:['Não foi possível conferir esta receita. Recarregue a página.']});}}}
  function jobs(items){compact.jobs(items);const {source,currentJob,dirty}=ctx.state();const job=items.find(j=>j.type==='video'&&(j.id===currentJob?.id||(!dirty&&j.recipeFile===source?.file))&&j.progress?.scenes?.some(s=>s.available));if(JSON.stringify(job?.progress?.scenes)!==JSON.stringify(latestJob?.progress?.scenes)){latestJob=job;renderStoryboard();}}
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('save-version').click();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}else if(e.key==='Escape'){document.body.classList.remove('focus-mode');localStorage.setItem('studio-focus','false');}else if(e.key.toLowerCase()==='f')$('workspace-focus').click();});
  return {update,validate,jobs,proposal(before,after){beforeProposal=structuredClone(before);proposal=structuredClone(after);dialog.querySelector('h2').textContent='Revisar proposta da IA';$('personalize-form').hidden=true;$('personalize-apply').hidden=!showDiff(before,after);dialog.showModal();}};
}
