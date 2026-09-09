# ADR 0025 — Decision artifacts hash-bound sem autoridade implícita

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 6
- Estado da implementação: primeiro transporte canônico
- Data: 2026-07-27
- Escopo: `film-spec@2 → execution-plan@1`

## Contexto

O resolver shadow produz uma recomendação determinística, mas uma recomendação
não é uma decisão editorial. O Studio precisa transportar decisões humanas
aprovadas sem copiar texto privado para receipts e sem permitir que um contexto
de Knowledge diferente seja usado por engano.

## Decisão

1. `studio-decision-artifacts@1` contém apenas root, hashes de contexto e
   resolver, referências revisionadas de decisões, opção escolhida, aprovador e
   timestamp. Pergunta, rationale e payload privado permanecem no Knowledge
   Core governado.
2. A criação exige `humanConfirmed=true`, `approvedBy` e `decidedAt`; o resolver
   shadow nunca cria esse artefato sozinho.
3. `film-spec@2` aceita o artefato somente com `contextHash` igual ao contexto
   congelado. O `execution-plan@1` repete a projeção para tornar o fingerprint
   reprodutível.
4. Receipts e recipes continuam carregando apenas os hashes mínimos do contexto;
   nenhuma decisão inicia provider, muda `raw` ou aprova gasto.

## Limites

O artefato não promove conhecimento nem substitui a release do Knowledge Core.
Revogação, rights e capabilities continuam no runtime guard JIT. A futura UI
deve atravessar o application service humano antes de criar novos artefatos.
