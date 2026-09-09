# ADR 0026 — Binding de compiler e capability snapshot no execution plan

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 6
- Estado da implementação: primeiro contrato explícito
- Data: 2026-07-27
- Escopo: `execution-plan@1` e `execution-governance@1`

## Contexto

O plano já carregava capabilities por nó para o gate JIT, mas a relação entre
o plano completo, o conjunto de capabilities e a versão do compilador não era
visível como campos de primeira classe. Isso dificultava provar que um replay
usa a mesma semântica e o mesmo snapshot operacional.

## Decisão

1. O compilador publica `compilerVersion` em todo `execution-plan@1` atual.
2. `execution-governance@1` publica `capabilitySnapshotHash`, derivado da lista
   de capabilities e de suas evidências/freshness; o plano repete esse hash.
3. O fingerprint do plano inclui ambos os campos, e
   `assertExecutionPlanIntegrity` falha se a versão ou o hash estiverem
   ausentes/divergentes.
4. O snapshot é provider-free e não constitui sondagem live, autorização paga
   ou renovação de sessão; a autorização JIT continua revalidando cada nó.

## Limites

Planos históricos sem esses campos permanecem legíveis apenas pelas fachadas de
compatibilidade suportadas. Novas execuções não podem ser publicadas sem os
bindings completos.
