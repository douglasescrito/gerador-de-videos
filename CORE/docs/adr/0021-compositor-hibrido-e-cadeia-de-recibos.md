# ADR 0021 — Compositor híbrido e cadeia de recibos

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita como shadow provider-free
- Estado da implementação: fundação da Fase 8, sem piloto de mídia selecionado
- Data: 2026-07-27
- Escopo: composição local de vídeo Omni aprovado com overlays determinísticos

## Contexto

O projeto já possui um contrato de renderer offline e uma timeline shadow, mas
ainda não havia uma fronteira explícita para combinar um MP4 existente com uma
camada HTML/Canvas ou outro asset local com alpha. Fazer isso diretamente no
app, no modo `raw` ou em um novo executor criaria uma segunda fonte de verdade.

## Decisão

1. A composição híbrida é uma operação `studio` tipada por
   `hybrid-composition@1`; exige exatamente uma track `video-base` e mantém
   tracks `video-alpha`, `audio` e `captions` declaradas no mesmo manifesto.
2. A posição e a janela de cada overlay são expressas em frames e coordenadas
   numéricas. O compositor não inventa duração, não altera a timeline do
   plano e não modifica o MP4 de origem.
3. `hybrid-composition-plan@1` deriva cache content-addressed do manifesto,
   hashes dos artefatos e fingerprint da toolchain. Reuso é apenas um dado
   explícito do plano; não há fallback ou retry automático.
4. FFmpeg é somente o adapter local de composição. A publicação usa arquivo
   temporário, falha se a saída já existir e remove o temporário em erro.
5. O recibo encadeia todos os artefatos de entrada, o plano e os recibos-pai;
   o áudio base é preservado por padrão. Substituição/mix de áudio e captions
   exigem tracks e modos explícitos.
6. Nenhum comando novo, provider, renderer promovido ou chamada paga entra
   nesta etapa. O piloto só pode usar um clip Omni já aprovado após seleção
   humana explícita.

## Limites

Esta fundação não promove o renderer HTML, não consulta o Knowledge Core, não
executa geração e não autoriza mover outputs existentes. O primeiro piloto
deve comprovar um master reproduzível, integridade dos assets e recibos
encadeados antes de qualquer integração ao planner ou ao app.

