import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { runWhisperBackend } from '../lib/media-pipeline/whisper-backends.mjs';

test('optional faster-whisper backend reaches the packaged Python driver and normalizes its word output', async t => {
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const prefix = process.platform === 'win32' ? ['-3.11'] : [];
  const probe = spawnSync(python, [...prefix, '--version'], { windowsHide: true });
  if (probe.error || probe.status !== 0) { t.skip('Optional Python interpreter unavailable; driver integration not exercised'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'faster-driver-check-'));
  try {
    const audio = path.join(root, 'synthetic input.wav');
    await writeFile(audio, 'synthetic adapter fixture; no audio decoding');
    // Fake only the optional ML package; execute the actual driver via the actual
    // JS backend dispatch, without downloading models or calling a provider.
    await writeFile(path.join(root, 'faster_whisper.py'), `from types import SimpleNamespace as S
class WhisperModel:
    def __init__(self, model, device, compute_type):
        assert (model, device, compute_type) == ('synthetic-model', 'cpu', 'float32')
    def transcribe(self, audio, language, word_timestamps, beam_size):
        assert language == 'pt' and word_timestamps is True and beam_size == 5
        with open(audio, 'r') as stream:
            assert 'synthetic adapter fixture' in stream.read()
        word = S(word=' teste', start=0.12349, end=0.87654, probability=0.98765)
        return iter([S(text=' teste', start=0.12349, end=0.87654, words=[word])]), S()
`);
    let calls = 0;
    const workDir = path.join(root, 'measurement');
    const result = await runWhisperBackend({
      backend: 'faster-whisper', audioFile: audio, workDir,
      model: 'synthetic-model', language: 'pt', device: 'cpu', pythonCommand: python,
      runCommandImpl: async (command, args) => {
        calls++;
        assert.equal(command, python);
        assert.equal(path.basename(args[0]), 'faster-whisper-words.py');
        const child = spawnSync(command, [...prefix, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, PYTHONPATH: root, PYTHONDONTWRITEBYTECODE: '1' } });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        return { stdout: child.stdout };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.backend, 'faster-whisper');
    assert.equal(result.transcript, 'teste');
    assert.deepEqual(result.words, [{ word: ' teste', start: 0.123, end: 0.877, probability: 0.9877 }]);
    assert.equal((await readdir(workDir)).length, 1, 'No partial measurement files remain');
    assert.match(await readFile(audio, 'utf8'), /synthetic adapter fixture/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('faster-driver-check-'));
    await rm(root, { recursive: true, force: true });
  }
});
