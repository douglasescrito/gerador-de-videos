import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Legacy authored pieces may be omitted from a distribution. This loader never
// searches outside this module directory or substitutes a different template.
const names = Object.freeze(['adp-explainer', 'focus-motion-zak', 'nano-banana-motion']);
const loaded = new Map();
for (const name of names) {
  const url = new URL(`./${name}.mjs`, import.meta.url);
  let info;
  try { info = await lstat(url); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Template opcional deve ser arquivo regular local.');
  // Syntax errors and missing dependencies are real failures, not absence.
  loaded.set(name, { module: await import(url.href), file: fileURLToPath(url) });
}

export function requireOptionalMotionTemplate(name) {
  if (!names.includes(name)) throw new Error('Template opcional desconhecido.');
  const entry = loaded.get(name);
  if (!entry) throw new Error(`Template ${name} não acompanha esta instalação. Escolha um preset disponível ou forneça sua própria composição ao motor local.`);
  return entry.module;
}

export function optionalMotionBindingFiles() {
  return [fileURLToPath(import.meta.url), ...[...loaded.values()].map(entry => entry.file)];
}
