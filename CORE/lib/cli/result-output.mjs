import { CliError, ERROR_CODES } from "./cli-errors.mjs";

const recipeTextActions = new Set(["suggest", "validate", "explain", "preflight", "plan"]);

export function validateResultFormat(value, { command, action = "validate" } = {}) {
  const format = value ?? "json";
  if (!["json", "text"].includes(format)) throw new CliError("--output-format deve ser json ou text.", { code: ERROR_CODES.USAGE });
  if (format === "text" && command === "recipe" && !recipeTextActions.has(String(action).trim().toLowerCase())) {
    throw new CliError("--output-format text pertence a recipe suggest, validate, explain, preflight ou plan.", { code: ERROR_CODES.USAGE });
  }
  return format;
}

// Text is an opt-in projection. Machine output retains each existing schema,
// fields and JSON serialization, including unavailable values and state codes.
export function createCliResultWriter({ format, command, action, stdout = console.log } = {}) {
  const selected = validateResultFormat(format, { command, action });
  return (result) => stdout(selected === "json" ? JSON.stringify(result, null, 2) : summarize(result, { command, action }));
}

function line(value) {
  return String(value ?? "não informado").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ");
}

function summarize(result, { command, action }) {
  const rows = [];
  const add = (label, value) => { if (value != null) rows.push(`${label}: ${line(value)}`); };
  if (command === "recipe") {
    add("Receita", result.identity?.title ?? result.recipe?.identity?.title ?? result.resolved?.recipe?.identity?.title ?? action);
    add("Estado", result.status ?? (result.valid === true ? "valid" : result.blockers?.length ? "blocked" : "analisada"));
    if (result.readiness) {
      add("Estrutura", result.readiness.structure);
      add("Capacidades", result.readiness.capabilityPreflight);
      add("Bytes dos assets", result.readiness.assetBytes);
      add("Autoridade de execução", result.readiness.runtimeAuthority);
    }
    const plan = result.execution ?? result.executionPlan;
    add("Plano", plan?.planFingerprint ?? plan?.fingerprint ?? result.hashes?.planFingerprint ?? result.evidence?.planFingerprint);
    if (plan?.nodes) add("Operações previstas", plan.nodes.length);
    if (plan?.initiallyReady) add("Nós sem dependências", plan.initiallyReady.join(", "));
    if (plan?.possibleOverlap) add("Paralelismo", `${plan.possibleOverlap.pairs.length}${plan.possibleOverlap.truncated ? "+" : ""} pares independentes; sujeito à capacidade disponível`);
    const blockers = result.blockers ?? result.readiness?.blockers;
    if (Array.isArray(blockers)) {
      add("Bloqueios", blockers.length);
      for (const blocker of blockers.slice(0, 5)) rows.push(`- ${line(blocker.code)}: ${line(blocker.message)}`);
      if (blockers.length > 5) add("Outros bloqueios no JSON", blockers.length - 5);
    }
    add("Arquivo", result.out);
    add("Evidência", result.evidenceFile);
    rows.push("Análise da receita não comprova entrega física nem concede autorização ao runtime.");
  } else if (command === "jobs") {
    add("Produções", result.total);
    add("Estados", Object.entries(result.counts ?? {}).map(([status, count]) => `${status}=${count}`).join(", ") || "nenhuma produção");
    const jobs = result.jobs ?? [];
    const terminal = new Set(["delivered", "completed"]);
    const ordered = [...jobs.filter(job => !terminal.has(job.status)), ...jobs.filter(job => terminal.has(job.status))];
    for (const job of ordered.slice(0, 8)) {
      rows.push(`- ${line(job.collection ?? job.id)}: ${line(job.status)}`);
      if (job.activeStage) rows.push(`  Etapa: ${line(job.activeStage.name)} (${line(job.activeStage.status)})`);
      if (job.activeScene) rows.push(`  Cena: ${line(job.activeScene.id)} (${line(job.activeScene.status)})`);
      if (job.nextAction) rows.push(`  Próxima ação: ${line(job.nextAction)}`);
    }
    if (jobs.length > 8) add("Outras produções no JSON", jobs.length - 8);
    add("Registros ilegíveis", result.unreadable?.length ?? 0);
    add("Runtime", result.runtime?.status);
  } else if (result.schema === "mkt-videos/production-handoff@1") {
    add("Produção", result.productionId);
    add("Estado do journal", result.journal?.status);
    add("Próxima operação", result.nextOperation?.operation);
    add("Nós", result.nextOperation?.nodeIds?.join(", "));
    add("Motivo", result.nextOperation?.reason);
    rows.push("Pacote de continuidade; não concede autoridade nem comprova entrega física.");
  } else {
    add("Produção", result.id);
    add("Estado", result.status);
    const stages = Object.entries(result.stages ?? {});
    add("Etapas concluídas", `${stages.filter(([, stage]) => stage.status === "completed").length}/${stages.length}`);
    const pending = stages.filter(([, stage]) => !["completed", "skipped"].includes(stage.status));
    for (const [name, stage] of pending.slice(0, 8)) rows.push(`- ${line(name)}: ${line(stage.status)}`);
    if (pending.length > 8) add("Outras etapas no JSON", pending.length - 8);
    add("Estado do draft", result.draft?.status);
    add("Arquivo final registrado", result.finalFile);
  }
  rows.push("Detalhes completos: --output-format json");
  return rows.join("\n");
}
