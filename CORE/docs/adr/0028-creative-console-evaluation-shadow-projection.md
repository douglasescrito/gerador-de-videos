# ADR 0028 — Avaliação shadow projetada no Creative Console

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 10
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: `retrieval-shadow-evaluation@1` → `creative-console-snapshot@1`

## Contexto

O Knowledge Core já produz avaliações determinísticas dos casos gold de
retrieval. O Creative Console precisava mostrar se a memória está funcionando,
mas não deve carregar casos privados, escolher conhecimento ou transformar uma
métrica em autorização.

## Decisão

1. O Console aceita opcionalmente uma avaliação já materializada e validada por
   `assertKnowledgeRetrievalEvaluation`.
2. A projeção expõe somente versão do ranker, contagens, taxas, leakage,
   conflitos e o hash da avaliação; os casos, itens e escopos não atravessam a
   superfície do Console.
3. A projeção permanece `read-only`: não altera plano, release, Knowledge Core,
   fila de feedback ou capabilities e fixa `providerCalls=0`.
4. Avaliação ausente é representada por `{ present: false }`; avaliação
   adulterada falha antes de formar o snapshot.

## Limites

O relatório não é ranker editorial, não promove regras, não reordena opções do
planner e não dispara retry ou geração. Preference ranker em shadow e release
governance continuam gates posteriores.

