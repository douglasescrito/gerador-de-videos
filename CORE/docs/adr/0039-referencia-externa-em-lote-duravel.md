# ADR 0039 — Referência externa em lote durável

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

> **Parcialmente superado em 2026-08-07.** A confirmação de chamada paga
> (`confirmPaid`) foi removida do projeto inteiro por decisão do projeto — ver o
> contrato atual em [`AGENT-CONTRACT.md`](../AGENT-CONTRACT.md).
> Tudo o mais neste ADR continua valendo, inclusive a autorização de entrada
> externa (`confirmProviderInput`), que é trava de segurança e não de custo.

- Estado: decisão de desenho aceita em 2026-08-02; confirmação de gasto removida posteriormente.
- Data: 2026-08-02
- Escopo: fila durável `batch-job` compartilhada entre app e CLI
- Depende de: [ADR 0009](0009-autorizacao-direta-de-provider-input.md)

## Contexto

A tela Produzir passou a submeter ao executor durável (`omni-batch-runner.mjs`),
que roda várias tentativas em paralelo e sobrevive ao fechamento da janela. Mas
o caminho com referência continuou saindo uma tomada por vez, porque
`batch-job@2` não carrega entradas externas.

Isso separa a produção real em duas velocidades: prompt puro é rápido e durável;
prompt com referência é lento e frágil. Uma sequência com a mesma referência autorizada em vários planos depende
de continuidade e retomada confiáveis.

Fazer a fila carregar referências esbarra em três limites reais:

1. **O permit é efêmero e process-local.** `direct-provider-input-permit@1` vive
   em `WeakSet`/`WeakMap` dentro do processo que o emitiu. Uma cópia JSON
   idêntica não adquire autoridade. Um lote que retoma depois de um restart não
   tem como recuperar a autoridade original — e não deve fingir que tem.
2. **O estado durável é lido por mais de um executor.** Se `batch-job@2` ganhar
   um campo de referências, um leitor que não o conheça roda o item sem as
   referências e produz um vídeo diferente do autorizado, em silêncio.
3. **Bytes externos não podem virar acervo.** O catálogo indexa `outputs/`.
   Referência ad hoc não tem direitos apurados e não pode ser indexada,
   reutilizada nem tratada como asset governado.

## Decisão

### 1. Uma submissão é uma invocação

A confirmação `confirmProviderInput: true` da tela cobre exatamente as
referências daquela submissão e exatamente aqueles itens. Ela não vale para
itens acrescentados depois, não vale para outro lote e não sobrevive ao processo
que a recebeu.

A confirmação de gasto foi removida; autorização de entrada externa e
reconciliação permanecem separadas da solicitação de geração.

### 2. O permit nunca entra no estado durável

`batch-job` persiste, por item, apenas o descritor necessário para reconhecer e
reconferir a entrada:

- `inputId` ordinal, na mesma ordem do preflight;
- `role` (`reference-image`, `first-frame` ou `reference-video`);
- nome do arquivo preparado, relativo à área de preparo do próprio lote;
- `sha256`, `bytes` e `mimeType`, como evidência de reconciliação.

Esse descritor é **fato, não autoridade**. Ele permite dizer "estes eram os
bytes autorizados"; ele não permite enviar nada. Path absoluto, base64, cookies
e segredos continuam fora do estado, do evento e do recibo.

### 3. Preflight de todos os itens antes do primeiro POST

Como no CLI (ADR 0009, §3.3), a submissão:

1. valida a confirmação booleana literal;
2. grava os bytes confirmados na área de preparo do lote;
3. abre e hasheia as entradas de **todos** os itens;
4. emite **um permit mínimo por item**, contendo somente as entradas daquele
   item;
5. só então admite o lote e libera o primeiro POST.

Falha de preflight em qualquer item rejeita a submissão inteira antes de
qualquer chamada ao provedor. Item sem entrada externa recebe zero permit. Um
item nunca recebe hashes pertencentes a outro item.

O teto de quatro entradas de `direct-provider-input-permit@1` vale **por item**,
não pelo lote. Um lote de doze planos com uma foto cada é legítimo; um item com
cinco imagens não é.

### 4. A retomada depois de um restart exige nova confirmação

Os permits vivem em memória, indexados por `itemId`, e morrem com o processo.
Consequência aceita e desejada:

- item `pending` com referências, após restart, **não volta para a fila**. Ele
  recebe `recovery: "authorize_new_attempt"` e fica visível na Fila como
  pendência humana;
- a ação explícita de reconfirmação é **uma só, para o lote inteiro**: refaz o
  preflight sobre os arquivos preparados, compara com o descritor persistido e
  emite permits novos para todos os itens ainda pendentes de uma vez. Reconfirmar
  item por item não é aceitável: transformaria um restart em doze decisões e
  empurraria o operador a confirmar no automático, que é exatamente o que a
  confirmação existe para evitar;
- retomar um item que perdeu autoridade por `resume-pre-submit` fica bloqueado.
  Só a reconfirmação de referências devolve esses itens à fila;
