# Capacidades dos provedores

> Documento gerado de `lib/media-pipeline/provider-registry.mjs`. Não editar manualmente.
> Regere com `node scripts/generate-governance-docs.mjs`.

Este mapa registra capacidade operacional, contrato de autenticação e elegibilidade como dependência de entrega. Ele não executa probes nem chama provedores.

Total: 16. 13 `supported`; 1 `pending`; 2 `blocked`; 0 `deprecated`.

| Provedor | Status | Operações | Autenticação | Reconcile | Pode ser dependência de entrega | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| `ffmpeg-local` | `supported` | `hybrid-compose` | `local-process` | não | sim | `hybrid-compositor-contract-and-provider-free-conformance` (2026-07-27) |
| `flow-music` | `supported` | `session-inspect`, `music-generate` | `cookie-only-browser-session` | não | sim | `flow-music-live-cookie-adapter-wav-receipt-2026-07-29` (2026-08-24) |
| `gemini-context-text` | `blocked` | `context-text` | `cookie-only-browser` | não | não | `diagnosticos/generator-context-text-live.json + diagnosticos/generator-context-text-lite-live.json` (2026-09-07) |
| `gemini-image` | `supported` | `image-generate` | `cookie-only-browser-session` | não | sim | `cookie-adapter-and-provider-free-contract-tests` (2026-08-24) |
| `gemini-omni` | `supported` | `text-to-video`, `image-to-video`, `reference-to-video`, `edit` | `cookie-only-browser-session` | sim | sim | `cookie-adapter-and-provider-free-contract-tests` (2026-08-24) |
| `gemini-product-text` | `supported` | `product-prompt` | `cookie-only-browser` | não | não | `diagnosticos/omni-text-contract-inspect-refreshed.json + diagnosticos/omni-text-live-validation.json` (2026-09-06) |
| `gemini-vision` | `blocked` | `semantic-qa` | `cookie-only-browser-session` | não | não | `cookie-only-adapter-not-verified` (2026-08-24) |
| `google-flow-image` | `supported` | `image-generate` | `cookie-only-browser-session` | não | sim | `flow-image-adapter-ponta-a-ponta-1376x768-nano-banana-2-2026-08-28` (2026-08-28) |
| `google-flow-video` | `supported` | `text-to-video` | `cookie-only-browser-session` | não | sim | `flow-video-adapter-ponta-a-ponta-1280x720-24fps-aac-8s-12-creditos-2026-08-28` (2026-08-28) |
| `google-vids` | `supported` | `text-to-speech` | `cookie-only-browser-session` | não | sim | `google-vids-live-cookie-adapter-wav-62s-2026-08-11` (2026-08-24) |
| `google-vids-multi-voice` | `pending` | `segmented-text-to-speech` | `cookie-only-browser-session` | sim | não | `live-proof-and-provider-free-replay-required` (2026-08-13) |
| `google-vids-video` | `supported` | `text-to-video` | `cookie-only-browser-session` | não | sim | `google-vids-omni-live-clip-1280x720-24fps-aac-10s-2026-08-28` (2026-08-28) |
| `grok-miner` | `supported` | `prompt-mining`, `image-prompt-generation`, `video-prompt-generation` | `credential-manager-grok-session` | não | sim | `grok-prompt-miner-dublee-contract-tests` (2026-08-24) |
| `hyperframes-html-local` | `supported` | `html-render` | `local-no-auth` | não | sim | `local-render-engines-parametric-offline-replay` (2026-09-06) |
| `playwright-html-local` | `supported` | `html-render` | `local-no-auth` | não | sim | `html-motion-pilot-b-byte-exact-offline-replay` (2026-07-27) |
| `remotion-html-local` | `supported` | `html-render` | `local-no-auth` | não | sim | `local-render-engines-parametric-offline-replay` (2026-09-06) |

## Limitações e substitutos

### `ffmpeg-local`

- Limitação: Composição local determinística; não gera mídia de provider.
- Substituto: —
- Estabilidade: `stable`
- TTL da evidência: não definido

### `flow-music`

- Limitação: Adapter acompanha a UI experimental do Flow; preserva o original, publica WAV com recibos e nunca repete automaticamente estado ambíguo.
- Substituto: —
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `gemini-context-text`

