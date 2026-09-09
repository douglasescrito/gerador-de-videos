import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Only owned test children are cancelled. Wait for close, not just rejection,
// before the fixture may remove its directory. Keep every child's real error.
export async function runTestProcessGroup(entries, options = {}) {
  const controller = new AbortController();
  return Promise.all(entries.map(async ({ id, args }) => {
    const execution = execute(process.execPath, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024, ...options, signal: controller.signal });
    const closed = new Promise(resolve => execution.child.once("close", resolve));
    let result;
    try { result = { id, status: "fulfilled", value: await execution }; }
    catch (reason) {
      result = { id, status: "rejected", reason, cancelledAfterPeerFailure: reason.code === "ABORT_ERR" };
      controller.abort();
    }
    await closed;
    return result;
  }));
}
