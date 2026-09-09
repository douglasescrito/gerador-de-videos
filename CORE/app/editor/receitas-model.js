// Projeções de apresentação. A validação e a execução continuam no núcleo existente.
export const SCHEMAS = {
  'gerador-de-videos/receita@1': 'Cenas e clipes',
  'gerador-de-videos/receita@2': 'Receita Mestre',
  'gerador-de-videos/receita-sincronia-imagem@1': 'Narração sincronizada',
};
export const cleanName = s => String(s || '').replace(/\.receita[^/]*\.json$|\.rascunho\.json$/i, '').replace(/[-_]+/g, ' ');
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const textValue = value => ['string', 'number'].includes(typeof value) ? String(value) : '';
export const titleOf = r => textValue(r.identity?.name) || textValue(r.label) || textValue(r.name) || textValue(r.id) || 'Receita sem título';
export function fpsOf(r) {
  const fps = r.format?.master?.fps;
  return fps?.numerator > 0 && fps?.denominator > 0 ? fps.numerator / fps.denominator : Number(r.assembly?.fps) || 24;
}
export function scenesOf(r) {
  if (Array.isArray(r.scenes)) return r.scenes.map((value, i) => { const s = record(value); return { id: s.id || `cena-${i + 1}`, name: s.label || s.name || s.id || `Cena ${i + 1}`, duration: Number(s.duration) || null, prompt: s.prompt || '', path: ['scenes', i], related: [] }; });
  if (Array.isArray(r.program?.shots)) return r.program.shots.map((value, i) => {
    const s = record(value);
    const j = Array.isArray(r.videoGeneration?.shots) && s.id ? r.videoGeneration.shots.findIndex(v => v?.shotId === s.id) : -1;
    return { id: s.id, name: s.id, duration: Number(s.durationFrames) / fpsOf(r) || null, prompt: j >= 0 ? r.videoGeneration.shots[j].prompt || '' : '', path: ['program', 'shots', i], related: j >= 0 ? [['videoGeneration', 'shots', j]] : [] };
  });
  if (Array.isArray(r.parts)) return r.parts.map((value, i) => { const s = record(value); return { id: s.id || s.name || `parte-${i + 1}`, name: s.name || `Parte ${i + 1}`, duration: Number(s.duration) || null, prompt: s.prompt || '', path: ['parts', i], related: [] }; });
  if (Array.isArray(r.identidade?.movimentos)) return r.identidade.movimentos.map((value, i, all) => { const s = record(value); return {
    id: s.nome || `etapa-${i + 1}`, name: s.nome || `Etapa ${i + 1}`, prompt: s.cena || '',
    duration: r.duracaoAlvoSegundos > 0 && Number.isFinite(s.ate) ? Math.max(0, Math.min(1, s.ate) - Math.min(1, all[i - 1]?.ate || 0)) * r.duracaoAlvoSegundos : null,
    path: ['identidade', 'movimentos', i], related: [],
  }; });
  return [];
}
export function durationOf(r) {
  if (r.program?.durationFrames > 0) return r.program.durationFrames / fpsOf(r);
  if (r.targetDurationSeconds > 0 || r.duracaoAlvoSegundos > 0) return r.targetDurationSeconds || r.duracaoAlvoSegundos;
  const scenes = scenesOf(r);
  return scenes.length && scenes.every(s => s.duration > 0) ? scenes.reduce((n, s) => n + s.duration, 0) : null;
}
export function formatOf(r) {
  if (textValue(r.aspect)) return textValue(r.aspect);
  const m = r.format?.master;
  if (!m?.width || !m?.height) return null;
  return Math.abs(m.width / m.height - 16 / 9) < .02 ? '16:9' : Math.abs(m.width / m.height - 9 / 16) < .02 ? '9:16' : m.width === m.height ? '1:1' : `${m.width} × ${m.height}`;
}
export function summaryOf(r, file = '') {
  const narration = r.audio?.narration || r.narration || r.narracao;
  const music = r.audio?.music || r.music || r.trilha;
  return { title: titleOf(r), description: textValue(r.description), schema: textValue(r.schema) || null,
    family: SCHEMAS[r.schema] || 'Formato não reconhecido', kind: r.kind || 'filme',
    duration: durationOf(r), aspect: formatOf(r), sceneCount: scenesOf(r).length,
    narration: Boolean(narration), music: Boolean(music), voice: textValue(narration?.voice) || null,
    style: textValue(r.identidade?.nome) || textValue(r.style) || null, derived: file.startsWith('derivadas/'), draft: file.endsWith('.rascunho.json') };
}
export function durationLabel(n) {
  if (!(n > 0)) return 'Não definida';
  const total = Math.round(n * 10) / 10;
  return total < 60 ? `${total.toLocaleString('pt-BR')} s` : `${Math.floor(total / 60)} min${total % 60 ? ` ${(total % 60).toLocaleString('pt-BR')} s` : ''}`;
}
export const GROUPS = [
  { id: 'essencia', title: 'Conceito e formato', intro: 'O que este vídeo comunica, para quem e em qual formato.', keys: ['label', 'name', 'description', 'kind', 'aspect', 'style', 'targetDurationSeconds', 'duracaoAlvoSegundos', 'format', 'resources', 'arquitetura'] },
  { id: 'estrutura', title: 'Cenas e estrutura', intro: 'Explore a sequência e o papel de cada cena. Os tempos são planejados, não medições de um vídeo pronto.', keys: ['scenes', 'parts', 'program', 'videoGeneration', 'roteiro', 'segmentacao', 'batch'] },
  { id: 'audio', title: 'Voz e som', intro: 'Texto falado, voz, música, efeitos e equilíbrio da mixagem.', keys: ['audio', 'narration', 'narracao', 'music', 'trilha', 'sfx', 'mix', 'alignment'] },
  { id: 'visual', title: 'Direção visual', intro: 'Linguagem gráfica, personagens, referências, textos em tela e movimento.', keys: ['identidade', 'graphics', 'cast', 'assets', 'movimento', 'marca'] },
  { id: 'finalizacao', title: 'Montagem e entrega', intro: 'Como as partes se unem: transições, legendas, acabamento, verificações e formatos de saída.', keys: ['assembly', 'transitions', 'captions', 'postProduction', 'qa', 'delivery', 'variants', 'ending', 'fecho'] },
  { id: 'tecnico', title: 'Identificação e opções', intro: 'Identificadores, organização e demais campos preservados da receita.', keys: ['schema', 'id', 'identity', 'scope', 'collection', 'mode', 'vertical', 'task', 'workflow', 'parallel', 'executionPolicy', 'status', 'veredito', 'cliente'] },
];
export const FIELD_NAMES = {
  label: 'Título', name: 'Nome', nome: 'Nome', description: 'Descrição', kind: 'Tipo de produção', aspect: 'Proporção', style: 'Estilo',
  targetDurationSeconds: 'Duração planejada (segundos)', duracaoAlvoSegundos: 'Duração planejada (segundos)', duration: 'Duração (segundos)', durationFrames: 'Duração (quadros)',
  prompt: 'Direção da cena', onScreenText: 'Texto na tela', textRendering: 'Renderização do texto', generationTask: 'Modo de geração', references: 'Referências',
  audio: 'Configuração de áudio', narration: 'Narração', narracao: 'Narração', text: 'Texto', roteiro: 'Roteiro falado', voice: 'Voz', language: 'Idioma',
  music: 'Música', trilha: 'Trilha sonora', musicPreset: 'Estilo da trilha', intent: 'Intenção musical', intencao: 'Intenção musical',
  musicDurationSeconds: 'Duração da música (segundos)', musicFadeOutSeconds: 'Fade da música (segundos)', musicFit: 'Ajuste de duração',
  voiceGainDb: 'Ganho da voz (dB)', musicGainDb: 'Ganho da música (dB)', sfxGainDb: 'Ganho dos efeitos (dB)', ganhoDb: 'Ganho (dB)',
  blocks: 'Blocos de fala', speakerId: 'Locutor', speakerMode: 'Distribuição de vozes', documentUrl: 'Documento de narração', provider: 'Provedor', backend: 'Motor',
  identidade: 'Identidade visual', base: 'Linguagem visual', tipografia: 'Tipografia', fechamento: 'Direção do fechamento', movimentos: 'Etapas visuais',
  cena: 'Descrição visual', ate: 'Até esta fração do vídeo (0–1)', gestos: 'Gestos de composição', movimento: 'Movimento',
  resources: 'Recursos da produção', arquitetura: 'Arquitetura narrativa', program: 'Programa', shots: 'Cenas', scenes: 'Cenas', parts: 'Partes',
  videoGeneration: 'Geração visual', format: 'Formato de saída', master: 'Vídeo principal', width: 'Largura (px)', height: 'Altura (px)', fps: 'Quadros por segundo',
  numerator: 'Numerador', denominator: 'Denominador', assembly: 'Montagem', transitions: 'Transições', transition: 'Transição',
  captions: 'Legendas', graphics: 'Elementos gráficos', postProduction: 'Pós-produção', qa: 'Verificação de qualidade', structural: 'Verificação estrutural',
  technical: 'Verificação técnica', semantic: 'Verificação semântica', assertions: 'Critérios de verificação', delivery: 'Entrega', variants: 'Variações de formato',
  assets: 'Materiais de referência', cast: 'Elenco', people: 'Pessoas', source: 'Origem', role: 'Papel', mediaKind: 'Tipo de mídia',
  id: 'Identificador', shotId: 'Cena vinculada', identity: 'Identificação', revision: 'Revisão', collection: 'Coleção', scope: 'Escopo',
  batch: 'Lote', rows: 'Itens do lote', parallel: 'Paralelismo', mode: 'Modo', task: 'Tarefa', module: 'Módulo', schema: 'Formato da receita',
};
export const FIELD_HELP = {
  prompt: 'Descreva o que aparece, a ação, o enquadramento e o comportamento do áudio nesta cena.',
  durationFrames: 'Este formato usa quadros. O tempo em segundos depende do FPS informado no formato.',
  onScreenText: 'Conteúdo visual escrito. Ele não substitui uma fala ou narração.',
  roteiro: 'Texto que será falado. Preserve a pontuação e as palavras que precisam aparecer na narração.',
  musicFadeOutSeconds: 'Zero mantém o encerramento por corte limpo.',
  voiceGainDb: 'Ajusta o volume da voz na mixagem; não muda a voz escolhida.',
  targetDurationSeconds: 'Meta de duração; confira também o total planejado das cenas.',
  references: 'Referências declaradas nesta cena. Salvar uma derivação não autoriza envio a um provedor.',
  scope: 'O escopo da receita de origem é preservado. Salvar não amplia direitos de uso.',
};
export const fieldName = key => FIELD_NAMES[key] || String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
export function getAt(root, path) { return path.reduce((v, key) => v?.[key], root); }
export function setAt(root, path, value) {
  if (!path.length || path.some(k => ['__proto__', 'constructor', 'prototype'].includes(String(k)))) throw Error('Campo não permitido');
  const parent = getAt(root, path.slice(0, -1));
  if (parent == null || typeof parent !== 'object') throw Error('Campo inexistente');
  parent[path.at(-1)] = value;
}
