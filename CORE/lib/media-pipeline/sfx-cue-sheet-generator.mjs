export function generateCueSheet(palavrasJson, scriptPlanJson, alignmentFingerprint) {
  if (!scriptPlanJson || scriptPlanJson.schema !== "mkt-videos/script-plan@1") {
    throw new Error("Invalid schema for script-plan");
  }
  
  const cues = [];
  const rejected = [];
  
  const words = palavrasJson.words || palavrasJson;
  
  // Build a flat list of words with timing
  const measuredWords = Array.isArray(words) ? words : [];
  // Use map to preserve indices
  const measuredText = measuredWords.map(w => w.word.toLowerCase());
  const measuredStartTimes = measuredWords.map(w => w.start); 
  
  for (const block of scriptPlanJson.blocks) {
    const energy = block.energy;
    let limit = 1;
    if (energy === 'RISING') limit = 2;
    if (energy === 'CLIMAX') limit = 3;
    
    let cuesInBlock = 0;
    const impactWords = block.impactWords || [];
    
    for (const targetWord of impactWords) {
      const lowerTarget = targetWord.toLowerCase();
      
      const index = measuredText.indexOf(lowerTarget);
      
      if (index === -1) {
        rejected.push({
          word: targetWord,
          reason: `não encontrada na transcrição medida de ${block.id}`
        });
        continue;
      }
      
      if (cuesInBlock >= limit) {
        rejected.push({
          word: targetWord,
          reason: `limite de cues excedido para energia ${energy} em ${block.id}`
        });
        continue;
      }
      
      const atMs = Math.round(measuredStartTimes[index] * 1000);
      
      // Check spacing with previously added cues (must be >= 900ms)
      const isTooClose = cues.some(c => Math.abs(c.atMs - atMs) < 900);
      
      if (isTooClose) {
        rejected.push({
          word: targetWord,
          reason: `rejeitada por distanciamento mínimo de 900ms`
        });
        continue;
      }
      
      let sound = 'boom';
      let gain = 1.0;
      if (energy === 'LOW') { sound = 'glitch'; gain = 0.9; }
      if (energy === 'RISING') { sound = 'whoosh'; gain = 0.95; }
      
      cues.push({
        atMs,
        sound,
        gain,
        reason: `impactWord '${targetWord}' medida em ${block.id}`,
        energy
      });
      cuesInBlock++;
      
      // Blank out the word so it's not matched again
      measuredText[index] = "";
    }
  }
  
  cues.sort((a, b) => a.atMs - b.atMs);
  
  let totalDurationMs = 0;
  if (measuredWords.length > 0) {
    const lastWord = measuredWords[measuredWords.length - 1];
    totalDurationMs = Math.round((lastWord.end || lastWord.start) * 1000) + 500;
  }
  if (palavrasJson.duration) {
    totalDurationMs = Math.round(palavrasJson.duration * 1000);
  }
  
  return {
    schema: "mkt-videos/sfx-cue-sheet@1",
    alignmentFingerprint: alignmentFingerprint || "unknown",
    totalDurationMs,
    cues,
    rejected
  };
}
