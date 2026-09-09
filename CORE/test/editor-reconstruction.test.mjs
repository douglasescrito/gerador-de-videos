import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createEditorReconstruction, receiptCuts, readConcatList, resolveOutputFile, waveformPeaks, alignCutPackets } from '../app/editor/editor-reconstruction.mjs';

test('cortes usam a ordem e as durações físicas, preservando os pontos de entrada da origem',()=>{
  const receipt={schema:'gerador-de-videos/dual-voice-assembly-receipt@1',scenes:[{id:'01-fala',start:.48,duration:6.78},{id:'02-nyla',start:0,duration:7.62}],ending:{durationSeconds:6}};
  const original=JSON.stringify(receipt),cuts=receiptCuts(receipt,[6.791667,7.625,6]);
  assert.equal(cuts[0].sourceIn,.48);assert.equal(cuts[1].start,6.791667);assert.equal(cuts[1].receiptStart,6.78);assert.equal(cuts[2].ending,true);assert.equal(JSON.stringify(receipt),original);
  assert.throws(()=>receiptCuts(receipt,[0,7,6]));assert.throws(()=>receiptCuts(receipt,[7,6]));
});

test('lista de concatenação não executa comandos nem aceita diretivas de edição desconhecidas',()=>{
  assert.deepEqual(readConcatList("# concat\nfile 'C:/media/um.mp4'\nfile 'C:/media/dois.mp4'\n"),['C:/media/um.mp4','C:/media/dois.mp4']);
  assert.throws(()=>readConcatList("file 'um.mp4'\ninpoint 5"));assert.throws(()=>readConcatList('file http://example.com/file.mp4'));
});

test('onda vem de amostras reais: silêncio permanece silêncio; valores inválidos não contaminam a faixa',()=>{
  const b=Buffer.alloc(32);[0,0,.2,-.6,NaN,.3,Infinity,0].forEach((v,i)=>b.writeFloatLE(v,i*4));
  assert.deepEqual(waveformPeaks(b,4),[0,.6,.3,0]);assert(waveformPeaks(Buffer.alloc(100)).every(v=>v===0));
});

test('cortes seguem PTS do master, incluindo seu deslocamento, somente com todos os quadros correspondentes',()=>{
  const sources=[[{data_hash:'a'},{data_hash:'b'}],[{data_hash:'c'},{data_hash:'d'}]];
  const master=[{data_hash:'a',pts_time:'.02',flags:'K'},{data_hash:'b',pts_time:'.06'},{data_hash:'c',pts_time:'.10',flags:'K'},{data_hash:'d',pts_time:'.14'}];
  const cuts=alignCutPackets([{start:0,end:.08},{start:.08,end:.16}],master,sources,.18,25);
  assert.deepEqual(cuts.map(c=>c.start),[.02,.10]);assert.equal(cuts[0].end,.10);
  assert.throws(()=>alignCutPackets(cuts,master,[[{data_hash:'different'},{data_hash:'b'}],sources[1]],.18,25));
  assert.throws(()=>alignCutPackets(cuts,master,sources.slice(0,1),.18,25));
});

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'editor-reconstruction-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const write=async(rel,value)=>{const target=path.join(dir,rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,value);return target;};
  const root=path.join(dir,'outputs'),folder='demo',base='outputs/demo/';
  await write('recipes/demo.receita.json',JSON.stringify({schema:'gerador-de-videos/receita@1',id:'demo',label:'Demo',collection:folder,kind:'filme',aspect:'16:9',scenes:[{id:'01-fala',duration:10,prompt:'Cena visual.'}]}));
  const master=await write(base+'videos-unidos/final.mp4','master'),normal=await write(base+'montagem/01-fala.mp4','normal'),end=await write(base+'montagem/08-focus-fecho.mp4','end'),origin=await write(base+'videos-soltos/original.mp4','original');
  await write(base+'montagem/concat-final.txt',`file '${normal}'\nfile '${end}'\n`);
  const receipt={schema:'gerador-de-videos/dual-voice-assembly-receipt@1',collection:folder,finalFile:master,sha256:createHash('sha256').update('master').digest('hex'),durationSeconds:16,ending:{durationSeconds:6},scenes:[{id:'01-fala',source:origin,start:0,duration:10}]};
  const receiptPath=await write(base+'receitas/final.receipt.json',JSON.stringify(receipt));
  const probe=async file=>({duration:file===master?16:file===end?6:10,video:{width:1280,height:720,r_frame_rate:'24/1'},audio:{}});
  return {dir,root,master,receiptPath,receipt,service:createEditorReconstruction({coreDir:dir,probe,packets:async()=>[]}),write};
}

test('reconstrução confere master e trechos, não escreve nos originais e recusa material alterado',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.receiptPath,'utf8');
  const p=await f.service.reconstruct('demo.receita.json');assert.equal(p.data.mode,'reconstructed');assert.equal(p.data.duration,16);assert.equal(p.data.tracks.find(t=>t.id==='video').clips.length,2);
  assert.equal(await fs.readFile(f.receiptPath,'utf8'),before);
  await fs.appendFile(f.master,'changed');await assert.rejects(f.service.getAsset('demo.receita.json','master'),e=>e.status===409);
  const changed=await f.service.reconstruct('demo.receita.json');assert.equal(changed.data.mode,'planned');assert.equal(changed.data.assets.length,0);assert(changed.data.notes.some(n=>n.includes('master mudou')));
});

test('leitura de mídia fica dentro de outputs e receitas fora da biblioteca são recusadas',async t=>{
  const f=await fixture(t);await f.write('outside.mp4','outside');
  await assert.rejects(resolveOutputFile(f.root,'../outside.mp4'));await assert.rejects(resolveOutputFile(f.root,path.join(f.dir,'outside.mp4')));
  await assert.rejects(f.service.reconstruct('../outside.mp4'));await assert.rejects(f.service.getAsset('demo.receita.json','../../outside.mp4'));
});

test('recibo desconhecido não oculta vídeo físico, mas não comprova sua condição de master',async t=>{
  const f=await fixture(t);await fs.writeFile(f.receiptPath,JSON.stringify({...f.receipt,schema:'desconhecido@1'}));
  const p=await f.service.reconstruct('demo.receita.json');assert.equal(p.data.mode,'reconstructed');assert.equal(p.data.masterStatus,'candidate');assert.equal(p.data.exactCuts,false);assert(p.data.notes.some(n=>n.includes('não está comprovada')));
});
