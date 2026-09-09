import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_CAPABILITIES, resolveCapabilityIntent } from '../lib/media-pipeline/provider-registry.mjs';

test('explicit renderer selection never falls back to another eligible renderer', () => {
  const request = { intent: 'graphics.render.html', operation: 'html-render' };
  assert.throws(() => resolveCapabilityIntent(PROVIDER_CAPABILITIES, request), /mais de uma capability/);
  for (const capabilityId of ['playwright-html-local', 'hyperframes-html-local', 'remotion-html-local']) {
    const selected = resolveCapabilityIntent(PROVIDER_CAPABILITIES, { ...request, capabilityId });
    assert.equal(selected.capability.id, capabilityId);
    const withoutSelected = Object.fromEntries(Object.entries(PROVIDER_CAPABILITIES).filter(([id]) => id !== capabilityId));
    assert.equal(resolveCapabilityIntent(withoutSelected, { ...request, capabilityId }).status, 'blocked');
    assert.equal(resolveCapabilityIntent(PROVIDER_CAPABILITIES, { ...request, capabilityId, operation: 'unsupported-operation' }).status, 'blocked');
  }
});
