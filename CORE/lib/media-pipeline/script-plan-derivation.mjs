export function extractNarrationBlocks(scriptPlan) {
  if (!scriptPlan || scriptPlan.schema !== "mkt-videos/script-plan@1") {
    throw new Error("Invalid schema, expected mkt-videos/script-plan@1");
  }

  if (!Array.isArray(scriptPlan.blocks)) {
    throw new Error("Missing blocks array");
  }

  // Validate duration sum
  const totalSeconds = scriptPlan.blocks.reduce((sum, b) => sum + (Number(b.seconds) || 0), 0);
  const target = scriptPlan.piece?.targetDurationSeconds || 60;

  if (totalSeconds < target * 0.9 || totalSeconds > target * 1.1) {
    throw new Error(`Total seconds ${totalSeconds} is outside 0.9x-1.1x of target duration ${target}`);
  }

  return scriptPlan.blocks;
}
