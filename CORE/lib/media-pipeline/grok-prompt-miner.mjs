import { assertProviderCapability, listProviderCapabilities } from "./provider-registry.mjs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { studioLocalPath } from '../studio-local-config.mjs';

export const GROK_PROMPT_MINER_SCHEMA = "mkt-videos/grok-prompt-miner@1";
export const GROK_PROMPT_RECEIPT_SCHEMA = "mkt-videos/grok-prompt-receipt@1";

// Modelo padrão. grok-3-latest funciona via HTTP direto com cookies do Credential Manager.
// grok-4 possui forte proteção anti-bot e bloqueia automações (Playwright e HTTP direto).
export const DEFAULT_GROK_MODEL = "grok-3-latest";
export const DIRECT_HTTP_MODELS = new Set(["grok-3-latest", "grok-3"]);

// Optional external HTTP adapter. The browser route uses the local runtime.
export function grokDirectClientFile(env = process.env) { return studioLocalPath('grokClient', env); }

export const SYSTEM_PROMPTS = Object.freeze({
  image: `You are a senior Prompt Engineer specialized in high-quality visual generation for Google Gemini / Imagen 3.
Your task is to take the user's short brief and generate exactly {COUNT} highly detailed, cinematic and photorealistic or stylized prompt variations.
Each mined prompt MUST contain:
- Main subject and action with precise details
- Scene composition and framing (e.g. close-up, wide shot, 85mm lens, rule of thirds)
- Lighting and atmosphere (e.g. golden hour, volumetric lighting, rim light, softbox)
- Color palette and texture (e.g. warm tones, film grain, hyper-detailed, 8k)
Keep prompts in clean English optimized for AI image generation models.
Return ONLY a numbered list of prompts, nothing else. Example:
1. [prompt here]
2. [prompt here]`,

  video: `You are a Cinematographer and Prompt Engineer specialized in AI video generation for Gemini Omni.
Your task is to take the user's short brief and generate exactly {COUNT} highly optimized prompt variations for AI video.
Each video prompt MUST describe:
- Clear camera movement (e.g. slow push-in, orbital tracking shot, static wide pan, dolly zoom)
- Action and element movement during the 5 to 10 seconds of the clip
- Subtle changes in lighting or atmosphere over time
- Cinematic visual style and texture
Avoid abrupt transitions. Keep prompts in clean English.
Return ONLY a numbered list of prompts, nothing else. Example:
1. [prompt here]
2. [prompt here]`
});

// ─── Leitura de credenciais do Windows Credential Manager ─────────────────────
// Usa o mesmo mecanismo do X MEDIA: target = "x-media-fetcher:primary:cookies"
// Retorna as cookies como array [{name, value}] ou null se não encontradas.
const POWERSHELL_READ_CREDENTIAL = String.raw`
$ErrorActionPreference = 'Stop'
$targetName = $env:X_MEDIA_CREDENTIAL_TARGET
$code = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class XMediaCredRead {
  private const int CRED_TYPE_GENERIC = 1;
  private const int ERROR_NOT_FOUND = 1168;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct FILETIME {
    public uint dwLowDateTime;
    public uint dwHighDateTime;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern void CredFree(IntPtr buffer);

  public static string ReadJson(string target) {
    IntPtr credentialPtr;
    if (!CredRead(target, CRED_TYPE_GENERIC, 0, out credentialPtr)) {
      int error = Marshal.GetLastWin32Error();
      if (error == ERROR_NOT_FOUND) return "{}";
      throw new Win32Exception(error);
    }
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
      string password = credential.CredentialBlobSize > 0
        ? Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2)
        : "";
      return "{\"found\":true,\"password\":\"" +
        Convert.ToBase64String(Encoding.UTF8.GetBytes(password)) +
        "\"}";
    } finally {
      CredFree(credentialPtr);
    }
  }
}
"@
Add-Type -TypeDefinition $code
[XMediaCredRead]::ReadJson($targetName)
`;

function readXMediaCookiesFromCredentialManager() {
  if (process.platform !== "win32") return null;
  const slots = ["primary", "local"];
  for (const slot of slots) {
    const target = `x-media-fetcher:${slot}:cookies`;
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command", POWERSHELL_READ_CREDENTIAL,
    ], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, X_MEDIA_CREDENTIAL_TARGET: target },
    });
    if (result.status !== 0) continue;
    try {
      const parsed = JSON.parse(String(result.stdout || "{}").trim() || "{}");
      if (!parsed.found) continue;
      const rawCookies = Buffer.from(parsed.password || "", "base64").toString("utf8");
      if (!rawCookies) continue;
      const cookieData = JSON.parse(rawCookies);
      const entries = Array.isArray(cookieData)
        ? cookieData
        : Array.isArray(cookieData?.cookies)
          ? cookieData.cookies
          : Object.entries(cookieData).map(([name, value]) => ({ name, value: String(value) }));
      const filtered = entries.filter((c) => c?.name && c?.value);
      if (filtered.length >= 2 && filtered.some((c) => c.name === "auth_token")) {
        return filtered;
      }
    } catch { /* tenta próximo slot */ }
  }
  return null;
}

