export const FLOW_MUSIC_GENERATION_MODELS = Object.freeze({
  "lyria-3.5": Object.freeze({
    id: "lyria-3.5",
    label: "Lyria 3.5",
    status: "current",
  }),
  "lyria-3-pro": Object.freeze({
    id: "lyria-3-pro",
    label: "Lyria 3 Pro",
    status: "legacy",
  }),
});

export const DEFAULT_FLOW_MUSIC_GENERATION_MODEL = "lyria-3.5";

export function resolveFlowMusicGenerationModel(value = DEFAULT_FLOW_MUSIC_GENERATION_MODEL) {
  const normalized = String(value ?? DEFAULT_FLOW_MUSIC_GENERATION_MODEL).trim().toLowerCase();
  const aliases = {
    "3.5": "lyria-3.5",
    "lyria3.5": "lyria-3.5",
    "lyria 3.5": "lyria-3.5",
    "lyria-3.5": "lyria-3.5",
    "lyria 3 pro": "lyria-3-pro",
    "lyria3pro": "lyria-3-pro",
    "lyria-3-pro": "lyria-3-pro",
  };
  const id = aliases[normalized] ?? normalized;
  const selected = FLOW_MUSIC_GENERATION_MODELS[id];
  if (!selected) {
    throw new Error(`Modelo Flow Music desconhecido: ${value}. Use ${Object.keys(FLOW_MUSIC_GENERATION_MODELS).join(", ")}.`);
  }
  return selected;
}

export const MUSIC_BACKENDS = Object.freeze({
  "flow-music": Object.freeze({
    model: "flow-music-web",
    defaultGenerationModel: DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
    output: "wav + provider original",
    duration: "5-120s requested",
    operational: true,
    playwrightOperational: true,
  }),
});

export const FLOW_MUSIC_TAG_TAXONOMY = Object.freeze({
  schema: "mkt-videos/flow-music-tag-taxonomy@1",
  version: 1,
  structures: Object.freeze([
    "[Format: 15-second commercial cue, clean stinger finish, instrumental only]",
    "[Format: 30-second short commercial cue, clean button finish, instrumental only]",
    "[Format: 45-second commercial radio cue, resolving final chord, instrumental only]",
    "[Format: 60-second cinematic cue, grand finale resolve, instrumental only]",
    "[Format: 90-second documentary underscore, natural acoustic tail, instrumental only]",
    "[Intro: Soft acoustic build]",
    "[Build-up: Rising strings and swelling percussion]",
    "[Climax: Full brass and heavy punch]",
    "[Breakdown: Minimalist piano, clean space for narration]",
    "[Outro: Stinger hit, clean cut button ending]",
  ]),
  genres: Object.freeze({
    corporate: Object.freeze([
      "Modern Corporate Underscore",
      "Tech Keynote Ambient",
      "Executive Pulse",
      "Clean Broadcast Pop",
      "Minimalist Neo-Classical",
    ]),
    cinematic: Object.freeze([
      "Hollywood Trailer Hybrid Orchestral",
      "Nordic Noir Dark Ambient",
      "Hans Zimmer Ostinato Strings",
      "Cinematic Brass Swell",
      "Epic Orchestral Crescendo",
    ]),
    urban: Object.freeze([
      "90s Boom Bap Vinyl Crackle",
      "Melodic Lofi Hip-Hop",
      "Modern Trap Crisp 808",
      "UK Garage Syncopated Beat",
      "Chillhop Instrumental Groove",
    ]),
    electronic: Object.freeze([
      "Retro Cyber Synthwave 80s",
      "Melodic Techno Driving Bass",
      "Ambient Glitch IDM",
      "Future Bass Uplifting",
      "Dark Cyberpunk Pulse",
    ]),
    organic: Object.freeze([
      "Fingerpicked Acoustic Guitar",
      "Warm Rhodes Jazz Trio",
      "Bossa Nova Lounge Groove",
      "Solo Cello & Felt Piano",
      "Uplifting Indie Folk",
    ]),
  }),
  moods: Object.freeze([
    "inspiring",
    "confident",
    "warm",
    "tense",
    "epic",
    "uplifting",
    "mysterious",
    "relaxing",
    "energetic",
    "dark",
    "euphoric",
    "melancholic",
    "prestigious",
    "authoritative",
  ]),
  bpms: Object.freeze([75, 80, 85, 90, 100, 110, 115, 118, 120, 124, 128, 130, 140, 160]),
  keys: Object.freeze([
    "C major",
    "D major",
    "G major",
    "A major",
    "A minor",
    "D minor",
    "E minor",
    "F# minor",
    "B minor",
  ]),
  mixAndMastering: Object.freeze([
    "tape saturation",
    "analog warmth",
    "wide stereo field",
    "glossy broadcast master",
    "punchy low-end",
    "crisp airy highs",
    "dry close-mic",
    "studio room reverb",
    "tight transients",
  ]),
  negativeSafeguard: "[NEGATIVE AUDIO PROMPT: ABSOLUTELY NO VOCALS, NO SINGING, NO CHOIR, NO SPEECH, NO AUTO-TUNE, NO LOW QUALITY, NO MUFFLED SOUND, NO BITCRUSH, NO DISTORTION, NO ARTIFACTS, NO MONO, NO PHASING ISSUES, LOSSLESS HIGH FIDELITY ONLY]",
});

