// Blocos documentais extraídos da série, sem identidade de pessoa ou I/O.

export const LUGAR =
  "WHERE: an ordinary classroom after everyone has gone. Rows of empty chairs and desks behind him, far enough back to be " +
  "soft and unreadable. Late afternoon daylight comes from a tall window on one side and falls across his face; the rest of " +
  "the room sinks into quiet shadow. Muted colours, real dust in the air, nothing decorative, no posters or writing anywhere.";

export const insertDe = (destaque, lado = "right") => {
  const oposto = lado === "right" ? "left" : "right";
  return "ONE GRAPHIC INSERT IS DRAWN INSIDE THE PICTURE WHILE HE SPEAKS - it is part of the picture, drawn in the pixels " +
    "of the frame, never a subtitle and never a caption bar.\n" +
    `In the empty ${lado} third of the frame, well clear of his body, the words "${destaque}" are drawn straight into the ` +
    "air of the room in heavy condensed off-white capitals, stacked on short lines, with one thin warm-amber underline " +
    "beneath them. There is no panel, no box, no bar and no background behind them: the letters sit alone against the " +
    "out-of-focus classroom.\n" +
    "They snap into place word by word, EXACTLY as he says those same words in his sentence - not before, not after. They " +
    "hold perfectly still and fully legible for about two seconds. Then they leave in one clean move, sliding out through " +
    `the ${lado} edge of the frame, whole and still readable as they go - they never crumble, dissolve, glitch, flicker or ` +
    "break apart. Before they arrive and after they are gone, there is no writing anywhere in the picture.\n" +
    `He sits in the ${oposto} part of the frame and the insert never touches him: it must never cross his face, his mouth, ` +
    "his eyes or his body at any moment. Flat and crisp: no shadow, no bevel, no glow, no 3D, no perspective, no motion blur.";
};

export const IDENTIDADE_ARTE =
  "Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of deep desaturated grey-green - the colour of a " +
  "classroom wall with the lights switched off. Off-white heavy condensed letterforms and flat abstract marks. One single " +
  "accent colour: warm amber, the colour of late afternoon light through a window, used sparingly and never as a fill for " +
  "the whole frame. Generous margins, one clear idea per frame, nothing decorative.";

export const RENDER_ARTE =
  "RENDER CHECK for the direction above: draw it strictly as flat vector shapes and flat letterforms on the flat " +
  "grey-green field. It is a diagram in motion, never a physical object inside a room: no wall, no floor, no ground plane, " +
  "no desk, no chair, no window, no horizon, no set, no studio lighting, no shading, no drop shadow, no perspective, no " +
  "thickness, no volume, no extruded or 3D type, no camera move, no lens flare, no paper texture close-up, no photograph " +
  "and no person anywhere in the frame.";

