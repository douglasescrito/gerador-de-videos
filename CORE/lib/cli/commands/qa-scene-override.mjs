export async function executar(contexto) {
  const {
    path,
    overrideDraftSceneQa,
    required,
    options,
  } = contexto;
  {
    const draftFile = path.resolve(required(options.draft, "--draft"));
    const result = await overrideDraftSceneQa({ draftFile, sceneId: required(options.scene, "--scene"), author: required(options.author, "--author"), justification: required(options.justification, "--justification") });
    const scene = result.scenes.find((entry) => entry.id === String(options.scene));
    console.log(JSON.stringify({ status: result.status, draft: result.stateFile, scene: { id: scene.id, qa: scene.qa } }, null, 2));
  }
}
