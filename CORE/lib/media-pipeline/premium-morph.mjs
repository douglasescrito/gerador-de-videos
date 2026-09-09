import {readFile} from 'node:fs/promises';
import path from 'node:path';
import opentype from 'opentype.js';
import {validateKineticWords} from './kinetic-launch.mjs';
import {cubicBezierAt,validateIntegratedScript} from './integrated-launch.mjs';

export const PREMIUM_STYLES=Object.freeze({
  materia:{name:'Matéria',font:'georgiai.ttf',background:'#EEE9DE',foreground:'#381C2A',accent:'#BC4A37',case:'title',mode:'liquid'},
  impacto:{name:'Impacto',font:'impact.ttf',background:'#EFEFDF',foreground:'#131411',accent:'#F35426',case:'upper',mode:'compression'},
  traco:{name:'Traço',font:'georgia.ttf',background:'#112B29',foreground:'#E7E6C9',accent:'#C9EAAC',case:'title',mode:'line'},
  fita:{name:'Fita',font:'arialbi.ttf',background:'#DFFCBB',foreground:'#123AC4',accent:'#172945',case:'upper',mode:'ribbon'},
  prisma:{name:'Prisma',font:'arialbd.ttf',background:'#11131D',foreground:'#E9EAF3',accent:'#8B9AFF',case:'title',mode:'optical'},
});

export function premiumBindingFiles(style) {
  const selected=PREMIUM_STYLES[style];
  if(!selected)throw new Error('premiumStyle desconhecido.');
  return [path.join(process.env.WINDIR??'C:/Windows','Fonts',selected.font)];
}

export function validatePremiumKeyframes(value,words) {
  if(!Array.isArray(value)||value.length<5||value.length>40)throw new Error('Premium exige 5 a 40 keyframes semânticos.');
  let previous=-1;
  return value.map((k,i)=>{
    const allowed=['word','text','duration','curve','x','y','scale','rotation','stretch','bend'];
    if(!k||Object.keys(k).some(key=>!allowed.includes(key)))throw new Error('Keyframe contém campo desconhecido.');
    if(!Number.isInteger(k.word)||k.word<=previous||!words[k.word])throw new Error('Âncora de keyframe inválida.');
    previous=k.word;
    if(typeof k.text!=='string'||!k.text.trim()||k.text.length>32||/[\u0000-\u001f<>]/u.test(k.text))throw new Error('Texto do keyframe inválido.');
    if(!Number.isFinite(k.duration)||k.duration<.18||k.duration>1.8)throw new Error('Duração do morph inválida.');
    if(!Array.isArray(k.curve)||k.curve.length!==4||k.curve.some(v=>typeof v!=='number'||!Number.isFinite(v))||k.curve[0]<0||k.curve[0]>1||k.curve[2]<0||k.curve[2]>1||k.curve[1]<-.5||k.curve[1]>1.5||k.curve[3]<-.5||k.curve[3]>1.5)throw new Error('Curva de keyframe inválida.');
    const limits={x:[-160,160],y:[-170,170],scale:[.65,1.25],rotation:[-.5,.5],stretch:[-.5,.5],bend:[-1,1]};
    for(const [name,[min,max]]of Object.entries(limits))if(!Number.isFinite(k[name])||k[name]<min||k[name]>max)throw new Error(`Keyframe ${i}: ${name} fora dos limites.`);
    return {...k,text:k.text.trim(),curve:[...k.curve],time:words[k.word].start};
  });
}

function flatten(commands) {
  const contours=[];let current=[],point=[0,0];
  const add=(x,y)=>{point=[x,y];current.push(point);};
  for(const q of commands){
    if(q.type==='M'){if(current.length>2)contours.push(current);current=[];add(q.x,q.y);}
    else if(q.type==='L')add(q.x,q.y);
    else if(q.type==='Q'){const p=point;for(let j=1;j<=10;j++){const u=j/10,v=1-u;add(v*v*p[0]+2*v*u*q.x1+u*u*q.x,v*v*p[1]+2*v*u*q.y1+u*u*q.y);}}
    else if(q.type==='C'){const p=point;for(let j=1;j<=14;j++){const u=j/14,v=1-u;add(v*v*v*p[0]+3*v*v*u*q.x1+3*v*u*u*q.x2+u*u*u*q.x,v*v*v*p[1]+3*v*v*u*q.y1+3*v*u*u*q.y2+u*u*u*q.y);}}
    else if(q.type==='Z'){if(current.length>2)contours.push(current);current=[];}
  }
  if(current.length>2)contours.push(current);
  return contours;
}

