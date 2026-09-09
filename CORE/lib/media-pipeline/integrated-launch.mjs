import { validateKineticWords } from './kinetic-launch.mjs';

// A repository-owned choreography within the existing HTML adapter. The input
// controls curves and measured word anchors, never code, URLs or a second clock.
export function cubicBezierAt(x, points) {
  x = Math.max(0, Math.min(1, x));
  const [x1,y1,x2,y2] = points;
  const component = (u,a,b) => 3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u;
  let lo=0,hi=1;
  for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(component(mid,x1,x2)<x)lo=mid;else hi=mid;}
  return x===0?0:x===1?1:component((lo+hi)/2,y1,y2);
}

export function validateMotionControls(value = {}) {
  const defaults = { travelBezier:[.76,0,.24,1], settleBezier:[.16,1.18,.32,1], overlapSeconds:.85, depth:1, trailSamples:3 };
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!(k in defaults))) throw new Error('motionControls contém campo desconhecido.');
  const v={...defaults,...value};
  for(const key of ['travelBezier','settleBezier']){
    const a=v[key];
    if(!Array.isArray(a)||a.length!==4||a.some(x=>typeof x!=='number'||!Number.isFinite(x))||a[0]<0||a[0]>1||a[2]<0||a[2]>1||a[1]<-.5||a[1]>1.5||a[3]<-.5||a[3]>1.5)throw new Error('Curva Bézier inválida.');
  }
  if(!Number.isFinite(v.overlapSeconds)||v.overlapSeconds<.4||v.overlapSeconds>1.2||!Number.isFinite(v.depth)||v.depth<0||v.depth>1.5||!Number.isInteger(v.trailSamples)||v.trailSamples<1||v.trailSamples>5)throw new Error('Controles de motion fora dos limites.');
  return v;
}

export function validateIntegratedScript(words) {
  // This named launch recipe has semantic cues; reject a different script
  // instead of silently displaying an unrelated advertisement.
  const required={1:'ideia',10:'movimento',25:'hyperframes',34:'ritmo',35:'peso',37:'intenção',39:'texto',43:'formas',52:'clara',59:'whisper',73:'trilha',85:'som',87:'imagem',95:'studio',111:'história',112:'gerador',120:'ideia'};
  for(const [i,label]of Object.entries(required))if(words[i]?.word.toLowerCase().replace(/[.,!?:]/g,'')!==label)throw new Error(`integrated-launch@1 exige o roteiro de lançamento; âncora ${i} divergente.`);
}

