# ADR 0009 — Autorização direta e efêmera de provider input

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado: aceito para o hardening incremental da Fase 3
- Data: 2026-07-24
- Escopo: comandos diretos do CLI e app local

## Contexto

O modo `raw` precisa continuar literal e consultar zero Knowledge Core. Ao mesmo
tempo, escolher um arquivo em `--image`, `--first-frame`, `--video` ou no app
não demonstra por si só que ele pode ser enviado ao provedor. Reaproveitar a
rights matrix privada dentro de `raw` violaria o boundary; aceitar o path sem
decisão explícita violaria o default de direitos.

Também não basta confirmar uma lista de paths no início de um batch. O arquivo
pode mudar antes do POST, e um permit agregado entregue a todos os jobs amplia
desnecessariamente a evidência visível para cada execução.

## Decisão

### 1. Existe uma autorização efêmera de uso único

Entradas externas de um comando direto exigem confirmação humana booleana
literal:

- CLI: `--confirm-provider-input true`;
- app: `confirmProviderInput: true`, exposto como checkbox explícito.

A confirmação vale somente para os bytes presentes naquela invocação. Ela não:

- cria item no Knowledge Core;
- concede reuse, publicação, treinamento ou embedding;
- autoriza arquivo futuro;
- substitui direitos canônicos de uma referência de produção Studio;
- autoriza nova chamada ou retry.

### 2. O permit prende os bytes exatos

`direct-provider-input-permit@1` contém somente:

- schema e versão;
- invocation ID, actor local e finalidade;
- confirmação de autoridade efêmera e não reutilizável;
- data;
- para cada entrada: ID ordinal, SHA-256, bytes, MIME, role e operação;
- hash canônico do permit.

Path, nome do arquivo, mídia, base64, cookies e segredos não entram na projeção
do permit. O objeto do CLI também recebe um brand privado em memória; uma cópia
JSON idêntica não adquire autoridade de runtime.

### 3. Preflight e conferência JIT são separados

O CLI:

1. valida a confirmação;
2. abre e hasheia todas as entradas antes de criar sessão ou adapter;
3. em batch, conclui o preflight de todos os jobs antes do primeiro POST e cria
   um permit mínimo por job;
4. relê os bytes imediatamente antes do adapter;
5. compara integralmente hash, bytes, MIME, role, operação e ordem;
6. falha sem retry se o arquivo mudou.

Job sem entrada recebe zero permit. Um job não recebe hashes pertencentes a
outro job.

### 4. O app emite o mesmo contrato localmente

O servidor local descarta qualquer projeção fornecida pelo cliente, valida
base64, MIME, limites, bytes e hash e constrói novamente o permit canônico com
actor `local-app-human`. A validação ocorre antes de:

- encaminhar ao `OMNI_UPSTREAM_URL`;
- fazer upload de vídeo;
- obter o provider;
- criar uma interaction.

Como os bytes inline permanecem no mesmo objeto da requisição, o envio usa a
entrada já hasheada. A resposta e o payload encaminhado carregam somente a
projeção sanitizada do permit além da própria entrada necessária ao provider.

### 5. Studio canônico continua mais restritivo

`scene.references` de `film-spec@2` não usa esta exceção direta. Ela continua
bloqueada até existir decisão canônica vigente de `providerInput` no Knowledge
Core. Sidecar legado permanece `report-only`.

Keyframes e outros artefatos gerados na própria execução precisam de uma classe
futura distinta de autorização, presa ao plano, journal, recibo e hash do
artefato. Eles não devem ser fingidos como input humano direto.

## Consequências

- `raw` preserva prompt literal e zero consulta ao Knowledge Core.
- A decisão humana é explícita sem transformar um arquivo ad hoc em entidade
  permanente.
- Alteração entre preflight e POST falha fechado.
- Batch preserva least privilege por job.
- O app não confia em authorization JSON do browser.
- Comandos sem entrada externa mantêm compatibilidade e não exigem a flag.

## Limites deliberados

- Recibos antigos dos adapters ainda podem registrar paths em `inputs[]`; o
  novo permit não os replica. Sanitizar o contrato histórico de artefatos exige
  migração própria.
- Exports diretos de adapters, scripts de diagnóstico e futuras integrações
  ainda precisam convergir para um `ExecutionAuthorization` único.
- A autorização não faz análise jurídica da mídia; ela registra uma decisão
  humana técnica, exata e limitada à invocação.

## Rollback

O rollback seguro é bloquear inputs externos nos comandos afetados. Não se
remove a confirmação mantendo os envios ativos. Permits são efêmeros e não
exigem migração ou remoção de estado persistido.