export const ESTILOS = {
  "documentario-sobrio": {
    nome: "Documentário sóbrio",
    lugar: LUGAR,
    identidadeArte: IDENTIDADE_ARTE,
    campo: "grey-green",
    insert: insertDe,
  },

  suspensao: {
    nome: "Suspensão",
    lugar:
      "WHERE: an ordinary, unremarkable interior, lit by one strong directional source from a single side - a window, a " +
      "doorway, a lamp out of frame - so that one half of him is lit and the other falls away into shadow. Cool, " +
      "desaturated colour throughout, with warmth only where that light actually lands. Deep quiet, nothing moving in the " +
      "room, no other person, nothing decorative and nothing legible anywhere.",

    identidadeArte:
      "Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of deep slate blue - cold, still and airless. " +
      "Off-white heavy condensed letterforms and flat abstract marks. One single accent colour: warm amber, the colour of " +
      "the one light source in the room, used sparingly and never as a fill for the whole frame. Wide margins, a lot of " +
      "empty field around everything, one clear idea per frame, nothing decorative.",
    campo: "deep slate blue",
    insert: insertDe,
  },

  confessional: {
    nome: "Confessional noturno",
    /** A única entrada que escreve em caixa baixa: aqui a letra é sussurro, não manchete. */
    caixa: "baixa",
    lugar:
      "WHERE: an ordinary room at night, almost entirely dark. There is one light source only - a low, warm lamp placed to " +
      "one side and slightly below his eyeline, out of frame - and it reaches only part of him: one side of his face is lit " +
      "and the other falls into near-blackness. Whatever is behind him is indistinct and unreadable, swallowed by the dark. " +
      "No second light, no window, no haze, no glow in the air, no coloured gel, no lens flare, nothing decorative and " +
      "nothing legible anywhere.",

    identidadeArte:
      "Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of near-black blue - dark, quiet and intimate. " +
      "The lettering is a READING SERIF in lower case, set small, with generous space around it - the opposite of a " +
      "headline: it is closer to a line in a book than to a title. Flat abstract marks are sparse and thin. One single " +
      "accent colour: a low, warm amber, dim rather than bright, used on almost nothing. Very wide margins and a great " +
      "deal of empty dark field around everything.",
    campo: "near-black blue",

    insert: (destaque, lado = "right") => {
      const oposto = lado === "right" ? "left" : "right";
      return "ONE GRAPHIC INSERT IS DRAWN INSIDE THE PICTURE WHILE HE SPEAKS - it is part of the picture, drawn in the " +
        "pixels of the frame, never a subtitle and never a caption bar.\n" +
        `Low in the frame, in the dark ${lado} side and well clear of his body, the words "${destaque}" are drawn small, ` +
        "in a warm off-white reading serif, in lower case, on one or two short lines. There is no panel, no box, no bar, " +
        "no background and no underline: the letters sit alone in the darkness, dim and quiet.\n" +
        "They fade up slowly, over about a second, EXACTLY as he says those same words in his sentence - not before, not " +
        "after. They hold still and legible for about two seconds, and then fade out just as slowly, whole and unbroken " +
        "as they go - they never crumble, glitch, flicker, slide or break apart. Before they arrive and after they are " +
        "gone, there is no writing anywhere in the picture.\n" +
        `He is in the ${oposto} part of the frame and the insert never touches him: it must never cross his face, his ` +
        "mouth, his eyes or his body at any moment. Flat and soft-edged: no shadow, no bevel, no glow, no 3D, no " +
        "perspective, no motion blur.";
    },
  },

  plantao: {
    nome: "Plantão",
    lugar:
      "WHERE: a dark room with no readable depth behind him - the background falls away into near-black and shows no wall, " +
      "no window, no furniture and nothing anyone could recognise or read. It is not a set and not an office: it is simply " +
      "unlit space. One hard light comes from the side and cuts his face into a bright half and a shadowed half; a second " +
      "hard light rims the opposite edge of his head and shoulder, separating him from the dark. No haze, no smoke, no fog, " +
      "no glow, no light beams in the air, no coloured gel, no lens flare.",

    identidadeArte:
      "Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of near-black graphite. Pure white heavy condensed " +
      "letterforms, narrow, set in capitals. One single accent colour: a hard signal red, used only in small areas and only " +
      "on something that is moving - never as a fill for the whole frame and never behind the words. Tight margins, urgent " +
      "and stripped down, nothing decorative.",
    campo: "near-black graphite",

    /**
     * A faixa vermelha que abre e fecha: a única forma em que a barra colorida
     * ganha da tipografia solta. Já foi recusada uma vez pelo provedor com uma
     * fala que passou nas outras formas. Isso não isola a causa da recusa
     * nem autoriza fallback automático.
     */
    insert: (destaque, lado = "right") => {
      const oposto = lado === "right" ? "left" : "right";
      return "ONE GRAPHIC INSERT IS DRAWN INSIDE THE PICTURE WHILE HE SPEAKS - it is part of the picture, drawn in the " +
        "pixels of the frame, never a subtitle and never a caption bar.\n" +
        `In the empty ${lado} third of the frame, at chest height and well clear of his body, a flat signal-red horizontal ` +
        `band wipes open from its ${oposto} edge in one fast, clean, mechanical move, and the words "${destaque}" are ` +
        "drawn on it in pure white heavy condensed capitals, stacked on short lines.\n" +
        "The band opens EXACTLY as he says those same words in his sentence - not before, not after. It holds perfectly " +
        "still and fully legible for about two seconds. Then it wipes closed in the same direction it came from, taking " +
        "the words with it in one clean move - they never crumble, dissolve, glitch, flicker or break apart. Before it " +
        "arrives and after it is gone, there is no writing anywhere in the picture.\n" +
        `He sits in the ${oposto} part of the frame and the band never touches him: it must never cross his face, his ` +
        "mouth, his eyes or his body at any moment. Flat and crisp: no shadow, no bevel, no glow, no 3D, no perspective, " +
        "no motion blur.";
    },
  },
};

