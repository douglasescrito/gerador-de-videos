# ADR 0008 — Referências, direitos e estudo provider-free

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado: aceito para a fundação da Fase 3
- Data: 2026-07-24
- Escopo: Knowledge Core privado e preflight de Studio

## Contexto

A biblioteca local de referências não pode ser tratada como catálogo de estilos,
licença presumida nem conjunto automaticamente disponível para o provedor.
Proveniência, posse do arquivo e presença em um diretório não demonstram os usos
permitidos. O default `unknown` precisa impedir análise de conteúdo, indexação,
embedding, treinamento, envio a provedor, publicação e reutilização.

O workspace já possuía um índice e um estudo temporal legados. Eles documentam
uma biblioteca e resultados diagnósticos, mas não nasceram sob o contrato atual
de direitos por asset. Portanto, não são autoridade para analisar, promover
conhecimento ou enviar mídia ao provedor.

## Decisão

### 1. Inventário é privado, metadata-only e sem concessão implícita

O inventário de referências:

- enumera somente tipos de mídia explicitamente suportados;
- persiste apenas alias da raiz, caminho lógico relativo, MIME, bytes, SHA-256
  e identidade governada;
- não expõe nem persiste o caminho absoluto da raiz;
- rejeita traversal, ADS, controles, symlink, junction, hardlink e troca do
  arquivo durante a leitura;
- não executa probe, decode, extração de frame, áudio, OCR ou chamada a
  provedor;
- mantém os oito direitos em `unknown`, independentemente da proveniência
  alegada.

O hash técnico necessário ao inventário identifica bytes; não interpreta o
conteúdo e não concede direito de estudo.

### 2. Cohort é um conjunto fechado

Um cohort nasce de um manifest com entries exatas. Cada entry prende:

- root e scope;
- owner;
- asset ID e revisão;
- hash do registro do asset;
- caminho lógico;
- SHA-256, bytes e MIME.

Diretório, glob, prefixo, nome semelhante, cópia, rename, mesmo hash em outro
root ou asset futuro não pertencem ao cohort. Inclusões e exclusões precisam
particionar o manifest integralmente.

### 3. Direitos exigem atestação humana presa ao hash

A atestação declara os oito direitos, validade, política, owner, revisor,
manifest e conjunto incluído/excluído. Sua criação e sua materialização exigem
confirmação humana explícita e o hash esperado apresentado ao operador.

Nesta versão, `providerInput`, `training` e `embedding` são obrigatoriamente
`denied`. A fundação da Fase 3 não autoriza enviar as referências ao Gemini nem
a outro provider.

Proveniência alegada continua `unverified`. Ela ajuda a triagem, mas nunca
preenche direitos ausentes.

### 4. Materialização usa o repository único e uma transação

Uma atestação válida é convertida em payloads já existentes do Knowledge Core:

1. evidência da atestação;
2. entidades `reference-asset`;
3. decisão humana;
4. `rights-record` apenas para entries incluídas.

Entries excluídas podem existir como entidades inventariadas, mas conservam
todos os direitos em `unknown` e não recebem `rights-record`.

O ID lógico de `reference-asset` deriva do asset governado, não da atestação.
Uma nova atestação do mesmo asset não cria uma autoridade paralela: enquanto o
fluxo explícito de revisão não existir, ela colide e falha fechado.

Todos os itens e eventos são escritos em uma única transação SQLite. Qualquer
erro de schema, hash, scope, referência, head ou revisão desfaz o lote inteiro.

### 5. Runtime usa somente heads do store

O direito efetivo é a interseção conservadora entre o envelope do head atual do
asset e o head atual do `rights-record` lógico. `revoked`, `expired`, `denied` e
`unknown` prevalecem sobre `allowed`.

O runtime não pode escolher uma revisão antiga fornecida pelo caller. Asset e
direitos são lidos em um único snapshot do repository. Nova revisão do asset
torna um rights record preso à revisão anterior `unknown`; head revogado ou
expirado nunca autoriza fallback.

### 6. Análise local ocorre depois do gate

O guard de análise:

