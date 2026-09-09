import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { cubicBezierAt, validateMotionControls, integratedLaunchDocument } from '../lib/media-pipeline/integrated-launch.mjs';
import { createHtmlMotionScene, renderHtmlMotionPilot } from '../lib/media-pipeline/html-motion-pilot.mjs';

test('curvas controlam velocidade e acomodação com endpoints exatos',()=>{
 const p=validateMotionControls();
 assert.equal(cubicBezierAt(0,p.travelBezier),0);assert.equal(cubicBezierAt(1,p.travelBezier),1);
 const early=cubicBezierAt(.1,p.travelBezier),middle=cubicBezierAt(.5,p.travelBezier);
 assert.ok(early<.03);assert.ok(Math.abs(middle-.5)<1e-6);
 assert.ok(cubicBezierAt(.7,p.settleBezier)>1);
 for(const value of [{travelBezier:[-1,0,1,1]},{settleBezier:[0,Infinity,1,1]},{depth:-1},{trailSamples:6},{code:'alert()'}])assert.throws(()=>validateMotionControls(value));
 assert.throws(()=>createHtmlMotionScene({motionStyle:'integrated-launch@1'}),/palavras/);
});

test('template integrado rejeita roteiro incompatível e dados não executáveis',()=>{
 assert.throws(()=>integratedLaunchDocument({durationSeconds:62,wordMotion:[{word:'Outro',start:0,end:1}]}),/âncora/);
});

test('fonte do template segue relógio explícito, sem loops de render ou I/O externos',async()=>{
 const source=await readFile(new URL('../lib/media-pipeline/integrated-launch.mjs',import.meta.url),'utf8');
 assert.ok(!/requestAnimationFrame|setInterval|fetch\(|XMLHttpRequest|Date\.now|Math\.random/.test(source));
 // Ensure the serialized frame program is syntactically valid independently.
 const fn=source.slice(source.indexOf('function paintIntegrated'),source.indexOf('\nexport function integratedLaunchDocument'));
 new vm.Script(`(${fn})`);
});

test('HyperFrames publica JPEG explícito, conta frames e mantém isolamento', {timeout:60000}, async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'integrated-hf-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const scene=createHtmlMotionScene({width:320,height:180,fps:6,durationSeconds:1,captureFormat:'jpeg'});
 await assert.rejects(renderHtmlMotionPilot({engine:'remotion',scene}),/JPEG exige/);
 const result=await renderHtmlMotionPilot({engine:'hyperframes',scene,outputFile:path.join(dir,'master.mp4'),receiptFile:path.join(dir,'receipt.json'),metadataDirectory:path.join(dir,'metadata'),maxWallMs:120000});
 assert.equal(result.receipt.metadata.captureFormat,'jpeg');
 assert.equal(result.receipt.metadata.captureQuality,100);
 assert.equal(result.receipt.metadata.frameCount,6);
 assert.equal(result.receipt.metadata.networkRequests,0);
 assert.equal(result.receipt.metadata.pageErrors,0);
 assert.notEqual(result.receipt.metadata.firstFrameHash,result.receipt.metadata.lastFrameHash);
 assert.ok((await readFile(path.join(dir,'master.mp4'))).length>500);
});
