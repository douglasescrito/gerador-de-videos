import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  PRODUCTION_LOCK_ENV,
  PRODUCTION_LOCK_FILE,
  acquireProductionLock,
} from "../lib/media-pipeline/production-lock.mjs";

const run = promisify(execFile);
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, "..", "lib", "media-pipeline", "production-lock.mjs")).href;

test("produções diferentes avançam ao mesmo tempo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "producao-paralela-"));
  try {
    const a = await acquireProductionLock(path.join(root, "colecao-a"), { label: "a" });
    const b = await acquireProductionLock(path.join(root, "colecao-b"), { label: "b" });
    assert.equal(a.inherited, false);
    assert.equal(b.inherited, false);
    assert.notEqual(a.lockId, b.lockId);
    assert.equal(await a.release(), true);
    assert.equal(await b.release(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("segundo escritor na mesma coleção é recusado e mandado acompanhar", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "producao-exclusiva-"));
  try {
    const colecao = path.join(root, "colecao");
    const dono = await acquireProductionLock(colecao, { label: "gerador-em-cena-01" });
    await assert.rejects(
      acquireProductionLock(colecao, { label: "gerador-em-cena-01" }),
      /Produção em uso por outro processo.*Acompanhe essa execução/s,
    );
    assert.equal(await dono.release(), true);
    // Depois da liberação, a coleção volta a aceitar um escritor.
    const seguinte = await acquireProductionLock(colecao, { label: "gerador-em-cena-01" });
    assert.equal(seguinte.inherited, false);
    await seguinte.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("subprocesso autorizado herda a posse do pai em vez de esperar por ele", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "producao-heranca-"));
  try {
    const colecao = path.join(root, "colecao");
    const pai = await acquireProductionLock(colecao, { label: "episodio" });
    const filho = path.join(root, "filho.mjs");
    await writeFile(filho, `
import { acquireProductionLock } from ${JSON.stringify(moduleUrl)};
const posse = await acquireProductionLock(process.argv[2], { label: "episodio" });
process.stdout.write(JSON.stringify({ inherited: posse.inherited, lockId: posse.lockId }));
await posse.release();
`, "utf8");

    // Sem o token, o filho seria barrado pelo próprio pai — a espera circular
    // que a posse por coleção introduziria se não houvesse passagem explícita.
    await assert.rejects(
      run(process.execPath, [filho, colecao], { env: { ...process.env, [PRODUCTION_LOCK_ENV]: "" } }),
      /Produção em uso por outro processo/,
    );

    const herdado = await run(process.execPath, [filho, colecao], { env: { ...process.env, ...pai.childEnv() } });
    const resultado = JSON.parse(herdado.stdout);
    assert.equal(resultado.inherited, true);
    assert.equal(resultado.lockId, pai.lockId);

    // O filho não pode ter destruído a posse do pai ao terminar.
    const registro = JSON.parse(await readFile(path.join(colecao, PRODUCTION_LOCK_FILE), "utf8"));
    assert.equal(registro.lockId, pai.lockId);
    await pai.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("token de outra posse não serve como herança", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "producao-token-falso-"));
  try {
    const colecao = path.join(root, "colecao");
    const dono = await acquireProductionLock(colecao, { label: "episodio" });
    const chave = process.platform === "win32" ? dono.directory.toLowerCase() : dono.directory;
    const anterior = process.env[PRODUCTION_LOCK_ENV];
    process.env[PRODUCTION_LOCK_ENV] = JSON.stringify({ [chave]: "token-inventado" });
    try {
      await assert.rejects(acquireProductionLock(colecao, { label: "episodio" }), /Produção em uso por outro processo/);
    } finally {
      if (anterior === undefined) delete process.env[PRODUCTION_LOCK_ENV];
      else process.env[PRODUCTION_LOCK_ENV] = anterior;
    }
    await dono.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("posse de processo morto é recuperada; de processo vivo, não", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "producao-orfa-"));
  try {
    const colecao = path.join(root, "colecao");
    await mkdir(colecao, { recursive: true });
    const morto = await acquireProductionLock(colecao, { label: "x", isProcessAlive: () => true });

    // Processo vivo e calado mantém a posse mesmo com o lease vencido.
    await assert.rejects(
      acquireProductionLock(colecao, { label: "x", now: () => new Date(Date.now() + 86_400_000), isProcessAlive: () => true }),
      /Produção em uso por outro processo/,
    );

    // Só a ausência comprovada do dono libera.
    const recuperada = await acquireProductionLock(colecao, { label: "x", isProcessAlive: () => false });
    assert.equal(recuperada.inherited, false);
    assert.notEqual(recuperada.lockId, morto.lockId);
    await recuperada.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a mesma coleção por outro caminho é a mesma posse", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "producao-alias-"));
  try {
    const real = path.join(root, "colecao");
    const alias = path.join(root, "atalho");
    await mkdir(real, { recursive: true });
    try { await symlink(real, alias, "junction"); }
    catch { t.skip("sistema de arquivos não permite criar alias de diretório"); return; }
    const dono = await acquireProductionLock(real, { label: "x" });
    await assert.rejects(acquireProductionLock(alias, { label: "x" }), /Produção em uso por outro processo/);
    await dono.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});
