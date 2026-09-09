import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const core = path.resolve(import.meta.dirname, '..');
const script = path.join(core, 'scripts/AudioWaveStudio.ps1');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  assert.ifError(result.error);
  return result;
};
const ps = args => run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ...args]);
test('Audio Wave validates relocated inputs and exports through the real Studio mixer', { skip: process.platform !== 'win32', timeout: 120000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'audio-wave-review-'));
  try {
    const voice = path.join(temp, "voice 'literal' & space.wav");
    const music = path.join(temp, 'music.wav');
    const output = path.join(temp, 'masters');
    for (const [file, hz, seconds] of [[voice, 440, 1], [music, 660, 2]]) {
      const made = run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, '-c:a', 'pcm_s16le', file]);
      assert.equal(made.status, 0, made.stderr);
    }
    const checked = ps([script, '-Voice', voice, '-Music', music, '-OutputDirectory', output, '-CheckOnly']);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).durationSeconds, 2);
    assert.equal(JSON.parse(checked.stdout).createsMedia, false);
    assert.equal((await readdir(temp)).includes('masters'), false);
    const invalid = ps([script, '-Voice', path.join(temp, 'missing.wav'), '-Music', music, '-CheckOnly']);
    assert.notEqual(invalid.status, 0);

    // Exercise the actual WPF controls and click handler without showing a window
    // or modal dialogs. Only location, diagnostics destination and presentation
    // calls change; the mixer arguments, validation and export code stay intact.
    let harness = await readFile(script, 'utf8');
    const literal = value => `'${value.replaceAll("'", "''")}'`;
    harness = harness.replace('$coreDir = Split-Path $PSScriptRoot -Parent', `$coreDir = ${literal(core)}`);
    harness = harness.replace(/\$waveDir = Join-Path \$coreDir [^\r\n]+/, `$waveDir = ${literal(path.join(temp, 'waveforms'))}`);
    harness = harness.replace(/\[System\.Windows\.MessageBox\]::Show\([^\r\n]+\) \| Out-Null/g, 'Write-Output $TxtStatus.Text');
    harness = harness.replace('$window.ShowDialog() | Out-Null', `
$SliderMasterGain.Value = -3
$script:muteVoice = $true
$BtnExport.RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Button]::ClickEvent)))
if ($TxtStatus.Text -notlike 'WAV exportado*') { throw $TxtStatus.Text }
if (-not $ImgWaveVoice.Source -or -not $ImgWaveMusic.Source -or -not $ImgWaveMaster.Source) { throw 'Waveform ausente' }
$window.Close()
`);
    const harnessFile = path.join(temp, 'window-check.ps1');
    await writeFile(harnessFile, harness, 'utf8');
    const exported = ps([harnessFile, '-Voice', voice, '-Music', music, '-OutputDirectory', output]);
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    const files = await readdir(output);
    const masters = files.filter(f => f.endsWith('.wav'));
    assert.equal(masters.length, 1);
    const receipts = files.filter(f => f.endsWith('.json'));
    assert.ok(receipts.length >= 1, 'Canonical mixer must publish a receipt');
    const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(output, masters[0])]);
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(Math.abs(Number(JSON.parse(probe.stdout).format.duration) - 2) < 0.05);
    const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(output, masters[0]), '-t', '1', '-ar', '8000', '-ac', '1', '-f', 'f32le', 'pipe:1'], { windowsHide: true, timeout: 10000 });
    assert.equal(pcm.status, 0);
    const magnitude = hz => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < pcm.stdout.length / 4; i++) {
        const sample = pcm.stdout.readFloatLE(i * 4);
        real += sample * Math.cos(2 * Math.PI * hz * i / 8000);
        imaginary += sample * Math.sin(2 * Math.PI * hz * i / 8000);
      }
      return Math.hypot(real, imaginary);
    };
    assert.ok(magnitude(660) > 100, 'Music must be physically present');
    assert.ok(magnitude(440) < magnitude(660) * 0.01, 'Muted voice must be physically absent');
    const waveformFiles = await readdir(path.join(temp, 'waveforms'));
    assert.equal(waveformFiles.filter(f => f.endsWith('.png')).length, 3);
  } finally {
    assert.ok(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('audio-wave-review-'));
    await rm(temp, { recursive: true, force: true });
  }
});
