import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(String(bytes).replace(/^\uFEFF/, ''));
const fail = message => { throw new Error(`Biblioteca de direção: ${message}`); };
const relativeInside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function readBoundFile(root, relative, expectedHash) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) fail('caminho relativo inválido.');
  const file = path.resolve(root, relative);
  if (!relativeInside(root, file)) fail('asset fora do workspace.');
  const actual = await realpath(file);
  if (!relativeInside(await realpath(root), actual)) fail('link de asset fora do workspace.');
  const bytes = await readFile(actual);
  if (!/^[a-f0-9]{64}$/.test(String(expectedHash)) || hash(bytes) !== expectedHash) fail(`hash divergente: ${relative}.`);
  return { path: file, sha256: expectedHash, bytes: bytes.length, content: bytes };
}

/** Catálogo de autoria explícita: não promove conhecimento nem compila presets. */
export async function readMotionDirections({ coreRoot, id = null } = {}) {
  const root = path.resolve(coreRoot ?? path.join(import.meta.dirname, '../..'));
  const relativeFolder = 'recipes/hyperframes-tipografia-20';
  const folder = path.join(root, relativeFolder);
  const [catalogBytes, validationBytes, sourcesBytes] = await Promise.all([
    readFile(path.join(folder, 'catalogo.preproduction.json')),
    readFile(path.join(folder, 'validacao.json')),
    readFile(path.join(folder, 'fontes.json')),
  ]);
  const catalog = parse(catalogBytes), validation = parse(validationBytes), sources = parse(sourcesBytes);
  if (validation.catalogSha256 !== hash(catalogBytes) || validation.sourcesSha256 !== hash(sourcesBytes)) fail('catálogo ou fontes mudaram; atualizar o binding da biblioteca.');
  if (!Array.isArray(catalog.recipes) || !catalog.recipes.length || new Set(catalog.recipes.map(r => r.id)).size !== catalog.recipes.length) fail('IDs ausentes ou duplicados.');
  if (validation.recipeCount !== catalog.recipes.length) fail('contagem divergente.');
  const recipes = catalog.recipes.map(recipe => {
    const binding = validation.files.find(file => file.id === recipe.id);
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(recipe.id) || !binding || binding.recipeSha256 !== hash(JSON.stringify(recipe))) fail('receita sem binding íntegro.');
    if (recipe.boundaries?.[0] !== 0 || recipe.boundaries.at(-1) !== catalog.durationSeconds || recipe.beats?.length + 1 !== recipe.boundaries.length || recipe.boundaries.some((v, i, arr) => !Number.isFinite(v) || (i > 0 && v <= arr[i-1]))) fail(`timeline inválida em ${recipe.id}.`);
    if (recipe.sources.some(source => !sources.sources.some(item => item.id === source))) fail(`fonte não registrada em ${recipe.id}.`);
    return { id: recipe.id, title: recipe.title, idea: recipe.idea, mechanism: recipe.mechanism,
      nominalDurationSeconds: catalog.durationSeconds, narrationWords: binding.narrationWords,
      fonts: recipe.fonts, status: 'authoring-ready', executablePreset: false, recipeSha256: binding.recipeSha256 };
  });
  const common = { schema: 'mkt-videos/motion-direction-library@1', catalogSha256: hash(catalogBytes),
    providerCalls: 0, generationTriggered: false, knowledgePromotion: false,
    authority: 'authoring-instructions-only', selection: 'explicit', engine: 'hyperframes', mode: 'studio',
    readiness: { authoring: true, render: false, reason: 'A composição e o binding das fontes precisam ser implementados no adapter existente; os presets atuais não executam estas 20 direções.' },
    count: recipes.length };
  if (id == null) return { ...common, recipes };
  const selected = catalog.recipes.find(recipe => recipe.id === id);
  if (!selected) fail(`direção desconhecida: ${id}. Consulte receitas --action direcoes.`);
  const binding = validation.files.find(file => file.id === id);
  const fontManifest = await readBoundFile(root, 'assets/fonts/hyperframes-tipografia/manifest.json', validation.fontManifestSha256);
  const fontRows = parse(fontManifest.content).files.filter(file => selected.fonts.includes(file.family));
  for (const family of selected.fonts) {
    if (!fontRows.some(file => file.family === family && file.path.endsWith('.ttf')) || !fontRows.some(file => file.family === family && file.path.endsWith('/OFL.txt'))) fail(`fonte ou licença ausente: ${family}.`);
  }
  const [prompt, script, music, ...assets] = await Promise.all([
    readBoundFile(root, `${relativeFolder}/${binding.file}`, binding.sha256),
    readBoundFile(root, `${relativeFolder}/${id}.roteiro.txt`, binding.scriptSha256),
    readBoundFile(root, `${relativeFolder}/${id}.trilha.txt`, binding.musicSha256),
    ...fontRows.map(file => readBoundFile(root, file.path, file.sha256)),
  ]);
  return { ...common, selected: structuredClone(selected), prompt: prompt.content.toString('utf8'),
    narration: { provider: 'google-vids', script: script.content.toString('utf8').trim(), words: binding.narrationWords, sha256: script.sha256, materialAudioPresent: false },
    music: { provider: 'flow-music', prompt: music.content.toString('utf8').trim(), sha256: music.sha256, fadeOut: 0, materialAudioPresent: false },
    sync: { provider: 'whisper-local', timestamps: 'derive-from-selected-material-voice', reuseOtherScriptAlignment: false },
    sources: sources.sources.filter(source => selected.sources.includes(source.id)),
    binding: { recipeSha256: binding.recipeSha256, promptSha256: prompt.sha256, fontManifestSha256: fontManifest.sha256,
      assets: assets.map(({ content, ...asset }) => asset), assetsVerified: true },
    files: { prompt: prompt.path, script: script.path, musicPrompt: music.path, catalog: path.join(folder, 'catalogo.preproduction.json') } };
}
