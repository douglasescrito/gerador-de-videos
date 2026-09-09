import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { executar } from '../lib/cli/commands/commercial.mjs';
import { buildCommercialJobs } from '../lib/media-pipeline/commercial.mjs';

test('commercial jobs without identity scene need no logo; an identity scene requires an explicit asset', async () => {
  let accessed = 0, written = null;
  const spec = { name: 'neutral', scenes: [{ id: 's1', text: 'Ideias em movimento', style: 'default', span: [0, 1] }] };
  const context = {
    options: { step: 'jobs', spec: 'neutral.json' }, coreRoot: process.cwd(),
    DEFAULT_COMMERCIAL_LOGO: null, path,
    access: async () => { accessed++; }, mkdir: async () => {},
    readJsonFile: async () => ({ value: spec }), buildCommercialJobs,
    writeJsonAtomic: async (_file, value) => { written = value; },
  };
  const previousLog = console.log;
  console.log = () => {};
  try {
    await executar(context);
    assert.equal(accessed, 0);
    assert.equal(written.length, 1);
    assert.equal(written[0].task, 'text_to_video');
    assert.equal(written[0].images, undefined);
    written = null;
    spec.scenes[0].style = 'closer';
    await assert.rejects(executar(context), /exige uma imagem de logo/);
    assert.equal(written, null);
  } finally { console.log = previousLog; }
});
