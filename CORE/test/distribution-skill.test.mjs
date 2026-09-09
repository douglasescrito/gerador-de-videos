import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

test('neutral skill routes to existing references and does not teach obsolete execution flags', async () => {
  const root = path.resolve(import.meta.dirname, '../../.agents/skills/gerador-de-videos');
  const main = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(main, /^---\r?\nname: gerador-de-videos\r?\ndescription: .+\r?\n---/);
  const references = [...main.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]);
  assert.equal(references.length, 4);
  for (const file of ['SKILL.md', ...references]) {
    await access(path.join(root, file));
    const body = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(body, /douglas|dougl\b|faculdade.focus|C:[\\/]+Users[\\/]|data:image\/[^;]+;base64,/i);
    const commands = [...body.matchAll(/^npm .+$/gm)].map(match => match[0]);
    for (const command of commands) assert.doesNotMatch(command, /--recipe\b|--production-id\b|--reference\b|--confirm-paid\b|--auth api\b/);
  }
});
