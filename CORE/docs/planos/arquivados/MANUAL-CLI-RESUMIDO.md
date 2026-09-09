# Manual resumido do CLI Gemini Omni

> **Documento histórico/de consulta, arquivado em `docs/planos/arquivados/`.**
> O fluxo normativo está em
> [MANUAL-PRODUCAO-DE-PECAS.md](../../MANUAL-PRODUCAO-DE-PECAS.md), e os estados reais
> de comandos e provedores estão nos documentos gerados
> [docs/COMMAND-STATUS.md](../COMMAND-STATUS.md) e
> [docs/CAPABILITIES.md](../CAPABILITIES.md). Qualquer trecho abaixo que use
> `align`, OCR, transcrição ou QA como motivo para corrigir/regenerar foi
> substituído: essas rotinas são opt-in e report-only; nova chamada paga depende
> de pedido humano explícito.
>
> Para o Knowledge Core, consulte `npm run video -- knowledge --help`, a
> [política de governança](../KNOWLEDGE-GOVERNANCE-POLICY.md) e o
> [estado de implementação](../INTELLIGENCE-IMPLEMENTATION-STATUS.md).

Execute sempre dentro de `CORE/`.

No PowerShell, prompts multilinha devem usar `--prompt-file`; uma variável multilinha passada diretamente por `npm run` pode cortar o texto e todas as opções que vierem depois.

## Comandos principais

```powershell
npm run doctor
npm run video -- docs
npm run video -- styles
npm run video -- knowledge --help
npm run video -- generate --mode raw --prompt "direção do vídeo" --image "C:\referencia.png" --confirm-provider-input true --aspect 16:9
npm run video -- generate --mode studio --style aquarela-2d@1 --prompt "direção do vídeo" --aspect 16:9 --collection nome-da-colecao
npm run video -- generate --mode studio --prompt-file C:\prompts\filme.txt --narration-audio outputs\narracao.mp3 --word-timestamps outputs\palavras.json --video-fit loop --collection filme-narrado
npm run video -- generate --task edit --video C:\base.mp4 --confirm-provider-input true --prompt "ajuste pedido" --collection nome-da-colecao
npm run video -- batch --jobs jobs.json --parallel 3 --out-dir outputs\lote
npm run check
```

`raw` é o padrão literal. `studio` é opt-in e registra qualquer composição de
preset. Arquivo externo exige `--confirm-provider-input true`, preso por
SHA-256/bytes/MIME à invocação. Chamadas pagas de imagem, vídeo, TTS, Lyria e QA
semântico exigem a confirmação de gasto correspondente.

Por padrão, cada clipe recebe uma única geração. As verificações técnicas não iniciam correção, edição ou nova tentativa. Em sequências, gere uma vez por parte e concatene os MP4 compatíveis; use `generate --task edit --video` somente quando o usuário pedir explicitamente um ajuste depois da entrega. Não há módulo de correção automática.

## Knowledge Core provider-free

```powershell
npm run video -- knowledge
npm run video -- knowledge --action init
npm run video -- knowledge --action integrity --root-scope-id <id>
npm run video -- knowledge --action export --root-scope-id <id> --out C:\destino-privado\knowledge-export.json
npm run video -- knowledge --action backup --db C:\store\knowledge.sqlite --root-scope-id <id> --classification confidential --out C:\backup\knowledge.mkvbackup
npm run video -- knowledge --action restore --backup C:\backup\knowledge.mkvbackup --root-scope-id <id> --db C:\restore\knowledge.sqlite --asset-root C:\assets
```

`init` é a única ação que inicializa ou migra o store. `status`, `integrity` e
export são read-only. Backup cria um snapshot SQLite consistente, classificado e
verificado; a ação falha fechado se o store possuir mais de uma raiz e exige o
`root_scope_id` exato quando houver uma. Restore exige um banco de destino novo,
valida manifest, checksums e attestation e nunca sobrescreve o original.

O envelope `knowledge-record-envelope@1` é obrigatório para itens privados e
candidatos. Ele materializa classificação, owner, proveniência, modalidade,
evidências, retenção, rights, ator e hash; direito desconhecido não vira
consentimento. A comparação de assets no restore é report-only, inclusive quando
o estado é assimétrico; ela só ocorre quando o bundle declara inventário, que o
backup do CLI atual registra como `not-declared`. Nenhum check repara vínculo,
substitui arquivo ou persiste quarentena.

Replay histórico e importadores ainda são APIs provider-free da fundação, não
subações de promoção. O replay opera sobre export/release autorizada com readers
e upcasters puros; os importadores de `StyleSpec`, `BrandKit`, `recipe@2` e
evidência de referência só produzem candidatos read-only, deduplicados e
sanitizados. Revisão humana continua obrigatória para qualquer promoção.

