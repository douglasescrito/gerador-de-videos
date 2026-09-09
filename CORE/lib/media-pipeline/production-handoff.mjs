import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { materializeExecutionSnapshot } from "./execution-journal.mjs";
import { operationFingerprint, pathExists } from "./pipeline-operation.mjs";
import { readFilmState, readFilmPlan } from "./film-orchestrator.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const authority = { providerCalls: 0, generationTriggered: false, claimsNodes: false, authorizesResume: false, automaticPromotion: false };

export async function productionHandoff({ stateFile = null, receiptFile = null } = {}) {
  if (Boolean(stateFile) === Boolean(receiptFile)) throw new Error("Transferência exige exatamente --state ou --receipt.");
  const file = path.resolve(stateFile ?? receiptFile);
  const initial = await readFile(file);
  let body;
  if (receiptFile) {
    const receipt = JSON.parse(initial.toString("utf8"));
    if (receipt.schema !== "serie-a-materia/receita@1") throw new Error("Recibo legado incompatível com transferência documental.");
    body = { source: "legacy-receipt", productionId: receipt.id, inputs: [{ file, sha256: hash(initial) }], planFingerprint: null, journal: null, evidence: { recipePresent: true, mediaVerified: false }, nextOperation: { operation: "inspect", reason: "Legado sem journal: conferir artefatos e recibos antes de escolher a etapa; presença da receita não prova entrega." } };
  } else {
    const state = await readFilmState(file);
    const planBytes = await readFile(state.planFile);
    const plan = await readFilmPlan(state.planFile);
    if (state.planFingerprint !== plan.fingerprint) throw new Error("Estado e plano divergem; transferência bloqueada.");
    const journalFile = state.executionJournalFile ?? path.join(path.dirname(file), "execution-journal.sqlite");
    const snapshot = await pathExists(journalFile) ? materializeExecutionSnapshot({ dbFile: journalFile, readOnly: true }) : null;
    if (snapshot && snapshot.planFingerprint !== plan.executionPlan?.fingerprint) throw new Error("Journal pertence a outro plano.");
    const nodes = snapshot ? Object.entries(snapshot.nodes).map(([id, node]) => ({ id, status: node.status, attempts: node.attempts, output: node.output, receipt: node.receipt })) : [];
    const uncertain = nodes.filter((node) => ["ambiguous", "provider_pending", "running", "attention_required"].includes(node.status));
    const blocked = nodes.filter((node) => ["reapproval_required", "stale_paid", "revoked"].includes(node.status));
    const operation = !snapshot ? "inspect" : uncertain.length ? "status/reconcile" : blocked.length ? "inspect" : snapshot.status === "completed" ? "verify-delivery" : "resume";
    body = {
      source: snapshot ? "execution-journal" : "legacy-state", productionId: state.id, planFingerprint: plan.fingerprint,
      inputs: [{ file, sha256: hash(initial) }, { file: path.resolve(state.planFile), sha256: hash(planBytes) }],
      journal: snapshot ? { file: journalFile, snapshotHash: operationFingerprint(snapshot), planFingerprint: snapshot.planFingerprint, lastEvent: snapshot.lastEvent, status: snapshot.status, nodes } : null,
      evidence: { mediaVerified: false, stages: Object.fromEntries(Object.entries(state.stages).map(([id, stage]) => [id, { status: stage.status, outputFile: stage.outputFile ?? null, receiptFile: stage.receiptFile ?? null }])) },
      nextOperation: { operation, nodeIds: [...uncertain, ...blocked].map((node) => node.id), reason: snapshot ? "Revalidar direitos, capability e autorização no executor existente; este pacote não transfere autoridade nem cria nova tentativa." : "Estado legado sem journal; não inferir conclusão de nós nem submissões ausentes." },
    };
    if (!planBytes.equals(await readFile(state.planFile))) throw new Error("Plano mudou durante a leitura; refaça a transferência.");
  }
  if (!initial.equals(await readFile(file))) throw new Error("Origem mudou durante a leitura; refaça a transferência.");
  const value = { schema: "mkt-videos/production-handoff@1", ...body, authority };
  return { ...value, packageHash: operationFingerprint(value) };
}
