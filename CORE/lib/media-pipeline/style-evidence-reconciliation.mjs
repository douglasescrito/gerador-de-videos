export const STYLE_EVIDENCE_RECONCILIATION_SCHEMA =
  "mkt-videos/style-evidence-reconciliation@1";

const AVAILABLE_LIFECYCLE_STATUSES = new Set(["pilot", "validated"]);
const EVIDENCE_VERDICTS = new Set(["accepted", "limited"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_ID_PATTERN = /^receipt:sha256:[a-f0-9]{64}$/;

function compareText(left, right) {
  const normalizedLeft = String(left);
  const normalizedRight = String(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueSortedText(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizedText).filter(Boolean))].sort(compareText);
}

function evidenceEntryReport(entry, index) {
  const value = entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry
    : {};
  const file = normalizedText(value.file);
  const sha256 = normalizedText(value.sha256);
  const timeRanges = uniqueSortedText(value.timeRanges);
  const usage = normalizedText(value.usage);
  const rightsStatus = normalizedText(value.rightsStatus);
  const blockers = [];
  if (!file) blockers.push("missing-file");
  if (!SHA256_PATTERN.test(sha256)) blockers.push("invalid-sha256");
  if (timeRanges.length === 0) blockers.push("missing-time-ranges");
  if (usage !== "local-study-only") blockers.push("invalid-usage");
  if (rightsStatus !== "allowed") blockers.push("local-analysis-not-allowed");
  return {
    index,
    file: file || null,
    sha256: sha256 || null,
    timeRanges,
    usage: usage || null,
    rightsStatus: rightsStatus || null,
    eligible: blockers.length === 0,
    blockers,
  };
}

function validationReport(style) {
  const validation = style?.validation && typeof style.validation === "object"
    && !Array.isArray(style.validation)
    ? style.validation
    : {};
  const model = normalizedText(validation.model);
  const checkedAt = normalizedText(validation.checkedAt);
  const checkedAtValid = Boolean(checkedAt) && !Number.isNaN(Date.parse(checkedAt));
  const declaredReceiptIds = uniqueSortedText(validation.receiptIds);
  const eligibleReceiptIds = declaredReceiptIds.filter((id) => RECEIPT_ID_PATTERN.test(id));
  const aspects = uniqueSortedText(validation.aspects);
  const humanVerdict = normalizedText(validation.humanVerdict) || null;
  const notes = uniqueSortedText(validation.notes);
  return {
    model: model || null,
    checkedAt: checkedAt || null,
    checkedAtValid,
    declaredReceiptIds,
    eligibleReceiptIds,
    invalidReceiptIds: declaredReceiptIds.filter((id) => !RECEIPT_ID_PATTERN.test(id)),
    aspects,
    humanVerdict,
    notes,
  };
}

export function reconcileStyleSpecEvidence(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    throw new Error("StyleSpec deve ser um objeto para reconciliar evidência.");
  }
  const styleId = normalizedText(style.id);
  const lifecycleStatus = normalizedText(style.status);
  if (!styleId) throw new Error("StyleSpec.id é obrigatório para reconciliar evidência.");
  if (!lifecycleStatus) throw new Error(`${styleId}.status é obrigatório para reconciliar evidência.`);

  const evidence = Array.isArray(style.referenceEvidence)
    ? style.referenceEvidence.map(evidenceEntryReport)
    : [];
  const eligibleEvidenceCount = evidence.filter((entry) => entry.eligible).length;
  const validation = validationReport(style);
  const limitations = uniqueSortedText(style.risks);
  const missing = [];
  const blockers = [];

  if (evidence.length > 0 && eligibleEvidenceCount !== evidence.length) {
    blockers.push("invalid-reference-evidence");
  }
  if (!validation.model) missing.push("validation-model");
  if (!validation.checkedAt) missing.push("validation-checked-at");
  else if (!validation.checkedAtValid) blockers.push("invalid-validation-checked-at");
  if (validation.declaredReceiptIds.length === 0) missing.push("validation-receipts");
  else if (validation.eligibleReceiptIds.length === 0) blockers.push("no-canonical-receipt-id");
  if (validation.aspects.length === 0) missing.push("validation-aspects");
  if (!validation.humanVerdict) missing.push("human-verdict");
  else if (!EVIDENCE_VERDICTS.has(validation.humanVerdict)) {
    blockers.push(`human-verdict-${validation.humanVerdict}`);
  }
  if (validation.notes.length === 0) missing.push("validation-test-notes");
  if (limitations.length === 0) missing.push("limitations");

  const evidenceValidated = missing.length === 0 && blockers.length === 0;
  const claimsValidated = lifecycleStatus === "validated";
  const validatedClaimConsistent = !claimsValidated || evidenceValidated;
  const lifecycleAvailable = AVAILABLE_LIFECYCLE_STATUSES.has(lifecycleStatus);

  return {
    styleId,
    lifecycleStatus,
    availability: lifecycleAvailable && validatedClaimConsistent ? "available" : "unavailable",
    evidenceStatus: evidenceValidated ? "evidence-validated" : "not-evidence-validated",
    validatedClaim: {
      claimed: claimsValidated,
      substantiated: evidenceValidated,
      consistent: validatedClaimConsistent,
    },
    referenceEvidence: {
      status: evidence.length === 0
        ? "not-declared"
        : eligibleEvidenceCount === evidence.length
          ? "qualified"
          : "blocked",
      declaredCount: evidence.length,
      eligibleCount: eligibleEvidenceCount,
      entries: evidence,
    },
    receipts: {
      declaredIds: validation.declaredReceiptIds,
      eligibleIds: validation.eligibleReceiptIds,
      invalidIds: validation.invalidReceiptIds,
    },
    humanVerdict: validation.humanVerdict,
    validation: {
      model: validation.model,
      checkedAt: validation.checkedAt,
      checkedAtValid: validation.checkedAtValid,
      aspects: validation.aspects,
      notes: validation.notes,
    },
    limitations,
    missing,
    blockers,
  };
}

