# ADR 0040 — Catálogo de técnicas de prompt

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado: decisão de desenho aceita em 2026-08-02. A seleção de técnica
  continua sendo ato humano por invocação.
- Escopo: composição de prompt do modo `studio`, no CLI e no app
- Depende de: [ADR 0002](0002-boundaries-raw-studio-knowledge.md),
  [ADR 0009](0009-autorizacao-direta-de-provider-input.md)

## Contexto

O catálogo de estilos (`style-spec@1`) responde **como a peça se parece**. Não
existe lugar para responder **como o prompt é montado** — e é aí que mora o
conhecimento que custou cota para descobrir:

- vocabulário de cenário físico quebra o flat 2D, e um bloco de verificação por
  clipe segura o desenho como diagrama em movimento;
- listar os beats como `SHOT k OF n` faz o Omni montar vários planos dentro de
  dez segundos, em vez de um plano só;
- com rosto real, o figurino precisa ser travado e enumerado, ou ele deriva
  entre clipes;
- um estado final declarado e estável é o que permite emendar clipes sem que a
  junção leia como corte.

Hoje esse conhecimento vive em três lugares e em nenhum deles é utilizável na
hora de gerar: prosa nos manuais de `docs/guias/`, alguns módulos de código, e a
memória de quem produziu. O resultado é redescobrir a mesma regra gastando
geração paga.

A distribuição preserva os mecanismos técnicos. As evidências de produções
privadas foram retiradas do catálogo; uso anterior não comprova validação
na instalação do destinatário.

## Decisão

### 1. Existe um catálogo de técnicas, irmão do de estilos

`technique-spec@1` é um registro versionado, provider-free, em
`lib/media-pipeline/prompt-techniques.mjs`. Vale o mesmo regime do
`style-spec@1`: conhecimento técnico global versionado no repositório, não item
privado do Knowledge Core.

Cada técnica declara:

- `id` versionado (`nome@n`) e rótulo;
- `problem`: a falha concreta que ela evita, em uma frase;
- `block`: o texto exato do prompt, com slots `{{nome}}`;
- `slots`: nome, tipo, obrigatoriedade e valor padrão;
- `placement` (`before-user` ou `after-user`) e `order`, para composição
  determinística;
- `appliesTo`: estilos, famílias e tasks compatíveis;
- `status`: `concept`, `pilot`, `proven` ou `deprecated`;
- `evidence`: contagem de recibos observados e amostras reais do acervo;
- `risks`: limites conhecidos.

### 2. A sintaxe de slot é a que já existe

Slots usam `{{nome_snake_case}}`, idêntico ao motor de
`prompt-template-library.mjs`. Não há segundo motor de template, segunda
gramática nem segundo compilador.

### 3. Técnica é `studio`, explícita e registrada

Sem `--style`/modo `studio` não há composição, como manda o ADR 0002. Técnica
segue a mesma porta: só entra quando selecionada explicitamente na invocação,
nunca por inferência a partir do texto do usuário.

O recibo registra `userPrompt` e `effectivePrompt` separados, como hoje, e
acrescenta a lista de técnicas aplicadas com id versionado e os valores de slot
usados. Quem lê o recibo consegue reconstruir exatamente o que foi montado.

### 4. Compatibilidade é declarada e verificada

Aplicar uma técnica a um estilo ou task fora de `appliesTo` falha fechado, antes
de qualquer chamada. Uma técnica `concept` não é selecionável para geração live
por padrão, exatamente como um estilo `concept`.

### 5. Evidência é observação, não promessa

`evidence.receiptCount` e `evidence.samples` registram que a técnica foi usada
em produções reais e apontam recibos existentes. Isso **não** é veredito de
qualidade: `status: proven` significa "usada e mantida em produção", não
"validada por avaliação formal". Nenhuma técnica declara veredito humano de
qualidade sem que ele seja registrado por decisão humana explícita.

### 6. O catálogo publicado é derivado

`docs/TECHNIQUE-CATALOG.md` é gerado do registro canônico, como o catálogo de
estilos. Não se edita à mão.

## Consequências

- O conhecimento que custou cota vira seleção na hora de gerar, em vez de
  memória.
- O recibo passa a explicar não só o estilo, mas a montagem.
- Técnica incompatível falha antes de gastar, em vez de produzir peça errada.
- `raw` continua literal e intocado.

## Limites deliberados

- O catálogo não avalia a peça gerada nem sugere técnica automaticamente. Não
  há ranker, score estético nem promoção por contagem.
- `evidence` aponta recibos por caminho relativo; não os copia nem os
  reinterpreta.
- Técnicas cobrem montagem de prompt. Continuidade real entre clipes segue no
  `shot-chain@1`, que já existe e não é substituído aqui.

## Extensão do método documental (04/09/2026)

O mesmo registro publica procedimentos `procedure-spec@1` de planejamento,
áudio e QA por `listProductionTechniques`. `listPromptTechniques` continua
retornando somente blocos; procedimentos não são selecionáveis pelo compositor.
Os parâmetros dos procedimentos apontam para as operações existentes da série.
Isso não cria outro executor nem altera a literalidade de raw.

`validationLevel` e `studyRefs` são eixos de evidência independentes de `status`.
`proven` conserva seu significado de uso mantido. Conflitos declarados entre
blocos são rejeitados antes da composição; riscos contextuais não são elevados
a causas universais. O estudo de geometria está desenhado, não executado.

O CLI oferece `tecnicas --catalog-only true` para consultar definições sem
varrer recibos. A receita da série registra usos e candidatos com hashes; uma
novidade declarada sem documentação é erro de completude, não aprovação tácita.

## Rollback

Remover a seleção de técnicas volta a composição ao estado anterior: estilo mais
prompt literal. Como nada é persistido além do registro no recibo, não há
migração.

## Plano de verificação

1. técnica desconhecida, `deprecated` ou `concept` é recusada antes de compor;
2. técnica fora de `appliesTo` falha fechado com a incompatibilidade nomeada;
3. slot obrigatório ausente falha antes de qualquer chamada;
4. composição é determinística e ordenada por `placement` e `order`;
5. `userPrompt` permanece literal e separado no resultado;
6. modo `raw` ignora técnicas e não altera o prompt;
7. o recibo registra ids versionados e valores de slot;
8. o catálogo publicado deriva do registro e falha se divergir.
