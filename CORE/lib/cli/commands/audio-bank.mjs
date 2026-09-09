export async function executar(contexto) {
  const {
    searchOnlineAudio,
    downloadOnlineAudio,
    studioMode,
    options,
  } = contexto;
  {
    studioMode(options, "audio-bank");
    const action = String(options.action ?? "search").toLowerCase();
    if (action === "search") {
      const results = await searchOnlineAudio({
        query: options.query,
        type: options.type ?? "music",
        source: options.source ?? "archive-org",
        limit: options.limit ? Number(options.limit) : 10,
      });
      console.log(JSON.stringify({ ok: true, action: "search", count: results.length, results }, null, 2));
    } else if (action === "download") {
      const result = await downloadOnlineAudio({
        url: options.url,
        id: options.id,
        query: options.query,
        type: options.type ?? "music",
        source: options.source ?? "archive-org",
        outputFile: options.out ?? `outputs/trilha-online-${Date.now()}.wav`,
        duration: options.duration ? Number(options.duration) : null,
      });
      console.log(JSON.stringify({ ok: true, action: "download", file: result.file, receipt: result.receiptFile, duration: result.duration, sourceUrl: result.sourceUrl }, null, 2));
    } else {
      throw new Error(`Ação do audio-bank desconhecida: ${action}. Use search ou download.`);
    }
  }
}