- arquivo preparado que mudou desde a submissão falha fechado, sem retry;
- item que já cruzou o limite de efeito (`submitting`, `provider_pending`,
  `persisting`) nunca é reenviado. Ele segue a reconciliação por handle que já
  existe.

Nenhuma retomada é automática. Nenhum retry é automático.

### 5. Conferência JIT imediatamente antes do adapter

Antes de cada chamada, `assertDirectProviderInputPermitJit` relê os bytes do
arquivo preparado e compara integralmente hash, bytes, MIME, role, operação e
ordem, com os `inputId` esperados daquele item. Divergência falha fechada sem
retry e sem consumir nova cota.

### 6. A área de preparo fica fora do acervo e é descartada

Os bytes confirmados vão para `CORE/.batches/<batchId>.refs/`, ao lado do estado
durável e **fora de `outputs/`**, portanto fora do índice do catálogo, do FTS e
de qualquer projeção de acervo.

A área é apagada quando o lote atinge estado terminal, quando o lote é
descartado, ou por limpeza explícita. Ela não é backup, não é acervo, não
concede reuse e não vira evidência de direitos.

### 7. O estado durável muda de versão: `batch-job@3`

Um leitor que não conhece referências não pode rodar um item que depende delas.
Portanto:

- `batch-job@3` é a versão corrente e admite `references` por item;
- `batch-job@2` é lido e projetado para `@3` com `references: []`, sem alterar
  comportamento;
- `batch-job@1` continua sendo projetado como hoje, como estado legado que exige
  atenção;
- executor que só entende `@2` deve **recusar** um `@3` com referências, em vez
  de rodá-lo sem elas.

### 8. Limites de task são os mesmos do CLI

A validação por item reusa `assertBatchInputs`, sem reimplementação:

- `text_to_video` não aceita imagem nem vídeo;
- `image_to_video` exige uma ou duas imagens e nenhum vídeo;
- `reference_to_video` exige de uma a quatro imagens e nenhum vídeo;
- `edit` exige exatamente um vídeo e nenhuma imagem.

### 9. O recibo registra a projeção sanitizada

Cada item concluído registra, além do que já registra hoje, a projeção
sanitizada do permit e o par `batchId`/`batchItemId`. Sem path, sem base64, sem
cabeçalho de sessão.

## Consequências

- A produção com referência passa a ser durável e paralela, na mesma velocidade
  da produção com prompt puro.
- Fechar a janela deixa de ser perda de trabalho também nesse caminho.
- A autoridade continua presa a uma invocação e a um processo; nada é reusado
  por inferência.
- Restart vira uma pendência humana visível, não um reenvio silencioso.
- Bytes externos deixam rastro auditável sem virar acervo.
- O app não confia em nenhuma projeção de permit vinda do browser.

## Limites deliberados

- Um lote grande com referências pode parar inteiro num restart e exigir
  reconfirmação. Isso é o custo escolhido para não reusar autoridade.
- A área de preparo duplica bytes em disco enquanto o lote roda. O descarte é
  parte do contrato, não uma otimização futura.
- Referência do fluxo Studio canônico (`scene.references` de `film-spec@2`)
  **não** usa esta exceção. Continua dependendo de decisão canônica vigente no
  Knowledge Core, como manda o ADR 0009, §5.
- A implementação de 2026-08-02 cobre entradas de imagem
  (`reference-image` e `first-frame`). `edit` em lote, que exige um vídeo de
  referência enviado pela Files API com espera própria de processamento, fica
  fora deste incremento e falha fechado no preparo. Continua disponível como
  invocação avulsa.
- O encaminhamento por `OMNI_UPSTREAM_URL` não transporta entradas externas. Um
  lote com referências é recusado nesse modo, em vez de gerar sem elas.
- O contrato registra uma decisão técnica sobre bytes exatos. Ele não faz
  análise jurídica da mídia nem apura direitos.

## Rollback

O rollback seguro é voltar a recusar referências no lote e devolver a tomada com
referência ao caminho de uma chamada por vez. Não se remove a confirmação
mantendo os envios ativos.

Como permits são efêmeros e a área de preparo é descartável, o rollback não
exige migração. Jobs `@3` já persistidos continuam legíveis; os que tiverem
`references` não vazias devem ser recusados pelo executor revertido, nunca
executados sem elas.

## Plano de verificação

Provas exigidas antes de considerar a implementação concluída, todas
provider-free:

1. submissão com referências rejeitada sem `confirmProviderInput: true`, antes
   de qualquer POST;
2. preflight que falha em um item rejeita o lote inteiro sem nenhuma chamada;
3. permit de um item não contém entrada de outro item;
4. arquivo preparado alterado entre preflight e adapter falha fechado;
5. restart deixa item `pending` com referências em `authorize_new_attempt`, e
   nenhum reenvio ocorre sem a ação humana;
6. item já submetido nunca é reenviado após restart;
7. `batch-job@2` é lido e projetado para `@3` sem mudança de comportamento;
8. executor sem suporte recusa `@3` com referências;
9. estado, evento e recibo não contêm path absoluto, base64 nem segredo;
10. área de preparo é apagada no estado terminal e nunca aparece no catálogo.
