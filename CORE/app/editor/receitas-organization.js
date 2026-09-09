import { scenesOf, durationOf, durationLabel, fpsOf, getAt, cleanName } from './receitas-model.js';

// Leitura explicável da receita, sem compilar uma timeline ou alterar o documento.
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const list = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' ? v.trim() : '';
const fact = (label, value, path) => ({ label, value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value), path });
const keyOf = v => text(v).toLowerCase().replace(/\b0+(\d+)/g, '$1');
const sentence = (value, pattern) => (text(value).match(/[^.!?\n]+[.!?]?/g) || []).find(s => pattern.test(s))?.trim() || '';
const noVoice = /(?:no (?:speech|spoken words|voices|narration)|zero (?:spoken words|voices|speech)|sem (?:fala|narra[çc][ãa]o)|fechamento silencioso)/i;
const directVoice = /(?:apresentador(?:a)?|personagem)\s+(?:(?:(?!n[ãa]o\b|sem\b)[^.!?\n]){0,170}?\s+e\s+)?(?:fala|diz|conversa)\b/i;
const soundWords = /\b(?:sfx|sound design|efeitos? sonoros?|whoosh|impacto|som ambiente|sound accents)\b/i;

function excerpt(prompt) {
  const match = prompt.match(/(?:Tese:|Narrative beat \d+ of \d+:)\s*([\s\S]*)/i);
  const value = (match?.[1] || prompt).split(/The exact on-screen phrase is supplied separately as:/i)[0].trim();
  return value.length > 700 ? value.slice(0, 697).trimEnd() + '…' : value;
}
function transitionName(v) {
  return ({ 'cut@1': 'Corte seco', cut: 'Corte seco', 'dissolve@1': 'Dissolução', dissolve: 'Dissolução', 'fade@1': 'Fade' })[v] || cleanName(v);
}
function narrationSource(r) {
  if (r.audio?.narration) return { data: object(r.audio.narration), path: ['audio', 'narration'] };
  if (r.narration) return { data: object(r.narration), path: ['narration'] };
  if (r.narracao) return { data: object(r.narracao), path: ['narracao'] };
  return { data: {}, path: [] };
}
function blockMatch(blocks, scene, allScenes) {
  const exact = blocks.filter(b => [b.shotId, b.sceneId, b.id].some(id => id && id === scene.id));
  if (exact.length) return { blocks: exact, normalized: false };
  // Nomes legados podem variar só no zero à esquerda. Nunca ligar pela posição.
  const key = keyOf(scene.id);
  const candidates = key && blocks.filter(b => [b.shotId, b.sceneId, b.id].some(id => id && keyOf(id) === key));
  if (candidates?.length === 1 && allScenes.filter(s => keyOf(s.id) === key).length === 1) return { blocks: candidates, normalized: true };
  return { blocks: [], normalized: false };
}

