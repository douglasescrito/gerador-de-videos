# ADR 0019 — Convergência do executor, replay e ponte legada

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita para rollout provider-free
- Estado da implementação: checkpoint da Fase 6A
- Data: 2026-07-27
- Escopo: `execution-journal@1`, `film-state@1` e `executor-rollout.mjs`

## Contexto

O journal já era a autoridade transacional para novas tentativas, mas a
fachada legada ainda podia migrar estados sem preservar `skipped`, handles ou
uma projeção comparável entre execuções. Isso tornava o shadow rollout difícil
de auditar e deixava tipos de nó futuros sem um bloqueio explícito contra o
executor legado.

## Decisão

1. A migração de `film-state@1` para o journal é uma ponte somente de leitura
   sobre o estado de origem: receipts e outputs históricos nunca são reescritos.
2. Eventos `legacy_node_migrated` preservam status terminal/ambíguo,
   `attempts`, `attemptId`, `providerHandle`, output, receipt e erro sanitizado.
3. Quando o estado não fornece timestamp, a ponte usa timestamp determinístico
   derivado da posição do nó; duas migrações iguais produzem o mesmo replay
   hash.
4. `replayExecutionJournal` reconstrói uma projeção estável dos eventos. A
   projeção exclui path, IDs de evento e relógio de runtime, mas não cria uma
   segunda fonte de estado.
5. `compareExecutorState`, `reconcileExecutorHandles` e o corpus de replay são
   report-only. Divergência bloqueia a promoção para `journal`; nenhum reparo,
   retry ou POST é inferido.
6. Um plano com tipo de nó não conhecido pela fachada legada falha fechado para
   o executor legado. A execução de um novo tipo deve atravessar o journal e o
   kernel canônicos.
7. Rollback é uma seleção explícita da fachada histórica, preserva o journal,
   handles, receipts e outputs, e devolve fingerprint da decisão sem mutação.

## Fault injection e idempotência

Os limites transacionais existentes continuam sendo exercitados antes do
commit, após consumo de autorização, após criação da effect authorization e
após inserção de evento. O replay e a migração são provider-free; uma falha
ambígua não autoriza nova tentativa. A migração usa uma chave determinística e
é idempotente quando o mesmo `film-state@1` é reapresentado.

## Consequências

- o shadow rollout passa a comparar estado e handles, não apenas conclusão;
- estados históricos permanecem consultáveis e retomáveis pela ponte suportada;
- a promoção para o journal pode ser bloqueada por evidência concreta;
- timeline@2, HTML motion e novos adapters continuam fora do escopo deste gate.