export const renderArteDe = (campo) => RENDER_ARTE.replace("the flat grey-green field", `the flat ${campo} field`);

export const estiloDe = (chave) => {
  const e = ESTILOS[chave ?? "documentario-sobrio"];
  if (!e) throw new Error(`estilo desconhecido: ${chave}. Disponíveis: ${Object.keys(ESTILOS).join(", ")}`);
  return e;
};

export const transicaoDe = ({ saida, entrada } = {}) => {
  const partes = [];
  if (entrada) {
    partes.push(
      "HOW THE SHOT BEGINS: the very first frame of this clip is already in motion - " + entrada +
      " The movement is continuous from frame one: it does not start from stillness, and there is no pause, no fade and no " +
      "settling before it. Once it completes, he holds that position and only then begins to speak.");
  }
  if (saida) {
    partes.push(
      "HOW THE SHOT ENDS: after he finishes speaking he holds still for about a second, and then, in the last stretch of the " +
      "clip, " + saida +
      " That movement is still happening when the clip ends - it is never completed, never settles, and there is no pause, " +
      "no fade and no return to the starting position before the last frame.");
  }
  return partes.join("\n\n");
};

// Composição pura compartilhada: os blocos de identidade permanecem no chamador.
export function documentaryCadence(value) {
  if (value === undefined) return null;
  if (!["incisiva", "conversada", "pausada"].includes(value)) throw new Error("cadencia deve ser incisiva|conversada|pausada.");
  return value;
}

export function documentarySpeechDirection({ blocks: P, scene: s }) {
  const original = P.falaDe(s.frase);
  const cadence = documentaryCadence(s.cadencia);
  if (!cadence) return original;
  const legacy = "He speaks slowly and deliberately, at the unhurried pace of someone who wants to be understood, not of someone reading.";
  if (!original.includes(legacy)) throw new Error("O bloco de fala mudou; revisar a substituição de cadência antes de gerar.");
  const directions = {
    incisiva: "He speaks with brisk, precise natural articulation and confident forward energy; each word remains fully intelligible, without rushing or swallowing syllables.",
    conversada: "He speaks at a natural medium conversational pace, warmly and directly, with clear articulation and small organic pauses.",
    pausada: "He speaks deliberately with calm, meaningful breathing spaces between ideas, without stretching syllables or losing conversational life.",
  };
  return original.replace(legacy, directions[cadence]);
}

