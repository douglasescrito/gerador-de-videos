# ADR 0030 — Release governance read-only no Creative Console

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como extensão provider-free da Fase 10
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: projeção `active-release` no `creative-console-snapshot@1`

## Contexto

O Knowledge Core já possui lifecycle de release com ativação e rollback
humanos. O Console precisa mostrar se há uma release ativa e elegível, mas não
pode transformar uma inspeção em mutação.

## Decisão

1. O Console aceita somente resultado `action=active-release` do lifecycle
   existente e exige `providerFree=true`, `readOnly=true` e `changed=false`.
2. A projeção expõe apenas status, elegibilidade, id/hash/contagem da release e
   tipos de pendência; não expõe payloads de itens nem abre um segundo store.
3. Resultados de `activate-release` ou `rollback-release` são rejeitados nessa
   superfície.
4. A UI apenas mostra o estado; ativação, rollback e revisão continuam nas
   ações humanas governadas do Knowledge Core.

## Limites

Release governance aqui é observabilidade segura. Não há promoção automática,
alteração de release, consulta privada implícita, geração ou consumo de cota.

