# ADR 0037 — Abertura concorrente do Knowledge Store sem renegociação de WAL

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Contexto

O Knowledge Store usa SQLite em WAL para permitir leituras e escritas
concorrentes. Cada processo escritor configurava novamente
`PRAGMA journal_mode=WAL` ao abrir o banco. Quando dois workers iniciavam ao
mesmo tempo, essa renegociação persistente podia disputar o lock antes que
`busy_timeout` fosse aplicado, produzindo `database is locked` em uma operação
que deveria resolver deterministicamente por duplicidade de candidato.

## Decisão

`journal_mode=WAL` é estabelecido somente durante `initializeKnowledgeStore`,
quando o banco é criado ou migrado. A abertura de um banco existente mantém
`busy_timeout`, `foreign_keys`, `synchronous` e `trusted_schema`, mas não altera
uma configuração persistente de journaling.

## Consequências

- workers concorrentes não renegociam uma configuração global antes de entrar
  na transação `BEGIN IMMEDIATE`;
- a unicidade e o comportamento append-only continuam protegidos pela
  transação existente e pelo índice/ledger;
- bancos antigos que não estejam em WAL continuam sujeitos ao contrato de
  inicialização/migração explícita, sem uma mudança silenciosa no momento de
  abrir o store;
- o teste concorrente do ledger permanece a prova de regressão, sem provider,
  sessão, cota ou escrita no banco privado real.
