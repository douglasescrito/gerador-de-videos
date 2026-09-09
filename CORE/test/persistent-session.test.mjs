import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  filterSessionCookies,
  PERSISTENT_SESSION_PROVIDERS,
  persistentSessionPaths,
  persistentSessionStatus,
  refreshPersistentSession,
  setupPersistentSession,
  storeSessionCookies,
  validatePersistentCookieSet,
} from "../scripts/persistent-session.mjs";

function googleCookies() {
  return [
    "SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-1PAPISID", "__Secure-3PSID",
  ].map((name, index) => ({ name, value: `value-${index}`, domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) + 3_600 }));
}

test("filtro de sessão mantém somente domínios permitidos e cookies ativos", () => {
  const source = [
    ...googleCookies(),
    { name: "expired", value: "old", domain: ".google.com", path: "/", expires: 1 },
    { name: "foreign", value: "secret", domain: ".example.test", path: "/" },
  ];
  const filtered = filterSessionCookies(source, "google", Math.floor(Date.now() / 1000));
  assert.equal(filtered.length, 8);
  assert.equal(validatePersistentCookieSet(filtered, "google").ready, true);
  assert.doesNotMatch(JSON.stringify(filtered), /foreign|old/);
  assert.equal(validatePersistentCookieSet(filtered.filter((cookie) => cookie.name !== "SID"), "google").ready, false);
});

test("Google e Flow compartilham o perfil, mas mantêm estados separados", () => {
  const root = path.resolve("session-root-test");
  const google = persistentSessionPaths("google", root);
  const flow = persistentSessionPaths("flow-music", root);
  assert.equal(google.profile, flow.profile);
  assert.notEqual(google.state, flow.state);
});

test("refresh não abre Chrome quando o perfil ainda não foi configurado", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-session-unconfigured-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let launches = 0;
  const result = await refreshPersistentSession({
    provider: "google",
    root,
    allowInTests: true,
    browserType: { async launchPersistentContext() { launches += 1; } },
  });
  assert.equal(result.classification, "not_configured");
  assert.equal(launches, 0);
});

test("setup usa Chrome comum primeiro e só depois entrega o perfil ao refresh headless", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-session-ordinary-chrome-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const result = await setupPersistentSession({
    provider: "google",
    root,
    allowInTests: true,
    launchLogin: async ({ profile, url }) => { calls.push(["login", profile, url]); },
    refresh: async (options) => {
      calls.push(["refresh", options.provider, options.allowUnconfiguredProfile, options.interactive]);
      return { ready: true, classification: "ready" };
    },
  });
  assert.deepEqual(calls.map((entry) => entry[0]), ["login", "refresh"]);
  assert.equal(calls[0][2], "https://aistudio.google.com/");
  assert.deepEqual(calls[1].slice(1), ["google", true, false]);
  assert.equal(result.ready, true);
});

test("setup persistente captura uma vez, alimenta os três cofres Google e grava somente metadados", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-session-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceCookies = googleCookies();
  const visited = [];
  const page = {
    async goto(url) { visited.push(url); },
    url() { return "https://aistudio.google.com/"; },
    async waitForTimeout() {},
  };
  let launchOptions;
  const browserType = {
    async launchPersistentContext(profile, options) {
      launchOptions = { profile, options };
      return {
        pages() { return [page]; },
        async cookies() { return sourceCookies; },
        async close() {},
      };
    },
  };
  const stored = [];
  const result = await refreshPersistentSession({
    provider: "google",
    interactive: true,
    root,
    allowInTests: true,
    browserType,
    storeCookies: async (service, cookies) => {
      stored.push({ service, count: cookies.length, hasValues: cookies.every((cookie) => cookie.value) });
      return { service, cookieCount: cookies.length };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(launchOptions.options.headless, false);
  // Três cofres, não dois: o Flow vive em labs.google e foi pendurado neste
  // provedor de propósito, porque ele já se renovava sozinho. Provedor
  // separado exigia login próprio e a sessão morria no meio do lote.
  assert.deepEqual(stored.map(({ service }) => service), ["GoogleAIStudio", "OmniProductStudio", "GoogleLabsFlow"]);
  assert.equal(stored.every(({ count, hasValues }) => count === 8 && hasValues), true);
  assert.deepEqual(visited, [
    PERSISTENT_SESSION_PROVIDERS.google.startUrl,
    ...PERSISTENT_SESSION_PROVIDERS.google.refreshUrls,
  ]);

  const paths = persistentSessionPaths("google", root);
  const stateText = await readFile(paths.state, "utf8");
  assert.doesNotMatch(stateText, /value-|SAPISID|"value"/);
  const state = JSON.parse(stateText);
  assert.equal(state.classification, "ready");
  assert.equal(state.secretMaterialPersistedInProject, false);

  const status = await persistentSessionStatus({
    provider: "google",
    root,
    credentialStatus: async (service) => ({ service, configured: true, cookies: 8, updatedAt: "2026-07-22T00:00:00.000Z" }),
  });
  assert.equal(status.configured, true);
  assert.equal(status.classification, "ready");
  assert.equal(status.credentialManager.length, 3);
});

test("gravação no cofre envia cookies por stdin, nunca por argumentos", async () => {
  let calledArgs;
  let stdin = "";
  function spawnProcess(_file, args) {
    calledArgs = args;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on("data", (chunk) => { stdin += chunk.toString("utf8"); });
    child.stdin.on("finish", () => {
      child.stdout.end("Importados 8 cookies\n");
      child.stderr.end();
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  }
  await storeSessionCookies("GoogleAIStudio", googleCookies(), { spawnProcess });
  assert.doesNotMatch(calledArgs.join(" "), /value-|"SID"/i);
  assert.match(stdin, /"SID"/);
  assert.match(stdin, /value-0/);
});
