# ADR 0020 — Timeline@2, Motion IR e contrato de renderer offline

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita em shadow provider-free
- Estado da implementação: checkpoint inicial da Fase 7
- Data: 2026-07-27
- Escopo: timeline, Motion IR e futuros renderers locais

## Contexto

O compilador possui `timeline@1`, com frames racionais e tracks básicas, e o
acabamento local usa ASS/FFmpeg. HTML/Canvas poderá atender tipografia, dados,
UI e overlays exatos, mas não pode criar uma segunda timeline, buscar
dependências ou carregar sessão do provider.

## Decisão

1. `timeline@2` evolui `timeline@1` por adapters puros. O compilador canônico
   continua emitindo `timeline@1`; o novo contrato é observado em shadow até
   que o round-trip seja aceito.
2. Ranges usam `startFrame`, `durationFrames` e `endFrameExclusive`; duração
   desconhecida pode manter início conhecido, mas nunca um fim sem duração.
3. `motion-ir@1` organiza tracks em layers e clips, preserva assets lógicos,
   markers, provenance e classe de determinismo, sem paths físicos ou input de
   provider.
4. Os adapters devem produzir fingerprints canônicos e não podem alterar o
   execution-plan, receipts ou outputs.
5. Um renderer futuro só pode existir atrás de `renderer-contract@1` e
   `renderer-sandbox@1`: rede, cookies, downloads implícitos e relógio real
   ficam bloqueados; browser, Node, FFmpeg e fontes são pinados por hash.
6. `renderer-bake-off@1` é um relatório provider-free e `pending` por padrão;
   `promotionPerformed` permanece falso até decisão humana posterior.

## Limites

Este checkpoint não instala dependências, Remotion, fontes nem renderer no
workspace. O harness usa somente o Chromium já provisionado, captura frames
temporários para comparação e os remove; nenhum frame vira entrega Studio.
HTML motion, bake-off ampliado e novos adapters só podem ser promovidos depois
de prova offline com manifesto de ambiente e decisão humana.
