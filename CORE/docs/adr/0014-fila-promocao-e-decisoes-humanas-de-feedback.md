# ADR 0014 — fila de promoção e decisões humanas de feedback

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Contexto

`feedback-interpretation-candidate@1` é uma hipótese privada e não pode ser
consultada pelo planner, retrieval ou provider. O próximo portão do ciclo de
aprendizagem é oferecer ao revisor um lote pequeno, explicável e reproduzível,
sem transformar prioridade operacional em julgamento estético.

## Decisão

A fila é uma projeção read-only sobre o ledger de eventos existente:

- considera somente candidatos íntegros do mesmo `root_scope_id`;
- exclui decisões terminais (`promote` ou `reject`), mantendo `defer` e
  `request-evidence` como pendências revisáveis;
- ordena por fatores explícitos de `scopeMatch`, risco objetivo,
  `reusePotential`, novidade, evidências e idade, com o `subjectId` como
  desempate determinístico;
- usa `limit=5` por padrão e nunca cria um ranker, score estético ou chamada de
  provider;
- fixa `asOf`, escopo, limite e `queueHash` no input da decisão humana.

Uma decisão é um `feedback-promotion-decision@1` append-only, registrada como
`feedback.interpretation-promotion.decision-recorded` no mesmo hash-chain. O
input prende o candidato por subject, event ID, candidate hash, event hash e
snapshot da fila. O repository revalida esses vínculos dentro de uma única
transação, exige `reviewedBy` igual ao actor autenticado do `ScopeGrant` e
recusa decisões terminais repetidas ou escopo divergente. O snapshot é
temporal: decisões com `decidedAt` posterior a `asOf` não podem alterar o
conteúdo que o revisor viu. Assim, uma decisão terminal posterior somente pode
ser substituída quando a nova decisão aponta explicitamente para o
`supersedesDecisionId` terminal mais recente e usa o snapshot anterior a ele.

`promote` significa somente aprovação humana para a próxima etapa de
canonicalização. Nesta fatia ele não materializa `preference-rule@1`, não cria
item ativo, não altera release, não autoriza retrieval, não influencia planos e
não envia nada a provider. `apply-once` é uma seleção separada, presa ao hash do
plano, à produção exata e a uma expiração posterior à decisão; permanece fora
de releases e não autoriza execução. A supersessão é explícita e preserva o
evento substituído no ledger.

## Consequências

- A atenção do revisor fica limitada por um lote pequeno e auditável.
- A ordem pode ser reproduzida a partir do mesmo snapshot e dos mesmos eventos.
- O ledger continua a única fonte de verdade; não há tabela ou banco paralelo.
- A decisão humana fica separada da autoria textual declarada no feedback.
- A fila continua privada, provider-free e sem efeitos em `raw`.

## Evidência

- `lib/media-pipeline/knowledge-feedback.mjs`;
- `lib/media-pipeline/knowledge-store.mjs`;
- `schemas/knowledge-feedback-promotion-decision.schema.json`;
- `schemas/knowledge-feedback-promotion-action-result.schema.json`;
- `test/knowledge-feedback.test.mjs`.