function paintIntegrated(s, bezier) {
  const canvas=document.querySelector('canvas'), c=canvas.getContext('2d');
  canvas.width=s.width;canvas.height=s.height;
  const P=s.motionControls, words=s.wordMotion, W=1920,H=1080;
  const ink='#10111A',white='#F5F3EF',orange='#FF693B',purple='#9C83FF',lime='#DEFF9A';
  const clamp=x=>Math.max(0,Math.min(1,x));
  const mix=(a,b,p)=>a+(b-a)*p;
  const travel=x=>bezier(clamp(x),P.travelBezier);
  const settle=x=>bezier(clamp(x),P.settleBezier);
  const at=i=>words[i].start;
  const cue=(t,i,d=.65)=>settle((t-at(i))/d);
  const phase=[0,at(15),at(26),at(38),at(53),at(79),at(100),at(112),s.durationSeconds];
  function rect(x,y,w,h,fill,r=0,stroke=null){c.beginPath();c.roundRect(x,y,Math.max(0,w),Math.max(0,h),r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}}
  function disc(x,y,r,fill){c.beginPath();c.arc(x,y,Math.max(.01,r),0,Math.PI*2);c.fillStyle=fill;c.fill();}
  function line(x,y,xx,yy,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.stroke();}
  function type(text,x,y,size,color=white,weight=700,align='center'){c.font=`${weight} ${size}px Arial`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(text,x,y);}
  function grad(x,y,r,color){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}
  function star(x,y,r,t,color=orange){c.save();c.translate(x,y);c.rotate(t);c.beginPath();for(let i=0;i<24;i++){const a=i*Math.PI/12,rr=i%2?r*.48:r;c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}c.closePath();c.fillStyle=color;c.fill();c.restore();}
  function ring(x,y,r,color,width=5,rot=0){c.save();c.translate(x,y);c.rotate(rot);c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.ellipse(0,0,r,r*.68,0,0,Math.PI*2);c.stroke();c.restore();}
  function space(light,t){rect(-250,-250,2420,1580,light?white:ink);grad(1580,250,850,light?'#E4D9FF':'#282044');grad(260,980,680,light?'#FFD6C3':'#42231E');c.save();c.globalAlpha=.10;c.strokeStyle=light?'#686272':'#AAA0BE';c.lineWidth=1;for(let x=0;x<W;x+=120){c.beginPath();c.moveTo(x,0);c.lineTo(x,H);c.stroke();}for(let y=0;y<H;y+=120){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();}c.restore();}
  function glass(x,y,w,h,t,light=false){c.save();c.shadowColor='#00000045';c.shadowBlur=35*P.depth;c.shadowOffsetY=22*P.depth;rect(x,y,w,h,light?'#FFFFFF':'#1C1D2B',30,light?'#C7C4CE':'#4C485F');c.restore();line(x+30,y+2,x+w-30,y+2,light?'#FFFFFF':'#BCABC8',2);}
  function letters(text,x,y,size,time,trigger,color=white,spread=0){c.font=`700 ${size}px Arial`;const widths=[...text].map(ch=>c.measureText(ch).width);let xx=x-(widths.reduce((a,b)=>a+b,0)+(text.length-1)*spread)/2;[...text].forEach((ch,i)=>{const u=settle((time-trigger-i*.027)/.65);if(time>=trigger+i*.027){c.save();c.translate(xx+widths[i]/2,y+95*(1-u));c.rotate((1-u)*-.2);c.scale(1,.6+.4*u);c.globalAlpha=clamp(u*2);type(ch,0,0,size,color);c.restore();}xx+=widths[i]+spread;});}
  function wave(t,x,y,w,amp,color,width=8,offset=0){c.beginPath();for(let i=0;i<=140;i++){const q=i/140;const envelope=Math.sin(q*Math.PI);const yy=y+Math.sin(q*19-t*4+offset)*Math.sin(q*5+t*.7)*amp*envelope;if(i===0)c.moveTo(x,yy);else c.lineTo(x+q*w,yy);}c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();}
  function caption(t){let ix=0;for(let i=0;i<words.length;i++)if(t>=at(i))ix=i;if(t>words.at(-1).end+.2)return;let a=ix;while(a>0&&ix-a<5&&!/[.!?:]$/.test(words[a-1].word))a--;let b=a;while(b<words.length-1&&b-a<6&&!/[.!?:]$/.test(words[b].word))b++;c.font='500 31px Arial';const list=words.slice(a,b+1), widths=list.map(w=>c.measureText(w.word).width+12),sum=widths.reduce((x,y)=>x+y,0);rect(960-sum/2-28,954,sum+56,63,'#10111AEB',24);let x=960-sum/2;list.forEach((w,k)=>{if(t>=w.start){type(w.word,x,986,31,t<=w.end?lime:white,500,'left');}x+=widths[k];});}

  function idea(t){space(true,t);const launch=travel((t-3.6)/1.2);c.save();c.translate(960,500);c.rotate(-.05*launch);c.scale(1+launch*.13,1+launch*.13);
    for(let j=8;j>0;j--){c.globalAlpha=.035;type('IDEIA',j*6,j*6,310,ink);}c.globalAlpha=1;
    letters('IDEIA',0,0,310,t,at(1),ink,6);c.restore();
    const x=mix(500,1460,launch),y=520-180*Math.sin(launch*Math.PI);
    for(let j=P.trailSamples-1;j>=0;j--){const p=travel((t-3.6-j*.026)/1.2);c.globalAlpha=j? .12:1;star(mix(500,1460,p),520-180*Math.sin(p*Math.PI),50+35*Math.sin(p*Math.PI),p*5,orange);}c.globalAlpha=1;
    if(t>=at(10)){const u=cue(t,10);rect(540,690,840*clamp(u),9,orange);letters('MOVIMENTO',960,765,76,t,at(10),ink,1);}
    for(const [i,xx,yy]of [[12,470,245],[13,1420,310],[14,1370,735]]){const u=cue(t,i);if(t>=at(i)){c.save();c.translate(xx,yy+60*(1-u));c.rotate((1-u)*.25);rect(-145,-45,290,90,ink,45);type(words[i].word.replace('.','').toUpperCase(),0,0,39,white);c.restore();}}
    // The same seed becomes the reveal aperture at the next boundary.
  }
  function engine(t){space(false,t);const q=t-phase[1],u=travel(q/1.25);grad(960,540,700,'#703B5644');
    c.save();c.translate(960,500);c.rotate((1-u)*-.6);c.transform(1,.06*(1-u),-.3*(1-u),1,0,0);
    for(let j=7;j>=0;j--){const z=1-j*.085,lag=settle((q-j*.05)/1.4);c.save();c.rotate((1-lag)*j*.06);c.scale(z,z);rect(-610,-290,1220,580,j===0?'#171722':null,55,j%2?purple:orange);c.restore();}c.restore();
    if(t<at(23)){letters('GERADOR',960,435,110,t,at(16),white);letters('DE VÍDEOS',960,555,85,t,at(18),purple);}
    else if(t<at(25)){letters('NOVO MOTOR',960,465,105,t,at(23),white);type('GERADOR DE VÍDEOS',960,610,33,purple,500);}
    else{letters('HyperFrames',960,465,155,t,at(25),white);const v=cue(t,25);rect(760,590,400*clamp(v),6,orange);}
    star(960+Math.cos(q*1.3)*660,500+Math.sin(q*1.3)*300,35,q,orange);
  }
  function weight(t){space(true,t);const q=t-phase[2];c.save();c.translate(970,490);c.rotate(-.09+.035*Math.sin(q*.6));
    for(let j=6;j>=0;j--){const u=settle((q-j*.08)/1.1);c.save();c.translate(j*18*P.depth,j*18*P.depth);c.rotate((1-u)*(.6-j*.06));rect(-570,-285,1140,570,j===0?ink:[purple,orange,lime][j%3],32);c.restore();}
    if(t<at(34)){letters('CADA PALAVRA',0,-30,85,t,at(28),white);letters('ENTRA EM CENA',0,90,68,t,at(30),purple);}
    for(const [i,y,color]of [[34,-145,purple],[35,0,orange],[37,145,lime]])if(t>=at(i)){const u=cue(t,i,.5);c.save();c.translate(0,y+120*(1-u));c.scale(1+.08*(1-u),1-.22*(1-u));type(words[i].word.replace(/[,.]/g,'').toUpperCase(),0,0,110,color);c.restore();}
    c.restore();
  }
  function transform(t){space(false,t);const q=t-phase[3];
    if(t<at(43)){
      const p=cue(t,41,1);for(let side=-1;side<=1;side+=2){c.save();c.translate(side*270*p,0);c.beginPath();c.rect(side<0?0:960,0,960,H);c.clip();letters('TEXTO',960,475,290,t,at(39),white);c.restore();}star(960,485,Math.max(1,165*p),p*2,orange);
    }else if(t<at(50)){
      const p=cue(t,43,1);const fold=cue(t,47,1.2);c.save();c.translate(960,485);c.rotate(-.2+fold*.4);c.scale(.7+.3*p,.7+.3*p);
      for(let i=0;i<9;i++){const a=i*Math.PI*2/9+t*.22,r=250*(1-fold*.55);c.save();c.translate(Math.cos(a)*r,Math.sin(a)*r);c.rotate(a+fold*3);rect(-65,-65,130,130,[orange,purple,lime][i%3],mix(65,8,fold));c.restore();}star(0,0,110+fold*80,-t*.3,white);c.restore();letters('FORMAS RESPONDEM',960,840,65,t,at(44),white);
    }else{
      const u=cue(t,50,1);for(let i=0;i<12;i++){const a=i*Math.PI/6,r=600*(1-u)+330;line(960+Math.cos(a)*r,470+Math.sin(a)*r,960+Math.cos(a)*(r+110),470+Math.sin(a)*(r+110),i%2?purple:orange,10);}letters('CLARA',960,470,250,t,at(52),white);type('A MENSAGEM',960,265,42,purple,500);
    }
  }
  function sync(t){space(false,t);const q=t-phase[4],u=travel(q/1.2);c.save();c.translate(0,40*(1-u));
    if(t<at(66)){
      for(let j=3;j>=0;j--)wave(t-j*.09,120,560,1680,135+j*15,[orange,purple,lime,'#645184'][j],j?3:9,j*.5);
      const marker=clamp((t-at(54))/(at(65)-at(54)));const xx=160+1600*marker;line(xx,330,xx,750,white,2);disc(xx,560,20,orange);
      letters(t<at(59)?'A VOZ GUIA.':'Whisper',960,260,t<at(59)?95:135,t,t<at(59)?at(54):at(59),white);
      const range=words.slice(54,66);range.forEach((w,j)=>{if(t>=w.start){const x=160+j*140;const p=settle((t-w.start)/.45);rect(x-44,760+45*(1-p),88,8,j%2?purple:orange,4);}});
    }else{
      const join=travel((t-at(73))/2);for(let j=0;j<3;j++){const y=mix(300+j*210,535+(j-1)*23,join);wave(t,180,y,1560,50*(1-join),[purple,orange,lime][j],14);if(join<.7)type(['MOTION','VOZ','TRILHA'][j],260,y-65,48,[purple,orange,lime][j]);}
      if(t>=at(78)){const p=cue(t,78);glass(355,410,1210,230,t);letters('UMA EXPERIÊNCIA',960,525,94,t,at(78),white);star(1570,525,45,p,orange);}
    }c.restore();
  }
  function build(t){space(true,t);const q=t-phase[5],merge=travel((t-at(90))/1.6);
    c.save();c.translate(960,490);c.rotate(-.12*(1-merge));
    for(let j=0;j<3;j++){const px=mix((j-1)*480,0,merge),py=mix(0,(j-1)*22,merge);c.save();c.translate(px,py);c.rotate((j-1)*.09*(1-merge));glass(-210,-230,420,460,t,true);c.beginPath();c.roundRect(-195,-215,390,290,20);c.clip();rect(-195,-215,390,290,[ink,orange,purple][j]);if(j===0)wave(t,-180,-70,360,50,lime,8);if(j===1){for(let k=0;k<5;k++)ring(0,-65,50+k*26,white,6,t*.25+k*.1);}if(j===2)star(0,-70,100,t*.5,lime);c.restore();
      c.save();c.translate(px,py);if(merge<.8){type(['SOM','IMAGEM','IDEIA'][j],0,145,57,ink);line(-135,200,135,200,j===1?orange:purple,5);}c.restore();}
    c.restore();
    if(t>=at(95)){const p=cue(t,95);c.save();c.translate(960,490);c.scale(.8+.2*p,.8+.2*p);glass(-530,-260,1060,520,t);type('Studio',0,-90,130,white);letters('INTENÇÃO EM MOVIMENTO',0,90,57,t,at(97),orange);c.restore();}
    else if(t>=at(89))letters('JUNTOS.',960,820,95,t,at(89),ink);
  }
  function possibilities(t){space(false,t);const q=t-phase[6],pull=travel(q/1.3),focus=travel((t-at(108))/1.25);c.save();c.translate(960,470);c.scale(mix(1.6,.85,pull),mix(1.6,.85,pull));c.rotate(.07*(1-focus));
    for(let row=-1;row<=1;row++)for(let col=-2;col<=2;col++){const xx=col*360,yy=row*285;const k=(row+1)*5+col+2;c.save();c.translate(xx*(1+focus),yy*(1+focus));c.rotate(Math.sin(q*.5+k)*.035);c.globalAlpha=1-focus*.88;rect(-160,-122,320,244,[orange,purple,lime,white][k%4],18);c.beginPath();c.roundRect(-160,-122,320,244,18);c.clip();if(k%3===0){for(let i=0;i<4;i++)ring(0,0,35+i*23,ink,6,q*.4+i*.3);}else if(k%3===1)star(0,0,100,q*.25,ink);else{for(let i=0;i<6;i++)rect(-170+i*70,-190,35,400,ink,17);}
      c.restore();}c.restore();
    if(t>=at(110)){const p=cue(t,110);glass(365,330,1190,330,t);letters('SUA HISTÓRIA',960,480,135,t,at(110),white);}
  }
  function finale(t){space(false,t);const q=t-phase[7],p=travel(q/1.2),end=travel((t-57.5)/1.2);grad(960,510,760,'#5F32603A');
    c.save();c.globalAlpha=.48;for(let i=0;i<4;i++){const r=mix(680-i*80,70-i*9,end),a=i*Math.PI/2+q*.15*(1-end);ring(960,mix(470,210,end),r,i%2?purple:orange,2+i*2,a*.16);}c.restore();
    letters('GERADOR',960,380,150,t,at(112),white);letters('DE VÍDEOS',960,540,150,t,at(114),white);
    if(t>=at(115)){const u=cue(t,115);rect(525,695,870*clamp(u),6,orange);type('DÊ MOVIMENTO À SUA PRÓXIMA IDEIA.',960,780,43,white,500);}
    const radius=650*(1-end),x=960+Math.cos(q)*radius,y=235+Math.sin(q)*radius*.18;star(x,y,42,q*(1-end),orange);
    if(t>=58.6)type('AGORA COM HYPERFRAMES',960,890,28,purple,500);
  }
  const scenes=[idea,engine,weight,transform,sync,build,possibilities,finale];
  function draw(t){let index=0;for(let i=1;i<8;i++)if(t>=phase[i])index=i;
    const dt=t-phase[index],span=P.overlapSeconds;
    if(index>0&&dt<span){
      // An expanding shared aperture reveals the next space. The previous
      // scene remains alive underneath; there is no slide translation/reset.
      scenes[index-1](t);const p=travel(dt/span),r=mix(0,1500,p);
      c.save();c.beginPath();
      if([2,5].includes(index)) {c.save();c.translate(960,500);c.rotate(-.18*(1-p));c.roundRect(-1100*p,-650*p,2200*p,1300*p,40*p);c.restore();}
      else if([3,6].includes(index)){const edge=-500+3000*p;c.moveTo(-500,-500);c.lineTo(edge,-500);c.lineTo(edge-350,1600);c.lineTo(-500,1600);c.closePath();}
      else c.arc(960,500,Math.max(.01,r),0,Math.PI*2);
      c.clip();c.save();c.translate(960,500);const z=1.15-.15*p;c.scale(z,z);c.translate(-960,-500);scenes[index](t);c.restore();c.restore();
      if(p>.005&&p<.995&&![2,3,5,6].includes(index)){c.strokeStyle=orange;c.lineWidth=30*Math.sin(p*Math.PI);c.beginPath();c.arc(960,500,r,0,Math.PI*2);c.stroke();}
    }else scenes[index](t);
    caption(t);
  }
  window.__setFrame=frame=>{c.setTransform(s.width/W,0,0,s.height/H,0,0);c.globalAlpha=1;draw(frame/s.fps);};
}

export function integratedLaunchDocument(scene) {
  const wordMotion=validateKineticWords(scene.wordMotion,scene.durationSeconds);
  validateIntegratedScript(wordMotion);
  const data=JSON.stringify({...scene,wordMotion,motionControls:validateMotionControls(scene.motionControls)}).replaceAll('<','\\u003c');
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#10111a}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script>(${paintIntegrated.toString()})(${data},${cubicBezierAt.toString()});</script>`;
}
