import assert from "node:assert/strict";
import test from "node:test";
import { unresolvedExecutionDependencies } from "../lib/media-pipeline/runtime-admission.mjs";

test("pendência de outro ramo não bloqueia, mas o efeito e seus ancestrais continuam protegidos", () => {
  const nodes = [
    { id: "voice", dependencies: [] },
    { id: "alignment", dependencies: ["voice"] },
    { id: "scene", dependencies: ["alignment"] },
    { id: "music", dependencies: [] },
  ];
  for (const status of ["provider_pending", "ambiguous"]) {
    const snapshot = { nodes: { voice: { status }, music: { status: "planned" } } };
    const before = JSON.stringify(snapshot);
    assert.deepEqual(unresolvedExecutionDependencies({ nodeId: "music", nodes, snapshot }), []);
    assert.deepEqual(unresolvedExecutionDependencies({ nodeId: "voice", nodes, snapshot }), ["voice"]);
    assert.deepEqual(unresolvedExecutionDependencies({ nodeId: "scene", nodes, snapshot }), ["voice"]);
    assert.equal(JSON.stringify(snapshot), before);
  }
  assert.throws(() => unresolvedExecutionDependencies({ nodeId: "missing", nodes, snapshot: { nodes: {} } }), /desconhecido/);
  assert.throws(() => unresolvedExecutionDependencies({
    nodeId: "scene", nodes: [{ id: "scene", dependencies: ["missing"] }], snapshot: { nodes: {} },
  }), /desconhecido/);
});
