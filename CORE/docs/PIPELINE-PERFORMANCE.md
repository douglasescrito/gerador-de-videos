# Desempenho do pipeline: o que paraleliza e o que nunca paraleliza

Documento escrito à mão. Descreve o contrato de otimização do pipeline, o alvo
de parede de 300 segundos e como o executor continua com segurança quando esse
alvo é excedido.

A regra que organiza tudo: **produção definida executa por completo**. Em
`production-once`, correções objetivas, retomada, aceite técnico e continuidade
do draft reutilizam a autorização congelada da produção; não nasce uma decisão
humana entre etapas. Direitos, escrita externa e exclusão local continuam com
suas confirmações próprias porque não são decisões criativas do filme.

## Linha de base medida

| Medição | Antes |
| --- | --- |
| Produção completa | 27min26s |
| Whisper para 60s de áudio | 62,5s |
| Análise acústica sem Whisper | 1,79s |
| Render final | 2min09s |
| Concorrência do lote Omni | 3, fixa |
| Alinhamento | blocos em sequência |
| Cache de Whisper | só transcrição, sem timestamps |

Medição da produção `motivacional-instante-camera-off-v1` (2026-08-11):

| Etapa observada | Wall |
| --- | ---: |
| Flow bem-sucedido no provedor | 38,38s |
| Flow até WAV local | 50,56s |
| Flow preso no timeout antigo | 917,76s |
| 6 cenas Omni, `parallel=3` | 218,44s |
| Narração Omni | 206,36s |
| Whisper `small`, CPU | 53,28s |
| Whisper `large-v3-turbo`, CPU, 5 clipes | 306,62s |
| Montagem e mixes locais | ~7s |

Os 917,76s não foram latência normal do Flow; foram espera headless sem nova
evidência. O orçamento suave agora registra o desvio em 90s, preserva o handle e
continua a mesma tentativa. Não há corte rígido: trabalho em progresso pode
ultrapassar 300s e concluir normalmente.

Hardware de referência: RTX 4070 Laptop, 8 GB de VRAM, PyTorch 2.5.1 + CUDA 12.1.

## Medição real com CUDA (2026-08-10)

Alinhamento de 9,9s de narração, modelo `small`, `--whisper-device cuda`
(fp16), mesma peça e mesma máquina, duas execuções:

| Execução | Cache | Wall |
| --- | ---: | ---: |
| 1ª (fria) | 0 hits / 1 miss | 20,02s |
| 2ª (mesma peça) | 1 hit / 0 misses | 2,85s |

Evidência: `CORE/diagnosticos/provas-whisper/cuda-2026-08-09-{1,2}/` (recibo,
`alinhamento.metrics.json`, spans). A segunda execução não toca o Whisper:
extração de WAV, probe e montagem do master somam ~2,9s.

## Instrumentação (`stage-metrics.mjs`)

Toda etapa registra fila, execução, cache, modelo, dispositivo, memória de GPU,
paralelismo efetivo e tentativas. Os atributos passam pelo saneamento da
telemetria: cookie, token e prompt não entram.

`effectiveParallelism` é **medido**, não declarado: é o tempo somado das
execuções dividido pela janela real da etapa. Pedir 3 workers e medir 1,04
significa que a concorrência não aconteceu.

`compareStageMetrics(baseline, candidato)` responde à única pergunta que importa
depois de uma mudança: ficou mais rápido, onde, e o ganho veio de cache ou de
execução?

O alinhamento grava `alinhamento.metrics.json` ao lado do recibo. O documento de
métricas fica **fora** da impressão digital do alinhamento de propósito: tempo de
parede muda a cada execução e não pode alterar a identidade do resultado.

## GPU explícita (`whisper-runtime.mjs`, `whisper-backends.mjs`)

- `--whisper-device auto` usa CUDA quando existe e, quando não existe, **diz**
  que caiu para CPU (campo `deviceNotice`).
- `--whisper-device cuda` é exigência: sem CUDA, falha. Não existe mais o caso
  "achei que estava na GPU e demorou 3x".
- `--whisper-device cpu` nunca liga fp16.
- A sonda pergunta ao torch do interpretador **ao lado do `whisper.exe`**, não a
  um `python` qualquer do PATH — senão a resposta descreveria outro ambiente.

O backend `faster-whisper` (CTranslate2) existe como candidato e exige
interpretador isolado (`--whisper-python` ou `FASTER_WHISPER_PYTHON`). Ele nunca
reaproveita o ambiente do Whisper oficial, que é a referência de validação.

`whisper-equivalence.mjs` decide se o candidato pode ser promovido. Precisa
manter: mesma transcrição, timestamps dentro da tolerância, mesma correção
ortográfica, mesmas findings — e, sem exceção, **nenhum bloco aprovado que a
referência bloqueou**. A assimetria é proposital: bloquear a mais custa uma
regeração; aprovar a mais publica uma tela que a voz não disse. Um único bloco
reprovado reprova a troca inteira. A promoção não é automática.

## Cache completo (`whisper-cache.mjs`)

Chave composta:

```
hash-do-áudio + modelo + idioma + parâmetros + fingerprint-do-runtime
```

A entrada guarda a medição inteira — palavras, tempos, probabilidades — e não só
a transcrição. Consequências:

- áudio intocado nunca volta ao Whisper;
- trocar de modelo invalida só o cache incompatível;
- corrigir o roteiro (que não muda o áudio) reaproveita timestamps aprovados;
- trocar device ou versão do torch invalida sozinho, pelo fingerprint.