- Limitação: Chat autenticado inspecionado, mas Gemini 3 Flash e 3.5 Flash Lite retornaram erro interno sem texto. Não habilitar sem nova prova válida.
- Substituto: —
- Estabilidade: `experimental`
- TTL da evidência: 604800 segundos

### `gemini-image`

- Limitação: Imagem intermediária não garante aceitação posterior pelo Gemini Omni.
- Substituto: —
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `gemini-omni`

- Limitação: Modelo preview; não repetir automaticamente estado ambíguo ou rejeição terminal.
- Substituto: —
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `gemini-product-text`

- Limitação: Direção textual de comerciais de produto. Modelo identificado no código remoto; não é chat genérico.
- Substituto: —
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `gemini-vision`

- Limitação: QA semântico não possui adapter cookie-only verificável.
- Substituto: Use QA técnico local explícito e report-only.
- Estabilidade: `candidate`
- TTL da evidência: não definido

### `google-flow-image`

- Limitação: Secundário ao gemini-image, com intent próprio (image.generate.secondary) para que a escolha continue humana. Serve de quadro-chave enquanto o AI Studio devolve 404 de instant-ramen. O provedor escolhe o formato do arquivo — pediu PNG e veio JPEG — e o adapter corrige a extensão pelo Content-Type. O painel anuncia 0 créditos, mas o custo é do provedor e pode mudar.
- Substituto: Use gemini-image quando o provedor principal voltar.
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `google-flow-video`

- Limitação: Secundário ao gemini-omni e nunca selecionado sozinho: o intent é próprio (video.generate.text.secondary) para que a escolha continue humana. Clipes de 4 a 10 s em 1280x720 com áudio, 16:9 ou 9:16, lote de até 4 por submissão, ~12 créditos por clipe, sem marca-d'água. O vídeo é assíncrono: o adapter espera a mídia aparecer no projeto, e um estado ambíguo nunca é repetido sozinho. Sem reconciliação.
- Substituto: Use gemini-omni quando o provedor principal voltar.
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `google-vids`

- Limitação: A UI do Google Vids é experimental; o catálogo autenticado observado em 2026-08-12 contém 37 vozes e pode mudar no provedor. O adapter valida e confirma a voz selecionada antes de submeter, cria uma nova cena por padrão e nunca repete automaticamente uma submissão ambígua.
- Substituto: Use provider omni somente por decisão humana após falha de preflight ou reconciliação explícita.
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `google-vids-multi-voice`

- Limitação: Bloqueada até prova live autorizada com WAV e recibo distintos por segmento, concatenação/mix e alinhamento Whisper global reproduzíveis.
- Substituto: —
- Estabilidade: `candidate`
- TTL da evidência: não definido

### `google-vids-video`

- Limitação: Secundário ao gemini-omni e nunca selecionado sozinho: o intent é próprio (video.generate.text.secondary) para que a escolha continue humana. Clipes de 10 s fixos em 1280x720, comando só em inglês, marca ✦ queimada no canto inferior direito e cota mensal de 50 gerações. Sem reconciliação: a URL do MP4 é temporária e expira com a sessão.
- Substituto: Use gemini-omni assim que o provedor voltar; este caminho existe para a janela em que o Omni do AI Studio está fora.
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `grok-miner`

- Limitação: Mineração de prompts LLM/Vision com provedor externo Grok (xAI).
- Substituto: —
- Estabilidade: `experimental`
- TTL da evidência: 2592000 segundos

### `hyperframes-html-local`

- Limitação: Studio local, entrada JSON paramétrica, sem projetos executáveis ou áudio implícito.
- Substituto: —
- Estabilidade: `candidate`
- TTL da evidência: não definido

### `playwright-html-local`

- Limitação: Renderer local Studio-only; não acessa provider nem altera raw.
- Substituto: —
- Estabilidade: `candidate`
- TTL da evidência: não definido

### `remotion-html-local`

- Limitação: Studio local, entrada JSON paramétrica, sem projetos executáveis ou áudio implícito.
- Substituto: —
- Estabilidade: `candidate`
- TTL da evidência: não definido

## Regra operacional

Somente capacidades `supported` com `deliveryDependencyAllowed: true` podem ser dependência obrigatória de entrega. Estados `pending`, `blocked` e `deprecated` falham fechados; não autorizam repetição automática nem consumo de cota.
