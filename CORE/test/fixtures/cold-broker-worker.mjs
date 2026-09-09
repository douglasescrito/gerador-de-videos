import { DatabaseSync } from "node:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createResourceBroker } from "../../lib/media-pipeline/resource-broker.mjs";

const [root, id] = process.argv.slice(2);
const original = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql === "PRAGMA journal_mode=WAL") {
    writeFileSync(path.join(root, `${id}.ready`), "ready");
    const deadline = Date.now() + 15_000;
    while (!existsSync(path.join(root, "go"))) {
      if (Date.now() > deadline) throw new Error("Barreira WAL não foi liberada.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return original.call(this, sql);
};
createResourceBroker({ dbFile: path.join(root, "runtime.sqlite") });
console.log("ready");
