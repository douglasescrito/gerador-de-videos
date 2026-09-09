# ADR 0035 — Piloto D de aprendizagem provider-free

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Status

Aceito como evidência de laboratório isolado; não promove conhecimento privado
do workspace nem altera uma release real.

## Contexto

O plano exige demonstrar que uma opinião humana pode percorrer o ciclo completo
sem virar regeneração automática: comparação A/B, preservação do texto original,
interpretação candidata, escolha de escopo, promoção humana, release, retrieval
em um brief seguinte e rollback.

O Piloto C continua dependente de um clipe Omni real com aprovação e direitos
confirmados. O Piloto D não deve esperar esse asset nem chamar provider.

## Decisão

`feedback-learning-pilot.mjs` executa o ciclo em um Knowledge Store temporário,
com scopes `client → project → production → deliverable`, dois assets sintéticos
com links governados e um feedback A/B. O candidato permanece privado até a
decisão `promote`; a canonicalização cria apenas a regra e a evidência do
projeto. Uma release baseline é ativada antes da release aprendida, a regra é
recuperada em shadow mode e o rollback CAS retorna à release ancestral.

O relatório `mkt-videos/feedback-learning-pilot@1` registra somente hashes,
IDs, escopo, contexto e estados. Ele exige `providerCalls=0`,
`originalTextPreserved=true`, `plannerInfluence=none`, integridade válida e
rollback verificado. O fixture é descartável e não escreve no Knowledge Core
privado do usuário.

## Consequências

- prova-se o ciclo de aprendizagem sem criar um segundo planner ou executor;
- a preferência promovida só alcança o projeto explicitamente escolhido;
- o contexto do brief seguinte é hash-bound e continua sem autoridade implícita;
- a evidência não substitui a revisão humana do conteúdo real nem libera o
  Piloto C ou qualquer chamada paga.

## Evidência

- `lib/media-pipeline/feedback-learning-pilot.mjs`;
- `scripts/run-feedback-learning-pilot.mjs`;
- `test/feedback-learning-pilot.test.mjs`;
- Relatórios locais de teste são produzidos pelo operador e não acompanham o pacote.