function checkXMediaCookieStatus() {
  const cookies = readXMediaCookiesFromCredentialManager();
  if (!cookies) return { configured: false };
  return {
    configured: true,
    cookieCount: cookies.length,
    hasAuthToken: cookies.some((c) => c.name === "auth_token"),
    hasCt0: cookies.some((c) => c.name === "ct0"),
  };
}

// ─── Chamada real ao Grok via cliente do X MEDIA ──────────────────────────────
async function callGrokLive(systemPrompt, userBrief, model = DEFAULT_GROK_MODEL) {
  const fullPrompt = systemPrompt + "\n\nBrief: " + userBrief;

  // Modelos grok-3-* funcionam via HTTP direto com os cookies do Credential Manager
  if (DIRECT_HTTP_MODELS.has(model)) {
    const clientFile = grokDirectClientFile();
    if (!clientFile) throw new Error('Grok HTTP exige um cliente compatível configurado em STUDIO_GROK_CLIENT ou installation.json (grokClient).');
    const clientPath = pathToFileURL(clientFile);
    let askGrokDirect;
    try {
      const mod = await import(clientPath.toString());
      askGrokDirect = mod.askGrokDirect;
    } catch (error) {
      throw new Error(
        'Não foi possível carregar o cliente HTTP do Grok configurado nesta instalação.'
      );
    }
    const response = await askGrokDirect(fullPrompt, {
      logProgress: (msg) => process.stderr.write(`[grok-live] ${msg}\n`),
      returnSearchResults: false,
      modelOptionId: model,
    });
    return String(response || "").trim();
  }

  // Modelos grok-4* requerem browser (Playwright) com cookies injetados
  const { askGrokViaBrowser } = await import("./grok-browser-miner.mjs");
  return askGrokViaBrowser(fullPrompt, {
    model,
    logProgress: (msg) => process.stderr.write(`${msg}\n`),
  });
}

// ─── Parser da resposta numerada do Grok ─────────────────────────────────────
function parseGrokNumberedList(rawText, brief, targetMedia, style) {
  const lines = String(rawText || "").split("\n");
  const prompts = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (!match) continue;
    const idx = parseInt(match[1], 10);
    const text = match[2].trim();
    if (!text) continue;
    prompts.push({
      id: `prompt-grok-live-${idx}`,
      variant: idx,
      targetMedia,
      brief,
      style: style ?? "grok-live",
      effectivePrompt: text,
      rationale: `Mineração real Grok variação #${idx} para mídia ${targetMedia}.`,
      tokenEstimate: text.split(/\s+/).length,
      source: "grok-live",
    });
  }
  return prompts;
}

// ─── Templates Dublê ──────────────────────────────────────────────────────────
export function generateDubleePrompts({ brief, targetMedia = "video", style = null, count = 3 }) {
  const media = String(targetMedia).toLowerCase() === "image" ? "image" : "video";
  const numPrompts = Math.max(1, Math.min(10, Number(count) || 3));
  const stylePrefix = style ? `[Style: ${style}] ` : "";

  const templates = media === "video" ? [
    `${stylePrefix}Cinematic wide shot of ${brief}. Smooth slow-motion push-in tracking shot, soft volumetric golden hour light, highly detailed textures, 8k resolution, professional color grading.`,
    `${stylePrefix}Dynamic medium shot showing ${brief}. Steady camera panning smoothly from left to right, dramatic cinematic lighting, rich contrast and vivid details.`,
    `${stylePrefix}Atmospheric close-up shot focused on ${brief}. Shallow depth of field, subtle natural motion, elegant warm illumination, sharp focal clarity.`,
    `${stylePrefix}High-angle orbital shot highlighting ${brief}. Fluid camera movement circling the subject, crisp atmospheric depth, filmic color palette.`,
  ] : [
    `${stylePrefix}Ultra-realistic photographic shot of ${brief}. Captured on 85mm lens at f/1.8, natural morning sunlight, fine surface details, sharp focus, masterpiece.`,
    `${stylePrefix}Stylized artistic rendering of ${brief}. Vibrant harmonious colors, rich ambient occlusion, dramatic lighting, high contrast, elegant composition.`,
    `${stylePrefix}Photorealistic macro detailed shot of ${brief}. Studio softbox lighting, clean reflections, deep shadows, crisp details, 8k quality.`,
    `${stylePrefix}Cinematic environmental shot of ${brief}. Epic landscape framing, sunset rim light, moody volumetric haze, golden ratio composition.`,
  ];

  const results = [];
  for (let i = 0; i < numPrompts; i++) {
    const rawTemplate = templates[i % templates.length];
    results.push({
      id: `prompt-grok-${i + 1}`,
      variant: i + 1,
      targetMedia: media,
      brief,
      style: style ?? "cinematic-default",
      effectivePrompt: rawTemplate,
      rationale: `Mineração otimizada variação #${i + 1} para mídia ${media}.`,
      tokenEstimate: rawTemplate.split(/\s+/).length,
      source: "dublee",
    });
  }
  return results;
}

