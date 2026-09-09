import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { renderHtmlMotionPilot } from '../lib/media-pipeline/html-motion-pilot.mjs';

test('renderer tolerates a delayed clock installation and preserves exact frames', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'html-clock-delay-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const documentFile = path.join(root, 'art.html');
  await writeFile(documentFile, '<canvas width="64" height="36"></canvas><script>const c=document.querySelector("canvas").getContext("2d");window.__setFrame=(f,total,studio)=>{if(studio.timeSeconds!==f/4)throw Error("wrong frame clock");c.fillStyle=f?"blue":"red";c.fillRect(0,0,64,36)};</script>');
  const render = name => renderHtmlMotionPilot({ scene: { width: 64, height: 36, fps: 4, durationSeconds: .5 }, documentFile,
    outputFile: path.join(root, name + '.mp4'), receiptFile: path.join(root, name + '.json'), metadataDirectory: path.join(root, name), maxWallMs: 30_000 });
  const first = await render('normal');
  const launch = chromium.launch;
  chromium.launch = async function (...args) {
    const browser = await launch.apply(this, args), newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
      const context = await newContext(...contextArgs), newPage = context.newPage.bind(context);
      context.newPage = async (...pageArgs) => {
        const page = await newPage(...pageArgs), install = page.clock.install.bind(page.clock);
        page.clock.install = async (...clockArgs) => {
          await install(...clockArgs);
          await new Promise(resolve => setTimeout(resolve, 250));
        };
        return page;
      };
      return context;
    };
    return browser;
  };
  let delayed;
  try { delayed = await render('delayed'); } finally { chromium.launch = launch; }
  assert.equal(delayed.receipt.metadata.frameCount, 2);
  assert.equal(delayed.receipt.metadata.pageErrors, 0);
  assert.equal(delayed.receipt.metadata.firstFrameHash, first.receipt.metadata.firstFrameHash);
  assert.equal(delayed.receipt.metadata.lastFrameHash, first.receipt.metadata.lastFrameHash);
  assert.notEqual(first.receipt.metadata.firstFrameHash, first.receipt.metadata.lastFrameHash);
});
