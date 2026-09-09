# ADR 0010 — ExecutionAuthorization e limite JIT de efeitos

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

> **Parcialmente superado em 2026-08-07.** O booleano `confirmPaid` deixou de
> existir: gerar não passa por confirmação de gasto — ver o contrato atual em
> [`AGENT-CONTRACT.md`](../AGENT-CONTRACT.md). A
> autorização em si, o fingerprint que a prende a um plano, o permit de entrada
> direta e o limite JIT de efeitos continuam valendo integralmente.

- Estado: aceito para rollout incremental
- Data: 2026-07-25
- Escopo: execução paga do Studio canônico

## Contexto

O plano canônico já prendia chamadas pagas a um fingerprint e a uma
confirmação humana, mas essa decisão era descartada antes do adapter. O journal,
por sua vez, registrava tentativas sem possuir uma capability de uso único. Isso
permitia que uma função de adapter fosse chamada fora da ordem
`plano → autorização → journal → efeito`.

Um booleano `confirmPaid`, um permit de input direto ou um evento
`node_authorized` isolado não resolvem esse limite. A decisão precisa cobrir o
plano e o nó exatos, capability vigente, rights vigentes, orçamento e uma única
tentativa, e precisa ser consumida atomicamente antes de qualquer efeito.

## Decisão

### 1. A autorização paga é um contrato único e efêmero

`execution-authorization@1` prende:

- fingerprints do plano, aprovação e nó;
- provider e operação exatos;
- hash e expiração do capability snapshot;
- hash e head da decisão de rights;
- unidade de quota, hard limit e modo de autenticação;
- confirmação humana, origem e ator;
- emissão, expiração, nonce e hash canônico.

O objeto executável recebe um brand privado em memória. Sua projeção JSON
continua auditável, mas não ganha autoridade quando desserializada.

### 2. O journal é o limite transacional

Para um nó pago, o journal:

1. normaliza o identificador da tentativa antes da transação;
2. reconstitui o plano, o DAG e o head de rights;
3. exige todas as dependências concluídas;
4. revalida a autorização;
5. confere hard limit e nonce vigente;
6. consome o nonce;
7. cria a tentativa e grava `node_started`;
8. materializa a capability de efeito;
9. faz commit em um único `BEGIN IMMEDIATE`.

Falha em qualquer ponto desfaz consumo, tentativa e evento. Uma autorização
expirada, adulterada, repetida ou pertencente a outro nó produz zero tentativa.

`execution-effect-authorization@1`, também branded e de uso único, é construída
e validada ainda dentro da transação, mas só é entregue ao adapter depois do
commit. Assim não existe trabalho falível pós-commit capaz de consumir o nonce
sem devolver a capability. O adapter do caminho canônico precisa consumi-la
antes de abrir a operação. O kernel rejeita uma conclusão cujo adapter não
tenha consumido essa capability.

### 3. Rights iniciais são deliberadamente estreitos

O primeiro rollout aceita somente:

- nós sem provider input; e
- mídia produzida na própria execução, registrada com SHA-256, bytes, MIME,
  receipt ID, receipt hash e sequência do journal.

Nós de vídeo também exigem uma aprovação humana append-only da mesma execução.
O arquivo e o recibo são relidos imediatamente antes do consumo do nonce.
Revogação do artifact expira autorizações ainda não iniciadas.

Referências externas do Knowledge Core continuam bloqueadas. O store privado e
o journal usam transações físicas distintas; duas gravações sequenciais não
serão apresentadas como uma transação atômica de rights e efeito.

### 4. O kernel não é um segundo planner ou executor

`execution-kernel.mjs` é o application service do limite pago. Ele não compila
timeline, não decide ordem criativa e não contém adapter. Recebe um nó já
compilado, emite e consome sua autorização, chama uma operação injetada e
registra handle, receipt, artifacts ou falha.

O `film-orchestrator` permanece a fachada de compatibilidade, mas `run` e
`resume` com `execution-plan@1` delegam seus efeitos de keyframe, TTS, música e
vídeo ao mesmo kernel e ao mesmo journal. Etapas locais que desbloqueiam esses
efeitos (`voice-probe`, `alignment`, `timeline-lock` e `animatic`) também são
registradas pelo kernel na ordem do DAG, sem adquirir capability paga. O modo
`raw` não entra nesse caminho.

### 5. Estado ambíguo e reconcile continuam separados

Depois de `node_started`, qualquer falha é conservadoramente ambígua. Não existe
retry nem emissão automática de outra autorização. O handle deve ser persistido
antes do polling.

O journal persiste apenas a mensagem sanitizada da falha e mantém o mesmo
estado na tabela de attempts e no evento. Cookies, cabeçalhos, tokens, data URLs,
JWTs, chaves e paths locais reconhecíveis são redigidos antes da escrita.

`reconcile` não recebe autorização gerativa, não cria tentativa e permanece
GET/download-only.

### 6. Bypasses adjacentes falham fechado

- o encadeador não fabrica mais `--confirm-provider-input true`;
- o proxy do app usa allowlist, sem encaminhamento arbitrário;
- `/api/edit-video` legado fica bloqueado até convergir para o mesmo contrato;
- helpers de TTS e Lyria não fabricam mais confirmação paga internamente.

## Consequências

- nonce e `node_started` têm atomicidade real no mesmo SQLite;
- identificador inválido, dependência pendente ou falha ao construir a
  capability deixam o nonce reutilizável e zero attempts;
- uma cópia do token ou uma segunda chamada não autoriza outro efeito;
- alteração ou revogação do keyframe aprovado bloqueia o vídeo antes do
  adapter;
- a pausa humana entre `run` e `resume` permanece visível;
- `raw`, cookie-only e ausência de retry permanecem invariantes;
- receipts e artifacts da execução passam a formar a base para direitos
  internos verificáveis.
- falhas ambíguas não deixam estados divergentes nem material sensível no
  journal.

## Limites deliberados

- adapters base ainda servem ao modo `raw` e a superfícies legadas; o
  fail-closed por effect capability já vale no caminho marcado como
  `executionKernel: required`, e a remoção das superfícies Studio standalone é
  um rollout posterior;
- scripts diagnósticos e o miner Grok ainda não convergiram para o kernel;
- o app não emite `ExecutionAuthorization`; em vez de manter uma rota gerativa
  paralela, edição foi bloqueada;
- buffers verificados ainda são entregues por path aos adapters Playwright. O
  arquivo é rehasheado imediatamente antes da tentativa, mas a eliminação total
  de TOCTOU requer adapters capazes de consumir buffers imutáveis;
- TTS e Lyria continuam operacionalmente pendentes e não são dependências de
  entrega até nova prova explícita.

## Rollback

O journal é aditivo e não sobrescreve receipts nem outputs. O rollback
operacional usa um plano legado explicitamente selecionado e preserva o journal
para auditoria. Não se apagam nonces consumidos nem eventos para reabrir uma
tentativa.
