import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as nodeModule from "node:module";

const execFileAsync = promisify(execFile);
export const coreRoot = fileURLToPath(new URL("../../", import.meta.url));
export const cliFile = path.join(coreRoot, "scripts", "omni-cli.mjs");
const isolationLoader = new URL("./cli-query-isolation-loader.mjs", import.meta.url).href;
const isolationHooks = new URL("./cli-query-isolation-hooks.mjs", import.meta.url).href;
// A engine aceita Node 22 anterior a registerHooks: nesses runtimes a
// proteção permanece ativa pelo loader legado, sem fallback desprotegido.
const isolationArguments = typeof nodeModule.registerHooks === "function"
  ? ["--import", isolationHooks] : ["--experimental-loader", isolationLoader];

export async function runNode(args, { cwd, name, isolate = false, nodeArguments = [], environment = {} }) {
  try {
    const result = await execFileAsync(process.execPath, [
      ...(isolate ? isolationArguments : []), ...nodeArguments, ...args,
    ], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: "test",
        MKT_VIDEO_TEST_COOKIE_ENDPOINT: "",
        MKT_VIDEOS_RUNTIME_DB: path.join(cwd, `${name}.sqlite`),
        ...environment,
      },
    });
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      failure: error.killed ? "subprocesso excedeu o timeout" : String(error.message),
    };
  }
}
