import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createBrandKit } from '../lib/media-pipeline/studio-policies.mjs';

test('series planner works without private campaign module and binds only explicit content and policy', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-daily-neutral-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  const outfile = path.join(root, 'series.mjs');
  await build({ entryPoints: [path.resolve(import.meta.dirname, '../lib/media-pipeline/daily-commercial-generator.mjs')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  assert.doesNotMatch(await readFile(outfile, 'utf8'), /Faculdade Focus|APRENDA COM A FOCUS|knowledge becomes movement/);
  const engine = await import(pathToFileURL(outfile).href);
  const kit = createBrandKit({ id: 'neutral-example' });
  const config = {
    schema: engine.DAILY_COMMERCIAL_MISSION_SCHEMA, id: 'neutral-series', title: 'Technical example', timeZone: 'UTC', outputsRoot: path.join(root, 'outputs'),
    brand: { brandKit: kit, brandKitId: kit.id, brandKitHash: kit.hash, logoFile: 'user-reference.png', logoSha256: '0'.repeat(64) },
    editorial: { brandDisplayName: 'Estudo visual', logoGuidance: 'Use only the supplied authorized graphic reference.', messages: ['Geometry in motion'], copySequences: [['UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS']] },
    visual: { aspect: '9:16', profile: 'vertical-social-safe-area@1', safeArea: { leftPercent: 15, rightPercent: 15, topPercent: 20, bottomPercent: 20, maxWordsPerTextCard: 5 } },
    production: { commercialsPerDay: 1, wavesPerDay: 1, commercialsPerWave: 1, chaptersPerCommercial: 6, clipDurationSeconds: 10, targetCommercialDurationSeconds: 60, maxProviderCallsPerDay: 6, parallel: 1, minFreeDiskGb: 1, automaticRetry: false, correctionPasses: 0, authentication: 'credential-manager' },
    retention: { localMedia: 'until-drive-verified' }, delivery: { rootFolderId: 'USER_FOLDER_ID', client: 'user-client' },
  };
  const state = { schema: engine.DAILY_COMMERCIAL_STATE_SCHEMA, missionId: config.id, waves: [] };
  const plan = engine.createDailyCommercialWavePlan({ config, state, waveNumber: 1, now: new Date('2026-01-01T12:00:00Z') });
  assert.equal(plan.jobs.length, 6);
  for (const job of plan.jobs) {
    assert.match(job.prompt, /Estudo visual/);
    assert.match(job.prompt, /Geometry in motion/);
    assert.doesNotMatch(job.prompt, /Faculdade|Focus|two-band/);
  }
  assert.throws(() => engine.validateDailyCommercialMission({ ...config, editorial: undefined }), /editorial/);
  assert.throws(() => engine.validateDailyCommercialMission({ ...config, brand: { ...config.brand, brandKitHash: '0'.repeat(64) } }), /BrandKit/);
});
