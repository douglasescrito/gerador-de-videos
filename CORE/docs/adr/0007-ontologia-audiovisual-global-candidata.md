# ADR 0007 — Ontologia audiovisual global candidata

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado do vocabulário: candidato
- Data: 2026-07-24
- Escopo: vocabulário técnico global em `CORE/knowledge/`

## Contexto

Clientes, linguagem audiovisual e conhecimento operacional precisam compartilhar
termos estáveis. Isso não exige graph database e não deve criar um segundo banco,
planner, executor ou mecanismo de recuperação.

## Decisão

`knowledge/audiovisual-ontology@1.json` é a fonte canônica da ontologia inicial.
Ela contém exatamente os tipos de entidade, relações e modalidades epistêmicas
da versão 1. O schema é fechado; qualquer extensão do vocabulário exige nova
versão e novo hash.

O loader é provider-free, read-only e determinístico. Ele valida schema,
unicidade, fechamento de referências, modalidades e arquivo regular; também
calcula o SHA-256 dos bytes e o hash do JSON canônico como identificadores.
O Markdown é somente uma projeção gerada.

## Autoridade e isolamento

- a ontologia permanece `candidate`, sem revisores e sem data de revisão;
- validade estrutural não concede aprovação editorial;
- retrieval, planejamento e entrada de provedor permanecem bloqueados;
- o arquivo não é payload persistível do Knowledge Store privado;
- nenhum SQLite, `ScopeGrant`, provider, graph database ou dado de cliente é
  acessado;
- o termo `Campaign` é apenas vocabulário e continua preso ao gate de política
  futura explícita.

## Consequências

O projeto passa a ter um idioma técnico comum, versionável e auditável sem
transformá-lo em autoridade operacional. Uma futura ativação exigirá decisão
humana externa, presa ao hash, e um portão de retrieval próprio; esta ADR não
autoriza essa etapa.

## Alternativas rejeitadas

- termos apenas em Markdown livre;
- ontologia dentro de cada `knowledge.sqlite`;
- graph database;
- ativação automática por validade de schema;
- nova CLI, planner ou serviço para consultar o vocabulário.
