# Ontologia audiovisual — candidata

> Projeção gerada do dado canônico. Esta ontologia não foi aprovada e não possui autoridade de retrieval, planejamento ou entrada de provedor.

- Título: Vocabulário audiovisual inicial.
- Referência: `audiovisual-core@1`.
- Estado: `candidate`.
- Arquivo canônico: `knowledge/audiovisual-ontology@1.json`.
- SHA-256 do arquivo: `d5291daddadb9a847be9a56c4c2d8332350ad3afb6bb25647207e5fc25114f85`.
- Hash canônico do conteúdo: `828c8c488b9761c8e00d165b758a7499cbc709690a76438c185fae21cb57a573`.
- Revisores: nenhum.
- Revisado em: não.

Resumo: Vocabulário global versionado para nomear contexto, linguagem audiovisual, conhecimento operacional, relações e modalidades epistêmicas sem conceder autoridade de recuperação ou planejamento.

## Autoridade

- Retrieval: `blocked`.
- Planejamento: `blocked`.
- Entrada de provedor: `blocked`.
- Motivo: Esta versão é somente candidata. Validade estrutural não constitui revisão humana, aprovação editorial nem permissão para influenciar retrieval, planejamento ou entrada de provedor.

## Tipos de entidade

### Contexto

| Termo | Definição | Aliases | Gate adicional |
|---|---|---|---|
| `Audience` | Grupo de pessoas para o qual uma comunicação audiovisual é destinada. | `público` | nenhum |
| `Brand` | Identidade representada por regras, sinais e restrições de comunicação próprias. | `marca` | nenhum |
| `Brief` | Declaração estruturada de objetivo, contexto, restrições, público e resultado esperado. | `briefing` | nenhum |
| `Campaign` | Conjunto coordenado de comunicações com objetivo comum, reservado a uso governado por política futura explícita. | `campanha` | `future-explicit-policy` |
| `Channel` | Meio de distribuição com capacidades, limites e convenções próprios. | `canal` | nenhum |
| `Client` | Organização ou pessoa para a qual o trabalho audiovisual é governado e entregue. | `cliente` | nenhum |
| `Deliverable` | Resultado audiovisual contratualmente ou editorialmente definido para entrega. | `entregável` | nenhum |
| `Format` | Configuração editorial e técnica de uma peça, como proporção, duração e organização. | `formato` | nenhum |
| `Person` | Pessoa identificada no contexto da produção, da aprovação ou da representação audiovisual. | `pessoa` | nenhum |
| `Production` | Unidade de realização audiovisual que transforma um brief em um ou mais entregáveis. | `produção` | nenhum |
| `Project` | Escopo organizado de trabalho que reúne objetivos, participantes e produções relacionadas. | `projeto` | nenhum |

### Linguagem audiovisual

| Termo | Definição | Aliases | Gate adicional |
|---|---|---|---|
| `Beat` | Mudança mínima perceptível de intenção, informação, emoção ou ação. | `batida narrativa` | nenhum |
| `Layer` | Elemento composicional ordenado em profundidade ou precedência visual. | `camada` | nenhum |
| `MotionPattern` | Combinação recorrente de primitivas de movimento com função reconhecível. | `padrão de movimento` | nenhum |
| `MotionPrimitive` | Operação elementar de movimento ou transformação que pode compor padrões maiores. | `primitiva de movimento` | nenhum |
| `MotionPrinciple` | Princípio que relaciona comportamento do movimento, percepção e intenção. | `princípio de movimento` | nenhum |
| `NarrativeFunction` | Papel narrativo ou comunicacional exercido por uma unidade audiovisual. | `função narrativa` | nenhum |
| `Scene` | Unidade dramática ou informacional situada em um contexto contínuo reconhecível. | `cena` | nenhum |
| `Sequence` | Conjunto ordenado de cenas que cumpre uma unidade narrativa ou funcional. | `sequência` | nenhum |
| `Shot` | Trecho audiovisual contínuo entre dois cortes ou limites equivalentes. | `plano` | nenhum |
| `SoundGrammar` | Sistema de relações sonoras usado para estruturar ritmo, espaço, ênfase e continuidade. | `gramática sonora` | nenhum |
| `Track` | Faixa temporal que organiza eventos de uma modalidade de mídia. | `faixa` | nenhum |
| `Transition` | Operação temporal ou visual que conecta unidades audiovisuais. | `transição` | nenhum |
| `VisualGrammar` | Sistema de relações visuais usado para produzir continuidade e sentido. | `gramática visual` | nenhum |

### Conhecimento operacional