export function documentaryInsertInteraction(scene) {
  if (scene.interacaoInsert === undefined) return null;
  const value = scene.interacaoInsert;
  const gestures = {
    apontar: "points once toward the complete insert with one relaxed index finger",
    apresentar: "presents the complete insert with one open palm",
    deslizar: "makes one short lateral hand sweep beside the insert to cue its entrance",
    pinçar: "makes one small pinch gesture beside the insert to cue its entrance",
    sublinhar: "traces one short horizontal line in the air below the complete insert",
  };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !["gesto", "lado", "texto", "ancoraFala"].includes(key)) ||
      !Object.hasOwn(gestures, value.gesto) || !["left", "right"].includes(value.lado)) {
    throw new Error("interacaoInsert exige gesto apontar|apresentar|deslizar|pinçar|sublinhar e lado left|right.");
  }
  if (scene.semInsert === true || typeof value.texto !== "string" || !value.texto.trim() ||
      value.texto !== scene.destaque || typeof value.ancoraFala !== "string" || !value.ancoraFala.trim()) {
    throw new Error("interacaoInsert exige insert ativo, texto igual ao destaque e ancoraFala não vazia.");
  }
  const spoken = String(scene.frase ?? "").toLocaleLowerCase("pt-BR");
  for (const key of ["texto", "ancoraFala"]) {
    if (!spoken.includes(value[key].toLocaleLowerCase("pt-BR"))) throw new Error(`interacaoInsert.${key} deve estar literalmente contido na frase, preservando acentos.`);
  }
  return { ...value, direction: `PRESENTER INTERACTION: exactly when he says "${value.ancoraFala}", he ${gestures[value.gesto]} in the empty ${value.lado} side. This is ONE small natural action, followed by a relaxed still hand. The insert enters with its corresponding spoken words and stays completely still for reading. His hand never obscures any letter; his face, eyes and mouth remain fully clear. He continues speaking naturally with uninterrupted lip synchronization. No repeated gestures or juggling of letters.` };
}

export function documentaryAudioMix(value) {
  const defaults = { musicGainDb: -7, directVoiceGainDb: 8, duckingThreshold: 0.06, duckingRatio: 8 };
  if (value === undefined) return defaults;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !Object.hasOwn(defaults, key))) throw new Error("audioMix aceita apenas musicGainDb, directVoiceGainDb, duckingThreshold e duckingRatio.");
  const mix = { ...defaults, ...value };
  const ranges = { musicGainDb: [-60, 12], directVoiceGainDb: [-20, 20], duckingThreshold: [0.001, 1], duckingRatio: [1, 20] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(mix[key]) || mix[key] < min || mix[key] > max) throw new Error(`audioMix.${key} deve ser numérico entre ${min} e ${max}.`);
  }
  return mix;
}

