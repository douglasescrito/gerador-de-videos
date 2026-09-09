import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMasterRecipe, resolveMasterRecipe, compileResolvedMasterRecipe, preflightResolvedMasterRecipe } from '../lib/media-pipeline/master-recipe-v2.mjs';

for (const [name, vertical, shots] of [
  ['golden-30s.receita-v2.5b.json', '2.5B', 3],
  ['golden-30s.receita-v2.5c.json', '2.5C', 3],
  ['golden-180s.receita-v2.5d.json', '2.5D', 18],
]) {
  test(`neutral ${vertical} example rejects execution with placeholder assets`, async () => {
    const bytes = await readFile(new URL(`../recipes/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(bytes, /douglas|4015cf176152ae75d4c35e1ef3abd0a0bf9910fd1b4e2f5aaa3ff6f20b2e910e|8225054/i);
    const input = JSON.parse(bytes);
    if (vertical === '2.5C') {
      const withUnapprovedCrop = structuredClone(input);
      withUnapprovedCrop.variants.items.push({ format: '1:1', strategy: 'center-crop', approved: false });
      assert.throws(() => parseMasterRecipe(JSON.stringify(withUnapprovedCrop)), /crop ou formato quadrado exige approved true/);
    }
    const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(input)));
    assert.equal(resolved.vertical, vertical);
    assert.equal(resolved.recipe.videoGeneration.shots.length, shots);
    const report = preflightResolvedMasterRecipe(resolved);
    assert.equal(report.status, 'blocked');
    assert.equal(report.providerCalls, 0);
    for (const asset of resolved.recipe.assets) {
      assert.equal(asset.rights.providerInput, 'unknown');
      assert.equal(asset.rights.reuse, 'unknown');
      assert.ok(report.blockers.some(b => b.assetId === asset.id && /rights-not-allowed/.test(b.code)));
    }
    assert.equal(resolved.recipe.narration.timing.status, 'planned-not-measured');
    assert.throws(() => compileResolvedMasterRecipe(resolved), /bloqueada no preflight/);
    const original = JSON.parse(bytes);
    if (original.variants) assert.ok(original.variants.items.every(v => v.approved === false));
  });
}
