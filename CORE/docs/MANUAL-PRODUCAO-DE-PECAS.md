# Manual — produção de peças (audio-first)

Este é o fluxo operacional canônico. Antes de qualquer etapa paga, use
`dry-run`/`plan`, revise o teto exato de chamadas e confirme com o
`--confirm-fingerprint` exibido pelo plano.
`raw` permanece literal; todos os recursos descritos aqui são opt-in de
`studio`.

`align`, transcrição, OCR e QA são diagnósticos opt-in e report-only. Seus
resultados nunca autorizam correção, seleção de versão, edição, retry ou nova
geração. A narração externa usa Google Vids, a trilha usa Flow Music e o QA
semântico permanece indisponível enquanto o
[registro gerado de capacidades](CAPABILITIES.md) não o marcar como
`supported`.

Receita genérica de filme narrado. Vale para qualquer filme
narrado: comercial, filme de marca, vertical para Reels, série de spots.

A produção tem duas camadas. O **motor** é sempre igual e reutilizável. A
**camada criativa** é onde cada peça precisa ser diferente da anterior.

```
 MOTOR      1 conceito → 2 roteiro → 3 narração → 4 align → 5 trilha+mix
 CRIATIVO   6 imagem → 7 verificação → 8 montagem → 9 fecho
 MOTOR      10 QA → 11 entrega
```

## Motor — passos 1 a 5

**1. Conceito e direção.** Antes de gastar, decidir a experiência: linguagem
visual, tratamento de texto, timbre da voz, ritmo e fecho. Ver "Regra do
repertório" no fim deste manual.

**2. Roteiro.** Narração em blocos curtos, uma ideia por bloco. O lint de marca
roda sozinho no passo seguinte e barra o termo que a marca proibir, quando essa política existir.

```powershell
npm run video -- commercial --step narration-jobs --blocks blocos.json --out narration-jobs.json
```

**3. Narração.** Blocos Omni de tela quase preta — o áudio é o herói. É o único
caminho de voz do projeto (cookie-only; não há TTS por chave aqui).

```powershell
npm run video -- batch --jobs narration-jobs.json --parallel 3 --out-dir outputs\<peca>\narracao
```

**4. Alinhamento.** Extrai o áudio, roda o Whisper, **corrige a ortografia contra
o roteiro** (adota a grafia do roteiro, mantém o tempo medido) e monta a
narração-mestre + cronograma de palavras + spans por bloco.

```powershell
npm run video -- align --blocks blocos.json --scenes-dir outputs\<peca>\narracao [--gap 0.26]
```

O `--gap` define o tom: 0,30s institucional, 0,22s publicitário. O relatório
distingue grafia de ASR de palavra trocada/engolida, mas não toma ação. Entregue
o original e o diagnóstico; somente um pedido humano explícito pode originar
outra chamada. Detalhes históricos estão em `guias/MANUAL-FILME-NARRADO.md`.

**5. Trilha e mix.** Gerar a trilha por seções (mesmo tom e BPM) ou reaproveitar
a de outra peça da campanha para dar continuidade sonora. Encaixar na duração
exata da narração e mixar com ducking.

```powershell
# fitMusicToDuration ajusta o leito à duração da narração (trim ou loop-crossfade)
npm run video -- mix --mode studio --voice narracao-master.wav --music trilha-bed.wav `
  --music-gain 0.38 --ducking-ratio 12 --ducking-threshold 0.05 --out master-mixado.wav