export function documentaryCleanArtStyle(globalStyle, blockStyle) {
  for (const style of [globalStyle, blockStyle]) {
    if (style === undefined) continue;
    if (!style || typeof style !== "object" || Array.isArray(style) ||
        Object.keys(style).some((key) => !["background", "foreground", "accent"].includes(key)) ||
        Object.values(style).some((value) => typeof value !== "string" || !/^#[\da-f]{6}$/iu.test(value))) {
      throw new Error("cleanArtStyle e arte.style aceitam apenas background, foreground e accent em #RRGGBB.");
    }
  }
  return { background: "#F5F7FA", foreground: "#10233F", accent: "#246BFD", ...globalStyle, ...blockStyle };
}

/** Provider-free validation of the optional directing fields, before any stage runs. */
export function validateDocumentaryDirection(episode) {
  estiloDe(episode.estilo);
  const audioMix = documentaryAudioMix(episode.audioMix);
  documentaryArtAudio(episode.audioArte);
  if (episode.promptArtVersion !== undefined && episode.promptArtVersion !== "clean-type@1") throw new Error("Versão de prompt de arte desconhecida.");
  if (!Array.isArray(episode.sonoras)) throw new Error("sonoras deve ser uma lista.");
  for (const scene of episode.sonoras) {
    estiloDe(scene.estilo ?? episode.estilo);
    documentaryCadence(scene.cadencia);
    documentaryInsertInteraction(scene);
  }
  for (const block of episode.off?.blocos ?? episode.respiros ?? []) {
    estiloDe(block.estilo ?? episode.estilo);
    const art = block.arte ?? {};
    if ((art.style !== undefined || art.direcao !== undefined) && episode.promptArtVersion !== "clean-type@1") throw new Error(`${block.cena}: arte.style e arte.direcao exigem promptArtVersion clean-type@1.`);
    if (episode.promptArtVersion === "clean-type@1") {
      documentaryCleanArtStyle(episode.cleanArtStyle, art.style);
      if (art.direcao !== undefined && (typeof art.direcao !== "string" || !art.direcao.trim() || art.direcao.length > 600)) throw new Error("arte.direcao deve ser uma string não vazia com até 600 caracteres.");
      if (art.movimento !== undefined && (typeof art.movimento !== "string" || art.movimento.length > 250)) throw new Error("clean-type@1 movimento deve ter até 250 caracteres.");
      const snippets = episode.off ? art.desenhar : art.frases?.map((phrase) => phrase.texto);
      if (!Array.isArray(snippets) || snippets.length < 1 || snippets.length > 3 || snippets.some((text) => typeof text !== "string" || !text.trim() || text.length > 48 || text.trim().split(/\s+/u).length > 5)) throw new Error(`${block.cena}: clean-type@1 exige uma a três frases curtas com até cinco palavras e 48 caracteres.`);
    }
  }
  return { audioMix };
}

export function documentaryInterviewPrompt({ blocks: P, scene: s, index: i, style: ESTILO, compositionVersion = 2 }) {
  if (![1, 2].includes(compositionVersion)) throw new Error("Versão de composição documental desconhecida.");
  if (s.semInsert !== undefined && typeof s.semInsert !== "boolean") throw new Error("semInsert deve ser booleano.");
  if (s.aberturaPrompt !== undefined && (typeof s.aberturaPrompt !== "string" || !s.aberturaPrompt.trim())) {
    throw new Error("aberturaPrompt deve ser uma string não vazia.");
  }
  const semInsert = s.semInsert === true;
  const interaction = documentaryInsertInteraction(s);
  const erros = semInsert
    ? P.erradoSonora(s.frase, "").split("\n").filter((line) => !line.includes("insert"))
      .map((line) => line.replace("any other writing", "any writing")).join("\n")
    : P.erradoSonora(s.frase, s.destaque);
  const render = semInsert
    ? P.RENDER_SONORA.replace("Only the graphic insert described above is drawn into the picture; everything else is photographed.", "Everything in the picture is photographed. There is no writing or graphic element.")
    : P.RENDER_SONORA;
  return [
      s.aberturaPrompt ?? ("A ten-second live-action interview shot for a television news report: one man, alone in an empty classroom, " +
      (semInsert ? "answering a question off camera. Documentary " : "answering a question off camera, with one graphic insert drawn into the picture while he talks. Documentary ") +
      "photography, nothing stylised."),
      P.HOMEM, P.FIGURINO, s.lugar ?? ESTILO.lugar, s.enquadramento, P.CAMERA,
      documentarySpeechDirection({ blocks: P, scene: s }),
      s.interpretacao,
      ...(compositionVersion === 1 ? [] : [P.transicaoDe(s.transicao)]),
      ...(semInsert ? ["The picture contains only the man and the room. No text, captions, labels or graphic elements appear at any time."] : [ESTILO.insert(s.destaque, interaction?.lado ?? (i % 2 === 0 ? "right" : "left")), P.travaInsert(s.destaque)]),
      ...(interaction ? [interaction.direction] : []),
      P.AUDIO_SONORA,
      erros,
      render,
    ].join("\n\n");
}

export function documentaryArtAudio(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.nativeSfx !== true ||
      !Number.isFinite(value.gainDb) || value.gainDb < -60 || value.gainDb > 0) {
    throw new Error("audioArte exige nativeSfx: true e gainDb numérico entre -60 e 0 dB.");
  }
  return { nativeSfx: true, gainDb: value.gainDb };
}