## Filme retomável em seis comandos

```powershell
npm run video -- dry-run --spec filme.json
npm run video -- plan --spec filme.json
npm run video -- run --state outputs\meu-filme\metadados\film-state.json --confirm-paid true
npm run video -- approve --draft outputs\meu-filme\metadados\draft.json
npm run video -- resume --state outputs\meu-filme\metadados\film-state.json --confirm-paid true
npm run video -- status --state outputs\meu-filme\metadados\film-state.json
```

`run` prepara keyframes, voz e música e pausa. `resume` só chama o Omni depois da aprovação; etapas concluídas com artefato e recibo válidos não são repetidas.

## Áudio, acabamento e QA

```powershell
npm run video -- tts --mode studio --text-file roteiro.txt --voice Charon --out voice.wav --confirm-paid true
npm run video -- music --mode studio --preset institucional --backend lyria-realtime --duration 30 --out music.wav --confirm-paid true
npm run video -- mix --mode studio --voice voice.wav --music music.wav --out master.wav
npm run video -- finish --mode studio --video original.mp4 --delivery-profile web-1080p --out final.mp4
npm run video -- qa --mode studio --video final.mp4
```

## Narração externa e tempos por palavra

Quando a narração vier do gerador de áudio, forneça o MP3 e o JSON de palavras. O CLI transforma o alinhamento em guia temporal para o Omni e cria uma versão narrada separada, sem sobrescrever o MP4 original:

```powershell
npm run video -- generate `
  --mode studio `
  --prompt-file "C:\prompts\filme.txt" `
  --narration-audio "outputs\narracao-ai-talk-radio-30s\narracao-publicitaria-ai-talk-radio.mp3" `
  --word-timestamps "outputs\narracao-ai-talk-radio-30s\alinhamento-palavras\narracao-publicitaria-ai-talk-radio.json" `
  --video-fit loop `
  --collection filme-narrado
```

`--video-fit loop` evita cortar uma locução maior que o clipe, repetindo somente o vídeo até o fim do áudio. Sem `loop`, o comando interrompe a entrega narrada quando o vídeo não comporta a locução.

## Gerar um vídeo

Use prompt direto e até quatro imagens.

```powershell
npm run video -- generate `
  --prompt-file "C:\prompts\cena.txt" `
  --image "C:\referencia.png" `
  --confirm-provider-input true `
  --aspect 16:9 `
  --out "outputs\cena-01.mp4"
```

Saída:

- MP4 original em `outputs/`
- recibo em `.mp4.receipt.json`
- `interactionId` apenas para auditoria; ajustes cookie-only usam o MP4 como entrada
- `deliverySummary` com tokens disponíveis, tempos por etapa e total
- sem `--out`, a entrega fica em `outputs/<colecao>/` com `videos-soltos/`, `receitas/`, `videos-unidos/` e `metadados/`

O CLI não sobrescreve um MP4 ou recibo existente. Use outro `--out` para criar uma nova versão.

## Ajustar um vídeo gerado

Use o MP4 retornado na geração anterior.

```powershell
npm run video -- generate `
  --task edit `
  --video "outputs\cena-01.mp4" `
  --confirm-provider-input true `
  --prompt "deixe mais lento, com luz mais quente" `
  --out "outputs\cena-01-v2.mp4"
```

`refine` por `interactionId` fica bloqueado porque não há contrato cookie-only verificável; `generate --task edit --video` envia o MP4 pela sessão headless.

## Produção de peças — receita completa

Para produzir um filme narrado do começo ao fim (conceito, roteiro, voz,
alinhamento, trilha, imagem, verificação, montagem, fecho, QA e entrega), siga
[MANUAL-PRODUCAO-DE-PECAS.md](../../MANUAL-PRODUCAO-DE-PECAS.md). O esqueleto:

```
MOTOR    1 conceito -> 2 roteiro -> 3 narração -> 4 align -> 5 trilha+mix
CRIATIVO 6 imagem -> 7 verificação -> 8 montagem -> 9 fecho
MOTOR    10 qa -> 11 finish
```

O motor se repete em toda peça; a estética (passos 6 a 9) deve mudar a cada
criação. O comercial flat 2D abaixo é **uma** das opções do repertório.

## Comercial flat 2D (texto na tela 100% Omni)

Receita gravada em código para comerciais com tipografia na tela feita pelo próprio Omni. A regra de ouro: **estilo flat 2D, fundo escuro, uma frase curta por cena** — assim o Omni acerta o texto. Cena 3D cheia borra e erra as letras.

O comando `commercial` tem etapas (`--step`). O fluxo completo, do áudio à união:

