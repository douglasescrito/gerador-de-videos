import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adpAnchors, adpExplainerDocument } from '../lib/media-pipeline/adp-explainer.mjs';
import { createHtmlMotionScene } from '../lib/media-pipeline/html-motion-pilot.mjs';
const words='Olá Primeiro confira Agora combine Item pronto Mas atenção Para acompanhar'.split(' ').map((word,i)=>({word,start:i,end:i+.4}));
test('ADP anchors match measured speech and reject unrelated scripts',()=>{
  assert.deepEqual(adpAnchors(words),[0,1,3,5,7,9]);
  assert.throws(()=>adpAnchors(words.filter(w=>w.word!=='combine')),/ancora ausente/);
});
test('ADP uses existing scene contract and blocks executable text injection',()=>{
  const scene=createHtmlMotionScene({id:'adp-test',title:'ADP',subtitle:'Fluxo',cta:'Confira',width:1280,height:720,durationSeconds:12,wordMotion:words,motionStyle:'adp-explainer@1'});
  assert.equal(scene.motionStyle,'adp-explainer@1');
  assert.equal(scene.network,'blocked');
  const html=adpExplainerDocument({...scene,title:'</script><script>evil()'});
  assert.ok(!html.includes('</script><script>evil()'));
  assert.ok(html.includes('window.__setFrame'));
  assert.ok(!html.includes('GERADOR DE VÍDEOS'));
});
