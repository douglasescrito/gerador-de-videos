import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedSessionTarget,
  classifySessionProbe,
  createSessionBroker,
} from "../scripts/session-broker.mjs";

function fakeBrowserRuntime({ gotoError = null } = {}) {
  const calls = [];
  const page = {
    async goto(url) { calls.push(["goto", url]); if (gotoError) throw gotoError; },
    async waitForTimeout(ms) { calls.push(["wait", ms]); },
  };
  const context = {
    async addCookies(cookies) { calls.push(["cookies", cookies.length]); },
    async newPage() { calls.push(["new-page"]); return page; },
    async close() { calls.push(["context-close"]); },
  };
  const browser = {
    async newContext() { calls.push(["new-context"]); return context; },
    async close() { calls.push(["browser-close"]); },
  };
  return {
    calls,
    browserType: { async launch(options) { calls.push(["launch", options.headless]); return browser; } },
  };
}

test("Session Broker valida origem antes de carregar cookies", async () => {
  let loaderCalls = 0;
  const runtime = fakeBrowserRuntime();
  const broker = createSessionBroker({
    browserType: runtime.browserType,
    executablePath: "chrome-test",
    loadCredentialCookies: async () => { loaderCalls += 1; return [{ name: "SID", value: "secret" }]; },
  });
  await assert.rejects(
    broker.open({ profile: "google-ai-studio", targetUrl: "https://example.test/escape" }),
    /Origem não permitida/,
  );
  assert.equal(loaderCalls, 0);
  assert.deepEqual(runtime.calls, []);
});

test("Session Broker usa fallback de serviço, não expõe segredo e limpa sessão", async () => {
  const runtime = fakeBrowserRuntime();
  const cookies = [{ name: "SID", value: "secret", domain: ".google.com" }];
  const services = [];
  const broker = createSessionBroker({
    browserType: runtime.browserType,
    executablePath: "chrome-test",
    waitAfterNavigationMs: 0,
    loadCredentialCookies: async (service) => {
      services.push(service);
      if (service === "GoogleAIStudio") throw new Error("token=do-not-leak C:\\private\\cookies.txt");
      return cookies;
    },
  });
  const session = await broker.open({ profile: "google-ai-studio", targetUrl: "https://aistudio.google.com/generate-speech" });
  assert.deepEqual(services, ["GoogleAIStudio", "OmniProductStudio"]);
  assert.equal(session.credentialService, "OmniProductStudio");
  assert.deepEqual(session.evidence({ schema: "override", secretMaterialPersisted: true }), {
    schema: "mkt-videos/session-evidence@1",
    secretMaterialPersisted: false,
    profile: "google-ai-studio",
    origin: "https://aistudio.google.com",
    authSource: "credential-manager",
  });
  assert.doesNotMatch(JSON.stringify(session.evidence()), /"SID"|do-not-leak|C:\\\\private|"value"/i);
  await session.close();
  await session.close();
  assert.deepEqual(cookies, []);
  assert.equal(runtime.calls.filter(([name]) => name === "context-close").length, 1);
  assert.equal(runtime.calls.filter(([name]) => name === "browser-close").length, 1);
});

test("Session Broker higieniza cookies e fecha recursos quando a navegação falha", async () => {
  const runtime = fakeBrowserRuntime({ gotoError: new Error("navigation failed") });
  const cookies = [{ name: "SID", value: "secret" }];
  const broker = createSessionBroker({
    browserType: runtime.browserType,
    executablePath: "chrome-test",
    waitAfterNavigationMs: 0,
    loadCredentialCookies: async () => cookies,
  });
  await assert.rejects(
    broker.open({ profile: "google-ai-studio", targetUrl: "https://aistudio.google.com/generate-speech" }),
    /navigation failed/,
  );
  assert.deepEqual(cookies, []);
  assert.equal(runtime.calls.some(([name]) => name === "context-close"), true);
  assert.equal(runtime.calls.some(([name]) => name === "browser-close"), true);
});

test("classificação de probe distingue login, permissão, cota, UI e pronto", () => {
  assert.equal(classifySessionProbe({ finalUrl: "https://accounts.google.com/signin" }), "login_required");
  assert.equal(classifySessionProbe({ httpStatus: 403 }), "permission_denied");
  assert.equal(classifySessionProbe({ error: new Error("quota exceeded") }), "quota_exhausted");
  assert.equal(classifySessionProbe({ error: new Error("selector not found") }), "ui_changed");
  assert.equal(classifySessionProbe({ authenticated: true }), "authenticated");
  assert.equal(classifySessionProbe({ ready: true }), "ready");
});

test("host do applet vale por padrão, não por instalação, e origem alheia continua recusada", () => {
  for (const origin of [
    "https://omni-product-studio-11111111-222222222222.us-east1.run.app",
    "https://omni-product-studio-abc123.southamerica-east1.run.app",
  ]) {
    assert.equal(assertAllowedSessionTarget("omni-product-studio", `${origin}/api/generate-video`), origin);
  }
  for (const origin of [
    "https://omni-product-studio.evil.test",
    "https://outro-app-123.us-east1.run.app",
    "http://omni-product-studio-abc.us-east1.run.app",
  ]) {
    assert.throws(() => assertAllowedSessionTarget("omni-product-studio", origin), /Origem não permitida/);
  }
  // O perfil do AI Studio não ganha o applet de brinde.
  assert.throws(
    () => assertAllowedSessionTarget("google-ai-studio", "https://omni-product-studio-abc.us-east1.run.app"),
    /Origem não permitida/,
  );
});
