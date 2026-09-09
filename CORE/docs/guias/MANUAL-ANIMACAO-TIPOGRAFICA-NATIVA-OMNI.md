# MANUAL TÉCNICO: Animação Tipográfica Nativa Nível Omni (Pure Gemini Omni + Master 1X & 3X)

Este manual documenta o método oficial completo para gerar **animações tipográficas e textos gráficos 2D desenhados nativamente pelo Gemini Omni**, com compilação automática dos vídeos unificados nas versões **1X (Velocidade Normal)** e **3X (Versão Dinâmica Acelerada)**.

---

## 💡 Filosofia e Princípio Operacional

> **"O segredo do sucesso é entender o Gemini Omni como o renderizador nativo de pixels do vídeo, sem overlays externos."**

Toda a tipografia 2D cartoon, rotações, escalas elásticas e transições de cena são desenhadas e animadas pelo Gemini Omni diretamente na matriz de pixels do vídeo.

---

## 🔄 O Fluxo Completo de 5 Passos (Pipeline Canônico)

```
[ 1. Áudio da Fala ] ➔ [ 2. Timestamps por Palavra ] ➔ [ 3. Re-submissão Gemini Omni ] ➔ [ 4. Master 1X ] ➔ [ 5. Render 3X ]
```

### Passo 1: Geração de Narração & Extração do Áudio
* Gerar o áudio do locutor em formato `.wav` (`48kHz, 16-bit, PCM`).

### Passo 2: Mapeamento de Timestamps por Palavra
* Mapear o início e fim exatos (`start` e `end` em segundos/ms) de cada palavra pronunciada pelo locutor.
* Artefato gerado: `cronograma-preciso-palavras.json`.

### Passo 3: Re-submissão Orientada por Tempo ao Gemini Omni
* Re-submeter o pedido ao Gemini Omni injetando o cronograma de tempo no prompt:
  ```text
  RENDERIZAÇÃO NATIVA DE TEXTO ANIMADO DESENHADO PELO OMNI NO VÍDEO (SEM OVERLAY):
  - [00:00.800s - 00:01.200s]: Desenhe no centro em letras amarelas 2D 'O'.
  - [00:01.200s - 00:02.600s]: Faça a palavra 'PRIMEIRO PASSO' explodir com brilho azul em letras gigantes inclinadas em 6 graus...
  ```

### Passo 4: Montagem do Vídeo Master Unificado 1X (Velocidade Normal)
* Concatenação dos N vídeos gerados nativamente pelo Omni via stream-copy FFmpeg.
* Mixagem da trilha sonora de fundo (`volume=0.08` sob a voz).
* Comando:
  ```bash
  ffmpeg -f concat -safe 0 -i concat_list.txt -c copy bruto.mp4
  ffmpeg -y -i bruto.mp4 -i trilha-200s.wav -filter_complex "[1:a]volume=0.08[bg];[0:a][bg]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k colecao-unificado-master.mp4
  ```

### Passo 5: Geração da Versão Acelerada 3X (Versão Dinâmica Feed/Reels)
* Aplicação dos filtros de tempo e áudio para criar a versão 3X mais rápida:
* Comando FFmpeg 3X:
  ```bash
  ffmpeg -y -i colecao-unificado-master.mp4 -filter_complex "[0:v]setpts=PTS/3.0[v];[0:a]atempo=2.0,atempo=1.5[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset fast -c:a aac -b:a 192k colecao-3X-acelerado.mp4
  ```

---

## 🔒 Diretrizes e Trava de Qualidade

1. **Zero Overlay**: Não aplicar legendas externas ASS ou texto FFmpeg na pós-produção.
2. **Sincronia Nativa**: A tipografia é desenhada em vídeo pelo Omni acompanhando o cronograma real da voz.
3. **Dupla Entrega Master**: Todo projeto unificado gera automaticamente a versão **1X (Master Normal)** e a versão **3X (Master Acelerado)**.
4. **Formato Vertical Social**: Proporção 9:16 com Safe Area de 15% nas laterais e Zero Hífens.
