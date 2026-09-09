import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Machine paths only. Accounts, persons and projects remain in their existing stores.
export function studioLocalConfigFile(env = process.env) {
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'GeradorDeVideos', 'installation.json');
}
export function studioLocalPath(key, env = process.env) {
  const names = { referenceRoot: 'STUDIO_REFERENCE_ROOT', gcpCli: 'STUDIO_GCP_CLI', chromePath: 'CHROME_PATH', whisperCommand: 'WHISPER_COMMAND', commercialLogo: 'STUDIO_COMMERCIAL_LOGO', grokClient: 'STUDIO_GROK_CLIENT' };
  if (!Object.hasOwn(names, key)) throw new Error('Configuração local desconhecida.');
  let value = env[names[key]];
  if (!value) {
    try { value = JSON.parse(readFileSync(studioLocalConfigFile(env), 'utf8'))[key]; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Configuração local inválida: revise installation.json.'); }
  }
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`Configuração ${key} exige caminho absoluto.`);
  return path.normalize(value);
}
