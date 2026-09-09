# ADR 0034 — Projeção da decisão shadow no Creative Console

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 10
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: `preference-ranker-shadow@1` → `creative-console-snapshot@1`

## Contexto

O Console já mostrava retrieval e release, mas não mostrava a ordem de
precedência que explicava uma decisão. Expor as opções completas poderia
vazar valores privados de preferência; recalcular o ranking no app criaria uma
segunda fonte de verdade.

## Decisão

1. O Console recebe o relatório validado pelo ranker shadow canônico.
2. A projeção contém apenas versão, estado, IDs ordenados, escolha,
   alternativas, pendências, flags de revisão/replan e fingerprint.
3. Valores, razões, hashes de preferência e payloads não atravessam a UI.
4. A projeção continua `changed=false`, `providerCalls=0` e sem capacidade de
   executar, promover ou aprovar.

## Limites

O painel explica a decisão shadow, mas não a transforma em autorização. Conflito
ou indisponibilidade continuam exigindo revisão humana e replan explícito.

