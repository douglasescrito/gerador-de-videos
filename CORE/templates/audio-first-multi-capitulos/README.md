# Audio-first em múltiplos capítulos

Use a narração real como base: valide o roteiro com Whisper e só então derive
os tempos de cada cena. Nenhuma voz, produção ou conta acompanha este modelo.
As etapas usam o CLI existente; `prepare-sync.mjs` é apenas uma entrada de
compatibilidade para `sync-batch`, sem gerar mídia ou chamar provedores.

## Preparar a receita

Crie sua receita `gerador-de-videos/receita@1`, `kind: filme`, com a quantidade
de cenas e durações desejadas. Cada cena define `id`, `prompt` e `duration`.
Use os campos aceitos pelo compilador, sem copiar caminhos de outra máquina.
O esqueleto abaixo demonstra a estrutura, não é uma produção pronta:

```json
{
  "schema": "gerador-de-videos/receita@1",
  "id": "meus-capitulos",
  "label": "Meus capítulos",
  "kind": "filme",
  "aspect": "16:9",
  "collection": "meus-capitulos",
  "scenes": [
    { "id": "abertura", "duration": 10, "prompt": "Defina aqui o visual da abertura." },
    { "id": "desfecho", "duration": 10, "prompt": "Defina aqui o visual do desfecho." }
  ]
}
```

As cenas visuais sem pessoa usam `text_to_video`, sem foto. Acrescente
`onScreenText` somente quando houver texto gráfico aprovado; omita-o para
montagens sem overlays. O texto e os tempos têm autoridades separadas, conforme
o [contrato de narração](../../docs/NARRATION-TEXT-CONTRACT.md).

## Produzir e medir o áudio

Em `CORE`, consulte `npm run video -- tts --help` para a narração Google Vids
e `npm run video -- music --help` para a trilha Flow Music. Esses passos exigem
as sessões próprias do operador. Os comandos abaixo pressupõem uma voz WAV
real e um roteiro aprovado já disponíveis em caminhos seus.

```powershell
npm run video -- align --audio "C:\minha-producao\voz.wav" --script-file "C:\minha-producao\roteiro.txt" --out-dir "C:\minha-producao\alinhamento"
```

Use o caminho `words` retornado pelo comando somente se o status for `pass`.
Não digite timestamps estimados nem troque o roteiro pela transcrição bruta.
Para fontes separadas por capítulo, `align --help` também descreve o modo
`--blocks` com `--scenes-dir` e os parâmetros `--lead-in`, `--tail-out` e `--gap`.
No modo de áudio contínuo, o master é preservado; não adicione atrasos depois
de medir os tempos. Escolha a duração visual para cobrir o áudio e o arremate.

## Preparar os capítulos

```powershell
npm run video -- sync-batch --recipe "C:\minha-producao\receita.json" --words "C:\minha-producao\alinhamento\palavras-master.json" --out-dir "C:\minha-producao\sync-01" --videos-dir "C:\minha-producao\videos-soltos"
```

Substitua o exemplo de `--words` pelo caminho efetivamente retornado por
`align`. Use uma pasta de preparação nova. A entrada de compatibilidade aceita
as mesmas opções:

```powershell
node templates/audio-first-multi-capitulos/prepare-sync.mjs --help
```

O comando materializa `omni-jobs.json`, prompts por cena, janelas de palavras
locais e recibo. Tempos globais são deslocados pela origem de cada clipe; voz
e música ficam proibidas nos prompts visuais. A geração continua sendo uma
ação separada pelo `batch` canônico, sujeita às autorizações de referências.
Não interprete `--attempt` como autorização para repetir chamadas ambíguas.

## Efeitos, montagem e finalização

Use `npm run video -- sfx --help` para compilar uma cue sheet com os sons locais
instalados; posicione as entradas usando os mesmos tempos medidos. Defina o
volume dos efeitos na receita, sem assumir que toda transição exige um impacto.
O comando não faz automaticamente a seleção editorial nem o alinhamento de cues.
Para arquivos separados, mantenha tempos relativos ao master na mixagem final.

Montagem, trilha, mixagem e QA pertencem ao modo Studio. Consulte os comandos
`join`, `mix` e `qa` com `--help` e as
[orientações dos motores locais](../../docs/MOTORES-LOCAIS.md). Preserve originais,
valide o MP4 fisicamente e use corte limpo, sem fade-out automático. Os antigos
nomes `remux-and-assemble.mjs` e `finalize-master.mjs` eram scripts particulares;
não são dependências deste modelo. A preparação também não sintetiza novos
ruídos ou uma trilha de efeitos silenciosamente.
