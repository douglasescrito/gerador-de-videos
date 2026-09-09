# ADR 0003 — Armazenamento privado e runtime guard

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado da implementação: contrato de Fase 0; store e guard em fases próprias
- Data: 2026-07-23
- Escopo: Knowledge Core, direitos, capabilities e autorizações

## Contexto

Conhecimento técnico global pode ser versionado com o código. Dados mutáveis de
clientes, marcas, pessoas, projetos, produções e feedback não podem ser
misturados ao Git, aos outputs nem ao índice operacional do acervo.

Ao mesmo tempo, congelar o contexto criativo no plano não pode congelar
permissões revogadas, consentimento ou capacidade expirada. Esses elementos
precisam ser revalidados imediatamente antes do uso, sem repetir retrieval nem
recompor o plano.

## Decisão de armazenamento

O Knowledge Store privado padrão será:

```text
%LOCALAPPDATA%\MktVideos\Knowledge\knowledge.sqlite
```

O caminho:

- fica fora do Git;
- não fica em `CORE/outputs`;
- não substitui `archive.sqlite`;
- não contém binários de mídia quando um hash e uma referência governada forem
  suficientes;
- não contém cookies, tokens, cabeçalhos de sessão, HAR ou chaves.

O repositório contém apenas:

- schemas;
- migrations;
- ontologia;
- knowledge packs globais, citados e licenciados;
- evals sem dados privados;
- código;
- documentação gerada sem PII.

`archive.sqlite` continua sendo um índice operacional reconstruível do acervo.
`knowledge.sqlite` é fonte de verdade editorial privada e possui backup,
migration, release e política de retenção próprios.

## Repository único

Somente um módulo de repository autorizado pode abrir
`knowledge.sqlite`. Chamadores usam uma interface de domínio e não recebem a
conexão SQLite.

Toda operação privada exige um `ScopeGrant` validado contendo, no mínimo:

- ator;
- ação;
- `root_scope_id`;
- escopos alcançáveis;
- finalidade;
- instante de emissão;
- validade;
- identificador e hash da política.

O repository aplica o filtro de `root_scope_id`; não confia em um `WHERE`
fornecido pelo chamador. FTS, embeddings, caches, exports, backups e relatórios
herdam a mesma separação.

Nenhum modelo recebe handle do banco ou permissão de escrita. Saída de modelo é
materializada como candidato e só uma operação determinística e autorizada pode
persisti-la.

## Runtime guard

O contexto criativo usado para compilar o plano é imutável. O runtime guard é
uma verificação estreita e atual aplicada pelo Execution Kernel antes de cada
nó sensível.

Ele revalida:

1. direito e consentimento de cada asset governado;
2. revogação contra o head atual;
3. capability, status e TTL do adapter;
4. correspondência entre plano, nó e inputs;
5. `ExecutionAuthorization` antes de qualquer operação paga.

O guard não:

- executa retrieval;
- consulta preferência;
- reescreve prompt;
- escolhe provider alternativo;
- muda o plano;
- concede direito;
- cria retry.

Se o estado atual divergir dos hashes congelados:

- o nó falha fechado antes do uso;
- o journal recebe causa sanitizada;
- nenhum POST é iniciado;
- não há fallback silencioso;
- a correção exige novo direito ou novo plano e fingerprint.

## Autorização paga

Uma `ExecutionAuthorization` é:

- ligada a `planFingerprint` e `nodeId`;
- ligada aos hashes de capability e rights;
- limitada por custo ou cota;
- explícita;
- expira;
- possui nonce de uso único;
- consumida atomicamente no journal antes da tentativa;
- inválida para outro nó, plano ou retry.

Confirmar um plano não cria autorização aberta. Estado ambíguo consome a
possibilidade de repetição até reconciliação ou nova decisão humana explícita.

## Direitos e revogação

Direitos `unknown` bloqueiam análise do conteúdo, embedding, treinamento,
reutilização, publicação e envio a provider. Conhecer autoria, receipt ou hash
não concede permissão.

Revogação:

- não apaga evidência histórica necessária à auditoria;
- remove o item das projeções ativas;
- invalida caches e embeddings derivados;
- bloqueia uso futuro;
- produz change impact para planos ainda não executados;
- não altera retroativamente recibos verdadeiros.

## Backup, exportação e recuperação

O store deve suportar:

- migrations transacionais;
- foreign keys habilitadas;
- verificação de integridade;
- backup atômico acompanhado de manifest;
- export JSON determinístico por escopo;
- restore provider-free;
- replay de releases;
- esquecimento e revogação auditáveis.

Outputs, `PESSOAS/` e Knowledge Store têm ciclos diferentes. A verificação entre
eles é report-only: ausência, hash divergente ou revogação gera diagnóstico, não
move, apaga ou recria arquivos.

## Consequências

- Dados privados não entram acidentalmente em commits.
- Isolamento é aplicado no acesso, não apenas por convenção de nomes.
- O plano permanece reproduzível sem ignorar revogações recentes.
- Perda do store exige restore próprio; o acervo não é um backup implícito.
- O runtime guard adiciona um gate obrigatório antes de capacidades sensíveis.

## Alternativas rejeitadas

- Usar `archive.sqlite` como banco de conhecimento.
- Criar um banco por feature sem repository comum.
- Guardar perfis privados em JSON dentro do projeto.
- Confiar apenas no contexto de rights congelado no plano.
- Permitir que adapters consultem o banco diretamente.
- Dar ao modelo permissão SQL.

## Fitness associada

A implementação do store deverá acrescentar testes que provem:

- apenas o repository abre o caminho privado;
- toda consulta privada sem `ScopeGrant` falha;
- dois `root_scope_id` não vazam resultados entre si;
- FTS, export e backup respeitam o mesmo escopo;
- revogação bloqueia o runtime antes de qualquer spy de POST;
- nonce pago é de uso único;
- restore e replay preservam hashes.

Essas provas dependem do store e do runtime guard reais. A Fase 0 registra os
gates, mas não cria testes placebo contra arquivos ainda inexistentes.
