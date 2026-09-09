import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exportDistribution } from '../scripts/distribution-export.mjs';

test('export copies reviewed working bytes only, defaults to dry-run and refuses stale or private entries', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-export-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  const source = path.join(root, 'origem'), destination = path.join(root, 'cópia limpa');
  await mkdir(source); await writeFile(path.join(source, 'hello.mjs'), 'export const value = 1;');
  await writeFile(path.join(source, 'personal.txt'), 'must never leave');
  const entry = { path: 'hello.mjs', decision: 'include', reviewReason: 'Neutral technical fixture', sha256: createHash('sha256').update('export const value = 1;').digest('hex') };
  const manifest = { schema: 'mkt-videos/distribution-manifest@1', status: 'review-complete', files: [entry] };
  const args = { sourceRoot: source, manifest, destination };
  assert.equal((await exportDistribution(args)).mode, 'dry-run');
  await assert.rejects(access(destination), { code: 'ENOENT' });
  await assert.rejects(exportDistribution({ ...args, manifest: { ...manifest, status: 'pending' } }), /revisão completa/);
  const reviewDestination = path.join(root, 'local-review');
  const reviewManifest = { ...manifest, status: 'review-in-progress' };
  await assert.rejects(exportDistribution({ ...args, manifest: reviewManifest }), /revisão completa/);
  const review = await exportDistribution({ ...args, manifest: reviewManifest, destination: reviewDestination, purpose: 'local-review', write: true });
  assert.equal(review.releaseReady, false);
  assert.match(await readFile(path.join(reviewDestination, 'REVISAO-LOCAL.md'), 'utf8'), /Pacote incompleto/);
  await assert.rejects(exportDistribution({ ...args, manifest: { ...reviewManifest, files: [{ ...entry, path: 'CORE/outputs/private.txt' }] }, purpose: 'local-review' }), /não exportável/);
  for (const file of ['../escape', '.git/config', 'CORE/outputs/a.txt', 'PESSOAS/person.png', 'account.har', 'account.sqlite', 'CON.txt', 'distribution-receipt.json']) {
    await assert.rejects(exportDistribution({ ...args, manifest: { ...manifest, files: [{ ...entry, path: file }] } }));
  }
  for (const file of ['CORE/app/editor/legacy-editor-content.mjs', 'CORE/lib/media-pipeline/legacy-commercial-brand.mjs', 'CORE/scripts/legacy-output-rules.mjs']) {
    await assert.rejects(exportDistribution({ ...args, manifest: { ...manifest, files: [{ ...entry, path: file }] } }), /não exportável/);
  }
  await assert.rejects(exportDistribution({ ...args, manifest: { ...manifest, files: [{ ...entry, sha256: '0'.repeat(64) }] } }), /mudou/);
  await mkdir(path.join(source, 'CORE/knowledge'), { recursive: true });
  await writeFile(path.join(source, 'CORE/knowledge/ontology.json'), '{}');
  const knowledgeEntry = { ...entry, path: 'CORE/knowledge/ontology.json', sha256: createHash('sha256').update('{}').digest('hex') };
  assert.equal((await exportDistribution({ ...args, manifest: { ...manifest, files: [knowledgeEntry] } })).fileCount, 1);
  await assert.rejects(exportDistribution({ ...args, manifest: { ...manifest, files: [{ ...knowledgeEntry, path: 'CORE/knowledge/private.sqlite' }] } }), /não exportável/);
  const report = await exportDistribution({ ...args, write: true });
  assert.equal(report.fileCount, 1);
  assert.equal(await readFile(path.join(destination, 'hello.mjs'), 'utf8'), 'export const value = 1;');
  await assert.rejects(access(path.join(destination, 'personal.txt')), { code: 'ENOENT' });
  await assert.rejects(exportDistribution({ ...args, write: true }), /já existe/);
  await assert.rejects(exportDistribution({ ...args, destination: path.join(source, 'nested') }), /fora da origem/);
  const linked = path.join(root, 'linked-source');
  await symlink(source, linked, 'junction');
  await assert.rejects(exportDistribution({ ...args, destination: path.join(linked, 'nested') }), /fora da origem/);
});

test('skill export uses only the reviewed neutral overlay, never the author skill', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-skill-export-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  const sourceRoot = path.join(root, 'source'), destination = path.join(root, 'release');
  const skill = '.agents/skills/gerador-de-videos/SKILL.md';
  const sourcePath = `CORE/distribution/public/${skill}`;
  for (const file of [skill, sourcePath]) await mkdir(path.dirname(path.join(sourceRoot, file)), { recursive: true });
  await writeFile(path.join(sourceRoot, skill), 'private author instructions');
  const neutral = '---\nname: gerador-de-videos\ndescription: Local studio workflow.\n---\nNeutral instructions.';
  await writeFile(path.join(sourceRoot, sourcePath), neutral);
  const entry = { path: skill, sourcePath, decision: 'include', reviewReason: 'Neutral adapted skill', sha256: createHash('sha256').update(neutral).digest('hex') };
  const manifest = { schema: 'mkt-videos/distribution-manifest@1', status: 'review-complete', files: [entry] };
  await assert.rejects(exportDistribution({ sourceRoot, destination, manifest: { ...manifest, files: [{ ...entry, sourcePath: skill }] } }), /não exportável/);
  await assert.rejects(exportDistribution({ sourceRoot, destination, manifest: { ...manifest, files: [{ ...entry, sourcePath: '../other' }] } }), /Origem adaptada/);
  await exportDistribution({ sourceRoot, destination, manifest, write: true });
  assert.equal(await readFile(path.join(destination, skill), 'utf8'), neutral);
});

test('video exception is restricted to the explicitly selected future-engine reference collection', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-reference-export-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  const sourceRoot = path.join(root, 'source'), destination = path.join(root, 'release');
  const file = 'REFERENCIAS/VIDEO REFS/reference.mp4';
  const sourcePath = `CORE/distribution/public/${file}`;
  await mkdir(path.dirname(path.join(sourceRoot, sourcePath)), { recursive: true });
  const bytes = Buffer.from('reference fixture');
  await writeFile(path.join(sourceRoot, sourcePath), bytes);
  const entry = { path: file, sourcePath, decision: 'include', purpose: 'future-engine-reference', reviewReason: 'Explicitly selected reference collection', sha256: createHash('sha256').update(bytes).digest('hex') };
  const manifest = { schema: 'mkt-videos/distribution-manifest@1', status: 'review-complete', files: [entry] };
  await assert.rejects(exportDistribution({ sourceRoot, destination, manifest: { ...manifest, files: [{ ...entry, purpose: undefined }] } }), /não exportável/);
  await assert.rejects(exportDistribution({ sourceRoot, destination, manifest: { ...manifest, files: [{ ...entry, path: 'CORE/outputs/production.mp4', sourcePath: 'CORE/distribution/public/CORE/outputs/production.mp4' }] } }), /não exportável/);
  await exportDistribution({ sourceRoot, destination, manifest, write: true });
  assert.deepEqual(await readFile(path.join(destination, file)), bytes);
});
