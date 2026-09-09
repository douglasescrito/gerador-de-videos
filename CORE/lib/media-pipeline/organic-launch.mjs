import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {validateKineticWords} from './kinetic-launch.mjs';
import {cubicBezierAt,validateIntegratedScript} from './integrated-launch.mjs';

const root=path.resolve(import.meta.dirname,'../..');
export function organicBindingFiles(){
  return [path.join(root,'node_modules/gsap/dist/gsap.min.js'),
    path.join(process.env.WINDIR??'C:/Windows','Fonts','arialbd.ttf'),
    path.join(process.env.WINDIR??'C:/Windows','Fonts','arial.ttf')];
}

export function validateOrganicControls(value={}){
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Controles orgânicos exigem objeto.');
  const allowed=['travelBezier','arrivalBezier','materialSpeed'];
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Controle orgânico desconhecido.');
  const result={travelBezier:[.76,0,.24,1],arrivalBezier:[.16,1,.3,1],materialSpeed:.22,...value};
  for(const name of ['travelBezier','arrivalBezier']){
    const v=result[name];
    if(!Array.isArray(v)||v.length!==4||v.some(x=>!Number.isFinite(x)||x<0||x>1))throw new Error('Curva orgânica exige quatro valores entre 0 e 1, sem overshoot.');
    result[name]=[...v];
  }
  if(!Number.isFinite(result.materialSpeed)||result.materialSpeed<.05||result.materialSpeed>.5)throw new Error('materialSpeed deve ficar entre 0.05 e 0.5.');
  return result;
}

