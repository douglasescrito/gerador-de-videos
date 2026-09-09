import {scenesOf,durationOf,formatOf,titleOf} from './receitas-model.js';

// Business form -> edits of the same recipe. No compilation or execution here.
const START='[Escolhas do Gerador]',END='[/Escolhas do Gerador]';
const strip=s=>String(s||'').replace(/\n?\[Escolhas do Gerador\][\s\S]*?\[\/Escolhas do Gerador\]/g,'').trim();
const readMeta=doc=>{try{const first=scenesOf(doc)[0],prompt=first?at(doc,first.related?.[0]||first.path)?.prompt:'';const block=String(doc.description||prompt||'').split(START)[1]?.split(END)[0]?.trim();return block?.startsWith('{')?JSON.parse(block.split('\n')[0]):{};}catch{return {};}};
const setMeta=(doc,meta)=>{if(doc.schema.endsWith('@1'))doc.description=[strip(doc.description),START+'\n'+JSON.stringify(meta)+'\n'+END].filter(Boolean).join('\n\n');};
const at=(o,p)=>p.reduce((v,k)=>v?.[k],o);
export const simpleRecipe=doc=>doc.schema==='gerador-de-videos/receita@1'&&doc.kind==='filme';
export const canRetime=doc=>simpleRecipe(doc)&&!doc.ending&&!doc.graphics&&!doc.captions&&!doc.assembly?.transitions?.length&&(!doc.audio?.narration?.blocks?.length||(doc.audio.narration.blocks.length===1&&doc.audio.narration.blocks[0].id==='narracao-master'));
export const canEditSound=doc=>simpleRecipe(doc)&&!doc.ending;
export function businessValues(doc){
  const meta=readMeta(doc),narration=doc.audio?.narration||doc.narration;
  return {...meta,name:titleOf(doc),duration:durationOf(doc),aspect:formatOf(doc),style:doc.style||'',theme:meta.theme||'',message:meta.message||'',audience:meta.audience||'',dynamics:meta.dynamics||'keep',inserts:meta.inserts||'keep',ending:meta.ending||'keep',cta:meta.cta||'',hold:meta.hold||3,
    narration:!!narration,voice:narration?.voice||'Nyla',speech:narration?.text||narration?.blocks?.map(b=>b.text).join('\n')||'',voiceProject:narration?.documentUrl||'',music:!!(doc.audio?.music||doc.music),musicIntent:doc.audio?.musicIntent||doc.music?.intent||'',musicPreset:doc.audio?.musicPreset||'institucional',voiceDirection:narration?.readingDirection||'',automatic:doc.workflow?.humanReview!==true};
}
function promptChoices(doc,meta,rewriteBase=false){
  const all=scenesOf(doc),simple=simpleRecipe(doc);
  for(const [i,s] of all.entries()){
    const target=at(doc,s.related?.[0]||s.path);if(!target||s.path[0]==='identidade')continue;
    let base=strip(target.prompt);
    if(meta.mode==='create'&&meta.theme&&rewriteBase){
      const role=all.length===1?'Apresente e desenvolva o tema, concluindo com clareza.':i===0?'Abertura: apresente o tema com uma imagem clara e interessante.':i===all.length-1?'Encerramento: conclua a ideia com uma composição limpa.':'Desenvolvimento: mostre um novo detalhe do tema e faça a mensagem avançar.';
      base=`${role}\nTema: ${meta.theme}.\n${meta.message?'Mensagem: '+meta.message+'.\n':''}Cada cena pertence ao mesmo vídeo, com continuidade visual e sem marcas inventadas.`;
    }
    const choices=[];
    if(meta.theme&&meta.mode!=='create')choices.push(`Adaptação desta versão: substitua o tema anterior por ${meta.theme}. Preserve o papel desta cena na estrutura.`);
    if(meta.message&&meta.mode!=='create')choices.push('Mensagem central desta versão: '+meta.message+'.');
    if(meta.audience)choices.push('Público: '+meta.audience+'.');
    if(meta.dynamics&&meta.dynamics!=='keep')choices.push(({calm:'Ritmo calmo, movimentos suaves, tempo para observar e ler.',balanced:'Ritmo equilibrado, alternância natural entre ação e pausa.',energetic:'Ritmo enérgico, mudanças visuais expressivas e ação fluida; sem flashes agressivos.'})[meta.dynamics]);
    if(meta.inserts==='details'&&i>0&&i<all.length-1&&!target.references?.some(r=>r.source==='pessoas'))choices.push('Use este trecho como insert: close de um detalhe significativo do tema, sem apresentador, conectado à cena anterior.');
    if(meta.inserts==='none')choices.push('Plano contínuo, sem inserts ou cortes internos nesta cena.');
    if(i===all.length-1){if(meta.cta)choices.push('Mensagem de encerramento: '+meta.cta+'.');if(meta.ending==='hold')choices.push(`Nos últimos ${Math.min(Number(meta.hold)||3,s.duration||3)} segundos desta cena, mantenha a composição final legível. Esse arremate está dentro da duração da cena.`);if(meta.ending==='clean')choices.push('Encerrar em corte limpo, sem fade-out automático.');}
    if(simple&&meta.soundManaged){
      choices.push(doc.audio?.narration?'A locução será produzida separadamente. ZERO SPOKEN WORDS, ZERO NARRATION, ZERO VOICES. Somente efeitos sonoros visuais, sem música.':'Sem locução, sem falas e sem vozes. Use apenas efeitos sonoros discretos.');
      choices.push(doc.audio?.music?'A trilha será acrescentada separadamente; não gere música no clipe.':'Sem música.');
    }
    if(choices.filter(Boolean).length)base+='\n\n'+START+'\n'+(!simple?JSON.stringify(meta)+'\n':'')+choices.filter(Boolean).join('\n')+'\n'+END;
    target.prompt=base;
  }
}
export function editBusiness(doc,patch){
  const result=structuredClone(doc),meta={...readMeta(result)},simple=simpleRecipe(result);
  if(!meta.mode&&/^studio-(produto|historia|motion)$/.test(doc.id)&&patch.theme)meta.mode='create';
  if(patch.inserts==='details'&&simple&&!result.scenes.slice(1,-1).some(s=>!s.references?.some(r=>r.source==='pessoas')))throw Error('Esta base não tem uma cena livre no meio para um insert. Adicione uma cena no editor avançado ou escolha outra base.');
  for(const key of ['theme','message','audience','dynamics','inserts','ending','cta','hold','mode'])if(key in patch)meta[key]=patch[key];
  if(meta.mode==='create')meta.soundManaged=true;
  if(patch.theme&&meta.mode==='create'&&result.label==='Meu novo vídeo'&&!patch.name)result.label=String(patch.theme).trim().slice(0,140);
  if('name' in patch){const value=String(patch.name).trim();if(!value)throw Error('Dê um nome para este vídeo.');if(result.identity)result.identity.name=value;else result.label=value;}
  if('duration' in patch&&Number(patch.duration)!==durationOf(result)){
    if(!canRetime(result))throw Error('Esta base tem voz ou efeitos com tempos próprios. Mantenha o total ou ajuste as cenas no editor avançado.');
    const all=scenesOf(result),seconds=Number(patch.duration),minimum=all.length*4;
    if(!Number.isInteger(seconds)||seconds<minimum||seconds>120)throw Error(`Escolha de ${minimum} a 120 segundos para as ${all.length} cenas desta base.`);
    const weights=all.map(s=>Math.max(0,(s.duration||4)-4)),sum=weights.reduce((n,s)=>n+s,0);let left=seconds-minimum;
    all.forEach((s,i)=>{const extra=i===all.length-1?left:Math.min(left,Math.floor((seconds-minimum)*(sum?weights[i]/sum:1/all.length)));at(result,s.path).duration=4+extra;left-=extra;});
    result.targetDurationSeconds=seconds;if(result.audio?.music)result.audio.musicDurationSeconds=seconds;
  }
  if('aspect' in patch){if(!['16:9','9:16','1:1'].includes(patch.aspect)||simple&&patch.aspect==='1:1')throw Error('Escolha uma proporção disponível para esta base.');if(result.format?.master){const [w,h]=patch.aspect==='16:9'?[1920,1080]:patch.aspect==='9:16'?[1080,1920]:[1080,1080];Object.assign(result.format.master,{width:w,height:h});}else result.aspect=patch.aspect;}
  if('style' in patch){if(!simple)throw Error('O estilo desta receita está distribuído entre as cenas. Use os ajustes de direção abaixo ou o editor avançado.');result.style=patch.style||null;}
  if('automatic' in patch){if(!simple)throw Error('Esta receita tem sua própria política de execução.');const enabled=!!patch.automatic;result.workflow={...result.workflow,humanReview:!enabled,completionMode:enabled?'complete':'pause-for-review',authorizationMode:enabled?'production-once':'per-invocation',automaticRetry:enabled,retryPolicy:enabled?'bounded-reconciled@1':'none',omniResubmit:enabled?'evidence-guided-automatic':'evidence-guided-human',automaticCorrections:enabled,acceptedAttemptPolicy:enabled?'whisper-pass':'whisper-pass-and-human-review',maxAttempts:enabled?2:1};}
  const audioKeys=['narration','voice','speech','voiceProject','voiceDirection','music','musicIntent','musicPreset'];
  if(audioKeys.some(k=>k in patch)){
    if(!canEditSound(result))throw Error('Esta base possui áudio e arremate vinculados. Edite os blocos existentes para preservar o sincronismo.');
    const values={...businessValues(result),...patch};result.audio||={};
    if(['narration','voice','speech','voiceProject','voiceDirection'].some(k=>k in patch)){
      meta.soundManaged=true;
      if(!values.narration)delete result.audio.narration;
      else{
        const prior=result.audio.narration||{};
        if('speech' in patch&&prior.blocks?.length>1)throw Error('Esta base divide a voz por cena. Edite cada fala na revisão.');
        const text=String(values.speech||'');
        result.audio.narration={...prior,provider:'google-vids',text,voice:values.voice,documentUrl:values.voiceProject,fallbackProvider:null,readingDirection:values.voiceDirection||null,blocks:prior.blocks?.length>1?prior.blocks:[{id:'narracao-master',text}]};
      }
    }
    if(['music','musicIntent','musicPreset'].some(k=>k in patch)){meta.soundManaged=true;result.audio.music=values.music?(result.audio.music||true):false;result.audio.musicIntent=values.musicIntent;result.audio.musicPreset=values.musicPreset;result.audio.musicFadeOutSeconds=0;if(values.music)result.audio.musicDurationSeconds=Math.round(durationOf(result));}
  }
  if(simple&&'cta' in patch){const last=result.scenes.at(-1);if(patch.cta){last.onScreenText=patch.cta;last.textRendering=last.textRendering==='local-gc'?'local-gc':'omni-native';}else if(last.onScreenText===readMeta(doc).cta){delete last.onScreenText;last.textRendering='none';}}
  promptChoices(result,meta,['theme','message','mode'].some(key=>key in patch));setMeta(result,meta);return result;
}
export function editReviewScene(doc,index,patch){
  const result=structuredClone(doc),scene=scenesOf(result)[index];if(!scene)throw Error('Cena não encontrada.');const raw=at(result,scene.path),target=at(result,scene.related?.[0]||scene.path);
  if('prompt' in patch)target.prompt=patch.prompt;
  if('text' in patch){if(!simpleRecipe(result))throw Error('Esta receita mantém o texto em módulos próprios.');raw.onScreenText=patch.text||null;raw.textRendering=patch.text?'omni-native':'none';}
  if('duration' in patch){if(!canRetime(result))throw Error('Os tempos desta cena estão vinculados.');const seconds=Number(patch.duration);if(!Number.isInteger(seconds)||seconds<4||seconds>120)throw Error('Cada cena precisa de 4 a 120 segundos.');raw.duration=seconds;result.targetDurationSeconds=result.scenes.reduce((n,s)=>n+s.duration,0);if(result.audio?.music)result.audio.musicDurationSeconds=result.targetDurationSeconds;}
  if('speech' in patch){const blocks=result.audio?.narration?.blocks,block=blocks?.find(b=>b.id===scene.id||b.sceneId===scene.id);if(!block)throw Error('Edite o texto da locução no passo Voz e música.');block.text=patch.speech;result.audio.narration.text=blocks.map(b=>b.text).join(' ');}
  return result;
}
export function materialChoices(origin,doc=origin){
  const choices=[];
  if(simpleRecipe(origin))for(const [i,s] of (origin.scenes||[]).entries())for(const [j,ref] of (s.references||[]).entries()){
    const current=doc.scenes?.find(c=>c.id===s.id)||doc.scenes?.[i],key=JSON.stringify(ref),name=String(ref.relPath).split(/[\\/]/).at(-1),kind=/logo/i.test(name)?'logo':/\.(mp4|webm|mov)$/i.test(name)?'video':'image';
    choices.push({key:`scene:${i}:${j}`,name,kind,scene:i,enabled:!!current?.references?.some(r=>JSON.stringify(r)===key),editable:true});
  }
  for(const asset of origin.assets||[]){if(!['image','video'].includes(asset.mediaKind))continue;const logo=asset.role==='logo',ops=origin.postProduction?.operations||[];choices.push({key:'asset:'+asset.id,name:asset.id,kind:logo?'logo':asset.mediaKind,enabled:logo?!!doc.postProduction?.operations?.some(o=>o.assetId===asset.id):true,editable:logo&&ops.some(o=>o.assetId===asset.id)});}
  return choices;
}
export function toggleMaterial(doc,origin,key,enabled){
  const result=structuredClone(doc),choice=materialChoices(origin,doc).find(c=>c.key===key);if(!choice?.editable)throw Error('Este material tem vínculos próprios. Abra a receita completa para editá-los.');
  if(key.startsWith('scene:')){const [,i,j]=key.split(':').map((v,n)=>n?Number(v):v),ref=origin.scenes[i].references[j],current=result.scenes.find(c=>c.id===origin.scenes[i].id)||result.scenes[i];current.references=(current.references||[]).filter(r=>JSON.stringify(r)!==JSON.stringify(ref));if(enabled)current.references.push(structuredClone(ref));current.generationTask=current.references.length?'reference_to_video':'text_to_video';}
  else{const id=key.slice(6),operations=origin.postProduction.operations.filter(o=>o.assetId===id);result.postProduction.operations=result.postProduction.operations.filter(o=>o.assetId!==id);if(enabled)result.postProduction.operations.push(...structuredClone(operations));}
  return result;
}
export function businessIssues(doc){
  const v=businessValues(doc),issues=[];
  if(v.mode==='create'&&!v.theme.trim())issues.push({step:0,field:'theme',text:'Conte qual é o tema do seu vídeo.'});
  if(!v.name.trim())issues.push({step:0,field:'name',text:'Dê um nome ao vídeo.'});
  if(!(v.duration>0))issues.push({step:0,field:'duration',text:'Defina o tempo total do vídeo.'});
  if(simpleRecipe(doc)&&v.duration>120)issues.push({step:0,field:'duration',text:'Esta base aceita até 120 segundos no total.'});
  if(v.narration&&simpleRecipe(doc)){if(!v.speech.trim())issues.push({step:2,field:'speech',text:'Escreva o que a voz deve falar.'});if(!/^https:\/\/docs\.google\.com\/videos\/d\/[^/\s]+/.test(v.voiceProject))issues.push({step:2,field:'voiceProject',text:'Escolha um projeto do Google Vids para criar a voz.'});}
  if(simpleRecipe(doc)&&doc.audio?.music&&!String(doc.audio.musicIntent||'').trim()&&!['institucional','tenso','epico','caloroso'].includes(doc.audio.musicPreset))issues.push({step:2,field:'musicIntent',text:'Descreva o clima da música ou desligue a trilha sonora.'});
  scenesOf(doc).forEach((s,i)=>{if(!s.prompt?.trim())issues.push({step:3,field:'scenes',text:`Conte o que aparece na cena ${i+1}.`});});
  return issues;
}
export {strip as plainDirection};
