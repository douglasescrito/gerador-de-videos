# ADR 0029 — Preference ranker em shadow

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como checkpoint provider-free da Fase 10
- Estado da implementação: implementado
- Data: 2026-07-27
- Escopo: `preference-ranker-shadow@1`

## Contexto

O resolver de decisão já separa admissibilidade, preferência e viabilidade,
mas seu resultado ainda não tinha uma projeção explícita para avaliação e
observabilidade. Criar uma segunda lógica de precedência abriria risco de duas
fontes de verdade.

## Decisão

1. `buildPreferenceRankerShadow` recebe o request e a resolution do resolver
   canônico e exige o mesmo `requestFingerprint`.
2. A projeção preserva a ordem determinística, opções admissíveis/bloqueadas,
   alternativas viáveis, estado de conflito/replan e fingerprints.
3. `authority=none`, `plannerInfluence=none`, `changed=false` e
   `providerCalls=0` são invariantes do contrato.
4. O ranker não promove conhecimento, não ativa release, não muda plano e não
   decide por empate ou conflito humano.

## Limites

Esse artefato é observabilidade e avaliação shadow. A resolução continua
dependente de revisão humana quando exigida; release governance, promoção e
qualquer influência no planner permanecem gates posteriores.

