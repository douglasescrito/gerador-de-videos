import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStyleEvidenceReconciliation,
  assertStyleSpecEvidenceClaim,
  buildStyleEvidenceReconciliationReport,
  reconcileStyleSpecEvidence,
  STYLE_EVIDENCE_RECONCILIATION_SCHEMA,
} from "../lib/media-pipeline/style-evidence-reconciliation.mjs";

const HASH_A = "a".repeat(64);
const RECEIPT_A = `receipt:sha256:${"b".repeat(64)}`;

function style(overrides = {}) {
  return {
    schema: "mkt-videos/style-spec@1",
    id: "teste@1",
    label: "Teste",
    direction: "Abstract original motion.",
    aspect: null,
    tags: [],
    family: "test",
    status: "pilot",
    studioOnly: true,
    ...overrides,
  };
}

function validatedStyle(overrides = {}) {
  return style({
    status: "validated",
    validation: {
      model: "gemini-omni-flash-preview",
      checkedAt: "2026-07-24T12:00:00.000Z",
      receiptIds: [RECEIPT_A],
      aspects: ["16:9"],
      humanVerdict: "limited",
      notes: ["Observed in an explicitly authorized pilot."],
    },
    risks: ["Text fidelity was not evaluated."],
    ...overrides,
  });
}

test("pilot permanece disponível sem alegar validação por evidência", () => {
  const result = reconcileStyleSpecEvidence(style());
  assert.equal(result.availability, "available");
  assert.equal(result.evidenceStatus, "not-evidence-validated");
  assert.equal(result.validatedClaim.claimed, false);
  assert.deepEqual(result.missing, [
    "validation-model",
    "validation-checked-at",
    "validation-receipts",
    "validation-aspects",
    "human-verdict",
    "validation-test-notes",
    "limitations",
  ]);
  assert.equal(result.referenceEvidence.status, "not-declared");
});

test("validated exige receipt canônico, modelo, veredito, teste e limitações sem forçar referência", () => {
  const result = assertStyleSpecEvidenceClaim(validatedStyle());
  assert.equal(result.availability, "available");
  assert.equal(result.evidenceStatus, "evidence-validated");
  assert.equal(result.referenceEvidence.status, "not-declared");
  assert.equal(result.referenceEvidence.eligibleCount, 0);
  assert.deepEqual(result.receipts.eligibleIds, [RECEIPT_A]);
  assert.equal(result.humanVerdict, "limited");
  assert.deepEqual(result.limitations, ["Text fidelity was not evaluated."]);
});

test("capabilities do spec não substituem o modelo probatório da validação", () => {
  const unsupported = validatedStyle({
    capabilities: {
      onScreenText: "limited",
      people: "unsupported",
    },
    validation: {
      ...validatedStyle().validation,
      model: null,
    },
  });
  const result = reconcileStyleSpecEvidence(unsupported);
  assert.deepEqual(result.missing, ["validation-model"]);
  assert.equal(result.evidenceStatus, "not-evidence-validated");
  assert.throws(
    () => assertStyleSpecEvidenceClaim(unsupported),
    /validation-model/,
  );
});

test("alegação validated sem prova falha fechado e não vira disponibilidade", () => {
  const unsupported = style({ status: "validated" });
  const result = reconcileStyleSpecEvidence(unsupported);
  assert.equal(result.availability, "unavailable");
  assert.equal(result.validatedClaim.consistent, false);
  assert.throws(
    () => assertStyleSpecEvidenceClaim(unsupported),
    /declara status validated sem evidência suficiente/,
  );
  assert.throws(
    () => assertStyleEvidenceReconciliation(
      buildStyleEvidenceReconciliationReport({ styles: [unsupported] }),
    ),
    /status validated sem prova/,
  );
});

test("direitos desconhecidos e receipt não canônico não qualificam prova", () => {
  const result = reconcileStyleSpecEvidence(validatedStyle({
    referenceEvidence: [{
      file: "references/teste.mp4",
      sha256: HASH_A,
      timeRanges: ["00:00:00.000-00:00:02.000"],
      usage: "local-study-only",
      rightsStatus: "unknown",
    }],
    validation: {
      ...validatedStyle().validation,
      receiptIds: ["receipt-legado-sem-hash"],
    },
  }));
  assert.equal(result.evidenceStatus, "not-evidence-validated");
  assert.deepEqual(result.blockers, [
    "invalid-reference-evidence",
    "no-canonical-receipt-id",
  ]);
  assert.equal(result.referenceEvidence.status, "blocked");
  assert.deepEqual(
    result.referenceEvidence.entries[0].blockers,
    ["local-analysis-not-allowed"],
  );
  assert.deepEqual(result.receipts.invalidIds, ["receipt-legado-sem-hash"]);
});

test("relatório é determinístico, ordenado, read-only e provider-free", () => {
  const styles = [
    style({ id: "zeta@1" }),
    validatedStyle({ id: "alfa@1" }),
  ];
  const first = buildStyleEvidenceReconciliationReport({ styles });
  const second = buildStyleEvidenceReconciliationReport({
    styles: [...styles].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.schema, STYLE_EVIDENCE_RECONCILIATION_SCHEMA);
  assert.equal(first.providerFree, true);
  assert.equal(first.readOnly, true);
  assert.deepEqual(first.styles.map((entry) => entry.styleId), ["alfa@1", "zeta@1"]);
  assert.deepEqual(first.summary, {
    total: 2,
    available: 2,
    evidenceValidated: 1,
    invalidValidatedClaims: 0,
  });
});
