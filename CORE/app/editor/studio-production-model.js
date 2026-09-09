// Read-only presentation of the existing executor evidence. No timers invent progress.
const done = new Set(['complete', 'completed', 'delivered', 'succeeded']);
const working = new Set(['running', 'generating', 'processing']);
const attention = new Set(['failed', 'ambiguous', 'attention_required', 'interrupted']);
export const productionLink = job => '/gerador?job=' + encodeURIComponent(job.id);
export function productionIssue(job) {
  const message = String(job.message || job.progress?.stages?.find(s => attention.has(s.status))?.message || '').trim();
  if (!message) return null;
  if (/Prompt, preset ou atributos musicais|descrição musical|clima da música/i.test(message)) return { kind: 'music', title: 'Falta escolher a música', text: 'A trilha foi ativada, mas falta dizer como ela deve soar. Abra Voz e música para preencher.', action: 'Escolher a música', field: 'musicIntent', step: 2, technical: message };
  if (/cookie|sessão|session|login/i.test(message)) return { kind: 'session', title: 'A conexão com o serviço precisa de atenção', text: 'A produção está guardada. Renove a sessão do serviço antes de continuar este mesmo pedido.', action: 'Ver como continuar', technical: message };
  if (/ambiguous|ambígu|reconcil|janela de observação|504/i.test(message)) return { kind: 'unknown', title: 'Aguardando confirmação do serviço', text: 'O serviço ainda não confirmou o resultado. O pedido está salvo; continuar consulta a mesma produção antes de decidir o próximo passo.', action: 'Consultar e continuar', technical: message };
  if (/referência|referencia|asset|ENOENT|direitos/i.test(message)) return { kind: 'material', title: 'Um material precisa de atenção', text: 'Uma imagem, vídeo ou logo não pôde ser usado. Confira os materiais desta receita.', action: 'Conferir materiais', step: 1, technical: message };
  return { kind: 'other', title: job.stateFile ? 'A produção precisa de atenção' : 'A preparação precisa de um ajuste', text: message.split('\n')[0].replace(/--[a-z-]+/gi, '').trim(), action: job.stateFile ? 'Consultar e continuar' : 'Revisar minhas escolhas', technical: message };
}
export function productionStatus(job) {
  const stages = (job.progress?.stages || []).filter(s => s.status !== 'skipped');
  const scenes = job.progress?.scenes || [];
  const sceneTotal = Math.max(scenes.length, job.checklist?.length || 0);
  const scenesDone = scenes.filter(s => s.available).length;
  const issue = productionIssue(job);
  const ready = !!job.mediaAvailable;
  const busy = !ready && ['planning', 'running'].includes(job.status);
  const needsAttention = !ready && ['attention', 'interrupted', 'paused', 'complete'].includes(job.status);
  let units = 0, completed = 0;
  for (const stage of stages) {
    if (stage.name === 'video' && sceneTotal) { units += sceneTotal; completed += scenesDone; }
    else { units++; if (done.has(stage.status)) completed++; }
  }
  const percent = ready ? 100 : units ? Math.min(99, Math.floor(completed / units * 100)) : job.status === 'ready' || needsAttention && !job.stateFile ? 0 : null;
  const label = ready ? 'Pronto para assistir' : ({ planning: 'Preparando seu pedido', ready: 'Preparado · ainda não começou', running: 'Criando seu vídeo', attention: issue?.title || 'Precisa de ajuste', interrupted: issue?.title || 'Produção interrompida', paused: 'Aguardando sua revisão', complete: 'Conferir a entrega' })[job.status] || 'Conferindo o pedido';
  const groups = [
    ['Preparação', []], ['Voz e música', ['tts', 'music', 'musicFit', 'alignment']],
    ['Cenas', ['draft', 'video', 'sceneQa']], ['Montagem e entrega', ['assembly', 'audioMix', 'audioMux', 'graphics', 'captions', 'postProduction', 'qa', 'delivery', 'variants']]
  ].map(([name, keys], i) => {
    const members = stages.filter(s => keys.includes(s.name));
    let state = ready ? 'done' : members.some(s => attention.has(s.status)) ? 'attention' : members.some(s => working.has(s.status)) ? 'working' : members.length && members.every(s => done.has(s.status)) ? 'done' : 'pending';
    if (i === 0 && job.status === 'planning') state = 'working';
    if (i === 0 && (job.stateFile || ['ready','running','paused'].includes(job.status))) state = 'done';
    if (i === 0 && needsAttention && !job.stateFile) state = 'attention';
    return { name, state, omitted: stages.length > 0 && !members.length && i !== 0, detail: i === 2 && sceneTotal ? `${scenesDone} de ${sceneTotal} cenas disponíveis` : ({ done: 'Concluído', working: 'Em andamento', attention: 'Precisa de atenção', pending: 'A seguir' })[state] };
  });
  return { ready, busy, needsAttention, issue, label, percent, completed, units, scenesDone, sceneTotal, scenes, groups, tone: ready ? 'ready' : needsAttention ? 'attention' : busy ? 'working' : 'waiting' };
}