// clean-type keeps the measured speech onset while giving the eye time to read.
// This changes prompt windows only; the original word alignment stays untouched.
export function documentaryArtReadingWindows({ phrases, sceneDuration, promptArtVersion }) {
  if (promptArtVersion !== "clean-type@1") return phrases;
  if (!Array.isArray(phrases) || phrases.length < 1 || phrases.length > 3 ||
      !Number.isFinite(sceneDuration) || sceneDuration <= 0 || sceneDuration > 10.01) {
    throw new Error("clean-type@1 exige de uma a três frases dentro da duração da cena.");
  }
  let previousEnd = 0;
  return phrases.map((phrase, index) => {
    if (!Number.isFinite(phrase.inicio) || !Number.isFinite(phrase.fim) ||
        phrase.inicio < previousEnd || phrase.fim <= phrase.inicio || phrase.fim > sceneDuration) {
      throw new Error("clean-type@1 exige frases medidas em ordem e dentro da cena.");
    }
    previousEnd = phrase.fim;
    const end = index === phrases.length - 1 ? sceneDuration : +(phrases[index + 1].inicio - 0.08).toFixed(3);
    if (!Number.isFinite(end) || end <= phrase.inicio) {
      throw new Error("clean-type@1 exige espaço para a leitura antes da próxima frase.");
    }
    return { ...phrase, fim: end };
  });
}

