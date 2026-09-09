import { parentPort, workerData } from "node:worker_threads";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
} from "../../lib/media-pipeline/knowledge-store.mjs";

const start = new Int32Array(workerData.startBuffer);
Atomics.wait(start, 0, 0);

try {
  const repository = createKnowledgeStoreRepository({
    dbFile: workerData.dbFile,
    coreRoot: workerData.coreRoot,
    clock: () => new Date(workerData.now),
  });
  const grant = createScopeGrant(workerData.grant);
  const entry = repository.createFeedbackInterpretationCandidate({
    grant,
    candidate: workerData.candidate,
  });
  parentPort.postMessage({
    ok: true,
    eventId: entry.eventId,
    subjectId: entry.subjectId,
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
}
