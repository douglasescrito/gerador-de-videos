import assert from "node:assert/strict";
import test from "node:test";
import {
  collectFlowMusicClips,
  createFlowMusicResponseCollector,
  flowClipFromProviderHandle,
  generateFlowMusicWithBrowserAuth,
  waitForGeneratedClip,
} from "../scripts/flow-music-headless.mjs";
import { providerWaitProjection, resolveProviderWaitMs } from "../lib/media-pipeline/performance-policy.mjs";

test("orçamento de parede é sinal suave e nunca encurta a tentativa", () => {
  assert.equal(resolveProviderWaitMs("flow", 900_000), 900_000);
  assert.equal(resolveProviderWaitMs("omni", 1_200_000), 1_200_000);
  assert.deepEqual(providerWaitProjection("flow", 900_000), {
    provider: "flow",
    requestedMs: 900_000,
    effectiveMs: 900_000,
    softBudgetMs: 90_000,
    overBudgetBehavior: "continue-and-reconcile-same-attempt",
    destructiveDeadline: false,
    wallTargetMs: 300_000,
  });
});

function fakeJsonResponse({
  url = "https://www.flowmusic.app/__api/audio__create_song",
  status = 200,
  contentType = "application/json",
  payload = {},
} = {}) {
  return {
    url: () => url,
    status: () => status,
    headers: () => ({ "content-type": contentType }),
    json: async () => structuredClone(payload),
  };
}

test("coletor encontra clips aninhados, deduplica e ignora objetos incompletos", () => {
  const circular = {};
  circular.self = circular;
  const clips = collectFlowMusicClips({
    result: {
      clips: [
        { id: "clip-a", audio_url: "https://audio.invalid/a.mp3", op_id: "op-a", duration: 31.5 },
        { clip_id: "clip-b", audioUrl: "https://audio.invalid/b.mp3", title: "B" },
        { id: "clip-a", audio_url: "https://audio.invalid/a-new.mp3", title: "A final" },
        { id: "sem-audio" },
        circular,
      ],
    },
  });

  assert.equal(clips.length, 2);
  assert.deepEqual(clips.find((clip) => clip.id === "clip-a"), {
    audioUrl: "https://audio.invalid/a-new.mp3",
    id: "clip-a",
    operationId: null,
    title: "A final",
    durationSeconds: 0,
  });
  assert.equal(clips.find((clip) => clip.id === "clip-b").title, "B");
});

test("reconciliação deriva o original público somente de um clipId seguro", () => {
  assert.deepEqual(flowClipFromProviderHandle({ clipId: "clip-safe_123", operationId: "op-1" }), {
    audioUrl: "https://storage.googleapis.com/producer-app-public/clips/clip-safe_123.m4a",
    id: "clip-safe_123",
    operationId: "op-1",
    title: "Untitled",
    durationSeconds: 0,
  });
  assert.equal(flowClipFromProviderHandle({ clipId: "../segredo" }), null);
  assert.equal(flowClipFromProviderHandle({}), null);
});

test("collector só aceita JSON autenticado do Flow após start e fora do baseline", async () => {
  const collector = createFlowMusicResponseCollector({ baselineClipIds: ["clip-old"] });
  collector.observe(fakeJsonResponse({
    payload: { id: "clip-before", audio_url: "https://audio.invalid/before.mp3" },
  }));
  await collector.settle();
  assert.deepEqual(collector.values(), []);

  collector.start();
  collector.observe(fakeJsonResponse({
    payload: {
      clips: [
        { id: "clip-old", audio_url: "https://audio.invalid/old.mp3" },
        { id: "clip-new", audio_url: "https://audio.invalid/new.mp3", op_id: "op-new" },
      ],
    },
  }));
  collector.observe(fakeJsonResponse({
    url: "https://example.invalid/__api/audio__create_song",
    payload: { id: "clip-foreign", audio_url: "https://audio.invalid/foreign.mp3" },
  }));
  collector.observe(fakeJsonResponse({
    contentType: "text/html",
    payload: { id: "clip-html", audio_url: "https://audio.invalid/html.mp3" },
  }));
  await collector.settle();

  assert.deepEqual(collector.values().map((clip) => clip.id), ["clip-new"]);
  collector.scrub();
  assert.deepEqual(collector.values(), []);
});

test("adapter bloqueia antes de abrir navegador quando o HAR é usado", async () => {
  let openCalls = 0;
  const openPage = async () => {
    openCalls += 1;
    assert.fail("não deve abrir navegador");
  };

  await assert.rejects(
    generateFlowMusicWithBrowserAuth({
      prompt: "teste",
      outputFile: "teste.wav",
      harFile: "sessao.har",
      openPage,
    }),
    /somente --auth credential-manager/,
  );
  assert.equal(openCalls, 0);
});

test("nova UI vincula clips ao sound_prompt exato, sem aceitar outra conversa", async () => {
  const collector = createFlowMusicResponseCollector({ expectedPrompt: "exact submitted wrapper" });
  collector.start();
  collector.observe(fakeJsonResponse({ url: "https://www.flowmusic.app/__api/clips", payload: { clips: {
    wrong: { id: "wrong", audio_url: "https://audio.invalid/wrong.m4a", operation: { sound_prompt: "other production" } },
    missing: { id: "missing", audio_url: "https://audio.invalid/missing.m4a" },
    right: { id: "right", audio_url: "https://audio.invalid/right.m4a", operation: { sound_prompt: "exact submitted wrapper" } },
  } } }));
  await collector.settle();
  assert.deepEqual(collector.values().map((clip) => clip.id), ["right"]);
});

test("espera relê somente a conversa nova e recupera clip sem clicar Generate", async () => {
  let clock = 0, reads = 0;
  const conversation = "https://www.flowmusic.app/session/new-conversation";
  const collector = createFlowMusicResponseCollector({ expectedPrompt: "bound prompt" });
  collector.start();
  const evidence = [];
  const page = {
    url: () => conversation,
    locator: (selector) => ({
      evaluateAll: async () => selector.includes("/session/") ? [conversation] : [],
      innerText: async () => "",
    }),
    getByRole: () => ({ isDisabled: async () => false }),
    waitForTimeout: async (milliseconds) => { clock += milliseconds; },
    goto: async (href) => {
      assert.equal(href, conversation);
      reads += 1;
      collector.observe(fakeJsonResponse({ url: "https://www.flowmusic.app/__api/clips", payload: { clips: {
        ready: { id: "ready", op_id: "same-operation", audio_url: "https://audio.invalid/ready.m4a", operation: { sound_prompt: "bound prompt" } },
      } } }));
    },
  };
  const result = await waitForGeneratedClip({ page, collector, baselineHrefs: new Set(), baselineConversationHrefs: new Set(), timeoutMs: 60000, softBudgetMs: 45000, now: () => clock, onProviderEvidence: async (value) => evidence.push(value) });
  assert.equal(result.id, "ready");
  assert.equal(reads, 1);
  assert.ok(evidence.some((item) => item.conversationId === "new-conversation"));
  assert.ok(evidence.some((item) => item.clipId === "ready"));
});

test("duas conversas novas falham fechado antes de associar qualquer clip", async () => {
  const page = { url: () => "https://www.flowmusic.app/session", locator: () => ({ evaluateAll: async () => ["https://www.flowmusic.app/session/a", "https://www.flowmusic.app/session/b"] }) };
  await assert.rejects(waitForGeneratedClip({ page, collector: { settle: async () => {}, values: () => [] }, baselineHrefs: new Set(), baselineConversationHrefs: new Set(), timeoutMs: 1000, softBudgetMs: 1000 }), /Mais de uma conversa/);
});
