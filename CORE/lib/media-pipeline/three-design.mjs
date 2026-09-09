import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const browser = path.join(import.meta.dirname, 'three-design');
export const THREE_LIBRARIES = Object.freeze({
  three: '0.185.0', postprocessing: '6.39.4', gsap: '3.14.2',
  '@react-three/fiber': '9.7.0', '@react-three/drei': '10.7.8',
  '@theatre/core': '0.7.2', '@theatre/studio': '0.7.2',
  'three.quarks': '0.17.1', react: '19.2.0', 'react-dom': '19.2.0', esbuild: '0.28.2',
});
export const THREE_QUALITY = Object.freeze({
  preview: { width: 640, height: 360, fps: 15, captureFormat: 'jpeg' },
  balanced: { width: 1280, height: 720, fps: 30, captureFormat: 'jpeg' },
  master: { width: 1920, height: 1080, fps: 30, captureFormat: 'png' },
});
export const THREE_PRESETS = Object.freeze(['gallery', 'prism', 'orbit']);
const hash = value => createHash('sha256').update(value).digest('hex');

export async function describeThreeDesign() {
  const installed = [];
  for (const [name, version] of Object.entries(THREE_LIBRARIES)) {
    const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (pkg.version !== version) throw Error(`Versão divergente de ${name}; execute npm ci --ignore-scripts.`);
    installed.push({ name, version, license: pkg.license ?? 'see package license' });
  }
  return { id: 'threejs', version: THREE_LIBRARIES.three, providerFree: true, auth: 'none',
    capture: 'existing Playwright WebGL2 Studio', platform: 'win32', installed,
    presets: THREE_PRESETS, quality: THREE_QUALITY, audio: 'silent-visual; Studio mix is separate',
    authoring: { react: 'react.mjs', theatre: 'theatre.mjs', particles: 'particles.mjs' } };
}

export function normalizeThreeSpec(input) {
  const allowed = ['id', 'preset', 'quality', 'width', 'height', 'fps', 'durationSeconds', 'aspect', 'background', 'accent', 'bloom', 'particles', 'seed', 'timeOffsetSeconds', 'captureFormat'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) throw Error('Three.js exige campos paramétricos documentados, sem código ou assets externos.');
  const quality = input.quality ?? 'preview', preset = input.preset ?? 'gallery';
  if (!Object.hasOwn(THREE_QUALITY, quality) || !THREE_PRESETS.includes(preset)) throw Error('Qualidade ou preset Three.js inválido.');
  const spec = { id: 'three-design', ...THREE_QUALITY[quality], durationSeconds: 6, aspect: '16:9', background: '#070d20', accent: '#91bdff', bloom: .35, particles: false, seed: 73, timeOffsetSeconds: 0, ...input, quality, preset };
  if (!['png', 'jpeg'].includes(spec.captureFormat)) throw Error('Formato de captura inválido.');
  if (typeof spec.particles !== 'boolean' || !Number.isSafeInteger(spec.seed) || spec.seed < 1 || spec.seed > 2147483647) throw Error('Partículas exigem booleano e seed inteiro positivo.');
  if (!Number.isFinite(spec.bloom) || spec.bloom < 0 || spec.bloom > 2) throw Error('Bloom deve ficar entre 0 e 2.');
  if (!Number.isFinite(spec.timeOffsetSeconds) || spec.timeOffsetSeconds < 0 || spec.timeOffsetSeconds + spec.durationSeconds > 120) throw Error('Janela temporal Three.js inválida (máximo 120 s).');
  if (![spec.width, spec.height, spec.fps].every(Number.isInteger) || spec.width < 2 || spec.height < 2 || spec.width % 2 || spec.height % 2 || spec.width > 1920 || spec.height > 1920 || spec.fps < 1 || spec.fps > 120) throw Error('Dimensões pares até 1920 e fps inteiro de 1 a 120 são obrigatórios.');
  if (!Number.isFinite(spec.durationSeconds) || spec.durationSeconds <= 0 || spec.durationSeconds > 60) throw Error('Duração deve ficar entre 0 e 60 segundos.');
  const ratios = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] }, ratio = ratios[spec.aspect];
  if (!ratio || spec.width * ratio[1] !== spec.height * ratio[0]) throw Error('Aspecto e dimensões divergem.');
  if (![spec.background, spec.accent].every(c => /^#[a-f0-9]{6}$/i.test(c))) throw Error('Cores exigem hexadecimal de seis dígitos.');
  return spec;
}

// Bundles trusted, versioned resources in memory. No CDN, filesystem writes or browser.
// Date.now in dependencies is bound to the supplied frame, without weakening the sandbox.
export async function bundleThreeDocument(source, { resolveDir = browser } = {}) {
  const catalog = await describeThreeDesign();
  const result = await build({ stdin: { contents: source, resolveDir, loader: 'jsx', sourcefile: 'studio-three-entry.jsx' },
    absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120',
    minify: true, metafile: true, legalComments: 'inline', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'studio-dependency-clock', setup(build) {
      build.onLoad({ filter: /node_modules[\\/].*\.[cm]?js$/ }, async ({ path: file }) => {
        let contents = await readFile(file, 'utf8');
        contents = contents.replace(/(?:\b[\w$]+\.)?\bDate\.now\b/g, '(()=>globalThis.__threeFrameTimeMs ?? 0)');
        if (/[\\/](three\.quarks|quarks\.core)[\\/]/.test(file)) contents = contents.replace(/\bMath\.random\b/g, 'globalThis.__threeRandom');
        return { contents, loader: 'js' };
      });
    } }] });
  const js = result.outputFiles[0].text;
  const files = await Promise.all(Object.keys(result.metafile.inputs).filter(f => !f.includes('studio-three-entry.jsx')).sort().map(async file => ({ file, sha256: hash(await readFile(path.resolve(root, file))) })));
  const binding = { schema: 'mkt-videos/three-design-bundle@1', clock: 'explicit-frame-dependency-clock@1',
    libraries: catalog.installed, lockfileSha256: hash(await readFile(path.join(root, 'package-lock.json'))), files, javascriptSha256: hash(js) };
  const html = `<style>html,body{margin:0;overflow:hidden}canvas{display:block}</style><body><script>globalThis.__threeFrameTimeMs=0;${js.replaceAll('</script', '<\\/script')}</script></body>`;
  return { html, binding };
}

export async function buildThreePreset(input) {
  const spec = normalizeThreeSpec(input);
  const source = `import {createDesignScene} from './presets.mjs';\n${spec.particles ? "import {createParticles} from './particles.mjs';" : ''}\nconst spec=${JSON.stringify(spec).replaceAll('<', '\\u003c')};\nconst scene=createDesignScene(spec);\n${spec.particles ? 'const particles=createParticles(scene.scene,{seed:spec.seed});' : ''}\nwindow.__setFrame=async(f,n,s)=>{const t=s.timeSeconds+spec.timeOffsetSeconds;globalThis.__threeFrameTimeMs=t*1000;scene.seek(t);${spec.particles ? 'particles.seek(t);' : ''}scene.render();};`;
  return { ...await bundleThreeDocument(source), spec };
}