```

## Camada criativa — passos 6 a 9

**6. Imagem.** Gerar os planos no Omni. O tratamento é escolha de direção
(ver repertório). Conferir sempre as dimensões entregues: o provedor às vezes
ignora `--aspect` e devolve 16:9 quando se pediu 9:16.

**7. Verificação — o passo que não se pula.** A revisão humana deve confirmar
que qualquer texto pedido nasceu dentro do próprio clipe Omni, está legível e
permanece enquadrado. Não corrigir letras, completar palavras, criar legendas ou
substituir cards com tipografia aplicada em pós. Uma saída tecnicamente válida é
entregue como original; edição ou nova geração só ocorre depois de um pedido
explícito de ajuste.

**8. Montagem.** Casar os clipes Omni com a linha do tempo da narração por aparo
e concatenação. A montagem não pode adicionar overlays, `drawtext`, cards,
legendas, logos ou qualquer outro elemento visual pós-renderizado.

**9. Fecho.** O fecho também deve nascer no Omni. Quando houver assinatura
visual, enviar a logo oficial como referência e instruir o Omni a preservar
formas, proporções, espaçamento, letras e cores, animando somente a revelação ou
o ambiente. Como a fidelidade literal não é garantida pelo provedor, a revisão
humana decide se o clipe pode ser usado; nunca substituir ou corrigir a marca
com overlay em pós. Se a fidelidade visual for indispensável e o clipe não for
aprovado, entregar a versão sem logo visual e manter o nome da marca apenas na
locução.

## Motor — passos 10 e 11

```powershell
npm run video -- qa --mode studio --video final.mp4 --expected-duration <s>
npm run video -- finish --mode studio --video final.mp4 --delivery-profile web-1080p --out 1080p.mp4
```

O QA acima apenas registra o resultado técnico. Ele não escolhe outra versão e
não dispara qualquer correção ou regeneração.

`finish` com perfil `web-1080p` entrega em 16:9. Peça vertical já sai pronta da
montagem em 1080x1920 — não passar pelo perfil horizontal.

## Regra do repertório

**Cada peça nova deve ser uma experiência conceitual nova.** O motor se repete;
a estética, não. Reaplicar o mesmo esqueleto vira fórmula.

Repertório já validado (usar como vocabulário, não como template):

| Camada | Opções já comprovadas |
|---|---|
| Linguagem visual | cards flat 2D sobre cor chapada; footage cinematográfico contínuo sem texto; **tipografia física macro** (letterpress, tinta, foil, grafite); **luz urbana noturna** (néon, LED, reflexo no asfalto) |
| Texto | cards gerados pelo Omni; **tipografia física gerada pelo Omni**; **palavras como luz/néon geradas pelo Omni** |
| Voz | publicitária confiante; íntima cinematográfica de trailer; **calorosa e tátil de contador de história**; **resoluta e urbana** |
| Fecho | placa branca com a logo; assinatura em movimento sobre fundo Omni; logo emergindo da luz do plano final; **logo impressa no papel**; **logo acesa num letreiro iluminado** |
| Formato | 16:9; 9:16 vertical |
| Montagem | corte entre planos independentes; **plano-sequência encadeado sem corte** (ver [guias/MANUAL-PLANO-SEQUENCIA.md](guias/MANUAL-PLANO-SEQUENCIA.md)) |

**Todo elemento visual deve nascer no Omni.** Overlay de tipografia em pós
(FFmpeg `drawtext`), legenda, card, tarja, lower third e logo pós-renderizada são
proibidos neste fluxo. Quando houver texto, pedir a palavra como **matéria da
cena** — impressa no papel, acesa no néon, gravada na pedra. Quando houver logo,
usar a arte oficial como referência do Omni e submeter o resultado à aprovação
humana, sem correção visual local.

Ao iniciar uma peça, escolher combinações **diferentes** das da peça anterior, ou
inventar uma fora da tabela (split-screen, macro tátil, match-cut, stop-motion
simulado, tipografia editorial sobre textura).

## Motion design orgânico e sincronizado

Para filmes imersivos, não tratar cada clipe como uma vinheta independente. O
estado da arte validado é construir uma **gramática visual contínua**, orientada
pela locução medida:

1. Escolher uma entidade gráfica recorrente que atravesse o filme e mude de
   função. Exemplo: fita viva, núcleo, pulso, fluxo ou organismo modular.
2. Definir uma bíblia curta de cor, matéria, comportamento e limites. A mesma
   entidade, paleta e lógica devem existir em todos os prompts.
3. Alinhar a locução antes dos visuais. Usar os timestamps reais de palavras e
   pausas para escrever eventos `[início-fim]` dentro de cada prompt Omni.
4. Associar cada transformação à ideia falada. Movimento sem relação semântica é
   ruído: toda ação precisa ter causa visível e consequência no plano seguinte.
5. Declarar o estado inicial e o estado final de cada clipe. O começo de um plano
   deve retomar o resultado do anterior; o fim deve preparar a próxima ação.
6. Preferir deformação elástica controlada, fluxo, propagação, atração,
   reorganização e crescimento a entradas genéricas, giros ou partículas
   decorativas.
7. Montar por spans contínuos da locução, incluindo as pausas entre blocos no
   plano anterior. Cada clipe Omni oferece até cerca de 10 s; a duração usada é a
   janela medida, sem acelerar a animação.
8. Preservar a locução-mestre e substituir o áudio dos clipes visuais. Trilha e
   ducking são etapas separadas, com `fadeOut: 0`.
9. No fecho, a logo oficial pode entrar como referência do Omni e receber
   sinergia apenas do sistema ao redor. O prompt deve proibir redesenho,
   deformação, recorte, recoloração e alteração das letras.

O arquivo de projeto deve registrar o mapa `fala → ação → estado seguinte`.
Essa relação é o que diferencia motion integrado de uma sequência de ilustrações
animadas.

Quando a peça pedir **um movimento só, sem corte nenhum**, a gramática acima deixa de
ser suficiente: declarar estado inicial e final em texto não impede o modelo de começar
em outro mundo. Nesse caso a continuidade precisa ser imposta pela imagem — o último
frame de cada plano entra como primeiro frame do seguinte. A receita, as quatro regras
que seguram a cadeia e as armadilhas estão em
[guias/MANUAL-PLANO-SEQUENCIA.md](guias/MANUAL-PLANO-SEQUENCIA.md); a execução é `npm run chain`.

## Armadilhas conhecidas

- **`align` cacheia o workdir.** Para uma inspeção nova, escolha um diretório de
  diagnóstico novo. Não apague o anterior automaticamente e não use o resultado
  como autorização para nova chamada.
- **Bloqueio do `align` é relatório.** Entregue o áudio original e descreva a
  divergência. Ajuste de roteiro ou nova voz só acontece mediante pedido humano
  explícito e passa por outro plano/fingerprint.
- **Texto físico não tem "settle", tem enquadramento.** Em tipografia física ou
  de luz, a palavra já existe na cena desde o primeiro frame — o risco muda: a
  deriva da câmera **corta letras** na borda e o modelo **inventa texto ilegível
  no entorno** quando o cenário sugere documento, placa ou vitrine. Exija sempre
  no prompt: margem generosa à esquerda e à direita para nenhuma letra ser
  cortada, e "nenhum outro texto no quadro". Com essas duas frases, um lote de 8
  chapas saiu 8/8 correto de primeira.
- **Logo é referência do Omni, não overlay.** Enviar a arte oficial no job do
  fecho e exigir fidelidade. Se o provedor alterar a marca, não corrigir com
  composição local; encaminhar para revisão humana ou usar fecho somente falado.
- **`settleOffset + duração ≤ ~10s`** por clipe Omni. Se não couber, encurtar o
  plano e devolver o tempo ao vizinho.
- **Logo azul não lê sobre fundo escuro.** Como recolorir é proibido, use
  superfície clara, placa ou halo de luz atrás da marca.
- **Reaproveitar trilha e fundos entre peças** da mesma campanha economiza
  geração e cria continuidade — desde que a estética principal mude.

## Estimativa de tempo

Use `compile`, `plan` ou `dry-run`. O planejador lê recibos locais e só publica
uma faixa p50–p90 quando há amostra suficiente para todos os provedores do plano,
informando tamanho e janela da amostra. Sem evidência suficiente, retorna
`estimativa indisponível`; números históricos deste manual não são promessa.
