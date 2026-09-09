# Sincronia de Tipografia Cinética via React-Audiovisual (Marketing Premium)

Este documento registra a técnica avançada de sincronismo frame-a-frame de palavras (Kinetic Typography) utilizando os tempos exatos do Whisper e o modelo de renderização JSX do Gemini Omni.

## 1. O Problema da Legibilidade e Sobreposição

Quando o Omni recebe prompts muito longos para animação de textos sem âncoras geométricas estritas, ele tende a sobrepor as palavras, misturar as fontes e gerar um resultado caótico e ilegível.
Além disso, se a direção de arte literalizar palavras de mídia tradicionais (ex: "telejornal", "news broadcast"), isso pode acionar o filtro anti-Fake News do modelo (HTTP 500 / Input blocked).

## 2. A Solução: JSX Data-Binding com Filtro de Stop-words

A técnica definitiva consiste em três pilares:

### A. Extração Rigorosa dos Tempos (Whisper)
A trilha original deve passar por um alinhamento a nível de palavra (Whisper Word-Level). Os timestamps absolutos (ex: `0.44s` a `0.78s`) devem ser convertidos em timestamps relativos (`start` e `end`) correspondentes ao clipe em questão (ex: blocos de 10 segundos).

### B. Omissão Estratégica (Menos é Mais)
Para garantir uma composição de "Marketing Premium" limpa:
- Filtre e omita pronomes, preposições e artigos (o, a, de, para, com, etc.).
- Envie para o JSX apenas os "substantivos de impacto", verbos ou números, junto ao seu exato `start`.
- Isso garante que a tela nunca fique sobrecarregada, e as palavras pulam dinamicamente.

### C. Estrutura Segura do Prompt JSX

Em vez de narrativas descritivas longas de telejornal, direcione o gerador estritamente aos *motion principles* num componente React. Exemplo validado:

```jsx
/**
 * OMNI_STUDIO_RENDER_INSTRUCTION
 * Render as one 10-second 16:9 modern React motion video.
 * Theme: Premium tech marketing advertisement. Clean, bright composition.
 * Background: Smooth, glowing gradients, high-end glossy aesthetic, negative space.
 * Kinetic Typography Layout: Dynamic pop-in scaling. Words must appear individually and isolated, glowing in the center of the screen, ensuring a very clean frame.
 * Typography: Bold, modern, metallic or glossy finish.
 * Animation: Impactful pop-in exactly at the timestamp, smooth easing, slight floating motion.
 * No music, subtitles, extra speech or automatic fade-out.
 */
const audio = {
  // Envie a frase completa apenas para contexto de coesão do modelo
  narration: { text: "O modelo GPT 5.6 alcançou um ganho de eficiência superior a 15%." },
  // Array de palavras já filtrado (sem 'o', 'um', 'de', 'a') e com tempos relativos
  wordTimings: [
    { "word": "modelo", "start": 0.44, "end": 0.78 },
    { "word": "GPT", "start": 0.78, "end": 1.38 },
    { "word": "5.6", "start": 1.38, "end": 2.42 },
    { "word": "alcançou", "start": 2.42, "end": 2.78 },
    { "word": "ganho", "start": 3.74, "end": 3.92 },
    { "word": "eficiência", "start": 4.24, "end": 4.60 },
    { "word": "superior", "start": 4.60, "end": 4.94 },
    { "word": "15%", "start": 4.94, "end": 5.44 }
  ]
};

export default function Scene() {
  // Only key impact words are provided in audio.wordTimings.
  // Each word should pop in EXACTLY at its 'start' with a dynamic scale effect, glowing in the center.
  // Keep the composition ultra-clean, minimal text on screen at once.
  return <KineticTypography sync={audio.wordTimings} layout="dynamic-pop" effect="marketing-glow" />;
}
```

## 3. Considerações do Pipeline (Concatenate & Mux)

Após gerar o batch via `--research-profile react-audiovisual@1`:
1. Use FFmpeg com recoding rigoroso (`-c:v libx264 -preset fast -pix_fmt yuv420p`) e não apenas `-c:v copy`.
2. A junção pura de segmentos gerados independentemente pelo motor Web/Canvas costuma criar micro-incompatibilidades no container MP4 que quebram o tempo nos players de navegador ou dão "Preview unavailable".
3. Misture o áudio (wav) diretamente durante o concat de vídeo para consolidar a precisão lip-sync final.
