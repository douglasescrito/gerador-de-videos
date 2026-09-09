# ADR 0036 — Proveniência do receipt no piloto híbrido

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Status

Aceito; aplicado ao gate `hybrid-pilot` em modo provider-free.

## Decisão

`verifyHybridPilotSelection` não aceita mais uma `sourceClass` declarada como
única prova de origem. Depois de verificar artifact, hash, receipt e vínculo do
artifact no receipt, ele compara a classe com o provider registrado no receipt:

- `omni-approved` exige provider contendo `gemini` ou `omni`;
- `local-deterministic` exige provider local, Playwright ou FFmpeg.

Qualquer divergência produz `role:receipt-provenance`, marca o asset como
`quarantined` e mantém a composição bloqueada. O teste usa doubles locais; não
há inferência de direitos nem chamada de provider.

## Motivo

Um campo `sourceClass` preenchido pelo chamador não prova que o arquivo veio do
Omni. O receipt é a evidência técnica mínima disponível no gate, enquanto os
direitos continuam exigindo confirmação humana explícita (`rightsStatus=allowed`).

## Consequências

- elimina falsa classificação de um MP4 local como clip Omni aprovado;
- preserva o fluxo `raw`, o mesmo compositor e a cadeia de receipts;
- não transforma provider em autorização de direitos: `rightsStatus` continua
  obrigatório e não é derivado automaticamente;
- receipts históricos com provider desconhecido permanecem inelegíveis até uma
  seleção humana governada, sem reparo ou migração automática.

