import { organizationOf } from './receitas-organization.js';
import { durationLabel } from './receitas-model.js';

// Coordenadas de leitura da estrutura. Não é um plano executável nem altera a receita.
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const tracks = () => [
  { id: 'story', label: 'Narrativa', short: 'N', clips: [] },
  { id: 'visual', label: 'Imagem / cenas', short: 'V', clips: [] },
  { id: 'voice', label: 'Voz', short: 'A1', clips: [] },
  { id: 'text', label: 'Texto na tela', short: 'T', clips: [] },
  { id: 'sound', label: 'Som / música', short: 'A2', clips: [] },
  { id: 'finish', label: 'Encerramento', short: 'F', clips: [] },
];
const detail = (label, value) => ({ label, value: String(value || 'Não informado') });
export function recipeTimeline(recipe) {
  recipe = recipe && typeof recipe === 'object' && !Array.isArray(recipe) ? recipe : {};
  const organization = organizationOf(recipe), scenes = organization.scenes;
  const overlap = Array.isArray(recipe.transitions?.edges) && recipe.transitions.edges.some(e => Number(e?.durationFrames) > 0);
  const proportional = scenes.some(s => s.path[0] === 'identidade');
  const timed = recipe.kind !== 'lote' && !overlap && !proportional && scenes.length > 0 && scenes.every(s => positive(s.duration));
  const rows = tracks(); rows.shift();
  const pending = [], spans = [];
  let cursor = 0;
  const add = (track, id, scene, index, title, facts, extra = {}) => rows.find(r => r.id === track).clips.push({
    id, track, index, title, start: spans[index].start, end: spans[index].end, facts, ...extra,
  });
  for (const [index, scene] of scenes.entries()) {
    const width = timed ? scene.duration : 1;
    spans.push({ start: cursor, end: cursor + width, name: scene.name }); cursor += width;
    const timing = timed ? `${durationLabel(scene.duration)} · janela planejada da cena, antes do acabamento` : `${scene.position}${positive(scene.duration) ? ` · ${durationLabel(scene.duration)} ${proportional ? 'estimados a partir da duração-alvo' : 'declarados'}` : ' · duração não definida'}`;
    add('visual', `visual-${index}`, scene, index, scene.name, [detail('Posição', timing), detail('Direção visual', scene.visual.full), detail('Passagem para a próxima etapa', scene.transition)], { kind: 'visual', sceneIndex: index });
    if (['direct', 'narration'].includes(scene.speech.kind)) {
      add('voice', `voice-${index}`, scene, index, scene.speech.voice || scene.speech.label, [detail('Fala / narração', scene.speech.text), detail('Vínculo', scene.speech.note), detail('Posicionamento', 'A faixa mostra a cena à qual a voz está associada. O início e o fim exatos da fala dependem do alinhamento do áudio.')], { kind: scene.speech.kind, window: true, sceneIndex: index });
    }
    if (scene.screen.text) add('text', `text-${index}`, scene, index, scene.screen.text, [detail('Texto na tela', scene.screen.text), detail('Posicionamento', 'Texto associado a esta cena. As entradas e saídas das palavras não estão representadas nesta leitura.')], { kind: 'text', window: true, sceneIndex: index });
    if (scene.sound) add('sound', `sound-${index}`, scene, index, 'Efeitos indicados', [detail('Direção sonora', scene.sound), detail('Posicionamento', 'Indicação do prompt da cena, sem instante exato do efeito.')], { kind: 'sound', window: true, sceneIndex: index });
    if (recipe.ending?.sourceTailSceneId && recipe.ending.sourceTailSceneId === scene.id) add('finish', `finish-${index}`, scene, index, 'Cena de arremate', organization.finish.map(f => detail(f.label, f.value)), { kind: 'finish', window: true, sceneIndex: index });
  }
  if (organization.music.declared) pending.push({ id: 'music-global', title: 'Trilha da produção', kind: 'sound', section: 'audio', facts: [detail('Posicionamento', 'A receita prevê música, mas esta leitura não define os pontos de entrada e saída.'), ...organization.music.facts.map(f => detail(f.label, f.value))] });
  if (organization.narration.unmappedCount || (organization.narration.fullText && !organization.narration.blocks.length)) pending.push({ id: 'voice-global', title: 'Voz sem posição por cena', kind: 'narration', section: 'audio', facts: [detail('Roteiro', organization.narration.fullText || organization.narration.blocks.filter(b => !b.mapped).map(b => b.text || '').join('\n\n')), detail('Vínculo', 'A narração existe na receita, mas faltam vínculos ou tempos para posicionar todos os trechos nesta régua.')] });
  if (recipe.segmentacao || recipe.captions) pending.push({ id: 'captions-global', title: 'Texto sincronizado / legendas', kind: 'text', section: recipe.segmentacao ? 'estrutura' : 'finalizacao', facts: [detail('Posicionamento', recipe.segmentacao?.maxWords ? `Grupos de até ${recipe.segmentacao.maxWords} palavras. Os tempos dependem da medição da narração.` : 'As legendas dependem dos tempos do áudio. Nenhuma minutagem foi inventada.'), detail('Sincronismo', organization.narration.syncNote)] });
  if (organization.finish.length) pending.push({ id: 'ending-global', title: 'Regras de encerramento', kind: 'finish', section: 'finalizacao', facts: organization.finish.map(f => detail(f.label, f.value)) });
  return { mode: 'recipe', title: organization.headline, subtitle: timed ? 'Cenas em segundos · antes do acabamento' : 'Estrutura por etapas · sem régua de tempo final', unit: timed ? 'seconds' : 'steps', extent: cursor || 1, tracks: rows, pending, spans,
    note: timed ? 'Blocos cheios mostram a duração da cena. Blocos tracejados indicam conteúdo associado à cena; não medem a duração da fala, do texto ou do efeito.' : overlap ? 'Há sobreposição de transições. A régua mostra a ordem das etapas; os tempos declarados continuam nos detalhes de cada cena.' : proportional ? 'Estas etapas dividem a narração por proporções. A posição em segundos depende do áudio; a régua mostra somente a ordem.' : 'Etapas com duração ausente, peças de lote ou estrutura não temporizada são mostradas por ordem, sem segundos inventados.',
    notes: organization.timing };
}