Entradas da versão 1 (só transcrição) contam como ausência, nunca como acerto
parcial. Há lock por chave: dois processos não medem o mesmo áudio ao mesmo
tempo na mesma GPU de 8 GB. Lock órfão expira por idade.

`--refresh-cache true` força nova medição sem quebrar a chave.

## Alinhamento em camadas (`narration-align.mjs`)

```
CPU (paralela)  extrair WAV -> probe de duração -> hash do áudio
GPU (fila 1)    medir tempos por palavra, com cache por hash
CPU (série)     corrigir contra o roteiro, planejar e montar o master
```

A inferência é fila de largura 1 por padrão. Abrir seis Whispers numa VRAM de
8 GB troca espera por swap; não é otimização. A ordem editorial é preservada:
`mapWithConcurrency` devolve na ordem da entrada, e bloco bloqueado continua
impedindo a montagem do master.

Com `streamAlignment: true`, cada bloco entra nessa fila assim que seu clipe
Omni termina, enquanto os outros clipes ainda estão sendo gerados. A passada
final encontra as medições no cache e apenas recompõe a ordem editorial. Isso
remove a barreira artificial “esperar todos os vídeos para só então iniciar o
Whisper” sem abrir inferências concorrentes na mesma GPU.

## Grafo da produção (`pipeline-graph.mjs`)

Voz e Flow começam juntos. A geração da trilha não depende do arquivo de voz;
somente o fit exato espera o probe de duração. O alinhamento por bloco se
sobrepõe à geração Omni, e montagem e mixagem continuam concorrentes.

Em `production-once`, a autorização única substitui as antigas pausas de
revisão/aceite dentro da produção. O journal ainda registra o evento equivalente
de continuidade e mantém a proveniência. `pause-for-review` existe somente para
receitas legadas que o declarem explicitamente.

Falha em um ramo não derruba os outros: bloqueia só quem dependia dele, com o
motivo nomeado. Estado ambíguo reconcilia a mesma tentativa; rejeição terminal
pode abrir outra somente dentro de `maxAttempts` e da autorização hash-bound.

`criticalPath()` diz quando aumentar paralelismo deixou de ajudar e o próximo
ganho tem que vir de acelerar uma etapa.

## Concorrência do lote (`omni-concurrency.mjs`)

| Perfil | Início | Faixa |
| --- | ---: | --- |
| `conservative` | 2 | 1–2 |
| `balanced` | 3 | 2–3 |
| `fast` | 4 | 2–4 |
| `stress` | 6 | 2–8, só em benchmark explícito |

O controlador mede latência, erro de provedor, fila, utilização e taxa de
bloqueio. Recusa do provedor derruba a largura; só sobe com fila esperando —
aumentar largura sem demanda não acelera nada e só aumenta a chance de recusa.

Concorrência maior não habilita retry por si só. O executor de produção faz a
distinção: estado ambíguo reconcilia sem POST novo; apenas rejeição terminal
comprovada pode consumir a próxima tentativa autorizada. Não há decisão humana
intermediária nem loop ilimitado.

## Entrega (`encoder-capabilities.mjs`, `delivery-profile.mjs`)

`finishVideo({ accel })` aceita `cpu` (referência), `nvenc` e `auto`. Perfis de
stream-copy continuam copiando: não existe acelerar o que não reencoda, e copiar
já é mais rápido e mais fiel.

`crf`/`preset` do libx264 são traduzidos para `cq`/`preset pN` do NVENC. Toda
entrega acelerada passa por `assertDeliveryIntegrity`: duração, resolução, fps,
presença e formato de áudio. O caminho por CPU continua reportando sem bloquear,
para não invalidar retroativamente material já entregue.

`benchmarkDeliveryEncoders()` roda os dois caminhos e produz o veredito.
Velocidade sozinha não promove: arquivo inflado além da tolerância, duração
divergente ou fps alterado reprovam. A promoção é decisão humana sobre o
documento.

## QA (`qa.mjs`)

Probe de vídeo, detecção de preto/congelamento, silêncio, loudness, amostragem
de quadros e integridade de recibos rodam em paralelo. OCR e QA semântico rodam
depois dos quadros, porque dependem deles.

O veredito técnico continua determinístico, posterior a todas as verificações,
com exatamente o mesmo conjunto de warnings — paralelizar não pode mudá-lo. O
QA semântico permanece report-only e nunca dispara correção automática.

## Onde o ganho aparece

- Reexecução sem mudança de áudio: o alinhamento inteiro vira acerto de cache.
- Correção de roteiro: nenhum áudio volta ao Whisper.
- Whisper na GPU com fp16, quando disponível, em vez de queda silenciosa.
- Extração e probe dos blocos em paralelo, em vez de um por vez.
- Flow e voz concorrentes; o fit espera apenas a duração medida.
- Whisper por bloco sobreposto à geração dos demais blocos Omni.
- Música, efeitos e visuais concorrentes, em vez de enfileirados.
- NVENC no acabamento, **se** passar no gate.

## Onde o ganho não aparece — e não deve aparecer

Espera real dos provedores continua sendo a maior fatia do relógio, e nenhuma
otimização local a remove. O alvo de 300s é SLO, não deadline: se Flow ou Omni
estiverem produzindo, o processo continua até concluir. O CLI registra o desvio
e conserva a mesma tentativa em vez de sacrificar a entrega para “bater meta”.
