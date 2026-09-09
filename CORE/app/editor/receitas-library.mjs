import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { discoverJsonFiles, PADRAO_RECEITA } from '../../lib/media-pipeline/recipe-shelf.mjs';
import { summaryOf } from './receitas-model.js';
import { organizationSummary } from './receitas-organization.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const LIMIT = 2 * 1024 * 1024;
let validator;
async function check(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return { valid: false, message: 'A receita deve ser um objeto JSON.' };
  try {
    validator ||= import('../../lib/media-pipeline/recipe-validation.mjs');
    (await validator).validarDocumentoReceita(document);
    return { valid: true, message: 'Estrutura válida para este formato.' };
  } catch (error) { return { valid: false, message: String(error.message).slice(0, 1800) }; }
}
function slug(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/g, '') || 'receita';
}

export function createRecipeLibrary({ recipesDir }) {
  const root = path.resolve(recipesDir);
  const summaries = new Map();
  let listing;
  let saveQueue = Promise.resolve();
  async function resolveFile(file) {
    if (typeof file !== 'string' || !file || file.includes('\0') || file.includes('\\') || path.isAbsolute(file) || file.split('/').some(p => !p || p === '..' || p === '.')) throw fail('Caminho de receita inválido.');
    if (!PADRAO_RECEITA.test(file) && !(file.startsWith('derivadas/') && file.endsWith('.rascunho.json'))) throw fail('Arquivo fora da biblioteca de receitas.');
    const absolute = path.resolve(root, file);
    let realRoot, real;
    try { [realRoot, real] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]); } catch { throw fail('Receita não encontrada.', 404); }
    const rel = path.relative(realRoot, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail('Receita fora da pasta permitida.');
    return absolute;
  }
  async function read(file) {
    const absolute = await resolveFile(file);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > LIMIT) throw fail('A receita excede o limite de 2 MB.');
    const bytes = await fs.readFile(absolute);
    let document;
    try { document = JSON.parse(bytes); } catch { throw fail('O arquivo não contém JSON válido.'); }
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw fail('A receita deve conter um objeto JSON.');
    let lineage = null;
    if (file.startsWith('derivadas/')) {
      try { lineage = JSON.parse(await fs.readFile(absolute + '.origem.json', 'utf8')); } catch { /* versão anterior sem vínculo */ }
    }
    return { file, hash: sha(bytes), modifiedAt: stat.mtime.toISOString(), document, lineage, validation: await check(document), ...summaryOf(document, file), organization: organizationSummary(document) };
  }
  async function list() {
    if (listing) return listing;
    listing = (async () => {
      const files = (await discoverJsonFiles(root)).filter(f => PADRAO_RECEITA.test(f.relativeFile) || (f.relativeFile.startsWith('derivadas/') && f.relativeFile.endsWith('.rascunho.json')));
      const items = [];
      // Um erro isolado continua visível na lista e não esconde as outras receitas.
      for (const file of files) {
        try {
          const stat = await fs.stat(file.absoluteFile);
          const stamp = `${stat.size}:${stat.mtimeMs}`;
          let cached = summaries.get(file.relativeFile);
          if (cached?.stamp !== stamp) {
            const { document, lineage, ...item } = await read(file.relativeFile);
            cached = { stamp, item: { ...item, origin: lineage?.source?.file || null } };
            summaries.set(file.relativeFile, cached);
          }
          items.push(cached.item);
        } catch (error) { items.push({ file: file.relativeFile, title: file.relativeFile, family: 'Revisar arquivo', validation: { valid: false, message: error.message } }); }
      }
      const alive = new Set(files.map(f => f.relativeFile));
      for (const key of summaries.keys()) if (!alive.has(key)) summaries.delete(key);
      return { items, total: items.length };
    })().finally(() => { listing = null; });
    return listing;
  }
  async function atomicNew(file, body) {
    const temp = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, body, { flag: 'wx' }); await fs.link(temp, file); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async function derive(input) {
    if (!input || typeof input.name !== 'string' || input.name.trim().length < 3 || input.name.length > 160) throw fail('Dê um nome de 3 a 160 caracteres à derivação.');
    if (!/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw fail('Identificador de salvamento inválido.');
    if (typeof input.document !== 'object' || !input.document || Array.isArray(input.document)) throw fail('A receita deve conter um objeto JSON.');
    const original = await read(input.sourceFile);
    if (original.hash !== input.sourceHash) throw fail('A receita de origem mudou no disco. Reabra a origem antes de salvar esta derivação.', 409);
    const doc = structuredClone(input.document);
    if (doc.schema !== original.document.schema) throw fail('Uma derivação deve manter o formato da receita de origem.');
    const id = `${slug(input.name)}-${input.requestId.slice(0, 8)}`;
    if (doc.schema === 'gerador-de-videos/receita@2') {
      doc.identity = { ...doc.identity, id, name: input.name.trim(), revision: 1 };
    } else {
      doc.id = id; doc.label = input.name.trim();
      if (Object.hasOwn(doc, 'collection')) doc.collection = id;
    }
    const body = JSON.stringify(doc, null, 2) + '\n';
    if (Buffer.byteLength(body) > LIMIT) throw fail('A receita excede o limite de 2 MB.', 413);
    const validation = await check(doc);
    if (!validation.valid && input.draft !== true) throw fail(validation.message, 422);
    const folder = path.join(root, 'derivadas');
    await fs.mkdir(folder, { recursive: true });
    const rel = path.relative(await fs.realpath(root), await fs.realpath(folder));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail('Destino de derivações fora da biblioteca.');
    const file = `derivadas/${id}${input.draft === true ? '.rascunho.json' : '.receita.json'}`;
    const absolute = path.join(root, file);
    const fingerprint = sha(JSON.stringify({ source: original.file, hash: original.hash, document: doc, draft: input.draft === true }));
    const lineageFile = absolute + '.origem.json';
    const lineage = { schema: 'gerador-de-videos/recipe-derivation@1', savedAt: new Date().toISOString(), requestId: input.requestId,
      source: { file: original.file, hash: original.hash }, documentHash: sha(body), fingerprint, draft: input.draft === true };
    try { await atomicNew(lineageFile, JSON.stringify(lineage, null, 2) + '\n'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const existing = JSON.parse(await fs.readFile(lineageFile, 'utf8'));
      if (existing.fingerprint !== fingerprint) throw fail('Este salvamento já foi usado para outro conteúdo.', 409);
    }
    try { await atomicNew(absolute, body); }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (sha(await fs.readFile(absolute)) !== sha(body)) throw fail('Arquivo existente com conteúdo diferente.', 409); }
    summaries.delete(file);
    const saved = await read(file);
    if (saved.hash !== sha(body)) throw fail('Não foi possível conferir o arquivo salvo.', 500);
    return saved;
  }
  return { list, read, validate: check, derive: input => {
    const job = saveQueue.then(() => derive(input));
    saveQueue = job.catch(() => {});
    return job;
  } };
}
