// Taxonomia de navegação: projeção de metadados, sem promoção de conhecimento.
export const GRUPOS = [
  {
    "id": "motion",
    "label": "Motion gráfico",
    "description": "Formas, composição e movimento organizam a mensagem.",
    "steps": [
      "Entrada gráfica",
      "Desenvolvimento por formas e transições",
      "Composição final"
    ],
    "common": "Elementos gráficos conduzem a peça; cortes e movimentos têm função na explicação.",
    "pattern": "motion|kinetic|cinet|flat|hyperframes|tipograf|word.sync",
    "kind": "existente"
  },
  {
    "id": "apresentador",
    "label": "Apresentador",
    "description": "Uma pessoa é o ponto de contato com o público.",
    "steps": [
      "Apresentação da ideia",
      "Demonstração ou fala para a câmera",
      "Fechamento direto"
    ],
    "common": "A presença recorrente de um apresentador conecta os trechos.",
    "pattern": "apresentador|presenter|selfie",
    "kind": "existente"
  },
  {
    "id": "narrado",
    "label": "Narrado",
    "description": "Uma voz conduz imagens que complementam a fala.",
    "steps": [
      "Pergunta ou afirmação inicial",
      "Narração com imagens de apoio",
      "Síntese falada"
    ],
    "common": "A locução estrutura a sequência; o texto em tela reforça a fala.",
    "pattern": "narrad|narrac|locuc|audio.first|voz.off|voice.over",
    "kind": "existente"
  },
  {
    "id": "dialogo",
    "label": "Diálogo",
    "description": "A troca de falas desenvolve a ideia.",
    "steps": [
      "Situação ou pergunta",
      "Alternância de pontos de vista",
      "Resposta ou acordo"
    ],
    "common": "Duas ou mais vozes se respondem e fazem a narrativa avançar.",
    "pattern": "dialog|dueto|podcast|duas.vozes|dual.voice|radionovela",
    "kind": "existente"
  },
  {
    "id": "comercial",
    "label": "Comercial",
    "description": "Uma promessa é demonstrada e termina em convite.",
    "steps": [
      "Necessidade ou desejo",
      "Benefício em ação",
      "Marca e chamada"
    ],
    "common": "A progressão liga uma necessidade à proposta de um produto ou serviço.",
    "pattern": "comercial|commercial|marketing|propaganda|spot|anuncio",
    "kind": "existente"
  },
  {
    "id": "aula",
    "label": "Aula",
    "description": "O conteúdo avança em passos compreensíveis.",
    "steps": [
      "Objetivo de aprendizagem",
      "Explicação e exemplo",
      "Recapitulação"
    ],
    "common": "Há uma progressão didática entre conceito, demonstração e conclusão.",
    "pattern": "aula|didatic|explic|ensina|contando|contagem|tutorial",
    "kind": "existente"
  },
  {
    "id": "historia",
    "label": "História",
    "description": "Uma situação muda ao longo da peça.",
    "steps": [
      "Personagem e situação",
      "Tensão ou descoberta",
      "Consequência"
    ],
    "common": "A sequência tem causa e efeito, com uma mudança reconhecível no final.",
    "pattern": "historia|histories|curta|conto|narrativa|livro.animado|episodio",
    "kind": "existente"
  },
  {
    "id": "musical",
    "label": "Musical",
    "description": "O ritmo musical orienta entradas, pausas e encerramento.",
    "steps": [
      "Motivo musical",
      "Desenvolvimento rítmico",
      "Arremate sonoro"
    ],
    "common": "A música organiza a timeline e não funciona apenas como fundo.",
    "pattern": "musical|music.first|videoclipe|videoaula.que.e.trilha|frases.musica",
    "kind": "existente"
  },
  {
    "id": "cinematico",
    "label": "Cinemático",
    "description": "Luz, enquadramento e atmosfera conduzem a experiência.",
    "steps": [
      "Estabelecimento do ambiente",
      "Revelação por planos",
      "Imagem de resolução"
    ],
    "common": "A direção de câmera e a progressão visual constroem atmosfera.",
    "pattern": "cinematic|cinemat|trailer|imersiv|immersiv|nolan",
    "kind": "existente"
  },
  {
    "id": "tres-estilos",
    "label": "Uma ideia, três estilos",
    "description": "Um conceito permanece; três linguagens visuais mudam.",
    "steps": [
      "Ideia comum",
      "Versões A, B e C",
      "Comparação final"
    ],
    "common": "Texto e intenção são comparáveis; materiais, composição e movimento variam de verdade.",
    "pattern": "uma.ideia.tres.estilos|mesma.frase|comparacao.*estilos",
    "kind": "proposta"
  },
  {
    "id": "microdocumentario",
    "label": "Microdocumentários",
    "description": "Uma descoberta real é explicada com contexto e evidências.",
    "steps": [
      "Pergunta",
      "Observação e contexto",
      "Descoberta e conclusão"
    ],
    "common": "O relato conecta observação, informação verificável e uma conclusão delimitada.",
    "pattern": "microdocument|documentario|documentary|\\bdoc\\b",
    "kind": "proposta"
  },
  {
    "id": "objetos-explicam",
    "label": "Objetos que explicam",
    "description": "Objetos tornam uma ideia abstrata visível.",
    "steps": [
      "Objeto e conceito",
      "Transformação ou demonstração",
      "Relação explicada"
    ],
    "common": "A posição, função ou transformação do objeto demonstra o conceito.",
    "pattern": "objetos.que.explicam|objeto.*conceito",
    "kind": "proposta"
  },
  {
    "id": "sem-fala",
    "label": "Histórias sem fala",
    "description": "A narrativa pode ser compreendida sem diálogo ou locução.",
    "steps": [
      "Situação visual",
      "Ação e reação",
      "Resolução visual"
    ],
    "common": "Ações, expressões e som ambiente carregam o sentido; voz não é necessária.",
    "pattern": "historias.sem.fala|narrativa.sem.voz|silent.story",
    "kind": "proposta"
  },
  {
    "id": "dialogos-improvaveis",
    "label": "Diálogos improváveis",
    "description": "Vozes inesperadas confrontam pontos de vista.",
    "steps": [
      "Encontro improvável",
      "Contraste de ideias",
      "Virada ou síntese"
    ],
    "common": "Personagens, objetos ou conceitos personificados conversam sobre a mesma questão.",
    "pattern": "dialogos.improvaveis|voz.da.consciencia",
    "kind": "proposta"
  },
  {
    "id": "antes-depois",
    "label": "Antes e depois",
    "description": "Uma mudança fica clara pela comparação.",
    "steps": [
      "Estado inicial",
      "Processo ou intervenção",
      "Estado final comparável"
    ],
    "common": "O mesmo objeto ou situação aparece antes e depois, com diferença legível.",
    "pattern": "antes.e.depois|before.and.after",
    "kind": "proposta"
  },
  {
    "id": "miniaturas",
    "label": "Mundos em miniatura",
    "description": "Uma pequena escala cria um universo expressivo.",
    "steps": [
      "Revelação da escala",
      "Ação no pequeno mundo",
      "Plano de descoberta"
    ],
    "common": "Cenário, materiais e câmera reforçam a escala reduzida de forma consistente.",
    "pattern": "miniatura|miniature|diorama",
    "kind": "proposta"
  },
  {
    "id": "uma-tomada",
    "label": "Anúncios de uma tomada",
    "description": "Uma ação contínua apresenta a proposta comercial.",
    "steps": [
      "Ação começa",
      "Produto e benefício se revelam",
      "Fechamento no mesmo plano"
    ],
    "common": "A continuidade de espaço, tempo e câmera sustenta a peça sem cortes.",
    "pattern": "uma.tomada|plano.sequencia|one.take",
    "kind": "proposta"
  },
  {
    "id": "humor",
    "label": "Humor cotidiano",
    "description": "Uma situação familiar termina numa quebra de expectativa.",
    "steps": [
      "Situação reconhecível",
      "Escalada ou mal-entendido",
      "Virada curta"
    ],
    "common": "O humor nasce da situação e do tempo da revelação.",
    "pattern": "humor|comedia|comedy|comico",
    "kind": "proposta"
  },
  {
    "id": "tipografia",
    "label": "Experimentos tipográficos",
    "description": "As palavras são também os protagonistas visuais.",
    "steps": [
      "Palavra ou frase central",
      "Variação de escala, ritmo e composição",
      "Leitura final clara"
    ],
    "common": "Tipografia, hierarquia e movimento formam a ação; a legibilidade é parte da estrutura.",
    "pattern": "tipograf|typograph|word.sync|word.by.word|letreiro|kinetic|cinet",
    "kind": "proposta"
  },
  {
    "id": "identificar",
    "label": "Estrutura a identificar",
    "description": "O arquivo está etiquetado, mas sua estrutura ainda não foi identificada.",
    "steps": [
      "Consultar a receita de origem",
      "Identificar a sequência e o papel do áudio",
      "Revisar o grupo adequado"
    ],
    "common": "Este é um grupo de revisão, não uma afirmação de semelhança criativa.",
    "pattern": "",
    "kind": "revisao"
  }
];

const normalizar = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]+/g, ' ');
const regras = GRUPOS.filter(g => g.pattern).map(g => [g.id, new RegExp(g.pattern)]);
export function etiquetarVideo(video) {
  const texto = normalizar([video.title, video.collectionName, video.collectionId, video.directionPreset?.id || video.directionPreset].filter(v => typeof v === 'string').join(' '));
  const tags = regras.filter(([, regra]) => regra.test(texto)).map(([id]) => id);
  return tags.length ? tags : ['identificar'];
}

export function classificarCatalogo(catalogo) {
  const counts = Object.fromEntries(GRUPOS.map(g => [g.id, 0]));
  for (const video of catalogo.videos) {
    video.tags = etiquetarVideo(video);
    for (const tag of video.tags) counts[tag]++;
  }
  catalogo.groups = GRUPOS.map(({pattern, ...grupo}) => ({...grupo, count: counts[grupo.id]}));
  catalogo.tagging = {version: 1, method: 'metadata-inference', total: catalogo.videos.length, tagged: catalogo.videos.length, needsReview: counts.identificar};
}
