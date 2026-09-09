import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright-core';
import {createHtmlMotionScene} from '../lib/media-pipeline/html-motion-pilot.mjs';
import {organicLaunchDocument,validateOrganicControls} from '../lib/media-pipeline/organic-launch.mjs';

const required={1:'ideia',10:'movimento',25:'hyperframes',34:'ritmo',35:'peso',37:'intenção',39:'texto',43:'formas',52:'clara',59:'whisper',73:'trilha',85:'som',87:'imagem',95:'studio',111:'história',112:'gerador',120:'ideia'};
const words=Array.from({length:121},(_,i)=>({word:required[i]??'palavra',start:i*.47,end:i*.47+.3}));
const makeScene=extra=>createHtmlMotionScene({width:640,height:360,fps:30,durationSeconds:62,motionStyle:'organic-launch@1',wordMotion:words,...extra});

test('direção orgânica rejeita controles incompatíveis e garante arremate',()=>{
  for(const value of [{script:'x'},{arrivalBezier:[.2,1.4,.3,1]},{materialSpeed:Infinity},[],null])assert.throws(()=>validateOrganicControls(value));
  assert.throws(()=>makeScene({durationSeconds:58}),/arremate/);
  assert.throws(()=>makeScene({premiumStyle:'fita'}),/premium/);
  assert.throws(()=>makeScene({wordMotion:[{word:'outra',start:0,end:1}]}),/âncora/);
  const controls={arrivalBezier:[.2,1,.3,1]};const scene=makeScene({motionControls:controls});controls.arrivalBezier[0]=9;
  assert.equal(scene.motionControls.arrivalBezier[0],.2);
});

test('timeline mantém imagem determinística em busca direta, retrocesso e outra página', {timeout:60000},async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const source=await organicLaunchDocument(makeScene());
    let requests=0;const errors=[];
    const open=async()=>{
      const page=await browser.newPage({viewport:{width:640,height:360}});
      await page.route('**/*',route=>{requests++;return route.abort();});
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{window.__studioTimeMs=0;Date.now=()=>window.__studioTimeMs;Math.random=()=>.5;});
      await page.goto('about:blank');await page.setContent(source);
      await page.evaluate(async()=>{await Promise.all([document.fonts.load('400 140px Arial'),document.fonts.load('700 140px Arial')]);await document.fonts.ready;});
      return page;
    };
    const page=await open();
    const snap=async(p,t)=>p.evaluate(t=>{window.__setFrame(Math.round(t*30));return document.querySelector('canvas').toDataURL();},t);
    const direct=await snap(page,20.3);
    for(const t of [0,3.8,8.5,19.4,33,61,20.3])await snap(page,t);
    assert.equal(await snap(page,20.3),direct);
    const second=await open();assert.equal(await snap(second,20.3),direct);
    assert.notEqual(await snap(page,20.4),direct);
    const diagnostics=await page.evaluate(()=>window.__organicDiagnostics);
    assert.equal(diagnostics.objectIds.length,5);
    const pairs=[['movimento','chama.'],['chama.','explica.'],['explica.','fica.'],['ritmo','peso'],['peso','intenção'],['texto','formas respondem'],['se abre','formas respondem'],['motion','voz'],['voz','trilha'],['trilha','uma mesma'],['Da primeira batida','ao último detalhe.'],['ao último detalhe.','som'],['sua ideia.','Studio']];
    for(const [oldText,newText]of pairs){
      const previous=diagnostics.labelAnchors.find(l=>l.text===oldText),next=diagnostics.labelAnchors.find(l=>l.text===newText);
      assert.ok(previous.end<=next.start+1e-8,`overlapping words in shared focus: ${oldText} / ${newText}`);
    }
    assert.equal(await page.evaluate(()=>Object.values(window.__timelines)[0].paused()),true);
    for(const track of diagnostics.tracks){
      const siblings=diagnostics.tracks.filter(other=>other!==track&&other.property===track.property);
      assert.ok(siblings.every(other=>other.end<=track.start+1e-8||other.start>=track.end-1e-8),`writers overlap: ${track.property}`);
    }
    assert.deepEqual(errors,[]);assert.equal(requests,0);
  }finally{await browser.close();}
});
