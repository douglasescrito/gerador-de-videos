# ADR 0024 — Resolver de decisão por admissibilidade, preferência e viabilidade

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como fundação shadow provider-free
- Estado da implementação: primeiro contrato executável
- Data: 2026-07-27
- Escopo: decisões de planejamento antes do `film-spec@2`, sem alterar `raw`

## Contexto

O retrieval já filtra escopo, direitos e release, mas uma aplicação audiovisual
inteligente também precisa distinguir três perguntas diferentes: a opção é
admissível, é a preferência correta e pode ser executada agora? Misturar esses
eixos permitira que uma capability indisponível ou uma preferência fraca
vencesse uma restrição forte.

## Decisão

1. `knowledge-decision-resolver.mjs` recebe opções já materializadas e aplica
   admissibilidade primeiro; opções bloqueadas nunca entram no ranking.
2. Entre opções admissíveis, a precedência é determinística: pedido explícito,
   decisão de projeto, cliente, pessoa, fundamento de gênero, heurística e
   sugestão de modelo; depois scope, supersessão, revisão, evidência e ID.
3. A viabilidade não concede autoridade. Se a opção mais preferida estiver
   indisponível, o resultado é `blocked-viability`, alternativas são apenas
   informadas e `requiresReplan=true`.
4. Valores conflitantes no mesmo conjunto, autoridade e scope não são
   “mediados”; o resultado exige decisão humana.
5. O contrato é hash-bound, provider-free, `changed=false` e
   `providerCalls=0`. Ele ainda não é chamado pelo compilador nem influencia
   `raw`; a integração futura deverá materializar decision artifacts antes da
   compilação.
6. A superfície operacional inicial é `knowledge --action decision-shadow`,
   que valida um input privado fora do workspace e não abre `knowledge.sqlite`.

## Limites

O resolver não consulta SQLite, direitos físicos, capabilities live ou
provedores. Essas entradas devem ser obtidas por serviços governados e
congeladas no request. O contrato não promove conhecimento, não cria release,
não gera mídia e não troca silenciosamente de ferramenta.
