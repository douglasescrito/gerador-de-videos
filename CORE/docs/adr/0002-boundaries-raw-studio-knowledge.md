# ADR 0002 — Fronteiras entre raw, Studio e Knowledge Core

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado da implementação: contrato de fronteira; cobertura runtime incremental
- Data: 2026-07-23
- Escopo: geração, composição, conhecimento e feedback

## Contexto

O modo `raw` é o contrato simples e compatível do projeto: prompt literal, uma
chamada gerativa por clipe, original e recibo. O modo `studio` oferece
planejamento, composição, áudio, montagem, acabamento, QA e retomada.

A inclusão de Knowledge Core e render HTML aumenta o risco de recursos Studio
entrarem silenciosamente em `raw`, reescreverem o pedido ou provocarem novas
chamadas. Também há risco inverso: acoplar o banco de conhecimento diretamente
a adapters e transformar feedback em ação executável.

## Decisão

`raw`, `studio` e Knowledge Core são fronteiras explícitas, não apenas valores de
uma flag.

### Contrato raw

O caminho `raw`:

- preserva o prompt literal;
- aceita somente as entradas já declaradas pelo contrato;
- realiza uma chamada gerativa por clipe;
- preserva o artefato original e o recibo;
- verifica somente integridade, duração, streams, parâmetros e recibo;
- não consulta Knowledge Core;
- não consulta preferências aprendidas;
- não compõe StyleSpec;
- não usa renderer HTML;
- não executa motion, mix, captions, finish ou QA semântico;
- não regenera, edita ou escolhe outra versão automaticamente.

Primitivos compartilhados de artefato, recibo, transporte, sanitização e
reconciliação podem ser reutilizados. Reutilização de infraestrutura não
autoriza comportamento Studio.

### Contrato Studio

O caminho `studio` é opt-in e pode:

- compor direção por StyleSpec;
- consumir um `knowledge-context@1` congelado;
- planejar keyframes e exigir aprovação;
- renderizar HTML/Canvas local;
- executar áudio, montagem, captions, acabamento e QA explicitamente
  configurados;
- usar o execution journal e retomar por estado;
- preservar todas as entradas e saídas intermediárias.

Knowledge Core não é obrigatório para toda produção Studio. Quando não houver
contexto de conhecimento, o compilador continua operando com `film-spec@2`.

### Contrato Knowledge Core

Knowledge Core:

- armazena evidência, direitos, entidades, feedback, decisões e conhecimento
  promovido;
- recupera contexto dentro do escopo autorizado;
- produz recomendações e artifacts;
- não executa adapters;
- não chama providers;
- não escreve diretamente em film state ou journal;
- não altera prompt durante `run` ou `resume`;
- não promove inferência de modelo sem decisão humana;
- não transforma feedback em geração.

O fluxo permitido é unidirecional:

```text
Knowledge Core → knowledge-context/decision artifact → film-spec → planner

adapters/receipts → evidência observável → candidato de conhecimento
```

O retorno de evidência cria candidato ou evento. Ele nunca modifica
retroativamente o contexto congelado.

## Regra de dependência

As dependências seguem este sentido:

```text
experiência
  → application service
    → creative intelligence
      → Knowledge Core
    → canonical planning
      → execution kernel
        → adapters
```

Exceções precisam de ADR. Em particular:

- módulos de transporte usados por `raw` não importam Knowledge Core, renderer
  HTML nem composição Studio;
- o compilador não importa adapters;
- Knowledge Core não importa adapters ou ferramentas de mídia;
- adapters não consultam Knowledge Core;
- feedback entra pelo application service, nunca por um adapter.

## HTML

HTML/Canvas é:

- exclusivamente `studio`;
- local e determinístico;
- um adapter de render para um nó do plano;
- submetido à timeline, journal, artifact e receipt comuns;
- incapaz de usar rede, cookies, segredos ou filesystem não declarado.

HTML não é:

- um segundo app de produção;
- um planner;
- um executor;
- um caminho para modificar `raw`;
- uma fonte paralela de outputs.

## Feedback

Registrar feedback é provider-free. O evento preserva:

- texto humano original;
- artifact/receipt alvo;
- trecho ou intervalo temporal;
- dimensão;
- escopo escolhido;
- autor e instante;
- interpretação como candidata separada.

Aplicar feedback a uma nova versão exige change impact, novo plano, novo
fingerprint e, se houver nós pagos, nova confirmação explícita.

## Consequências

- O contrato `raw` permanece previsível mesmo quando o Studio ganhar
  inteligência.
- Conhecimento pode evoluir sem adquirir autoridade de execução.
- Testes podem verificar fronteiras de import e comportamento.
- Algumas integrações hoje concentradas no CLI precisarão migrar gradualmente
  para um application service comum.

## Alternativas rejeitadas

- Consultar preferências em toda geração, inclusive `raw`.
- “Melhorar” automaticamente prompts literais.
- Fazer o renderer HTML chamar Omni ou outro provider.
- Usar QA, OCR ou opinião como gatilho de regeneração.
- Dar ao modelo acesso direto ao banco ou ao journal.

## Fitness associada

A Fase 0 cria um sentinela estático para os módulos de transporte do caminho
direto. O teste runtime completo deverá usar spies no application service para
provar simultaneamente:

1. zero consultas ao Knowledge Core;
2. zero composição Studio;
3. exatamente uma submissão gerativa;
4. zero tentativa corretiva.

Esse teste runtime só se torna obrigatório quando o application service
unificado existir; não será simulado por nomes de arquivo.
