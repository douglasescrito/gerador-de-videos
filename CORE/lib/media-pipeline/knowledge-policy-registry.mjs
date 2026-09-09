import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const KNOWLEDGE_POLICY_ID = "knowledge-governance-policy@1";
export const KNOWLEDGE_POLICY_HASH =
  "80c3c7d6b0a6bed3f4739aa23c907531edc675c22bb8cf2d6e91c58daca9b960";

const POLICY_DOCUMENTS = Object.freeze({
  [KNOWLEDGE_POLICY_ID]: Object.freeze({
    hash: KNOWLEDGE_POLICY_HASH,
    document: fileURLToPath(
      new URL("../../docs/KNOWLEDGE-GOVERNANCE-POLICY.md", import.meta.url),
    ),
  }),
});

function normalizedDocumentHash(file) {
  const contents = readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export function knownKnowledgePolicy(policyId, policyHash) {
  const registered = POLICY_DOCUMENTS[policyId];
  return Boolean(registered && registered.hash === policyHash);
}

export function knowledgePolicyRegistry() {
  return Object.freeze(Object.entries(POLICY_DOCUMENTS).map(
    ([policyId, entry]) => Object.freeze({
      policyId,
      policyHash: entry.hash,
    }),
  ));
}

export function assertKnowledgePolicyDocuments() {
  for (const [policyId, entry] of Object.entries(POLICY_DOCUMENTS)) {
    if (normalizedDocumentHash(entry.document) !== entry.hash) {
      throw new Error(
        `Documento imutável da política ${policyId} diverge do registry.`,
      );
    }
  }
  return knowledgePolicyRegistry();
}

assertKnowledgePolicyDocuments();
