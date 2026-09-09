# ADR 0038 — Auditoria report-only de candidatos do Piloto C

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

## Contexto

O gate híbrido precisa de um clipe Omni aprovado e de um overlay local
determinístico, mas a escolha deve continuar humana. A auditoria anterior era
um diagnóstico manual e não deveria selecionar, registrar direitos ou alterar
`outputs/`.

## Decisão

O comando existente `hybrid-pilot` ganha a superfície read-only:

```text
npm run video -- hybrid-pilot --audit-root <diretório> [--audit-out <arquivo.json>]
```

O relatório percorre apenas receipts e arquivos regulares sob o root indicado,
verifica o hash do receipt, considera a proveniência do provider, exige
`rightsStatus=allowed` explicitamente no receipt/metadata governada e só então
confere o hash do MP4. Paths são relativos ao root e prompts/payloads não são
projetados.

## Garantias

- `providerCalls=0`, `changed=false` e `selectionRequired=true` são invariantes;
- nenhum asset é selecionado, autorizado, movido, reparado ou escrito;
- direitos ausentes, provider desconhecido, receipt inválido ou hash divergente
  entram em `blocked` com motivo explícito;
- symlink, junction ou hardlink não são aceitos como artifact candidato;
- a saída é hash-bound e serve somente para orientar a revisão humana antes de
  criar `hybrid-pilot-selection@1`.

## Consequência

Quando surgir um receipt Omni com direitos permitidos, o mesmo comando poderá
reproduzir a lista de candidatos sem nova implementação ou consumo de cota.
Enquanto não surgir, o relatório continua demonstrando a ausência de
elegibilidade sem transformar proveniência ou existência física em consentimento.