// ─── API Principal ─────────────────────────────────────────────────────────────
export async function minePromptsWithGrok({
  brief,
  targetMedia = "video",
  style = null,
  count = 3,
  dublee = true,
  authMode = "credential-manager",
  model = DEFAULT_GROK_MODEL,
  now = new Date(),
} = {}) {
  if (!brief || typeof brief !== "string" || !brief.trim()) {
    throw new Error("O parâmetro brief é obrigatório para a mineração de prompts.");
  }

  const normalizedBrief = brief.trim();
  const media = String(targetMedia).toLowerCase() === "image" ? "image" : "video";
  const numCount = Math.max(1, Math.min(10, Number(count) || 3));
  const startedAt = (now instanceof Date ? now : new Date(now)).toISOString();

  // Validar capacidade do provedor no registry
  const capabilities = listProviderCapabilities();
  const grokCapability = capabilities.find((c) => c.id === "grok-miner");
  if (!grokCapability) {
    throw new Error("Capacidade grok-miner não registrada no Provider Registry.");
  }

  // ── Modo Dublê (padrão, sem consumo de cota) ──────────────────────────────
  if (dublee) {
    const mined = generateDubleePrompts({ brief: normalizedBrief, targetMedia: media, style, count: numCount });
    const completedAt = new Date().toISOString();
    return {
      schema: GROK_PROMPT_MINER_SCHEMA,
      provider: "grok-miner",
      brief: normalizedBrief,
      targetMedia: media,
      style: style ?? null,
      prompts: mined,
      receipt: {
        schema: GROK_PROMPT_RECEIPT_SCHEMA,
        provider: "grok-miner",
        authMode: "dublee",
        operation: "prompt-mining",
        targetMedia: media,
        brief: normalizedBrief,
        promptsGenerated: mined.length,
        startedAt,
        completedAt,
        executionMode: 'offline',
        metadata: { engine: "grok-dublee-miner", systemPrompt: SYSTEM_PROMPTS[media] },
      },
    };
  }

  // ── Modo Live: chama o adapter explicitamente selecionado ────────────────
  if (process.env.NODE_ENV === 'test') throw new Error('Provider-free test guard: Grok live é proibido em NODE_ENV=test.');
  assertProviderCapability({ providers: [grokCapability] }, { provider: "grok-miner", operation: "prompt-mining" });

  const cookieStatus = checkXMediaCookieStatus();
  if (!cookieStatus.configured) {
    throw new Error(
      "Credenciais do X não encontradas no Windows Credential Manager.\n" +
      "Consulte docs/GROK-OPCIONAL.md para configurar sua própria sessão.\n" +
      "Target esperado: x-media-fetcher:primary:cookies"
    );
  }

  const systemPrompt = SYSTEM_PROMPTS[media].replace("{COUNT}", String(numCount));
  const rawGrokResponse = await callGrokLive(systemPrompt, normalizedBrief, model);
  let mined = parseGrokNumberedList(rawGrokResponse, normalizedBrief, media, style);

  if (!mined.length) throw new Error('Grok retornou conteúdo sem prompts reconhecíveis; nenhuma resposta sintética foi substituída.');

  const completedAt = new Date().toISOString();
  return {
    schema: GROK_PROMPT_MINER_SCHEMA,
    provider: "grok-miner",
    brief: normalizedBrief,
    targetMedia: media,
    style: style ?? null,
    prompts: mined,
    receipt: {
      schema: GROK_PROMPT_RECEIPT_SCHEMA,
      provider: "grok-miner",
      authMode,
      operation: "prompt-mining",
      targetMedia: media,
      brief: normalizedBrief,
      promptsGenerated: mined.length,
      startedAt,
      completedAt,
      executionMode: 'live',
      cookieStatus: { configured: cookieStatus.configured, cookieCount: cookieStatus.cookieCount },
      metadata: {
        engine: "grok-live-x-media",
        model,
        externalClientConfigured: Boolean(grokDirectClientFile()),
        rawResponseLength: rawGrokResponse.length,
        systemPrompt: SYSTEM_PROMPTS[media],
      },
    },
  };
}

// ─── Export auxiliar para diagnóstico ────────────────────────────────────────
export { checkXMediaCookieStatus, readXMediaCookiesFromCredentialManager };
