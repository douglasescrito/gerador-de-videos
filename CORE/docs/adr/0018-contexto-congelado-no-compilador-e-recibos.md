# ADR 0018 — Contexto congelado no compilador e nos recibos

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

Status: accepted  
Fase: 6 — integração canônica provider-free

## Decisão

O Studio recebe um `studio-brief@1` opcional e um `knowledge-context@1` já
materializado pelo retrieval read-only. O compilador único valida ambos e cria
um `knowledge-context-binding@1` determinístico. O binding contém somente
identidades, hashes, release, trace, `briefHash`, `authority=none` e
`plannerInfluence=none`.

O `film-spec@2` congela o brief, o contexto e o binding; o
`execution-plan@1` repete a projeção mínima do brief/binding e inclui esses
valores na fronteira de aprovação e no fingerprint. `run` e `resume` carregam
o plano já congelado e não executam retrieval nem recompõem prompts.

Receipts e `recipe@2` registram `briefHash` e `knowledgeContextHash` e, quando
necessário, o binding mínimo. Não copiam payloads privados, texto de itens,
`appliedItems` ou a base SQLite. O runtime guard continua independente e
revalida rights, revocation e capability imediatamente antes do uso.

## Consequências

- O mesmo brief, contexto, decision boundary e versão do compilador geram o
  mesmo plano e fingerprint.
- Alterar contexto, release, rationale, brief ou binding invalida o plano e a
  aprovação; exige nova compilação e confirmação humana.
- `raw` não importa o Knowledge Core nem consulta contexto. O módulo de
  boundary é provider-free e não abre SQLite.
- Revogação atual não reabre o contexto criativo; ela apenas bloqueia o nó
  ainda não iniciado quando o runtime guard detecta a mudança.
- A integração não autoriza embeddings, advisor externo, HTML motion ou novos
  providers; esses permanecem gates posteriores.

## Não decisões

Não se criou outro planner, compilador, banco, retrieval durante `run/resume`,
ou mecanismo de retry. O contexto completo só existe no plano Studio já
autorizado; receipts/recipes recebem a projeção hash-bound mínima.