export function assertStyleSpecEvidenceClaim(style) {
  const result = reconcileStyleSpecEvidence(style);
  if (!result.validatedClaim.consistent) {
    const reasons = [...result.missing, ...result.blockers].join(", ");
    throw new Error(
      `StyleSpec ${result.styleId} declara status validated sem evidência suficiente: ${reasons}.`,
    );
  }
  return result;
}

export function buildStyleEvidenceReconciliationReport({ styles } = {}) {
  if (!Array.isArray(styles)) throw new Error("styles deve ser uma lista de StyleSpec.");
  const ids = new Set();
  const entries = [...styles]
    .map((style) => {
      const result = reconcileStyleSpecEvidence(style);
      if (ids.has(result.styleId)) {
        throw new Error(`StyleSpec duplicado na reconciliação: ${result.styleId}.`);
      }
      ids.add(result.styleId);
      return result;
    })
    .sort((left, right) => compareText(left.styleId, right.styleId));
  const invalidValidatedClaims = entries
    .filter((entry) => !entry.validatedClaim.consistent)
    .map((entry) => entry.styleId);

  return {
    schema: STYLE_EVIDENCE_RECONCILIATION_SCHEMA,
    providerFree: true,
    readOnly: true,
    summary: {
      total: entries.length,
      available: entries.filter((entry) => entry.availability === "available").length,
      evidenceValidated: entries.filter(
        (entry) => entry.evidenceStatus === "evidence-validated",
      ).length,
      invalidValidatedClaims: invalidValidatedClaims.length,
    },
    invalidValidatedClaims,
    styles: entries,
  };
}

export function assertStyleEvidenceReconciliation(report) {
  if (!report || report.schema !== STYLE_EVIDENCE_RECONCILIATION_SCHEMA) {
    throw new Error("Relatório de reconciliação de StyleSpec inválido.");
  }
  if (report.invalidValidatedClaims.length > 0) {
    throw new Error(
      `Catálogo declara status validated sem prova: ${report.invalidValidatedClaims.join(", ")}.`,
    );
  }
  return report;
}
