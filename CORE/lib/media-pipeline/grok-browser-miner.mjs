/**
 * grok-browser-miner.mjs
 *
 * Minerador via Playwright + cookies do X MEDIA.
 * Simula a interação do usuário (digitar e enviar) para garantir que
 * todas as proteções anti-bot e headers (x-client-transaction-id) sejam
 * gerados naturalmente pelo frontend do X.com.
 */
import { readXMediaCookiesFromCredentialManager } from './grok-prompt-miner.mjs';
import { studioLocalPath } from '../studio-local-config.mjs';

const GROK_PAGE_URL = "https://x.com/i/grok";
const COOKIE_DOMAINS = [".twitter.com", ".x.com"];

function expandCookiesForDomains(cookies, domains) {
  return cookies.flatMap((cookie) =>
    domains.map((domain) => ({ ...cookie, domain, path: "/" }))
  );
}

async function loadPlaywright() { return import('playwright-core'); }

function extractMessage(rawText) {
  const allChunks = [];
  const finalChunks = [];
  String(rawText || "").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const data = JSON.parse(trimmed);
      const message = typeof data?.result?.message === "string" ? data.result.message : "";
      if (!message || data?.result?.isThinking) return;
      allChunks.push(message);
      const tag = String(data?.result?.messageTag || "").trim().toLowerCase();
      if (!tag || tag === "final") finalChunks.push(message);
    } catch { }
  });
  return (finalChunks.length ? finalChunks : allChunks).join("").trim();
}

export async function askGrokViaBrowser(prompt, { model = "grok-4", logProgress = () => {} } = {}) {
  if (process.env.NODE_ENV === 'test') throw new Error('Provider-free test guard: Grok browser real é proibido em NODE_ENV=test.');
  logProgress(`[browser-miner] Carregando Playwright para simular usuário...`);

  const cookies = readXMediaCookiesFromCredentialManager();
  if (!cookies) {
    throw new Error("Cookies do X não encontrados no Windows Credential Manager.");
  }

  const { chromium } = await loadPlaywright();
  const chromePath = studioLocalPath('chromePath');
  const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }) });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    const expanded = expandCookiesForDomains(cookies, COOKIE_DOMAINS);
    await context.addCookies(expanded);

    // Preparar interceptador da resposta do Grok
    let grokResponseText = null;
    let requestFailed = false;

    context.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('add_response.json') || (url.includes('grok') && url.includes('response'))) {
        try {
          const text = await resp.text();
          if (text.includes('"message"')) {
            grokResponseText = text;
          }
        } catch { }
      }
    });

    const page = await context.newPage();
    logProgress(`[browser-miner] Abrindo ${GROK_PAGE_URL}...`);
    await page.goto(GROK_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    
    // Aguardar o campo de texto carregar
    await page.waitForSelector('textarea', { state: 'visible', timeout: 15000 }).catch(() => {
        // Tentar locator alternativo
    });
    
    logProgress(`[browser-miner] Digitando prompt...`);
    const textarea = page.locator('textarea, [contenteditable="true"]').first();
    await textarea.click();
    
    // O Playwright fill é muito rápido e pode quebrar a UI do Twitter, vamos usar type
    await textarea.fill(prompt);
    await page.waitForTimeout(500);
    
    logProgress(`[browser-miner] Enviando (Enter)...`);
    await page.keyboard.press('Enter');

    logProgress(`[browser-miner] Aguardando resposta...`);
    
    // Aguardar até que grokResponseText seja preenchido ou dê timeout
    const startTime = Date.now();
    while (!grokResponseText && (Date.now() - startTime) < 45000) {
      await page.waitForTimeout(500);
    }

    if (!grokResponseText) {
      throw new Error(`Grok browser (${model}) não capturou nenhuma resposta após enviar (timeout).`);
    }

    const message = extractMessage(grokResponseText);
    if (!message) {
      throw new Error(`Grok browser (${model}) capturou resposta, mas estava vazia.`);
    }

    logProgress(`[browser-miner] Resposta recebida (${grokResponseText.length} bytes brutos).`);
    return message;
  } finally {
    await browser.close();
  }
}
