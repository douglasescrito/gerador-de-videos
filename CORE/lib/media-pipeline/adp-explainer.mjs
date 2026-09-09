import { validateKineticWords } from './kinetic-launch.mjs';

export const DEFAULT_EXPLAINER_ANCHORS = Object.freeze(['primeiro confira','agora combine','item pronto','mas atenção','para acompanhar']);
export const DEFAULT_EXPLAINER_COPY = Object.freeze({
  "label0": "FLUXO / EXEMPLO",
  "label1": "COMO FUNCIONA?",
  "label2": "IDENTIFICAR",
  "label3": "COMBINAR",
  "label4": "CONCLUIR A ETAPA",
  "label5": "ETAPAS DIFERENTES",
  "label6": "OBSERVE. TESTE. EVOLUA.",
  "label7": "ORIGEM",
  "label8": "Entrada",
  "label9": "DESTINO",
  "label10": "Recebe o item",
  "label11": "AVISO",
  "label12": "Notificação",
  "label13": "LISTA",
  "label14": "Itens pendentes",
  "label15": "Um fluxo conectado, passo a passo.",
  "label16": "ITEM",
  "label17": "EX01",
  "label18": "_NOVO",
  "label19": "EXEMPLO • item transformado",
  "label20": "UM GRUPO",
  "label21": "EX01_NOVO",
  "label22": "Entradas → conjunto organizado",
  "label23": "Confira os critérios antes de combinar.",
  "label24": "ITENS PENDENTES",
  "label25": "ITEM CONCLUÍDO",
  "label26": "CICLO DE REVISÃO",
  "label27": "Etapa concluída",
  "label28": "PRIMEIRA ETAPA",
  "label29": "Pré-requisito pronto",
  "label30": "PRÓXIMA ETAPA",
  "label31": "RESULTADOS",
  "label32": "Cada etapa tem seu próprio ciclo.",
  "label33": "VISÃO GERAL",
  "label34": "CRITÉRIOS",
  "label35": "ENTRADA",
  "label36": "PROCESSO",
  "label37": "RESULTADO",
  "label38": "PRONTO PARA O PRÓXIMO PASSO.",
  "groupLabel": "ENTRADA"
});

const clean = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function adpAnchors(words, phrases = DEFAULT_EXPLAINER_ANCHORS) {
  if (!Array.isArray(phrases) || phrases.length !== 5 || phrases.some(p => typeof p !== 'string' || !p.trim())) throw new Error('Explainer exige cinco frases de ancoragem.');
  const normalized = words.map(w => clean(w.word));
  let previous = -1;
  return [0, ...phrases.map(phrase => {
    const parts = phrase.trim().split(/\s+/).map(clean);
    const index = normalized.findIndex((_, i) => i > previous && parts.every((part,j) => normalized[i+j] === part));
    if (index < 0) throw new Error(`Explainer: ancora ausente ${phrase}`);
    previous = index;
    return words[index].start;
  })];
}

