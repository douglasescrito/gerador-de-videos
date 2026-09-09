import fs from 'node:fs';
import path from 'node:path';

const FINAL_ROLES = new Set(['final-master', 'delivery-video', 'mastered-video', 'motion-master']);
const documentosEmCache = new Map();
const normalizar = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

function lerDocumento(file) {
  try {
    const stat = fs.statSync(file);
    const hit = documentosEmCache.get(file);
    if (hit?.size === stat.size && hit.mtime === stat.mtimeMs) return hit.doc;
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    // O índice guarda apenas as relações entre arquivos, nunca prompts ou receitas integrais.
    const ref = (a) => typeof a === 'string' ? { file: a } : { file: a?.file, role: a?.role, bytes: a?.bytes };
    const doc = { schema: r.schema, status: r.status, completedAt: r.completedAt, finalFile: r.finalFile,
      artifacts: Array.isArray(r.artifacts) ? r.artifacts.map(ref) : [],
      inputs: Array.isArray(r.inputs) ? r.inputs.map(ref) : [],
      parts: Array.isArray(r.parts) ? r.parts.map(ref) : [] };
    documentosEmCache.set(file, { size: stat.size, mtime: stat.mtimeMs, doc });
    return doc;
  } catch { return null; }
}

export function classificarEntrega(video, { finals = [], inputs = [], conflicts = [] } = {}) {
  const rel = video.relPath.toLowerCase().replaceAll('\\', '/');
  const name = path.posix.basename(rel);
  const temporario = rel.split('/').some(p => /^(?:_pecas|_tmp|tmp|temp|scratch)$/.test(p)) || name.startsWith('.') || /(?:^|[-_])(?:preview|previa|parcial|partial|draft|rascunho)(?:[-_.]|$)/.test(name);
  const cena = /(?:^|[-_])(?:cena|scene|segmento|segment|take)[-_]?\d+(?:[-_.]|$)/.test(name);
  const teste = video.source === 'diagnosticos' || rel.split('/').some(p => /^test(?:[-_]|$)/.test(p));
  const result = (status, reason, evidence = null) => ({ status, reason, evidence, includeInFinals: status !== 'component' });
  if (temporario) return result('component', 'Nome ou pasta identifica um arquivo temporário, prévia ou trecho de montagem.');
  const finalExplicito = finals.some(e => e.basis?.startsWith('Papel do artefato:'));
  const finalizacaoPosterior = inputs.find(e => e.basis === 'Entrada de uma finalização registrada.');
  if (!finalExplicito && finalizacaoPosterior) return result('component', 'A montagem foi usada como entrada de uma finalização posterior; não há registro desta versão como entrega final.', finalizacaoPosterior);
  if (finals.length && !cena && !teste) return result('final', 'Este arquivo é indicado como saída final em recibo concluído ou manifesto da coleção.', finals[0]);
  if (finals.length) return result('candidate', 'Existe registro de saída final, mas o nome ou a origem também indica cena ou teste. Mantido para conferência.', finals[0]);
  if (conflicts.length) return result('candidate', 'O registro encontrado não corresponde ao tamanho atual do arquivo. Mantido sem confirmar a entrega.', conflicts[0]);
  if (inputs.length) return result('component', 'Este arquivo está registrado como entrada de outra montagem ou finalização.', inputs[0]);
  if (cena) return result('component', 'O nome identifica uma cena ou segmento numerado, sem registro de entrega final.');
  if (teste) return result('component', 'Arquivo identificado como teste ou diagnóstico, sem registro de entrega final.');
  if (video.isMaster) return result('candidate', 'O nome ou a pasta sugere um vídeo final, mas não há registro suficiente para confirmar.');
  return result('candidate', 'Sem evidência suficiente para distinguir entrega antiga de clipe avulso. Mantido para não ocultar possíveis finais.');
}