export function resampleContour(points,count=96) {
  if(!Array.isArray(points)||points.length<2)throw new Error('Contorno inválido.');
  const lengths=[0];for(let i=1;i<=points.length;i++){const a=points[i-1],b=points[i%points.length];lengths.push(lengths.at(-1)+Math.hypot(a[0]-b[0],a[1]-b[1]));}
  const total=lengths.at(-1);if(total<.0001)return Array.from({length:count},()=>[...points[0]]);
  let seg=0;return Array.from({length:count},(_,i)=>{const d=total*i/count;while(seg<points.length-1&&lengths[seg+1]<d)seg++;const a=points[seg],b=points[(seg+1)%points.length],p=(d-lengths[seg])/(lengths[seg+1]-lengths[seg]||1);return[a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p];});
}

function textGeometry(font,text,maxWidth=1380,maxHeight=280) {
  const outlines=font.getPath(text,0,0,250,{kerning:true});
  const bounds=outlines.getBoundingBox();const width=bounds.x2-bounds.x1,height=bounds.y2-bounds.y1;
  const scale=Math.min(maxWidth/Math.max(1,width),maxHeight/Math.max(1,height));
  const center=[(bounds.x1+bounds.x2)/2,(bounds.y1+bounds.y2)/2];
  const contours=flatten(outlines.commands).map(points=>resampleContour(points.map(([x,y])=>[(x-center[0])*scale,(y-center[1])*scale])));
  // Keep glyph order and contour winding. Missing contours collapse into the
  // nearest surviving contour, giving real geometry morphs without crossfade.
  return {contours,width:width*scale,height:height*scale};
}

export function blendContours(a,b,p) {
  const count=Math.max(a.length,b.length);return Array.from({length:count},(_,i)=>{
    const aa=a[i],bb=b[i],reference=aa??bb;
    const center=reference.reduce((s,q)=>[s[0]+q[0]/reference.length,s[1]+q[1]/reference.length],[0,0]);
    return reference.map((_,j)=>{const av=aa?.[j]??center,bv=bb?.[j]??center;return[av[0]+(bv[0]-av[0])*p,av[1]+(bv[1]-av[1])*p];});
  });
}

