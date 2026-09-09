# Guia Canônico de Produção Studio: Marketing Flat Motion 2D (60s)

Este documento define a especificação operacional completa e o pipeline canônico para a criação de campanhas audiovisuais de marketing em **Flat Motion Design 2D** com alinhamento milimétrico de voz por **Whisper ASR** e trilhas sonoras dedicadas do **Flow Music**.

---

## 📁 1. Arquitetura da Coleção de Saída (`outputs/<colecao>/`)

Conforme a política governada em `AGENTS.md`, toda entrega deve ser organizada em uma coleção dedicada:

```text
CORE/outputs/<colecao>/
  ├── videos-soltos/           # MP4s e recibos individuais das partes visuais e narrações
  ├── receitas/                # Recibos completos e recibo de montagem final da coleção
  ├── videos-unidos/           # MP4s finais de 60s com H.264 seguro
  ├── metadados/               # Roteiros (videos-config.json), listas de concat e inventário
  ├── trilhas/                 # WAVs masters de 60s do Flow Music (backend cookie-only)
  ├── narracoes/               # Narrações brutas geradas pelo Omni
  └── whisper-alignments/      # Transcrições ASR com timestamps milimétricos por palavra
```

---

## 🎙️ 2. Controle Fonético de Marcas em TTS / Omni

Quando a marca possuir pronúncia em outro idioma ou grafia suscetível a erros fonéticos em português:

1. **Instrução Fonética Estrita:** O prompt de narração deve incluir a diretiva de pronúncia internacional ou aberta.
   ```js
   CRITICAL PRONUNCIATION DIRECTIVE: The brand name is "<MARCA>". You MUST pronounce it strictly as "<pronúncia alvo, sílaba por sílaba>", NEVER as "<pronúncia errada que o modelo tende a produzir>".
   ```
2. **Preservação de Direitos:** Nunca alterar a grafia visual do roteiro no texto exibido na tela. A instrução fonética afeta apenas a síntese vocal.

---

## ⚡ 3. Sincronização Milimétrica via Whisper (Word-Level ASR)

Para garantir que a palavra salte na tela no exato instante em que o locutor a pronuncia:

1. **Extração PCM WAV:** Extrair o áudio de narração gerado em 16kHz mono.
2. **Transcrição Word Timestamps:**
   ```bash
   python align_audio_whisper.py
   ```
3. **Data-Binding em React/JSX:** Passar o array `audio.wordTimings` filtrando *stop-words* (artigos/preposições), de modo que apenas palavras de impacto sejam animadas no tempo exato (`"start": 1.44, "end": 1.82`).

---

## 🎨 4. Diretrizes Estéticas: Flat Motion Design 2D

Para campanhas modernas, limpas e de alto padrão corporativo (estilo Apple Keynote / Design Editorial Suíço):

- **Fundo:** Sólidos de alto contraste, em dois tons da própria marca.
- **Tipografia:** Sans-serif geométrica limpa (Inter, Outfit, Helvetica), alta legibilidade e espaço negativo abundante.
- **Movimento:** Entradas secas e fluidas de escala 2D e deslize horizontal/vertical (0% a 100%).
- **Proibições:** Sem efeitos 3D pesados, sem iluminação neon excessiva, sem poluição de partículas.

---

## 🎼 5. Trilhas Sonoras de 60 Segundos (Flow Music)

- Toda produção de 1 minuto deve utilizar `--duration 60` no backend Flow Music para cobrir a timeline de ponta a ponta:
  ```bash
  npm run video -- music --mode studio --backend flow-music --prompt "<estilo-inspiracional>" --duration 60 --out "outputs/<colecao>/trilhas/trilha-01.wav"
  ```
- **Mixagem Master:** Narração com ganho `1.2` e trilha com ganho `0.30` (amix `duration=first`).

---

## 🎞️ 6. Estrutura de Timeline de 60 Segundos Cravados

Cada peça final é montada em 6 blocos perfeitos de 10 segundos:
- **Blocos 1 a 5 (50s):** 5 cenas visuais Flat Motion 2D alinhadas às 5 narrações.
- **Bloco 6 (10s):** Vinheta de fecho com a logo oficial da marca e assinatura institucional.
- **Exportação H.264:** Encode universal `-c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac` para garantir autoplay unmuted em qualquer navegador.

---

Este guia é a referência técnica permanente do Studio para futuras produções de marketing.
