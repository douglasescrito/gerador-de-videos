import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listPromptTechniques, listProductionTechniques, resolvePromptTechnique, PRODUCTION_PROCEDURES } from '../lib/media-pipeline/prompt-techniques.mjs';
import { renderTechniqueCatalogMarkdown } from '../lib/media-pipeline/technique-catalog.mjs';

// This installed-package check complements the source-side original/adapted
// comparison. It does not claim access to, or equivalence with, private history.
test('installed technique catalog has consistent docs and no inherited production validation', async () => {
  const docs = await readFile(new URL('../docs/TECHNIQUE-CATALOG.md', import.meta.url), 'utf8');
  assert.equal(docs, renderTechniqueCatalogMarkdown({ techniques: listPromptTechniques(), procedures: Object.values(PRODUCTION_PROCEDURES) }));
  assert.doesNotMatch(docs, /outputs\/|producoes\//i);
  for (const list of [listPromptTechniques(), listProductionTechniques()]) {
    assert.ok(list.length > 0);
    assert.equal(new Set(list.map(item => item.id)).size, list.length);
    for (const item of list) {
      assert.deepEqual(item.evidence, { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null });
      assert.equal(item.validationLevel, 'unvalidated');
      assert.notEqual(item.status, 'proven');
      if (item.studyRefs !== undefined) assert.deepEqual(item.studyRefs, []);
    }
  }
  for (const item of listPromptTechniques().filter(item => item.status === 'concept')) assert.throws(() => resolvePromptTechnique(item.id), /concept/);
});