/** Projeção read-only: não altera arquivos, receitas, recibos nem decisões editoriais. */
export function mapearEntregas(catalogo, fontes) {
  const fontesPorId = new Map(fontes.map(f => [f.id, f]));
  const videosPorArquivo = new Map();
  const relacoes = new Map();
  const documentos = new Map();
  const pastasVisitadas = new Set();
  for (const video of catalogo.videos) {
    const fonte = fontesPorId.get(video.source);
    if (!fonte) continue;
    const absoluto = path.resolve(fonte.root, video.relPath);
    videosPorArquivo.set(normalizar(absoluto), video);
    documentos.set(absoluto + '.receipt.json', fonte);
    let pasta = path.dirname(absoluto);
    const raiz = normalizar(fonte.root);
    while (normalizar(pasta) === raiz || normalizar(pasta).startsWith(raiz + path.sep)) {
      if (!pastasVisitadas.has(pasta)) {
        pastasVisitadas.add(pasta);
        documentos.set(path.join(pasta, 'manifest.json'), fonte);
        try {
          for (const f of fs.readdirSync(path.join(pasta, 'receitas'), { withFileTypes: true })) {
            if (f.isFile() && /\.receipt\.json$/i.test(f.name)) documentos.set(path.join(pasta, 'receitas', f.name), fonte);
          }
        } catch { /* coleção legada sem diretório de recibos */ }
      }
      if (normalizar(pasta) === raiz) break;
      pasta = path.dirname(pasta);
    }
  }
  function registrar(video, tipo, documento, motivo) {
    if (!relacoes.has(video)) relacoes.set(video, { finals: [], inputs: [], conflicts: [] });
    relacoes.get(video)[tipo].push({ document: documento, basis: motivo });
  }
  for (const [documento, fonte] of documentos) {
    const doc = lerDocumento(documento);
    if (!doc) continue;
    const referencia = (ref) => {
      if (typeof ref?.file !== 'string' || !/\.mp4$/i.test(ref.file)) return null;
      const candidatos = path.isAbsolute(ref.file) ? [ref.file] : [path.resolve(path.dirname(documento), ref.file), path.resolve(fonte.root, ref.file), path.resolve(path.dirname(fonte.root), ref.file)];
      const hits = new Set(candidatos.map(f => videosPorArquivo.get(normalizar(f))).filter(v => v?.source === fonte.id));
      return hits.size === 1 ? [...hits][0] : null;
    };
    const prova = path.relative(fonte.root, documento).replaceAll('\\', '/');
    const valido = (ref, video) => ref.bytes == null || ref.bytes === video.sizeBytes;
    if (doc.status === 'completed') {
      const saidas = doc.artifacts.map(ref => ({ ref, video: referencia(ref) })).filter(v => v.video && valido(v.ref, v.video));
      for (const ref of doc.artifacts) {
        const video = referencia(ref);
        if (!video || !FINAL_ROLES.has(ref.role)) continue;
        registrar(video, valido(ref, video) ? 'finals' : 'conflicts', prova, `Papel do artefato: ${ref.role}`);
      }
      if (saidas.length) for (const ref of doc.inputs) {
        const video = referencia(ref);
        if (video && valido(ref, video) && !saidas.some(s => s.video === video)) registrar(video, 'inputs', prova, saidas.some(s => FINAL_ROLES.has(s.ref.role)) ? 'Entrada de uma finalização registrada.' : 'Entrada de uma saída de vídeo registrada.');
      }
    }
    const colecao = doc.schema === 'mkt-videos/collection-manifest@1' || (doc.schema === 'mkt-videos/collection-assembly@1' && doc.completedAt);
    if (colecao) {
      const final = referencia({ file: doc.finalFile });
      if (!final) continue; // Manifesto obsoleto não pode classificar arquivos por semelhança.
      registrar(final, 'finals', prova, 'Caminho finalFile do registro de coleção.');
      for (const ref of doc.parts) {
        const video = referencia(ref);
        if (video && video !== final) registrar(video, 'inputs', prova, 'Parte de uma coleção com saída final existente.');
      }
    }
  }
  const resumo = { final: 0, candidate: 0, component: 0 };
  const finaisPorColecao = new Map();
  for (const video of catalogo.videos) {
    video.delivery = classificarEntrega(video, relacoes.get(video));
    video.isMaster = video.delivery.status === 'final';
    resumo[video.delivery.status]++;
    if (video.isMaster) finaisPorColecao.set(video.collectionId, (finaisPorColecao.get(video.collectionId) || 0) + 1);
  }
  for (const colecao of catalogo.collections) colecao.masters = finaisPorColecao.get(colecao.id) || 0;
  for (const file of documentosEmCache.keys()) if (!documentos.has(file)) documentosEmCache.delete(file);
  catalogo.stats.masters = resumo.final;
  catalogo.stats.deliveries = resumo;
  return resumo;
}
