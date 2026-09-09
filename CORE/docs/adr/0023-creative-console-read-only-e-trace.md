# ADR 0023 — Creative Console read-only, trace e inspector

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como fundação provider-free
- Estado da implementação: primeiro checkpoint da Fase 10
- Data: 2026-07-27
- Escopo: projeção local consumida pelo app e futuras superfícies CLI

## Contexto

O app precisava mostrar o que o Studio sabe, qual plano está congelado, quais
capabilities existem e quais feedbacks aguardam decisão. Expor o payload bruto
do Knowledge Core ou do `execution-plan` criaria vazamento e acoplamento entre
interface e armazenamento.

## Decisão

1. `creative-console-snapshot@1` é uma projeção read-only, hash-bound e
   reconstruível. Ela resume knowledge trace, plan inspector, timeline preview,
   capabilities e fila de feedback sem incluir prompts, statements privados,
   paths, tokens ou payloads de provider. A fila expõe apenas presença, IDs
   sanitizados e contagens; texto original e decisões ficam no ledger governado.
2. A rota única `/api/creative-console/inspect` chama o mesmo serviço puro do
   CORE e não executa, aprova, promove, consulta SQLite ou chama provider.
3. Ações exibidas no snapshot permanecem `canExecute=false`,
   `canPromoteKnowledge=false` e `canApproveDraft=false`; qualquer mutação
   futura deverá atravessar o comando/application service governado existente.
4. A projection aceita `execution-plan@1`, `knowledge-context@1`, trace,
   capability map e fila como entradas já validadas; o timeline preview deriva
   apenas um resumo frame/track de `timeline@1`, `timeline@2` ou Motion IR,
   nunca refaz retrieval, renderiza ou recompõe prompts.

## Limites

O painel React atual apenas apresenta o snapshot e a presença/contagem da fila;
não é ainda um editor de timeline, ranker ou interface de captura/promoção de
feedback. O snapshot não dá autoridade ao usuário nem ao modelo. A próxima
evolução deve conectar captura humana ao application service governado sem
transformar a interface em executor paralelo.
