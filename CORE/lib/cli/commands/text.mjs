import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { buildProductPromptRequest } from '../../media-pipeline/product-prompt.mjs';
import { buildContextTextRequest, generateContextText, CONTEXT_TEXT_MODEL } from '../../media-pipeline/context-text.mjs';

export async function executar(contexto) {
  const { options, coreRoot } = contexto;
  if (options.prompt && options['prompt-file']) throw new Error('Use --prompt ou --prompt-file.');
  if (options['dry-run'] != null && !['true', 'false'].includes(options['dry-run'])) throw new Error('--dry-run exige true ou false.');
  const prompt = options['prompt-file'] ? await readFile(path.resolve(options['prompt-file']), 'utf8') : options.prompt;
  const contextual = options.purpose && options.purpose !== 'product';
  const body = contextual ? buildContextTextRequest({prompt,purpose:options.purpose}) : buildProductPromptRequest({ prompt, atmosphere: options.atmosphere });
  if (options['dry-run'] === 'true') {
    console.log(JSON.stringify({ dryRun: true, operation: contextual ? 'context-text' : 'product-prompt', model: contextual ? CONTEXT_TEXT_MODEL : 'gemini-3.1-flash-lite', mediaGenerated: false, input: body }, null, 2));
    return;
  }
  const out = path.resolve(options.out ?? path.join(coreRoot, 'outputs', `texto-${randomUUID()}.json`));
  await mkdir(path.dirname(out), { recursive: true });
  // Reserva antes da chamada: repetir o mesmo destino nunca reenvia a solicitação.
  const receipt = { schema: contextual ? 'mkt-videos/context-text@1' : 'mkt-videos/product-prompt@1', purpose: options.purpose || 'product', status: 'pending', startedAt: new Date().toISOString(), input: body, auth: 'credential-manager', mediaGenerated: false };
  await writeFile(out, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  try {
    const { generateProductPromptWithBrowserAuth } = await import('../../../scripts/omni-product-studio-submit.mjs');
    const result = contextual ? await generateContextText({prompt,purpose:options.purpose}) : await generateProductPromptWithBrowserAuth({ prompt, atmosphere: options.atmosphere });
    Object.assign(receipt, result, { status: 'complete', completedAt: new Date().toISOString(), sha256: createHash('sha256').update(result.text).digest('hex') });
    await writeFile(out, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ status: 'complete', file: out, text: result.text, mediaGenerated: false }, null, 2));
  } catch (error) {
    // Não propagar corpos HTTP, cookies ou erros de sessão para recibos.
    if (receipt.status !== 'complete') await writeFile(out, JSON.stringify({ ...receipt, status: 'unresolved', automaticRetry: false }, null, 2));
    throw new Error(`Geração de texto não concluída. Consulte ${out}; nenhuma repetição automática foi feita.`, { cause: error });
  }
}
