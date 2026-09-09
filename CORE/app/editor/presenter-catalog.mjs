import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Discovery is not an authorization to send an image to a provider.
export async function listPresenterReferences(coreDir) {
  try {
    return (await readdir(path.resolve(coreDir, '..', 'PESSOAS'), { withFileTypes: true }))
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && /\.(png|jpe?g|webp)$/i.test(entry.name))
      .map(entry => ({ file: entry.name, label: entry.name.replace(/\.[^.]+$/, '') }))
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