| Termo | Definição | Aliases | Gate adicional |
|---|---|---|---|
| `Artifact` | Arquivo ou resultado material produzido, usado ou entregue por uma operação. | `artefato` | nenhum |
| `BrandKit` | Conjunto governado de regras, assets e restrições oficiais de uma marca. | `kit de marca` | nenhum |
| `Capability` | Operação suportada sob condições, validade e limites explicitamente declarados. | `capacidade` | nenhum |
| `Decision` | Escolha explícita entre alternativas, com autor, contexto e justificativa rastreáveis. | `decisão` | nenhum |
| `DeliveryProfile` | Contrato técnico de uma variante de entrega, incluindo formato e restrições. | `perfil de entrega` | nenhum |
| `Evaluation` | Análise rastreável de critérios e evidências, sem promoção automática de conhecimento. | `avaliação` | nenhum |
| `Feedback` | Observação append\-only sobre um resultado, sem autoridade automática para alterar ou regenerar. | `retorno` | nenhum |
| `KnowledgeRelease` | Conjunto imutável e identificado de conhecimento governado elegível sob uma decisão externa. | `release de conhecimento` | nenhum |
| `Provider` | Sistema externo ou local que oferece uma capacidade operacional declarada. | `provedor` | nenhum |
| `Receipt` | Registro auditável de uma operação, de suas entradas sanitizadas e de seus resultados. | `recibo` | nenhum |
| `Recipe` | Descrição reutilizável de decisões e etapas que compilam para a espinha Studio existente. | `receita` | nenhum |
| `Reference` | Evidência ou material contextual cuja proveniência, direitos e uso são explicitamente delimitados. | `referência` | nenhum |
| `RenderNode` | Unidade declarativa de renderização ou composição dentro da timeline canônica. | `nó de render` | nenhum |
| `StyleSpec` | Especificação versionada de direção estética e comportamento audiovisual. | `especificação de estilo` | nenhum |
| `ToolAdapter` | Integração governada que traduz uma etapa do plano para uma ferramenta específica. | `adaptador` | nenhum |

## Relações

| Predicado | Definição | Domínio | Range |
|---|---|---|---|
| `approvedBy` | Indica a pessoa responsável por uma aprovação humana explícita. | `Brief`, `Project`, `Production`, `Deliverable`, `Decision`, `KnowledgeRelease` | `Person` |
| `belongsTo` | Indica que uma entidade é governada como parte do escopo de outra. | `Brand`, `Project`, `Production`, `Deliverable`, `Brief`, `Audience`, `Channel`, `Format` | `Client`, `Brand`, `Project`, `Production` |
| `commissionedBy` | Indica quem encomendou ou autorizou a realização de um trabalho. | `Project`, `Production`, `Deliverable` | `Client`, `Brand`, `Person` |
| `deliveredAs` | Indica a forma técnica ou editorial em que uma produção ou artefato é entregue. | `Production`, `Deliverable`, `Artifact` | `Deliverable`, `Format`, `DeliveryProfile`, `Artifact` |
| `derivedFrom` | Indica a origem rastreável da qual uma entidade foi derivada, sem inferir permissão de reutilização. | `Production`, `Deliverable`, `Sequence`, `Scene`, `Shot`, `StyleSpec`, `Recipe`, `Artifact`, `Decision`, `Evaluation` | `Brief`, `Reference`, `Recipe`, `StyleSpec`, `Artifact`, `Receipt`, `Decision`, `Feedback`, `Evaluation` |
| `represents` | Indica a entidade em nome da qual outra entidade se apresenta ou comunica. | `Person`, `Production`, `Deliverable`, `Artifact` | `Client`, `Brand`, `Person`, `Project` |
| `supersedes` | Indica que uma versão ou decisão substitui outra sem reescrever o histórico. | `Brief`, `Deliverable`, `StyleSpec`, `Recipe`, `BrandKit`, `Reference`, `Decision`, `Evaluation`, `KnowledgeRelease` | `Brief`, `Deliverable`, `StyleSpec`, `Recipe`, `BrandKit`, `Reference`, `Decision`, `Evaluation`, `KnowledgeRelease` |
| `targets` | Indica o público, canal ou formato ao qual uma intenção comunicacional se dirige. | `Brief`, `Project`, `Production`, `Deliverable`, `Campaign` | `Audience`, `Channel`, `Format` |
| `usesBrandKit` | Indica o BrandKit governado que deve ser aplicado por uma entidade. | `Project`, `Production`, `Deliverable`, `StyleSpec`, `Recipe` | `BrandKit` |

## Modalidades epistêmicas

Confiança não muda modalidade. Esta lista coincide com `domain-pack@1`.

| Modalidade | Definição | Pode obrigar? |
|---|---|---|
| `fact` | Afirmação verificável sobre um estado ou evento. | `when-verifiable` |
| `capability` | Afirmação sobre suporte operacional válida apenas enquanto suas condições permanecerem atuais. | `while-valid` |
| `hard-constraint` | Restrição mandatória cuja violação torna a alternativa inadmissível. | `yes` |
| `preference` | Escolha desejada por uma pessoa ou escopo, sem força obrigatória por si só. | `no` |
| `heuristic` | Regra prática que pode orientar uma decisão, mas exige contexto e não garante resultado. | `no` |
| `observation` | Descrição rastreável do que foi percebido em uma evidência ou resultado. | `no` |
| `hypothesis` | Proposição ainda não confirmada que deve permanecer explicitamente incerta. | `no` |
| `anti-pattern` | Configuração recorrente associada a risco ou degradação e oferecida como orientação. | `guidance` |

## Changelog

### Versão 1 — `2026-07-24`

- Criação candidata dos três domínios de entidades da seção 9 do plano.
- Inclusão das nove relações iniciais e de seus domínios e ranges declarados.
- Alinhamento estrito das oito modalidades epistêmicas com domain\-pack@1.
- Bloqueio explícito de retrieval, planejamento e entrada de provedor.
