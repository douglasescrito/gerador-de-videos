import { probeMedia } from "./media-tools.mjs";

// Calcula o Máximo Divisor Comum (MDC) para simplificar a proporção
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

// Determina a proporção da imagem/vídeo
function getSimpleAspectRatio(width, height) {
    // Tratamento para variações comuns de encoders que quebram o MDC exato
    const ratio = width / height;
    if (Math.abs(ratio - (9 / 16)) < 0.05) return "9:16";
    if (Math.abs(ratio - (16 / 9)) < 0.05) return "16:9";
    if (Math.abs(ratio - (3 / 4)) < 0.05) return "3:4";
    if (Math.abs(ratio - (4 / 3)) < 0.05) return "4:3";
    if (Math.abs(ratio - 1) < 0.05) return "1:1";

    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}

export async function checkAspectRatio({ videoFile, expectedAspect = "9:16" } = {}) {
  try {
    const probeResult = await probeMedia(videoFile);
    
    // Suporte para o formato padrão do probeMedia (probeResult.video) ou ffprobe raw
    let width = probeResult.video?.width ?? probeResult.width;
    let height = probeResult.video?.height ?? probeResult.height;
    
    if (!width || !height) {
        if (probeResult.streams && Array.isArray(probeResult.streams)) {
            const videoStream = probeResult.streams.find(s => s.codec_type === 'video') || probeResult.streams[0];
            if (videoStream) {
                width = videoStream.width;
                height = videoStream.height;
            }
        }
    }
    
    if (!width || !height) {
         throw new Error("Não foi possível extrair dimensões do vídeo a partir dos metadados.");
    }

    const actualAspect = getSimpleAspectRatio(width, height);
    const match = actualAspect === expectedAspect;
    let warning = null;
    
    if (!match) {
        warning = `Aspecto divergente: esperado ${expectedAspect}, recebido ${actualAspect}. O provedor ignorou a solicitação de aspecto.`;
    }

    return {
      videoFile,
      width,
      height,
      actualAspect,
      expectedAspect,
      match,
      warning
    };
  } catch (error) {
    return {
      videoFile,
      width: 0,
      height: 0,
      actualAspect: "unknown",
      expectedAspect,
      match: false,
      warning: `Erro ao verificar aspecto: ${error.message}`
    };
  }
}

export async function guardAspectRatio({ videoFile, expectedAspect = "9:16" } = {}) {
  // O guard apenas envolve o check sem abortar o processo (falha silenciosa com logs)
  const result = Object.freeze(await checkAspectRatio({ videoFile, expectedAspect }));
  return result;
}
