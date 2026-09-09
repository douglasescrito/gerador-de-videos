import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createHtmlMotionScene } from '../lib/media-pipeline/html-motion-pilot.mjs';
import { focusMotionZakDocument } from '../lib/media-pipeline/focus-motion-zak.mjs';

test('Neutral quadrant composition has fixed duration, 1:1 aspect, and deterministic seek', { timeout: 60000 }, async () => {
  assert.throws(() => createHtmlMotionScene({ motionStyle: 'focus-motion-zak@1', durationSeconds: 8 }), /14.5/);
  assert.throws(() => createHtmlMotionScene({ motionStyle: 'focus-motion-zak@1', durationSeconds: 14.5, aspect: '16:9' }), /1:1/);

  const scene = createHtmlMotionScene({
    motionStyle: 'focus-motion-zak@1',
    durationSeconds: 14.5,
    fps: 60,
    aspect: '1:1',
    width: 1080,
    height: 1080,
    background: '#080a10',
    accent: '#0055ff'
  });
  assert.equal(scene.frameCount, 870);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.abort());
    const doc = await focusMotionZakDocument(scene);
    await page.setContent(doc);
    assert.deepEqual(errors, []);

    const snap = t => page.evaluate(async t => {
      await window.__setFrame(Math.round(t * 60));
      return document.querySelector('canvas').toDataURL();
    }, t);

    const first = await snap(1.0);
    const frames = [];
    for (const t of [0.5, 1.5, 3.5, 5.0, 7.5, 9.0, 11.5, 13.0, 14.0]) {
      frames.push(await snap(t));
    }
    // Verify frames are distinct across different phases
    assert.equal(new Set(frames).size, frames.length);
    // Deterministic seek check: seeking back to t=1.0 returns the exact same snapshot
    assert.equal(await snap(1.0), first);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
