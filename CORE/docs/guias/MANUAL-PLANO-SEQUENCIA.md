# Manual — plano-sequência encadeado

Receita para filmes longos **sem um único corte**. Validada numa peça de 2 minutos com 12 planos.

Esta é uma opção do repertório de [MANUAL-PRODUCAO-DE-PECAS.md](../MANUAL-PRODUCAO-DE-PECAS.md),
não um substituto: o motor audio-first (passos 1 a 5 e 10 a 11) continua igual. O que
muda é a camada criativa — aqui os planos deixam de ser vinhetas independentes e viram
elos de um movimento só.

## O problema que ela resolve

O Omni entrega no máximo ~10 s por clipe. Gerar N clipes e concatenar não produz um
plano-sequência: cada clipe nasce de um mundo diferente e toda emenda lê como corte.
Pedir continuidade no texto ("continue a cena anterior", "mesma cena do plano anterior")
não funciona — o modelo não tem o plano anterior.

## A técnica

**A continuidade é imposta pela imagem, não pedida no texto.**

Depois de cada plano, extrai-se o último frame; esse PNG entra como **primeiro frame**
do plano seguinte. `--first-frame` força `image_to_video`, e nesse modo o provedor é
obrigado a partir daquele quadro exato. A emenda passa a ser frame a frame.

```
c01  text_to_video        abre a cadeia (não existe frame anterior)
c02  image_to_video   ←   último frame de c01
c03  image_to_video   ←   último frame de c02
...
c12  reference_to_video   fecha com a arte oficial da marca
```

## Executando

```powershell
npm run chain -- --spec plano.json --out-dir outputs\<peca>\cadeia --dry-run
npm run chain -- --spec plano.json --out-dir outputs\<peca>\cadeia --confirm-provider-input true
```

`--dry-run` mostra o plano, o papel de cada elo e o **número exato de chamadas
pendentes**, sem escrever arquivo nem contatar provedor. Ele também informa quais
passos exigirão `--confirm-provider-input true` na execução real, sem presumir essa
confirmação. Rode sempre antes.

O comando é sequencial por definição (o elo N+1 depende do N) e **retomável**: plano com
MP4 já entregue é pulado, sem nova chamada. Se um elo sair ruim, apague só o MP4 dele e
os posteriores e rode de novo. `--only <id>` regenera um elo isolado.

Cada elo é uma chamada do `generate` do CLI, que continua dono do prompt literal, da
task, do recibo e da trava `--confirm-provider-input`. O script só repassa o valor
literal `true` quando ele foi fornecido pelo usuário na própria invocação; nunca cria
ou presume esse consentimento.

Spec de partida: [examples/plano-sequencia.example.json](../../examples/plano-sequencia.example.json).
Contrato e validações: `lib/media-pipeline/shot-chain.mjs`.

## O que segura a cadeia (o primeiro frame sozinho não basta)

O frame garante o ponto de partida; os 10 s seguintes ainda podem derivar. Quatro
regras mantiveram 11 elos sem deriva de estilo:

**1. A bíblia visual inteira em TODO prompt.** Paleta, "flat vector, sem 3D, sem
gradiente, sem sombra", regra de câmera e as proibições, por extenso, nos onze prompts.
Encurtar porque "o modelo já sabe" é o caminho mais rápido para a cadeia quebrar. O
módulo monta `bible + ação` sozinho justamente para isso não ser esquecido.

**2. Estrutura `BEGINS / ação / ENDS`.** O `BEGINS` descreve exatamente o frame que está
entrando, para o texto não brigar com a imagem. O `ENDS` declara o estado que o próximo
elo vai herdar. É um contrato entre planos vizinhos.

**3. Uma âncora de continuidade barata.** No filme validado, a protagonista é uma
silhueta chapada fixa no mesmo ponto do quadro — quem se move é o mundo. Silhueta plana
é trivial de manter idêntica entre gerações; um rosto teria derivado no terceiro elo.
Escolha sempre uma âncora que o modelo consiga redesenhar sem interpretar.

**4. Pontos de reset plantados.** Um painel sólido que atravessa o quadro inteiro serve
à narrativa **e** é onde a cadeia pode ser reiniciada sem ninguém perceber, caso haja
deriva. No filme validado foram dois (c04 e c08); não foi preciso usar nenhum.

## Conferência

Emenda não se confere no meio do plano, se confere **na costura**. Extraia o quadro logo
antes e logo depois de cada fronteira e compare:

```powershell
ffmpeg -ss 29.9 -i final.mp4 -frames:v 1 antes.png
ffmpeg -ss 30.1 -i final.mp4 -frames:v 1 depois.png
```

No filme validado, cinco das seis costuras conferidas têm quadro antes/depois
praticamente idêntico. A única visível é a abertura, onde o mundo entra de propósito.

## Armadilhas conhecidas

- **A cadeia é sequencial.** Não há paralelismo possível: ~1,5 a 3 min por elo, 12 elos
  ≈ 25 min. Planeje a espera; narração e trilha podem rodar em paralelo, o visual não.
- **Um elo ruim contamina todos os posteriores.** Confira os primeiros dois ou três
  antes de deixar o lote correr até o fim.
- **`--first-frame` não se mistura com `--image`.** São contratos diferentes; o elo herda
  frame, o fecho de marca recebe referência. O plano já separa os dois papéis.
- **Caminho de saída com barra invertida escapada quebra a gravação.** Já custou uma
  chamada paga: o vídeo veio e o arquivo não pôde ser escrito. Use barras normais.
- **A extração do frame sai do MP4 entregue**, nunca de um render intermediário — senão
  o que o provedor recebe não é o que o espectador vê.

## Montagem depois da cadeia

A cadeia entrega os planos; a montagem continua no fluxo audio-first normal. Três coisas
medidas no filme validado que valem para qualquer peça narrada:

- **A voz do Omni sai bem mais lenta que a estimativa.** Um roteiro de ~210 palavras
  virou 110 s de fala. Meça com `align` antes de fechar o roteiro contra a duração.
- **Encolher pausas internas** (acima de 0,45 s para 0,35 s) recupera ~9 s sem tirar
  palavra nem mudar interpretação. É ar morto, não performance.
- **Bloco `blocked` no `align` quase nunca precisa ser regerado.** Olhe o JSON de
  palavras do Whisper: costuma ser lixo de borda (repetição na entrada, resíduo de
  respiração na saída). Aparo de ponta resolve, e aparo de ponta é montagem. Regerar
  continua exigindo pedido humano explícito.
- **Posicione cada bloco no instante do plano que ele comenta**, em vez de colar a
  narração em sequência. O silêncio entre blocos vira decisão de direção — e quando a
  imagem já diz a frase, corte a frase.
