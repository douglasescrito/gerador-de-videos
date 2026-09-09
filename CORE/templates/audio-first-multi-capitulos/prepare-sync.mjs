import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Compatibility entry point: preparation belongs to the existing CLI.
const cli = fileURLToPath(new URL('../../scripts/omni-cli.mjs', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'sync-batch', ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
