import { scenesOf } from './receitas-model.js';
import { setPresenterReference } from './presenter-reference.js';
const at = (object, path) => path.reduce((v,k) => v?.[k], object);

export function documentChanges(before, after, path = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(k => documentChanges(before[k], after[k], [...path,k]));
  return [{ path, before, after }];
}

export function personalizeRecipe(document, input) {
  const result = structuredClone(document), scenes = scenesOf(result), legacy = result.schema === 'gerador-de-videos/receita@1' && result.kind === 'filme';
  if (!scenes.length || (!legacy && !result.program?.shots)) throw new Error('Esta estrutura exige edição pelos campos próprios da receita.');
  const content = ['theme','message','audience','cta'].map(k => String(input[k] || '').trim());
  if (content.some(v => v.length > 2000)) throw new Error('Use até 2.000 caracteres por campo.');
  const [theme,message,audience,cta] = content;
  if (input.name?.trim()) { if (result.identity) result.identity.name = input.name.trim(); else result.label = input.name.trim(); }
  const context = [theme && `Tema desta versão: ${theme}.`, message && `Mensagem central: ${message}.`, audience && `Público: ${audience}.`].filter(Boolean).join('\n');
  if (context) {
    if (legacy) result.description = [result.description, context].filter(Boolean).join('\n\n');
    for (const scene of scenes) {
      const target = at(result, scene.related?.[0] || scene.path);
      target.prompt = [target.prompt, context].filter(Boolean).join('\n\n');
    }
  }
  if (input.duration) {
    // Retiming de cenas não pode deslocar silenciosamente áudio, keyframes ou transições.
    if (!legacy || result.audio?.narration || result.ending || result.assembly?.transitions?.length || result.graphics || result.captions)
      throw new Error('Esta receita possui tempos vinculados. Ajuste-os no editor da receita; a duração global não será alterada automaticamente.');
    const total = scenes.reduce((n,s) => n + s.duration, 0), seconds = Number(input.duration);
    if (!Number.isInteger(seconds) || seconds < scenes.length * 4 || seconds > 120) throw new Error('Use segundos inteiros, até 120 segundos no total e ao menos 4 por cena.');
    let assigned = 0;
    scenes.forEach((scene,i) => {
      const value = i === scenes.length - 1 ? seconds - assigned : Math.round(scene.duration / total * seconds);
      if (value < 4 || value > 120) throw new Error('Essa distribuição deixa uma cena fora do limite de duração.');
      at(result, scene.path).duration = Number(value.toFixed(4)); assigned += value;
    });
    result.targetDurationSeconds = seconds;
    if (result.audio?.music) result.audio.musicDurationSeconds = seconds;
  }
  if (cta) {
    const last = scenes.at(-1), target = at(result, last.related?.[0] || last.path);
    target.prompt += `\n\nEncerramento desta versão: ${cta}.`;
    if (legacy) { target.onScreenText = cta; target.textRendering = 'omni-native'; }
  }
  if (input.presenter !== 'keep' && input.presenter) {
    if (!legacy) throw new Error('Referências desta receita precisam ser editadas nos módulos próprios.');
    for (const [i, scene] of result.scenes.entries()) {
      if (!(input.presenterScenes || []).includes(i)) continue;
      setPresenterReference(scene, input.presenter === 'none' ? null : input.presenter);
      if (input.presenter !== 'none') {
        scene.prompt += '\nA pessoa da referência selecionada aparece nesta cena.';
      } else {
        if (!scene.references.length) scene.generationTask = 'text_to_video';
        scene.prompt += '\nNesta versão, não mostrar apresentador: encenar apenas os elementos visuais.';
      }
    }
  }
  return result;
}
