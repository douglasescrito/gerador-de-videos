import { scenesOf } from './receitas-model.js';
export function installContextAI(ctx) {
 const $=id=>document.getElementById(id),panel=$('ai-inspector'),select=document.createElement('select');select.id='ai-purpose';select.setAttribute('aria-label','Ação da IA');
 for(const [value,label] of [['product','Direção de produto'],['shorten','Encurtar uma fala'],['opening','Criar outra abertura'],['vertical','Adaptar cena para vertical'],['rewrite','Melhorar direção da cena']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
 panel.prepend(select);const note=document.createElement('p');note.className='validation';note.id='ai-availability';select.after(note);
 let base,target,requestContext,selectionRevision=0;
 const at=(object,path)=>path.reduce((v,k)=>v?.[k],object);
 function scope(){
  base=structuredClone(ctx.state().draft);const scene=scenesOf(base)[select.value==='opening'?0:ctx.state().selected];
  if(!scene)throw Error('Escolha uma cena.');
  if(scene.path[0]==='identidade')throw Error('Esta estrutura exige edição pelos campos próprios da receita.');
  if(select.value==='shorten'){
    const narration=base.audio?.narration;
    if(!narration)throw Error('Esta receita não possui narração separada.');
    const index=narration.blocks?.findIndex(b=>b.id===scene.id||b.sceneId===scene.id);
    target=index>=0?['audio','narration','blocks',index,'text']:narration.blocks?.length===1?['audio','narration','blocks',0,'text']:['audio','narration','text'];
    if(narration.blocks?.length>1&&index<0)throw Error('Selecione uma cena vinculada a um bloco de fala antes de encurtar.');
  } else target=[...(scene.related?.[0]||scene.path),'prompt'];
  return at(base,target)||'';
 }
 function update(){
  const contextual=select.value!=='product',cap=ctx.config()?.capabilities?.find(c=>c.id===(contextual?'gemini-context-text':'gemini-product-text')),supported=cap?.status==='supported';
  note.textContent=contextual?(supported?'Texto contextual disponível. Revise a proposta antes de aplicar.':'IA contextual indisponível: o chat do AI Studio retornou erro interno na verificação. Você pode editar o texto manualmente abaixo.'):'Direção de produto · integração Gemini do Omni.';
  panel.querySelector('.eyebrow').textContent=contextual?'Gemini · texto contextual':'Gemini 3.1 Flash Lite';
  panel.querySelector('h2').textContent=select.options[select.selectedIndex].textContent;
  panel.querySelector('h2 + p').textContent=contextual?'A proposta usa o texto da cena ou da fala selecionada. Nenhum vídeo é gerado nesta etapa.':'Descreva um produto para escrever um comercial com planos e tempos, em inglês.';
  panel.lastElementChild.textContent='A proposta só altera o rascunho depois da sua revisão. Vídeos já existentes permanecem como estão.';
  $('ai-atmosphere').closest('label').hidden=contextual;$('ai-generate').disabled=!supported||Boolean(requestContext?.writing);$('ai-generate').textContent=contextual?'✦ Propor alteração':'✦ Escrever direção';
 }
 select.onchange=()=>{selectionRevision++;$('ai-result').value='';$('ai-apply').disabled=true;try{$('ai-brief').value=scope();}catch(e){base=null;target=null;ctx.notify(e.message);}update();};
 $('ai-generate').onclick=()=>ctx.guarded(async()=>{
   const purpose=select.value,source=scope();const prompt=$('ai-brief').value.trim()||source,atmosphere=purpose==='product'?$('ai-atmosphere').value:'';
   const old=ctx.pending();const request=old&&old.prompt===prompt&&old.atmosphere===atmosphere&&old.purpose===purpose?old:{requestId:crypto.randomUUID(),prompt,atmosphere,purpose};ctx.pending(request);$('ai-generate').disabled=true;
   requestContext={id:request.requestId,purpose,base:structuredClone(base),target:[...target],selected:ctx.state().selected,sourceFile:ctx.state().source.file,selectionRevision,writing:true};
   try{await ctx.api('/api/gerador/text',request);$('ai-status').textContent='Escrevendo proposta…';await ctx.refresh();}catch(e){requestContext.writing=false;update();throw e;}
 });
 $('ai-apply').textContent='Revisar aplicação à receita';
 $('ai-apply').onclick=()=>ctx.guarded(()=>{
   if(!base||!target)scope();
   if(JSON.stringify(base)!==JSON.stringify(ctx.state().draft))throw Error('A receita mudou desde a proposta. Selecione novamente a ação para usar o contexto atual.');
   const text=$('ai-result').value.trim();if(!text)throw Error('Escreva ou gere uma proposta.');
   const after=structuredClone(base);at(after,target.slice(0,-1))[target.at(-1)]=text;
   if(select.value==='shorten'&&after.audio.narration.blocks?.length)after.audio.narration.text=after.audio.narration.blocks.map(b=>b.text).join(' ');
   if(select.value==='vertical'){if(after.format?.master){after.format.master.width=1080;after.format.master.height=1920;}else after.aspect='9:16';}
   ctx.proposal(base,after);
 });
 function showResult(job){
   selectionRevision++;select.value=job.purpose||'product';scope();update();
   $('ai-result').value=job.text;$('ai-apply').disabled=!job.text?.trim();
   $('ai-status').textContent='Proposta do histórico. Revise sua aplicação à cena atual.';
 }
 function receiveJob(job){
   if(job.id!==ctx.pending()?.requestId)return;
   if(requestContext)requestContext.writing=job.status==='writing';
   if(job.text){
     const sameContext=requestContext?.selectionRevision===selectionRevision&&requestContext.purpose===select.value&&requestContext.selected===ctx.state().selected&&requestContext.sourceFile===ctx.state().source.file&&JSON.stringify(requestContext.base)===JSON.stringify(ctx.state().draft);
     if(sameContext){base=requestContext.base;target=requestContext.target;$('ai-result').value=job.text;$('ai-apply').disabled=false;$('ai-status').textContent='Proposta pronta para revisão.';}
     else ctx.notify('A proposta de IA ficou pronta e está disponível em Produção. Seu contexto atual foi preservado.');
     ctx.pending(null);
   }else $('ai-status').textContent=job.message||(job.status==='writing'?'Escrevendo proposta…':'A operação precisa de atenção.');
   update();
 }
 return {update,showResult,receiveJob};
}
