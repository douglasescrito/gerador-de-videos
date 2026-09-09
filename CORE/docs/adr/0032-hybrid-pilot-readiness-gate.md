# ADR 0032 — Gate de prontidão do piloto híbrido

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 8
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: `hybrid-pilot-selection@1` e `hybrid-pilot-readiness@1`

## Contexto

O compositor híbrido está pronto, mas a política exige um clip Omni já
aprovado e um overlay local escolhido por uma pessoa. Não é aceitável preencher
essa seleção automaticamente ou compor um asset sem rights e provenance
verificados.

## Decisão

1. `createHybridPilotSelection` congela seleção humana, scopes, timeline,
   classes de origem e referências a artifacts/receipts.
2. A base deve ser `omni-approved`; o overlay deve ser
   `local-deterministic`; ambos exigem `rightsStatus=allowed`.
3. `verifyHybridPilotSelection` somente lê os arquivos e receipts, recalcula os
   artifacts, exige IDs/hashes exatos e retorna readiness hash-bound.
4. Falhas são `missing` ou `quarantined`; não há fallback, movimentação,
   substituição, composição ou chamada de provider.

## Limites

Readiness não é aprovação de render. A composição continua uma ação Studio
explícita, com manifesto, adapter local, output atômico e cadeia de receipts.

