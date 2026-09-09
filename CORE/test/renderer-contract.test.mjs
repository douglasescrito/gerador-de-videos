import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRendererContract,
  assertRendererSandboxManifest,
  buildRendererBakeOffReport,
  createRendererContract,
  createRendererSandboxManifest,
} from "../lib/media-pipeline/renderer-contract.mjs";

const hash = (letter) => letter.repeat(64);

function sandbox() {
  return createRendererSandboxManifest({
    browser: { name: "chromium", version: "pinned", sha256: hash("a") },
    node: { version: "22", sha256: hash("b") },
    ffmpeg: { version: "7", sha256: hash("c") },
    fonts: [{ id: "font-sans", license: "OFL-1.1", sha256: hash("d") }],
    viewport: { width: 1920, height: 1080 },
    dpr: 1,
    seed: "renderer-fixture",
  });
}

test("sandbox renderer fecha rede, cookies, downloads e relógio real", () => {
  const manifest = sandbox();
  assert.equal(assertRendererSandboxManifest(manifest).fingerprint, manifest.fingerprint);
  const tampered = structuredClone(manifest);
  tampered.network = true;
  assert.throws(() => assertRendererSandboxManifest(tampered), /rede|blocked|bloqueados/i);
});

test("renderer contract é provider-free, hash-bound e sem promoção implícita", () => {
  const contract = createRendererContract({
    id: "playwright-canvas@candidate",
    name: "Playwright Canvas mínimo",
    version: "candidate",
    license: "MIT",
    capabilities: ["typography", "overlay"],
    sandbox: sandbox(),
  });
  assert.equal(assertRendererContract(contract).providerFree, true);
  const report = buildRendererBakeOffReport({
    candidates: [contract],
    corpus: [{ id: "text-card", expected: "frame-exact", results: { [contract.id]: "pending" } }],
  });
  assert.equal(report.decision, "pending");
  assert.equal(report.promotionPerformed, false);
  assert.equal(report.providerFree, true);
});

test("renderer contract falha fechado se tentar usar rede ou sandbox incompleto", () => {
  const manifest = sandbox();
  const contract = createRendererContract({ id: "candidate", name: "Candidate", version: "1", license: "MIT", sandbox: manifest });
  const tampered = structuredClone(contract);
  tampered.network = "allowed";
  assert.throws(() => assertRendererContract(tampered), /provider-free|bloqueia/i);
  const missing = structuredClone(manifest);
  missing.clock.mode = "wall-clock";
  assert.throws(() => assertRendererSandboxManifest(missing), /relógio|frame/i);
});

