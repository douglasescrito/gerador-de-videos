let gruposReceitas = [];
const gruposSelecionados = new Set();
const modalGrupo = document.getElementById('grupo-modal');
let origemModalGrupo;
const textoSeguroGrupo = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function passaGrupos(video) {
  return !gruposSelecionados.size || (video.tags || []).some(tag => gruposSelecionados.has(tag));
}
function receberGrupos(grupos, cobertura) {
  gruposReceitas = grupos;
  const ids = new Set(grupos.map(g => g.id));
  for (const id of gruposSelecionados) if (!ids.has(id)) gruposSelecionados.delete(id);
  const existentes = document.getElementById('grupos-existentes');
  const propostas = document.getElementById('grupos-propostas');
  existentes.replaceChildren(); propostas.replaceChildren();
  for (const grupo of grupos) {
    const conjunto = document.createElement('div'); conjunto.className = 'grupo-controle';
    const filtro = document.createElement('button'); filtro.type = 'button'; filtro.dataset.grupo = grupo.id;
    filtro.className = 'grupo-filtro'; filtro.setAttribute('aria-pressed', String(gruposSelecionados.has(grupo.id)));
    filtro.innerHTML = `<span>${textoSeguroGrupo(grupo.label)}</span><small>${grupo.count.toLocaleString('pt-BR')}</small>`;
    filtro.title = grupo.count ? 'Ativar ou desativar este grupo' : 'Sem vídeos classificados neste grupo. Veja a proposta no !';
    filtro.onclick = () => { if (gruposSelecionados.has(grupo.id)) gruposSelecionados.delete(grupo.id); else gruposSelecionados.add(grupo.id); aplicar(); };
    const info = document.createElement('button'); info.type = 'button'; info.className = 'grupo-explicacao'; info.textContent = '!';
    info.setAttribute('aria-label', 'Explicar ' + grupo.label); info.setAttribute('aria-haspopup', 'dialog');
    info.onclick = () => abrirModalGrupo(grupo, info);
    conjunto.append(filtro, info); (grupo.kind === 'proposta' ? propostas : existentes).append(conjunto);
  }
  document.getElementById('etiquetas-cobertura').textContent = cobertura
    ? `${cobertura.tagged.toLocaleString('pt-BR')} de ${cobertura.total.toLocaleString('pt-BR')} vídeos etiquetados · ${cobertura.needsReview.toLocaleString('pt-BR')} com estrutura a identificar. Classificação sugerida por metadados; um vídeo pode ter várias etiquetas.`
    : 'Atualizando as etiquetas do acervo…';
  atualizarSelecaoGrupos();
}
function atualizarSelecaoGrupos() {
  document.querySelectorAll('[data-grupo]').forEach(button => {
    const ativo = gruposSelecionados.has(button.dataset.grupo);
    button.classList.toggle('ativo', ativo); button.setAttribute('aria-pressed', String(ativo));
  });
  document.getElementById('limpar-grupos').hidden = !gruposSelecionados.size;
}
function etiquetasDoVideo(video) {
  const nomes = (video.tags || ['identificar']).map(id => gruposReceitas.find(g => g.id === id)?.label || id);
  return `<div class="etiquetas-video" title="${textoSeguroGrupo('Etiquetas sugeridas: ' + nomes.join(' · '))}"><span>${textoSeguroGrupo(nomes[0])}</span>${nomes.length > 1 ? `<span>+${nomes.length - 1}</span>` : ''}</div>`;
}
function abrirModalGrupo(grupo, origem) {
  origemModalGrupo = origem;
  const exemplos = TUDO.filter(v => v.tags?.includes(grupo.id)).slice(0, 5);
  document.getElementById('grupo-modal-conteudo').innerHTML = `
    <h2 id="grupo-modal-titulo">${textoSeguroGrupo(grupo.label)}</h2>
    <p class="grupo-introducao">${textoSeguroGrupo(grupo.description)}</p>
    <h3>O que estas receitas têm em comum</h3><p>${textoSeguroGrupo(grupo.common)}</p>
    <h3>Estrutura padrão</h3><ol>${grupo.steps.map(s => `<li>${textoSeguroGrupo(s)}</li>`).join('')}</ol>
    <h3>Como variar sem perder a estrutura</h3><p>${grupo.kind === 'revisao' ? 'Abra a receita original e confira cenas, vozes e montagem antes de atribuir uma estrutura específica.' : 'Mude o tema, os materiais, o ritmo e a direção visual. Preserve a relação entre as etapas descritas acima; é ela que define esta família de receitas.'}</p>
    <h3>${grupo.count ? 'Vídeos associados no acervo' : 'Uma coleção para experimentar'}</h3>
    ${exemplos.length ? `<ul>${exemplos.map(v => `<li>${textoSeguroGrupo(tituloDoCard(v))}<small>${textoSeguroGrupo(v.colecaoCurta)}</small></li>`).join('')}</ul>` : '<p>Ainda não há vídeos associados. Esta proposta descreve uma nova estrutura; nenhuma produção ou coleção foi criada automaticamente.</p>'}
    <p class="grupo-criterio">${grupo.kind === 'revisao' ? 'Nenhuma regra de estrutura encontrou evidência suficiente nos metadados deste grupo.' : 'A associação dos vídeos usa sinais no título, nome da coleção e preset de direção disponível. É uma sugestão: não confirma que cada vídeo segue todas as etapas, nem que um clipe isolado contém a receita completa.'} Todos os grupos podem se combinar com Favoritos e Vídeos finais. Vários grupos selecionados mostram vídeos de qualquer um deles.</p>
    ${grupo.count ? '<button id="ver-grupo" class="ativo">Filtrar este grupo</button>' : ''}`;
  const ver = document.getElementById('ver-grupo');
  if (ver) ver.onclick = () => { gruposSelecionados.clear(); gruposSelecionados.add(grupo.id); aplicar(); modalGrupo.close(); };
  pararPrevia(); modalGrupo.showModal(); document.getElementById('fechar-grupo-modal').focus();
}
document.getElementById('limpar-grupos').onclick = () => { gruposSelecionados.clear(); aplicar(); };
document.getElementById('fechar-grupo-modal').onclick = () => modalGrupo.close();
modalGrupo.addEventListener('close', () => { if (origemModalGrupo?.isConnected) origemModalGrupo.focus(); });
modalGrupo.addEventListener('keydown', event => event.stopPropagation());
modalGrupo.addEventListener('click', event => { if (event.target === modalGrupo) { const r = modalGrupo.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modalGrupo.close(); } });
