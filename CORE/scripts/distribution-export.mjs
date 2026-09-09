import path from 'node:path';
import { lstat, readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const forbidden = /(^|\/)(?:\.git|\.env(?:\.[^/]*)?|node_modules|outputs|diagnosticos|producoes|PESSOAS|BrowserSessions|Knowledge|\.agents|\.codex|\.cache)(\/|$)|(?:legacy-editor-content|legacy-commercial-brand|legacy-output-rules)\.mjs$|\.(?:har|sqlite(?:3)?|db|mp4|mp3|wav|webm|mov|log)$/i;

async function regularPath(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Link não exportável: ${relative}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Arquivo regular exigido: ${relative}`);
  const physical = await realpath(current);
  const rel = path.relative(await realpath(root), physical);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Arquivo fora da origem: ${relative}`);
  return current;
}

// Packaging only: no Git mutation, provider access, rendering or secret import.
export async function exportDistribution({ sourceRoot, manifest, destination, write = false, purpose = 'release' }) {
  if (!['release', 'local-review'].includes(purpose)) throw new Error('Finalidade de exportação inválida.');
  const localReview = purpose === 'local-review';
  if (manifest?.schema !== 'mkt-videos/distribution-manifest@1' || (manifest.status !== 'review-complete' && !(localReview && manifest.status === 'review-in-progress'))) throw new Error('Manifesto exige revisão completa antes da exportação.');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Manifesto vazio.');
  const source = path.resolve(sourceRoot), target = path.resolve(destination);
  const relation = path.relative(source, target);
  if (!relation || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation))) throw new Error('Destino deve ficar fora da origem.');
  const physicalTarget = path.join(await realpath(path.dirname(target)), path.basename(target));
  const physicalRelation = path.relative(await realpath(source), physicalTarget);
  if (!physicalRelation || (!physicalRelation.startsWith('..' + path.sep) && physicalRelation !== '..' && !path.isAbsolute(physicalRelation))) throw new Error('Destino físico deve ficar fora da origem.');
  try { await lstat(target); throw new Error('Destino já existe; use uma pasta nova.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = [], seen = new Set();
  for (const entry of manifest.files) {
    const file = entry.path;
    if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':') || file.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(file)) throw new Error('Caminho inválido no manifesto.');
    const sourcePath = entry.sourcePath ?? file;
    const adapted = sourcePath === `CORE/distribution/public/${file}`;
    if (sourcePath !== file && !adapted) throw new Error('Origem adaptada exige CORE/distribution/public e o mesmo caminho relativo.');
    const adaptedSkill = adapted && /^\.agents\/skills\/gerador-de-videos\//.test(file);
    const referenceVideo = adapted && /^REFERENCIAS\/VIDEO REFS\/[^/]+\.mp4$/i.test(file) && entry.purpose === 'future-engine-reference';
    const technicalKnowledge = /^CORE\/knowledge\/.+\.(?:json|md|sql)$/.test(file);
    const checkedPath = adaptedSkill ? file.slice('.agents/'.length) : referenceVideo ? file.replace(/\.mp4$/i, '.reference') : technicalKnowledge ? file.replace('CORE/knowledge/', 'CORE/technical-knowledge/') : file;
    if (forbidden.test(checkedPath)) throw new Error(`Conteúdo privado ou operacional não exportável: ${file}`);
    if (['distribution-receipt.json', 'revisao-local.md'].includes(file.toLowerCase()) || file.split('/').some(p => /[<>"|?*]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Nome reservado no manifesto.');
    const key = file.toLowerCase();
    if (seen.has(key)) throw new Error(`Arquivo duplicado: ${file}`);
    seen.add(key);
    if (entry.decision !== 'include' || !entry.reviewReason?.trim() || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error(`Revisão ausente: ${file}`);
    const absolute = await regularPath(source, sourcePath);
    const bytes = await readFile(absolute);
    if (digest(bytes) !== entry.sha256) throw new Error(`Arquivo mudou desde a revisão: ${file}`);
    if (/\.(?:png|jpg|jpeg|webp|woff2?|ttf|otf)$/i.test(file) && !entry.redistributionEvidence?.trim()) throw new Error(`Asset exige evidência de redistribuição: ${file}`);
    files.push({ entry, bytes });
  }
  const report = { schema: 'mkt-videos/distribution-export@1', mode: write ? 'write' : 'dry-run', purpose, releaseReady: !localReview && manifest.status === 'review-complete', manifestSha256: digest(Buffer.from(JSON.stringify(manifest))), fileCount: files.length, files: files.map(({ entry, bytes }) => ({ path: entry.path, sha256: entry.sha256, bytes: bytes.length })) };
  if (!write) return report;
  // No reuse, overwrite, cleanup, or deletion of an existing destination.
  await mkdir(target);
  for (const { entry, bytes } of files) {
    const output = path.join(target, ...entry.path.split('/'));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: 'wx' });
    if (digest(await readFile(output)) !== entry.sha256) throw new Error(`Verificação de cópia falhou: ${entry.path}`);
  }
  await writeFile(path.join(target, 'distribution-receipt.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  if (localReview) await writeFile(path.join(target, 'REVISAO-LOCAL.md'), '# Cópia local de revisão\n\nPacote incompleto para teste. Não é uma versão pronta para publicação ou entrega. Consulte distribution-receipt.json.\n', { flag: 'wx' });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--write') { options.write = true; continue; }
      if (!['--manifest', '--destination', '--purpose'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --manifest <json> --destination <pasta nova> [--purpose release|local-review] [--write].');
      options[args[i].slice(2)] = args[++i];
    }
    if (!options.manifest || !options.destination) throw new Error('Manifesto e destino são obrigatórios.');
    const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
    console.log(JSON.stringify(await exportDistribution({ sourceRoot: path.resolve(import.meta.dirname, '../..'), manifest, destination: options.destination, write: options.write, purpose: options.purpose }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
