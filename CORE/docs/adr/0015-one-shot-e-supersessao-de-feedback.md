# ADR 0015 — one-shot e supersessão temporal de feedback

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Contexto

A fila de promoção já preserva decisões humanas, mas uma revisão pode ocorrer
depois de outro evento terminal e uma preferência pode ser útil somente para a
produção cujo plano foi revisado. Sem uma regra temporal, um snapshot antigo
poderia ser aceito como se ainda descrevesse a fila corrente; sem um vínculo
explícito, uma nova decisão esconderia a decisão anterior.

## Decisão

`feedback-promotion-decision@1` mantém compatibilidade com decisões históricas e
ganha dois campos opcionais:

- `supersedesDecisionId`: uma decisão terminal nova só pode substituir a
  terminal mais recente quando aponta para seu ID, usa um snapshot anterior a
  ela e mantém todos os eventos no ledger;
- `oneShot`: exigido para `action=apply-once`, contendo o hash do plano, a
  `productionId` exata do feedback e uma expiração posterior à decisão.

A projeção da fila considera somente decisões com `decidedAt <= asOf`. Assim o
hash do snapshot representa exatamente o que o revisor podia observar naquele
instante. `apply-once` não é terminal, não remove o candidato, não cria item,
release ou regra e não autoriza execução; é apenas uma seleção humana que um
plano futuro poderá consumir uma vez por seu próprio contrato.

O repository verifica, na mesma transação do append, root, candidato, evento,
hashes, escopo, snapshot temporal, terminal substituída, `productionScopeId`,
actor do `ScopeGrant` e integridade do ledger. Nenhum código de fila chama
provider, planner, retrieval ou executor.

## Consequências

- snapshots históricos são reproduzíveis e não sofrem drift retroativo;
- supersessão é explícita, auditável e reversível por replay do ledger;
- a preferência de uma única peça não contamina conhecimento futuro;
- canonicalização em `preference-rule@1` continua uma operação humana separada;
- consumo efetivo de um one-shot exige integração futura com o plano e o
  journal, sem retry automático.

## Evidência

- `lib/media-pipeline/knowledge-feedback.mjs`;
- `lib/media-pipeline/knowledge-store.mjs`;
- `schemas/knowledge-feedback-promotion-decision.schema.json`;
- `test/knowledge-feedback.test.mjs`.
