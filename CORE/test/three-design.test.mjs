import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describeThreeDesign, normalizeThreeSpec, buildThreePreset, bundleThreeDocument } from '../lib/media-pipeline/three-design.mjs';
import { renderHtmlMotionPilot } from '../lib/media-pipeline/html-motion-pilot.mjs';
import { createGalleryDocument } from '../examples/three-gallery-authoring.mjs';

const root = path.resolve(import.meta.dirname, '..'), execute = promisify(execFile);
const cli = args => execute(process.execPath, ['scripts/omni-cli.mjs', 'render', ...args], { cwd: root, windowsHide: true, maxBuffer: 8e6 });
async function temporary(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'three-design-')); t.after(async () => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(dir, { recursive: true, force: true }); }); return dir; }

test('Three resources pin versions, reject executable input and expose distinct quality budgets', async t => {
  assert.equal((await describeThreeDesign()).installed.length, 11);
  assert.equal(normalizeThreeSpec({ quality: 'preview' }).width, 640);
  assert.equal(normalizeThreeSpec({ quality: 'master' }).captureFormat, 'png');
  for (const spec of [{ entryPoint: 'x.js' }, { particles: 'true' }, { seed: 0 }, { bloom: 20 }, { quality: '__proto__' }, { timeOffsetSeconds: -1 }]) assert.throws(() => normalizeThreeSpec(spec));
  const dir = await temporary(t), output = path.join(dir, 'never.mp4');
  const args = ['--action', 'render', '--engine', 'threejs', '--mode', 'studio', '--spec', 'recipes/three-gallery.render.json', '--out', output];
  assert.equal(JSON.parse((await cli(args)).stdout).dryRun, true);
  await assert.rejects(stat(output), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(dir, 'metadados')), { code: 'ENOENT' });
  await assert.rejects(cli([...args, '--mode', 'raw']), /studio/);
});

test('Three presets, postprocessing and Quarks render offline with reverse-seek repeatability', { skip: process.platform !== 'win32', timeout: 240000 }, async t => {
  const dir = await temporary(t);
  for (const preset of ['gallery', 'prism', 'orbit']) {
    const bundle = await buildThreePreset({ preset, width: 160, height: 90, fps: 4, durationSeconds: .75, particles: preset === 'orbit' });
    const file = path.join(dir, preset + '.html');
    // Same time at frames 0 and 2, with a forward jump and rewind in between.
    await writeFile(file, bundle.html + '<script>const original=window.__setFrame;window.__setFrame=(f,n,s)=>original(f,n,{...s,timeSeconds:[1,2,1][f]});</script>');
    const result = await renderHtmlMotionPilot({ scene: { width: 160, height: 90, fps: 4, durationSeconds: .75, graphicsApi: 'webgl2', captureFormat: 'jpeg' }, documentFile: file, outputFile: path.join(dir, preset + '.mp4'), receiptFile: path.join(dir, preset + '.json'), metadataDirectory: path.join(dir, preset), maxWallMs: 60000 });
    assert.equal(result.receipt.metadata.networkRequests, 0);
    assert.equal(result.receipt.metadata.pageErrors, 0);
    assert.equal(result.receipt.metadata.firstFrameHash, result.receipt.metadata.lastFrameHash);
    assert.ok((await readFile(result.file)).length > 1000);
  }
});

test('React Fiber/Drei and Theatre adapters run inside the unchanged opaque sandbox', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const dir = await temporary(t);
  const source = `import {createReactScene,createElement as h,RoundedBox} from './react.mjs';
import {createTheatreTrack} from './theatre.mjs';
const canvas=document.createElement('canvas');document.body.appendChild(canvas);
let value=0;
const state={definitionVersion:'0.4.0',revisionHistory:[],sheetsById:{Scene:{staticOverrides:{byObject:{}},sequence:{type:'PositionalSequence',length:2,subUnitsPerUnit:30,tracksByObject:{Object:{trackIdByPropPath:{'["x"]':'x'},trackData:{x:{type:'BasicKeyframedTrack',keyframes:[{id:'a',position:0,value:0,handles:[.5,.5,.5,.5],connectedRight:true},{id:'b',position:1,value:2,handles:[.5,.5,.5,.5],connectedRight:true}]}}}}}}}};
const track=createTheatreTrack({id:'StudioTest',state,sheetName:'Scene',objectName:'Object',properties:{x:0},apply:v=>{value=v.x}});
const ready=createReactScene({canvas,width:160,height:90,element:h(RoundedBox,{args:[2,2,2]},h('meshNormalMaterial'))});
window.__setFrame=async(f,n,s)=>{globalThis.__threeFrameTimeMs=s.timeSeconds*1000;await track.ready;track.seek(s.timeSeconds);if(Math.abs(value-s.timeSeconds*2)>.001)throw Error('Theatre keyframe mismatch');const r=await ready;r.seek(s.timeSeconds);};`;
  const bundle = await bundleThreeDocument(source), file = path.join(dir, 'react.html'); await writeFile(file, bundle.html);
  const result = await renderHtmlMotionPilot({ scene: { width: 160, height: 90, fps: 4, durationSeconds: .5, graphicsApi: 'webgl2' }, documentFile: file, outputFile: path.join(dir, 'react.mp4'), receiptFile: path.join(dir, 'react.json'), metadataDirectory: path.join(dir, 'meta'), maxWallMs: 60000 });
  assert.equal(result.receipt.metadata.networkRequests, 0); assert.equal(result.receipt.metadata.pageErrors, 0);
});

test('Three CLI publishes and recovers the same MP4 without replacing it', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const dir = await temporary(t), spec = path.join(dir, 'scene.json'), out = path.join(dir, 'master.mp4');
  await writeFile(spec, JSON.stringify({ width: 160, height: 90, fps: 4, durationSeconds: .5 }));
  const args = ['--action', 'render', '--engine', 'threejs', '--mode', 'studio', '--spec', spec, '--out', out, '--dry-run', 'false'];
  const first = JSON.parse((await cli(args)).stdout), bytes = await readFile(out);
  const recovered = JSON.parse((await cli([...args, '--recover-existing', 'true'])).stdout);
  assert.equal(recovered.recoveredPublication, 'completed-receipt');
  assert.deepEqual(await readFile(out), bytes);
  assert.equal(first.receipt.metadata.threeDesign.libraries.length, 11);
  await writeFile(spec, JSON.stringify({ width: 160, height: 90, fps: 4, durationSeconds: .5, bloom: 1 }));
  await assert.rejects(cli([...args, '--recover-existing', 'true']));
  assert.deepEqual(await readFile(out), bytes);
});

test('Image gallery consumes embedded textures through the shared authoring example', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const dir = await temporary(t), png = path.join(dir, 'fixture.png');
  await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=16x16', '-frames:v', '1', png], { windowsHide: true });
  const data = 'data:image/png;base64,' + (await readFile(png)).toString('base64');
  const bundle = await createGalleryDocument([{ data }, { data }]), file = path.join(dir, 'images.html');
  await writeFile(file, bundle.html);
  const result = await renderHtmlMotionPilot({ scene: { width: 160, height: 90, fps: 4, durationSeconds: .5, graphicsApi: 'webgl2' }, documentFile: file, outputFile: path.join(dir, 'gallery.mp4'), receiptFile: path.join(dir, 'gallery.json'), metadataDirectory: path.join(dir, 'meta'), maxWallMs: 60000 });
  assert.equal(result.receipt.metadata.networkRequests, 0);
  assert.notEqual(result.receipt.metadata.firstFrameHash, result.receipt.metadata.lastFrameHash);
});
