import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from 'node:url';

const sfxDir = path.resolve(import.meta.dirname, "../../assets/sfx");

const presets = {
  boom: 'aevalsrc=exprs=\'sin(400*t)\':d=0.5,afade=t=out:st=0:d=0.5',
  whoosh: 'anoisesrc=d=1.5:c=white,lowpass=f=1000,afade=t=in:ss=0:d=0.2,afade=t=out:st=1.0:d=0.5',
  glitch: 'anoisesrc=d=0.5:c=pink',
  glass: 'anoisesrc=d=0.3:c=white,highpass=f=8000,afade=t=out:st=0:d=0.3',
  tick: 'aevalsrc=exprs=\'sin(1000*t)\':d=0.05,afade=t=out:st=0:d=0.05'
};

async function generate(directory, name, filter) {
  const out = path.join(directory, `${name}.wav`);
  try { await access(out); return out; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-n",
      "-f", "lavfi", "-i", filter,
      "-ar", "48000", "-ac", "2",
      out
    ], { stdio: "inherit", windowsHide: true });
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`Failed to generate ${name}, code ${code}`));
    });
    child.on("error", reject);
  });
}

export async function ensureSyntheticSfxLibrary({ directory = sfxDir } = {}) {
  directory = path.resolve(directory);
  await mkdir(directory, { recursive: true });
  const files = [];
  for (const [name, filter] of Object.entries(presets)) {
    files.push(await generate(directory, name, filter));
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  ensureSyntheticSfxLibrary().then(files => console.log(JSON.stringify({ files }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
