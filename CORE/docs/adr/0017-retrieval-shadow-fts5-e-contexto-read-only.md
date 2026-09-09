# ADR 0017 — Retrieval FTS5 em shadow mode e contexto read-only

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Status

Aceita para a Fase 5, provider-free.

## Decisão

O primeiro retrieval do Studio será lexical, explicável e somente em shadow
mode. O `KnowledgeStoreRepository` abre o snapshot read-only, verifica o ledger,
resolve a release ativa e passa os itens governados ao módulo
`knowledge-retrieval.mjs`. O próprio repository é o único owner de SQLite e
reconstrói uma tabela FTS5 efêmera em memória para cada consulta; o índice não é
fonte de verdade, não é persistido e pode ser descartado sem perda.

Antes do FTS5, o pipeline exclui qualquer item que não esteja na release ativa,
fora do scope solicitado, inativo, expirado ou sem
`governance.rights.textualIndexing = allowed`. Nenhuma exclusão pode ser
substituída por fallback de nome, path, root ou direito desconhecido.

Cada consulta produz `retrieval-trace@1` e `knowledge-context@1`, ambos
hash-bound. O contexto registra itens, exclusões, filtros, conflitos, overrides,
rationale, release e `rankerVersion`, mas declara `authority: none` e
`plannerInfluence: none`. A ação pública é somente
`knowledge --action retrieval-shadow`; ela não escreve no store, não altera
release, `film-spec@2`, plano, receipt ou output e não chama provider.

Comparadores de conflito são tipados. Regras com a mesma chave semântica e
valores incompatíveis permanecem `unresolved-conflict`; somente uma relação de
scope ancestral/descendente produz `resolved-override`, com vencedor e perdedor
registrados no trace. Desigualdade incidental de JSON não cria conflito.

## Consequências

- O valor do retrieval pode ser medido com briefs dourados sem contaminar a
  produção atual.
- Embeddings, expansão relacional e influência no planner continuam gates
  posteriores.
- O contexto já possui contrato estável para a Fase 6, mas não tem autoridade
  criativa nesta fase.
- A projeção FTS5 é reconstruível e não entra no backup como fonte canônica.

## Evidência

- `lib/media-pipeline/knowledge-retrieval.mjs`;
- `lib/media-pipeline/knowledge-store.mjs`;
- `schemas/knowledge-retrieval-request.schema.json`;
- `schemas/knowledge-retrieval-trace.schema.json`;
- `schemas/knowledge-context.schema.json`;
- `schemas/knowledge-retrieval-action-result.schema.json`;
- `test/knowledge-retrieval.test.mjs`.

