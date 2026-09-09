import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('Windows updater preserves edits and divergence, fast-forwards clean clones and propagates installation failure', { skip: process.platform !== 'win32', timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-update-check-'));
  const remote = path.join(root, 'remote.git');
  const author = path.join(root, 'author');
  const clone = path.join(root, 'recipient clone');
  const execute = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig') } });
    assert.ifError(result.error);
    return result;
  };
  const git = (args, cwd = author) => {
    const result = execute('git', args, cwd);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const identity = cwd => { git(['config', 'user.name', 'Test Developer'], cwd); git(['config', 'user.email', 'test@example.invalid'], cwd); };
  const update = (args = [], cwd = clone) => execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'ATUALIZAR.ps1'), ...args], cwd);
  const installer = "[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'install-count.log'), 'installed' + [Environment]::NewLine)\n";
  try {
    git(['init', '--bare', '--initial-branch=main', remote], root);
    git(['clone', remote, author], root);
    identity(author);
    await copyFile(new URL('../../ATUALIZAR.ps1', import.meta.url), path.join(author, 'ATUALIZAR.ps1'));
    await writeFile(path.join(author, 'INSTALAR.ps1'), installer);
    await writeFile(path.join(author, '.gitignore'), 'install-count.log\noutputs/\n');
    await writeFile(path.join(author, 'code.txt'), 'version-one');
    git(['add', 'ATUALIZAR.ps1', 'INSTALAR.ps1', '.gitignore', 'code.txt']);
    git(['commit', '-m', 'Synthetic initial fixture']);
    git(['push', '-u', 'origin', 'main']);
    git(['clone', remote, clone], root);
    identity(clone);
    await mkdir(path.join(clone, 'outputs'));
    await writeFile(path.join(clone, 'outputs', 'own-work.txt'), 'preserve personal output');
    const initial = git(['rev-parse', 'HEAD'], clone);
    assert.equal(update(['-CheckOnly']).status, 0);
    await assert.rejects(access(path.join(clone, 'install-count.log')));

    await writeFile(path.join(author, 'code.txt'), 'version-two');
    git(['add', 'code.txt']); git(['commit', '-m', 'Synthetic upstream change']); git(['push']);
    assert.equal(update(['-CheckOnly']).status, 0);
    assert.equal(git(['rev-parse', 'HEAD'], clone), initial, 'CheckOnly must not pull');
    await writeFile(path.join(clone, 'code.txt'), 'unfinished local changes');
    assert.notEqual(update().status, 0);
    assert.equal(await readFile(path.join(clone, 'code.txt'), 'utf8'), 'unfinished local changes');
    await assert.rejects(access(path.join(clone, 'install-count.log')));
    // Restore only this synthetic fixture, never a repository working tree.
    await writeFile(path.join(clone, 'code.txt'), 'version-one');
    await writeFile(path.join(clone, 'new-file.txt'), 'untracked work');
    assert.notEqual(update().status, 0);
    assert.equal(await readFile(path.join(clone, 'new-file.txt'), 'utf8'), 'untracked work');
    await rm(path.join(clone, 'new-file.txt'));
    const advanced = update();
    assert.equal(advanced.status, 0, advanced.stderr);
    assert.equal(await readFile(path.join(clone, 'code.txt'), 'utf8'), 'version-two');
    assert.equal(await readFile(path.join(clone, 'outputs', 'own-work.txt'), 'utf8'), 'preserve personal output');
    const installed = await readFile(path.join(clone, 'install-count.log'), 'utf8');
    assert.equal(installed.trim(), 'installed');

    await writeFile(path.join(clone, 'local.txt'), 'local feature');
    git(['add', 'local.txt'], clone); git(['commit', '-m', 'Synthetic recipient feature'], clone);
    const divergentHead = git(['rev-parse', 'HEAD'], clone);
    await writeFile(path.join(author, 'code.txt'), 'version-three');
    git(['add', 'code.txt']); git(['commit', '-m', 'Synthetic divergent upstream']); git(['push']);
    assert.notEqual(update().status, 0);
    assert.equal(git(['rev-parse', 'HEAD'], clone), divergentHead);
    assert.equal(await readFile(path.join(clone, 'local.txt'), 'utf8'), 'local feature');
    assert.equal(await readFile(path.join(clone, 'install-count.log'), 'utf8'), installed);
    git(['branch', '--unset-upstream'], clone);
    assert.notEqual(update(['-CheckOnly']).status, 0);

    const failureClone = path.join(root, 'installation failure');
    await writeFile(path.join(author, 'INSTALAR.ps1'), "throw 'Synthetic installation failure'\n");
    git(['add', 'INSTALAR.ps1']); git(['commit', '-m', 'Synthetic installer failure']); git(['push']);
    git(['clone', remote, failureClone], root);
    const failed = update([], failureClone);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Synthetic installation failure/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('studio-update-check-'));
    await rm(root, { recursive: true, force: true });
  }
});
