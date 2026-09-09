// Estruturas descrevem progressão e exigem conteúdo fornecido. Não inventam
// fatos nem executam mídia; todas resultam no programa da Receita Mestre.
const structures = {
  linear: { fields: {}, beats: [["abertura", "Apresente o tema e estabeleça o motivo visual."], ["desenvolvimento", "Desenvolva a mensagem por transformação progressiva do motivo."], ["fechamento", "Resolva a transformação e sustente a mensagem até o corte."]] },
  revelacao: { fields: {}, beats: [["pista", "Mostre um detalhe parcial e preserve o contexto para a revelação."], ["revelacao", "Amplie o enquadramento e revele a relação do detalhe com a mensagem."], ["resolucao", "Reúna detalhe e contexto em uma composição final legível."]] },
  lista: { fields: {}, beats: [] },
  produto: { fields: { problem: "text", demonstration: "list", benefit: "text" }, beats: [["problema", "Torne observável o problema fornecido.", "problem"], ["demonstracao", "Mostre a operação descrita do produto, sem inventar funcionalidades.", "demonstration"], ["beneficio", "Relacione a demonstração ao benefício declarado, sem criar prova ou resultado.", "benefit"]] },
  comparacao: { fields: { criterion: "text", alternativeA: "text", alternativeB: "text", conclusion: "text" }, beats: [["criterio", "Estabeleça o mesmo critério de comparação para as duas alternativas.", "criterion"], ["alternativa-a", "Apresente a primeira alternativa sob esse critério.", "alternativeA"], ["alternativa-b", "Apresente a segunda alternativa com enquadramento e escala equivalentes.", "alternativeB"], ["conclusao", "Exponha somente a conclusão fornecida, sem inventar superioridade ou números.", "conclusion"]] },
  tutorial: { fields: { outcome: "text", steps: "list" }, beats: [["resultado", "Mostre o resultado que o tutorial pretende ensinar.", "outcome"], ["passo", "Demonstre esta ação na ordem fornecida, mostrando o que muda.", "steps"]] },
  entrevista: { fields: { question: "text", answer: "text", followUp: "text", closing: "text" }, beats: [["pergunta", "Apresente a pergunta fornecida sem atribuir falas a uma pessoa não autorizada.", "question"], ["resposta", "Desenvolva a resposta fornecida; não fabricar depoimento.", "answer"], ["aprofundamento", "Aprofunde pelo ponto informado, mantendo o contexto da resposta.", "followUp"], ["encerramento", "Encerre a entrevista com o texto fornecido.", "closing"]] },
  documental: { fields: { context: "text", observations: "list", conclusion: "text" }, beats: [["contexto", "Situe o contexto factual informado. Não apresentar reconstrução como registro real.", "context"], ["observacao", "Ilustre esta observação sem inventar fonte, data ou evidência.", "observations"], ["sintese", "Relacione as observações à conclusão fornecida.", "conclusion"]] },
  manifesto: { fields: { thesis: "text", principles: "list", commitment: "text" }, beats: [["tese", "Afirme a tese fornecida com hierarquia tipográfica clara.", "thesis"], ["principio", "Materialize este princípio em uma ação visual concreta.", "principles"], ["compromisso", "Conclua com o compromisso declarado, sem promessas adicionais.", "commitment"]] },
  virada: { fields: { situation: "text", expectation: "text", turn: "text", resolution: "text" }, beats: [["situacao", "Estabeleça a situação fornecida.", "situation"], ["expectativa", "Construa a expectativa antes de revelar sua mudança.", "expectation"], ["virada", "Mostre a mudança de interpretação descrita.", "turn"], ["resolucao", "Resolva a história pela consequência fornecida.", "resolution"]] },
  humor: { fields: { setup: "text", escalation: "list", payoff: "text" }, beats: [["preparacao", "Estabeleça a situação cômica fornecida sem antecipar o desfecho.", "setup"], ["escalada", "Eleve a incongruência pelo acontecimento informado, preservando continuidade.", "escalation"], ["desfecho", "Entregue o desfecho visual fornecido e reserve uma pausa de leitura.", "payoff"]] },
  serie: { fields: { seriesTitle: "text", episodeTitle: "text", premise: "text", development: "list", nextEpisodeHook: "text" }, beats: [["serie", "Retome a identidade da série e apresente o episódio.", "seriesTitle", "episodeTitle"], ["premissa", "Estabeleça a questão particular deste episódio.", "premise"], ["desenvolvimento", "Avance este ponto do episódio sem repetir a abertura.", "development"], ["continuidade", "Conclua com o gancho fornecido para a continuação, sem inventar outro episódio.", "nextEpisodeHook"]] },
};

