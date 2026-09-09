import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright-core';
import {createHtmlMotionScene} from '../lib/media-pipeline/html-motion-pilot.mjs';
import {mcpUiReconstructionDocument} from '../lib/media-pipeline/mcp-ui-reconstruction.mjs';

test('MCP reconstruction has fixed duration and deterministic seek across every scene', {timeout:60000}, async()=>{
  assert.throws(()=>createHtmlMotionScene({motionStyle:'mcp-ui-reconstruction@1',durationSeconds:8}),/41.84/);
  const scene=createHtmlMotionScene({motionStyle:'mcp-ui-reconstruction@1',durationSeconds:41.84,fps:25,width:640,height:360});
  assert.equal(scene.frameCount,1046);
  const browser=await chromium.launch({...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'}),headless:true});
  try {
    const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());
    await page.setContent(mcpUiReconstructionDocument(scene));
    assert.deepEqual(errors,[]);
    const snap=t=>page.evaluate(t=>{window.__setFrame(Math.round(t*25));return document.querySelector('canvas').toDataURL()},t);
    const first=await snap(5);
    const frames=[];
    for(const t of [0,.5,1.5,2.5,4,6,8,9.8,11,13,16,19,21,24,26,29,31,32.5,34,36,39,41.8]) frames.push(await snap(t));
    assert.equal(new Set(frames).size,frames.length-1); // final CTA intentionally holds
    assert.equal(await snap(5),first);
    assert.notEqual(await snap(5.4),first);
    assert.deepEqual(errors,[]);
  } finally {await browser.close()}
});
