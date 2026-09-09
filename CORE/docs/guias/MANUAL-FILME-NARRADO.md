# Manual — filme narrado com telas animadas, trilha e sincronia

> **Relato histórico, não fluxo operacional vigente.** Consulte
> [MANUAL-PRODUCAO-DE-PECAS.md](../MANUAL-PRODUCAO-DE-PECAS.md) para a política
> canônica. Neste documento, recomendações antigas de conferir/transcrever e
> então regenerar não concedem autorização: `align` e QA são opt-in,
> report-only, e nunca iniciam correção, retry ou nova chamada paga.

Receita validada em duas peças de apresentação, uma de 80 s com 19 planos e outra
de 50 s com 28 planos, somando 47 gerações e zero regenerações. Executar tudo em `CORE/`.

## Arquitetura da peça

Três trilhas de material, geradas em paralelo e casadas na montagem:

| Trilha | Como nasce | Risco |
|---|---|---|
| **Voz** | blocos Omni `text_to_video` de ~10s, tela quase preta, "audio is the hero" | pode trocar palavra — conferir por transcrição |
| **Música** | mesmos blocos, prompt instrumental com tom e BPM fixos | não julgável de ouvido por um agente |
| **Imagem** | cards flat 2D (texto) + takes de VFX (sem texto) | letra errada — conferir frame a frame |

Regra que define a qualidade visual: **texto e espetáculo nunca no mesmo plano.**
Card = fundo chapado, uma frase curta, letra legível. Take de espetáculo = zero texto,
e aí o modelo pode entregar CGI cinematográfico sem risco de letra quebrada.

## 1. Narração

Escrever `blocos-narracao.json` com frases curtas — uma ideia por bloco:

```json
[{ "id": "n01", "text": "Tudo começa com uma frase.",
   "voice": "a young, vibrant, modern Brazilian brand voice, energetic and magnetic",
   "direction": "Punchy hook. Confident, close-mic, landing hard on the last word." }]
```

```powershell
npm run video -- commercial --step narration-jobs --blocks blocos-narracao.json --out narration-jobs.json
npm run video -- batch --jobs narration-jobs.json --parallel 3 --out-dir outputs\<colecao>\narracao\blocos
```

Alinhar por palavra e montar a narração-mestre num passo só — o comando `align`
extrai o áudio de cada bloco, roda o Whisper (`--word_timestamps`), **corrige a
ortografia contra o roteiro** e emite a narração-mestre + `palavras-master.json`
(cronograma de palavras) + `spans.json` (janela de cada bloco) + recibo:

```powershell
npm run video -- align --blocks blocos-narracao.json --scenes-dir outputs\<colecao>\narracao [--whisper-model small]
```

A correção **adota a grafia do roteiro mantendo o tempo medido pelo Whisper** (nunca
inventa timestamp). Um alinhamento Needleman-Wunsch separa erro de ASR (formas
parecidas, similaridade ≥ 0,75 → corrige sozinho: "Focos"→"Focus", "recebo"→"recibo")
de palavra realmente trocada, engolida ou repetida (→ `status: blocked`, regerar o
bloco). Em caso de dúvida entre grafia e troca real, reconfirmar com
`--whisper-model large-v3-turbo` antes de gastar numa regeração.

O respiro entre blocos controla o ritmo (`--gap`): 0,30s dá tom institucional, 0,22s
(padrão) dá tom publicitário. O aparo de cada bloco usa `--lead-in`/`--tail-out`.
Blocos com `word_mismatch`/`missing_word` saem no `blocked`; regere só esses.

## 2. Trilha

Um bloco Omni por seção, **mesmo tom e BPM em todos** para dar continuidade:

```text
Create one continuous 10-second premium ambient video: near-black screen ... no text.
The audio is the hero: a modern cinematic instrumental in A minor at 120 BPM.
<seção: cold open tenso | build | groove | calor emocional | confiança | suspensão | finale>
Clean modern production, wide stereo, clear midrange space left open for a voice-over.
No voices, no vocals, no singing, no lyrics; instrumental music only.
```

A variação entre gerações vira **arco dramático proposital** quando as seções são
planejadas na ordem da narrativa. Emendar com `acrossfade=d=0.9`, cortar na duração
exata da narração-mestre e terminar por corte limpo. Não aplicar fade final, salvo
pedido explícito do usuário.

Conferir que não veio mudo (`ffmpeg -af volumedetect`): o esperado é média entre
−12 e −23 dB. Depois mixar — local, sem custo:

```powershell
npm run video -- mix --mode studio --voice narracao-master.wav --music trilha-bed.wav `
  --music-gain 0.38 --ducking-ratio 12 --ducking-threshold 0.05 --out master-mixado.wav