export function listRecipeStoryStructures() {
  return Object.entries(structures).map(([id, { fields, beats }]) => ({ id, fields: structuredClone(fields), stages: beats.map(([id, direction]) => ({ id, direction })), providerCalls: 0 }));
}

export function prepareRecipeStory({ brief, structure = "linear", story = {} }) {
  if (!story || typeof story !== "object" || Array.isArray(story)) throw new Error("story deve ser um objeto.");
  let reason = "Estrutura explicitamente selecionada.";
  if (structure === "auto") {
    const intent = String(brief.intent ?? brief.genre ?? "").trim().toLowerCase();
    const candidates = Object.entries(structures).filter(([, value]) => Object.keys(value.fields).length && Object.keys(value.fields).every((key) => Object.hasOwn(story, key)) && Object.keys(story).every((key) => Object.hasOwn(value.fields, key))).map(([id]) => id);
    structure = candidates.includes(intent) ? intent : candidates.length === 1 ? candidates[0] : Object.hasOwn(structures, intent) ? intent : "linear";
    reason = candidates.includes(intent) ? "Intenção do brief e campos narrativos compatíveis." : candidates.length === 1 ? "Única estrutura compatível com os campos narrativos fornecidos." : "Intenção explícita do brief ou estrutura linear padrão.";
  }
  const definition = Object.hasOwn(structures, structure) ? structures[structure] : null;
  if (!definition) throw new Error(`--structure inválida; use auto ou ${Object.keys(structures).join(", ")}. Consulte recipe structures.`);
  const unknown = Object.keys(story).filter((key) => !Object.hasOwn(definition.fields, key));
  if (unknown.length) throw new Error(`Campos narrativos desconhecidos para ${structure}: ${unknown.join(", ")}.`);
  const text = (value, label) => {
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 2000 || /[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new Error(`${label} exige texto normalizado entre 1 e 2000 caracteres, sem controles proibidos.`);
    return value;
  };
  for (const [key, type] of Object.entries(definition.fields)) {
    if (type === "list") {
      if (!Array.isArray(story[key]) || !story[key].length || story[key].length > 24) throw new Error(`${structure}.${key} exige de 1 a 24 itens.`);
      story[key].forEach((value, index) => text(value, `${structure}.${key}[${index}]`));
    } else text(story[key], `${structure}.${key}`);
  }
  const texts = [...new Set([brief.message, ...brief.requiredText].filter(Boolean))];
  const stages = structure === "lista"
    ? texts.map((value, index) => ({ id: `item-${index + 1}`, direction: "Apresente este item com hierarquia própria e continuidade visual.", facts: [], onScreen: [value] }))
    : definition.beats.flatMap(([id, direction, ...fields]) => {
      const listField = fields.find((field) => definition.fields[field] === "list");
      const entries = listField ? story[listField] : [null];
      return entries.map((entry, index) => ({ id: listField ? `${id}-${index + 1}` : id, direction, facts: fields.map((field) => field === listField ? entry : story[field]), onScreen: [] }));
    });
  if (!stages.length) throw new Error("lista exige message ou requiredText.");
  if (structure !== "lista") {
    texts.forEach((value, index) => stages[index % stages.length].onScreen.push(value));
    if (structure === "revelacao") stages[1].onScreen.unshift(...stages[0].onScreen.splice(0));
  }
  if (brief.cta) {
    if (structure === "lista") stages.push({ id: "chamada", direction: "Encerre com a chamada fornecida até o corte.", facts: [], onScreen: [brief.cta] });
    else stages.at(-1).onScreen.push(brief.cta);
  }
  return { structure, reason, stages, story: structuredClone(story) };
}