1. resolve direitos efetivos pelo head;
2. exige `localAnalysis=allowed`;
3. resolve a raiz privada pelo alias;
4. relê o arquivo com proteção contra links e troca;
5. compara SHA-256 e bytes com o asset aprovado;
6. resolve novamente os heads e a revogação;
7. exige o mesmo target, revisão, hash e direito efetivo;
8. somente então chama um adapter declarado local, determinístico e
   provider-free.

Direito ausente, negado, revogado, em quarentena, expirado, target stale, hash
divergente, mudança entre as duas leituras ou adapter externo resulta em zero
chamadas ao analisador.

Segmentos, observações e técnicas abstratas nascem como candidatos. Eles não
promovem conhecimento, não alimentam retrieval e não alteram uma produção.

Quando `textualIndexing=allowed`, a projeção efêmera pode ser materializada nos
payloads tipados existentes. Segmentos, technique card, observações, decisão
opcional de fila e ligação opcional com StyleSpec permanecem `candidate`. A
ligação com StyleSpec guarda somente ID e hash recalculado do dado canônico; ela
não valida estética nem ativa o preset.

A escrita desses candidatos inclui precondições dos heads exatos do asset e do
rights record. O repository verifica ID, revisão, content hash, status e schema
dentro do mesmo `BEGIN IMMEDIATE`, antes do primeiro insert. Revogação ou revisão
concorrente aborta itens e eventos em conjunto.

### 7. Anti-imitação é uma fronteira semântica

Conhecimento extraído deve descrever mecanismos transferíveis, aplicabilidade,
limites e modos de falha. Fórmulas de imitação, handles, nomes protegidos,
instruções de cópia, prompts e identificadores de provider são proibidos.

Referência como evidência não equivale a referência como entrada de geração.
O sidecar legado de provider input demonstra somente autoconsistência local e
não substitui a autoridade canônica do Knowledge Store.

Toda `scene.references` do Studio é bloqueada por padrão, independentemente de
estar dentro da raiz histórica. Um sidecar válido continua `report-only`: não
entra em `verifiedAuthorizations`, não altera o fingerprint e não satisfaz
`providerInput`. O draft standalone aplica o mesmo bloqueio antes de acessar o
arquivo ou o adapter; em `dryRun`, apenas reporta a pendência sem gravar.

### 8. O plano pago é novamente verificado no runtime

Antes de qualquer etapa paga, o approval fingerprint é recalculado sobre:

- projeção semântica;
- timeline;
- DAG e dependências;
- orçamento e concorrência;
- políticas;
- compatibilidade;
- inventário de chamadas pagas;
- autorizações explicitamente vinculadas.

ETA é report-only. Planos anteriores a esta mudança precisam ser recompilados e
reaprovados; o fingerprint histórico não é aceito.

## Fora de escopo

Esta decisão não autoriza:

- retrieval ou `knowledge-context`;
- embeddings ou treinamento;
- envio de referência a provider;
- promoção automática de technique cards;
- feedback que gere ou regenere mídia;
- alteração do fluxo `raw`;
- novo compiler, planner, journal, executor, CLI, app ou banco.

## Consequências

- A biblioteca pode ser inventariada sem analisar seu conteúdo.
- O cold start de assets permitidos pode ser resolvido por uma atestação humana
  de conjunto fechado.
- Referências de terceiros permanecem inutilizáveis para estudo até decisão
  explícita de `localAnalysis`.
- Reatestação e revogação exigem revisão append-only; duplicar a identidade não
  é uma saída válida.
- Texto técnico só pode ser persistido quando análise local e indexação textual
  estão simultaneamente permitidas, e ainda assim nasce candidato.
- Mudança dos heads entre análise e persistência falha fechado sem lote parcial.
- Referência Studio permanece sem POST até existir uma autorização canônica
  distinta do sidecar histórico.
- O índice e o estudo temporal legados permanecem diagnósticos não promovidos.
- A próxima extensão deve fechar as demais superfícies diretas e revalidar a
  origem no futuro ponto de promoção/uso, ainda sem retrieval e sem integração
  ao compilador.

## Rollback

O incremento é reversível sem migração:

- remover os módulos e schemas de projeção da Fase 3;
- preservar os itens já gravados como histórico append-only;
- revogar ou colocar em quarentena os heads aplicáveis;
- manter `localAnalysis`, `providerInput`, `training` e `embedding` bloqueados.

Nenhum rollback deve apagar evidência ou reutilizar uma autorização histórica.
