# ADR 0022 — Contrato único de adapters e conformance provider-free

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como shadow provider-free
- Estado da implementação: fundação inicial da Fase 9
- Data: 2026-07-27
- Escopo: adapters locais, providers cookie-only e futuras ferramentas externas

## Contexto

Omni, imagem, TTS, música e operações locais possuem superfícies diferentes,
mas o planner e o journal precisam enxergar uma única semântica. Sem um
contrato comum, cada adapter poderia estimar, autorizar, reconciliar e
normalizar resultados de modo incompatível.

## Decisão

1. Todo adapter futuro declara `adapter-contract@1` com identidade, provider,
   operações, modo de autenticação, operações pagas e operações de reconcile.
2. `adapter-invocation@1` congela o pedido, o preflight de capability, a
   estimativa e se há autorização paga. Capability ausente, pendente,
   bloqueada ou indisponível degrada o plano antes de qualquer chamada.
3. `executeAdapterInvocation` não chama operação paga sem autorização JIT e
   callback de runtime explícito. O contrato não cria um segundo executor nem
   substitui o `ExecutionAuthorization`/journal existentes.
4. `adapter-result@1` reduz resultados a estados `ready`, `pending`,
   `ambiguous` ou `failed`, exige receipt para `ready` e nunca transforma
   ambiguidade em retry.
5. `reconcileAdapterInvocation` só chama `adapter.reconcile`; não possui
   fallback para `execute` ou geração. A conformance suite usa doubles locais e
   permanece provider-free.
6. A fonte de capabilities continua sendo o `provider-registry.mjs`; o
   contrato apenas valida e projeta, sem duplicar o registry.
7. O primeiro adapter conformante é `ffmpeg-hybrid-compositor`/`ffmpeg-local`,
   uma projeção não paga do compositor já existente; ele não introduz outro
   executor.

## Limites

Esta etapa não altera os adapters Gemini existentes, não renova sessão, não
faz POST e não promove TTS/Lyria. A integração de cada adapter real exigirá uma
conformance própria, prova de capacidade vigente, autorização e receipts
compatíveis antes de entrar no caminho canônico.