export const FLOW_AUDIO_ENHANCEMENT_PROFILES = Object.freeze({
  "transparent": Object.freeze({
    id: "transparent",
    description: "Decodificação 100% pura, transparente e bit-perfect: sem filtros de fase, sem equalização artificial e sem compressão extra.",
    filter: null,
  }),
  "warm-tape": Object.freeze({
    id: "warm-tape",
    description: "Suavização analógica: atenuação sutil de asperezas acima de 16kHz para um som mais aveludado.",
    filter: "lowpass=f=16000",
  }),
  "broadcast-master": Object.freeze({
    id: "broadcast-master",
    description: "Decodificação transparente recomendada para estúdio.",
    filter: null,
  }),
});

export function resolveAudioEnhancementFilter(profile = "transparent") {
  if (!profile || profile === "transparent" || profile === "none" || profile === "pure" || profile === "broadcast-master") return null;
  const key = String(profile).trim().toLowerCase();
  const selected = FLOW_AUDIO_ENHANCEMENT_PROFILES[key];
  if (!selected) {
    throw new Error(`Perfil de áudio desconhecido: ${profile}. Use ${Object.keys(FLOW_AUDIO_ENHANCEMENT_PROFILES).join(", ")}.`);
  }
  return selected.filter;
}

export const MUSIC_PRESETS = Object.freeze({
  institucional: "Instrumental institutional soundtrack, confident and polished, warm piano, restrained strings, subtle modern pulse, pristine 24-bit studio master, wide stereo, no vocals, clear space for narration.",
  tenso: "Instrumental tension bed, sparse low strings, controlled pulses, restrained percussion, dark but elegant, deep clean bass, wide stereo, no vocals, clear space for narration.",
  epico: "Instrumental cinematic build, broad strings, deep percussion, confident brass accents, gradual crescendo, Abbey Road mastering, wide dynamic range, no vocals, clear space for narration.",
  caloroso: "Warm instrumental bed, acoustic textures, gentle piano, soft strings, optimistic and human, warm analog tape saturation, no vocals, clear space for narration.",
  "varejo-impacto": "[Format: 45-second commercial cue] High-impact modern electronic commercial beat, 124 BPM, punchy drums, driving bass synth, explosive build-up, definitive clean button ending, glossy broadcast master, wide stereo, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "tech-futurista": "[Format: 45-second keynote cue] Cyber synthwave, futuristic electronic arpeggios, 120 BPM, F# minor, crisp tech drums, innovation background, tape saturation, pristine high frequencies, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "podcast-lofi": "[Format: 60-second podcast underscore] Chill lo-fi jazz hop, warm relaxing atmosphere, 82 BPM, vintage Rhodes piano, upright bass, brushed drums, vinyl warmth, analog tape mastering, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "cinematico-nolan": "[Format: 60-second cinematic cue] Hollywood hybrid orchestral, Hans Zimmer ostinato strings, 130 BPM, D minor, deep brass braam, heavy taiko drums, rising crescendo, colossal stereo field, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "boom-bap-90s": "[Format: 60-second rap battle cue] 90s Boom Bap hip hop, 90 BPM, gritty vinyl warmth, heavy punchy kick drum, snappy snare, upright bass groove, scratch cues, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "educacao-prestigio": "[Format: 45-second institutional cue] Prestigious academic acoustic piano and warm cello, 100 BPM, D major, emotional strings, cinematic crescendo, glossy broadcast master, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "saude-humana": "[Format: 45-second medical cue] Gentle warm acoustic guitar and felt piano, 85 BPM, C major, heartwarming peaceful strings, tender atmosphere, crystal clear acoustic fidelity, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "direito-autoridade": "[Format: 45-second legal thriller cue] Solemn cinematic strings, 110 BPM, D minor, steady rhythmic pulse, dark brass, authoritative finish, wide dynamic range, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "transicao-motivacional": "[Format: 45-second uplifting cue] Inspiring modern indie pop, soaring acoustic guitar and drums, 115 BPM, G major, motivational swell, sparkling broadcast air, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
  "varejo-groove": "[Format: 45-second retail cue] Modern corporate funk groove, bright electric guitar, clean punchy bass, 112 BPM, optimistic commercial vibe, punchy low-end, [NEGATIVE AUDIO PROMPT: NO VOCALS, NO LOW QUALITY, INSTRUMENTAL ONLY]",
});

