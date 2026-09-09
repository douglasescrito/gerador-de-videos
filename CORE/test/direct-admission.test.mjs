import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DIRECT_REQUIRED_BYTES, createDirectAdmission } from "../lib/media-pipeline/direct-admission.mjs";

const preflightPronto = {
  status: "ready",
  blockers: [],
  capability: { id: "omni", status: "supported" },
};

test("rota sem provider input é admitida pelo escopo no-provider-input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admissao-direta-"));
  try {
    const admission = createDirectAdmission({
      preflight: preflightPronto,
      outputFile: path.join(root, "peca.mp4"),
      requiredBytes: 1,
    });
    const resultado = await admission({ phase: "before-queue" });
    assert.equal(resultado.status, "ready");
    assert.deepEqual(resultado.blockers, []);
    assert.equal(resultado.checks.rightsDecisionId, "no-provider-input");
    assert.equal(resultado.checks.capabilityId, "omni");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("capability bloqueada no preflight bloqueia antes da vaga", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admissao-bloqueada-"));
  try {
    const admission = createDirectAdmission({
      preflight: { status: "blocked", blockers: ["health_unavailable"], capability: { id: "omni", status: "supported" } },
      outputFile: path.join(root, "peca.mp4"),
      requiredBytes: 1,
    });
    const resultado = await admission({});
    assert.equal(resultado.status, "blocked");
    assert.equal(resultado.blockers.includes("capability_not_proved"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("disco insuficiente bloqueia — é o que pode ter mudado durante a espera", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admissao-disco-"));
  try {
    const admission = createDirectAdmission({
      preflight: preflightPronto,
      outputFile: path.join(root, "peca.mp4"),
      requiredBytes: Number.MAX_SAFE_INTEGER,
    });
    const resultado = await admission({ phase: "after-queue" });
    assert.equal(resultado.status, "blocked");
    assert.deepEqual(resultado.blockers, ["insufficient_disk_space"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("permit inválido depois da fila vira bloqueio, não submissão", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admissao-permit-"));
  try {
    const admission = createDirectAdmission({
      preflight: preflightPronto,
      // Um permit malformado é recusado pelo verificador JIT — o mesmo que
      // acontece com um permit que venceu enquanto o job esperava vaga.
      permit: { schema: "invalido", permitId: "p1" },
      permitDescriptors: [],
      outputFile: path.join(root, "peca.mp4"),
      requiredBytes: 1,
    });
    const resultado = await admission({ phase: "after-queue" });
    assert.equal(resultado.status, "blocked");
    assert.equal(resultado.blockers.some((entry) => entry.startsWith("provider_input_permit_invalid:")), true);
    assert.equal(resultado.blockers.includes("rights_not_allowed"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sem preflight não há o que afirmar sobre capability", () => {
  assert.throws(() => createDirectAdmission({ outputFile: "x.mp4" }), /exige invocation ou preflight/);
  assert.equal(DIRECT_REQUIRED_BYTES.video > DIRECT_REQUIRED_BYTES.image, true);
});
