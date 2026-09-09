import { studioLocalPath } from '../studio-local-config.mjs';
export const CONTEXT_TEXT_MODEL = 'gemini-3.5-flash-lite';
export const CONTEXT_TEXT_PURPOSES = Object.freeze({
  shorten: 'Encurte a fala para cerca de metade do tamanho, em português. Preserve os fatos, a intenção, nomes e a chamada final. Responda apenas com a fala revisada.',
  opening: 'Proponha uma abertura visual alternativa para este vídeo. Preserve tema, personagem, referências, duração e requisitos de áudio. Responda apenas com a nova direção da cena, em português.',
  vertical: 'Adapte esta direção visual para enquadramento vertical 9:16, com ação central e margens para textos. Preserve conteúdo, duração, personagens e áudio. Responda apenas com a direção adaptada, em português.',
  rewrite: 'Melhore a clareza desta direção audiovisual. Preserve fatos, estrutura, duração e requisitos. Responda apenas com o texto revisado, em português.',
});
export function buildContextTextRequest({ prompt, purpose }) {
  if (!CONTEXT_TEXT_PURPOSES[purpose]) throw new Error('Ação contextual desconhecida.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) throw new Error('Informe um texto de até 20.000 caracteres.');
  return `${CONTEXT_TEXT_PURPOSES[purpose]}\nNão execute ferramentas, não crie arquivos nem gere imagens ou vídeos.\n\nTexto de origem:\n${prompt}`;
}
export async function submitContextText(page, prompt) {
  const input = page.getByRole('textbox', { name: 'Enter a prompt', exact: true });
  await input.waitFor({ timeout: 60000 });
  const tour = page.getByRole('button', { name: 'Fechar tour guiado', exact: true });
  if (await tour.count()) await tour.click();
  const selector = page.locator('button.model-selector-card');
  if (!(await selector.innerText()).includes(CONTEXT_TEXT_MODEL)) {
    await selector.click();
    await page.locator('button').filter({ hasText: 'Gemini 3.5 Flash Lite' }).first().click();
  }
  if (!(await selector.innerText()).includes(CONTEXT_TEXT_MODEL)) throw new Error('O modelo textual não corresponde ao contrato.');
  for (const label of ['Grounding with Google Search','Code execution','Browse the url context','Structured outputs','Function calling','Grounding with Google Maps']) {
    const control = page.getByRole('switch', { name: label, exact: true });
    if (await control.count() && await control.getAttribute('aria-checked') === 'true') await control.click();
  }
  await input.fill(prompt);
  // Uma única submissão. Erro remoto e timeout nunca autorizam rerun.
  await page.getByRole('button', { name: /^Run(?:\s|$)/ }).click();
  const error = () => page.locator('[data-turn-role="Model"] .model-error');
  await page.waitForFunction(() => document.querySelector('[data-turn-role="Model"] .model-error') || document.querySelector('[data-turn-role="Model"] ms-text-chunk')?.innerText?.trim(), {}, { timeout: 180000 });
  if (await error().count()) throw new Error('O AI Studio recusou a geração de texto. Nenhuma repetição foi feita.');
  // Aguarda o botão de execução voltar ao estado ocioso, sem ler pensamentos.
  await page.getByRole('button', { name: /^Run(?:\s|$)/ }).waitFor({ timeout: 180000 });
  const text = (await page.locator('[data-turn-role="Model"] ms-text-chunk').last().innerText()).trim();
  if (!text || text.length > 30000) throw new Error('Resposta textual ausente ou inválida.');
  return { text, model: CONTEXT_TEXT_MODEL, operation: 'context-text', auth: 'credential-manager', mediaGenerated: false };
}
export async function generateContextText({ prompt, purpose }) {
  const request = buildContextTextRequest({ prompt, purpose });
  const { loadEffectiveProviderCapabilities } = await import('./provider-registry.mjs');
  const capability = (await loadEffectiveProviderCapabilities())['gemini-context-text'];
  if (capability?.status !== 'supported') throw new Error('Texto contextual indisponível: o AI Studio retornou erro interno na verificação.');
  const { openStudioPage, cleanupHeadlessResources } = await import('../../scripts/ai-studio-headless.mjs');
  let resources;
  try { resources = await openStudioPage({ chrome: studioLocalPath('chromePath') ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', targetUrl: 'https://aistudio.google.com/prompts/new_chat' }); return await submitContextText(resources.page, request); }
  finally { if (resources) await cleanupHeadlessResources(resources); }
}