function paintPremium(s,data,bezier,blend) {
  const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');canvas.width=s.width;canvas.height=s.height;
  const W=1920,H=1080,style=data.style,keys=data.keys,words=s.wordMotion;
  const clamp=x=>Math.max(0,Math.min(1,x)),lerp=(a,b,p)=>a+(b-a)*p;
  const ease=(p,curve=[.77,0,.18,1])=>bezier(clamp(p),curve);
  const phraseGroups=[];let phrase=[];for(const w of words){phrase.push(w);if(/[.!?:]$/.test(w.word)||phrase.length===8){phraseGroups.push(phrase);phrase=[];}}if(phrase.length)phraseGroups.push(phrase);
  function type(text,x,y,size,color,weight=400,align='center'){c.font=`${weight} ${size}px Arial`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.fillText(text,x,y);}
  function line(x,y,xx,yy,color,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  function label(t){if(t>words.at(-1).end+.05)return;const group=phraseGroups.findLast(g=>t>=g[0].start&&t<g.at(-1).end+.4);if(!group)return;c.font='400 28px Arial';const ww=group.map(w=>c.measureText(w.word).width+10);let x=(W-ww.reduce((a,b)=>a+b,0))/2;group.forEach((w,i)=>{if(t>=w.start)type(w.word,x,979,28,t<=w.end?style.accent:style.foreground,400,'left');x+=ww[i];});}
  function warp(x,y,t,pulse,k,mode){
    if(mode==='liquid'){const wave=Math.sin(x*.005-t*.7)*Math.sin(y*.014+t*.6);return [x+wave*30*pulse,y*(1-.91*pulse)+Math.sin(x*.004+t*.6)*55*pulse+k.bend*x*x/5500];}
    if(mode==='compression'){return[x*(1+k.stretch*pulse),y*(1-.52*pulse)+Math.sin(x*.003)*18*pulse];}
    if(mode==='line'){return[x,y*(1-.96*pulse)+Math.sin(x*.003+t*.35)*80*pulse+k.bend*x*.13];}
    if(mode==='ribbon'){const wave=Math.sin(x*.004+t*.45);return[x+y*.30*Math.sin(t*.45)*pulse,y*(1-.87*pulse)*Math.cos(x*.0015*k.bend)+wave*(38+90*pulse)*k.bend];}
    return[x+Math.sin(y*.011+t*.3)*30*pulse,y*(1-.8*pulse)+Math.sin(x*.004-t*.5)*25*pulse];
  }
  function pathOf(contours,t,pulse,k,mode,dx=0,dy=0,progress=1){c.beginPath();for(const points of contours){const n=Math.ceil(points.length*progress);for(let j=0;j<n;j++){const [x,y]=warp(points[j][0],points[j][1],t,pulse,k,mode);if(j)c.lineTo(x+dx,y+dy);else c.moveTo(x+dx,y+dy);}if(progress>=.999)c.closePath();}}
  function fillWord(contours,t,pulse,k,color,dx=0,dy=0){pathOf(contours,t,pulse,k,style.mode,dx,dy);c.fillStyle=color;c.fill('nonzero');}
  function strokeWord(contours,t,pulse,k,color,width=2,progress=1){pathOf(contours,t,pulse,k,style.mode,0,0,progress);c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.stroke();}
  function background(){c.fillStyle=style.background;c.fillRect(0,0,W,H);}
  function signature(t){const start=words[112].start,u=ease((t-start)/1.1),resolve=ease((t-57.2)/1.4);c.save();c.translate(960,450);const scale=.76+.24*u;c.scale(scale,scale);
    if(style.mode==='line'){pathOf(data.signature[0].contours,t,1-resolve,{bend:0},'line',0,-100);c.strokeStyle=style.foreground;c.lineWidth=2.4;c.stroke();pathOf(data.signature[1].contours,t,1-resolve,{bend:0},'line',0,120);c.stroke();}
    else{fillWord(data.signature[0].contours,t,1-resolve,{bend:0,stretch:0},style.foreground,0,-100);fillWord(data.signature[1].contours,t,1-resolve,{bend:0,stretch:0},style.foreground,0,120);}c.restore();
    const bar=ease((t-55.4)/1.1);line(480,732,480+960*bar,732,style.accent,style.mode==='compression'?14:2);
    if(t>=words[115].start){c.save();c.globalAlpha=clamp((t-words[115].start)/.4);type('DÊ MOVIMENTO À SUA PRÓXIMA IDEIA.',960,812,42,style.foreground,400);c.restore();}
    if(t>=58.2)type('HYPERFRAMES  /  GERADOR DE VÍDEOS',960,913,22,style.accent,400);
  }
  function scene(t){background();let ix=0;for(let i=1;i<keys.length;i++)if(t>=keys[i].time-keys[i].duration)ix=i;
    const k=keys[ix],prev=keys[Math.max(0,ix-1)],q=clamp((t-(k.time-k.duration))/k.duration),e=ease(q,k.curve);
    const morph=clamp(e),pulse=Math.sin(Math.PI*q);const shapes=ix===0?k.geometry.contours:blend(prev.geometry.contours,k.geometry.contours,morph);
    const kx=lerp(prev.x,k.x,e),ky=lerp(prev.y,k.y,e),scale=lerp(prev.scale,k.scale,e),rotation=lerp(prev.rotation,k.rotation,e);
    const anchor={...k,bend:lerp(prev.bend,k.bend,e),stretch:lerp(prev.stretch,k.stretch,e)};
    // The same contours and parent transform survive every semantic handoff.
    // Styles differ in spatial grammar, drawing method and tempo, not only color.
    c.save();c.translate(960+kx,490+ky);c.rotate(rotation);c.scale(scale,scale);
    if(style.mode==='liquid'){
      // Serif lettering behaves as viscous material, with a fine contour edge
      // that is displaced only during a morph, then settles into solid ink.
      c.save();c.globalAlpha=.12*pulse;strokeWord(shapes,t,pulse,anchor,style.accent,20);c.restore();fillWord(shapes,t,pulse,anchor,style.foreground);
      if(pulse>.1){c.beginPath();for(let x=-650;x<=650;x+=10){const y=Math.sin(x*.004+t*.6)*55*pulse;if(x===-650)c.moveTo(x,y);else c.lineTo(x,y);}c.strokeStyle=style.foreground;c.lineWidth=16*pulse;c.lineCap='round';c.stroke();}
    }else if(style.mode==='compression'){
      const stretch=1+.38*pulse;c.scale(stretch,1/stretch);c.transform(1,0,-.18*pulse,1,0,0);
      if(pulse>.02){c.save();c.globalAlpha=.25;fillWord(shapes,t,pulse,anchor,style.accent,-55*pulse,0);c.restore();}
      fillWord(shapes,t,pulse,anchor,style.foreground);
      const width=lerp(prev.geometry.width,k.geometry.width,morph),baseline=lerp(prev.geometry.height,k.geometry.height,morph)/2+38;line(-width/2,baseline,width/2,baseline,style.accent,14);
    }else if(style.mode==='line'){
      const reveal=ix===0?ease(t/1.5):1;strokeWord(shapes,t,pulse,anchor,style.foreground,3.4,reveal);
      // One moving lead point follows the lower edge and pulls the next word.
      const pos=Math.sin((t-k.time)*.35)*k.geometry.width*.4;
      c.beginPath();c.moveTo(-800,230);c.bezierCurveTo(-250,230,pos-160,230,pos,170);c.strokeStyle=style.accent;c.lineWidth=2;c.stroke();
      c.beginPath();c.arc(pos,170,5,0,Math.PI*2);c.fillStyle=style.accent;c.fill();
    }else if(style.mode==='ribbon'){
      // A single typographic sheet bends across the stage. Its underside is
      // exposed during the turn, then recombines with the front surface.
      c.save();c.globalAlpha=.20;fillWord(shapes,t,pulse,anchor,style.accent,0,20+25*pulse);c.restore();
      const g=c.createLinearGradient(-700,-200,700,250);g.addColorStop(0,'#123AC4');g.addColorStop(.48,'#315FFF');g.addColorStop(1,'#172945');fillWord(shapes,t,pulse,anchor,g);
    }else{
      const separation=5+30*pulse;c.save();c.globalCompositeOperation='screen';c.globalAlpha=.65;
      fillWord(shapes,t,pulse,anchor,'#4554EA',-separation,5*pulse);fillWord(shapes,t,pulse,anchor,'#70BBAE',separation,-5*pulse);c.restore();
      const g=c.createLinearGradient(-500,-160,500,160);g.addColorStop(0,'#8E93B0');g.addColorStop(.45,'#FFFFFF');g.addColorStop(.56,'#A7AEC5');g.addColorStop(1,'#F7F1EB');fillWord(shapes,t,pulse,anchor,g);
      c.save();c.globalAlpha=.15;strokeWord(shapes,t,pulse,anchor,'#FAFAFF',1);c.restore();
    }
    c.restore();
    // No permanent presentation chrome. The type is the protagonist.
    if(t>=words[112].start){const p=ease((t-words[112].start)/1.1);c.save();c.beginPath();c.rect(0,540-540*p,1920,1080*p);c.clip();background();signature(t);c.restore();}
    label(t);
  }
  window.__setFrame=frame=>{c.setTransform(s.width/W,0,0,s.height/H,0,0);c.globalAlpha=1;scene(frame/s.fps);};
}

export async function premiumMorphDocument(scene) {
  const wordMotion=validateKineticWords(scene.wordMotion,scene.durationSeconds);validateIntegratedScript(wordMotion);
  const style=PREMIUM_STYLES[scene.premiumStyle];if(!style)throw new Error('premiumStyle desconhecido.');
  const keys=validatePremiumKeyframes(scene.motionKeyframes,wordMotion);
  const buffer=await readFile(premiumBindingFiles(scene.premiumStyle)[0]);
  const font=opentype.parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
  const normalize=text=>style.case==='upper'?text.toUpperCase():text;
  const dimensions={liquid:[1500,420],compression:[1480,510],line:[1440,370],ribbon:[1600,430],optical:[1510,540]}[style.mode];
  const data={style,keys:keys.map(k=>({...k,geometry:textGeometry(font,normalize(k.text),...dimensions)})),signature:['GERADOR','DE VÍDEOS'].map(text=>{const g=textGeometry(font,text);return {...g,contours:g.contours.map(points=>points.map(([x,y])=>[x*.8,y*.8]))};})};
  const safe=value=>JSON.stringify(value).replaceAll('<','\\u003c');
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${style.background}}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script>(${paintPremium.toString()})(${safe({...scene,wordMotion})},${safe(data)},${cubicBezierAt.toString()},${blendContours.toString()});</script>`;
}
