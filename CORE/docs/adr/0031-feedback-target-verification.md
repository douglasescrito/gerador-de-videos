# ADR 0031 — Verificação de artifact e receipt no editor de feedback

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como gate provider-free da Fase 10
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: `buildFeedbackEventFromVerifiedTarget` e rota do app

## Contexto

Feedback precisa apontar para a peça exata que uma pessoa revisou. Um editor
que aceitasse apenas IDs ou caminhos poderia registrar opinião contra um arquivo
substituído, um receipt divergente ou uma versão não resolvida.

## Decisão

1. O editor recebe o evento e um envelope efêmero de verificação para artifact,
   receipt e, se houver A/B, os dois vínculos da alternativa.
2. Cada vínculo só passa quando `status=resolved` e `itemId`, `revision` e
   `contentHash` coincidem exatamente com o evento.
3. A função constrói/valida o mesmo `feedback-event@1`; não grava, promove,
   regenera nem envia a provider.
4. A rota de captura do app exige `targetVerification` antes de enviar o evento
   ao application service único do Knowledge Core.

## Limites

O envelope não concede direitos futuros, não substitui ScopeGrant e não valida
conteúdo por si só; ele apenas fecha o binding do target no momento da captura.

