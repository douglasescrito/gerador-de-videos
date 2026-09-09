# Contrato do CLI para agentes

> Documento gerado de `lib/cli/command-registry.mjs` e `lib/cli/cli-errors.mjs`.
> Não editar manualmente. Regere com `node scripts/generate-agent-contract.mjs`.

Este documento é o que um agente sem contexto prévio deste repositório precisa
ler antes de operar o CLI. Execute sempre em `CORE/`.

## Antes de qualquer coisa

1. `node scripts/omni-cli.mjs doctor` (ou `npx mktvideo doctor` se instalado como
   binário) — confirma Node, ffmpeg, versão do CLI e se o app local está pronto.
   Os fatos locais (`local.*`) aparecem mesmo com o endpoint fora do ar.
2. `node scripts/omni-cli.mjs commands --format json` — manifesto completo: todo
   comando, opções, estabilidade, proteção, confirmação exigida e um exemplo.
3. `node scripts/omni-cli.mjs <comando> --help` — ajuda de um único comando.

## Formato de saída

- **Sucesso**: os comandos preservam seus schemas JSON em stdout e saem com código
  `0`; ajuda e consultas com formato próprio seguem o manifesto de cada comando.
- `run`, `resume`, `status`, `jobs` e `recipe` aceitam `--output-format json|text`.
  JSON permanece o padrão, com os mesmos campos e códigos de estado. Texto é um
  resumo para leitura humana; em `recipe`, vale para suggest, validate, explain,
  preflight e plan. Arquivos gravados por `--out` continuam sendo JSON completo.
  O formato nunca é inferido do terminal e não muda execução, direitos ou retries.
- **Falha**: mensagem humana em stderr e `process.exitCode = 1`, sempre, para toda
  categoria de erro. Quando o erro é reconhecido, uma segunda linha em stderr traz
  classificação de máquina:

  ```json
  {"schema": "mkt-videos/cli-error@1", "code": "confirmation_required", "hint": "...", "retryable": false}
  ```

- `code` reconhecidos hoje: `ambiguous_state`, `confirmation_required`, `dependency_missing`, `integrity_failure`, `policy_denied`, `provider_rejected`, `usage`.
- Nem todo erro já está classificado: ausência da segunda linha (`code` implícito
  `null`) significa falha genérica — **não** significa que é seguro repetir.
- Estado ambíguo exige `status`/`reconcile` antes de qualquer nova submissão.
  Se o usuário pedir explicitamente outra versão após conhecer a pendência,
  `resume --retry-decision <arquivo> --confirm-human true` registra uma substituição
  humana vinculada aos attempts exatos. O efeito anterior continua desconhecido;
  a decisão libera a reserva administrativamente e permite uma única nova tentativa.
  Rejeição terminal conhecida pode usar nova tentativa automática somente quando
  uma autorização de produção hash-bound estiver ativa e dentro do limite registrado.

## Comandos que exigem confirmação humana explícita

Gerar mídia **não** exige confirmação: não há trava de gasto neste projeto.
As confirmações abaixo são de outra natureza — decisão editorial, escrita
remota e remoção local — e continuam obrigatórias.

| Comando | Confirmação |
| --- | --- |
| `drive-deliver --dry-run false` | `--confirm-drive-write true` |
| `drive-deliver --cleanup-local-media true` | `--confirm-local-media-delete true` |
| `daily-commercials --action archive e --dry-run false` | `--confirm-drive-write true` |
| `daily-commercials --action archive e --dry-run false` | `--confirm-local-media-delete true` |
| `knowledge --action em activate-release, rollback-release, review-item, provision-scopes, register-asset-link, capture-feedback, create-feedback-interpretation-candidate, review-feedback-interpretation ou canonicalize-feedback-interpretation` | `--confirm-human true` |
| `director --action register` | `--confirm-human true` |
| `director --action materialize` | `--confirm-human true` |

Entradas externas em `image`, `generate` e `generate --task edit` exigem
`--confirm-provider-input true`. Em `batch`, `--production-authorization <json>`
registra essa decisão uma vez para a produção e a reutiliza somente com o mesmo
`productionId` e os mesmos hashes, papéis e operações. É trava de segurança, não de custo.

## Valores governados de `knowledge --action`

Ações aceitas: `status`, `packs`, `init`, `integrity`, `export`, `backup`, `restore`, `active-release`, `activate-release`, `rollback-release`, `review-item`, `provision-scopes`, `register-asset-link`, `import-candidate`, `replay-release`, `capture-feedback`, `list-feedback`, `replay-feedback`, `create-feedback-interpretation-candidate`, `list-feedback-interpretation-candidates`, `replay-feedback-interpretation-candidates`, `list-feedback-promotion-queue`, `review-feedback-interpretation`, `canonicalize-feedback-interpretation`, `retrieval-shadow`, `decision-shadow`.
A lista vem do mesmo registry leve consumido pelo application service; uma ação
nova não pode existir apenas no help ou no dispatcher.

## Contratos protegidos

`approve`, `status`, `resume`, `reconcile` têm teste de regressão dedicado
e não são candidatos a remoção ou mudança de comportamento sem atualizar esse teste.

## Nunca fazer

- Repetir automaticamente uma chamada ambígua ou inferir uma decisão humana de substituição.
- Expandir uma autorização de produção para outro ID, arquivo, hash, papel ou operação.
- Editar, regenerar ou corrigir fora do contrato aprovado da produção.
- Aplicar fade-out automático (o padrão é corte limpo, `fadeOut: 0`).
- Usar `--auth api` ou `GEMINI_API_KEY` — este projeto é cookie-only.
- Usar providers de narração ou música que não estejam no mapa de capacidades
  (`docs/CAPABILITIES.md`); Google Vids e Flow Music são os caminhos canônicos.
