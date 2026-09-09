export async function executar(contexto) {
  const {
    googleVidsVoiceCatalog,
    options,
  } = contexto;
  {
    const provider = String(options.provider ?? "google-vids").trim().toLowerCase();
    if (provider !== "google-vids") throw new Error("--provider deve ser google-vids.");
    console.log(JSON.stringify(googleVidsVoiceCatalog({ group: options.group ?? null, query: options.query ?? null }), null, 2));
  }
}
