# ADR 0016 — canonicalização humana de preferência derivada de feedback

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Contexto

`promote` na fila de feedback é uma aprovação, não um item Knowledge. Para que
uma opinião possa participar de uma release no futuro, é preciso uma operação
humana separada que preserve a origem, a decisão e a evidência sem ativar uma
release automaticamente.

## Decisão

A ação existente da família única `knowledge`,
`canonicalize-feedback-interpretation`, recebe um pedido privado
`feedback-canonicalization-request@1` e exige confirmação humana. O repository
revalida, na mesma transação:

- o evento de decisão `promote`, seu hash e seu event hash;
- o candidato e o event hash do feedback-fonte;
- que a decisão ainda é a terminal mais recente do candidato;
- root, scope ativo, actor e janela do `ScopeGrant`;
- que `global-proposal` não seja transformado em regra global;
- os contratos e referências dos itens a escrever.

A operação grava atomicamente uma evidência `evidence-link@1` e uma revisão
ativa `preference-rule@1` no mesmo root e scope. A regra contém o statement,
dimensões, aplicabilidade, exceções, rationale, IDs e hashes do candidato e da
decisão. A evidência aponta somente para o scope governado e para o feedback
hash-bound; nenhum binário ou referência de provedor é enviado.

O ID da regra é estável por candidato. Canonicalizações posteriores criam nova
revisão com `supersedesRevision`; a operação não cria nem ativa release. Uma
repetição idêntica é read-only idempotente e devolve os itens já existentes.
Uma decisão `reject` ou supersessão posterior impede nova canonicalização até
que exista outra decisão `promote` explícita.

## Consequências

- `promote` e canonicalização têm dois gates humanos independentes;
- releases permanecem controladas por `create/activate-release` e rollback;
- a regra já é um payload canônico pesquisável em um futuro shadow retrieval;
- direitos de provider input continuam `denied` na regra e na evidência;
- não há geração, planner, embedding ou influência automática no Studio.

## Evidência

- `schemas/preference-rule.schema.json`;
- `schemas/knowledge-feedback-canonicalization-request.schema.json`;
- `schemas/knowledge-feedback-canonicalization-action-result.schema.json`;
- `lib/media-pipeline/knowledge-feedback.mjs`;
- `lib/media-pipeline/knowledge-store.mjs`;
- `lib/media-pipeline/knowledge-service.mjs`;
- `test/knowledge-feedback.test.mjs`.
