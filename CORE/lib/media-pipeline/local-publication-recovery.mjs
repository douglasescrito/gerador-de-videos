import { rm } from "node:fs/promises";
import path from "node:path";
import { sha256File, verifyArtifact } from "./artifact.mjs";
import { readReceipt, verifyReceipt } from "./receipt.mjs";
import { commitTemporaryFile, operationFingerprint, pathExists } from "./pipeline-operation.mjs";

// Reconcilia apenas a publicação local. O temporário foi produzido pelo mesmo
// operador com as entradas congeladas; não existe chamada de provider aqui.
export async function commitOrVerifyLocalFile(temporary, target, { recoverExisting = false, preserveOnFailure = false, label = "Arquivo local" } = {}) {
  if (path.resolve(temporary) === path.resolve(target)) throw new Error("O temporário deve ser distinto da saída preservada.");
  let published = false;
  try {
    if (recoverExisting && await pathExists(target)) {
      const [expected, actual] = await Promise.all([sha256File(temporary), sha256File(target)]);
      if (expected !== actual) throw new Error(`${label} existente diverge da operação local retomada: ${target}`);
      published = true;
      return path.resolve(target);
    }
    const result = await commitTemporaryFile(temporary, target, { label, preserveOnFailure });
    published = true;
    return result;
  } finally { if (published || !preserveOnFailure) await rm(temporary, { force: true }); }
}

export async function readMatchingLocalReceipt({ file, receipt: suppliedReceipt = null, operation, mode = "studio", inputFiles, outputFile, outputCandidateFile = null, parameters = {}, parentReceipts = null }) {
  let receipt = suppliedReceipt;
  if (receipt == null) {
    try { receipt = await readReceipt(file); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  } else {
    const validation = verifyReceipt(receipt);
    if (!validation.valid) throw new Error(`Recibo preparado inválido: ${validation.errors.join(" ")}`);
  }
  if (!Array.isArray(receipt.inputs) || receipt.inputs.some((input) => !input?.file) || !receipt.artifacts?.[0]?.file) throw new Error(`Recibo local sem arquivos declarados: ${file}`);
  const paths = (items) => items.map((item) => path.resolve(item.file)).sort();
  const expectedInputs = inputFiles.map((entry) => path.resolve(entry)).sort();
  const matches = receipt.operation === operation && receipt.parameters?.mode === mode
    && operationFingerprint(paths(receipt.inputs ?? [])) === operationFingerprint(expectedInputs)
    && receipt.artifacts?.length === 1 && path.resolve(receipt.artifacts[0].file) === path.resolve(outputFile)
    && Object.entries(parameters).every(([key, value]) => Object.hasOwn(receipt.parameters, key) && operationFingerprint(receipt.parameters[key]) === operationFingerprint(value))
    && (parentReceipts == null || operationFingerprint([...(receipt.metadata?.pipeline?.parentReceiptIds ?? [])].sort()) === operationFingerprint([...parentReceipts].sort()));
  if (!matches) throw new Error(`Recibo local diverge da etapa retomada: ${file}`);
  for (const artifact of [...receipt.inputs, ...receipt.artifacts.map(artifact => outputCandidateFile == null ? artifact : { ...artifact, file: path.resolve(outputCandidateFile) })]) {
    const verified = await verifyArtifact(artifact);
    if (!verified.valid) throw new Error(`Arquivo local divergente: ${verified.errors.join(" ")}`);
  }
  return receipt;
}
