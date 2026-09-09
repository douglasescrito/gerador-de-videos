# ADR 0033 — Ponte da seleção pronta para o manifesto híbrido

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 8
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: `buildHybridCompositionManifestFromPilot`

## Contexto

Após a seleção humana e a verificação de artifacts/receipts, ainda seria fácil
montar manualmente um manifesto divergente da seleção aprovada. Isso criaria
risco de trocar arquivo, timeline ou overlay entre o gate e a composição.

## Decisão

1. A ponte exige selection e readiness com o mesmo fingerprint e `ready=true`.
2. Ela materializa diretamente o `hybrid-composition@1` canônico já existente,
   com uma base, um overlay alpha e parâmetros explícitos de frame/posição.
3. O manifesto carrega os fingerprints da seleção/readiness em metadata e
   continua Studio-only; não executa FFmpeg, não cria planner e não chama
   provider.
4. Readiness ausente, não pronta ou adulterada falha antes de qualquer plano de
   composição.

## Limites

A ponte prepara o input do compositor; a composição real ainda precisa ser
solicitada explicitamente e publicar seus próprios artifacts e receipts.