// Síntese editorial dos padrões observados na biblioteca; exemplos conceituais, sem tempos fixos.
export const STRUCTURE_PATTERNS = [
  { id: 'comercial-curto', name: 'Comercial curto', purpose: 'Apresentar uma promessa rapidamente e levar a uma ação.', phases: [
    ['Gancho', 'Interromper a atenção com uma pergunta, contraste ou imagem forte.', 'Imagem de impacto', 'Chamada curta', 'Palavra-chave', 'Acento sonoro'],
    ['Benefício', 'Mostrar o que a solução muda para a pessoa.', 'Produto ou transformação', 'Explicação objetiva', 'Benefício principal', 'Trilha sustenta'],
    ['Convite', 'Indicar o próximo passo e fechar a mensagem.', 'Marca e ação', 'Chamada para agir', 'Convite / contato', 'Arremate sonoro'],
  ] },
  { id: 'comercial-desenvolvido', name: 'Comercial desenvolvido', purpose: 'Construir o argumento antes de pedir uma ação.', phases: [
    ['Gancho', 'Criar interesse pelo assunto.', 'Situação chamativa', 'Pergunta ou afirmação', 'Ideia central', 'Acento de abertura'],
    ['Problema', 'Tornar a dificuldade reconhecível.', 'Situação de dificuldade', 'Expõe a dor', 'Problema em destaque', 'Tensão / pulso'],
    ['Solução', 'Apresentar a alternativa ao problema.', 'Solução em uso', 'Explica a proposta', 'Benefício', 'Mudança de energia'],
    ['Prova', 'Dar sustentação à promessa.', 'Demonstração / resultado', 'Evidência ou exemplo', 'Dado / resultado', 'Trilha sustenta'],
    ['Convite', 'Orientar uma ação concreta.', 'Marca / fechamento', 'Próximo passo', 'Chamada para agir', 'Resolução sonora'],
  ] },
  { id: 'motivacional', name: 'Motivacional', purpose: 'Partir de uma dificuldade e conduzir a uma mudança de perspectiva.', phases: [
    ['Dificuldade', 'Criar identificação com um obstáculo.', 'Obstáculo ou metáfora', 'Reconhece a dificuldade', 'Ideia de abertura', 'Começo contido'],
    ['Reflexão', 'Desenvolver o significado do problema.', 'Metáfora se desenvolve', 'Amplia a reflexão', 'Frases-chave', 'Construção gradual'],
    ['Virada', 'Oferecer outro modo de olhar a situação.', 'Transformação visual', 'Muda a perspectiva', 'Nova possibilidade', 'Crescimento musical'],
    ['Incentivo', 'Encerrar com uma direção ou gesto possível.', 'Imagem de resolução', 'Incentivo final', 'Frase de fechamento', 'Arremate'],
  ] },
  { id: 'didatico', name: 'Didático', purpose: 'Dividir uma ideia em partes que possam ser entendidas e demonstradas.', phases: [
    ['Ideia', 'Apresentar o que será aprendido.', 'Título / problema', 'Introduz o assunto', 'Tema da aula', 'Abertura'],
    ['Explicação', 'Desenvolver um conceito por bloco; este trecho pode se repetir em capítulos.', 'Conceito visualizado', 'Explica o conceito', 'Termos principais', 'Trilha discreta'],
    ['Demonstração', 'Tornar a explicação observável.', 'Exemplo em ação', 'Conecta exemplo e ideia', 'Destaques / passos', 'Respiro / acentos'],
    ['Síntese', 'Retomar o aprendizado central.', 'Resultado / resumo', 'Conclui o raciocínio', 'Mensagem final', 'Resolução'],
  ] },
  { id: 'historia', name: 'História', purpose: 'Conduzir uma situação até uma mudança e um desfecho.', phases: [
    ['Situação', 'Apresentar personagem, lugar e contexto.', 'Personagem e ambiente', 'Apresentação / diálogo', 'Opcional', 'Ambiente inicial'],
    ['Tentativa', 'Mostrar uma ação e a resistência que ela encontra.', 'Ação / conflito', 'Fala ou narração', 'Opcional', 'Tensão / movimento'],
    ['Virada', 'Mudar o rumo ou a compreensão da situação.', 'Acontecimento decisivo', 'Revelação / pausa', 'Opcional', 'Acento / contraste'],
    ['Desfecho', 'Mostrar a consequência da mudança.', 'Resultado da história', 'Conclusão / silêncio', 'Frase final opcional', 'Arremate'],
  ] },
  { id: 'demonstracao', name: 'Demonstração / documentário', purpose: 'Revelar um assunto por detalhes, processo e resultado.', phases: [
    ['Assunto', 'Situar o objeto, ambiente ou pessoa.', 'Visão geral', 'Introdução', 'Identificação', 'Som ambiente'],
    ['Detalhes', 'Guiar o olhar para características relevantes.', 'Planos de detalhe', 'Contexto / observação', 'Dados opcionais', 'Texturas sonoras'],
    ['Processo', 'Mostrar como algo acontece ou se transforma.', 'Etapas do processo', 'Explica conexões', 'Etapas / destaques', 'Sons da ação'],
    ['Resultado', 'Revelar o resultado ou o significado do que foi visto.', 'Revelação / plano final', 'Síntese', 'Mensagem opcional', 'Resolução'],
  ] },
  { id: 'serie', name: 'Série / campanha', purpose: 'Distribuir um tema entre peças que podem ser consumidas separadamente.', phases: [
    ['Peça 1', 'Abrir o tema com uma peça completa.', 'Abertura → conteúdo → fecho', 'Roteiro próprio', 'Título / convite próprios', 'Áudio da peça'],
    ['Peça 2', 'Desenvolver outro aspecto do mesmo tema.', 'Abertura → conteúdo → fecho', 'Roteiro próprio', 'Título / convite próprios', 'Áudio da peça'],
    ['Próximas peças', 'Repetir a organização, variando o assunto ou a função de cada episódio.', 'Abertura → conteúdo → fecho', 'Roteiros próprios', 'Identidade recorrente', 'Áudio por peça'],
  ] },
];

