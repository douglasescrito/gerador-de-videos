# ADR 0013 — policy registry e ScopeGrant attestation no ledger

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Status: aceito
- Data: 2026-07-27
- Fase: 4.2

## Contexto

O ledger original guardava ID e hash do `ScopeGrant`, actor, permissão e janela,
mas não preservava o corpo canônico com roots, conjunto de permissões e
finalidade. Assim, a integridade conseguia validar formato e hash-chain, mas não
recomputar a autorização que originou um evento.

O verificador também comparava o `policyHash` histórico ao conteúdo corrente de
`KNOWLEDGE-GOVERNANCE-POLICY.md`. Uma edição legítima futura do documento
tornaria ledgers anteriores ilegíveis, apesar de seus eventos continuarem
imutáveis.

Persistir um grant multi-root inteiro dentro de um evento de um único cliente
criaria outro risco: o snapshot single-root poderia carregar IDs e capacidades
de roots ausentes do store.

## Decisão

### 1. Política versionada é imutável

`knowledge-policy-registry.mjs` é o registry embutido de pares
`policyId + policyHash` conhecidos. A política
`knowledge-governance-policy@1` permanece presa ao hash já usado pelos ledgers;
o runtime confere que o documento versionado continua byte a byte equivalente
após normalização de quebras de linha.

Uma mudança normativa futura cria outro ID/versionamento e preserva os hashes
anteriores no registry. Não se recalcula silenciosamente o hash de uma versão
histórica a partir de um arquivo mutável.

### 2. Eventos novos carregam attestation canônica

A migration `004-knowledge-event-scope-grant` adiciona `grant_json` nullable
para manter leitura de rows históricos. Um trigger impede que novos eventos
sejam inseridos sem a attestation.

Para cada evento novo, o repository:

- exige grant emitido pelo runtime e dedicado exatamente ao root do evento;
- serializa o `scope-grant@1` completo em JSON canônico;
- recompõe schema, política, roots, permissões, actor, purpose, janela, ID e
  hash;
- compara root, permissão, actor, política e timestamps com as colunas do
  evento;
- inclui `grantBodyHash` no corpo do `eventHash`.

Remover ou alterar `grant_json` de um evento novo muda o corpo hasheado e falha
na verificação. O trigger append-only continua bloqueando update/delete, e a
integridade também verifica a definição do schema SQLite.

### 3. Legado permanece legível, mas não é superestimado

Rows anteriores à migration possuem `grant_json = NULL` e mantêm o algoritmo
histórico de `eventHash`. Eles continuam sujeitos à validação das colunas,
hash-chain, política conhecida e janela temporal, porém não são apresentados
como prova recomputável do corpo integral do grant.

Status e integrity expõem separadamente contagens de eventos com attestation
canônica e evidência legada. A compatibilidade não transforma evidência parcial
em evidência completa.

## Consequências

- novos eventos provam localmente a autorização exata que foi persistida;
- backup single-root não vaza roots presentes em um grant de escrita amplo;
- replay histórico não quebra quando outra versão de política for introduzida;
- stores antigos continuam migráveis e auditáveis com limitação explícita;
- o `user_version` do Knowledge Store passa a `4`;
- não surge outro banco, planner, executor, provider ou fonte de autoridade.

## Fitness

Testes provider-free devem provar:

- recomposição de ID/hash e bindings do grant canônico;
- falha para root, permissão, actor, política ou janela divergentes;
- falha quando `grant_json` de evento novo é removido ou adulterado;
- bloqueio de grant multi-root em qualquer append de evento;
- migração de store v3 preservando ledger antigo como legado;
- contagens exatas de eventos canônicos e legados;
- backup/restore preservando attestation e integridade;
- nenhuma chamada de provider ou alteração no caminho `raw`.
