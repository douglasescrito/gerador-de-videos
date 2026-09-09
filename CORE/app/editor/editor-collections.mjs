import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { probeMedia } from '../../lib/media-pipeline/media-tools.mjs';

// Read-only projection of collection media, not a project store or planner.
export async function discoverEditorCollections(coreDir, { probe = probeMedia } = {}) {
  const outputRoot = path.join(coreDir, 'outputs');
  const projects = [];
  const relative = file => path.relative(coreDir, file).replaceAll('\\', '/');
  async function entries(directory) {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return [];
      return await readdir(directory, { withFileTypes: true });
    }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function regular(file) {
    try {
      const parent = await lstat(path.dirname(file));
      if (!parent.isDirectory() || parent.isSymbolicLink()) return null;
      const info = await lstat(file); return info.isFile() && !info.isSymbolicLink() ? relative(file) : null;
    }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function visit(directory) {
    const children = await entries(directory);
    if (children.some(entry => entry.name === 'videos-soltos' && entry.isDirectory() && !entry.isSymbolicLink())) {
      const clips = (await entries(path.join(directory, 'videos-soltos'))).filter(entry => entry.isFile() && !entry.isSymbolicLink() && /\.mp4$/i.test(entry.name) && entry.name !== 'video-unido-raw.mp4').sort((a, b) => a.name.localeCompare(b.name));
      const scenes = [];
      for (const clip of clips) {
        const file = path.join(directory, 'videos-soltos', clip.name);
        let duration = null;
        try { const info = await probe(file); if (Number(info.duration) > 0) duration = Number(info.duration); } catch { /* Unmeasured media stays explicit. */ }
        scenes.push({ id: clip.name.slice(0, -4), name: clip.name.slice(0, -4), relPath: relative(file), duration });
      }
      const masters = (await entries(path.join(directory, 'videos-unidos'))).filter(entry => entry.isFile() && !entry.isSymbolicLink() && /\.mp4$/i.test(entry.name));
      const raw = await regular(path.join(directory, 'videos-soltos', 'video-unido-raw.mp4'));
      if (scenes.length || raw || masters.length) {
        const folder = relative(directory);
        projects.push({ id: `collection:${folder}`, batch: 'colecoes', name: path.basename(directory), fullName: path.relative(outputRoot, directory), folderRel: folder,
          masterRel: masters.length === 1 ? relative(path.join(directory, 'videos-unidos', masters[0].name)) : null,
          scenes, audioVoice: await regular(path.join(directory, 'audios-soltos', 'voz.wav')), audioMusic: await regular(path.join(directory, 'audios-soltos', 'trilha.wav')), videoRawRel: raw, whisperWords: [] });
      }
      return;
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.isDirectory() && !child.isSymbolicLink() && !child.name.startsWith('.')) await visit(path.join(directory, child.name));
    }
  }
  await visit(outputRoot);
  return projects;
}