```powershell
# 1) NARRAÇÃO (legado): blocos Omni continuam compatíveis, mas para novos filmes prefira o comando TTS acima
#    blocos.json = [{ "id": "bloco-01", "text": "fala literal…", "direction": "tom…" }, …]
npm run video -- commercial --step narration-jobs --blocks blocos.json --out narration-jobs.json
npm run video -- batch --jobs narration-jobs.json --out-dir outputs\narracao\blocos
#    ALIGN: extrai o áudio, roda Whisper, corrige a ortografia contra o roteiro e monta o master
npm run video -- align --blocks blocos.json --scenes-dir outputs\narracao\blocos
#    → narracao-master.wav + palavras-master.json (cronograma) + spans.json + recibo
#    Erro de ASR (grafia parecida) é normalizado localmente; palavra trocada/engolida sai "blocked" para decisão humana, sem regeneração automática.

# 2) SPEC: dividir o roteiro em cenas (uma frase curta cada) a partir do cronograma de palavras
npm run video -- commercial --step scaffold --words palavras-master.json --narration-duration 37.38 --out spec.json
#    Edite spec.json: ajuste estilos por cena (tense, brand, warm, forward, closer) e settleOffset se preciso.

# 3) JOBS + geração das cenas
npm run video -- commercial --step jobs --spec spec.json --logo logo-focus.png --out jobs.json
npm run video -- batch --jobs jobs.json --out-dir outputs\meu-comercial\videos-soltos

# 4) VERIFICAR o texto de cada cena (extrai um frame na janela de texto formado)
npm run video -- commercial --step verify --spec spec.json --scenes-dir outputs\meu-comercial\videos-soltos
#    Confira os JPGs; o relatório não seleciona nem regenera cenas. Uma nova geração só ocorre após pedido humano explícito.

# 5) MONTAR: apara cada cena na janela de texto formado, encaixa no bloco de narração,
#    concatena e junta a narração-mestre (a logo segura ~1s após a última palavra).
npm run video -- commercial --step assemble --spec spec.json `
  --scenes-dir outputs\meu-comercial\videos-soltos `
  --narration narracao-master.wav `
  --out outputs\meu-comercial\final.mp4
```

Estilos de cena disponíveis (`spec.json` → `scenes[].style`): `default` (navy, texto branco), `tense` (quase preto, azul-elétrico), `brand` (cobalto vibrante), `forward` (setas de avanço), `warm` (glow dourado, momento de emoção) e `closer` (fechamento com a logo oficial via `reference_to_video` — exige `--logo` ou `scene.logo`).

Limites conhecidos (aceitos): o texto do Omni forma em ~4s (por isso a montagem usa a janela de texto formado) e o sync é por cena, não palavra-a-palavra. O `assemble` valida offset + duração contra a duração real de cada clipe e falha com mensagem clara se não couber.

### Regras de marca

Gravadas em código (`lib/media-pipeline/commercial.mjs`, função `assertBrandSafe`), aplicadas automaticamente em narração, texto de cena, spec e scaffold:

- **Termos vetados pela marca são proibidos** em qualquer peça: a lista fica em código e qualquer etapa que receba um desses termos falha com erro de regra de marca. Serve para banir a associação clichê que a marca não quer, preservando o nome dela.
- **A logo do fechamento respeita a forma original** — o preset `closer` instrui reprodução fiel (sem redesenhar, recolorir, reletrar ou distorcer) e sempre via `reference_to_video` com a logo oficial.

Para adicionar novas palavras vetadas, edite `BRAND_BANNED_PATTERNS` em `commercial.mjs` (e o teste correspondente).

## Lote com paralelismo

Use quando quiser testar vários prompts ou gerar vários clipes.

```powershell
npm run video -- batch `
  --jobs "outputs\meu-lote\jobs.json" `
  --parallel 3 `
  --out-dir "outputs\meu-lote"
```

Formato mínimo de `jobs.json`:

```json
[
  {
    "id": "01-teste",
    "prompt": "Create a 10-second premium cinematic 3D video...",
    "images": ["C:/referencia.png"],
    "task": "auto",
    "aspect": "16:9"
  }
]
```

O batch salva:

- um MP4 e recibo para cada job aceito;
- `summary.json` com sucessos e bloqueios;
- jobs bloqueados não interrompem o restante do lote.

O padrão e o valor recomendado são `--parallel 3`. Valores permitidos: 1 a 8.

Durante o lote, o terminal acompanha cada fase sem misturar os logs com o JSON final:

```text
[01/10] Omni PROCESSING | 15,3s | poll 4
[01/10] concluído | Omni 44,2s | download 0,8s | local 0,03s | entrega 45,0s | total 45,1s
[batch 6/10] decorrido 1m38s | ETA 1m35s | ativos 3 | fila 1
```

Os logs são enviados para `stderr`; `stdout` continua contendo somente o JSON final. A ETA usa primeiro o lote mais recente encontrado ao lado do novo diretório e se recalibra assim que o lote atual conclui vídeos. Sem amostras reais, o terminal mostra `ETA calculando...` em vez de inventar uma previsão.

O `summary.json` versão 2 registra:

- wall clock de preparação, pool e montagem do resumo;
- fila, Omni, download, finalização local e entrega total por vídeo;
- média, mediana e P95 das fases;
- vazão de vídeos por minuto;
- participação do Omni versus o restante no tempo acumulado dos jobs.

Como jobs paralelos se sobrepõem, a participação acumulada das fases não deve ser somada para reconstruir o wall clock. Recibos antigos continuam úteis como baseline de duração total, mas suas fases desconhecidas permanecem `null`.

## Imagem intermediária

Use quando quiser criar uma nova referência antes do vídeo.

```powershell
npm run image `
  --prompt-file "C:\prompts\imagem.txt" `
  --image "C:\referencia.png" `
  --confirm-provider-input true `
  --aspect 16:9 `
  --size 2K `
  --out "outputs\referencia-gerada.png"
```

Depois use a imagem no vídeo:

```powershell
npm run video -- generate `
  --prompt-file "C:\prompts\video.txt" `
  --image "outputs\referencia-gerada.png" `
  --confirm-provider-input true `
  --aspect 16:9
```

Imagem intermediária não garante aprovação dos filtros do Omni.

## Tasks

- Sem imagem: `text_to_video`
- Com imagem: `reference_to_video`
- Imagem como quadro inicial: `image_to_video`
- Atalho seguro para uma foto como quadro inicial: `--first-frame "C:\foto.jpg"` (força `image_to_video` e não altera o prompt)
- Deixar o Omni inferir: `--task auto`
- Editar MP4 enviado: `--task edit --video "C:\base.mp4"`

`--image`, `--first-frame` e `--video` exigem
`--confirm-provider-input true`. A confirmação é efêmera e não concede reuse.
`--image` é referência generativa; não garante que a foto apareça literalmente.
Não combine `--first-frame` com `--image` ou `--video`. Para papéis avançados
em `--task auto`, use no prompt as tags oficiais `<FIRST_FRAME>` e
`<IMAGE_REF_N>`.

## Prompt para pessoa reconhecível

Para reduzir bloqueio com referência humana adulta, evite pedir identidade real exata.

Prefira:

- `use the reference image only as loose character inspiration`
- `fictional adult presenter`
- `not an exact likeness`
- `premium cinematic 3D`
- `documentary-broadcast style`
- `soft-realism animated video`

Evite:

- `live-action`
- `photorealistic real person`
- `preserve identity`
- `exact likeness`
- `realistic avatar`
- `humanized 3D`

Template seguro:

```text
Create a 10-second premium cinematic 3D video using the reference image only as loose character inspiration for a fictional adult presenter, not an exact likeness. He presents an illustrated animated weather screen. Brazilian Portuguese from Brazil, neutral Brazilian accent, Brazilian cadence, not European Portuguese. Five clean studio camera cuts. No subtitles, no lower thirds, no logos, no watermark.
```

## Português brasileiro

Para áudio em PT-BR, inclua explicitamente:

```text
Brazilian Portuguese from Brazil, neutral Brazilian accent, Brazilian cadence, not European Portuguese.
```

Mesmo assim, o idioma ainda depende do modelo e pode exigir variações.

## Erros comuns

- `Input blocked`: recusa terminal do provedor. Reformule o prompt; não repita igual.
- `health: "not_exposed"` no `doctor`: o endpoint está alcançável, mas não publica `/api/health`; o comando retorna JSON sem stack trace.
- `health: "unreachable"` no `doctor`: o app ou upstream não respondeu.
- Prompt com aspas quebrando no PowerShell: use `--prompt-file`.

Na integração headless, uma falha ambígua não é repetida automaticamente; reconcilie o handle persistido antes de retomar.

## Onde ver detalhes

```powershell
npm run video -- docs
```

Manual completo: `README.md`. Receita de filme narrado com telas animadas, trilha e
sincronia por palavra (validada nas apresentações do projeto): `docs/guias/MANUAL-FILME-NARRADO.md`.
Receita de filme longo sem um único corte, com os planos encadeados por frame:
[MANUAL-PLANO-SEQUENCIA.md](../../guias/MANUAL-PLANO-SEQUENCIA.md) (`npm run chain`).
