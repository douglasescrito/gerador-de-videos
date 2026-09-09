export async function executar(contexto) {
  const {
    path,
    approveDraft,
    required,
    options,
  } = contexto;
  {
    const result = await approveDraft({ draftFile: path.resolve(required(options.draft, "--draft")), scenes: options.scenes ?? null });
    console.log(JSON.stringify({ status: result.status, draft: result.stateFile, scenes: result.scenes.map((scene) => ({ id: scene.id, status: scene.status })) }, null, 2));
  }
}