export function documentaryArtPrompt({ blocks: P, block: b, phrases: frases, lines: linhas, style: ESTILO, audioArte, promptArtVersion, cleanArtStyle }) {
  if (promptArtVersion !== undefined && promptArtVersion !== "clean-type@1") throw new Error("Versão de prompt de arte desconhecida.");
  const audio = documentaryArtAudio(audioArte);
  if (audio && b.arte.soundDesign !== undefined && (typeof b.arte.soundDesign !== "string" || !b.arte.soundDesign.trim())) {
    throw new Error("soundDesign deve ser uma string não vazia.");
  }
  if (promptArtVersion === "clean-type@1") {
    const cores = documentaryCleanArtStyle(cleanArtStyle, b.arte.style);
    const direcao = b.arte.direcao;
    if (direcao !== undefined && (typeof direcao !== "string" || !direcao.trim() || direcao.length > 600)) throw new Error("arte.direcao deve ser uma string não vazia com até 600 caracteres.");
    if (!Array.isArray(frases) || frases.length < 1 || frases.length > 3) throw new Error("clean-type@1 exige de uma a três frases gráficas.");
    let fimAnterior = 0;
    for (const frase of frases) {
      if (typeof frase.texto !== "string" || !frase.texto.trim() || frase.texto.length > 48 || frase.texto.trim().split(/\s+/u).length > 5) throw new Error("clean-type@1 exige frases curtas com até cinco palavras e 48 caracteres.");
      if (!Number.isFinite(frase.inicio) || !Number.isFinite(frase.fim) || frase.inicio < fimAnterior || frase.fim <= frase.inicio || frase.fim > 10.01) throw new Error("clean-type@1 exige janelas ordenadas, sem sobreposição e dentro de dez segundos.");
      fimAnterior = frase.fim;
    }
    if (b.arte.movimento !== undefined && (typeof b.arte.movimento !== "string" || b.arte.movimento.length > 250)) throw new Error("clean-type@1 movimento deve ter até 250 caracteres.");
    const mmss = (seconds) => `00:${seconds.toFixed(2).padStart(5, "0")}s`;
    const janelas = frases.map((frase) => `- [${mmss(frase.inicio)} - ${mmss(frase.fim)}]: draw "${frase.texto}".`).join("\n");
    return [
      direcao
        ? `Ten-second 16:9 clean 2D graphic film. Background ${cores.background}, lettering ${cores.foreground}, accent ${cores.accent}. Large readable type and generous empty space. Art direction: ${direcao}`
        : `Ten-second 16:9 flat 2D typography film. Solid ${cores.background} background, bold ${cores.foreground} sans-serif letters, one thin ${cores.accent} underline. Large type, generous empty space, centered layout. Text is the entire visual content.`,
      direcao
        ? "Show one complete phrase at a time. Complete its directed entrance exactly at the window START, the spoken onset; if the start is zero, show it fully formed. Hold all letters still and fully readable until the window END. Replace the phrase whole in the gap; hold the last phrase to its END. Preserve spelling and accents. A few large graphic or paper forms may support the meaning without obscuring letters. No other writing, particles, scattered fragments, scenery or 3D."
        : "Show one complete phrase at a time. Finish its short horizontal entrance exactly at the window START, the spoken onset; if the start is zero, show it fully formed. Hold it still and fully readable until the window END. Replace it whole in the gap; hold the last phrase to its END. Preserve spelling and accents. No other writing, particles, fragments, scenery or 3D.",
      b.arte.movimento ?? "The underline makes one clean left-to-right move beneath each arriving phrase.",
      "Only the quoted Portuguese phrases below are visible graphics; all other instructions remain invisible. Reading windows:\n" + janelas,
      b.arte.holdFinalLine
        ? "Keep the last phrase fully visible and still through ten seconds, with no exit or disappearance. Keep the background still. End on a clean cut, with no fade."
        : "Keep the background still through ten seconds. End on a clean cut, with no fade.",
      "[CRITICAL AUDIO INSTRUCTION - ZERO SPOKEN WORDS, ZERO NARRATION, ZERO VOICES, ZERO SPEECH, ZERO TALKING, ZERO WHISPERING, ZERO VOCALS. ALL WORDS ARE SILENT 2D GRAPHIC ELEMENTS ON SCREEN. AUDIO TRACK MUST BE 100% PURE MOTION GRAPHICS SOUND DESIGN (SFX ONLY: Crisp UI clicks, loud dynamic whooshes, digital pops, heavy sub-bass impacts)].",
      "Use only one soft brief click at each text arrival; reading holds are quiet. No music.",
    ].join("\n\n");
  }
  const nativeSfx = audio ?
    "[CRITICAL AUDIO INSTRUCTION - ZERO SPOKEN WORDS, ZERO NARRATION, ZERO VOICES, ZERO SPEECH, ZERO TALKING, " +
    "ZERO WHISPERING, ZERO VOCALS. ALL WORDS ARE SILENT 2D GRAPHIC ELEMENTS ON SCREEN. AUDIO TRACK MUST BE 100% " +
    "PURE MOTION GRAPHICS SOUND DESIGN (SFX ONLY: Crisp UI clicks, loud dynamic whooshes, digital pops, heavy " +
    "sub-bass impacts)]. No music or melodic score. Audible tactile sound effects follow the visible graphic actions " +
    "exactly; no sound is a spoken reading of the lettering. " +
    (b.arte.soundDesign ?? "Use precise, brief sound effects synchronized with graphic arrivals, stops and transitions; keep the reading holds quiet.") : null;
  return [
        P.ANTIFALA,
        ESTILO.identidadeArte,
        `THE IDEA THIS FILM HAS TO MAKE VISIBLE: ${b.arte.tese} The viewer should be able to name that idea just from watching how things move.`,
        b.arte.movimento,
        "Draw exactly these lines at exactly these times, showing only the words listed and nothing more:\n" + linhas,
        P.REGRA_DE_JANELA,
        P.travaOrtografica(frases),
        P.RASTRO_ABSTRATO,
        P.renderArteDe(ESTILO.campo),
        P.DEZ_SEGUNDOS,
        b.arte.fecho + " After that last line is drawn, HOLD the final frame perfectly still until the end of the clip: no fade-out, no extra animation, no new element, nothing entering or leaving the frame.",
        nativeSfx ?? P.AUDIO_ARTE,
      ].join("\n\n");
}