export function organizationOf(input) {
  const r = object(input), base = scenesOf(r), ns = narrationSource(r);
  const narration = ns.data, blocks = list(narration.blocks).map(object);
  const voice = text(narration.voice), fullText = text(narration.text) || text(r.roteiro);
  const hasNarration = Boolean(ns.path.length || fullText || blocks.length);
  const musicValue = r.audio?.music ?? r.music ?? r.trilha;
  const musicDeclared = Boolean(musicValue), music = object(musicValue);
  const musicPath = r.audio?.music != null ? ['audio', 'music'] : r.music != null ? ['music'] : ['trilha'];
  const usedBlocks = new Set();
  const scenes = base.map((scene, i) => {
    const data = object(getAt(r, scene.path));
    const prompt = text(scene.prompt), matched = blockMatch(blocks, scene, base);
    matched.blocks.forEach(b => usedBlocks.add(b));
    const promptPath = [...(scene.related[0] || scene.path), scene.path[0] === 'identidade' ? 'cena' : 'prompt'];
    const noSpeech = sentence(prompt, noVoice), direct = sentence(prompt, directVoice);
    const directMatch = direct && prompt.match(directVoice);
    const afterDirect = directMatch ? prompt.slice(directMatch.index + directMatch[0].length) : '';
    const speechPreamble = afterDirect.match(/^[^.!?\n:]{0,100}:/)?.[0];
    const directText = speechPreamble ? afterDirect.slice(speechPreamble.length).trim().replace(/\s+(?:Sem narrador de fundo|Sem voz em off|Sem legendas|No voiceover|No subtitles)\b[\s\S]*$/i, '').trim() : '';
    const visualText = directText ? prompt.slice(0, directMatch.index + directMatch[0].length + speechPreamble.length - 1).trim() + '.' : prompt;
    const quotedNarration = prompt.match(/(?:narra[çc][ãa]o|voiceover)\s*:\s*["“]([^"”]+)["”]/i)?.[1];
    let speech;
    if (matched.blocks.length) speech = { kind: 'narration', label: 'Narração vinculada', text: matched.blocks.map(b => text(b.text)).filter(Boolean).join('\n\n'),
      note: matched.normalized ? `Correspondência pelo nome: ${scene.id} ↔ ${matched.blocks[0].id}. O zero à esquerda foi desconsiderado; confira o vínculo.` : 'Bloco de narração ligado pelo identificador da cena.',
      paths: matched.blocks.map(b => [...ns.path, 'blocks', blocks.indexOf(b)]), voice, inferred: matched.normalized };
    else if (direct) speech = { kind: 'direct', label: 'Fala indicada na cena', text: directText || prompt, voice: directMatch[0].split(/\s/)[0], note: directText ? 'Texto extraído após a indicação de fala no prompt. A direção completa permanece disponível ao lado.' : 'Indicação extraída do prompt. O trecho descreve a fala; o roteiro literal não está separado.', paths: [promptPath], inferred: true };
    else if (quotedNarration) speech = { kind: 'narration', label: 'Narração no prompt', text: quotedNarration, note: 'Texto citado no prompt desta parte.', paths: [promptPath], inferred: true };
    else if (noSpeech && (!hasNarration || blocks.length)) speech = { kind: 'visual', label: 'Direção sem voz', text: noSpeech, note: 'O prompt pede ausência de voz e não há bloco de narração vinculado a esta cena.', paths: [promptPath], inferred: true };
    else if (hasNarration) speech = { kind: 'unmapped', label: 'Voz sem trecho mapeado', text: '', note: 'A receita tem narração, mas não define qual trecho pertence a esta cena. Consulte o roteiro geral abaixo.', paths: ns.path.length ? [ns.path] : [['roteiro']] };
    else speech = { kind: 'unknown', label: 'Voz não detalhada', text: '', note: 'A ausência de um bloco de narração não comprova que o vídeo seja silencioso.', paths: [] };
    const graphics = list(r.graphics?.scenes).filter(g => g?.shotId === scene.id);
    const textOnScreen = [text(data.onScreenText), ...graphics.map(g => text(g.text))].filter(Boolean).join('\n');
    const textSources = [...(text(data.onScreenText) ? [[...scene.path, 'onScreenText']] : []), ...graphics.map(g => ['graphics', 'scenes', r.graphics.scenes.indexOf(g)])];
    const next = base[i + 1];
    const edge = list(r.transitions?.edges).find(e => e?.fromShotId === scene.id && e?.toShotId === next?.id);
    const transition = next ? edge ? `${transitionName(edge.transition)}${Number(edge.durationFrames) > 0 ? ` · ${durationLabel(edge.durationFrames / fpsOf(r))}` : ''}`
      : r.assembly?.transition ? `${transitionName(r.assembly.transition)} · regra geral de montagem` : 'Transição para a próxima cena não especificada.' : 'Última etapa desta sequência. Veja o encerramento abaixo.';
    return { ...scene, name: cleanName(scene.name) || `Cena ${i + 1}`, position: base.length === 1 ? 'Etapa única' : i === 0 ? 'Primeira etapa' : i === base.length - 1 ? 'Última etapa' : `Etapa ${i + 1} de ${base.length}`,
      visual: { text: excerpt(visualText), full: prompt, path: promptPath }, speech,
      purpose: text(data.purpose) || text(data.funcao) || text(data.role),
      screen: { text: textOnScreen, paths: textSources, note: textOnScreen ? 'Texto escrito na imagem; não equivale a uma fala.' : data.textRendering === 'none' ? 'A renderização de texto está desativada nesta cena.' : r.segmentacao?.maxWords ? `Texto distribuído a partir do roteiro em grupos de até ${r.segmentacao.maxWords} palavras. O trecho exato desta etapa não está definido aqui.` : 'Texto desta cena não declarado em campo próprio.' },
      sound: sentence(prompt, soundWords), transition,
      transitionPath: edge ? ['transitions', 'edges', r.transitions.edges.indexOf(edge)] : r.assembly?.transition ? ['assembly', 'transition'] : [],
    };
  });
  const count = kind => scenes.filter(s => s.speech.kind === kind).length;
  const direct = count('direct'), linked = count('narration'), visual = count('visual');
  let headline = r.kind === 'lote' ? 'Sequência de peças' : direct && linked ? 'Fala em cena + narração' : direct ? 'Fala conduzida em cena' : text(r.schema).includes('sincronia') ? 'Roteiro contínuo + etapas visuais' : linked ? 'Narração por cenas' : hasNarration ? 'Roteiro sem divisão por cena' : 'Sequência de cenas';
  const details = [];
  if (direct) details.push(`${direct} ${direct === 1 ? 'cena com fala indicada' : 'cenas com fala indicada'}`);
  if (linked) details.push(`${linked} ${linked === 1 ? 'cena com narração' : 'cenas com narração'}`);
  if (visual) details.push(`${visual} ${visual === 1 ? 'direção sem voz' : 'direções sem voz'}`);
  if (count('unmapped')) details.push(`${count('unmapped')} ${count('unmapped') === 1 ? 'etapa sem trecho de voz mapeado' : 'etapas sem trecho de voz mapeado'}`);
  if (!details.length) details.push(`${scenes.length} etapas; distribuição das vozes não detalhada`);
  const durations = scenes.map(s => s.duration);
  const sum = durations.every(n => n > 0) && durations.length ? durations.reduce((a, b) => a + b, 0) : null;
  const uniform = sum && durations.every(n => Math.abs(n - durations[0]) < .01);
  const cadence = uniform ? `${scenes.length} etapas de ${durationLabel(durations[0])} cada.` : sum ? `Durações variáveis: ${durations.map(durationLabel).join(' → ')}.` : 'Há etapas sem duração declarada; a sequência é mostrada sem inventar tempos.';
  const timing = [];
  if (r.kind === 'lote') timing.push('As partes são peças de um lote. A ordem abaixo não comprova que todas formem um único filme.');
  if (text(r.schema).includes('sincronia')) timing.push('Os tempos das etapas são proporcionais à duração desejada. O sincronismo final depende da medição da narração.');
  if (sum && durationOf(r) && Math.abs(sum - durationOf(r)) > .1) timing.push(`A soma das etapas é ${durationLabel(sum)} e a duração declarada do programa é ${durationLabel(durationOf(r))}. Confira transições, cortes e arremates; estes valores não são uma medição do vídeo final.`);
  if (r.ending?.durationPolicy === 'narration-end-plus-tail') timing.push(`O encerramento segue o fim medido da narração${Number.isFinite(r.ending.tailAfterNarrationSeconds) ? ` + ${durationLabel(r.ending.tailAfterNarrationSeconds)} de arremate` : ''}. A soma das cenas, sozinha, não determina a duração final.`);
  const musicFacts = [];
  const intent = text(music.intent) || text(music.intencao) || text(r.audio?.musicIntent);
  if (intent) musicFacts.push(fact('Direção musical', intent, music.intent ? [...musicPath, 'intent'] : music.intencao ? [...musicPath, 'intencao'] : ['audio', 'musicIntent']));
  if (r.audio?.musicDurationSeconds != null) musicFacts.push(fact('Duração solicitada da música', durationLabel(r.audio.musicDurationSeconds), ['audio', 'musicDurationSeconds']));
  const fit = music.fit || r.audio?.musicFit;
  if (fit) musicFacts.push(fact('Encaixe da trilha', ({exact:'Ajuste à duração', 'clean-cut':'Corte limpo'})[fit] || fit, music.fit ? [...musicPath, 'fit'] : ['audio', 'musicFit']));
  if (r.audio?.musicFadeOutSeconds != null) musicFacts.push(fact('Fade da trilha na configuração de áudio', r.audio.musicFadeOutSeconds === 0 ? 'Sem fade nesta configuração' : durationLabel(r.audio.musicFadeOutSeconds), ['audio', 'musicFadeOutSeconds']));
  for (const [key, label] of [['voiceGainDb', 'Volume da voz'], ['musicGainDb', 'Volume da música'], ['sfxGainDb', 'Volume dos efeitos']]) if (r.mix?.[key] != null) musicFacts.push(fact(label, `${r.mix[key]} dB`, ['mix', key]));
  if (music.ganhoDb != null) musicFacts.push(fact('Ganho da trilha', music.ganhoDb, [...musicPath, 'ganhoDb']));
  const finish = [];
  if (scenes.at(-1)?.visual.full) finish.push(fact(`Direção da última etapa · ${scenes.at(-1).name}`, scenes.at(-1).visual.full, scenes.at(-1).visual.path));
  for (const [key, label] of [['sourceTailSceneId', 'Cena usada no arremate'], ['tailAfterNarrationSeconds', 'Arremate após a voz'], ['dipToBlackSeconds', 'Passagem da imagem para preto'], ['audioFadeOutSeconds', 'Fade de áudio no encerramento']]) {
    if (r.ending?.[key] != null) finish.push(fact(label, key.endsWith('Seconds') ? Number(r.ending[key]) === 0 ? 'Desativado' : durationLabel(r.ending[key]) : cleanName(r.ending[key]), ['ending', key]));
  }
  if (r.mix?.ending) finish.push(fact('Saída do áudio', r.mix.ending === 'clean-cut' ? 'Corte limpo' : r.mix.ending, ['mix', 'ending']));
  if (r.fecho?.fundoPrompt) finish.push(fact('Direção visual do fechamento', r.fecho.fundoPrompt, ['fecho', 'fundoPrompt']));
  if (r.fecho?.logo) finish.push(fact('Marca no fechamento', r.fecho.logo, ['fecho', 'logo']));
  if (r.identidade?.fechamento) finish.push(fact('Composição do fechamento', r.identidade.fechamento, ['identidade', 'fechamento']));
  if (r.arquitetura?.janelasSegundos?.arremate != null) finish.push(fact('Janela de arremate declarada', durationLabel(r.arquitetura.janelasSegundos.arremate), ['arquitetura', 'janelasSegundos', 'arremate']));
  const direction = [];
  for (const [key, label] of [['base', 'Linguagem visual comum'], ['tipografia', 'Tipografia'], ['capitulo', 'Identificação dos capítulos']]) if (r.identidade?.[key]) direction.push(fact(label, r.identidade[key], ['identidade', key]));
  const sync = narration.sync || r.workflow?.narrationSync || r.alignment?.module;
  const syncNote = sync ? /whisper/i.test(sync) ? 'A receita pede alinhamento da voz por palavras com Whisper. Os instantes finais precisam da medição do áudio.' : `Sincronismo declarado: ${sync}.` : 'A receita não detalha o sincronismo entre voz e imagem em um campo próprio.';
  return { headline, summary: details.join(' · '), cadence, timing, scenes, sum,
    principle: text(r.arquitetura?.nota),
    narration: { voice, fullText, fullTextPath: text(narration.text) ? [...ns.path, 'text'] : ['roteiro'], hasNarration, blocks: blocks.map(b => ({ ...b, mapped: usedBlocks.has(b) })), unmappedCount: blocks.filter(b => !usedBlocks.has(b)).length, syncNote, path: ns.path },
    music: { declared: musicDeclared, facts: musicFacts }, finish, direction };
}

export function organizationSummary(r) {
  const o = organizationOf(r);
  return { headline: o.headline, summary: o.summary, cadence: o.cadence, roles: o.scenes.map(s => s.speech.kind) };
}
