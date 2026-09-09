import {productionStatus, productionLink} from './studio-production-model.js';
const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; };
const link = (text, href, cls='') => { const a=node('a',cls,text);a.href=href;return a; };
const date = value => new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const board=document.getElementById('studio-productions');
let items=[], filter='all', query='', limit=6, stamp='', timer;
const banner=node('a','studio-activity');banner.hidden=true;banner.setAttribute('aria-label','Acompanhar meu último vídeo');document.body.append(banner);
function render(){
  const jobs=items.filter(j=>['video','export'].includes(j.type)), active=jobs.filter(j=>productionStatus(j).busy), latest=active[0]||jobs[0];
  banner.hidden=!latest||!!board||document.body.classList.contains('production-mode');
  if(latest){const state=productionStatus(latest);banner.href=productionLink(latest);banner.dataset.tone=state.tone;banner.replaceChildren(node('span','activity-dot'),node('span','',active.length?`${active.length} vídeo${active.length>1?'s':''} em produção`:state.label),node('b','',state.percent===null?'Acompanhar →':state.percent+'% · Ver pedido →'));}
  if(!board)return;
  const key=JSON.stringify(jobs.map(j=>[j.id,j.status,j.message,j.mediaAvailable,j.progress]))+filter+query+limit;if(key===stamp)return;stamp=key;
  document.getElementById('production-count').textContent=jobs.length?`${jobs.length} pedidos neste Studio`:'Seus pedidos aparecem aqui assim que você gerar.';
  board.replaceChildren();
  const visible=jobs.filter(j=>{const s=productionStatus(j);return (!query||j.name.toLocaleLowerCase().includes(query))&&(filter==='all'||filter==='working'&&s.busy||filter==='attention'&&s.needsAttention||filter==='ready'&&s.ready||filter==='planned'&&j.status==='ready');});
  for(const job of visible.slice(0,limit)){
    const s=productionStatus(job), card=node('article','production-card');card.dataset.tone=s.tone;
    const head=node('div','production-card-top');head.append(node('span','production-state',s.label),node('time','',date(job.createdAt)));card.append(head,node('h2','',job.name));
    const meter=node('div','production-meter'), fill=node('span');fill.style.width=(s.percent||0)+'%';meter.append(fill);meter.classList.toggle('indeterminate',s.percent===null&&s.busy);card.append(meter);
    const detail=s.ready?'Seu vídeo está aqui. Abra para assistir ou baixar.':s.issue?.text|| (job.status==='ready'?'As cenas foram preparadas. A geração ainda precisa do seu clique.':s.sceneTotal?`${s.scenesDone} de ${s.sceneTotal} cenas disponíveis`:'Seu pedido está salvo. Acompanhe a preparação.');
    card.append(node('p','',detail));
    const foot=node('div','production-card-bottom');foot.append(node('span','',s.percent===null?'Aguardando avanço do motor':`${s.percent}% das etapas`),link(s.ready?'Assistir ao vídeo →':s.needsAttention?'Ver e resolver →':'Acompanhar →',productionLink(job),'button '+(s.ready?'primary':'')));card.append(foot);board.append(card);
  }
  if(!visible.length)board.append(node('p','production-empty',jobs.length?'Nenhum pedido neste filtro.':'Seu primeiro vídeo começa com uma ideia. Clique em Criar vídeo.'));
  const more=document.getElementById('production-more');more.hidden=visible.length<=limit;more.onclick=()=>{limit+=6;render();};
}
function update(data){items=data;render();}
if(board){document.getElementById('production-search').oninput=e=>{query=e.target.value.toLocaleLowerCase();render();};document.querySelectorAll('[data-production-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.productionFilter;limit=6;document.querySelectorAll('[data-production-filter]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));render();});}
window.addEventListener('studio:jobs',e=>update(e.detail));
new MutationObserver(()=>{if(items.length)render();}).observe(document.body,{attributes:true,attributeFilter:['class']});
async function refresh(){try{const r=await fetch('/api/gerador/jobs?view=summary',{cache:'no-store'});if(!r.ok)throw Error();update((await r.json()).items);document.getElementById('production-connection')?.replaceChildren(node('span','','● Atualizado agora'));}catch{const c=document.getElementById('production-connection');if(c)c.textContent='Sem conexão com o Studio. Tentando reconectar…';}finally{timer=setTimeout(refresh,board?5000:12000);}}
if(location.pathname.startsWith('/gerador')){ /* The existing generator owns its polling. */ }
else refresh();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!location.pathname.startsWith('/gerador')){clearTimeout(timer);refresh();}});
