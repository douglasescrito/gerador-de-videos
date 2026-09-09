# ADR 0011 — Feedback append-only e replay provider-free

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado: aceito para a Fase 4.1
- Data: 2026-07-25
- Escopo: captura de opinião sobre produções governadas

## Contexto

O índice de archive possui nota, tags e comentário mutáveis por receipt. Ele é
útil para operação, mas não preserva a sequência de opiniões, o alvo granular,
o contexto, comparação A/B ou o escopo pretendido de aprendizagem. Transformá-lo
na memória criativa criaria uma fonte de verdade mutável e sem proveniência.

O Knowledge Core já possui um ledger append-only, isolamento por root,
`ScopeGrant`, asset links governados e replay verificável. A Fase 4 deve
especializar essa fundação sem criar outro banco, tabela autoritativa, CLI ou
executor e sem permitir que uma opinião gere mídia.

## Decisão

### 1. A opinião original é um evento imutável

`feedback-event@1` registra:

- root, production scope, autor e texto original;
- target exato por artifact e receipt, ambos presos a item, revisão e content
  hash;
- cena e versão opcionais;
- markers de tempo, frame, região normalizada e track/layer;
- dimensões criativas de vocabulário fechado;
- veredito;
- comparação A/B opcional, preferência e rationale;
- escopo pretendido;
- context hash e timestamp canônico.

O texto não sofre trim, resumo, reescrita ou classificação automática. O ledger
preserva o valor UTF-8 e publica seu SHA-256.

Enquanto `feedback-event@1` não possuir classificação governada própria, sua
presença impõe ao store um piso operacional conservador `restricted` para
backup. Isso não reclassifica nem reescreve o payload: apenas impede que texto
privado arbitrário seja exportado sob uma classificação inferior.

### 2. `knowledge_events` continua a única fonte autoritativa

A captura adiciona `feedback.captured` ao ledger existente. O subject ID é
derivado do hash canônico do payload, e uma captura idêntica no mesmo root falha
sem escrita parcial.

Nenhum `knowledge_item`, candidato, release ou regra ativa é criado nesta
fatia. Não há migration ou índice especializado sem evidência de volume que o
justifique.

### 3. Captura falha fechado

Antes da transação, e novamente dentro do repository único, são verificados:

- confirmação humana explícita;
- `ScopeGrant` de leitura e escrita;
- root e production scope ativos;
- asset links no mesmo root e dentro da produção;
- revisão e content hash exatos no head atual;
- direitos de inventário, retenção e quarentena vigentes;
- artifact e receipt distintos;
- alternativas A/B distintas;
- coerência de markers e região;
- escopo pretendido sem ampliação implícita.

`global-proposal` permanece ancorado no root atual. Ele é uma intenção para
revisão futura, não promoção global. `personal` exige um scope `person` do mesmo
root, mas ainda não afirma que o texto do autor corresponde àquela entidade.

### 4. Listagem e replay são read-only

`list-feedback` e `replay-feedback`:

- percorrem somente `feedback.captured` no root autorizado;
- validam payload, identidade, payload hash e hash-chain;
- preservam a ordem por sequence;
- produzem entries e aggregate hash determinísticos;
- expõem separadamente o autor declarado no feedback, o `eventActor` que
  realizou o append e o `scopeGrantId` pseudônimo;
- não escrevem, promovem, compilam, planejam, abrem sessão ou chamam adapter.

O replay histórico não depende de o scope continuar ativo hoje. Estado corrente
é gate de captura, não reinterpretação retroativa do evento.

### 5. A superfície continua sendo `video -- knowledge`

As ações são:

- `capture-feedback --input ... --confirm-human true`;
- `list-feedback`;
- `replay-feedback`.

O input privado continua fora do workspace. A resposta é tipada por
`knowledge-feedback-action-result@1`.

## Consequências

- opiniões deixam de ser comentários sobrescrevíveis;
- A/B, markers e dimensões podem ser consultados sem gerar;
- cliente, projeto, produção e pessoa permanecem isolados;
- feedback pode ser auditado e reprocessado de forma determinística;
- a futura inteligência ganha uma base de evidência, mas ainda não autoridade
  para aprender ou agir.

## Limites deliberados

- integridade física de arquivos continua na operação read-only `integrity`; a
  captura valida o asset link governado, não executa uma varredura física;
- não existe interpretação automática, `preference-rule`, embedding ou
  retrieval;
- não existe promotion queue, score, decisão, supersessão ou one-shot;
- não existe painel. “Registrar feedback” deve permanecer separado de “Ajustar
  vídeo” quando a interface for criada;
- o review legado do archive não é importado automaticamente.

## Rollback

As ações podem ser removidas da superfície sem apagar eventos já capturados. O
ledger é append-only: não se atualiza ou deleta opinião para desfazer a feature.
Uma correção futura será outro evento ou uma decisão de revisão tipada.