function paint(s) {
  const canvas=document.querySelector('canvas'), c=canvas.getContext('2d');
  canvas.width=s.width;canvas.height=s.height;
  const W=1920,H=1080,navy='#0A1732',white='#F6F5ED',cyan='#4BE4DA',yellow='#FCE45D',orange='#FF8661';
  const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>1-Math.pow(1-clamp(x),3);
  const words=s.wordMotion, starts=s.adpAnchors, groups=[];let g=[];
  for(const w of words){g.push(w);if(g.length===4 || /[.!?]$/.test(w.word)){groups.push(g);g=[];}}if(g.length)groups.push(g);
  const text=(v,x,y,size=60,color=white,align='center',weight=800)=>{c.fillStyle=color;c.font=`${weight} ${size}px Arial`;c.textAlign=align;c.textBaseline='middle';c.fillText(v,x,y);};
  const box=(x,y,w,h,color,r=26)=>{c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();};
  const line=(x,y,a,b,color=cyan,width=7)=>{c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.lineTo(a,b);c.stroke();};
  function arrow(x,y,a,b,t){line(x,y,a,b,'#28425D',6);const p=(t*.35)%1;const xx=x+(a-x)*p,yy=y+(b-y)*p; c.fillStyle=cyan;c.beginPath();c.arc(xx,yy,10,0,Math.PI*2);c.fill();const angle=Math.atan2(b-y,a-x);line(a,b,a-22*Math.cos(angle-.5),b-22*Math.sin(angle-.5));line(a,b,a-22*Math.cos(angle+.5),b-22*Math.sin(angle+.5));}
  function card(x,y,w,h,title,sub,color=cyan){box(x,y,w,h,'#172B48');box(x,y,8,h,color,3);text(title,x+w/2,y+h*.37,48,color);if(sub)text(sub,x+w/2,y+h*.72,32,white);}
  function check(x,y,z=1){c.save();c.translate(x,y);c.scale(z,z);c.fillStyle=cyan;c.beginPath();c.arc(0,0,43,0,Math.PI*2);c.fill();line(-19,0,-3,16,navy,9);line(-3,16,24,-17,navy,9);c.restore();}
  function clock(x,y,t,label){c.strokeStyle=cyan;c.lineWidth=12;c.beginPath();c.arc(x,y,94,0,Math.PI*2);c.stroke();const a=t*.9-Math.PI/2;line(x,y,x+65*Math.cos(a),y+65*Math.sin(a),yellow,10);line(x,y,x-30,y-25,white,12);text(label,x,y+145,42);}
  window.__setFrame=frame=>{
    const t=frame/s.fps; c.setTransform(s.width/W,0,0,s.height/H,0,0); c.globalAlpha=1;c.fillStyle=navy;c.fillRect(0,0,W,H);
    let k=0;for(let i=1;i<starts.length;i++)if(t>=starts[i])k=i;
    const local=t-starts[k],enter=ease(local/.42), end=starts[k+1]??s.durationSeconds;
    c.fillStyle='#102342';for(let i=0;i<8;i++){c.beginPath();c.arc(180+i*260,160+Math.sin(t*.5+i)*45,95,0,7);c.fill();}
    text(s.explainerCopy.label0,90,57,30,cyan,'left');text(`${k+1} / 6`,1830,57,30,cyan,'right');
    const headers=[s.explainerCopy.label1,s.explainerCopy.label2,s.explainerCopy.label3,s.explainerCopy.label4,s.explainerCopy.label5,s.explainerCopy.label6];
    c.save();c.translate(960,155+35*(1-enter));c.scale(.94+.06*enter,.94+.06*enter);text(headers[k],0,0,k===5?67:78,yellow);c.restore();
    c.save();c.translate(0,20*(1-enter));
    if(k===0){
      card(100,315,430,190,s.explainerCopy.label7,s.explainerCopy.label8);card(735,315,430,190,s.explainerCopy.label9,s.explainerCopy.label10);arrow(550,410,710,410,local);
      card(1350,275,455,125,s.explainerCopy.label11,s.explainerCopy.label12,yellow);card(1350,445,455,125,s.explainerCopy.label13,s.explainerCopy.label14,yellow);arrow(1185,410,1325,335,local);arrow(1185,410,1325,505,local);
      text(s.explainerCopy.label15,960,635,44);
    }else if(k===1){
      card(180,265,600,165,s.explainerCopy.label16,s.explainerCopy.label17);card(1140,265,600,165,s.explainerCopy.label7,s.explainerCopy.label17);text('=',960,342,110,yellow);
      const target=words.find(w=>w.word.toLowerCase().startsWith(s.cuePrefixes[0]))?.start??starts[1]+6;
      const u=ease((t-target)/.55);box(455,470,1010,150,'#F6F5ED');text(s.explainerCopy.label17,u?795:960,547,100,navy);if(u){c.save();c.globalAlpha=u;text(s.explainerCopy.label18,1090+180*(1-u),547,100,'#00776C');c.restore();}
      text(s.explainerCopy.label19,960,671,32,cyan);
    }else if(k===2){
      for(let i=0;i<3;i++){const y=250+i*140;card(165,y,405,108,`${s.explainerCopy.groupLabel} ${i+1}`,s.explainerCopy.label17);arrow(600,y+54,1160,415,local+i*.35);}
      card(1210,315,525,210,s.explainerCopy.label20,s.explainerCopy.label21,yellow);check(1670,300,1+.08*Math.sin(local*2));
      text(s.explainerCopy.label22,1140,638,43);text(s.explainerCopy.label23,960,705,32,orange);
    }else if(k===3){
      box(155,250,700,380,'#172B48');text(s.explainerCopy.label24,505,305,42,cyan);
      const cue=words.find(w=>w.start>starts[3]&&w.word.toLowerCase().startsWith(s.cuePrefixes[1]))?.start??starts[3]+3;
      const u=ease((t-cue)/1);c.save();c.globalAlpha=1-u;box(215+u*580,365,580,100,yellow);text(s.explainerCopy.label21,505+u*580,415,56,navy);c.restore();
      if(u>.8){check(505,445,ease((u-.8)/.2));text(s.explainerCopy.label25,505,550,35,cyan);}
      clock(1390,385,local,s.explainerCopy.label26);text(s.explainerCopy.label27,1390,625,46,yellow);
    }else if(k===4){
      card(140,300,615,240,s.explainerCopy.label28,s.explainerCopy.label29);check(690,300);
      arrow(790,420,1020,420,local);clock(1180,380,local,s.explainerCopy.label30);
      for(let i=0;i<3;i++){c.fillStyle=yellow;c.beginPath();c.arc(1510+i*93,370+Math.sin(local*2+i)*12,24,0,7);c.fill();box(1480+i*93,405,60,65,cyan,20);}
      text(s.explainerCopy.label31,1600,540,40,white);text(s.explainerCopy.label32,960,660,59,yellow);
    }else{
      for(const [i,label]of [s.explainerCopy.label33,s.explainerCopy.label24,s.explainerCopy.label34].entries()){const x=125+i*580;box(x,290,510,145,i===1?yellow:'#172B48');text(label,x+255,360,i===1?38:52,i===1?navy:cyan);}
      const steps=[s.explainerCopy.label35,s.explainerCopy.label36,s.explainerCopy.label37];steps.forEach((v,i)=>{const x=370+i*590;check(x,550,.9);text(v,x,630,48);if(i<2)arrow(x+90,550,x+480,550,local);});
      text(s.explainerCopy.label38,960,730,35,yellow);
    }
    c.restore();
    // Four-word groups retain context; only the spoken word gets a brief pulse.
    const group=groups.find((v,i)=>t>=v[0].start&&t<(groups[i+1]?.[0].start??s.durationSeconds));
    if(group){box(75,797,1770,195,'#F6F5ED',30);let size=97;const strings=group.map(w=>w.word.toUpperCase());c.font=`900 ${size}px Arial`;let widths=strings.map(v=>c.measureText(v).width);let total=widths.reduce((a,b)=>a+b,0)+(group.length-1)*35;if(total>1630){size*=1630/total;c.font=`900 ${size}px Arial`;widths=strings.map(v=>c.measureText(v).width);total=widths.reduce((a,b)=>a+b,0)+(group.length-1)*35;}let x=(W-total)/2;
      group.forEach((w,i)=>{const active=t>=w.start&&t<(group[i+1]?.start??w.end+.12);const q=clamp((t-w.start)/.23),pulse=active?Math.sin(q*Math.PI)*.07:0;c.save();c.translate(x+widths[i]/2,892);c.scale(1+pulse,1+pulse);if(active)box(-widths[i]/2-12,-size*.67,widths[i]+24,size*1.34,cyan,15);text(strings[i],0,0,size,active?navy:'#4D5970');c.restore();x+=widths[i]+35;});}
    for(let i=0;i<6;i++)box(90+i*292,1032,270,8,i<=k?cyan:'#253B57',4);
  };
}

export function adpExplainerDocument(scene) {
  const wordMotion=validateKineticWords(scene.wordMotion,scene.durationSeconds);
  const explainerCopy = {...DEFAULT_EXPLAINER_COPY,...scene.explainerCopy};
  for (const [key,value] of Object.entries(explainerCopy)) if (!(key in DEFAULT_EXPLAINER_COPY) || typeof value !== 'string' || value.length > 100) throw new Error('Texto do explainer inválido.');
  const cuePrefixes = scene.cuePrefixes ?? ['combine','concluido'];
  if (!Array.isArray(cuePrefixes) || cuePrefixes.length !== 2 || cuePrefixes.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Explainer exige dois prefixos de cue.');
  const data=JSON.stringify({...scene,wordMotion,explainerCopy,cuePrefixes,adpAnchors:adpAnchors(wordMotion,scene.anchorPhrases)}).replaceAll('<','\\u003c');
  return `<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0A1732}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script>(${paint.toString()})(${data});</script>`;
}