// One paused GSAP composition. Canvas is the painter, not a second clock.
// Every persistent object is evaluated from the same explicit frame timestamp.
function paintOrganic(s,bezier){
  const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
  canvas.width=s.width;canvas.height=s.height;
  const W=1920,H=1080,words=s.wordMotion,controls=s.motionControls;
  const clamp=v=>Math.max(0,Math.min(1,v));
  const mix=(a,b,p)=>a+(b-a)*p;
  const travel=p=>bezier(p,controls.travelBezier),arrive=p=>bezier(p,controls.arrivalBezier);
  const tl=gsap.timeline({paused:true,defaults:{lazy:false,overwrite:false}});
  const state={x:1188,y:525,w:3,h:160,r:1,rotation:0,opacity:1,
    material:0,handles:0,spread:0,gallery:0,orbit:0,shade:0,
    cameraScale:1,cameraX:0,cameraY:0,rail:0,railY:847,railWidth:1220,
    inset:0,glow:.15,final:0,tint:0};
  const last={...state},tracks=[];
  function key(name,to,start,duration,ease=arrive){
    const from=last[name];
    tl.fromTo(state,{[name]:from},{[name]:to,duration,ease,immediateRender:false,lazy:false},start);
    tracks.push({property:name,from,to,start,end:start+duration,ease:ease===travel?'travelBezier':ease===arrive?'arrivalBezier':ease});
    last[name]=to;
  }
  function pose(values,start,duration,ease=arrive){for(const [name,value]of Object.entries(values))key(name,value,start,duration,ease);}

  // The caret opens the surface; its right edge remains the attachment point.
  pose({x:960,w:2100,h:1220,r:20,material:1,glow:.7},3.48,.74,travel);
  pose({w:1020,h:610,y:520,handles:1},8.03,1.65,travel);
  pose({cameraScale:1.08,cameraX:-12},10.35,1.5,arrive);
  pose({cameraScale:1,cameraX:0},12.75,1.1,travel);
  pose({x:1320,w:700,h:580},13.6,1.18,travel);
  key('x',1210,15.12,.78,travel);
  pose({x:1320,y:610,h:548},16.05,.67,arrive);
  pose({y:525,h:560},16.86,.62,arrive);
  // The existing panel becomes a lens; letters keep their topology.
  pose({x:960,y:540,w:310,h:310,r:155,handles:0},18.05,1.55,travel);
  pose({w:1250,h:390,r:32,tint:1},19.94,.94,travel);
  pose({w:650,h:550,r:20,spread:1,gallery:1},21.35,1.5,travel);
  pose({w:1150,h:570,spread:0,gallery:0},23.62,1.36,travel);
  // The bottom boundary becomes the measured speech rail.
  pose({w:1080,h:510,y:405,handles:1},26.03,1.25,travel);
  key('rail',1,26.4,1.45,arrive);
  pose({x:1290,w:760,tint:1.7},28.1,1.0,travel);
  key('inset',1,31.05,.83,arrive);
  // Sound and image meet inside the same hero, then reveal the finished view.
  pose({x:960,y:525,w:1320,h:710,handles:0},36.8,1.5,travel);
  pose({railY:880,railWidth:1320,rail:0},36.8,1.5,travel);
  key('inset',0,37.4,.8,arrive);
  key('tint',2.5,38.4,2.0,'none');
  pose({x:1320,y:510,w:600,h:630,r:26},42.1,1.45,travel);
  pose({x:960,y:550,w:700,h:520,spread:1,gallery:1},47.2,1.7,travel);
  pose({cameraScale:.82,cameraY:0,orbit:1},48.95,1.75,travel);
  // Selection carries the camera into the final surface, not into a blank slide.
  pose({cameraScale:1,x:960,y:540,w:2100,h:1220,r:0,spread:0,gallery:0,final:1,shade:.57},53.0,1.0,travel);
  key('glow',.38,55.2,2.0,arrive);
  tl.to({tail:0},{tail:1,duration:s.durationSeconds,ease:'none',lazy:false},0);

  const labels=[];
  const beforeWord=(index,duration=.42)=>Math.max(0,words[index].start-duration);
  function label(text,word,end,options={}){
    const anchor=words[word].start;
    const duration=options.duration??.42;
    const start=Math.max(0,anchor-duration);
    const a={enter:0,leave:0};
    tl.fromTo(a,{enter:0},{enter:1,duration:anchor-start||.01,ease:arrive,immediateRender:false,lazy:false},start);
    if(end<s.durationSeconds)tl.fromTo(a,{leave:0},{leave:1,duration:.3,ease:travel,immediateRender:false,lazy:false},end-.3);
    labels.push({text,anchor,start,end,a,x:960,y:540,size:110,weight:700,color:'#F4F4F1',align:'center',layer:'front',...options});
  }
  label('ideia',1,3.76,{x:920,y:535,size:190,weight:400});
  label('movimento',10,beforeWord(12),{y:535,size:178,weight:400});
  label('chama.',12,beforeWord(13),{y:535,size:192,weight:400});
  label('explica.',13,beforeWord(14),{y:535,size:192,weight:400});
  label('fica.',14,8.2,{y:535,size:192,weight:400});
  label('Gerador de Vídeos',16,11.5,{y:510,size:84,weight:400});
  label('HyperFrames',25,13.44,{y:510,size:132,weight:400});
  label('cada palavra',28,15.0,{x:250,y:514,size:95,align:'left',weight:400});
  label('ritmo',34,beforeWord(35),{x:250,y:510,size:144,align:'left',weight:400});
  label('peso',35,beforeWord(37),{x:250,y:546,size:144,align:'left',weight:400});
  label('intenção',37,18.48,{x:250,y:515,size:135,align:'left',weight:400});
  label('texto',39,beforeWord(43),{x:595,y:550,size:94,weight:400});
  label('se abre',41,beforeWord(43),{x:1330,y:550,size:94,weight:400});
  label('formas respondem',43,21.86,{y:540,size:100,weight:400});
  label('a composição muda',46,23.65,{y:172,size:74,weight:400});
  label('mensagem',50,26.0,{y:480,size:100,weight:400});
  label('clara.',52,26.0,{y:598,size:130});
  label('A voz dá o caminho.',54,28.22,{y:410,size:91,weight:400});
  label('Whisper',59,31.4,{x:250,y:352,size:124,align:'left',weight:400});
  label('palavra por palavra',65,31.4,{x:250,y:456,size:48,align:'left',weight:400,color:'#D7ECCF'});
  label('motion',67,beforeWord(70),{x:250,y:365,size:118,align:'left',weight:400});
  label('voz',70,beforeWord(73),{x:250,y:445,size:110,align:'left',weight:400});
  label('trilha',73,beforeWord(77),{x:250,y:412,size:120,align:'left',weight:400});
  label('uma mesma',77,37.12,{x:250,y:352,size:73,align:'left',weight:400});
  label('experiência.',78,37.12,{x:250,y:443,size:82,align:'left',weight:400});
  label('Da primeira batida',81,beforeWord(84),{y:510,size:90,weight:400});
  label('ao último detalhe.',84,beforeWord(85),{y:510,size:90,weight:400});
  label('som',85,42.1,{x:692,y:532,size:134,weight:400});
  label('imagem',87,42.1,{x:1154,y:532,size:134,weight:400});
  label('sua ideia.',93,beforeWord(95),{x:280,y:500,size:142,align:'left',weight:400});
  label('Studio',95,47.36,{x:266,y:420,size:167,align:'left',weight:400});
  label('intenção em',97,47.36,{x:274,y:595,size:69,align:'left',weight:400,color:'#C8D3CE'});
  label('movimento.',99,47.36,{x:274,y:674,size:83,align:'left',weight:400});
  label('Mais possibilidades.',103,51.0,{y:162,size:72,weight:400});
  label('sua história.',111,53.58,{y:535,size:127,weight:400});
  label('Gerador',112,62,{x:242,y:418,size:184,weight:400,align:'left',layer:'final'});
  label('de Vídeos.',114,62,{x:242,y:600,size:184,weight:400,align:'left',layer:'final'});
  label('Dê movimento à sua próxima ideia.',115,62,{x:253,y:803,size:54,weight:400,align:'left',layer:'final',duration:.28,wordRange:[115,120]});

  const surfaces=Array.from({length:3},()=>{
    const element=document.createElement('canvas');element.width=288;element.height=180;
    const c=element.getContext('2d'),data=c.createImageData(288,180);
    return {element,c,data};
  });
  // Smooth, warped color strata. No random field, bitmap reference or network asset.
  const palettes=[[[9,24,29],[45,61,112],[170,145,228],[224,242,209],[64,159,135]],
    [[27,16,39],[99,43,115],[237,128,158],[252,224,187],[147,100,183]],
    [[10,21,56],[42,77,190],[98,189,216],[213,244,210],[84,121,218]]];
  function material(index,t){
    const target=surfaces[index],data=target.data.data;
    const phase=t*controls.materialSpeed+index*1.7;
    const pal=palettes[index];
    for(let y=0;y<180;y++){
      const v=y/180;
      for(let x=0;x<288;x++){
        const u=x/288;
        const wx=u+.22*Math.sin(v*5.2+phase*.7)+.10*Math.sin(v*11.1-phase*.4);
        const wy=v+.22*Math.sin(u*4.1-phase*.55);
        const f=.5+.5*Math.sin(wx*4.7+wy*3.6+Math.sin(wx*4.8-wy*2.3+phase)*1.35+phase*.5);
        const band=f*3.999,ix=Math.floor(band),p=band-ix,a=pal[ix],b=pal[(ix+1)%5];
        const light=.81+.19*Math.sin(wy*2+wx*2.4+phase*.15);
        const sheen=Math.pow(Math.max(0,Math.sin(wx*6.3+wy*4.8+phase*.6)),16)*19;
        const o=(y*288+x)*4;
        data[o]=mix(a[0],b[0],p)*light+sheen;
        data[o+1]=mix(a[1],b[1],p)*light+sheen;
        data[o+2]=mix(a[2],b[2],p)*light+sheen;
        data[o+3]=255;
      }
    }
    target.c.putImageData(target.data,0,0);
    return target.element;
  }
  function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,Math.max(0,Math.min(r,w/2,h/2)));}
  function text(value,x,y,size,color='#F4F4F1',weight=400,align='center'){
    ctx.font=`${weight} ${size}px Arial`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(value,x,y);
  }
  function line(x,y,xx,yy,color,width=1){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(xx,yy);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function field(t){
    ctx.fillStyle='#080D11';ctx.fillRect(0,0,W,H);
    // One environmental wash; the moving material remains the main source of color.
    let g=ctx.createRadialGradient(1600,1050,0,1600,1050,1100);
    g.addColorStop(0,`rgba(76,61,117,${.25+state.glow*.18})`);g.addColorStop(1,'rgba(14,23,28,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    g=ctx.createRadialGradient(220,1100,0,220,1100,1000);g.addColorStop(0,'#16322B');g.addColorStop(1,'rgba(8,13,17,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  }
  function panel(x,y,w,h,r,image,rotation=0,opacity=1,selected=0){
    if(opacity<.001||w<.5||h<.5)return;
    ctx.save();ctx.globalAlpha*=opacity;ctx.translate(x,y);ctx.rotate(rotation);
    ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=52;ctx.shadowOffsetY=25;
    rr(-w/2,-h/2,w,h,r);ctx.fillStyle='#0B1519';ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.save();rr(-w/2,-h/2,w,h,r);ctx.clip();
    if(state.material>.001){ctx.globalAlpha*=state.material;ctx.drawImage(image,-w/2,-h/2,w,h);}
    ctx.restore();
    const edge=ctx.createLinearGradient(-w/2,-h/2,w/2,h/2);edge.addColorStop(0,'rgba(238,251,239,.55)');edge.addColorStop(.45,'rgba(218,235,255,.08)');edge.addColorStop(1,'rgba(215,221,255,.33)');
    rr(-w/2,-h/2,w,h,r);ctx.strokeStyle=edge;ctx.lineWidth=1.3;ctx.stroke();
    if(selected>.01){ctx.globalAlpha*=selected;ctx.strokeStyle='#D7EAE1';ctx.lineWidth=1;rr(-w/2-10,-h/2-10,w+20,h+20,2);ctx.stroke();for(const a of [-1,1])for(const b of [-1,1]){ctx.fillStyle='#F3F8EF';ctx.fillRect(a*(w/2+10)-4,b*(h/2+10)-4,8,8);}}
    ctx.restore();
  }
  function paintLabels(layer,t){
    for(const l of labels){
      if(l.layer!==layer||t<l.start||t>=l.end)continue;
      const opacity=l.a.enter*(1-l.a.leave);
      if(opacity<.001)continue;
      ctx.save();ctx.globalAlpha*=opacity;
      const h=l.size*1.35;
      ctx.beginPath();ctx.rect(0,l.y-h*.52,W,h);ctx.clip();
      // Crisp glyphs under a moving line mask, not interpolated outlines.
      ctx.shadowColor='rgba(0,0,0,.17)';ctx.shadowBlur=10;
      const content=l.wordRange?words.slice(l.wordRange[0],l.wordRange[1]+1).filter(w=>t>=w.start).map(w=>w.word).join(' '):l.text;
      text(content,l.x,l.y+(1-l.a.enter)*l.size*.62-l.a.leave*24,l.size,l.color,l.weight,l.align);
      ctx.restore();
    }
  }
  function rail(t){
    if(state.rail<.001)return;
    ctx.save();ctx.globalAlpha*=state.rail;
    const x=960-state.railWidth/2,y=state.railY;
    const start=26.41,end=36.54;
    const sx=time=>x+clamp((time-start)/(end-start))*state.railWidth;
    line(x,y,x+state.railWidth,y,'#516460',1.5);
    for(const w of words.filter(w=>w.start>=start&&w.start<end)){
      const left=sx(w.start),width=Math.max(3,sx(w.end)-left);
      const active=t>=w.start&&t<=w.end;
      rr(left,y-13,width,26,4);ctx.fillStyle=active?'#D0F3C6':t>w.end?'#527167':'#293B39';ctx.fill();
    }
    const p=sx(t);
    line(p,y-37,p,y+35,'#ECF9E3',2);
    text('NARRAÇÃO',x,y+62,21,'#9EB6AD',400,'left');
    text('TEMPO DA PALAVRA',x+state.railWidth,y+62,21,'#9EB6AD',400,'right');
    const current=words.find(w=>t>=w.start&&t<w.end);
    if(current&&t>=28.24&&t<end){
      const clean=current.word.replace(/[.,:!?]/g,'');
      const size=Math.min(90,580/Math.max(1,clean.length)*1.9);
      text(clean,state.x,state.y,size,'#F5F9EE');
    }
    ctx.restore();
  }
  function draw(t){
    ctx.setTransform(s.width/W,0,0,s.height/H,0,0);ctx.globalAlpha=1;
    ctx.shadowBlur=0;ctx.globalCompositeOperation='source-over';
    field(t);
    const primary=material(0,t+state.tint*4);
    const others=state.gallery>.001?[material(1,t),material(2,t)]:[];
    ctx.save();ctx.translate(960+state.cameraX,540+state.cameraY);ctx.scale(state.cameraScale,state.cameraScale);ctx.translate(-960,-540);
    if(state.gallery>.001){
      const positions=[[-760,-95,-.07],[760,70,.055],[-1360,180,-.11],[1380,-170,.10]];
      for(let i=0;i<positions.length;i++){
        const [dx,dy,angle]=positions[i],p=state.spread;
        const orbital=state.orbit;
        const x=960+dx*p,y=540+(dy+(i%2?1:-1)*orbital*160)*p;
        const cw=(i<2?550:470),ch=(i<2?460:580);
        panel(x,y,cw,ch,18,others[i%2],angle*p,state.gallery*(i<2?.94:.7));
      }
    }
    panel(state.x,state.y,state.w,state.h,state.r,primary,state.rotation,state.opacity,state.handles);
    if(state.material<.01){ctx.fillStyle='#E4F3DA';ctx.fillRect(1186,445,4,160);}
    if(state.final>.001){ctx.globalAlpha=state.shade;ctx.fillStyle='#06100D';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;}
    // Contrast veil belongs to the hero and changes only with its composition.
    if(state.material>.01&&state.final<.99&&state.w>600){
      ctx.save();ctx.translate(state.x,state.y);rr(-state.w/2,-state.h/2,state.w,state.h,state.r);ctx.clip();
      const g=ctx.createRadialGradient(0,0,20,0,0,state.w*.56);g.addColorStop(0,'rgba(2,10,14,.27)');g.addColorStop(1,'rgba(2,10,14,0)');ctx.fillStyle=g;ctx.fillRect(-state.w/2,-state.h/2,state.w,state.h);ctx.restore();
    }
    ctx.restore();
    rail(t);
    paintLabels('front',t);
    paintLabels('final',t);
    if(t>=55.2){ctx.globalAlpha=clamp((t-55.2)/.6);text('HYPERFRAMES / STUDIO',253,200,28,'#D2E5C8',400,'left');ctx.globalAlpha=1;}
    // A small period ends the signature; the material keeps its natural motion.
    if(t>=57.5){ctx.globalAlpha=clamp((t-57.5)/.7);line(255,895,465,895,'#D8F3C9',2);ctx.globalAlpha=1;}
  }
  window.__timelines=window.__timelines||{};window.__timelines[s.id]=tl;
  window.__organicDiagnostics={tracks,labelAnchors:labels.map(({text,anchor,start,end})=>({text,anchor,start,end})),objectIds:['hero-panel','variant-1','variant-2','variant-3','variant-4'],engine:'gsap@3.14.2',duration:s.durationSeconds};
  window.__setFrame=frame=>{
    const t=Math.min(s.durationSeconds,Math.max(0,frame/s.fps));
    window.__studioTimeMs=t*1000;
    tl.seek(t,true);gsap.ticker.sleep();draw(t);
  };
  gsap.ticker.sleep();
  window.__setFrame(0);
}

export async function organicLaunchDocument(scene){
  const wordMotion=validateKineticWords(scene.wordMotion,scene.durationSeconds);validateIntegratedScript(wordMotion);
  const motionControls=validateOrganicControls(scene.motionControls??{});
  if(scene.durationSeconds<wordMotion.at(-1).end+3)throw new Error('Motion orgânico exige arremate de pelo menos três segundos após a voz.');
  const [gsapFile,fontFile,regularFile]=organicBindingFiles();
  const [gsap,bold,regular]=await Promise.all([readFile(gsapFile,'utf8'),readFile(fontFile),readFile(regularFile)]);
  const safe=value=>JSON.stringify(value).replaceAll('<','\\u003c');
  return `<meta charset="utf-8"><style>@font-face{font-family:Arial;src:url(data:font/ttf;base64,${regular.toString('base64')});font-weight:400}@font-face{font-family:Arial;src:url(data:font/ttf;base64,${bold.toString('base64')});font-weight:700}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080D11}canvas{display:block;width:100%;height:100%}</style><div data-composition-id="${scene.id.replaceAll(/[^a-zA-Z0-9_-]/g,'_')}" data-duration="${scene.durationSeconds}"><canvas></canvas></div><script>${gsap.replaceAll('</script','<\\/script')}</script><script>(${paintOrganic.toString()})(${safe({...scene,wordMotion,motionControls})},${cubicBezierAt.toString()});</script>`;
}
