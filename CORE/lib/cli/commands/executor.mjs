export async function executar(contexto) {
  const {
    path,
    prepareExecutorRollout,
    readFilmPlan,
    readFilmState,
    rollbackExecutor,
    required,
    options,
  } = contexto;
  {
    const action = String(options.action ?? "status");
    const stateFile = path.resolve(required(options.state, "--state"));
    const legacyState = await readFilmState(stateFile);
    const journalFile = options.journal ? path.resolve(String(options.journal)) : path.join(path.dirname(stateFile), "execution-journal.sqlite");
    if (action === "rollback") console.log(JSON.stringify(rollbackExecutor({ legacyState, journalFile }), null, 2));
    else if (action === "status") {
      const { materializeExecutionSnapshot } = await import("../../media-pipeline/execution-journal.mjs");
      console.log(JSON.stringify(materializeExecutionSnapshot({ dbFile: journalFile }), null, 2));
    } else if (action === "migrate") {
      const legacyPlan = await readFilmPlan(legacyState.planFile);
      console.log(JSON.stringify(prepareExecutorRollout({ legacyPlan, legacyState, journalFile, mode: options.mode ?? "shadow" }), null, 2));
    } else throw new Error("executor --action deve ser migrate, status ou rollback.");
  }
}