export function buildSmartFlowPrompt({
  format = null,
  durationSeconds = 45,
  genre = null,
  mood = null,
  bpm = null,
  key = null,
  instruments = [],
  mix = [],
  prompt = null,
  fidelity = true,
  negative = true,
} = {}) {
  const parts = [];

  const formatTag = format ?? `[Format: ${durationSeconds}-second commercial cue, resolving finish, instrumental only]`;
  parts.push(formatTag);

  if (genre) parts.push(genre);
  if (mood) parts.push(`${mood} atmosphere`);
  if (bpm) parts.push(`${bpm} BPM`);
  if (key) parts.push(key);

  const instList = Array.isArray(instruments) ? instruments : [instruments].filter(Boolean);
  if (instList.length > 0) parts.push(instList.join(", "));

  const mixList = Array.isArray(mix) ? mix : [mix].filter(Boolean);
  if (mixList.length > 0) parts.push(mixList.join(", "));

  if (fidelity) {
    parts.push("pristine 24-bit 48kHz studio master, Abbey Road mastering, wide stereo field, crystal clear highs, punchy defined bass");
  }

  if (prompt && String(prompt).trim()) {
    parts.push(String(prompt).trim());
  }

  if (negative) {
    parts.push(FLOW_MUSIC_TAG_TAXONOMY.negativeSafeguard);
  }

  return parts.join(", ");
}

export function resolveMusicPrompt({
  prompt,
  preset = null,
  genre = null,
  mood = null,
  bpm = null,
  key = null,
  instruments = null,
  mix = null,
  duration = null,
} = {}) {
  const literal = String(prompt ?? "").trim();
  const presetText = preset == null ? null : MUSIC_PRESETS[String(preset)];

  if (preset != null && !presetText) {
    throw new Error(`Preset musical desconhecido: ${preset}. Use ${Object.keys(MUSIC_PRESETS).join(", ")}.`);
  }

  let smartPrompt = null;
  if (genre || mood || bpm || key || instruments || mix) {
    smartPrompt = buildSmartFlowPrompt({
      durationSeconds: duration ?? 45,
      genre,
      mood,
      bpm,
      key,
      instruments: instruments ? String(instruments).split(",").map((s) => s.trim()) : [],
      mix: mix ? String(mix).split(",").map((s) => s.trim()) : [],
      prompt: literal || null,
    });
  }

  const effectivePrompt = smartPrompt ?? [presetText, literal].filter(Boolean).join("\n\nUser music direction, preserved literally:\n");

  if (!effectivePrompt) {
    throw new Error("Prompt, preset ou atributos musicais (--genre, --mood, --bpm) são obrigatórios.");
  }

  return {
    userPrompt: literal || null,
    preset: preset ? String(preset) : null,
    smartPrompt: smartPrompt || null,
    effectivePrompt,
  };
}
