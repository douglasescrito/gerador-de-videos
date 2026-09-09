import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createGeneratorService } from '../app/editor/gerador-service.mjs';
import { createRecipeLibrary } from '../app/editor/receitas-library.mjs';
import { generatorRoutes } from '../app/editor/gerador-routes.mjs';

async function fixture(t, runFailure = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-generator-test-'));
  t.after(async () => { const real = await fs.realpath(root); assert.ok(path.basename(real).startsWith('studio-generator-test-')); await fs.rm(real, { recursive:true, force:true }); });
  await fs.mkdir(path.join(root, 'recipes')); await fs.mkdir(path.join(root, 'outputs'));
  await fs.copyFile(new URL('../recipes/studio-produto.receita.json', import.meta.url), path.join(root,'recipes','sample.receita.json'));
  const library = createRecipeLibrary({recipesDir:path.join(root,'recipes')});const source = await library.read('sample.receita.json');const calls=[];
  const stateFile = path.join(root, 'outputs', 'state.json');
  const runner = async args => {
    calls.push(args);
    if (args[0] === 'text') return { text:'Texto proposto pelo dublê' };
    if (args[0] === 'dry-run') return { plan:{} };
    if (args[0] === 'plan') {await fs.writeFile(stateFile,JSON.stringify({status:'ready',stages:{}}));return {stateFile,plan:{executionPlan:{governance:{approval:{fingerprint:'approved-hash'}}}}};}
    if (runFailure) throw new Error('external_effect_unknown');
    return {status:'delivered',stages:{video:{status:'completed'}}};
  };
  const service = createGeneratorService({coreDir:root,runner});
  const input = { sourceFile:source.file,sourceHash:source.hash,document:source.document,name:'Produção de teste',requestId:randomUUID() };
  return {root,service,calls,input,source,library};
}
test('preparar preserva origem, usa motor canônico e não gera mídia',async t=>{
  const f=await fixture(t);await f.service.plan(f.input);await f.service.idle();
  const job=await f.service.read(f.input.requestId);assert.equal(job.status,'ready');assert.deepEqual(f.calls.map(a=>a[0]),['dry-run','plan']);assert.equal((await f.library.read(f.source.file)).hash,f.source.hash);
  await f.service.plan(f.input);assert.equal(f.calls.length,2);
  await assert.rejects(f.service.plan({...f.input,name:'Outra produção'}),/outro conteúdo/);
  await f.service.execute({id:job.id,recipeHash:job.recipeHash});await f.service.idle();
  assert.deepEqual(f.calls[2],['run','--state',job.stateFile,'--confirm-fingerprint','approved-hash']);
  assert.equal((await f.service.read(job.id)).status,'complete');
  await assert.rejects(f.service.execute({id:job.id,recipeHash:job.recipeHash}),/indisponível/);
});
test('versão adulterada não executa e estado ambíguo nunca repete run',async t=>{
  const f=await fixture(t,true);await f.service.plan(f.input);await f.service.idle();const j=await f.service.read(f.input.requestId);
  await assert.rejects(f.service.execute({id:j.id,recipeHash:'wrong'}),/mudou/);assert.equal(f.calls.length,2);
  await f.service.execute({id:j.id,recipeHash:j.recipeHash});await f.service.idle();assert.equal((await f.service.read(j.id)).status,'attention');assert.equal(f.calls.length,3);
  await assert.rejects(f.service.execute({id:j.id,recipeHash:j.recipeHash}),/indisponível/);
  await f.service.execute({id:j.id,recipeHash:j.recipeHash},true);await f.service.idle();assert.equal(f.calls.at(-1)[0],'resume');
});
test('um clique prepara e executa no host sem polling do navegador; repetição não duplica',async t=>{
  const f=await fixture(t);const input={...f.input,autoStart:true};const accepted=await f.service.plan(input);assert.equal(accepted.autoStartRequested,true);
  await f.service.idle();assert.deepEqual(f.calls.map(a=>a[0]),['dry-run','plan','run']);const job=await f.service.read(input.requestId);assert.equal(job.status,'complete');
  await f.service.plan(input);assert.equal(f.calls.length,3);await assert.rejects(f.service.plan({...input,autoStart:false}),/outro conteúdo/);
});
test('continuação autorizada que falha não repete a produção, nem aceita booleano forjado',async t=>{
  const f=await fixture(t,true);await assert.rejects(f.service.plan({...f.input,autoStart:'true'}),/explícita/);assert.equal(f.calls.length,0);
  const input={...f.input,autoStart:true};await f.service.plan(input);await f.service.idle();assert.equal((await f.service.read(input.requestId)).status,'attention');await f.service.plan(input);assert.deepEqual(f.calls.map(a=>a[0]),['dry-run','plan','run']);
});
test('origem e tipo de receita são validados antes do motor',async t=>{
  const f=await fixture(t);await assert.rejects(f.service.plan({...f.input,sourceHash:'changed'}),/origem mudou/);
  await assert.rejects(f.service.plan({...f.input,sourceFile:'../secret.json'}),/inválido/);
  await assert.rejects(f.service.plan({...f.input,document:{...f.input.document,kind:'lote'}}),/lotes/);
  assert.equal(f.calls.length,0);
});
test('texto tem idempotência própria e não dispara vídeo',async t=>{
  const f=await fixture(t);const request={requestId:randomUUID(),prompt:'Caneca'};
  await f.service.text(request);await f.service.idle();await f.service.text(request);
  assert.deepEqual(f.calls.map(a=>a[0]),['text']);assert.equal((await f.service.read(request.requestId)).text,'Texto proposto pelo dublê');
  await assert.rejects(f.service.text({...request,prompt:'Outra coisa'}),/outro texto/);
});
test('API rejeita origem externa e POST sem token antes de qualquer ação',async()=>{
  const routes=generatorRoutes({coreDir:'.',service:{execute:()=>{throw new Error('não deve chamar');}}});
  for (const headers of [{host:'localhost:5599',origin:'https://example.com'},{host:'localhost:5599',origin:'http://localhost:5599'},{host:'evil.example'}]) {
    let status;const res={removeHeader(){},writeHead(code){status=code;},end(){}};
    await routes({method:'POST',headers},res,new URL('http://localhost:5599/api/gerador/run'));assert.equal(status,403);
  }
});