```

O padrão do CLI é `fadeOut: 0`. Se houver pedido explícito de fade, usar
`--fade-out <segundos>` e conferir o valor no recibo da mixagem.

Criar a pasta de saída antes: o comando ainda não cria o diretório sozinho.

## 3. Desenho dos cortes

Este é o passo que produz a sincronia. Com a timeline de palavras do master em mãos,
definir cada plano **em fronteira de palavra**:

- bloco de fala longo vira 2–3 planos (o card muda enquanto a frase continua);
- pausas entre blocos são onde entram os takes de espetáculo;
- ritmo publicitário: corte a cada 1,5–2,5s. Card precisa de ≥1,2s para ser lido.

Os spans do spec são contíguos e somam a duração da narração:

```json
{ "id": "c05", "text": "Personagens", "style": "default", "span": [9.64, 10.84], "settleOffset": 6.2 }
```

Estilos: `default` (navy/branco), `tense` (quase preto/azul-elétrico), `brand`
(cobalto vibrante), `warm` (dourado), `forward` (setas), `closer` (logo fiel).
Use `"holdTailSeconds": 0` no `assembly` quando não houver fechamento com logo.

## 4. Geração dos planos

Cards pelo caminho comprovado; takes de espetáculo com prompt livre — sempre
terminando em "no text, no letters, no numbers, no logos, no watermark":

```powershell
npm run video -- commercial --step jobs --spec spec-cards.json --out card-jobs.json
# juntar card-jobs.json + spectacle-jobs.json em visual-jobs.json
npm run video -- batch --jobs visual-jobs.json --parallel 3 --out-dir outputs\<colecao>\videos-soltos
```

Vocabulário que rendeu bons takes: *macro, volumetric light rays, anamorphic flares,
liquid chrome, speed ramp, whip-pan, hyperspeed corridor, glass refraction,
particles converging, shallow depth of field, photoreal CGI, film grain*.

## 5. Verificação — o passo que não se pula

```powershell
npm run video -- commercial --step verify --spec spec-final.json --scenes-dir outputs\<colecao>\videos-soltos
```

**Abrir e ler cada frame.** O texto do Omni leva ~4s para se formar, mas frases longas
ou animação letra a letra podem levar mais: já foram necessários 6,2s, 7,6s e 8,3s.
Quando o card não estiver assentado, **ajustar `settleOffset` em vez de regerar** —
extrair frames em vários instantes até achar onde o texto está completo e estável.

Restrição a respeitar: `settleOffset + duração ≤ 10,005s`. Se não couber, encurtar a
duração do card e devolver o tempo ao plano vizinho.

## 6. Montagem, QA e entrega

```powershell
npm run video -- commercial --step assemble --spec spec-final.json `
  --scenes-dir outputs\<colecao>\videos-soltos --narration master-mixado.wav `
  --out outputs\<colecao>\videos-unidos\final.mp4
npm run video -- qa --mode studio --video ...\final.mp4 --expected-duration <s> --expected-parts <n> --actual-parts <n>
npm run video -- finish --mode studio --video ...\final.mp4 --delivery-profile web-1080p --out ...\1080p.mp4
```

Detalhes de caminho que economizam tempo:

- o batch nomeia os arquivos como `NN-<id>.mp4`; o assemble resolve por sufixo `-<id>`;
- `scene.file` é resolvido a partir do diretório de execução — usar `outputs/<colecao>/...`
  contando de `CORE/`, não relativo à coleção;
- para **reaproveitar** um take em dois pontos do filme, criar duas cenas com ids
  distintos, `settleOffset` diferentes e `file` apontando para o mesmo MP4.

## 7. Fechamento com a logo original (assinatura em pós-produção)

O preset `closer` faz o Omni **recriar** a logo por `reference_to_video`. Quando o
cliente exige a marca fiel, o certo é aplicar o PNG oficial em
pós — como manda o manual de marca. Duas variantes, ambas fora do Omni:

- **Assinatura clara**: fundo claro premium (`color=…EEF3FC` + `vignette`), logo
  original centrada, tagline em navy. É o "clean white outro" que os specs preveem.
- **Assinatura em movimento** (mantém a sinergia da peça): gerar **1 bloco Omni** de
  fundo no estilo do filme com "no text, no logo, centro limpo"; em pós, compor a
  logo original numa **placa branca arredondada** (com sombra suave) sobre esse
  fundo, tagline em branco, entrando com fade + slide. A logo azul não lê sobre o
  navy — a placa branca resolve **sem recolorir** (regra de marca).

A placa arredondada sai de um PNG com alpha via `geq` (retângulo de cantos
arredondados por distância), a sombra é a mesma placa em preto + `boxblur`, e o
conjunto entra com `fade=t=in:alpha=1`. Salve o clipe pronto como a cena do closer
em `videos-soltos` e ponha `"settleOffset"` logo após o fade (ex.: 0,7s) no spec; o
`assemble` apara `[settleOffset, settleOffset + span + holdTailSeconds]`.

## Tempos de referência

Com `--parallel 3`: **~3,9 vídeos por minuto**, mediana de ~43s por vídeo, dos quais
**96% é espera do provedor**. Uma peça completa de 50s (12 blocos de voz + 9 de
música + 26 planos + montagem + QA + 1080p) levou **21 minutos de ponta a ponta**,
rodando voz e trilha em lotes simultâneos.

## Limites conhecidos

- `tts` e `music` usam a sessão Google cookie-only em Playwright headless; não existe configuração por chave neste projeto.
- `qa --semantic` permanece bloqueado até existir adapter cookie-only verificável.
- A qualidade musical não é verificável automaticamente — medir sinal e loudness,
  e deixar o julgamento estético com o usuário.
- Sincronia é por cena, não palavra a palavra (para palavra a palavra existe
  `npm run captions`, que acende cada palavra no tempo exato).
