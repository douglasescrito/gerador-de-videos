// Repository-owned motion template. It consumes the existing Whisper word
// timestamps directly; no executable document or second timeline is accepted.
export function validateKineticWords(words, durationSeconds) {
  if (!Array.isArray(words) || !words.length || words.length > 600) throw new Error("Motion exige 1 a 600 palavras medidas.");
  let previous = -1;
  return words.map((entry, index) => {
    const word = String(entry.word ?? "").trim();
    const start = Number(entry.start), end = Number(entry.end);
    if (!word || word.length > 100 || /[\u0000-\u001f]/u.test(word) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start < previous || end > durationSeconds) throw new Error(`Palavra medida ${index + 1} inválida.`);
    previous = start;
    return { word, start, end };
  });
}

function paintKineticLaunch(s) {
  const canvas = document.querySelector("canvas");
  const c = canvas.getContext("2d");
  canvas.width = s.width; canvas.height = s.height;
  const W = 1920, H = 1080, scale = s.width / W;
  const ink = "#101013", paper = "#F4F0E7", hot = "#FF6337";
  const words = s.wordMotion;
  const groups = []; let group = [];
  for (const word of words) {
    group.push(word);
    if (/[.!?:]$/.test(word.word) || group.length === 5) { groups.push(group); group = []; }
  }
  if (group.length) groups.push(group);
  const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
  const ease = x => 1-Math.pow(1-clamp(x),3);
  const smooth = x => {x=clamp(x);return x*x*(3-2*x);};
  const out = words.at(-1).end + .12;
  const font = (size,weight=900) => `${weight} ${size}px Arial`;
  function text(t,x,y,size,color=paper,align="left",weight=900) {c.font=font(size,weight);c.fillStyle=color;c.textAlign=align;c.textBaseline="alphabetic";c.fillText(t,x,y);}
  function line(x,y,x2,y2,color,width=3) {c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();}
  function ring(x,y,r,color,width=20) {c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();}
  function disc(x,y,r,color) {c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
  function box(x,y,w,h,color) {c.fillStyle=color;c.fillRect(x,y,w,h);}
  function plus(x,y,r,color) {line(x-r,y,x+r,y,color,10);line(x,y-r,x,y+r,color,10);}
  function wrap(items,size,maxWidth) {
    c.font=font(size);const lines=[];let row=[];let width=0;
    for(const item of items){const w=c.measureText(item.word.toUpperCase()).width;
      if(row.length && width+w>maxWidth){lines.push({items:row,width:width-26});row=[];width=0;}
      row.push({...item,w});width+=w+26;
    }
    if(row.length)lines.push({items:row,width:width-26});return lines;
  }
  window.__setFrame = frame => {
    const t=frame/s.fps;c.setTransform(scale,0,0,scale,0,0);c.globalAlpha=1;
    let index=0;for(let i=0;i<groups.length;i++)if(t>=groups[i][0].start)index=i;
    const items=groups[index];const groupStart=items[0].start;const local=Math.max(0,t-groupStart);
    const textAll=items.map(w=>w.word).join(" ").toLowerCase();
    const theme=Math.floor(index/3)%3;
    const bg=theme===0?ink:theme===1?paper:hot;
    const fg=theme===0?paper:ink;const accent=theme===2?paper:hot;
    box(0,0,W,H,bg);
    const intro=ease(t/.55);
    const progress=clamp(t/Math.max(1,out));
    const phase=index%7;
    // Recurring marks change function with the phrase: aperture, response,
    // rhythm, target, stacking and final convergence.
    c.save();
    if(phase===0){
      c.translate(1500,495);c.rotate(t*.24);ring(0,0,245,accent,64);box(-290,-36,580,72,bg);box(-36,-290,72,580,bg);
    }else if(phase===1){
      for(let i=0;i<5;i++){const u=ease((local-i*.065)/.6);box(1330+i*78,750-u*(230+i*48),52,u*(230+i*48),accent);}
    }else if(phase===2){
      for(let i=0;i<3;i++){const y=510+Math.sin(t*2.5+i)*72;ring(1370+i*140,y,90,accent,14);}
    }else if(phase===3){
      c.translate(1510,500);c.rotate(-.5+ease(local/.8)*.8);box(-185,-185,370,370,accent);box(-113,-113,226,226,bg);plus(0,0,42,fg);
    }else if(phase===4){
      for(let i=0;i<16;i++){const h=36+Math.abs(Math.sin(i*.73+t*5))*185;box(1270+i*29,530-h/2,12,h,i%4===0?fg:accent);}
    }else if(phase===5){
      for(let i=0;i<4;i++){const u=ease((local-i*.08)/.6);c.globalAlpha=.25+i*.2;box(1300+i*45,370+i*65,330*u,50,accent);}c.globalAlpha=1;
    }else{
      disc(1510,510,150+35*Math.sin(t*2),accent);ring(1510,510,230,fg,3);line(1230,510,1790,510,fg,3);line(1510,230,1510,790,fg,3);
    }
    c.restore();
    // Exact word entries are driven by measured audio timestamps.
    const longest=Math.max(...items.map(w=>w.word.length));
    const size=longest>12?108:longest>9?124:142;
    const rows=wrap(items,size,1080);const lineHeight=size*1.13;
    const y0=H/2-(rows.length-1)*lineHeight/2+size*.30;
    const centered=/chama|explica|fica|hyperframes/i.test(textAll) && items.length<=2;
    if(centered){box(0,210,W,650,bg);}
    rows.forEach((row,j)=>{
      let x=centered?(W-row.width)/2:130;
      row.items.forEach((word,k)=>{
        const dt=t-word.start, u=ease(dt/.20);
        if(dt>=0){
          c.save();c.beginPath();c.rect(x-8,y0+j*lineHeight-size-24,word.w+22,size+55);c.clip();
          c.globalAlpha=u;
          if(/peso|ritmo|intenção|movimento|hyperframes|whisper|voz|trilha/i.test(word.word)){
            box(x-10,y0+j*lineHeight-size*.83+45*(1-u),word.w+20,size*1.04,accent);
            text(word.word.toUpperCase(),x,y0+j*lineHeight+45*(1-u),size,theme===2?ink:paper);
          } else text(word.word.toUpperCase(),x,y0+j*lineHeight+45*(1-u),size,fg);
          c.restore();
        }
        x+=word.w+26;
      });
    });
    // Compact editorial frame, with no technical implementation labels.
    text("GERADOR DE VÍDEOS",130,100,27,fg,"left",700);
    text("NOVAS POSSIBILIDADES",1790,100,22,fg,"right",700);
    line(130,131,1790,131,fg,2);
    text(index<3?"DA IDEIA AO MOVIMENTO":"HYPERFRAMES",130,977,24,fg,"left",700);
    box(130,1012,1660,4,theme===0?"#35353A":"#AEAAA3");box(130,1012,1660*progress,4,accent);
    // Live phonetic pulse stays subordinate to the headline.
    const active=words.find(w=>t>=w.start&&t<=w.end);
    for(let i=0;i<9;i++){const h=active?10+Math.abs(Math.sin(t*20+i*.9))*25:5;box(1600+i*22,969-h/2,8,h,fg);}
    // Opening aperture grows into the first thought, never a static thumbnail.
    if(t<groups[0][0].start){box(0,0,W,H,ink);ring(W/2,H/2,40+170*intro,hot,18);text("E SE A SUA IDEIA",W/2,450,65,paper,"center");text("GANHASSE MOVIMENTO?",W/2,560,75,paper,"center");}
    if(t>=out){
      const q=t-out, u=ease(q/.8);box(0,0,W,H,ink);
      for(let i=0;i<4;i++){const a=i*Math.PI/2+q*.1;const radius=520*(1-u)+210;disc(960+Math.cos(a)*radius,435+Math.sin(a)*radius,23+22*(1-u),hot);}
      c.save();c.translate(960,440);c.rotate((1-u)*-.12);c.scale(.85+.15*u,.85+.15*u);
      text("GERADOR",0,-16,155,paper,"center");text("DE VÍDEOS",0,145,155,paper,"center");c.restore();
      box(560,668,800*ease((q-.35)/.8),9,hot);
      text("DÊ MOVIMENTO À SUA PRÓXIMA IDEIA.",960,780,44,paper,"center",700);
      text("AGORA COM HYPERFRAMES",960,892,25,hot,"center",700);
    }
  };
}

export function kineticLaunchDocument(scene) {
  const wordMotion = validateKineticWords(scene.wordMotion, scene.durationSeconds);
  const data = JSON.stringify({ ...scene, wordMotion }).replaceAll("<", "\\u003c");
  return `<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101013}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script>(${paintKineticLaunch.toString()})(${data});</script>`;
}
