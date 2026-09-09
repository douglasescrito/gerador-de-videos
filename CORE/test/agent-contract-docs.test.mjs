import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderAgentContractDocumentation } from "../lib/cli/agent-contract-docs.mjs";

const contractDocument = fileURLToPath(new URL("../docs/AGENT-CONTRACT.md", import.meta.url));

test("AGENT-CONTRACT.md é determinístico e reflete o registry e os error codes atuais", async () => {
  const first = renderAgentContractDocumentation();
  const second = renderAgentContractDocumentation();
  assert.equal(first, second);
  assert.match(first, /npm run video -- doctor|scripts\/omni-cli\.mjs doctor/);
  assert.match(first, /commands --format json/);
  assert.match(first, /mkt-videos\/cli-error@1/);
  for (const id of ["approve", "status", "resume", "reconcile"]) {
    assert.match(first, new RegExp(`\`${id}\``));
  }
  // Gerar mídia não exige confirmação: não há trava de gasto neste projeto.
  assert.doesNotMatch(first, /--confirm-paid/);
  assert.match(first, /Gerar mídia \*\*não\*\* exige confirmação/);
  assert.match(
    first,
    /\| `knowledge --action .*capture-feedback.*create-feedback-interpretation-candidate.*review-feedback-interpretation.*canonicalize-feedback-interpretation` \| `--confirm-human true` \|/,
  );
  assert.match(
    first,
    /Valores governados de `knowledge --action`[\s\S]*list-feedback-interpretation-candidates[\s\S]*replay-feedback-interpretation-candidates/,
  );
  assert.equal(await readFile(contractDocument, "utf8"), first);
});
