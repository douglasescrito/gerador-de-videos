import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNarrationBlocks } from './script-plan-derivation.mjs';

test('extractNarrationBlocks - valid plan', () => {
  const plan = {
    schema: "mkt-videos/script-plan@1",
    piece: { targetDurationSeconds: 20 },
    blocks: [
      { id: "n01", seconds: 10, text: "Block 1" },
      { id: "n02", seconds: 10, text: "Block 2" }
    ]
  };
  const blocks = extractNarrationBlocks(plan);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].id, "n01");
});

test('extractNarrationBlocks - invalid schema', () => {
  const plan = { schema: "wrong" };
  assert.throws(() => extractNarrationBlocks(plan), /Invalid schema/);
});

test('extractNarrationBlocks - missing blocks', () => {
  const plan = { schema: "mkt-videos/script-plan@1" };
  assert.throws(() => extractNarrationBlocks(plan), /Missing blocks array/);
});

test('extractNarrationBlocks - out of duration bounds (too short)', () => {
  const plan = {
    schema: "mkt-videos/script-plan@1",
    piece: { targetDurationSeconds: 60 },
    blocks: [
      { id: "n01", seconds: 10, text: "Block 1" }
    ]
  };
  assert.throws(() => extractNarrationBlocks(plan), /is outside 0.9x-1.1x/);
});

test('extractNarrationBlocks - out of duration bounds (too long)', () => {
  const plan = {
    schema: "mkt-videos/script-plan@1",
    piece: { targetDurationSeconds: 10 },
    blocks: [
      { id: "n01", seconds: 20, text: "Block 1" }
    ]
  };
  assert.throws(() => extractNarrationBlocks(plan), /is outside 0.9x-1.1x/);
});