export function patternTimeline(id, presentation = 'narration') {
  const pattern = STRUCTURE_PATTERNS.find(p => p.id === id) || STRUCTURE_PATTERNS[0], rows = tracks();
  pattern.phases.forEach(([name, purpose, visual, voice, words, sound], i) => {
    const last = i === pattern.phases.length - 1;
    const voiceLabel = presentation === 'alternate' ? i % 2 ? 'Narração sobre imagens' : 'Apresentador em cena' : presentation === 'sync' ? 'Voz guia as palavras' : voice;
    for (const [track, title, explanation] of [['story', name, purpose], ['visual', visual, `Função da imagem: ${visual.toLowerCase()}.`], ['voice', voiceLabel, presentation === 'alternate' ? `${voiceLabel}. Função do conteúdo: ${voice.toLowerCase()}.` : `Função da voz: ${voice.toLowerCase()}.`], ['text', presentation === 'sync' ? 'Palavras da fala' : words, presentation === 'sync' ? 'Os textos acompanham as palavras faladas; os instantes exatos dependem da narração.' : `Uso possível do texto: ${words.toLowerCase()}.`], ['sound', sound, `Intenção sonora ilustrativa: ${sound.toLowerCase()}.`]]) {
      rows.find(r => r.id === track).clips.push({ id: `${track}-${i}`, track, index: i, title, start: i, end: i + 1, kind: track === 'voice' ? presentation === 'alternate' && i % 2 === 0 ? 'direct' : 'narration' : track, facts: [detail('Etapa', name), detail('O que este bloco faz', explanation), detail('Como ler', 'Exemplo genérico de organização. Os blocos não têm duração fixa e podem se repetir ou se combinar.')] });
    }
    if (last || pattern.id === 'serie') rows.find(r => r.id === 'finish').clips.push({ id: `finish-${i}`, track: 'finish', index: i, title: pattern.id === 'serie' ? 'Fecho da peça' : name, start: i, end: i + 1, kind: 'finish', facts: [detail('Encerramento', pattern.id === 'serie' ? 'Cada peça tem seu próprio fechamento. Não é uma concatenação obrigatória.' : purpose), detail('Imagem e áudio', 'A duração do arremate, o corte ou o fade são escolhas da receita concreta.')] });
  });
  return { mode: 'pattern', title: pattern.name, subtitle: 'Mapa genérico · etapas sem duração fixa', unit: 'steps', extent: pattern.phases.length, tracks: rows, pending: [], spans: pattern.phases.map((p, i) => ({ start: i, end: i + 1, name: p[0] })), note: 'Síntese dos padrões da biblioteca. Imagem, voz, texto e som são exemplos de como ocupar cada etapa, não instruções obrigatórias de todas as receitas.', notes: [pattern.purpose] };
}

export function positionLabel(value, unit) {
  if (unit === 'steps') return `Etapa ${Math.floor(value) + 1}`;
  const tenths = Math.max(0, Math.round(value * 10));
  return `${Math.floor(tenths / 600).toString().padStart(2, '0')}:${(Math.floor(tenths / 10) % 60).toString().padStart(2, '0')}.${tenths % 10}`;
}
