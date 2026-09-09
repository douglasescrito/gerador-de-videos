import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMasterRecipe, resolveMasterRecipe, preflightResolvedMasterRecipe } from '../lib/media-pipeline/master-recipe-v2.mjs';

test('installed compiler accepts an explicit cast and retains asset, task and rights checks', async () => {
  const recipe = JSON.parse(await readFile(new URL('./fixtures/portable-cast.receita-v2.5b.json', import.meta.url), 'utf8'));
  const parse = value => parseMasterRecipe(JSON.stringify(value));
  const parsed = parse(recipe);
  assert.equal(parsed.recipe.cast.people[0].id, 'apresentador');
  assert.equal(parsed.recipe.cast.people[0].assetId, 'apresentador-oficial');
  assert.deepEqual(parsed.recipe.videoGeneration.shots[0].castIds, []);
  for (const change of [
    value => { value.cast.people[0].assetId = 'missing'; },
    value => { value.videoGeneration.shots[1].castIds = ['missing']; },
    value => { value.videoGeneration.shots[1].inputAssetIds = []; },
    value => { value.videoGeneration.shots[1].task = 'text-to-video'; value.videoGeneration.shots[1].inputAssetIds = []; },
  ]) {
    const invalid = structuredClone(recipe);
    change(invalid);
    assert.throws(() => parse(invalid));
  }
  const report = preflightResolvedMasterRecipe(resolveMasterRecipe(parsed));
  assert.ok(report.blockers.some(entry => entry.code === 'provider-input-rights-not-allowed'));
});
