/**
 * Construtor Canônico de Prompts Flat Motion com Supressão Vocal Absoluta e Timestamps Whisper.
 * Segue estritamente a Regra de Ouro v2 (Flat Motion Graphics Pro).
 */

export const STRICT_ZERO_VOCALS_AUDIO_PROMPT = `
[CRITICAL AUDIO INSTRUCTION - ZERO SPOKEN WORDS]:
- ABSOLUTELY NO NARRATION, NO SPOKEN WORDS, NO VOICES, NO SPEECH, NO TALKING, NO WHISPERING, NO SINGING, NO VOCALS.
- THE TEXT LISTED BELOW REPRESENTS SILENT 2D VECTOR GRAPHIC SHAPES ON SCREEN ONLY. DO NOT READ OR SPEAK ANY OF THE WORDS OUT LOUD.
- AUDIO TRACK MUST BE 100% PURE MOTION GRAPHICS SOUND DESIGN (SFX ONLY):
  * Crisp tactile UI clicks, digital mechanical pops, and sharp snaps on each word reveal.
  * Fast high-velocity whooshes on dynamic camera cuts and graphic shape wipes.
  * Impactful cinematic sub-bass drops and electronic risers synchronized with kinetic highlights.
  * ZERO HUMAN VOICE OR VOCAL TRACKS.
`.trim();

/**
 * Formata os timestamps do Whisper para rotulagem semântica puramente visual (anti-vocalização).
 */
export function formatVisualGraphicTimeline(words) {
  const lines = words.map(w => `  - T:${w.start.toFixed(1)}s-${w.end.toFixed(1)}s -> 2D Kinetic Text Graphic: [${w.text.toUpperCase()}]`);
  return `[ON-SCREEN 2D GRAPHIC TEXT TIMELINE - DO NOT SPEAK, VISUAL GRAPHIC ASSET ONLY]:\n${lines.join("\n")}`;
}

/**
 * Constrói o prompt final completo com estilo visual, timeline e supressão estrita.
 */
export function buildMotionScenePrompt({ styleSpec, visualAction, words, colorPalette, animationType }) {
  const graphicTimeline = formatVisualGraphicTimeline(words);

  return `
[VISUAL STYLE & ART DIRECTION - 100% FLAT 2D MOTION GRAPHICS]:
- Category: High-End Kinetic Typography & 2D Motion Design Pro.
- Palette: ${colorPalette}.
- Animation: ${animationType}.
- Action: ${visualAction}
- Framing: Clean, structured 16:9 widescreen composition, zero camera blur, razor-sharp vector shapes, crisp flat backgrounds. NO 3D rendering, NO photorealistic live action, NO generic glassmorphism.

${graphicTimeline}

${STRICT_ZERO_VOCALS_AUDIO_PROMPT}
`.trim();
}
