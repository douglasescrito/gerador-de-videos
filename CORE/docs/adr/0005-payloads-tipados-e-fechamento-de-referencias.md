# ADR 0005 — Payloads tipados e fechamento explícito de referências

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado da implementação: implementada na Fase 1
- Data: 2026-07-24
- Escopo: Knowledge Items, referências, releases, export e replay

## Contexto

O `knowledge_items` já distinguia `entity`, `relation`, `assertion`,
`evidence`, `rights` e `decision`, mas um `payload` JSON livre permitia que o
`recordType` e o `schemaId` fossem apenas rótulos. Isso tornava possível gravar
relações sem destinos verificáveis, owners de outro root e releases que não
incluíam suas dependências.

Criar tabelas distintas para cada tipo duplicaria o ledger e o lifecycle de
revisões. Aceitar IDs implícitos em qualquer campo também faria retrieval e
replay adivinharem o que deve ser dereferenciado.

## Decisão

Os seis tipos canônicos possuem um contrato de payload:

| Record type | Payload |
|---|---|
| `entity` | `entity-profile@1` |
| `relation` | `knowledge-relation@1` |
| `assertion` | `knowledge-assertion@1` |
| `evidence` | `evidence-link@1` |
| `rights` | `rights-record@1` |
| `decision` | `creative-decision-record@1` |

`knowledge-reference@1` é a única forma dereferenciável. Uma referência é:

- `scope`, com root e ID; ou
- `item`, com root, ID, revisão, record type e content hash exatos.

Campos extensíveis como `attributes`, `value`, `qualifiers` e `impact` podem
conter dados de domínio, mas strings parecidas com IDs nesses campos continuam
opacas. Somente campos `*Ref` declarados pelo contrato criam dependência.

`knowledge-asset-link-payload@1` permanece um payload especializado
persistível de `relation`. Sua escrita continua restrita à API específica, que
também valida localização, ID derivado e imutabilidade.

## Binding transacional

Antes de inserir uma nova revisão, o repository:

1. valida o par `recordType/schemaId/schemaVersion`;
2. valida o payload no registry unificado;
3. resolve o owner dentro do mesmo `root_scope_id` e confere seu tipo;
4. rejeita toda referência com outro root;
5. resolve scope refs no root autorizado;
6. resolve item refs por revisão exata e confere record type e content hash;
7. exige correspondência entre `governance.evidenceIds` e `evidenceRefs`;
8. executa essas provas na mesma transação da escrita.

Um grant que autoriza dois roots não torna uma relação cross-root válida.

## Releases

Uma release nova:

- aceita somente itens `active` com payload registrado;
- não adiciona dependências silenciosamente;
- exige que cada item ref apareça como membro exato;
- exporta também os scopes referenciados e os owners necessários;
- revalida o fechamento na ativação e no replay.

Falha de fechamento interrompe a criação antes do ledger event.

## Compatibilidade histórica

Itens históricos com schema desconhecido:

- permanecem legíveis;
- permanecem exportáveis;
- podem ser reproduzidos pela API de biblioteca quando um reader histórico
  confiável é fornecido;
- não podem receber novas revisões pela API normal;
- não entram em releases novas nem podem ser ativados pela superfície atual.

Não há migration ou reescrita de payload histórico. O `user_version` não muda
por causa desta decisão.

O registry embutido do application service contém somente readers de schemas
persistíveis conhecidos. Código de reader fornecido por arquivo ou CLI não é
aceito.

## Consequências

- `recordType` passa a ser uma garantia executável.
- Relações e evidências são autocontidas e auditáveis.
- Releases não escondem dependências.
- Cross-client leakage falha antes da escrita.
- Evoluções futuras exigem novo schema e reader/upcaster explícito.
- Fixtures e importadores precisam produzir payloads canônicos, em vez de
  objetos soltos.

## Alternativas rejeitadas

- Manter payload livre e validar apenas durante retrieval.
- Inferir referências de qualquer string parecida com ID.
- Incluir dependências automaticamente na release.
- Reescrever itens históricos para o schema atual.
- Aceitar schema desconhecido porque o JSON é estruturalmente válido.
- Criar tabela, ledger ou repository paralelo por record type.

## Fitness associada

Os testes devem provar:

- um schema por record type;
- owner inexistente ou de outro root bloqueado;
- referência cross-root bloqueada mesmo com grant amplo;
- revisão, type ou hash divergente bloqueado;
- `evidenceIds` coerentes com `evidenceRefs`;
- release incompleta rejeitada e release fechada reproduzível;
- histórico opaco legível/exportável, mas inelegível;
- asset link preserva sua API especializada;
- `raw` não carrega módulos do Knowledge Core.
