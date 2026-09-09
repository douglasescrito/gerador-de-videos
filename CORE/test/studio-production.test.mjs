import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {productionStatus,productionIssue} from '../app/editor/studio-production-model.js';
import {businessIssues,editBusiness} from '../app/editor/gerador-guided-model.js';
test('progress counts confirmed scene and stage completions; only a physical final file reaches 100%',()=>{
 const job={status:'running',checklist:[{},{}],progress:{stages:[{name:'draft',status:'completed'},{name:'video',status:'running'},{name:'assembly',status:'pending'},{name:'qa',status:'pending'},{name:'music',status:'skipped'}],scenes:[{id:'one',status:'complete',available:true},{id:'two',status:'generating',available:false}]}};
 const s=productionStatus(job);assert.equal(s.percent,40);assert.equal(s.sceneTotal,2);assert.equal(s.scenesDone,1);assert.equal(s.units,5);
 const terminal={...job,status:'complete',progress:{stages:[{name:'qa',status:'completed'}]}};assert.equal(productionStatus(terminal).percent,99);assert.equal(productionStatus(terminal).ready,false);assert.equal(productionStatus({...terminal,mediaAvailable:true}).percent,100);
 assert.equal(productionStatus({status:'planning'}).percent,null);assert.equal(productionStatus({status:'ready'}).percent,0);
});
test('a failed preparation provides a human-readable cause and exact field without a misleading active state',()=>{
 const job={status:'attention',message:'Prompt, preset ou atributos musicais (--genre, --mood, --bpm) são obrigatórios.'};const s=productionStatus(job);assert.equal(s.busy,false);assert.equal(s.percent,0);assert.equal(s.issue.field,'musicIntent');assert.equal(s.groups[0].state,'attention');assert.equal(s.issue.step,2);
 assert.equal(productionIssue({message:'Espera excedeu a janela de observação; reconcilie a mesma tentativa.'}).kind,'unknown');
});
test('legacy music brief can be reused explicitly while keeping music settings and originals',async()=>{
 const base=JSON.parse(await fs.readFile(new URL('../recipes/studio-produto.receita.json',import.meta.url),'utf8'));
 base.audio={music:{provider:'flow-music',gain:'-5dB'}};base.trilha={intencao:'Instrumental leve, sem vozes.'};
 const before=JSON.stringify(base);assert.ok(businessIssues(base).some(i=>i.field==='musicIntent'));
 const updated=editBusiness(base,{music:true,musicIntent:base.trilha.intencao});assert.equal(updated.audio.musicIntent,base.trilha.intencao);assert.deepEqual(updated.audio.music,base.audio.music);assert.equal(businessIssues(updated).some(i=>i.field==='musicIntent'),false);assert.equal(JSON.stringify(base),before);
});
