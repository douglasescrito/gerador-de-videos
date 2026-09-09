/**
 * Constrói o filtergraph complexo do FFmpeg para a mixagem final da V17.
 * @param {Object} options Configurações de volume
 * @param {number} [options.voiceVolume] Multiplicador de volume da voz (padrão: 1.2)
 * @param {number} [options.musicVolume] Multiplicador de volume base da música (padrão: 0.25)
 * @param {number} [options.sfxStemVolume] Multiplicador de volume dos efeitos sonoros (padrão: 1.0)
 * @param {Object} [options.energyDucking] Objeto com a configuração de automação de volume musical (ducking)
 * @returns {string} String do filtergraph para uso no FFmpeg
 */
export function buildV17Filtergraph({ voiceVolume = 1.2, musicVolume = 0.25, sfxStemVolume = 1.0, energyDucking = null } = {}) {
  let graph = "";
  
  // Aplicação do volume fixo para o canal de voz (Entrada 1)
  graph += `[1:a]volume=${voiceVolume}[voz];`;
  
  // Processamento do volume para o canal de música com suporte a ducking dinâmico (Entrada 2)
  if (energyDucking && Array.isArray(energyDucking.segments) && energyDucking.segments.length > 0) {
    // Tabela de mapeamento para as energias da música em multiplicadores reais de volume
    const energyMap = Object.freeze({
      "LOW": 0.30,
      "RISING": 0.20,
      "CLIMAX": 0.15
    });
    
    let musicFilters = `volume=${musicVolume}`;
    
    // Configura um filtro habilitado seletivamente para cada variação mapeada de ducking
    for (const segment of energyDucking.segments) {
      if (!segment.energy || !energyMap[segment.energy]) continue;
      
      if (typeof segment.startMs !== "number" || typeof segment.endMs !== "number") continue;

      const startSec = (segment.startMs / 1000).toFixed(3);
      const endSec = (segment.endMs / 1000).toFixed(3);
      const volMultiplier = energyMap[segment.energy];
      
      musicFilters += `,volume=enable='between(t,${startSec},${endSec})':volume=${volMultiplier}`;
    }
    
    graph += `[2:a]${musicFilters}[bgm];`;
  } else {
    // Caso não exista a automação, utiliza apenas o volume estático configurado
    graph += `[2:a]volume=${musicVolume}[bgm];`;
  }
  
  // Aplicação do volume fixo para o stem com os efeitos sonoros combinados (Entrada 3)
  graph += `[3:a]volume=${sfxStemVolume}[sfx];`;
  
  // Combinando as três streams modificadas em um arquivo de áudio final com transições brandas
  graph += `[voz][bgm][sfx]amix=inputs=3:duration=first:dropout_transition=2:normalize=0[audioFinal]`;
  
  return graph;
}

/**
 * Constrói o array de argumentos do FFmpeg para a renderização do vídeo.
 * @param {Object} options Configurações de renderização
 * @returns {string[]} Array completo com os argumentos requeridos pelo processo FFmpeg
 */
export function buildV17FfmpegArgs({
  videoFile,
  voiceFile,
  musicFile,
  sfxStemFile,
  outputFile,
  filtergraph = null,
  voiceVolume = 1.2,
  musicVolume = 0.25,
  sfxStemVolume = 1.0,
  energyDucking = null,
  audioCodec = "aac",
  audioBitrate = "192k"
} = {}) {
  if (!videoFile || !voiceFile || !musicFile || !sfxStemFile || !outputFile) {
    throw new Error("Há arquivos ausentes. É obrigatório fornecer videoFile, voiceFile, musicFile, sfxStemFile e outputFile.");
  }
  
  // Define o filtergraph, gerando um novo caso não tenha sido explicitamente fornecido
  const graph = filtergraph || buildV17Filtergraph({ voiceVolume, musicVolume, sfxStemVolume, energyDucking });
  
  return [
    "-y",
    "-i", videoFile,
    "-i", voiceFile,
    "-i", musicFile,
    "-i", sfxStemFile,
    "-filter_complex", graph,
    "-map", "0:v",
    "-map", "[audioFinal]",
    "-c:v", "copy",
    "-c:a", audioCodec,
    "-b:a", audioBitrate,
    outputFile
  ];
}

/**
 * Formata um filtergraph complexo do FFmpeg para melhorar a legibilidade e facilitar inspeções (auditoria).
 * @param {string} filtergraph A string concatenada do filtergraph
 * @returns {string} O filtergraph distribuído sequencialmente em linhas endentadas
 */
export function serializeFiltergraph(filtergraph) {
  if (!filtergraph || typeof filtergraph !== "string") return "";
  
  // Separa cada etapa pelos divisores nativos de filtro do ffmpeg (;)
  return filtergraph
    .split(";")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join(";\n  ");
}
