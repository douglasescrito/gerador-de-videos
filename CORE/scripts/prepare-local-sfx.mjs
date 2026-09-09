import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureSyntheticSfxLibrary } from './estudos/generate-synthetic-sfx.mjs';
import { ensureRichSfxLibrary } from '../lib/media-pipeline/dense-cinema-sfx.mjs';
import { ensureOrganicCinemaKit } from '../lib/media-pipeline/organic-slow-whoosh-designer.mjs';
import { generateDspCinemaKit } from '../lib/media-pipeline/reverse-heuristic-sound-designer.mjs';

// Rebuild technical sound resources using the existing synthesis implementations.
// No account, provider call, author audio copy or replacement of existing files.
export async function prepareLocalSfx(directory = path.resolve(import.meta.dirname, '../assets/sfx')) {
  await ensureSyntheticSfxLibrary({ directory });
  await ensureRichSfxLibrary({ directory });
  await ensureOrganicCinemaKit({ directory: path.join(directory, 'organic-cinema') });
  await generateDspCinemaKit({ directory: path.join(directory, 'dsp-generated') });
  return { schema: 'mkt-videos/local-sfx-setup@1', status: 'ready', source: 'local-synthesis', providerCalls: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareLocalSfx().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
