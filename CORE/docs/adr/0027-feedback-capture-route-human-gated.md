# ADR 0027 — Rota de captura de feedback com gate humano

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como superfície opcional da Fase 10
- Estado da implementação: primeiro endpoint do app
- Data: 2026-07-27
- Escopo: `/api/creative-console/feedback/capture`

## Contexto

O Knowledge Core já possui `capture-feedback` append-only pela CLI, mas o app
não oferecia uma entrada para uma futura interface de revisão. Criar uma
persistência paralela no app quebraria o repository único e poderia confundir
feedback com autorização de geração.

## Decisão

1. A rota usa `runKnowledgeAction({ action: "capture-feedback" })`, o mesmo
   application service da CLI; não escreve diretamente em SQLite.
2. O DB privado, `rootScopeId`, `coreRoot` e actor são configuração explícita
   do processo, nunca dados fornecidos pelo navegador.
3. Sem configuração a rota falha `503`; sem `confirmHuman: true` falha `400`.
4. O evento é gravado em arquivo temporário fora do workspace, validado pelo
   contrato `feedback-event@1`, capturado com ScopeGrant e removido ao final.
5. O endpoint não chama provider, não altera plano, não interpreta, não promove
   conhecimento e não dispara geração.

## Limites

O painel React ainda não monta automaticamente um evento completo a partir do
player; essa evolução exige target artifact/receipt verificável e escolha
humana explícita. A rota é uma fundação para essa UI, não um executor.
