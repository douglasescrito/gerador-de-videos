import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { captureLocalRenderFrames } from '../lib/media-pipeline/local-render-engines.mjs';
import { createHtmlMotionScene } from '../lib/media-pipeline/html-motion-pilot.mjs';
import { PLAY_STYLE, PLAY_FONT, PLAY_RECIPES, typographicPlayAssets, typographicPlayDocument } from '../lib/media-pipeline/typographic-play.mjs';

const sceneFor = (id, extra = {}) => createHtmlMotionScene({ motionStyle: PLAY_STYLE, playRecipe: id, fontFamily: PLAY_FONT, durationSeconds: 14, width: 640, height: 360, fps: 30, background: PLAY_RECIPES[id].palette[0], accent: PLAY_RECIPES[id].palette[2], ...extra });

test('dez direções locais validam receitas, fontes e limites sem aceitar entrada executável', async () => {
  assert.equal(Object.keys(PLAY_RECIPES).length, 10);
  for (const id of Object.keys(PLAY_RECIPES)) {
    assert.equal(sceneFor(id).frameCount, 420);
    const assets = await typographicPlayAssets(id);
    assert.ok(assets.fonts.length > 0);
    assert.ok(assets.fonts.every(font => /^[a-f0-9]{64}$/.test(font.sha256)));
  }
  for (const extra of [{ playRecipe: '../escape' }, { durationSeconds: 12 }, { fontFamily: 'remote' }, { background: '#ffffff' }, { motionControls: { source: 'fetch()' } }]) assert.throws(() => sceneFor('cabe-mais', extra));
  assert.throws(() => createHtmlMotionScene({ playRecipe: 'cabe-mais' }), /exige typographic/);
  assert.throws(() => createHtmlMotionScene({ fontFamily: PLAY_FONT }), /Arial/);
});

test('dez composições mantêm seek determinístico, curvas e arremate em Playwright headless', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = []; let requests = 0;
  try {
    for (const id of Object.keys(PLAY_RECIPES)) {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
      page.on('pageerror', error => errors.push(`${id}: ${error.message}`));
      await page.route('**/*', route => { requests++; return route.abort(); });
      await page.addInitScript(() => { window.__studioTimeMs = 0; Date.now = () => window.__studioTimeMs; Math.random = () => .5; });
      await page.goto('about:blank');
      await page.setContent(await typographicPlayDocument(sceneFor(id)));
      await page.evaluate(() => window.__playReady);
      const snap = async t => { await page.evaluate(t => window.__setFrame(Math.round(t * 30)), t); return page.screenshot({ animations: 'disabled' }); };
      const direct = await snap(7.3);
      await snap(13.9); await snap(0); await snap(4.2);
      assert.deepEqual(await snap(7.3), direct, `${id}: reverse seek`);
      const end = await snap(12.3);
      assert.deepEqual(await snap(13.9), end, `${id}: final hold`);
      assert.notDeepEqual(await snap(3), end, `${id}: movement`);
      const diagnostics = await page.evaluate(() => ({ ...window.__playDiagnostics, paused: Object.values(window.__timelines)[0].paused(), fontsReady: document.fonts.status }));
      assert.equal(diagnostics.paused, true); assert.equal(diagnostics.fontsReady, 'loaded');
      assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('[data-composition-id]')).every(host => Boolean(window.__timelines[host.dataset.compositionId]))), true, `${id}: HyperFrames host registration`);
      assert.equal(diagnostics.sourceRecipe, PLAY_RECIPES[id].sourceRecipe);
      assert.ok(diagnostics.tracks.length >= 5);
      for (const track of diagnostics.tracks) assert.ok(track.at + track.duration <= 12.2, `${id}: ending`);
      await page.close();
    }
    assert.deepEqual(errors, []); assert.equal(requests, 0);
  } finally { await browser.close(); }
});

test('HyperFrames reconhece a timeline sem espera de subcomposição ausente', { timeout: 60000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const frameRoot = await mkdtemp(path.join(root, '.play-capture-test-'));
  try {
    const assets = await typographicPlayAssets('cabe-mais');
    const scene = sceneFor('cabe-mais', { width: 320, height: 180, fps: 1 });
    // Capture only the first three samples through the existing adapter. This
    // checks the engine handshake, without making a second production master.
    const result = await captureLocalRenderFrames({ engine: 'hyperframes', executable: chromium.executablePath(), frameRoot, scene: { ...scene, frameCount: 3 }, source: await typographicPlayDocument(scene), fontFile: assets.fonts[0].file, onScreenText: '', maxWallMs: 55000, beforeLoad: async () => {} });
    assert.equal(result.capturePerformance.subTimelineWaitOutcome, 'ready');
    assert.equal(result.networkRequests, 0); assert.equal(result.pageErrors, 0);
    assert.notEqual(result.firstFrameHash, result.lastFrameHash);
  } finally {
    const target = path.resolve(frameRoot);
    assert.ok(target.startsWith(path.join(root, '.play-capture-test-')));
    await rm(target, { recursive: true, force: true });
  }
});
