export async function executar(contexto) {
  const {
    path,
    draftScenes,
    loadFilmSpec,
    withCliResourceLease,
    required,
    cookieRuntime,
    studioMode,
    options,
  } = contexto;
  {
    studioMode({ mode: "studio" }, "draft");
    const specFile = path.resolve(required(options.spec, "--spec"));
    const spec = await loadFilmSpec(specFile);
    const { imageAdapter } = await cookieRuntime(options);
    const result = await withCliResourceLease({ resource: "provider:omni", weight: Math.min(3, Number(spec?.execution?.concurrency?.draft ?? 3)), productionId: `draft:${specFile}` }, () => draftScenes({
      spec,
      specFile,
      outputsRoot: options["out-root"] ? path.resolve(String(options["out-root"])) : null,
      stateFile: options.state ? path.resolve(String(options.state)) : null,
      imageAdapter,
    }));
    console.log(JSON.stringify({ status: result.status, draft: result.stateFile, scenes: result.scenes.map((scene) => ({ id: scene.id, status: scene.status, keyframe: scene.keyframeFile })) }, null, 2));
  }
}
