// exportando mapas e tabelas constantes congeladas
export const ENERGIAS_VALIDAS = Object.freeze(["LOW", "RISING", "CLIMAX"]);
export const SFX_VALIDOS = Object.freeze(["BOOM", "WHOOSH", "GLITCH", "GLASS"]);

export const PERFIS_MUSICA = Object.freeze({
  CLIMAX: {
    prompt: "Aggressive phonk, heavy distorted bass drops, intense cowbell rhythm, fast 140 BPM, cinematic action trailer style, no melody, pure tension.",
    targetBpm: 140,
    style: "phonk"
  },
  RISING: {
    prompt: "Cyberpunk synthwave, driving analog arpeggios, steady rising tension, 120 BPM, heavy kick drum, dark futuristic atmosphere.",
    targetBpm: 120,
    style: "synthwave"
  },
  LOW: {
    prompt: "Dark cinematic ambient, slow deep sub-bass pulses, eerie atmospheric drones, sparse percussion, tension building, 90 BPM.",
    targetBpm: 90,
    style: "dark-ambient"
  }
});

export function parseSemanticScript(scriptRaw) {
  const segments = [];
  let currentSegment = null;
  const words = [];
  const energyTags = [];
  let sfxCount = 0;
  
  // Regex para encontrar tags ENERGY ou SFX, permitindo variação nos espaços
  const tagRegex = /\[(ENERGY|SFX):\s*([A-Z]+)\]/gi;
  
  let match;
  let lastIndex = 0;
  const parts = [];
  
  // Quebra a string extraindo as tags e os textos entre elas
  while ((match = tagRegex.exec(scriptRaw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: scriptRaw.substring(lastIndex, match.index) });
    }
    parts.push({ type: match[1].toUpperCase(), value: match[2].toUpperCase() });
    lastIndex = tagRegex.lastIndex;
  }
  if (lastIndex < scriptRaw.length) {
    parts.push({ type: 'text', value: scriptRaw.substring(lastIndex) });
  }

  // Processa as partes extraídas sequencialmente
  for (const part of parts) {
    if (part.type === 'ENERGY') {
      const energyLevel = part.value;
      if (!ENERGIAS_VALIDAS.includes(energyLevel)) {
         throw new Error(`Nível de energia inválido: ${energyLevel}`);
      }
      if (currentSegment) {
         segments.push(currentSegment);
      }
      currentSegment = {
        text: "",
        energy: energyLevel,
        sfxTriggers: []
      };
      energyTags.push(energyLevel);
    } else if (part.type === 'SFX') {
      const sfxType = part.value;
      if (!SFX_VALIDOS.includes(sfxType)) {
         throw new Error(`Tipo de SFX inválido: ${sfxType}`);
      }
      if (words.length === 0) {
        throw new Error("Tag de SFX encontrada antes de qualquer palavra.");
      }
      
      // O SFX aplica-se à palavra imediatamente anterior
      const lastWord = words[words.length - 1];
      
      if (!currentSegment) {
         // Fallback se uma tag SFX ocorrer antes de qualquer tag ENERGY
         currentSegment = { text: "", energy: "LOW", sfxTriggers: [] };
      }
      
      currentSegment.sfxTriggers.push({
         word: lastWord,
         type: sfxType,
         wordIndex: words.length - 1
      });
      sfxCount++;
    } else if (part.type === 'text') {
      if (!currentSegment) {
         currentSegment = { text: "", energy: "LOW", sfxTriggers: [] };
      }
      currentSegment.text += part.value;
      
      // Encontra e acumula palavras desta parte textual
      const textWords = part.value.match(/\S+/g) || [];
      words.push(...textWords);
    }
  }
  
  if (currentSegment) {
    segments.push(currentSegment);
  }
  
  // Limpa espaços duplicados e excessivos dos segmentos e cria o cleanText final
  for (const seg of segments) {
    seg.text = seg.text.replace(/\s+/g, ' ').trim();
  }
  
  const cleanText = segments.map(s => s.text).join(' ').trim();
  
  return {
    cleanText,
    segments,
    words,
    wordCount: words.length,
    sfxCount,
    energyTags
  };
}

export function analyzeEnergyDistribution(segments) {
  let totalWords = 0;
  const wordsByEnergy = { LOW: 0, RISING: 0, CLIMAX: 0 };
  
  // Conta palavras por nível de energia
  for (const seg of segments) {
    const wordCount = (seg.text.match(/\S+/g) || []).length;
    wordsByEnergy[seg.energy] = (wordsByEnergy[seg.energy] || 0) + wordCount;
    totalWords += wordCount;
  }
  
  const distribution = {};
  if (totalWords > 0) {
     distribution.LOW = wordsByEnergy.LOW / totalWords;
     distribution.RISING = wordsByEnergy.RISING / totalWords;
     distribution.CLIMAX = wordsByEnergy.CLIMAX / totalWords;
  } else {
     distribution.LOW = 0;
     distribution.RISING = 0;
     distribution.CLIMAX = 0;
  }
  
  let dominantEnergy = "LOW";
  let maxWords = -1;
  for (const energy of ENERGIAS_VALIDAS) {
    if (wordsByEnergy[energy] > maxWords) {
      maxWords = wordsByEnergy[energy];
      dominantEnergy = energy;
    }
  }
  
  return {
    distribution,
    dominantEnergy,
    wordsByEnergy,
    totalWords
  };
}

export function selectMusicPrompt(distributionResult) {
  const profile = PERFIS_MUSICA[distributionResult.dominantEnergy];
  if (!profile) {
     throw new Error(`Perfil de música não encontrado para a energia dominante: ${distributionResult.dominantEnergy}`);
  }
  // Retorna uma cópia defensiva
  return structuredClone(profile);
}

export function generateMusicBrief(scriptRaw, { targetDurationMs = 60000 } = {}) {
  const parsed = parseSemanticScript(scriptRaw);
  const analysis = analyzeEnergyDistribution(parsed.segments);
  const musicProfile = selectMusicPrompt(analysis);
  
  return {
    schema: "mkt-videos/music-brief@1",
    distribution: analysis.distribution,
    dominantEnergy: analysis.dominantEnergy,
    selectedPrompt: musicProfile.prompt,
    targetBpm: musicProfile.targetBpm,
    targetDurationMs,
    style: musicProfile.style
  };
}

export function validateSemanticScript(scriptRaw, { minWords = 130, maxWords = 150, minSfx = 4, maxSfx = 6 } = {}) {
  const errors = [];
  const warnings = [];
  let parsed;
  
  try {
    parsed = parseSemanticScript(scriptRaw);
  } catch (err) {
    errors.push(err.message);
    return {
      valid: false,
      errors,
      warnings,
      parsed: null
    };
  }
  
  if (parsed.energyTags.length === 0) {
    errors.push("Pelo menos uma tag [ENERGY: LEVEL] é necessária.");
  }
  
  if (parsed.wordCount < minWords || parsed.wordCount > maxWords) {
    errors.push(`A contagem de palavras (${parsed.wordCount}) deve estar entre ${minWords} e ${maxWords}.`);
  }
  
  if (parsed.sfxCount < minSfx || parsed.sfxCount > maxSfx) {
    errors.push(`A quantidade de SFX (${parsed.sfxCount}) deve estar entre ${minSfx} e ${maxSfx}.`);
  }
  
  if (parsed.cleanText.length === 0) {
    errors.push("O texto não pode estar vazio após a remoção das tags.");
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsed
  };
}
