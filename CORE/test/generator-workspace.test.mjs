import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { personalizeRecipe, documentChanges } from '../app/editor/gerador-personalization.js';
import { validateAssemblyEdits, assembleFilm } from '../lib/media-pipeline/film-assembly.mjs';
import { runFfmpeg, probeMedia } from '../lib/media-pipeline/media-tools.mjs';
import { validarDocumentoReceita } from '../lib/media-pipeline/recipe-validation.mjs';
import { createGeneratorService } from '../app/editor/gerador-service.mjs';
import { createRecipeLibrary } from '../app/editor/receitas-library.mjs';
const preset=JSON.parse(await fs.readFile(new URL('../recipes/studio-produto.receita.json',import.meta.url)));
test('personalização preserva identidade, origem e cenas, com revisão exata e duração aceita pelo compilador',()=>{
 const before=structuredClone(preset),result=personalizeRecipe(preset,{name:'Nova versão',theme:'Cerâmica azul',message:'Cuidado',audience:'Artesãos',duration:32,cta:'Conheça',presenter:'apresentador.png',presenterScenes:[0]});
 assert.deepEqual(preset,before);assert.equal(result.id,preset.id);assert.equal(result.collection,preset.collection);assert.equal(result.scenes.length,3);assert.equal(result.scenes.reduce((n,s)=>n+s.duration,0),32);
 assert.equal(result.scenes[0].generationTask,'reference_to_video');assert.equal(result.scenes[1].generationTask,'text_to_video');assert.ok(!result.scenes[1].references?.length);validarDocumentoReceita(result);
 assert.ok(documentChanges(preset,result).some(c=>c.path.join('.')==='scenes.2.onScreenText'));
 assert.throws(()=>personalizeRecipe({...preset,audio:{narration:{text:'fala'}}},{duration:30}),/tempos vinculados/);
 assert.throws(()=>personalizeRecipe(preset,{duration:30.5}),/inteiros/);
});
test('cortes rejeitam origem fora do tempo, ganho perigoso, FPS inválido e texto de controle',()=>{
 const probes=[{duration:5}],ok={sourceIn:1,sourceOut:3,gainDb:-6};assert.equal(validateAssemblyEdits([ok],probes)[0].frames,48);
 for(const edit of [{...ok,sourceIn:-1},{...ok,sourceOut:9},{...ok,gainDb:13},{...ok,text:'a\0b'},{...ok,textPosition:'arbitrary-filter'}])assert.throws(()=>validateAssemblyEdits([edit],probes));
 assert.throws(()=>validateAssemblyEdits([ok],probes,NaN));
});
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'generator-workspace-test-'));t.after(async()=>{const real=await fs.realpath(root);assert.ok(path.basename(real).startsWith('generator-workspace-test-'));await fs.rm(real,{recursive:true,force:true});});return root;}
test('exportação real mistura fonte com áudio e fonte muda, aplica texto e publica novo MP4 com recibo',async t=>{
 const root=await temporary(t),a=path.join(root,'a.mp4'),b=path.join(root,'b.mp4'),out=path.join(root,'edit.mp4');
 await runFfmpeg(['-f','lavfi','-i','color=c=red:s=320x180:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-threads','2','-c:a','aac','-shortest',a]);
 await runFfmpeg(['-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=2','-c:v','libx264','-threads','2',b]);
 const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex'),before=await hash(a);
 const result=await assembleFilm({sceneFiles:[b,a],outputFile:out,edits:[{sourceIn:.5,sourceOut:1.5,text:'Teste: 100% seguro',textPosition:'top'},{sourceIn:0,sourceOut:1,gainDb:-6}],aspect:'9:16',fps:24,preserveAudio:true});
 const probe=await probeMedia(out);assert.equal(probe.video.width,720);assert.equal(probe.video.height,1280);assert.ok(probe.audio);assert.ok(Math.abs(probe.duration-2)<.1);assert.equal(await hash(a),before);assert.equal(result.receipt.parameters.edits[1].gainDb,-6);
 await assert.rejects(assembleFilm({sceneFiles:[a],outputFile:out,edits:[{sourceIn:0,sourceOut:1}],preserveAudio:true}));assert.equal(await hash(a),before);
});
test('exportação HTTP resolve IDs, recusa versões antigas e nunca executa provider',async t=>{
 const root=await temporary(t);await fs.mkdir(path.join(root,'recipes'));await fs.mkdir(path.join(root,'outputs'));await fs.writeFile(path.join(root,'recipes','sample.receita.json'),JSON.stringify(preset));const media=path.join(root,'outputs','source.mp4');await fs.writeFile(media,'source fixture');
 const source=await createRecipeLibrary({recipesDir:path.join(root,'recipes')}).read('sample.receita.json'),calls=[];
 const reconstruction={reconstruct:async()=>({data:{title:'Teste'}}),getAsset:async(_file,id)=>{assert.equal(id,'master');return{file:media,stamp:'original',info:{kind:'video',duration:5}};}};
 const service=createGeneratorService({coreDir:root,reconstruction,runner:async args=>{calls.push(args);return{file:args.at(-1),duration:2};}});
 const input={requestId:randomUUID(),file:source.file,recipeHash:source.hash,clips:[{assetId:'master',stamp:'original',sourceIn:1,sourceOut:3}],aspect:'16:9',fps:24};
 await assert.rejects(service.exportEdit({...input,recipeHash:'changed'}),/receita mudou/);await assert.rejects(service.exportEdit({...input,clips:[{...input.clips[0],stamp:'changed'}]}),/material mudou/);assert.equal(calls.length,0);
 await service.exportEdit(input);await service.idle();await service.exportEdit(input);assert.equal(calls.length,1);assert.equal(calls[0][0],'join');
 await assert.rejects(service.exportEdit({...input,aspect:'9:16'}),/já usado/);
});
